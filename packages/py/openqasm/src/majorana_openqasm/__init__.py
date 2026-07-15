"""OpenQASM-native circuit boundary.

New artifacts persist normalized OpenQASM 3. Qiskit ``QuantumCircuit`` objects
exist only while parsing, verifying, compiling, or calculating metrics.
"""

from majorana_openqasm.program import (
    CompilationOutcome,
    OpenQASMError,
    compile_program,
    detect_version,
    fingerprint,
    load_circuit,
    normalize,
    resource_metrics,
)

__all__ = [
    "CompilationOutcome",
    "OpenQASMError",
    "compile_program",
    "detect_version",
    "fingerprint",
    "load_circuit",
    "normalize",
    "resource_metrics",
]
