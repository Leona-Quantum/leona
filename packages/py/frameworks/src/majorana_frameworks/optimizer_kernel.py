"""Sandbox-side half of the Studio compiler lane.

This file is shipped as source text into a bare sandbox rootfs and executed there
as ``main.py``, in an environment where none of this monorepo's own packages are
installed -- only the Python standard library and the third-party quantum SDKs
baked into the sandbox image. It is also imported as an ordinary module by tests
running in CI, so importing it must never depend on anything outside the standard
library, and every SDK import must stay lazy, deferred to the function that
actually needs it, exactly like ``optimizers.py``.

Because ``majorana_contracts`` is unavailable inside the sandbox, this module
redeclares the two enums it needs (``Gate``, ``Compiler``) instead of importing
them. Their member names and values MUST stay in lockstep with
``majorana_contracts.enums.CircuitOptimizationGate`` and
``majorana_contracts.enums.CircuitCompiler`` -- a test pins this.

The control-plane half of this lane -- request/response validation, terminal
measurement handling, resource metrics, fingerprints, and the
``_MAX_RESULT_OPERATIONS`` cap -- stays in ``majorana_frameworks.optimizers``. This
file receives only a unitary operation prefix and returns only a compiled unitary
prefix; it never re-appends terminal measurements and never enforces a result-size
cap.
"""

# NO `from __future__ import annotations` HERE, AND IT IS NOT AN OVERSIGHT.
# This module is composed into a larger script before it executes (the trusted
# lane appends its payload globals and an entrypoint call, and the local
# subprocess double prepends an rlimit bootstrap), and a `__future__` import is
# only legal as the first statement of the compiled unit. It bought nothing
# here anyway: every annotation below is valid natively on the 3.12 floor this
# package declares. `register_trusted_program` refuses a program that carries
# one, so this cannot regress silently.

import importlib.metadata
import json
import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Gate(StrEnum):
    """Gate subset that Studio can round-trip through every framework draft.

    Local stand-in for ``majorana_contracts.enums.CircuitOptimizationGate``. Member
    names and values must stay byte-identical to that enum; a test pins this.
    """

    H = "H"
    X = "X"
    Y = "Y"
    Z = "Z"
    S = "S"
    T = "T"
    RX = "RX"
    RY = "RY"
    RZ = "RZ"
    CX = "CX"
    CZ = "CZ"
    SWAP = "SWAP"
    MEASURE = "M"


class Compiler(StrEnum):
    """Trusted third-party compiler selected for a bounded Studio IR job.

    Local stand-in for ``majorana_contracts.enums.CircuitCompiler``. Member names
    and values must stay byte-identical to that enum; a test pins this.
    """

    QISKIT = "qiskit"
    CIRQ = "cirq"
    PYTKET = "pytket"
    PENNYLANE = "pennylane"
    PYZX = "pyzx"
    BQSKIT = "bqskit"


@dataclass(frozen=True)
class Op:
    """One operation in the bounded, code-free Studio compiler interchange.

    Local stand-in for ``majorana_contracts.CircuitOptimizationOperation``: same
    three fields, but a plain dataclass rather than a pydantic model, since
    pydantic is unavailable in the sandbox. ``frozen=True`` together with a
    ``list`` field is fine here because nothing ever hashes an ``Op``.
    """

    gate: Gate
    qubits: list[int]
    angle_radians: float | None = None

    def to_dict(self) -> dict[str, Any]:
        """Same three keys, same shapes, as pydantic's ``model_dump(mode="json")``
        for ``CircuitOptimizationOperation``."""
        return {
            "gate": self.gate.value,
            "qubits": list(self.qubits),
            "angle_radians": self.angle_radians,
        }


