"""Framework adapters for the native source-code pipeline.

Adapters keep SDK-specific syntax and observation behavior out of the worker. Adding a
framework means implementing this boundary; the pipeline stages do not branch on SDKs.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal, Protocol

from majorana_contracts.enums import Framework
from majorana_contracts.models import ResourceMetrics

INTERCHANGE_QASM_BEGIN = "__MAJORANA_INTERCHANGE_QASM_BEGIN__"
INTERCHANGE_QASM_END = "__MAJORANA_INTERCHANGE_QASM_END__"
INTERCHANGE_QASM_ERROR = "__MAJORANA_INTERCHANGE_QASM_ERROR__"

_FINAL_CIRCUIT_RE = re.compile(r"(?m)^\s*FINAL_CIRCUIT\s*=")
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

    def native_optimization(self, source: str) -> NativeOptimization: ...

    def resource_metrics(
        self, source: str, *, qubits: int, expected_runtime_sec: int
    ) -> ResourceMetrics: ...

    def instrument_for_interchange(self, source: str, *, circuit_expected: bool) -> str: ...


@dataclass(frozen=True)
class PythonFrameworkAdapter:
    framework: Framework
    optimization_pattern: re.Pattern[str]
    operation_pattern: re.Pattern[str]

    def contract_diagnostics(self, source: str, *, circuit_expected: bool) -> list[str]:
        if not circuit_expected or _FINAL_CIRCUIT_RE.search(source):
            return []
        return [f"contract:{self.framework.value} circuit code must bind FINAL_CIRCUIT"]

    def native_optimization(self, source: str) -> NativeOptimization:
        if self.optimization_pattern.search(source):
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
        self, source: str, *, qubits: int, expected_runtime_sec: int
    ) -> ResourceMetrics:
        operations = self.operation_pattern.findall(source)
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

    def instrument_for_interchange(self, source: str, *, circuit_expected: bool) -> str:
        return source


class QiskitAdapter(PythonFrameworkAdapter):
    def instrument_for_interchange(self, source: str, *, circuit_expected: bool) -> str:
        if not circuit_expected:
            return source
        return f'''{source}

# Optional interchange observation. The selected-framework source above remains
# authoritative; this payload is used only by explicit framework conversion paths.
_majorana_final_circuit = globals().get("FINAL_CIRCUIT")
if _majorana_final_circuit is not None:
    try:
        from qiskit.qasm3 import dumps as _majorana_interchange_dumps
        _majorana_interchange_qasm = _majorana_interchange_dumps(_majorana_final_circuit)
    except Exception as _majorana_interchange_exc:
        print("{INTERCHANGE_QASM_ERROR}:" + type(_majorana_interchange_exc).__name__)
    else:
        print("{INTERCHANGE_QASM_BEGIN}")
        print(_majorana_interchange_qasm)
        print("{INTERCHANGE_QASM_END}")
'''


_ADAPTERS: dict[Framework, FrameworkAdapter] = {
    Framework.QISKIT: QiskitAdapter(
        framework=Framework.QISKIT,
        optimization_pattern=re.compile(r"\btranspile\s*\("),
        operation_pattern=re.compile(
            r"\.(x|y|z|h|s|t|rx|ry|rz|u|reset|cx|cz|swap|cp|ccx|cswap|measure|measure_all)\s*\("
        ),
    ),
    Framework.CIRQ: PythonFrameworkAdapter(
        framework=Framework.CIRQ,
        optimization_pattern=re.compile(
            r"\b(?:cirq\.)?(?:optimize_for_target_gateset|transformers\.)"
        ),
        operation_pattern=re.compile(
            r"\bcirq\.(X|Y|Z|H|S|T|rx|ry|rz|CNOT|CZ|SWAP|CCX|CSWAP|measure)\s*\("
        ),
    ),
    Framework.PENNYLANE: PythonFrameworkAdapter(
        framework=Framework.PENNYLANE,
        optimization_pattern=re.compile(r"\b(?:qml|pennylane)\.(?:compile|transforms\.)"),
        operation_pattern=re.compile(
            r"\b(?:qml|pennylane)\."
            r"(PauliX|PauliY|PauliZ|Hadamard|S|T|RX|RY|RZ|CNOT|CZ|SWAP|Toffoli|CSWAP|measure)\s*\("
        ),
    ),
}


def adapter_for(framework: Framework) -> FrameworkAdapter:
    """Return the single adapter registered for a closed framework enum."""
    return _ADAPTERS[framework]
