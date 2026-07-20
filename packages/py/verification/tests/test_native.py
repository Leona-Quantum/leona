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


def test_sampled_counts_respect_an_explicit_threshold():
    sampled = {"counts": {"00": 1024, "11": 1024}, "shots": 2048, "seed": 1234}
    # 75/25 vs the sampled 50/50: TVD 0.25, outside the two-sample shot-noise
    # bound (~0.11 at these shot counts) but inside a plan-declared 0.3.
    reported = {"00": 768, "11": 256}
    assert not verify_native_sampled_counts(reported, sampled).passed
    loose = verify_native_sampled_counts(reported, sampled, threshold=0.3)
    assert loose.passed
    assert loose.details["protocol"]["threshold_source"] == "plan"


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