class KernelError(ValueError):
    """Expected refusal from a compiler adapter, safe to show to the caller."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


_TWO_QUBIT_GATES = {Gate.CX, Gate.CZ, Gate.SWAP}
_ROTATION_GATES = {Gate.RX, Gate.RY, Gate.RZ}
_QISKIT_BASIS = ["h", "x", "y", "z", "s", "t", "rx", "ry", "rz", "cx", "cz", "swap"]


def _qiskit_compile(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    from qiskit import QuantumCircuit
    from qiskit.transpiler import generate_preset_pass_manager

    circuit = QuantumCircuit(qubit_count)
    _apply_operations(circuit, operations, _QISKIT_APPLIERS)
    manager = generate_preset_pass_manager(
        optimization_level=level,
        basis_gates=_QISKIT_BASIS,
        seed_transpiler=42,
    )
    optimized = manager.run(circuit)
    return _operations_from_qiskit(optimized, restore_output_permutation=True), _version("qiskit")


def _cirq_compile(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    import cirq

    qubits = cirq.LineQubit.range(qubit_count)
    circuit = cirq.Circuit(_cirq_operation(operation, qubits, cirq) for operation in operations)
    # CZTargetGateset performs Cirq's documented merge/decompose/cleanup
    # pipeline. Partial CZ gates are disabled because Studio cannot represent
    # a fractional controlled phase without silently changing its gate model.
    gateset = cirq.CZTargetGateset(allow_partial_czs=False)
    optimized = cirq.optimize_for_target_gateset(circuit, gateset=gateset)
    if level >= 3:
        # The pipeline is convergent, but a second high-strength pass can expose
        # cancellations after the first pass has decomposed composite gates.
        optimized = cirq.optimize_for_target_gateset(optimized, gateset=gateset)
    return _operations_from_cirq(optimized, cirq), _version("cirq-core")


def _bqskit_compile_native(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    """Run BQSKit directly on the calling thread -- no spawn child needed here.

    In ``optimizers.py`` this same routine runs inside a
    ``multiprocessing.get_context("spawn")`` child, because the Worker invokes
    every optimizer from ``asyncio.to_thread`` and BQSKit's attached runtime
    registers process signal handlers, which it refuses to do off the main
    thread. That reason does not exist in this file: it runs as ``main.py`` on
    the main thread of a fresh, single-purpose sandbox process, so BQSKit's
    runtime starts happily in-process and the spawn child, its pipe, and its
    50-second ``receiver.poll`` budget are all unnecessary machinery here. The
    wall-clock bound on a BQSKit run is now the sandbox's own creation timeout,
    not a poll inside this function. Do not re-add the spawn child.
    """
    from bqskit import compile as bqskit_compile
    from bqskit.ext.qiskit import bqskit_to_qiskit, qiskit_to_bqskit
    from qiskit import QuantumCircuit
    from qiskit.transpiler import generate_preset_pass_manager

    if qubit_count > 8 or len(operations) > 128:
        raise KernelError(
            "bqskit_budget_exceeded",
            "BQSKit is limited to 8 qubits and 128 unitary operations.",
        )
    source = QuantumCircuit(qubit_count)
    _apply_operations(source, operations, _QISKIT_APPLIERS)
    compiled = bqskit_compile(
        qiskit_to_bqskit(source),
        optimization_level=level,
        max_synthesis_size=2,
        seed=42,
        # BQSKit starts a local compiler runtime. Keep it bounded inside the
        # sandbox process instead of inheriting every available CPU.
        num_workers=1,
    )
    qiskit_output = bqskit_to_qiskit(compiled)
    normalized = generate_preset_pass_manager(
        optimization_level=0,
        basis_gates=_QISKIT_BASIS,
        seed_transpiler=42,
    ).run(qiskit_output)
    return _operations_from_qiskit(normalized), _version("bqskit")


def _pennylane_compile(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    del qubit_count  # Wire labels are carried by each operation.
    import pennylane as qml

    qml_operations = [_pennylane_operation(operation, qml) for operation in operations]
    tape = qml.tape.QuantumScript(qml_operations)
    batches, _postprocess = qml.compile(
        tape,
        basis_set=[
            "Hadamard",
            "PauliX",
            "PauliY",
            "PauliZ",
            "S",
            "T",
            "RX",
            "RY",
            "RZ",
            "CNOT",
            "CZ",
            "SWAP",
        ],
        num_passes=level,
    )
    if len(batches) != 1:
        raise KernelError(
            "compiler_output_unsupported", "PennyLane returned more than one circuit."
        )
    return _operations_from_pennylane(batches[0].operations), _version("pennylane")


def _pytket_compile(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    from pytket import Circuit, OpType
    from pytket.passes import AutoRebase, FullPeepholeOptimise, RemoveRedundancies

    circuit = Circuit(qubit_count)
    _apply_operations(circuit, operations, _PYTKET_APPLIERS)
    RemoveRedundancies().apply(circuit)
    if level >= 2:
        # Never allow an implicit output-wire permutation: Studio has no place
        # to represent one, so accepting it would silently change qubit meaning.
        FullPeepholeOptimise(allow_swaps=False).apply(circuit)
    if level >= 3:
        FullPeepholeOptimise(allow_swaps=False).apply(circuit)
    AutoRebase(
        {
            OpType.H,
            OpType.X,
            OpType.Y,
            OpType.Z,
            OpType.S,
            OpType.T,
            OpType.Rx,
            OpType.Ry,
            OpType.Rz,
            OpType.CX,
            OpType.CZ,
            OpType.SWAP,
        }
    ).apply(circuit)
    return _operations_from_pytket(circuit), _version("pytket")


def _pyzx_compile(
    qubit_count: int,
    operations: list[Op],
    level: int,
) -> tuple[list[Op], str]:
    del level  # PyZX exposes one full Clifford+T pipeline at this boundary.
    # In optimizers.py, PyZX sits behind its own ImportError guard: it lives in
    # the `zx` extra rather than in `optimizers` because it declares
    # `ipywidgets`, which drags ipython/pexpect/ptyprocess into the one image
    # the api and the worker both run from -- an image that holds credentials,
    # so it is kept minimal on purpose. That is the whole point of shipping this
    # kernel into the sandbox rootfs image instead: the sandbox holds no
    # credentials, so PyZX (like every other compiler SDK) is simply baked in
    # rather than gated behind an extra. A missing import here is a deployment
    # defect, not a packaging choice, and is handled uniformly for every
    # compiler by compile_operations' ImportError handler rather than by a
    # PyZX-specific one.
    import pyzx
    from qiskit import qasm2
    from qiskit.transpiler import generate_preset_pass_manager

    if qubit_count > 16 or len(operations) > 512:
        raise KernelError(
            "pyzx_budget_exceeded", "PyZX is limited to 16 qubits and 512 unitary operations."
        )
    for operation in operations:
        if operation.gate in _ROTATION_GATES:
            assert operation.angle_radians is not None
            quarter_turns = operation.angle_radians / (math.pi / 4)
            if not math.isclose(quarter_turns, round(quarter_turns), abs_tol=1e-10):
                raise KernelError(
                    "pyzx_requires_clifford_t",
                    "PyZX accepts only Clifford+T rotations (integer multiples of pi/4).",
                )

    source = _openqasm2(qubit_count, operations)
    source_circuit = pyzx.Circuit.from_qasm(source)
    optimized = pyzx.optimize.full_optimize(source_circuit, quiet=True)
    # PyZX deliberately exposes an exact ZX-diagram equality check. Refuse the
    # result when its own optimizer cannot prove the rewrite it just produced;
    # in particular this catches phase movement across some SWAP patterns. A
    # rejected optimization is safer than returning a smaller, wrong circuit.
    if not source_circuit.verify_equality(optimized):
        raise KernelError(
            "compiler_equivalence_check_failed",
            "PyZX could not confirm that its optimized circuit preserves the input.",
        )
    # PyZX emits standard OpenQASM 2. Qiskit's level-0 pass is only a strict
    # rebase into Studio's closed gate set; the optimization itself happened in
    # PyZX and no second optimization pass is applied here.
    imported = qasm2.loads(optimized.to_qasm())
    normalized = generate_preset_pass_manager(
        optimization_level=0,
        basis_gates=_QISKIT_BASIS,
        seed_transpiler=42,
    ).run(imported)
    return _operations_from_qiskit(normalized), _version("pyzx")


def _apply_operations(circuit: Any, operations: Iterable[Op], appliers: dict) -> None:
    for operation in operations:
        appliers[operation.gate](circuit, operation)


def _one(method: str) -> Callable[[Any, Op], None]:
    return lambda circuit, operation: getattr(circuit, method)(operation.qubits[0])


def _rotation(method: str, *, half_turns: bool = False):
    def apply(circuit: Any, operation: Op) -> None:
        assert operation.angle_radians is not None
        angle = operation.angle_radians / math.pi if half_turns else operation.angle_radians
        getattr(circuit, method)(angle, operation.qubits[0])

    return apply


def _two(method: str):
    return lambda circuit, operation: getattr(circuit, method)(*operation.qubits)


_QISKIT_APPLIERS = {
    Gate.H: _one("h"),
    Gate.X: _one("x"),
    Gate.Y: _one("y"),
    Gate.Z: _one("z"),
    Gate.S: _one("s"),
    Gate.T: _one("t"),
    Gate.RX: _rotation("rx"),
    Gate.RY: _rotation("ry"),
    Gate.RZ: _rotation("rz"),
    Gate.CX: _two("cx"),
    Gate.CZ: _two("cz"),
    Gate.SWAP: _two("swap"),
}

_PYTKET_APPLIERS = {
    Gate.H: _one("H"),
    Gate.X: _one("X"),
    Gate.Y: _one("Y"),
    Gate.Z: _one("Z"),
    Gate.S: _one("S"),
    Gate.T: _one("T"),
    Gate.RX: _rotation("Rx", half_turns=True),
    Gate.RY: _rotation("Ry", half_turns=True),
    Gate.RZ: _rotation("Rz", half_turns=True),
    Gate.CX: _two("CX"),
    Gate.CZ: _two("CZ"),
    Gate.SWAP: _two("SWAP"),
}


def _cirq_operation(operation: Op, qubits: list[Any], cirq: Any) -> Any:
    selected = [qubits[index] for index in operation.qubits]
    fixed = {
        Gate.H: cirq.H,
        Gate.X: cirq.X,
        Gate.Y: cirq.Y,
        Gate.Z: cirq.Z,
        Gate.S: cirq.S,
        Gate.T: cirq.T,
        Gate.CX: cirq.CNOT,
        Gate.CZ: cirq.CZ,
        Gate.SWAP: cirq.SWAP,
    }
    if operation.gate in _ROTATION_GATES:
        assert operation.angle_radians is not None
        return getattr(cirq, operation.gate.value.lower())(operation.angle_radians)(selected[0])
    return fixed[operation.gate].on(*selected)


def _operations_from_cirq(circuit: Any, cirq: Any) -> list[Op]:
    result: list[Op] = []
    for operation in circuit.all_operations():
        result.extend(_studio_operations_from_cirq_operation(operation, cirq))
    return result


def _studio_operations_from_cirq_operation(operation: Any, cirq: Any):
    gate = operation.gate
    qubits = [int(qubit.x) for qubit in operation.qubits]
    if isinstance(gate, cirq.IdentityGate):
        return []
    if isinstance(gate, cirq.PhasedXZGate) or isinstance(gate, cirq.PhasedXPowGate):
        decomposed = cirq.decompose_once(operation, default=None)
        if decomposed is None:
            raise KernelError(
                "compiler_output_unsupported", "Cirq could not decompose a phased rotation."
            )
        result: list[Op] = []
        for child in decomposed:
            result.extend(_studio_operations_from_cirq_operation(child, cirq))
        return result
    rotations = {
        cirq.XPowGate: Gate.RX,
        cirq.YPowGate: Gate.RY,
        cirq.ZPowGate: Gate.RZ,
    }
    for gate_type, studio_gate in rotations.items():
        if isinstance(gate, gate_type):
            angle = _normalized_rotation(float(gate.exponent) * math.pi)
            if math.isclose(angle, 0.0, abs_tol=1e-10):
                return []
            return [
                Op(
                    gate=studio_gate,
                    qubits=qubits,
                    angle_radians=angle,
                )
            ]
    if isinstance(gate, cirq.CZPowGate) and math.isclose(
        float(gate.exponent) % 2, 1.0, abs_tol=1e-10
    ):
        return [Op(gate=Gate.CZ, qubits=qubits)]
    raise KernelError(
        "compiler_output_unsupported",
        f"Compiler emitted unsupported Cirq gate {type(gate).__name__}.",
    )


def _normalized_rotation(angle: float) -> float:
    normalized = (angle + math.pi) % (2 * math.pi) - math.pi
    return 0.0 if math.isclose(normalized, 0.0, abs_tol=1e-12) else normalized


def _pennylane_operation(operation: Op, qml: Any) -> Any:
    wires: int | list[int] = operation.qubits[0] if len(operation.qubits) == 1 else operation.qubits
    constructors = {
        Gate.H: qml.Hadamard,
        Gate.X: qml.PauliX,
        Gate.Y: qml.PauliY,
        Gate.Z: qml.PauliZ,
        Gate.S: qml.S,
        Gate.T: qml.T,
        Gate.CX: qml.CNOT,
        Gate.CZ: qml.CZ,
        Gate.SWAP: qml.SWAP,
    }
    if operation.gate in _ROTATION_GATES:
        assert operation.angle_radians is not None
        return getattr(qml, operation.gate.value)(operation.angle_radians, wires=wires)
    return constructors[operation.gate](wires=wires)


_PENNYLANE_TO_GATE = {
    "Hadamard": Gate.H,
    "PauliX": Gate.X,
    "PauliY": Gate.Y,
    "PauliZ": Gate.Z,
    "S": Gate.S,
    "T": Gate.T,
    "RX": Gate.RX,
    "RY": Gate.RY,
    "RZ": Gate.RZ,
    "CNOT": Gate.CX,
    "CZ": Gate.CZ,
    "SWAP": Gate.SWAP,
}


def _operations_from_pennylane(operations: Iterable[Any]) -> list[Op]:
    result: list[Op] = []
    for operation in operations:
        gate = _PENNYLANE_TO_GATE.get(operation.name)
        if gate is None:
            raise KernelError(
                "compiler_output_unsupported",
                f"Compiler emitted unsupported PennyLane gate {operation.name}.",
            )
        angle = float(operation.parameters[0]) if gate in _ROTATION_GATES else None
        result.append(
            Op(
                gate=gate,
                qubits=[int(wire) for wire in operation.wires],
                angle_radians=angle,
            )
        )
    return result


_QISKIT_TO_GATE = {gate.value.lower(): gate for gate in Gate if gate.value != "M"}


def _operations_from_qiskit(circuit: Any, *, restore_output_permutation: bool = False) -> list[Op]:
    result: list[Op] = []
    for instruction in circuit.data:
        name = instruction.operation.name
        if name == "barrier" or name == "id":
            continue
        gate = _QISKIT_TO_GATE.get(name)
        if gate is None:
            raise KernelError(
                "compiler_output_unsupported", f"Compiler emitted unsupported Qiskit gate {name}."
            )
        qubits = [circuit.find_bit(qubit).index for qubit in instruction.qubits]
        angle = float(instruction.operation.params[0]) if gate in _ROTATION_GATES else None
        result.append(Op(gate=gate, qubits=qubits, angle_radians=angle))
    if restore_output_permutation:
        result.extend(_qiskit_output_permutation_correction(circuit))
    return result


def _qiskit_output_permutation_correction(circuit: Any) -> list[Op]:
    """Materialize Qiskit's virtual output permutation as Studio SWAPs.

    Preset pass managers at levels 2 and 3 may elide SWAP gates and represent
    their effect only in ``TranspileLayout.final_layout``. That is valid for a
    backend-aware caller that reads the layout, but Studio stores only logical
    gate operations. Appending this permutation restores logical qubit ``i`` to
    output wire ``i`` and prevents a silent change in circuit meaning.
    """

    layout = getattr(circuit, "layout", None)
    if layout is None:
        return []
    logical_to_output = list(layout.final_index_layout(filter_ancillas=True))
    if sorted(logical_to_output) != list(range(len(logical_to_output))):
        raise KernelError(
            "compiler_output_unsupported", "Qiskit returned a non-permutation output layout."
        )
    logical_at_output = [0] * len(logical_to_output)
    for logical, output in enumerate(logical_to_output):
        logical_at_output[output] = logical
    corrections: list[Op] = []
    for output in range(len(logical_at_output)):
        if logical_at_output[output] == output:
            continue
        partner = logical_at_output.index(output)
        corrections.append(
            Op(
                gate=Gate.SWAP,
                qubits=[output, partner],
            )
        )
        logical_at_output[output], logical_at_output[partner] = (
            logical_at_output[partner],
            logical_at_output[output],
        )
    return corrections


_PYTKET_TO_GATE = {
    "H": Gate.H,
    "X": Gate.X,
    "Y": Gate.Y,
    "Z": Gate.Z,
    "S": Gate.S,
    "T": Gate.T,
    "Rx": Gate.RX,
    "Ry": Gate.RY,
    "Rz": Gate.RZ,
    "CX": Gate.CX,
    "CZ": Gate.CZ,
    "SWAP": Gate.SWAP,
}


def _operations_from_pytket(circuit: Any) -> list[Op]:
    result: list[Op] = []
    for command in circuit.get_commands():
        name = command.op.type.name
        gate = _PYTKET_TO_GATE.get(name)
        if gate is None:
            raise KernelError(
                "compiler_output_unsupported", f"Compiler emitted unsupported pytket gate {name}."
            )
        angle = float(command.op.params[0]) * math.pi if gate in _ROTATION_GATES else None
        result.append(
            Op(
                gate=gate,
                qubits=[int(qubit.index[0]) for qubit in command.qubits],
                angle_radians=angle,
            )
        )
    return result


def _openqasm2(qubit_count: int, operations: Iterable[Op]) -> str:
    lines = ["OPENQASM 2.0;", 'include "qelib1.inc";', f"qreg q[{qubit_count}];"]
    for operation in operations:
        name = operation.gate.value.lower()
        operands = ",".join(f"q[{qubit}]" for qubit in operation.qubits)
        if operation.gate in _ROTATION_GATES:
            assert operation.angle_radians is not None
            lines.append(f"{name}({operation.angle_radians:.17g}) {operands};")
        else:
            lines.append(f"{name} {operands};")
    return "\n".join(lines) + "\n"


def _version(distribution: str) -> str:
    return importlib.metadata.version(distribution)


_COMPILERS: dict[
    Compiler,
    Callable[[int, list[Op], int], tuple[list[Op], str]],
] = {
    Compiler.QISKIT: _qiskit_compile,
    Compiler.CIRQ: _cirq_compile,
    Compiler.PYTKET: _pytket_compile,
    Compiler.PENNYLANE: _pennylane_compile,
    Compiler.PYZX: _pyzx_compile,
    Compiler.BQSKIT: _bqskit_compile_native,
}


def _decode_operation(entry: Any) -> Op:
    """Decode one wire-format operation dict into an ``Op``, or refuse it.

    ``optimizers.py`` receives already-validated ``CircuitOptimizationOperation``
    instances straight from pydantic. The kernel receives plain JSON off the wire,
    so this repeats pydantic's arity/distinctness/angle-presence checks
    (``CircuitOptimizationOperation.gate_shape_matches_arity``) by hand instead of
    inheriting them for free.
    """
    try:
        gate = Gate(entry["gate"])
        qubits = [int(qubit) for qubit in entry["qubits"]]
        raw_angle = entry.get("angle_radians")
        angle_radians = None if raw_angle is None else float(raw_angle)
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise KernelError(
            "compiler_failed", f"malformed compiler operation entry ({type(exc).__name__})."
        ) from exc
    expected = 2 if gate in _TWO_QUBIT_GATES else 1
    if len(qubits) != expected:
        raise KernelError("compiler_failed", f"{gate.value} requires {expected} qubit(s).")
    if len(set(qubits)) != len(qubits) or any(qubit < 0 for qubit in qubits):
        raise KernelError(
            "compiler_failed", "operation qubits must be distinct non-negative integers."
        )
    if (gate in _ROTATION_GATES) != (angle_radians is not None):
        raise KernelError("compiler_failed", "only RX, RY, and RZ require angle_radians.")
    return Op(gate=gate, qubits=qubits, angle_radians=angle_radians)


def compile_operations(payload: dict) -> dict:
    """Run one compiler over a decoded payload and return a JSON-ready dict."""
    compiler_value = payload.get("compiler")
    try:
        compiler = Compiler(compiler_value)
        qubit_count = int(payload["qubit_count"])
        optimization_level = int(payload["optimization_level"])
        operations = [_decode_operation(entry) for entry in payload["operations"]]
        compile_fn = _COMPILERS[compiler]
        optimized, version = compile_fn(qubit_count, operations, optimization_level)
    except KernelError as err:
        return {"ok": False, "code": err.code, "message": str(err)}
    except ImportError:
        # This kernel's source ships independently of the sandbox rootfs image
        # (built by infra/sandbox/Dockerfile) that supplies the SDKs it imports
        # lazily above. That image's `latest` tag is moved by a deliberate human
        # step (docs/runbooks/sandbox-image.md), never by merging this file, so
        # there is a real window where this code is deployed but the image is
        # not: a compiler is selectable here before its SDK is actually baked
        # in. PR #262 hit exactly that window and it surfaced as a bare
        # ModuleNotFoundError inside the sandbox for every user for a day.
        # Catching ImportError (which covers ModuleNotFoundError) and naming it
        # compiler_unavailable makes that window say what it is instead of
        # reading as a bug in the compiler adapter itself.
        return {
            "ok": False,
            "code": "compiler_unavailable",
            "message": f"The {compiler_value} compiler is not installed in this sandbox image.",
        }
    except Exception as exc:
        return {
            "ok": False,
            "code": "compiler_failed",
            "message": f"{compiler_value} could not compile this circuit ({type(exc).__name__}).",
        }
    return {
        "ok": True,
        "operations": [op.to_dict() for op in optimized],
        "version": version,
    }


def _main() -> None:
    """Entry point when this file runs as the sandbox's ``main.py``.

    ``LEONA_TRUSTED_PAYLOAD`` (a JSON string) and ``LEONA_TRUSTED_RESULT_PATH``
    (a filesystem path string) are module globals the control plane prepends ahead
    of this source before shipping it into the sandbox -- they are not defined
    anywhere in this file itself, only referenced here. Nothing is ever printed to
    stdout: the payload and any traceback stay out of the sandbox's captured
    output, and the only channel back to the control plane is the result file.
    """
    result_path = LEONA_TRUSTED_RESULT_PATH  # noqa: F821
    try:
        payload = json.loads(LEONA_TRUSTED_PAYLOAD)  # noqa: F821
        result = compile_operations(payload)
    except Exception as exc:
        result = {"ok": False, "code": "compiler_internal_error", "message": type(exc).__name__}
    with open(result_path, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(result))


# NO `if __name__ == "__main__": _main()` HERE, ON PURPOSE.
#
# `majorana_sandbox.compose_trusted` appends the call itself, after the two
# globals `_main` reads. A guard here would fire BEFORE those assignments and
# die on a NameError outside `_main`'s own try — so the control plane would find
# no sidecar and report an internal error for a compile that never started. Its
# absence is also what keeps `import optimizer_kernel` side-effect free for the
# tests in `test_optimizers.py`, which is the other half of why this file has to
# work both ways.
