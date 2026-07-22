"""Framework-native evidence, judged on arrays (plans/framework-native-verification.md).

The fixtures break qubit-permutation symmetry on purpose: X on one specific qubit
plus H on another, so an endianness or wire-relabelling defect changes the state
and cannot pass. Malformed evidence must FAIL, never skip — the observer records
incapacity as an error key instead of a payload, so a payload that does not
validate is a pipeline defect.
"""

import math

import pytest
from majorana_contracts.enums import VerificationMethod, VerificationResultKind

from majorana_verification import (
    verify_exact_native,
    verify_native_sampled_counts,
    verify_native_statistical_counts,
)
from majorana_verification.native import statevector_from_evidence


def _payload_lsb_bell() -> dict:
    # (|00> + |11>)/sqrt(2), q0_lsb, both qubits measured to clbits 0 and 1.
    amp = 1 / math.sqrt(2)
    amplitudes = [0.0] * 8
    amplitudes[0] = amp  # |00>
    amplitudes[6] = amp  # |11>
    return {
        "amplitudes": amplitudes,
        "qubits": 2,
        "endianness": "q0_lsb",
        "clbits": 2,
        "measurement_map": {"0": 0, "1": 1},
    }


def _payload_msb_x0(qubits: int = 2) -> dict:
    # X on canonical qubit 0, reported in q0-most-significant layout: the
    # amplitude sits at index 2 (of 4), and normalization must move it to 1.
    amplitudes = [0.0] * (2 * (1 << qubits))
    amplitudes[2 * (1 << (qubits - 1))] = 1.0
    return {
        "amplitudes": amplitudes,
        "qubits": qubits,
        "endianness": "q0_msb",
        "clbits": qubits,
        "measurement_map": {str(index): index for index in range(qubits)},
    }


def test_endianness_normalization_moves_msb_support():
    statevector, _mapping, _qubits, _clbits = statevector_from_evidence(_payload_msb_x0())
    probabilities = statevector.probabilities_dict()
    assert probabilities == pytest.approx({"01": 1.0})  # qiskit layout: q0 rightmost


def test_native_counts_pass_and_fail_against_the_born_distribution():
    payload = _payload_lsb_bell()
    good = verify_native_statistical_counts(payload, {"00": 512, "11": 512})
    assert good.passed
    assert good.method is VerificationMethod.STATISTICAL
    assert good.details["evidence"] == "native_statevector_vs_reported_counts"

    fabricated = verify_native_statistical_counts(payload, {"01": 500, "10": 500})
    assert fabricated.result is VerificationResultKind.FAIL


def test_native_counts_marginalize_partial_measurement():
    # 3 qubits, X on q2 and H on q0; only q2 is measured (clbit 0), so the honest
    # counts are all "1" regardless of q0's superposition.
    amp = 1 / math.sqrt(2)
    amplitudes = [0.0] * 16
    amplitudes[2 * 4] = amp  # |100>
    amplitudes[2 * 5] = amp  # |101>
    payload = {
        "amplitudes": amplitudes,
        "qubits": 3,
        "endianness": "q0_lsb",
        "clbits": 1,
        "measurement_map": {"0": 2},
    }
    assert verify_native_statistical_counts(payload, {"1": 1024}).passed
    assert not verify_native_statistical_counts(payload, {"0": 1024}).passed


def test_malformed_native_evidence_fails_rather_than_skips():
    for broken in (
        None,
        {},
        {**_payload_lsb_bell(), "amplitudes": [1.0, 0.0]},  # wrong length
        {**_payload_lsb_bell(), "endianness": "little"},
        {
            **_payload_lsb_bell(),
            "amplitudes": [value * 2 for value in _payload_lsb_bell()["amplitudes"]],
        },  # not normalized
        {**_payload_lsb_bell(), "measurement_map": {"0": 7}},  # qubit out of range
    ):
        outcome = verify_native_statistical_counts(broken, {"00": 1024})
        assert outcome.result is VerificationResultKind.FAIL, broken


