"""Declared-size caps on submitted OpenQASM (program.py).

The route's 100 KB byte limit bounds the source and not the work: the cost of
`qreg q[100000000];` is in the integer, not in the nineteen characters. These
caps run on the source before Qiskit is handed anything.
"""

import pytest

from majorana_openqasm.program import (
    MAX_DECLARED_QUBITS,
    MAX_STATEMENTS,
    OpenQASMError,
    _assert_within_caps,
    resource_metrics,
)

BELL = """OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
creg c[2];
h q[0];
cx q[0],q[1];
measure q -> c;
"""


def test_a_real_program_is_unaffected():
    metrics = resource_metrics(BELL)
    assert metrics.qubits == 2


def test_an_oversized_register_is_refused_without_parsing():
    """The memory bomb: nineteen bytes, a hundred million qubits. This must be
    refused from the source text — checking the parsed circuit would mean making
    the allocation the check exists to prevent."""
    with pytest.raises(OpenQASMError, match="declares"):
        _assert_within_caps("OPENQASM 2.0;\nqreg q[100000000];\n")


def test_the_refusal_reaches_the_public_entry_points():
    with pytest.raises(OpenQASMError, match="declares"):
        resource_metrics("OPENQASM 2.0;\nqreg q[100000000];\nh q[0];\n")


def test_registers_are_counted_together_not_separately():
    """One register under the cap, many registers over it — a limit applied per
    declaration would be defeated by writing the same width twice."""
    per_register = (MAX_DECLARED_QUBITS // 2) + 1
    source = f"OPENQASM 2.0;\nqreg a[{per_register}];\nqreg b[{per_register}];\n"
    with pytest.raises(OpenQASMError, match="declares"):
        _assert_within_caps(source)


def test_openqasm_3_qubit_declarations_are_counted():
    """OQ3 spells it `qubit[N] q`, and a cap that only understood OQ2's `qreg`
    would leave the newer syntax uncapped — which is the version the normalizer
    emits."""
    with pytest.raises(OpenQASMError, match="declares"):
        _assert_within_caps(f"OPENQASM 3.0;\nqubit[{MAX_DECLARED_QUBITS + 1}] q;\n")


def test_single_qubit_declarations_are_counted():
    source = "OPENQASM 3.0;\n" + "qubit a;\n" * (MAX_DECLARED_QUBITS + 1)
    with pytest.raises(OpenQASMError, match="declares"):
        _assert_within_caps(source)


def test_exactly_at_the_cap_is_allowed():
    """Off-by-one in the refusing direction is still a refusal of legitimate work."""
    _assert_within_caps(f"OPENQASM 2.0;\nqreg q[{MAX_DECLARED_QUBITS}];\n")


def test_a_statement_flood_is_refused():
    source = "OPENQASM 2.0;\nqreg q[2];\n" + "h q[0];\n" * (MAX_STATEMENTS + 1)
    with pytest.raises(OpenQASMError, match="statements"):
        _assert_within_caps(source)
