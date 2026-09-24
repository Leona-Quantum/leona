"""A notebook cell asking to run its circuit on a real QPU: `leona_submit`.

A cell calls `leona_submit(circuit, shots=1024, *, label=None)`. Nothing is sent
anywhere. The call records a `HardwareRequest` (OpenQASM 3, shots, qubit count, an
optional label) on that cell's result, and the reader later runs it from the notebook
page: a device picker, the estimate and allowance, a confirm step that states the
price, and then the same `POST /v1/qpu/submissions` Studio uses, under the reader's own
IBM credential (plan rule 4, `10-notebook-ide-20260923.md`).

There are two implementations of the call, and this module is the reference for both:

- **In the product** `leona_submit` is defined by the sandbox program's trusted setup
  (`sandbox_program._SETUP_TEMPLATE`), because the sandbox image does not have this
  package installed and a cell must not need an import to use it. It records into the
  cell's protected record, which the provider writes to the sidecar exactly as it does
  every other per-cell field.
- **Outside the product** (an exported `.ipynb` on the reader's own machine) a shim
  calls `hardware_request` below, so the same circuit is refused for the same reason in
  both places.

The two cannot share source — the setup is a string with its own aliased builtins — so
`test_hardware.py` runs one table of inputs through both and compares the exception type
and message. That table is what stops them drifting; add a row when adding a check.

Every refusal raises rather than truncating or silently fixing: a request the reader is
shown a price for has to be exactly the circuit the cell built.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

from majorana_contracts.notebooks import (
    MAX_HARDWARE_REQUEST_LABEL_CHARS,
    MAX_HARDWARE_REQUEST_QASM_CHARS,
    MAX_HARDWARE_REQUEST_SHOTS,
    MAX_HARDWARE_REQUESTS_PER_NOTEBOOK,
    HardwareRequest,
)

DEFAULT_SHOTS = 1024

#: Every request's OpenQASM together, per notebook run. Not a route limit: this is the
#: share of the sandbox's 1 MiB evidence sidecar (`MAX_OUTPUT_BYTES`) the requests may
#: take, and it is much tighter than the route's per-request 200,000 on purpose.
#:
#: The arithmetic: a sidecar over 1 MiB is replaced WHOLE by `protected_result_too_large`,
#: so one oversized circuit would cost every cell its output. Figures are budgeted at
#: 600,000 PNG bytes, but they are stored base64, so that budget is up to ~800,000
#: bytes of JSON already; each cell may add 24,000 of stdout and 24,000 of stderr on top.
#: Eight requests at the route's own ceiling would be 1.6 MB by themselves. 64,000
#: characters is room for eight circuits of roughly 8 KB each — several thousand gates
#: of OpenQASM 3, far past anything worth running on today's devices — while leaving the
#: sidecar's arithmetic much as it was before hardware requests existed.
MAX_HARDWARE_QASM_TOTAL_CHARS = 64_000

#: `OPENQASM 3;` or `OPENQASM 3.0;` as the first statement, after comments and blanks.
_QASM_HEADER = re.compile(
    r"\A(?:\s|//[^\n]*(?:\n|\Z)|/\*.*?\*/)*OPENQASM\s+(\d+)(?:\.\d+)?\s*;", re.S
)
_QUBIT_ARRAY = re.compile(r"\bqubit\s*\[\s*(\d+)\s*\]\s*[A-Za-z_]\w*\s*;")
_QUBIT_SINGLE = re.compile(r"\bqubit\s+[A-Za-z_]\w*\s*;")
_QREG = re.compile(r"\bqreg\s+[A-Za-z_]\w*\s*\[\s*(\d+)\s*\]\s*;")
_PHYSICAL = re.compile(r"\$(\d+)\b")
_MEASURE = re.compile(r"\bmeasure\b")


def qasm_qubit_count(qasm: str) -> int:
    """Qubits an OpenQASM 3 program declares: `qubit[n] q;`, `qubit q;`, the legacy
    `qreg q[n];`, plus distinct physical qubits (`$0`). A count, not a parse — the
    worker's `qasm3.loads` is the parser, and the sandbox image does not carry the
    optional package that makes `qasm3.loads` work."""
    declared = sum(int(n) for n in _QUBIT_ARRAY.findall(qasm))
    declared += len(_QUBIT_SINGLE.findall(qasm))
    declared += sum(int(n) for n in _QREG.findall(qasm))
    return declared + len(set(_PHYSICAL.findall(qasm)))


def _check_shots(shots: Any) -> int:
    if isinstance(shots, bool) or not isinstance(shots, int):
        raise TypeError(f"shots must be a whole number, not {type(shots).__name__}.")
    if shots < 1 or shots > MAX_HARDWARE_REQUEST_SHOTS:
        raise ValueError(
            f"shots must be between 1 and {MAX_HARDWARE_REQUEST_SHOTS:,}; got {shots}."
        )
    return shots


def _check_label(label: Any) -> str | None:
    if label is None:
        return None
    if not isinstance(label, str):
        raise TypeError(f"label must be text, not {type(label).__name__}.")
    if len(label) > MAX_HARDWARE_REQUEST_LABEL_CHARS:
        raise ValueError(
            f"label is {len(label)} characters; the limit is {MAX_HARDWARE_REQUEST_LABEL_CHARS}."
        )
    return label


def _from_qasm_text(text: str) -> tuple[str, int]:
    header = _QASM_HEADER.match(text)
    if header is not None and header.group(1) == "2":
        raise ValueError(
            "This is OpenQASM 2. leona_submit sends OpenQASM 3: pass the QuantumCircuit "
            "itself, or load the text with qiskit.qasm2.loads first."
        )
    if header is None or header.group(1) != "3":
        raise ValueError("An OpenQASM string must start with 'OPENQASM 3;'.")
    qubits = qasm_qubit_count(text)
    if qubits < 1:
        raise ValueError("This circuit has no qubits, so there is nothing to run.")
    if _MEASURE.search(text) is None:
        raise ValueError(
            "This circuit measures nothing, so a device would return no counts. "
            "Add measurements, for example qc.measure_all()."
        )
    return text, qubits


def _from_circuit(circuit: Any) -> tuple[str, int]:
    from qiskit import qasm3

    if circuit.num_qubits < 1:
        raise ValueError("This circuit has no qubits, so there is nothing to run.")
    if circuit.parameters:
        names = ", ".join(sorted(parameter.name for parameter in circuit.parameters)[:5])
        raise ValueError(
            f"This circuit still has unbound parameters ({names}). "
            "Bind them with assign_parameters before submitting."
        )
    if not any(item.operation.name == "measure" for item in circuit.data):
        raise ValueError(
            "This circuit measures nothing, so a device would return no counts. "
            "Add measurements, for example qc.measure_all()."
        )
    try:
        qasm = qasm3.dumps(circuit)
    except Exception as exc:  # noqa: BLE001 - any exporter failure is the reader's to see
        raise ValueError(
            f"This circuit could not be written as OpenQASM 3 ({type(exc).__name__}: {exc}). "
            "Nothing was recorded."
        ) from exc
    return qasm, int(circuit.num_qubits)


def hardware_request(
    circuit: Any, shots: Any = DEFAULT_SHOTS, *, label: Any = None
) -> HardwareRequest:
    """One `HardwareRequest` for `circuit`, or a clear error. Stateless: the per-notebook
    ceilings are `HardwareLedger`'s. Mirrors the sandbox's `_ln_submit`."""
    shots = _check_shots(shots)
    label = _check_label(label)
    if isinstance(circuit, str):
        qasm, qubits = _from_qasm_text(circuit)
    else:
        try:
            from qiskit import QuantumCircuit
        except ImportError:  # pragma: no cover - qiskit is a dependency of every runner
            QuantumCircuit = None  # noqa: N806
        if QuantumCircuit is None or not isinstance(circuit, QuantumCircuit):
            raise TypeError(
                "leona_submit takes a Qiskit QuantumCircuit or an OpenQASM 3 string, "
                f"not {type(circuit).__name__}."
            )
        qasm, qubits = _from_circuit(circuit)
    if len(qasm) > MAX_HARDWARE_REQUEST_QASM_CHARS:
        raise ValueError(
            f"This circuit is {len(qasm):,} characters of OpenQASM; one request may be at "
            f"most {MAX_HARDWARE_REQUEST_QASM_CHARS:,}."
        )
    return HardwareRequest(qasm=qasm, shots=shots, num_qubits=qubits, label=label)


@dataclass
class HardwareLedger:
    """The per-notebook ceilings: how many requests, and how much OpenQASM in total."""

    requests: list[HardwareRequest] = field(default_factory=list)

    def add(self, request: HardwareRequest) -> HardwareRequest:
        if len(self.requests) >= MAX_HARDWARE_REQUESTS_PER_NOTEBOOK:
            raise ValueError(
                f"This notebook has already asked for {MAX_HARDWARE_REQUESTS_PER_NOTEBOOK} "
                "hardware runs, the most one notebook can ask for."
            )
        total = sum(len(item.qasm) for item in self.requests) + len(request.qasm)
        if total > MAX_HARDWARE_QASM_TOTAL_CHARS:
            raise ValueError(
                f"This notebook's hardware requests would come to {total:,} characters of "
                f"OpenQASM; together they may be at most {MAX_HARDWARE_QASM_TOTAL_CHARS:,}."
            )
        self.requests.append(request)
        return request


def recorded_sentence(request: HardwareRequest) -> str:
    """What a cell shows after a successful `leona_submit`."""
    qubits = "1 qubit" if request.num_qubits == 1 else f"{request.num_qubits} qubits"
    shots = "1 shot" if request.shots == 1 else f"{request.shots} shots"
    return (
        f"Hardware request recorded: {qubits}, {shots}. Choose a device under this cell to run it."
    )
