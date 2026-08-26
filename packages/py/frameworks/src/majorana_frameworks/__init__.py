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

# `optimize_circuit` runs the compiler kernel IN THIS PROCESS and is a test/dev
# entry point only — production ships `optimizer_kernel` into the sandbox
# (ai-ops#186 option A). Nothing under `services/` imports it, and nothing
# under `services/` installs the SDKs it needs.
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