def test_sampled_counts_agree_and_disagree():
    sampled = {"counts": {"00": 1030, "11": 1018}, "shots": 2048, "seed": 1234}
    agreeing = verify_native_sampled_counts({"00": 500, "11": 524}, sampled)
    assert agreeing.passed
    assert agreeing.method is VerificationMethod.STATISTICAL_NATIVE
    assert agreeing.details["evidence"] == "native_trusted_reexecution_vs_reported_counts"

    fabricated = verify_native_sampled_counts({"01": 500, "10": 524}, sampled)
    assert fabricated.result is VerificationResultKind.FAIL


def test_sampled_counts_reject_width_mismatch_and_empty_evidence():
    sampled = {"counts": {"00": 1024, "11": 1024}, "shots": 2048, "seed": 1234}
    assert not verify_native_sampled_counts({"000": 1024}, sampled).passed
    assert not verify_native_sampled_counts({"00": 1024}, {"counts": {}}).passed
    assert not verify_native_sampled_counts({"00": 1024}, None).passed


def test_sampled_counts_reject_a_plan_attempt_to_loosen_policy():
    sampled = {"counts": {"00": 1024, "11": 1024}, "shots": 2048, "seed": 1234}
    # 75/25 vs the sampled 50/50: TVD 0.25, outside the two-sample shot-noise
    # bound (~0.11 at these shot counts). A plan-declared 0.3 cannot loosen it.
    reported = {"00": 768, "11": 256}
    assert not verify_native_sampled_counts(reported, sampled).passed
    loose = verify_native_sampled_counts(reported, sampled, threshold=0.3)
    assert not loose.passed
    assert loose.details["protocol"]["threshold_source"] == ("two_sample_shot_noise_bound")
    assert loose.details["protocol"]["declared_threshold"] == 0.3
    assert loose.details["protocol"]["threshold"] < 0.3


def test_sampled_counts_allow_a_plan_to_tighten_policy():
    sampled = {"counts": {"00": 1024, "11": 1024}, "shots": 2048, "seed": 1234}
    reported = {"00": 1126, "11": 922}
    assert verify_native_sampled_counts(reported, sampled).passed
    tightened = verify_native_sampled_counts(reported, sampled, threshold=0.01)
    assert not tightened.passed
    assert tightened.details["protocol"]["threshold_source"] == "plan_tightened"
    assert tightened.details["protocol"]["threshold"] == 0.01


BELL_QASM = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n'

TELEPORT_QASM = """
OPENQASM 3.0;
include "stdgates.inc";
bit[2] m;
qubit[3] q;
h q[1];
cx q[1], q[2];
m[0] = measure q[0];
if (m == 1) { x q[2]; }
m[1] = measure q[2];
"""


def test_exact_native_matches_and_rejects_against_the_reference():
    matching = verify_exact_native(BELL_QASM, _payload_lsb_bell())
    assert matching.passed
    assert matching.details["evidence"] == "native_statevector_vs_reference_qasm"
    assert matching.details["protocol"]["scope"].startswith("action on the all-zero state")

    wrong = verify_exact_native(BELL_QASM, _payload_msb_x0())
    assert wrong.result is VerificationResultKind.FAIL


def test_exact_native_skips_when_the_reference_has_no_statevector():
    outcome = verify_exact_native(TELEPORT_QASM, _payload_lsb_bell())
    assert outcome.result is VerificationResultKind.SKIPPED
    assert outcome.details["skip_reason"] == "statevector_incapable"


def test_auto_threshold_uses_the_selected_orientations_bin_count():
    """The two orientations can have different support overlaps; the shot-noise
    bound must use the SELECTED orientation's bin count, not whichever the loop
    computed last (review finding on PR 108 — the defect predated the refactor).
    Ideal support {"01"}: as_is observes {"01"} (1 bin, TVD 0), reversed
    observes {"10"} (2 bins). The selected orientation is as_is, so the recorded
    bins must be 1."""
    import math as _math

    from majorana_verification import counts_vs_ideal

    circuit = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nx q[0];\n'
    report = counts_vs_ideal(circuit, {"01": 1024})
    assert report.passed
    assert report.protocol["orientation_used"] == "as_is"
    assert report.protocol["bins"] == 1
    expected = _math.sqrt((1 * _math.log(2) + _math.log(1 / 1e-3)) / (2 * 1024))
    assert report.protocol["threshold"] == pytest.approx(expected)

    sampled = {"counts": {"01": 2048}, "shots": 2048, "seed": 1234}
    two_sample = verify_native_sampled_counts({"01": 1024}, sampled)
    assert two_sample.passed
    assert two_sample.details["protocol"]["bins"] == 1


