"""Standard OpenQASM ingestion and canonicalization through Qiskit."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.models import ResourceMetrics
from qiskit import QuantumCircuit, transpile
from qiskit import qasm2, qasm3

_VERSION_RE = re.compile(r"^\s*OPENQASM\s+(?P<version>[23](?:\.0)?)\s*;", re.IGNORECASE)


class OpenQASMError(ValueError):
    """The program is invalid or cannot be represented by the SDK boundary."""


def detect_version(source: str) -> Literal["2.0", "3.0"]:
    match = _VERSION_RE.match(source)
    if match is None:
        raise OpenQASMError("missing OPENQASM 2.0 or 3.0 declaration")
    return "2.0" if match.group("version").startswith("2") else "3.0"


def load_circuit(source: str) -> QuantumCircuit:
    """Parse OpenQASM 2/3 using Qiskit's maintained importers."""
    try:
        if detect_version(source) == "2.0":
            return qasm2.loads(source, strict=True)
        return qasm3.loads(source)
    except Exception as exc:
        raise OpenQASMError(str(exc)) from exc


def normalize(source: str) -> str:
    """Return the canonical persisted representation: Qiskit-emitted OpenQASM 3."""
    try:
        return qasm3.dumps(load_circuit(source))
    except OpenQASMError:
        raise
    except Exception as exc:
        raise OpenQASMError(str(exc)) from exc


def fingerprint(source: str) -> str:
    return hashlib.sha256(normalize(source).encode("utf-8")).hexdigest()


def resource_metrics(source_or_circuit: str | QuantumCircuit) -> ResourceMetrics:
    circuit = (
        load_circuit(source_or_circuit) if isinstance(source_or_circuit, str) else source_or_circuit
    )
    operations = circuit.count_ops()
    measurements = int(operations.get("measure", 0))
    gate_count = max(0, circuit.size() - measurements)
    two_qubit = sum(
        1
        for instruction in circuit.data
        if instruction.operation.name != "measure" and len(instruction.qubits) == 2
    )
    return ResourceMetrics(
        qubits=circuit.num_qubits,
        depth=circuit.depth(),
        gate_count=gate_count,
        two_qubit_gate_count=two_qubit,
        measurement_count=measurements,
    )


@dataclass(frozen=True)
class CompilationOutcome:
    source_qasm: str
    selected_qasm: str
    accepted: bool
    mode: Literal["unchanged", "optimized", "rejected"]
    before: ResourceMetrics
    candidate: ResourceMetrics
    reason: str | None = None


def _not_worse(before: ResourceMetrics, after: ResourceMetrics) -> bool:
    comparable = (
        (before.depth, after.depth),
        (before.gate_count, after.gate_count),
        (before.two_qubit_gate_count, after.two_qubit_gate_count),
    )
    return all(left is None or right is None or right <= left for left, right in comparable)


def compile_program(source: str) -> CompilationOutcome:
    """Apply deterministic SDK optimization and retain it only when not worse."""
    canonical = normalize(source)
    circuit = load_circuit(canonical)
    before = resource_metrics(circuit)
    try:
        candidate_circuit = transpile(circuit, optimization_level=1, seed_transpiler=0)
        candidate_qasm = qasm3.dumps(candidate_circuit)
        candidate = resource_metrics(candidate_circuit)
    except Exception as exc:
        return CompilationOutcome(
            source_qasm=canonical,
            selected_qasm=canonical,
            accepted=False,
            mode="rejected",
            before=before,
            candidate=before,
            reason=f"Qiskit optimization failed: {type(exc).__name__}",
        )
    if candidate_qasm == canonical:
        return CompilationOutcome(
            source_qasm=canonical,
            selected_qasm=canonical,
            accepted=False,
            mode="unchanged",
            before=before,
            candidate=candidate,
            reason="no deterministic reduction was found",
        )
    if not _not_worse(before, candidate):
        return CompilationOutcome(
            source_qasm=canonical,
            selected_qasm=canonical,
            accepted=False,
            mode="rejected",
            before=before,
            candidate=candidate,
            reason="candidate increased circuit complexity; original retained",
        )
    return CompilationOutcome(
        source_qasm=canonical,
        selected_qasm=candidate_qasm,
        accepted=True,
        mode="optimized",
        before=before,
        candidate=candidate,
    )
