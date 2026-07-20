from majorana_contracts.enums import VerificationMethod, VerificationResultKind

from majorana_verification import (
    extract_counts,
    verify_exact,
    verify_qasm_parse,
    verify_return_contract,
    verify_statistical,
    verify_statistical_counts,
    verify_statistical_counts_pair,
)

BELL = """
OPENQASM 2.0;
include "qelib1.inc";
qreg q[2];
h q[0];
cx q[0],q[1];
"""


def test_exact_equivalence_passes_for_identical_circuit():
    outcome = verify_exact(BELL, BELL)
    assert outcome.passed
    assert outcome.method is VerificationMethod.EXACT
    assert outcome.details["scores"]["max_abs_distance"] == 0


def test_exact_equivalence_fails_for_different_circuit():
    outcome = verify_exact(BELL, "OPENQASM 2.0;\nqreg q[2];\nx q[0];\n")
    assert not outcome.passed


def test_statistical_equivalence_is_seeded():
    circuit = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nh q[0];\n'
    outcome = verify_statistical(circuit, circuit, shots=256, seed=7)
    assert outcome.passed
    assert outcome.details["scores"]["total_variation_distance"] == 0


def test_statistical_counts_passes_for_honest_bell_counts():
    circuit = BELL
    outcome = verify_statistical_counts(circuit, {"00": 512, "11": 512})
    assert outcome.passed
    assert outcome.method is VerificationMethod.STATISTICAL
    assert outcome.details["evidence"] == "direct_simulation_vs_reported_counts"
    assert outcome.details["scores"]["total_variation_distance"] < 0.05


def test_statistical_counts_fails_for_fabricated_distribution():
    circuit = BELL
    # A Bell state never yields |01>/|10>; counts dominated by them are fabricated.
    outcome = verify_statistical_counts(circuit, {"01": 500, "10": 500, "00": 24})
    assert not outcome.passed


def test_statistical_counts_fails_for_biased_counts():
    circuit = BELL
    # Right support, wrong weights: 90/10 vs the ideal 50/50 (TVD 0.4).
    outcome = verify_statistical_counts(circuit, {"00": 3686, "11": 410})
    assert not outcome.passed


def test_statistical_counts_bit_order_conventions():
    # Qiskit/OpenQASM displays q[0] as the rightmost bit: x q[0] yields "001".
    circuit = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nx q[0];\n'
    # auto (unknown producer): either orientation matches, wrong state never.
    for reported in ("100", "001"):
        assert verify_statistical_counts(circuit, {reported: 1024}).passed, reported
    assert not verify_statistical_counts(circuit, {"010": 1024}).passed
    # Explicit convention: only the declared orientation is accepted, so a
    # genuinely bit-reversed (wrong) state cannot be absolved.
    assert verify_statistical_counts(circuit, {"100": 1024}, bit_order="big").passed
    assert not verify_statistical_counts(circuit, {"001": 1024}, bit_order="big").passed
    assert verify_statistical_counts(circuit, {"001": 1024}, bit_order="little").passed
    assert not verify_statistical_counts(circuit, {"100": 1024}, bit_order="little").passed


def test_statistical_counts_fails_closed_when_support_exceeds_limit():
    circuit = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[9];\n' + "\n".join(
        f"h q[{index}];" for index in range(9)
    )
    outcome = verify_statistical_counts(circuit, {"0" * 9: 1024})
    assert not outcome.passed
    assert "at most 256 nonzero outcomes" in outcome.details["error"]


def test_statistical_equivalence_rejects_zero_shots():
    outcome = verify_statistical(BELL, BELL, shots=0)
    assert not outcome.passed
    assert outcome.details["error"] == "shots must be >= 1"


def test_statistical_counts_rejects_fractional_counts():
    circuit = BELL
    assert verify_statistical_counts(circuit, {"00": 512.0, "11": 512.0}).passed  # integral floats
    assert not verify_statistical_counts(circuit, {"00": 511.9, "11": 512.1}).passed
    assert not verify_statistical_counts(circuit, {"00": float("nan")}).passed


def test_statistical_counts_rejects_malformed_counts():
    circuit = BELL
    assert not verify_statistical_counts(circuit, {}).passed
    assert not verify_statistical_counts(circuit, {"0": 100}).passed  # wrong width
    assert not verify_statistical_counts(circuit, {"2x": 100}).passed  # not a bitstring


def test_statistical_counts_respects_explicit_threshold():
    circuit = BELL
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
    # Qiskit multi-register spacing and integral floats normalize; fractions never.
    assert extract_counts({"data": {"00 1": 5.0}}, []) == {"00 1": 5}
    assert extract_counts({"counts": {"00": 1.9}}, ["counts"]) is None
    assert extract_counts({"energy": -1.1}, ["energy"]) is None
    assert extract_counts({"notes": {"abc": 1}}, []) is None


