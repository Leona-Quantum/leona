"""Studio's trusted third-party compiler lane — the CONTROL-PLANE half.

The input is the closed, declarative circuit model from ``majorana-contracts``;
no user source code is evaluated anywhere in this lane. Compiler output must be
lowered back to the same Studio gate set or the adapter fails explicitly. These
are compilation results, not verification evidence: the SDKs preserve unitary
meaning according to their own contracts, generally up to global phase.

**Where the compilers actually run, and why this file no longer imports one.**
ai-ops#186, answered *option A*: the six compiler SDKs execute inside
``infra/sandbox``'s rootfs, not inside the api+worker process. Two measured
reasons, both in that issue:

1. ``services/api/Dockerfile`` builds ONE image and ``deploy.yml`` runs BOTH
   ``majorana-api`` and ``majorana-worker`` from it. Installing the compilers
   here put 151 packages in that credentialed image against 129 without them,
   and 21 of the 22 added existed only because PyZX declares ``ipywidgets`` —
   ipython, pexpect, ptyprocess, a PTY spawner in a process that holds
   database and provider credentials.
2. ``asyncio.wait_for(asyncio.to_thread(...))`` cannot interrupt a thread that
   has started. A ``compiler_timeout`` reported failure while the compiler ran
   on, in the loop's default executor shared with QPU submit, QPU poll and
   research — so enough timed-out compiles silently blocked QPU submission on a
   worker that never restarts. A sandbox timeout destroys the machine, which is
   a real kill.

So this module keeps everything that does NOT need an SDK — splitting the
terminal measurements off, metrics, fingerprints, the improvement warning, and
turning the kernel's answer back into a validated
:class:`CircuitOptimizationResult`. The SDK half is
:mod:`majorana_frameworks.optimizer_kernel`, whose source is shipped into the
sandbox and run there.

``optimize_circuit`` still runs the kernel IN THIS PROCESS. It is kept for the
frameworks package's own tests and for a developer with the SDKs installed; the
worker does not call it, and ``services/`` does not depend on the extras that
would make it importable. See ``handle_circuit_optimize`` for the shipped path.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from majorana_contracts import (
    CircuitOptimizationGate,
    CircuitOptimizationOperation,
    CircuitOptimizationRequest,
    CircuitOptimizationResult,
    ResourceMetrics,
)

_TWO_QUBIT_GATES = {
    CircuitOptimizationGate.CX,
    CircuitOptimizationGate.CZ,
    CircuitOptimizationGate.SWAP,
}
_MAX_RESULT_OPERATIONS = 4096

#: The kernel's own source, read from disk rather than imported, because what
#: has to travel to the sandbox is TEXT. Reading it here also means the digest
#: the trusted lane checks is the digest of the file in this deployment, not of
#: a string some caller assembled.
_KERNEL_PATH = Path(__file__).with_name("optimizer_kernel.py")


class CircuitOptimizationError(ValueError):
    """Expected refusal from a compiler adapter, safe to show to the caller."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def kernel_path() -> Path:
    """The file the sandbox-side compiler kernel lives in.

    Handed to `register_trusted_program`, which reads it itself. The worker used
    to pass `kernel_source()` and that is what made the recorded digest a
    statement about a string rather than about a file (ai-ops#190).
    """

    return _KERNEL_PATH


def kernel_source() -> str:
    """The text of the sandbox-side compiler kernel.

    Still needed at the other end: `run_trusted` is handed the program text and
    checks its digest against the registry.
    """

    return _KERNEL_PATH.read_text(encoding="utf-8")


def build_kernel_payload(request: CircuitOptimizationRequest) -> dict[str, Any]:
    """The JSON the kernel is handed: the UNITARY PREFIX only.

    ``CircuitOptimizationRequest`` already refuses a non-terminal measurement,
    so every accepted circuit is a unitary prefix followed by a block of
    terminal measurements. The compiler never sees the measurements — they are
    re-appended verbatim by :func:`result_from_kernel`, which is what makes the
    result's ``equivalence`` value true of the whole circuit.
    """

    unitary, _measurements = _split_terminal_measurements(request.operations)
    return {
        "compiler": request.compiler.value,
        "qubit_count": request.qubit_count,
        "optimization_level": request.optimization_level,
        "operations": [operation.model_dump(mode="json") for operation in unitary],
    }


