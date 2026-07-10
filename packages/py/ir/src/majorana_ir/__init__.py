"""majorana-ir — canonical circuit IR, framework connectors, export classification.

Salvaged and renamespaced from the quepo `qhte` engine (plans/rebuild/08-phases.md
§Phase 2 step 5). Pure Python + pydantic; the qiskit object-import path imports
qiskit lazily (extra `majorana-ir[qiskit]`)."""

from majorana_ir.canonical import (
    canonical_dict,
    canonical_json,
    canonicalize_circuit,
    circuit_fingerprint,
)
from majorana_ir.export import ExportClassification, classify_export
from majorana_ir.models import (
    IR_VERSION,
    IR_VERSION_TAG,
    Circuit,
    DecompositionRecord,
    GateDefinition,
    MeasurementSemantics,
    Operation,
    ParameterValue,
    Register,
    ValidationResult,
    parameter_value,
    upgrade_to_v3,
    validate_circuit,
)

__all__ = [
    "IR_VERSION",
    "IR_VERSION_TAG",
    "Circuit",
    "Operation",
    "ParameterValue",
    "Register",
    "MeasurementSemantics",
    "DecompositionRecord",
    "GateDefinition",
    "ValidationResult",
    "canonical_dict",
    "canonical_json",
    "canonicalize_circuit",
    "circuit_fingerprint",
    "validate_circuit",
    "parameter_value",
    "upgrade_to_v3",
    "ExportClassification",
    "classify_export",
]
