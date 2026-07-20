"""OpenQASM interchange ingestion and normalization through Qiskit."""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from majorana_contracts.models import ResourceMetrics
from qiskit import QuantumCircuit
from qiskit import qasm2, qasm3

# The declaration must be the first *statement*, but comments and blank lines may
# precede it — the OpenQASM grammar allows a comment anywhere, and real emitters
# put a provenance header there. Cirq is the case that forced this: every Cirq
# circuit serializes as
#
#     // Generated from Cirq v1.7.0
#
#     OPENQASM 2.0;
#
# so with a start-anchored match, EVERY Cirq run's interchange QASM was rejected
# as "missing OPENQASM 2.0 or 3.0 declaration". That silently cost Cirq both the
# `exact` and the Born-distribution `statistical` check — a live 2026-07-20 Cirq
# Bell run failed `exact` on all four candidates for this reason and nothing else.
_COMMENT_PREFIX_RE = re.compile(r"\s*(?:(?://[^\n]*|/\*.*?\*/)\s*)*", re.DOTALL)
_VERSION_RE = re.compile(r"OPENQASM\s+(?P<version>[23](?:\.0)?)\s*;", re.IGNORECASE)


class OpenQASMError(ValueError):
    """The program is invalid or cannot be represented by the SDK boundary."""


def detect_version(source: str) -> Literal["2.0", "3.0"]:
    """Return the declared supported OpenQASM version, skipping a comment header."""
    match = _VERSION_RE.match(source, _COMMENT_PREFIX_RE.match(source).end())
    if match is None:
        raise OpenQASMError("missing OPENQASM 2.0 or 3.0 declaration")
    return "2.0" if match.group("version").startswith("2") else "3.0"


def _load_circuit(source: str) -> QuantumCircuit:
    """Parse OpenQASM 2/3 using Qiskit's maintained importers."""
    try:
        if detect_version(source) == "2.0":
            return qasm2.loads(
                source,
                strict=True,
                custom_instructions=qasm2.LEGACY_CUSTOM_INSTRUCTIONS,
            )
        return qasm3.loads(source)
    except Exception as exc:
        raise OpenQASMError(str(exc)) from exc


def normalize(source: str) -> str:
    """Return normalized OpenQASM 3 for optional interchange persistence."""
    try:
        return qasm3.dumps(_load_circuit(source))
    except OpenQASMError:
        raise
    except Exception as exc:
        raise OpenQASMError(str(exc)) from exc


def fingerprint(source: str) -> str:
    """Hash the normalized OpenQASM 3 representation."""
    return hashlib.sha256(normalize(source).encode("utf-8")).hexdigest()


def _resource_metrics(circuit: QuantumCircuit) -> ResourceMetrics:
    operations = circuit.count_ops()
    measurements = int(operations.get("measure", 0))
    gate_count = max(0, circuit.size() - measurements)
    two_qubit = sum(
        1
        for instruction in circuit.data
        if instruction.operation.name != "measure" and len(instruction.qubits) == 2
    )
    return ResourceMetrics(
        qubits=circuit.num_qubits,
        depth=circuit.depth(),
        gate_count=gate_count,
        two_qubit_gate_count=two_qubit,
        measurement_count=measurements,
    )


def resource_metrics(source: str) -> ResourceMetrics:
    """Calculate resource metrics from an OpenQASM string."""
    return _resource_metrics(_load_circuit(source))
