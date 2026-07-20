"""Framework adapters for the native source-code pipeline."""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from majorana_contracts.enums import Framework
from majorana_contracts.models import ResourceMetrics

_TWO_QUBIT_OPERATIONS = {"cx", "cz", "swap", "cp", "CNOT", "CZ", "SWAP"}
_MEASUREMENT_OPERATIONS = {"measure", "measure_all"}


@dataclass(frozen=True)
class NativeOptimization:
    """Evidence that optimization is expressed in selected-framework source."""

    applied: bool
    mode: Literal["unchanged", "transpiled"]
    reason: str


class FrameworkAdapter(Protocol):
    framework: Framework

    def contract_diagnostics(self, source: str, *, circuit_expected: bool) -> list[str]: ...

    def native_optimization(
        self, source: str, observation: dict[str, Any] | None = None
    ) -> NativeOptimization: ...

    def resource_metrics(
        self,
        source: str,
        *,
        qubits: int,
        expected_runtime_sec: int,
        observation: dict[str, Any] | None = None,
    ) -> ResourceMetrics: ...

    def trusted_setup(self, *, circuit_expected: bool) -> str: ...

    def trusted_observer(self, source: str, *, circuit_expected: bool) -> str: ...


def _syntax(source: str) -> ast.Module | None:
    try:
        return ast.parse(source)
    except SyntaxError:
        return None


def _call_name(node: ast.Call) -> str | None:
    value: ast.expr = node.func
    parts: list[str] = []
    while isinstance(value, ast.Attribute):
        parts.append(value.attr)
        value = value.value
    if isinstance(value, ast.Name):
        parts.append(value.id)
        return ".".join(reversed(parts))
    return None


def _calls(source: str) -> list[str]:
    tree = _syntax(source)
    if tree is None:
        return []
    return [
        name for node in ast.walk(tree) if isinstance(node, ast.Call) and (name := _call_name(node))
    ]


def _binds_final_circuit(source: str) -> bool:
    tree = _syntax(source)
    if tree is None:
        return False
    for node in ast.walk(tree):
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, (ast.AnnAssign, ast.NamedExpr)):
            targets = [node.target]
        if any(isinstance(target, ast.Name) and target.id == "FINAL_CIRCUIT" for target in targets):
            return True
    return False


