"""Conservative, deterministic circuit compilation helpers.

This is the Phase-2 control-plane compiler seam. It performs only safe local
compression today; target-backend transpilation and large optional framework
adapters remain explicit later jobs. A candidate is selected only when its
resource metrics do not worsen, so a decomposition that expands a circuit is
rolled back to the original circuit rather than presented as an optimization.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from majorana_contracts.models import ResourceMetrics

from .models import Circuit, Operation

_SELF_INVERSE = frozenset({"x", "y", "z", "h", "cx", "cz", "swap"})


def resource_metrics(circuit: Circuit) -> ResourceMetrics:
    """Return deterministic depth and gate-count metrics for a canonical circuit."""

    layers = [0] * circuit.qubits
    gate_count = 0
    two_qubit_gate_count = 0
    measurement_count = 0
    for operation in circuit.operations:
        if operation.gate == "measure":
            measurement_count += 1
            continue
        if operation.gate == "barrier":
            continue
        gate_count += 1
        if len(operation.qubits) == 2:
            two_qubit_gate_count += 1
        if operation.qubits:
            layer = max(layers[index] for index in operation.qubits) + 1
            for index in operation.qubits:
                layers[index] = layer

    return ResourceMetrics(
        qubits=circuit.qubits,
        depth=max(layers, default=0),
        gate_count=gate_count,
        two_qubit_gate_count=two_qubit_gate_count,
        measurement_count=measurement_count,
    )


def _cancel_adjacent_pairs(circuit: Circuit) -> Circuit:
    operations: list[Operation] = []
    for operation in circuit.operations:
        if (
            operations
            and operation.gate in _SELF_INVERSE
            and operations[-1].gate == operation.gate
            and operations[-1].qubits == operation.qubits
            and operations[-1].params == operation.params
            and not operations[-1].clbits
            and not operation.clbits
        ):
            operations.pop()
        else:
            operations.append(operation)
    return circuit.model_copy(update={"operations": operations})


def _not_worse(before: ResourceMetrics, after: ResourceMetrics) -> bool:
    """Require every comparable complexity metric not to increase."""

    comparable = (
        (before.depth, after.depth),
        (before.gate_count, after.gate_count),
        (before.two_qubit_gate_count, after.two_qubit_gate_count),
    )
    return all(left is None or right is None or right <= left for left, right in comparable)


@dataclass(frozen=True)
class CompilationOutcome:
    source: Circuit
    selected: Circuit
    accepted: bool
    mode: Literal["unchanged", "compressed", "rejected"]
    before: ResourceMetrics
    candidate: ResourceMetrics
    reason: str | None = None


def compile_circuit(circuit: Circuit, *, candidate: Circuit | None = None) -> CompilationOutcome:
    """Try safe local compression and roll back any complexity increase.

    ``candidate`` is an internal adapter seam for target transpilers and tests:
    any future backend rewrite must pass through the same metric guard before it
    can replace the source circuit.
    """

    candidate = candidate or _cancel_adjacent_pairs(circuit)
    before = resource_metrics(circuit)
    candidate_metrics = resource_metrics(candidate)
    if candidate.operations == circuit.operations:
        return CompilationOutcome(
            source=circuit,
            selected=circuit,
            accepted=False,
            mode="unchanged",
            before=before,
            candidate=candidate_metrics,
            reason="no safe local reduction was found",
        )
    if not _not_worse(before, candidate_metrics):
        return CompilationOutcome(
            source=circuit,
            selected=circuit,
            accepted=False,
            mode="rejected",
            before=before,
            candidate=candidate_metrics,
            reason="candidate increased circuit complexity; original retained",
        )
    return CompilationOutcome(
        source=circuit,
        selected=candidate,
        accepted=True,
        mode="compressed",
        before=before,
        candidate=candidate_metrics,
    )
