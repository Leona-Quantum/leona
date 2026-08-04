"""OpenQASM interchange ingestion and normalization through Qiskit."""

from __future__ import annotations

import hashlib
import re
from typing import Literal

from majorana_contracts.models import ResourceMetrics
from qiskit import QuantumCircuit
from qiskit import qasm2, qasm3

from majorana_openqasm.non_clifford import NonCliffordCost
from majorana_openqasm.non_clifford import non_clifford_cost as _non_clifford_cost

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


#: Ceiling on the total qubits a submitted program may DECLARE.
#:
#: The 100 KB byte limit on the route bounds the source, and does not bound the
#: work: `qreg q[100000000];` is nineteen characters and asks Qiskit to
#: allocate a hundred million qubits before this module ever sees a circuit
#: object. Byte limits cannot catch that class at all, because the amplification
#: is in the integer, so the register width has to be read out of the source and
#: refused BEFORE the parser is handed the program.
#:
#: 4096 is far above anything reachable here — the sandbox lane's pre-flight
#: ceiling is 27 qubits by default (05-security.md §1), and the largest circuit
#: in the published corpus declares 12. It is set this high deliberately: this
#: is the memory-bomb guard, not the product's qubit policy, and the two should
#: not be one number that gets tuned for the wrong reason.
MAX_DECLARED_QUBITS = 4096

#: Ceiling on gate-carrying statements. 100 KB of `cx q[0],q[1];` is roughly
#: 8,000 statements, so at 50,000 this refuses only a program that arrived
#: under a raised byte limit — it is the backstop that keeps the two limits
#: from having to be reasoned about together.
MAX_STATEMENTS = 50_000

#: `qreg q[N]` (OpenQASM 2) and `qubit[N] q` / `qubit q` (OpenQASM 3).
_QREG_RE = re.compile(r"\bqreg\s+\w+\s*\[\s*(\d+)\s*\]", re.IGNORECASE)
_QUBIT_ARRAY_RE = re.compile(r"\bqubit\s*\[\s*(\d+)\s*\]", re.IGNORECASE)
_QUBIT_SINGLE_RE = re.compile(r"\bqubit\s+\w+\s*;", re.IGNORECASE)


def _assert_within_caps(source: str) -> None:
    """Refuse a program whose declared size would be expensive merely to parse.

    Runs on the SOURCE, before Qiskit. Checking `circuit.num_qubits` after the
    fact would be checking the allocation we were trying not to make.

    Counts are deliberately read with regular expressions rather than by parsing
    — a parser is the thing being protected. Over-counting is the safe
    direction: the ceiling is two orders of magnitude above real use, so a
    comment that happens to contain `qreg q[8]` costs nothing, while
    under-counting would be a hole.
    """
    declared = sum(int(n) for n in _QREG_RE.findall(source))
    declared += sum(int(n) for n in _QUBIT_ARRAY_RE.findall(source))
    declared += len(_QUBIT_SINGLE_RE.findall(source))
    if declared > MAX_DECLARED_QUBITS:
        raise OpenQASMError(
            f"program declares {declared} qubits; the limit is {MAX_DECLARED_QUBITS}"
        )
    statements = source.count(";")
    if statements > MAX_STATEMENTS:
        raise OpenQASMError(f"program has {statements} statements; the limit is {MAX_STATEMENTS}")


def _load_circuit(source: str) -> QuantumCircuit:
    """Parse OpenQASM 2/3 using Qiskit's maintained importers."""
    _assert_within_caps(source)
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


def non_clifford_cost(source: str) -> NonCliffordCost:
    """Extract the magic-state cost of an OpenQASM string (E1).

    Separate from `resource_metrics` because the two answer different questions
    and fail differently: a size metric is always available, a magic-state cost
    is not (see `non_clifford.py`).
    """
    return _non_clifford_cost(_load_circuit(source))
