"""OpenQASM 2 connector — the native canonical export path (CAPABILITY_MATRIX.md).
`from_openqasm` is how sandbox-emitted QASM becomes IR; `to_openqasm` renders IR
back. Ported from quepo `qhte.connectors.openqasm`."""

from __future__ import annotations

import ast
import math
import re
from typing import Any

from majorana_ir.canonical import canonicalize_circuit
from majorana_ir.models import Circuit, Operation, upgrade_to_v3

_QREG_RE = re.compile(r"qreg\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;")
_CREG_RE = re.compile(r"creg\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;")
_MEASURE_RE = re.compile(
    r"measure\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;"
)
_PARAM_GATE_RE = re.compile(
    r"(rx|ry|rz)\s*\(([^)]*)\)\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;",
    re.IGNORECASE,
)
_CP_RE = re.compile(
    r"cp\s*\(([^)]*)\)\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;",
    re.IGNORECASE,
)
_U_RE = re.compile(
    r"u\s*\(([^)]*),([^)]*),([^)]*)\)\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;",
    re.IGNORECASE,
)
_U2_RE = re.compile(
    r"u2\s*\(([^)]*),([^)]*)\)\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;",
    re.IGNORECASE,
)
_U3_RE = re.compile(
    r"u3\s*\(([^)]*),([^)]*),([^)]*)\)\s+([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]\s*;",
    re.IGNORECASE,
)
_GATE_RE = re.compile(r"([A-Za-z][A-Za-z0-9_]*)\s+(.+)\s*;")
_ARG_RE = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]")

_SUPPORTED_SIMPLE = {
    "x",
    "y",
    "z",
    "h",
    "s",
    "t",
    "cx",
    "cz",
    "swap",
    "ccx",
    "cswap",
    "barrier",
    "reset",
}


class OpenQASMError(ValueError):
    pass


def _strip_comments(text: str) -> list[str]:
    lines = []
    for line in text.splitlines():
        line = line.split("//", 1)[0].strip()
        if line:
            lines.append(line)
    return lines


def _safe_eval_numeric(expr: str) -> float | str:
    expression = expr.strip()
    try:
        tree = ast.parse(expression, mode="eval")
    except SyntaxError:
        return expression

    allowed_names = {"pi": math.pi, "tau": math.tau}
    allowed_nodes = (
        ast.Expression,
        ast.BinOp,
        ast.UnaryOp,
        ast.Add,
        ast.Sub,
        ast.Mult,
        ast.Div,
        ast.Pow,
        ast.USub,
        ast.UAdd,
        ast.Constant,
        ast.Name,
        ast.Load,
    )
    for node in ast.walk(tree):
        if not isinstance(node, allowed_nodes):
            return expression
        if isinstance(node, ast.Name) and node.id not in allowed_names:
            return expression
    try:
        return float(
            eval(compile(tree, "<qasm-param>", "eval"), {"__builtins__": {}}, allowed_names)
        )
    except Exception:
        return expression


def _parse_args(raw_args: str, qreg_name: str) -> list[int]:
    qubits: list[int] = []
    for raw_arg in raw_args.split(","):
        arg = raw_arg.strip()
        match = _ARG_RE.fullmatch(arg)
        if not match:
            raise OpenQASMError(f"unsupported qubit argument '{arg}'")
        register, index = match.groups()
        if register != qreg_name:
            raise OpenQASMError(f"only one qreg named {qreg_name!r} is supported")
        qubits.append(int(index))
    return qubits