# Teleportation as the trusted observer samples it: registers `out` (1 bit, the
# teleported qubit) and `m` (2 bits, the Bell-basis measurement). Qiskit's
# get_counts prints registers last-declared first, so the key reads "o mm" and
# the exported `registers` list is in that same left-to-right order. `out` carries
# the Ry(0.7) distribution (cos^2(0.35) = 0.8817); `m` is uniform over four.
def _teleport_sampled() -> dict:
    return {
        "counts": {
            "0 00": 452,
            "0 01": 451,
            "0 10": 451,
            "0 11": 452,
            "1 00": 60,
            "1 01": 61,
            "1 10": 61,
            "1 11": 60,
        },
        "shots": 2048,
        "seed": 1234,
        "bit_order": "little",
        "registers": [{"name": "out", "width": 1}, {"name": "m", "width": 2}],
    }


def test_sampled_counts_marginalize_onto_the_uniquely_matching_register():
    """The defect this fixes (plans/sampled-counts-width-mismatch.md): the task
    asked for "the counts of the teleported qubit", the model reported a 1-bit
    marginal over the `out` register, and the width mismatch failed correct code
    on every candidate."""
    outcome = verify_native_sampled_counts({"0": 900, "1": 124}, _teleport_sampled())
    assert outcome.passed
    assert outcome.details["protocol"]["register_used"] == "out"
    assert outcome.details["protocol"]["register_width"] == 1


def test_a_fabricated_register_marginal_still_fails():
    """The marginal is the circuit's true distribution for that register, so a
    made-up report is caught exactly as a full-width one is. (A *constant* "0"
    report happens to sit inside the two-sample bound against 0.88/0.12 at these
    shot counts — that is the shot-noise bound being honest, not a hole; a uniform
    invention is 0.38 away and fails plainly.)"""
    outcome = verify_native_sampled_counts({"0": 512, "1": 512}, _teleport_sampled())
    assert outcome.result is VerificationResultKind.FAIL


def test_ambiguous_or_absent_register_matches_stay_failures():
    """Ambiguity must not become absolution: with two registers of the same
    width there is no single defensible marginal, so the width mismatch stands."""
    two_singles = {
        "counts": {"0 0": 1024, "1 1": 1024},
        "shots": 2048,
        "seed": 1234,
        "registers": [{"name": "b", "width": 1}, {"name": "a", "width": 1}],
    }
    ambiguous = verify_native_sampled_counts({"0": 1024}, two_singles)
    assert ambiguous.result is VerificationResultKind.FAIL
    assert "matches 2 registers" in ambiguous.details["error"]

    # No register matches the reported width at all.
    assert not verify_native_sampled_counts({"00": 1024}, _teleport_sampled()).passed

    # Cirq/PennyLane export one concatenated key and no `registers` list: the
    # mismatch keeps failing with the plain width message.
    no_registers = {"counts": {"000": 1024, "111": 1024}, "shots": 2048, "seed": 1234}
    plain = verify_native_sampled_counts({"0": 1024}, no_registers)
    assert plain.result is VerificationResultKind.FAIL
    assert "sampled 3-bit keys" in plain.details["error"]


def test_full_width_reports_are_unaffected_by_the_registers_list():
    outcome = verify_native_sampled_counts(
        {
            "0 00": 226,
            "0 01": 226,
            "0 10": 225,
            "0 11": 226,
            "1 00": 30,
            "1 01": 30,
            "1 10": 31,
            "1 11": 30,
        },
        _teleport_sampled(),
    )
    assert outcome.passed
    assert "register_used" not in outcome.details["protocol"]


