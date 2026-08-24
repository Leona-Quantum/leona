"""Framework-native circuit program boundary."""

from majorana_frameworks.adapters import NativeOptimization
from majorana_frameworks.circuit_ir import (
    CIRCUIT_IR_SCHEMA,
    CIRCUIT_IR_VERSION,
    CircuitIRExtraction,
    build_circuit_ir,
    extract_circuit_ir,
    validate_circuit_ir,
)
from majorana_frameworks.program import (
    FrameworkProgram,
    InterchangeExtraction,
    extract_interchange_qasm,
)
from majorana_frameworks.optimizers import CircuitOptimizationError, optimize_circuit

__all__ = [
    "FrameworkProgram",
    "InterchangeExtraction",
    "NativeOptimization",
    "CIRCUIT_IR_SCHEMA",
    "CIRCUIT_IR_VERSION",
    "CircuitIRExtraction",
    "CircuitOptimizationError",
    "build_circuit_ir",
    "extract_circuit_ir",
    "extract_interchange_qasm",
    "optimize_circuit",
    "validate_circuit_ir",
]