def test_statistical_pair_checks_selected_framework_reexecution():
    stable = verify_statistical_counts_pair({"00": 500, "11": 500}, {"00": 490, "11": 510})
    changed = verify_statistical_counts_pair({"00": 500, "11": 500}, {"00": 800, "11": 200})

    assert stable.passed
    assert stable.details["evidence"] == "selected_framework_reexecution"
    assert not changed.passed


def test_statistical_pair_rejects_negative_fractional_and_boolean_counts():
    for invalid in (-1, 1.5, True):
        outcome = verify_statistical_counts_pair({"0": invalid}, {"0": 1})
        assert not outcome.passed
        assert outcome.details["error"] == "counts must be non-negative integers"


def test_return_contract_missing_key_fails():
    ok = verify_return_contract({"energy": -1.1, "counts": {}}, ["energy", "counts"])
    assert ok.passed
    bad = verify_return_contract({"energy": -1.1}, ["energy", "counts"])
    assert not bad.passed
    assert bad.details["missing_keys"] == ["counts"]


def test_qasm_parse_accepts_valid_post_measurement_gate():
    good = verify_qasm_parse(BELL)
    assert good.passed
    bad = verify_qasm_parse(
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\ncreg c[1];\n'
        "measure q[0] -> c[0];\nx q[0];\n"
    )
    assert bad.passed


def test_plan_contract_recognizes_every_counts_fallback_key():
    """Pins the two lists that must agree across the package boundary.

    The Plan contract rejects a statistical check whose plan promises no
    distribution key; extract_counts decides at runtime which keys hold one. If a
    name were added to the runtime fallbacks but not to the contract, plans naming
    it would be rejected even though verification would have found the counts.
    Contracts cannot import verification (the dependency runs the other way), so
    the agreement is asserted here.
    """
    from majorana_contracts.plan import _promises_distribution
    from majorana_verification.methods import _COUNTS_FALLBACK_KEYS

    for key in _COUNTS_FALLBACK_KEYS:
        assert _promises_distribution(key), key


def test_return_contract_does_not_claim_a_type_comparison_it_cannot_make():
    # RESULT is always a dict by the execution contract, so a promise about the
    # entry point's return value is unjudgeable here. Recording actual_return_type
    # against it read as a performed check; it is not one.
    outcome = verify_return_contract({"counts": {"00": 1}}, ["counts"], "QuantumCircuit")
    assert outcome.passed
    assert outcome.details["return_type_scope"] == "entry_point_return_not_observed"
    assert "actual_return_type" not in outcome.details


def test_return_contract_judges_a_type_promise_about_the_result_mapping():
    outcome = verify_return_contract({"counts": {"00": 1}}, ["counts"], "dict[str, int]")
    assert outcome.passed
    assert outcome.details["return_type_scope"] == "result_mapping"
    assert outcome.details["actual_return_type"] == "dict"


def test_return_contract_still_fails_on_missing_keys():
    outcome = verify_return_contract({"counts": {"00": 1}}, ["counts", "fidelity"], "dict")
    assert not outcome.passed
    assert outcome.details["missing_keys"] == ["fidelity"]


# --- Partial measurement -------------------------------------------------------
#
# Every ancilla algorithm measures only its answer register, so the reported counts
# are narrower than the circuit. Demanding full width failed correct code on every
# candidate, identically, which the repair loop cannot converge on.
#
# These fixtures deliberately break the qubit-permutation symmetry: a circuit that
# reads the same forwards and backwards cannot see a wire-relabelling defect, and
# a marginalization bug is exactly that shape.

# 3 qubits, only q0 and q2 measured, into c0 and c1. q2 is |1>, q0 is |0>,
# so the only honest outcome is c0=1, c1=0 -> "01".
PARTIAL_ASYMMETRIC = """
OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
qubit[3] q;
x q[2];
c[0] = measure q[2];
c[1] = measure q[0];
"""

# QPE-shaped: 3 counting qubits measured, 1 eigenstate qubit left unmeasured.
# The counting register is in uniform superposition, so all 8 outcomes are equally
# likely and the eigenstate qubit never appears in the counts.
QPE_SHAPED = """
OPENQASM 3.0;
include "stdgates.inc";
bit[3] c;
qubit[4] q;
h q[0];
h q[1];
h q[2];
x q[3];
c[0] = measure q[0];
c[1] = measure q[1];
c[2] = measure q[2];
"""