def test_a_malformed_registers_list_does_not_rescue_a_width_mismatch():
    for broken in ([], "out", [{"name": "out", "width": 2}], [{"width": 1}]):
        payload = {**_teleport_sampled(), "registers": broken}
        assert not verify_native_sampled_counts({"0": 900, "1": 124}, payload).passed


def test_a_failing_sampled_comparison_names_the_two_distributions():
    """Production run 019f7ecf-a56c (teleportation). The check was RIGHT — the
    model wrote `circuit.measure(2, 0)`, putting Bob's qubit into Alice's
    register, so `c_bob` was never written and its trusted marginal is constant
    zero — but all it told the model was "TVD 0.1255 > 0.0900". Three candidates
    repeated the same mistake and the budget was gone. A number cannot teach; the
    two distributions can, and here they show `c_bob` is stuck at 0 while the run
    reported a 0.88/0.12 split, which names the bug."""
    stuck = {
        "counts": {"0 00": 512, "0 01": 512, "0 10": 512, "0 11": 512},
        "shots": 2048,
        "seed": 1234,
        "registers": [{"name": "c_bob", "width": 1}, {"name": "c_alice", "width": 2}],
    }
    outcome = verify_native_sampled_counts({"0": 1806, "1": 242}, stuck)
    assert outcome.result is VerificationResultKind.FAIL
    scores = outcome.details["scores"]
    assert scores["trusted_distribution"] == {"0": 1.0}
    assert scores["reported_distribution"]["1"] == pytest.approx(242 / 2048)
    # Passing evidence stays lean — the diagnostic is for the repair loop.
    agreeing = verify_native_sampled_counts({"0": 900, "1": 124}, _teleport_sampled())
    assert agreeing.passed
    assert "trusted_distribution" not in agreeing.details["scores"]


def test_a_register_no_measurement_writes_is_named_outright():
    """Production runs 019f7ea0-8017 → 019f7ecf-a56c → 019f7ed9-ac0c. The model
    wrote `circuit.measure(2, 0)` — clbit 0 belongs to `c_alice`, so the register
    it declared as `c_bob` is never written. It repeated that line on SEVEN
    candidates across two runs, including four AFTER the distributions were added
    to the evidence. Two prompt-level attempts is the limit; this is the
    mechanism. The observer reports which clbits a measurement writes, and a
    failure against an unwritten register says so in words."""
    stuck = {
        "counts": {"0 00": 512, "0 01": 512, "0 10": 512, "0 11": 512},
        "shots": 2048,
        "seed": 1234,
        # c_alice owns clbits 0-1, c_bob owns clbit 2; only Alice's are written.
        "registers": [{"name": "c_bob", "width": 1}, {"name": "c_alice", "width": 2}],
        "measured_clbits": [0, 1],
    }
    outcome = verify_native_sampled_counts({"0": 1806, "1": 242}, stuck)
    assert outcome.result is VerificationResultKind.FAIL
    diagnosis = outcome.details["scores"]["register_never_measured"]
    assert diagnosis["register"] == "c_bob"
    assert diagnosis["clbits"] == [2]
    assert "no measurement writes" in diagnosis["diagnosis"]


def test_the_unwritten_register_diagnostic_does_not_fire_on_a_written_one():
    """It must accuse only when it is sure. A register the observer reports as
    written is a plain disagreement — the run is wrong about the physics, not
    about where it put its measurement — and a wrong accusation would send the
    repair loop chasing a bug that is not there."""
    written = {**_teleport_sampled(), "measured_clbits": [0, 1, 2]}
    outcome = verify_native_sampled_counts({"0": 512, "1": 512}, written)
    assert outcome.result is VerificationResultKind.FAIL
    assert "register_never_measured" not in outcome.details["scores"]

    # No `measured_clbits` at all (cirq/pennylane, or older evidence): silent.
    outcome = verify_native_sampled_counts({"0": 512, "1": 512}, _teleport_sampled())
    assert outcome.result is VerificationResultKind.FAIL
    assert "register_never_measured" not in outcome.details["scores"]


