from majorana_baselines import HamiltonianInstance, MaxCutInstance
from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_ir.connectors import from_openqasm

from majorana_verification import (
    verify_brute_force,
    verify_exact,
    verify_exact_diag,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical,
)

BELL = """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
h q[0];
cx q[0],q[1];
"""


def test_exact_equivalence_passes_for_identical_circuit():
    circuit = from_openqasm(BELL)
    outcome = verify_exact(circuit, circuit)
    assert outcome.passed
    assert outcome.method is VerificationMethod.EXACT
    assert outcome.details["scores"]["max_abs_distance"] == 0


def test_exact_equivalence_fails_for_different_circuit():
    outcome = verify_exact(
        from_openqasm(BELL), from_openqasm("OPENQASM 2.0;\nqreg q[2];\nx q[0];\n")
    )
    assert not outcome.passed


def test_statistical_equivalence_is_seeded():
    circuit = from_openqasm("OPENQASM 2.0;\nqreg q[1];\nh q[0];\n")
    outcome = verify_statistical(circuit, circuit, shots=256, seed=7)
    assert outcome.passed
    assert outcome.details["scores"]["total_variation_distance"] == 0


def test_return_contract_missing_key_fails():
    ok = verify_return_contract({"energy": -1.1, "counts": {}}, ["energy", "counts"])
    assert ok.passed
    bad = verify_return_contract({"energy": -1.1}, ["energy", "counts"])
    assert not bad.passed
    assert bad.details["missing_keys"] == ["counts"]


def test_qasm_parse_rejects_post_measurement_gate():
    good = verify_qasm_parse(BELL)
    assert good.passed
    bad = verify_qasm_parse(
        "OPENQASM 2.0;\nqreg q[1];\ncreg c[1];\nmeasure q[0] -> c[0];\nx q[0];\n"
    )
    assert not bad.passed


def test_exact_diag_matches_ground_state():
    inst = HamiltonianInstance(matrix=[[1.0, 0.0], [0.0, -1.0]])
    assert verify_exact_diag(inst, claimed_energy=-1.0).passed
    # A claimed energy off by more than chemical accuracy fails.
    assert not verify_exact_diag(inst, claimed_energy=-0.5).passed


def test_brute_force_flags_impossible_claim():
    inst = MaxCutInstance(edges=[(0, 1, 1.0), (1, 2, 1.0), (0, 2, 1.0)])
    # Exact optimum is 2.0; claiming to beat it is fabricated → FAIL.
    fabricated = verify_brute_force(inst, claimed_value=3.0)
    assert not fabricated.passed
    assert fabricated.details["beats_exact_optimum"]
    assert verify_brute_force(inst, claimed_value=2.0).passed
    assert VerificationResultKind.PASS is VerificationResultKind.PASS