def test_statistical_counts_accepts_counts_narrower_than_the_circuit():
    # The blocker this fixes: 3 counts bits against a 4-qubit circuit used to raise.
    counts = {format(index, "03b"): 512 for index in range(8)}
    outcome = verify_statistical_counts(QPE_SHAPED, counts)
    assert outcome.passed
    measurement = outcome.details["protocol"]["measurement"]
    assert measurement["partial"] is True
    assert measurement["width"] == 3
    assert measurement["measured_qubits"] == [0, 1, 2]


def test_statistical_counts_marginalizes_over_the_measured_qubits():
    # If the ideal distribution were not marginalized, the unmeasured |1> on q[3]
    # would put all the ideal mass on keys this circuit can never report.
    outcome = verify_statistical_counts(QPE_SHAPED, {"000": 4096})
    assert not outcome.passed  # uniform ideal vs. a single outcome is a real failure
    assert outcome.details["scores"]["total_variation_distance"] > 0.8


def test_statistical_counts_reads_partial_measurement_in_clbit_order():
    outcome = verify_statistical_counts(PARTIAL_ASYMMETRIC, {"01": 4096}, bit_order="little")
    assert outcome.passed
    assert outcome.details["scores"]["total_variation_distance"] == 0.0


def test_statistical_counts_rejects_a_reversed_partial_measurement():
    # "10" is the same two bits wired to the wrong clbits. Under an explicit
    # little-endian read that is a wrong answer and must fail.
    outcome = verify_statistical_counts(PARTIAL_ASYMMETRIC, {"10": 4096}, bit_order="little")
    assert not outcome.passed
    assert outcome.details["scores"]["total_variation_distance"] == 1.0


def test_statistical_counts_still_rejects_inconsistent_key_widths():
    outcome = verify_statistical_counts(QPE_SHAPED, {"000": 2048, "0000": 2048})
    assert not outcome.passed
    assert "bits" in outcome.details["error"]


def test_statistical_counts_rejects_a_width_the_circuit_cannot_report():
    outcome = verify_statistical_counts(QPE_SHAPED, {"00000": 4096})
    assert not outcome.passed
    assert "the circuit reports" in outcome.details["error"]


# --- Incapacity is not disagreement --------------------------------------------
#
# Production run 019f7e46-d688 (teleportation): the statistical check simulates
# the circuit to learn what the answer should be, and a circuit that measures
# partway through and reacts to the result has no statevector to simulate. The
# check could not run — and the pipeline recorded "could not run" as "the code is
# wrong", failing correct, idiomatic if_test code identically on all four
# candidates. Sixth defect of that family. Incapacity is now `skipped`, a third
# outcome distinct from both verdicts, and it must stay narrow: every genuine
# disagreement and every malformed input below keeps failing.

# The production reproduction: teleportation with register-compare feed-forward,
# the shape the qiskit exporter emits for if_test.
TELEPORTATION = """
OPENQASM 3.0;
include "stdgates.inc";
bit[2] m;
bit[1] out;
qubit[3] q;
h q[1];
cx q[1], q[2];
cx q[0], q[1];
h q[0];
m[0] = measure q[0];
m[1] = measure q[1];
if (m == 1) {
  x q[2];
}
if (m == 2) {
  z q[2];
}
if (m == 3) {
  x q[2];
  z q[2];
}
out[0] = measure q[2];
"""

# Mid-circuit measurement with no control flow at all: the measure on q[0] is
# followed by another gate on the same qubit, so stripping final measurements
# leaves it behind and the circuit is still not a unitary.
MID_CIRCUIT_MEASUREMENT = """
OPENQASM 3.0;
include "stdgates.inc";
bit[2] c;
qubit[1] q;
h q[0];
c[0] = measure q[0];
h q[0];
c[1] = measure q[0];
"""


def test_statistical_counts_skips_a_circuit_with_classical_control_flow():
    outcome = verify_statistical_counts(TELEPORTATION, {"000": 512, "001": 512})
    assert outcome.result is VerificationResultKind.SKIPPED
    assert not outcome.passed  # skipped is never a pass
    assert outcome.details["skip_reason"] == "statevector_incapable"
    assert "control flow" in outcome.details["error"]


def test_statistical_counts_skips_a_mid_circuit_measurement():
    outcome = verify_statistical_counts(MID_CIRCUIT_MEASUREMENT, {"00": 256, "11": 256})
    assert outcome.result is VerificationResultKind.SKIPPED


GHZ3 = """
OPENQASM 3.0;
include "stdgates.inc";
qubit[3] q;
h q[0];
cx q[0], q[1];
cx q[1], q[2];
"""