def result_from_kernel(
    request: CircuitOptimizationRequest, kernel_result: dict[str, Any]
) -> CircuitOptimizationResult:
    """Validate the kernel's answer and assemble the Studio-facing result.

    Everything the kernel returns crossed a process boundary, so it is
    re-validated here rather than trusted: the operations go back through
    ``CircuitOptimizationOperation``, which re-checks gate arity, qubit
    distinctness and the rotation/angle pairing.
    """

    if not kernel_result.get("ok"):
        raise CircuitOptimizationError(
            str(kernel_result.get("code") or "compiler_failed"),
            str(kernel_result.get("message") or "The compiler returned no result."),
        )
    version = str(kernel_result.get("version") or "")
    if not version:
        raise CircuitOptimizationError(
            "compiler_internal_error", "The compiler reported no version string."
        )
    raw_operations = kernel_result.get("operations")
    if not isinstance(raw_operations, list):
        raise CircuitOptimizationError(
            "compiler_internal_error", "The compiler returned no operation list."
        )
    try:
        optimized = [CircuitOptimizationOperation.model_validate(entry) for entry in raw_operations]
    except Exception as exc:
        raise CircuitOptimizationError(
            "compiler_output_unsupported",
            f"{request.compiler.value} returned an operation Studio cannot represent.",
        ) from exc

    _unitary, measurements = _split_terminal_measurements(request.operations)
    operations = [*optimized, *measurements]
    if len(operations) > _MAX_RESULT_OPERATIONS:
        raise CircuitOptimizationError(
            "compiler_output_too_large",
            f"Compiler output exceeds {_MAX_RESULT_OPERATIONS} Studio operations.",
        )
    if any(qubit >= request.qubit_count for operation in operations for qubit in operation.qubits):
        # The kernel is ours, but it ran in another process against a payload
        # this file serialized; a compiler that widened the register would
        # otherwise reach Studio as a circuit whose qubit_count is a lie.
        raise CircuitOptimizationError(
            "compiler_output_unsupported",
            f"{request.compiler.value} returned an operation outside the circuit's qubits.",
        )
    warnings = [
        "Compiler equivalence is unitary up to global phase; "
        "this result was not independently verified."
    ]
    if measurements:
        warnings.append("Terminal measurements were preserved outside the unitary compiler pass.")
    before = _metrics(request.qubit_count, request.operations)
    after = _metrics(request.qubit_count, operations)
    if not _strictly_improves(before, after):
        warnings.append(
            "The selected compiler did not reduce gate count, logical depth, or two-qubit gates."
        )
    return CircuitOptimizationResult(
        compiler=request.compiler,
        compiler_version=version,
        optimization_level=request.optimization_level,
        operations=operations,
        before=before,
        after=after,
        input_fingerprint=_fingerprint(request.operations),
        output_fingerprint=_fingerprint(operations),
        warnings=warnings,
    )


def optimize_circuit(request: CircuitOptimizationRequest) -> CircuitOptimizationResult:
    """Run one selected compiler IN THIS PROCESS and return a Studio result.

    Not the shipped path — the worker sends the kernel to the sandbox instead
    (see this module's docstring and ``handle_circuit_optimize``). This entry
    point exists so the adapters can be tested against the real SDKs, which the
    root dev group installs and which no deployed image does.
    """

    from majorana_frameworks import optimizer_kernel

    return result_from_kernel(
        request, optimizer_kernel.compile_operations(build_kernel_payload(request))
    )


def _split_terminal_measurements(
    operations: list[CircuitOptimizationOperation],
) -> tuple[list[CircuitOptimizationOperation], list[CircuitOptimizationOperation]]:
    first = next(
        (
            index
            for index, operation in enumerate(operations)
            if operation.gate is CircuitOptimizationGate.MEASURE
        ),
        len(operations),
    )
    return list(operations[:first]), list(operations[first:])


def _metrics(qubit_count: int, operations: list[CircuitOptimizationOperation]) -> ResourceMetrics:
    reached: dict[int, int] = {}
    depth = 0
    gate_count = 0
    measurements = 0
    two_qubit = 0
    for operation in operations:
        layer = max((reached.get(qubit, 0) for qubit in operation.qubits), default=0) + 1
        for qubit in operation.qubits:
            reached[qubit] = layer
        depth = max(depth, layer)
        if operation.gate is CircuitOptimizationGate.MEASURE:
            measurements += 1
        else:
            gate_count += 1
            if operation.gate in _TWO_QUBIT_GATES:
                two_qubit += 1
    return ResourceMetrics(
        qubits=qubit_count,
        depth=depth,
        gate_count=gate_count,
        two_qubit_gate_count=two_qubit,
        measurement_count=measurements,
    )


def _strictly_improves(before: ResourceMetrics, after: ResourceMetrics) -> bool:
    return any(
        next_value is not None and previous is not None and next_value < previous
        for previous, next_value in (
            (before.gate_count, after.gate_count),
            (before.depth, after.depth),
            (before.two_qubit_gate_count, after.two_qubit_gate_count),
        )
    )


def _fingerprint(operations: list[CircuitOptimizationOperation]) -> str:
    payload = [operation.model_dump(mode="json") for operation in operations]
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
