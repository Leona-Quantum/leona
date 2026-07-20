"""The grading behind the word "verified".

Production run 019f7e13-25d3 (teleportation) passed on a verification plan of
["return_contract"] — the only check asked whether RESULT has a `counts` key — and
reported the same top-line verdict as a run whose distribution matched the Born
distribution to 1.8e-16. These tests pin the distinction.
"""

import pytest

from majorana_contracts import (
    PHYSICAL_VERIFICATION_METHODS,
    EvidenceStrength,
    VerificationMethod,
    evidence_strength_of,
)


def check(method: str, result: str = "pass") -> dict[str, object]:
    return {"method": method, "result": result, "details": {}}


def test_the_teleportation_shape_grades_structural() -> None:
    """The exact check list that run 019f7e13-25d3 passed on."""
    checks = [
        check("structural"),
        check("resource_contract"),
        check("measurement_policy"),
        check("native_optimization_evidence"),
        check("return_contract"),
    ]
    assert evidence_strength_of(checks) is EvidenceStrength.STRUCTURAL


def test_a_passing_physical_check_grades_physical() -> None:
    checks = [check("structural"), check("return_contract"), check("exact")]
    assert evidence_strength_of(checks) is EvidenceStrength.PHYSICAL


@pytest.mark.parametrize("method", sorted(PHYSICAL_VERIFICATION_METHODS))
def test_every_physical_method_lifts_the_grade(method: str) -> None:
    assert evidence_strength_of([check(method)]) is EvidenceStrength.PHYSICAL


def test_a_failed_physical_check_does_not_lift_the_grade() -> None:
    """A check that ran and disagreed proves nothing about correctness."""
    assert evidence_strength_of([check("exact", "fail")]) is EvidenceStrength.STRUCTURAL


def test_reproducibility_is_not_physical_evidence() -> None:
    """A consistently wrong program also agrees with itself across two executions.

    agent_ports.py::_statistical_checks reports this separately from `statistical`
    for exactly this reason; the label must not inherit the stronger check's name.
    """
    checks = [check("structural"), check("statistical_reproducibility")]
    assert evidence_strength_of(checks) is EvidenceStrength.STRUCTURAL


def test_no_checks_at_all_is_structural_not_physical() -> None:
    """Fails closed: absent evidence is never upgraded."""
    assert evidence_strength_of([]) is EvidenceStrength.STRUCTURAL


def test_contract_checks_never_count_as_physical() -> None:
    for method in (
        "structural",
        "resource_contract",
        "measurement_policy",
        "success_criteria",
        "native_optimization_evidence",
        VerificationMethod.RETURN_CONTRACT.value,
        VerificationMethod.QASM_PARSE.value,
    ):
        assert method not in PHYSICAL_VERIFICATION_METHODS, method


def test_malformed_check_entries_do_not_crash_the_grade() -> None:
    """These dicts come off a JSONB column; a missing key must not raise."""
    assert evidence_strength_of([{}, {"method": None}, {"method": "exact"}]) is (
        EvidenceStrength.STRUCTURAL
    )
