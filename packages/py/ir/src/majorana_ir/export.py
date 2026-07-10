"""Export classification — the product's core honesty promise (05-security.md
"No invented results"; benchmark-suite-v0.md JC-2/JC-5).

Every export is classified into exactly one of four evidence-based statuses:

  lossless          the target represents the IR circuit faithfully; code emitted
  lossy_with_reason the target represents it but drops/approximates something,
                    and the reason names what was lost
  download_only     no native target-faithful generator here, but a validated
                    OpenQASM 2 rendering is downloadable
  unsupported       the *IR itself* cannot hold the requested semantics; the
                    reason cites the IR limitation (JC-5) and acknowledges that
                    the target format could otherwise express it

Design rules baked in from the eval adjudications:
- JC-2: never pre-commit a label to a (gate, target) pair. The status follows
  from what the connectors can actually produce, not from a lookup table.
- JC-5: when the blocker is the IR's terminal-measurement / gate-set limit, the
  reason must blame the IR layer, not the format — blaming the wrong layer
  teaches dishonesty.
"""

from __future__ import annotations

from typing import Literal

from majorana_contracts.enums import ExportStatus
from pydantic import BaseModel

from majorana_ir.connectors.codegen import pennylane_code, qiskit_code
from majorana_ir.connectors.openqasm import to_openqasm
from majorana_ir.models import Circuit, validate_circuit

# Targets we can reason about. "native" ones have a faithful generator here;
# the rest have no native generator, so the honest ceiling is download_only.
Target = Literal["openqasm2", "openqasm3", "qiskit", "pennylane", "cudaq"]
_NATIVE_TARGETS = frozenset({"openqasm2", "qiskit", "pennylane"})


class ExportClassification(BaseModel):
    target: str
    status: ExportStatus
    reason: str | None = None
    code: str | None = None
    qasm: str | None = None
    qasm_available: bool = False


def _ir_limitation(circuit: Circuit) -> str | None:
    """Return the IR-capability reason a circuit cannot be faithfully exported to
    *any* target, or None if the circuit is a valid static IR circuit. This is the
    JC-5 hinge: the limitation is the IR's, and it's the same regardless of target.
    """
    result = validate_circuit(circuit)
    if result.passed:
        return None
    # The terminal-measurement / post-measurement errors are the canonical IR
    # limit; surface the first blocking error verbatim so the reason is concrete.
    return result.errors[0]


def classify_export(circuit: Circuit, target: Target) -> ExportClassification:
    """Classify how faithfully `circuit` exports to `target`, with evidence."""
    limitation = _ir_limitation(circuit)
    if limitation is not None:
        return ExportClassification(
            target=target,
            status=ExportStatus.UNSUPPORTED,
            reason=(
                f"IR limitation: {limitation}. The {target} format may be able to "
                "express this, but the canonical IR cannot represent it, so no "
                "faithful export is produced."
            ),
            qasm_available=False,
        )

    # A valid static IR circuit always has a downloadable OpenQASM 2 rendering.
    qasm = to_openqasm(circuit)

    if target == "openqasm2":
        return ExportClassification(
            target=target,
            status=ExportStatus.LOSSLESS,
            code=qasm,
            qasm=qasm,
            qasm_available=True,
        )

    if target == "qiskit":
        return ExportClassification(
            target=target,
            status=ExportStatus.LOSSLESS,
            code=qiskit_code(circuit),
            qasm=qasm,
            qasm_available=True,
        )

    if target == "pennylane":
        try:
            code = pennylane_code(circuit)
        except ValueError as exc:
            # e.g. reset — expressible in IR, not in this target. Still downloadable
            # as OpenQASM 2, so download_only, not unsupported.
            return ExportClassification(
                target=target,
                status=ExportStatus.DOWNLOAD_ONLY,
                reason=f"PennyLane cannot represent this circuit: {exc}",
                qasm=qasm,
                qasm_available=True,
            )
        approximations: list[str] = []
        if any(op.gate == "barrier" for op in circuit.operations):
            approximations.append("barriers become comments")
        if any(op.gate == "measure" for op in circuit.operations):
            approximations.append("terminal measurements become qml.sample")
        if approximations:
            return ExportClassification(
                target=target,
                status=ExportStatus.LOSSY_WITH_REASON,
                reason="; ".join(approximations),
                code=code,
                qasm=qasm,
                qasm_available=True,
            )
        return ExportClassification(
            target=target,
            status=ExportStatus.LOSSLESS,
            code=code,
            qasm=qasm,
            qasm_available=True,
        )

    if target in ("openqasm3", "cudaq"):
        # No native generator here. OpenQASM 3 is a superset of QASM 2 and CUDA-Q
        # can ingest QASM, so a validated OpenQASM 2 rendering is downloadable —
        # but we have not *proven* a target-native lossless form, so per JC-2 we
        # do not claim lossless.
        return ExportClassification(
            target=target,
            status=ExportStatus.DOWNLOAD_ONLY,
            reason=(
                f"no native {target} generator; a validated OpenQASM 2 rendering "
                "is available for download but a target-native faithful export "
                "has not been proven"
            ),
            qasm=qasm,
            qasm_available=True,
        )

    raise ValueError(f"unknown export target '{target}'")