@dataclass(frozen=True)
class PythonFrameworkAdapter:
    framework: Framework
    optimization_calls: frozenset[str]
    operation_calls: frozenset[str]

    def contract_diagnostics(self, source: str, *, circuit_expected: bool) -> list[str]:
        if not circuit_expected or _binds_final_circuit(source):
            return []
        return [f"contract:{self.framework.value} circuit code must bind FINAL_CIRCUIT"]

    def native_optimization(
        self, source: str, observation: dict[str, Any] | None = None
    ) -> NativeOptimization:
        observed = observation.get("native_optimization") if observation else None
        applied = (
            observed.get("applied")
            if isinstance(observed, dict) and type(observed.get("applied")) is bool
            else any(name in self.optimization_calls for name in _calls(source))
        )
        if applied:
            return NativeOptimization(
                applied=True,
                mode="transpiled",
                reason=f"optimization is expressed and executed in {self.framework.value} source",
            )
        return NativeOptimization(
            applied=False,
            mode="unchanged",
            reason=(
                f"no safe {self.framework.value}-native optimization was present; "
                "verified source was retained"
            ),
        )

    def resource_metrics(
        self,
        source: str,
        *,
        qubits: int,
        expected_runtime_sec: int,
        observation: dict[str, Any] | None = None,
    ) -> ResourceMetrics:
        observed = observation.get("resource_metrics") if observation else None
        if isinstance(observed, dict):
            try:
                return ResourceMetrics.model_validate(observed)
            except (TypeError, ValueError):
                pass
        operations = [name.rsplit(".", 1)[-1] for name in _calls(source)]
        operations = [name for name in operations if name in self.operation_calls]
        return ResourceMetrics(
            qubits=qubits,
            depth=None,
            gate_count=sum(operation not in _MEASUREMENT_OPERATIONS for operation in operations),
            two_qubit_gate_count=sum(
                operation in _TWO_QUBIT_OPERATIONS for operation in operations
            ),
            measurement_count=sum(operation in _MEASUREMENT_OPERATIONS for operation in operations),
            estimated_runtime_ms=expected_runtime_sec * 1000,
        )

    def trusted_setup(self, *, circuit_expected: bool) -> str:
        return ""

    # `measurement_count` counts measured QUBITS, not measurement operations. Qiskit
    # makes those the same number — `qc.measure_all()` emits one instruction per
    # qubit — but Cirq's `cirq.measure(q0, q1)` is a SINGLE operation covering both,
    # and PennyLane's tape records one MeasurementProcess over several wires. Counting
    # operations therefore reported 1 for a fully measured 2-qubit Cirq circuit, and
    # the MEASURE_ALL policy check requires `measurement_count >= observed_qubits` —
    # so until 2026-07-20 no Cirq circuit could satisfy it, on any candidate, and the
    # run burned its whole budget on a check no repair could fix. Found by running a
    # Cirq Bell task against production and reading which check the best-effort
    # fallback named.
    def trusted_observer(self, source: str, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        optimized = any(name in self.optimization_calls for name in _calls(source))
        optimized_literal = "True" if optimized else "False"
        return f"""
_majorana_observation["native_optimization"] = {{"applied": {optimized_literal}}}
_majorana_final_circuit = _majorana_namespace.get("FINAL_CIRCUIT")
if _majorana_final_circuit is not None:
    try:
        if _majorana_hasattr(_majorana_final_circuit, "all_operations"):
            _majorana_operations = _majorana_list(_majorana_final_circuit.all_operations())
            _majorana_measurements = [
                op
                for op in _majorana_operations
                if "measure" in _majorana_type(_majorana_getattr(op, "gate", op)).__name__.lower()
            ]
            _majorana_gate_operations = [
                op for op in _majorana_operations if op not in _majorana_measurements
            ]
            _majorana_qubits = _majorana_len(_majorana_final_circuit.all_qubits())
            _majorana_depth = _majorana_len(_majorana_final_circuit)
        else:
            _majorana_tape = _majorana_getattr(_majorana_final_circuit, "tape", None)
            if _majorana_tape is None:
                _majorana_tape = _majorana_getattr(_majorana_final_circuit, "_tape", None)
            if _majorana_tape is None:
                _majorana_tape = _majorana_final_circuit
            _majorana_operations = _majorana_list(_majorana_getattr(_majorana_tape, "operations", []))
            _majorana_measurements = _majorana_list(_majorana_getattr(_majorana_tape, "measurements", []))
            _majorana_gate_operations = _majorana_operations
            _majorana_qubits = _majorana_len(_majorana_getattr(_majorana_tape, "wires", []))
            _majorana_depth = None
        _majorana_observation["resource_metrics"] = {{
            "qubits": _majorana_qubits,
            "depth": _majorana_depth,
            "gate_count": _majorana_len(_majorana_gate_operations),
            "two_qubit_gate_count": _majorana_sum(_majorana_len(_majorana_getattr(op, "qubits", _majorana_getattr(op, "wires", []))) == 2 for op in _majorana_gate_operations),
            "measurement_count": _majorana_sum(
                _majorana_len(_majorana_getattr(op, "qubits", _majorana_getattr(op, "wires", [])))
                or 1
                for op in _majorana_measurements
            ),
        }}
    except _majorana_exception:
        pass
"""


class QiskitAdapter(PythonFrameworkAdapter):
    def trusted_setup(self, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        return """_majorana_interchange_dumps = None
try:
    from qiskit.qasm3 import dumps as _majorana_interchange_dumps
except Exception:
    pass
"""

    def trusted_observer(self, source: str, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        optimized = any(name in self.optimization_calls for name in _calls(source))
        optimized_literal = "True" if optimized else "False"
        return f"""
_majorana_observation["native_optimization"] = {{"applied": {optimized_literal}}}
_majorana_final_circuit = _majorana_namespace.get("FINAL_CIRCUIT")
if _majorana_final_circuit is None:
    _majorana_observation["resource_metrics_error"] = (
        "FINAL_CIRCUIT was not set (missing or None) — bind it to the constructed circuit object"
    )
else:
    try:
        if _majorana_interchange_dumps is not None:
            _majorana_observation["interchange_qasm"] = _majorana_interchange_dumps(_majorana_final_circuit)
    except _majorana_exception as _majorana_interchange_exc:
        _majorana_observation["interchange_error"] = _majorana_type(_majorana_interchange_exc).__name__
    try:
        _majorana_ops = {{_majorana_str(k): _majorana_int(v) for k, v in _majorana_final_circuit.count_ops().items()}}
        _majorana_two_qubit_count = _majorana_sum(
            1
            for instruction in _majorana_final_circuit.data
            if _majorana_len(instruction.qubits) == 2
        )
        _majorana_observation["resource_metrics"] = {{
            "qubits": _majorana_int(_majorana_final_circuit.num_qubits),
            "depth": _majorana_int(_majorana_final_circuit.depth()),
            "gate_count": _majorana_sum(v for k, v in _majorana_ops.items() if k not in {{"measure"}}),
            "two_qubit_gate_count": _majorana_two_qubit_count,
            "measurement_count": _majorana_ops.get("measure", 0),
        }}
    except _majorana_exception as _majorana_metrics_exc:
        _majorana_observation["resource_metrics_error"] = (
            _majorana_type(_majorana_final_circuit).__name__
            + " has no usable circuit interface ("
            + _majorana_type(_majorana_metrics_exc).__name__
            + ") — FINAL_CIRCUIT must be bound to the actual circuit object, not a copy or a result dict"
        )
"""


class CirqAdapter(PythonFrameworkAdapter):
    def trusted_observer(self, source: str, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        base = super().trusted_observer(source, circuit_expected=circuit_expected)
        return (
            base
            + """
_majorana_final_circuit = _majorana_namespace.get("FINAL_CIRCUIT")
if _majorana_final_circuit is not None:
    try:
        _majorana_to_qasm = _majorana_getattr(_majorana_final_circuit, "to_qasm", None)
        if _majorana_to_qasm is not None:
            _majorana_observation["interchange_qasm"] = _majorana_to_qasm(version="3.0")
    except _majorana_exception as _majorana_interchange_exc:
        _majorana_observation["interchange_error"] = _majorana_type(_majorana_interchange_exc).__name__
"""
        )


class PennyLaneAdapter(PythonFrameworkAdapter):
    def trusted_setup(self, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        return """_majorana_interchange_dumps = None
try:
    from pennylane import to_openqasm as _majorana_interchange_dumps
except Exception:
    pass
"""

    def trusted_observer(self, source: str, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return ""
        base = super().trusted_observer(source, circuit_expected=circuit_expected)
        return (
            base
            + """
_majorana_final_circuit = _majorana_namespace.get("FINAL_CIRCUIT")
try:
    _majorana_interchange_dumps
except _majorana_exception:
    _majorana_interchange_dumps = None
if _majorana_final_circuit is not None and _majorana_interchange_dumps is not None:
    try:
        _majorana_tape = _majorana_getattr(_majorana_final_circuit, "tape", None)
        if _majorana_tape is None:
            _majorana_tape = _majorana_getattr(_majorana_final_circuit, "_tape", None)
        if _majorana_tape is None:
            _majorana_tape = _majorana_final_circuit
        _majorana_observation["interchange_qasm"] = _majorana_interchange_dumps(_majorana_tape)
    except _majorana_exception as _majorana_interchange_exc:
        _majorana_observation["interchange_error"] = _majorana_type(_majorana_interchange_exc).__name__
"""
        )


_ADAPTERS: dict[Framework, FrameworkAdapter] = {
    Framework.QISKIT: QiskitAdapter(
        framework=Framework.QISKIT,
        optimization_calls=frozenset({"transpile", "qiskit.transpile"}),
        operation_calls=frozenset(
            {
                "x",
                "y",
                "z",
                "h",
                "s",
                "t",
                "rx",
                "ry",
                "rz",
                "u",
                "reset",
                "cx",
                "cz",
                "swap",
                "cp",
                "ccx",
                "cswap",
                "measure",
                "measure_all",
            }
        ),
    ),
    Framework.CIRQ: CirqAdapter(
        framework=Framework.CIRQ,
        optimization_calls=frozenset({"cirq.optimize_for_target_gateset", "cirq.transformers"}),
        operation_calls=frozenset(
            {
                "X",
                "Y",
                "Z",
                "H",
                "S",
                "T",
                "rx",
                "ry",
                "rz",
                "CNOT",
                "CZ",
                "SWAP",
                "CCX",
                "CSWAP",
                "measure",
            }
        ),
    ),
    Framework.PENNYLANE: PennyLaneAdapter(
        framework=Framework.PENNYLANE,
        optimization_calls=frozenset({"qml.compile", "pennylane.compile"}),
        operation_calls=frozenset(
            {
                "PauliX",
                "PauliY",
                "PauliZ",
                "Hadamard",
                "S",
                "T",
                "RX",
                "RY",
                "RZ",
                "CNOT",
                "CZ",
                "SWAP",
                "Toffoli",
                "CSWAP",
                "measure",
            }
        ),
    ),
}


def adapter_for(framework: Framework) -> FrameworkAdapter:
    """Return the single adapter registered for a closed framework enum."""
    return _ADAPTERS[framework]
