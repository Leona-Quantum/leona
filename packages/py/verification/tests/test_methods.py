from majorana_baselines import HamiltonianInstance, MaxCutInstance
from majorana_contracts.enums import VerificationMethod, VerificationResultKind
from majorana_ir.connectors import from_openqasm

from majorana_verification import (
    extract_counts,
    verify_brute_force,
    verify_exact,
    verify_exact_diag,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical,
    verify_statistical_counts,
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


def test_statistical_counts_passes_for_honest_bell_counts():
    circuit = from_openqasm(BELL)
    outcome = verify_statistical_counts(circuit, {"00": 512, "11": 512})
    assert outcome.passed
    assert outcome.method is VerificationMethod.STATISTICAL
    assert outcome.details["evidence"] == "direct_simulation_vs_reported_counts"
    assert outcome.details["scores"]["total_variation_distance"] < 0.05


def test_statistical_counts_fails_for_fabricated_distribution():
    circuit = from_openqasm(BELL)
    # A Bell state never yields |01>/|10>; counts dominated by them are fabricated.
    outcome = verify_statistical_counts(circuit, {"01": 500, "10": 500, "00": 24})
    assert not outcome.passed


def test_statistical_counts_fails_for_biased_counts():
    circuit = from_openqasm(BELL)
    # Right support, wrong weights: 90/10 vs the ideal 50/50 (TVD 0.4).
    outcome = verify_statistical_counts(circuit, {"00": 3686, "11": 410})
    assert not outcome.passed


def test_statistical_counts_accepts_either_bit_order():
    # |100> from x q[0]: engine big-endian says "100"; Qiskit reports "001".
    circuit = from_openqasm('OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nx q[0];\n')
    for reported in ("100", "001"):
        outcome = verify_statistical_counts(circuit, {reported: 1024})
        assert outcome.passed, reported
    assert not verify_statistical_counts(circuit, {"010": 1024}).passed


def test_statistical_counts_rejects_malformed_counts():
    circuit = from_openqasm(BELL)
    assert not verify_statistical_counts(circuit, {}).passed
    assert not verify_statistical_counts(circuit, {"0": 100}).passed  # wrong width
    assert not verify_statistical_counts(circuit, {"2x": 100}).passed  # not a bitstring


def test_statistical_counts_respects_explicit_threshold():
    circuit = from_openqasm(BELL)
    # 60/40 split has TVD 0.1 from ideal — fails the shot-noise bound at these
    # shots, passes a plan-supplied looser threshold.
    counts = {"00": 2458, "11": 1638}
    assert not verify_statistical_counts(circuit, counts).passed
    loose = verify_statistical_counts(circuit, counts, threshold=0.15)
    assert loose.passed
    assert loose.details["protocol"]["threshold_source"] == "plan"


def test_extract_counts_finds_plan_key_then_conventions():
    counts = {"00": 10, "11": 12}
    assert extract_counts({"counts": counts}, ["counts"]) == counts
    assert extract_counts({"measurement_counts": counts}, ["energy"]) == counts
    # Qiskit multi-register spacing and float counts normalize.
    assert extract_counts({"data": {"00 1": 5.0}}, []) == {"00 1": 5}
    assert extract_counts({"energy": -1.1}, ["energy"]) is None
    assert extract_counts({"notes": {"abc": 1}}, []) is None


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