def test_exact_skips_when_either_side_has_control_flow():
    # Same width on both sides: a width mismatch is a genuine FAIL and must keep
    # short-circuiting before incapacity is even considered.
    assert verify_exact(GHZ3, TELEPORTATION).result is VerificationResultKind.SKIPPED
    assert verify_exact(TELEPORTATION, GHZ3).result is VerificationResultKind.SKIPPED
    assert verify_exact(BELL, TELEPORTATION).result is VerificationResultKind.FAIL


def test_unparseable_qasm_still_fails_rather_than_skips():
    outcome = verify_statistical_counts("OPENQASM 3.0;\nqubit[1e q;\n", {"0": 1024})
    assert outcome.result is VerificationResultKind.FAIL


def test_wrong_counts_still_fail_after_the_skip_path_exists():
    """The test that matters (plans/statistical-cannot-judge-control-flow.md):
    the skip must not silence genuine numerical disagreement. A Bell state never
    yields |01>/|10>; a candidate reporting them must keep failing."""
    outcome = verify_statistical_counts(BELL, {"01": 500, "10": 500, "00": 24})
    assert outcome.result is VerificationResultKind.FAIL


def test_malformed_counts_against_an_incapable_circuit_still_fail():
    # Count validation happens before simulation, so garbage counts must not be
    # absolved by the circuit's incapacity.
    outcome = verify_statistical_counts(TELEPORTATION, {"2x": 100})
    assert outcome.result is VerificationResultKind.FAIL


def test_width_mismatch_evidence_is_strict_json_safe():
    """Production run 019f7ea0-8210 (cirq): `exact` on a width-mismatched pair
    recorded max_abs_distance = Infinity, Python's json emitted the bare
    `Infinity` token, Postgres JSONB rejected it, and the WHOLE JOB dead-lettered
    — a check failure converted into infrastructure death. The evidence must
    round-trip strict JSON (allow_nan=False) and still fail plainly."""
    import json as _json

    outcome = verify_exact(BELL, GHZ3)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["qubit_count_mismatch"] is True
    assert outcome.details["scores"]["max_abs_distance"] is None
    _json.dumps(outcome.details, allow_nan=False)  # raises on inf/nan


# Production run 019f7ead-ead6 (cirq). Task: "the 3-qubit state produced by
# applying X to qubit 0 and H to qubit 2". The planner declared a 3-qubit
# reference; cirq's all_qubits holds only TOUCHED qubits, so the correct
# candidate exported 2 qubits with q2 relabelled to index 1, and `exact` failed
# identically on every candidate. The reference's q1 is provably idle, so it
# factors out of the unitary and the comparison is exact after removing it.
IDLE_WIRE_REFERENCE = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nx q[0];\nh q[2];\n'
IDLE_WIRE_CANDIDATE = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nx q[0];\nh q[1];\n'


def test_a_provably_idle_reference_wire_is_removed_before_comparison():
    outcome = verify_exact(IDLE_WIRE_REFERENCE, IDLE_WIRE_CANDIDATE)
    assert outcome.passed
    assert outcome.details["scores"]["max_abs_distance"] == 0
    assert outcome.details["scores"]["reference_idle_qubits_removed"] == [1]


def test_removing_an_idle_wire_does_not_absolve_a_wrong_candidate():
    """The reduction changes which unitaries are COMPARABLE, never which agree:
    the surviving wires keep their ascending order, so a candidate that puts the
    gates on the wrong wires still fails."""
    swapped = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\nx q[1];\n'
    assert not verify_exact(IDLE_WIRE_REFERENCE, swapped).passed


def test_a_narrower_candidate_with_no_idle_reference_wire_still_fails():
    """GHZ-3 touches every wire, so a 2-qubit candidate is genuinely missing a
    qubit and the width mismatch stands — the guard that keeps this fix from
    becoming a blanket width amnesty."""
    outcome = verify_exact(GHZ3, BELL)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["qubit_count_mismatch"] is True
    assert "reference_idle_qubits_removed" not in outcome.details["scores"]


def test_the_idle_count_must_account_for_the_whole_width_gap():
    """One idle wire does not license a two-wire gap."""
    single = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[1];\nx q[0];\n'
    outcome = verify_exact(IDLE_WIRE_REFERENCE, single)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["qubit_count_mismatch"] is True


def test_a_wider_candidate_is_never_reduced():
    """Only the REFERENCE is reduced. A candidate that allocates a spare idle
    qubit is a different claim about the program the user gets, and no live
    reproduction has asked for it — it keeps failing plainly."""
    wide = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\ncx q[0],q[1];\n'
    outcome = verify_exact(BELL, wide)
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["qubit_count_mismatch"] is True
