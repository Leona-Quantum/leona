import math

import pytest
from majorana_contracts.enums import (
    Algorithm,
    VerificationMethod,
    VerificationResultKind,
)
from majorana_verification import (
    assess_evidence_sufficiency,
    verify_bell_state_property,
    verify_ghz_state_property,
)


def _cat_state(
    qubits: int,
    *,
    relative_phase: complex = 1,
    measurement_map: dict[str, int] | None = None,
) -> dict:
    vector = [0j] * (1 << qubits)
    vector[0] = 1 / math.sqrt(2)
    vector[-1] = relative_phase / math.sqrt(2)
    amplitudes = [component for value in vector for component in (value.real, value.imag)]
    return {
        "amplitudes": amplitudes,
        "qubits": qubits,
        "endianness": "q0_lsb",
        "clbits": qubits,
        "measurement_map": measurement_map
        if measurement_map is not None
        else {str(index): index for index in range(qubits)},
    }


@pytest.mark.parametrize(
    ("verify", "payload"),
    [
        (verify_bell_state_property, _cat_state(2)),
        (lambda payload: verify_ghz_state_property(payload, 3), _cat_state(3)),
    ],
)
def test_positive_phase_entangled_state_properties_pass(verify, payload):
    outcome = verify(payload)

    assert outcome.result is VerificationResultKind.PASS
    assert outcome.details["protocol"]["target"] == "typed_relative_phase_cat_state"
    assert outcome.details["does_not_prove"] == (
        "reported counts or request-to-plan interpretation"
    )


@pytest.mark.parametrize(
    ("verify", "payload"),
    [
        (verify_bell_state_property, _cat_state(2, relative_phase=-1)),
        (
            lambda payload: verify_ghz_state_property(payload, 3),
            _cat_state(3, relative_phase=-1),
        ),
    ],
)
def test_wrong_relative_phase_fails_even_with_identical_basis_probabilities(verify, payload):
    outcome = verify(payload)

    assert outcome.result is VerificationResultKind.FAIL
    assert abs(abs(outcome.details["scores"]["relative_phase_radians"]) - math.pi) < 1e-9


@pytest.mark.parametrize(
    ("verify", "payload"),
    [
        (
            lambda payload: verify_bell_state_property(payload, math.pi),
            _cat_state(2, relative_phase=-1),
        ),
        (
            lambda payload: verify_ghz_state_property(payload, 3, math.pi),
            _cat_state(3, relative_phase=-1),
        ),
    ],
)
def test_explicit_negative_phase_target_passes_when_native_state_matches(verify, payload):
    assert verify(payload).result is VerificationResultKind.PASS


def test_wrong_measurement_order_fails_the_canonical_readout_claim():
    outcome = verify_bell_state_property(_cat_state(2, measurement_map={"0": 1, "1": 0}))

    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["measurement_order_ok"] is False


@pytest.mark.parametrize(
    ("verify", "qubits", "measurement_map"),
    [
        (verify_bell_state_property, 2, {}),
        (verify_bell_state_property, 2, {"0": 0}),
        (lambda payload: verify_ghz_state_property(payload, 3), 3, {}),
        (lambda payload: verify_ghz_state_property(payload, 3), 3, {"0": 0, "1": 1}),
    ],
)
def test_declared_classical_bits_require_a_complete_measurement_map(
    verify, qubits, measurement_map
):
    outcome = verify(_cat_state(qubits, measurement_map=measurement_map))

    assert outcome.result is VerificationResultKind.FAIL
    assert outcome.details["scores"]["measurement_order_ok"] is False


def test_unmeasured_state_preparation_does_not_require_a_measurement_map():
    payload = _cat_state(2, measurement_map={})
    payload["clbits"] = 0

    assert verify_bell_state_property(payload).result is VerificationResultKind.PASS


def test_malformed_native_payload_is_verifier_error_not_candidate_failure():
    outcome = verify_bell_state_property({"amplitudes": []})

    assert outcome.result is VerificationResultKind.ERROR
    assert outcome.details["fault"] == "verifier_evidence"


def _check(method: VerificationMethod, result: str = "pass") -> dict:
    return {"method": method.value, "result": result, "details": {}}


def test_reproducibility_and_structural_checks_cannot_satisfy_bell_policy():
    sufficiency = assess_evidence_sufficiency(
        Algorithm.BELL,
        [
            _check(VerificationMethod.STRUCTURAL),
            _check(VerificationMethod.STATISTICAL_REPRODUCIBILITY),
        ],
        reported_counts=True,
    )

    assert sufficiency.sufficient is False
    assert "accepted Bell relative-phase state target" in sufficiency.missing_claims
    assert "reported counts agree with trusted circuit evidence" in sufficiency.missing_claims


def test_bell_property_and_native_count_check_satisfy_both_claims():
    sufficiency = assess_evidence_sufficiency(
        Algorithm.BELL,
        [
            _check(VerificationMethod.BELL_STATE_PROPERTY),
            _check(VerificationMethod.STATISTICAL_NATIVE),
        ],
        reported_counts=True,
    )

    assert sufficiency.sufficient is True


@pytest.mark.parametrize("algorithm", [Algorithm.QFT, Algorithm.GROVER, Algorithm.OTHER])
def test_algorithms_without_dedicated_property_verifiers_pass_with_trusted_counts(algorithm):
    sufficiency = assess_evidence_sufficiency(
        algorithm,
        [
            _check(VerificationMethod.STATISTICAL),
            _check(VerificationMethod.EXACT_DIAG),
            _check(VerificationMethod.BRUTE_FORCE),
        ],
        reported_counts=True,
    )

    assert sufficiency.sufficient is True
    assert sufficiency.capability_supported is True


@pytest.mark.parametrize("algorithm", [Algorithm.QFT, Algorithm.GROVER, Algorithm.OTHER])
def test_algorithms_without_dedicated_property_verifiers_remain_inconclusive_without_evidence(
    algorithm,
):
    sufficiency = assess_evidence_sufficiency(algorithm, [], reported_counts=False)

    assert sufficiency.sufficient is False
    assert sufficiency.capability_supported is False
    assert sufficiency.missing_claims[0].startswith("no dedicated property verifier")