def test_a_report_that_matches_a_different_register_says_which_one():
    """Production run 019f7ee3-6e7c, candidate 3. #117's diagnosis WORKED — the
    model moved its measurement to `measure(2, cr_bob[0])`, exactly as the
    sentence told it to — and then failed at TVD 0.376, because the paired
    readout bug was still there: it slices `bitstring[-1]`, which is
    `c_alice[0]`, not `c_bob`. Naming the register the report actually matches
    turns that into one sentence.

    This scans registers for an EXPLANATION, never for a verdict. The check still
    fails; only the reason improves. Scanning for a pass is what #113 refused to
    do and this must not become."""
    # `out` is 0.88/0.12; `m` is uniform. The run reports `m`'s distribution
    # while claiming the 1-bit width that matches `out`.
    outcome = verify_native_sampled_counts({"0": 1024, "1": 1024}, _teleport_sampled())
    assert outcome.result is VerificationResultKind.FAIL
    matched = outcome.details["scores"]["report_matches_another_register"]
    assert matched["register"] == "m"
    assert matched["clbits"] == [0, 1]
    assert "slice" in matched["diagnosis"]


def test_the_other_register_diagnostic_stays_quiet_when_nothing_matches():
    """A report that matches no register is a plain disagreement about the
    physics, and inventing a register to blame would be worse than silence."""
    outcome = verify_native_sampled_counts({"0": 100, "1": 1948}, _teleport_sampled())
    assert outcome.result is VerificationResultKind.FAIL
    assert "report_matches_another_register" not in outcome.details["scores"]


def test_the_failure_diagnostic_is_bounded():
    """256 nonzero outcomes is the check's ceiling; the diagnostic must not put
    all of them into the repair evidence."""
    wide = {f"{index:08b}": 8 for index in range(256)}
    outcome = verify_native_sampled_counts(
        {"00000000": 2048}, {"counts": wide, "shots": 2048, "seed": 1234}
    )
    assert outcome.result is VerificationResultKind.FAIL
    assert len(outcome.details["scores"]["trusted_distribution"]) == 16
    assert outcome.details["scores"]["distributions_truncated"] is True


def test_exact_native_removes_a_provably_idle_reference_wire():
    """The statevector twin of the OpenQASM reduction (run 019f7ead-ead6): a cirq
    candidate carries only its TOUCHED qubits, so a 3-qubit reference whose q1 no
    operation touches must be reduced to meet it — with the same guard, so a
    reference that uses every wire keeps failing a narrower candidate."""
    reference = 'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nx q[0];\nh q[2];\n'
    amp = 1 / math.sqrt(2)
    amplitudes = [0.0] * 8
    amplitudes[2 * 1] = amp  # |01>: q0 flipped
    amplitudes[2 * 3] = amp  # |11>: the surviving q2 in superposition
    candidate = {
        "amplitudes": amplitudes,
        "qubits": 2,
        "endianness": "q0_lsb",
        "clbits": 2,
        "measurement_map": {"0": 0, "1": 1},
    }
    outcome = verify_exact_native(reference, candidate)
    assert outcome.passed
    assert outcome.details["scores"]["reference_idle_qubits_removed"] == [1]

    ghz3 = (
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\n'
    )
    no_idle = verify_exact_native(ghz3, candidate)
    assert no_idle.result is VerificationResultKind.FAIL
    assert no_idle.details["scores"]["qubit_count_mismatch"] is True


def test_exact_native_width_mismatch_is_strict_json_safe():
    """Same rule as verify_exact: no non-finite floats in evidence (the JSONB
    boundary rejects them and dead-letters the job)."""
    import json as _json

    three_qubit_ref = (
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[3];\nh q[0];\ncx q[0],q[1];\ncx q[1],q[2];\n'
    )
    outcome = verify_exact_native(three_qubit_ref, _payload_lsb_bell())
    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["qubit_count_mismatch"] is True
    _json.dumps(outcome.details, allow_nan=False)