def from_openqasm(text: str, metadata: dict[str, Any] | None = None) -> Circuit:
    qreg_name: str | None = None
    creg_name: str | None = None
    qubits: int | None = None
    classical_bits = 0
    operations: list[Operation] = []

    for line in _strip_comments(text):
        normalized = line.lower()
        if normalized.startswith("openqasm") or normalized.startswith("include"):
            continue
        if qreg_match := _QREG_RE.fullmatch(line):
            qreg_name, size = qreg_match.groups()
            qubits = int(size)
            continue
        if creg_match := _CREG_RE.fullmatch(line):
            creg_name, size = creg_match.groups()
            classical_bits = int(size)
            continue
        if qubits is None or qreg_name is None:
            raise OpenQASMError("qreg must be declared before operations")
        if measure_match := _MEASURE_RE.fullmatch(line):
            qregister, qindex, cregister, cindex = measure_match.groups()
            if qregister != qreg_name:
                raise OpenQASMError(f"unknown qreg '{qregister}'")
            if creg_name is None or cregister != creg_name:
                raise OpenQASMError(f"unknown creg '{cregister}'")
            operations.append(Operation(gate="measure", qubits=[int(qindex)], clbits=[int(cindex)]))
            continue
        if param_match := _PARAM_GATE_RE.fullmatch(line):
            gate, param, register, index = param_match.groups()
            if register != qreg_name:
                raise OpenQASMError(f"unknown qreg '{register}'")
            operations.append(
                Operation(
                    gate=gate.lower(), qubits=[int(index)], params=[_safe_eval_numeric(param)]
                )
            )
            continue
        if cp_match := _CP_RE.fullmatch(line):
            param, left_register, left_index, right_register, right_index = cp_match.groups()
            if left_register != qreg_name or right_register != qreg_name:
                raise OpenQASMError("cp currently supports one qreg")
            operations.append(
                Operation(
                    gate="cp",
                    qubits=[int(left_index), int(right_index)],
                    params=[_safe_eval_numeric(param)],
                )
            )
            continue
        if u2_match := _U2_RE.fullmatch(line):
            phi, lam, register, index = u2_match.groups()
            if register != qreg_name:
                raise OpenQASMError(f"unknown qreg '{register}'")
            operations.append(
                Operation(
                    gate="u",
                    qubits=[int(index)],
                    params=[math.pi / 2, _safe_eval_numeric(phi), _safe_eval_numeric(lam)],
                )
            )
            continue
        if u3_match := _U3_RE.fullmatch(line):
            theta, phi, lam, register, index = u3_match.groups()
            if register != qreg_name:
                raise OpenQASMError(f"unknown qreg '{register}'")
            operations.append(
                Operation(
                    gate="u",
                    qubits=[int(index)],
                    params=[
                        _safe_eval_numeric(theta),
                        _safe_eval_numeric(phi),
                        _safe_eval_numeric(lam),
                    ],
                )
            )
            continue
        if u_match := _U_RE.fullmatch(line):
            theta, phi, lam, register, index = u_match.groups()
            if register != qreg_name:
                raise OpenQASMError(f"unknown qreg '{register}'")
            operations.append(
                Operation(
                    gate="u",
                    qubits=[int(index)],
                    params=[
                        _safe_eval_numeric(theta),
                        _safe_eval_numeric(phi),
                        _safe_eval_numeric(lam),
                    ],
                )
            )
            continue
        if gate_match := _GATE_RE.fullmatch(line):
            gate, raw_args = gate_match.groups()
            gate = gate.lower()
            if gate not in _SUPPORTED_SIMPLE:
                raise OpenQASMError(f"unsupported gate '{gate}'")
            operations.append(Operation(gate=gate, qubits=_parse_args(raw_args, qreg_name)))
            continue
        raise OpenQASMError(f"unsupported OpenQASM statement: {line}")

    if qubits is None:
        raise OpenQASMError("missing qreg declaration")
    return canonicalize_circuit(
        upgrade_to_v3(
            Circuit(
                qubits=qubits,
                classical_bits=classical_bits,
                operations=operations,
                metadata=metadata or {},
            )
        )
    )


def _format_param(param: float | str) -> str:
    if isinstance(param, float):
        return format(param, ".15g")
    return str(param)


def to_openqasm(circuit: Circuit) -> str:
    circuit = canonicalize_circuit(circuit)
    lines = [
        "OPENQASM 2.0;",
        'include "qelib1.inc";',
        f"qreg q[{circuit.qubits}];",
    ]
    if circuit.classical_bits:
        lines.append(f"creg c[{circuit.classical_bits}];")

    for operation in circuit.operations:
        if operation.gate == "measure":
            lines.append(f"measure q[{operation.qubits[0]}] -> c[{operation.clbits[0]}];")
        elif operation.gate in {"rx", "ry", "rz"}:
            lines.append(
                f"{operation.gate}({_format_param(operation.params[0])}) q[{operation.qubits[0]}];"
            )
        elif operation.gate == "cp":
            lines.append(
                f"cp({_format_param(operation.params[0])}) "
                f"q[{operation.qubits[0]}],q[{operation.qubits[1]}];"
            )
        elif operation.gate == "u":
            params = ",".join(_format_param(param) for param in operation.params)
            lines.append(f"u({params}) q[{operation.qubits[0]}];")
        else:
            args = ",".join(f"q[{qubit}]" for qubit in operation.qubits)
            lines.append(f"{operation.gate} {args};")
    return "\n".join(lines) + "\n"


def to_openqasm3(circuit: Circuit) -> str:
    """Render the narrow canonical circuit as native OpenQASM 3.0."""
    circuit = canonicalize_circuit(circuit)
    lines = [
        "OPENQASM 3.0;",
        'include "stdgates.inc";',
        f"qubit[{circuit.qubits}] q;",
    ]
    if circuit.classical_bits:
        lines.append(f"bit[{circuit.classical_bits}] c;")

    for operation in circuit.operations:
        if operation.gate == "measure":
            lines.append(f"c[{operation.clbits[0]}] = measure q[{operation.qubits[0]}];")
        elif operation.gate in {"rx", "ry", "rz", "cp"}:
            params = ", ".join(_format_param(param) for param in operation.params)
            args = ", ".join(f"q[{qubit}]" for qubit in operation.qubits)
            lines.append(f"{operation.gate}({params}) {args};")
        elif operation.gate == "u":
            params = ", ".join(_format_param(param) for param in operation.params)
            lines.append(f"U({params}) q[{operation.qubits[0]}];")
        elif operation.gate == "barrier":
            args = ", ".join(f"q[{qubit}]" for qubit in operation.qubits)
            lines.append(f"barrier {args};")
        else:
            args = ", ".join(f"q[{qubit}]" for qubit in operation.qubits)
            lines.append(f"{operation.gate} {args};")
    return "\n".join(lines) + "\n"
