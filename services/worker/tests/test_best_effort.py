"""Ranking of the candidates a budget-exhausted run leaves behind."""

from uuid import UUID, uuid4

from majorana_agent import (
    CandidateRevision,
    RepairInstruction,
    StrictVerificationAttempt,
    VerificationEvidence,
)
from majorana_contracts.enums import (
    Framework,
    RetryTarget,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_frameworks import FrameworkProgram
from majorana_worker.best_effort import choose_best_effort

RUN = uuid4()
PLAN = uuid4()


def _candidate(revision: int) -> CandidateRevision:
    source = f"# revision {revision}\nFINAL_CIRCUIT = object()\nRESULT = {{'counts': {{}}}}\n"
    return CandidateRevision(
        candidate_id=uuid4(),
        run_id=RUN,
        tool_call_id=f"simulate-{revision}",
        revision=revision,
        # A repair revision must name the candidate it repaired; only the identity
        # matters to the ranking, so any prior UUID satisfies the contract.
        parent_candidate_id=None if revision == 1 else uuid4(),
        plan_id=PLAN,
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=FrameworkProgram(Framework.QISKIT, source).fingerprint,
    )


def _verification(
    candidate: CandidateRevision, *, failures: int = 0, severity: str = "minor"
) -> VerificationEvidence:
    checks = [{"method": f"check_{index}", "result": "fail"} for index in range(failures)]
    checks.append({"method": "structural", "result": "pass"})
    return VerificationEvidence(
        verification_id=uuid4(),
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        decision=VerifierDecision.FAIL,
        deterministic_checks=checks,
        repair=RepairInstruction(
            category="intent_alignment_failed",
            severity=severity,
            confidence="high",
            evidence=[f"severity {severity}"],
            repairs=["Align the implementation with the accepted plan."],
            preserve_invariants=["assign RESULT"],
            required_rechecks=["all"],
        ),
        critic={
            "severity": severity,
            "confidence": "high",
            "summary": f"severity {severity}",
            "residual_risks": ["the measured distribution was not reproduced"],
        },
    )


def _by_id(
    pairs: list[tuple[CandidateRevision, VerificationEvidence | StrictVerificationAttempt | None]],
) -> dict[UUID, VerificationEvidence | StrictVerificationAttempt | None]:
    return {candidate.candidate_id: verification for candidate, verification in pairs}


def test_no_candidates_yields_nothing():
    """A run that died during planning has nothing to show, and must not invent it."""
    assert choose_best_effort([], {}) is None


def test_fewest_failing_checks_wins():
    weak, strong = _candidate(1), _candidate(2)
    pairs = [(weak, _verification(weak, failures=3)), (strong, _verification(strong, failures=1))]
    best = choose_best_effort([weak, strong], _by_id(pairs))
    assert best is not None
    assert best.candidate.candidate_id == strong.candidate_id
    assert best.candidates_considered == 2


def test_a_later_revision_does_not_win_on_recency_alone():
    """The naive fallback — 'just show the last one' — is wrong: the repair loop can
    and does make a candidate worse."""
    good, regressed = _candidate(1), _candidate(2)
    pairs = [
        (good, _verification(good, failures=1)),
        (regressed, _verification(regressed, failures=4)),
    ]
    best = choose_best_effort([good, regressed], _by_id(pairs))
    assert best is not None
    assert best.candidate.candidate_id == good.candidate_id


def test_critic_severity_breaks_a_tie_on_deterministic_checks():
    blocking, minor = _candidate(1), _candidate(2)
    pairs = [
        (blocking, _verification(blocking, failures=1, severity="blocking")),
        (minor, _verification(minor, failures=1, severity="minor")),
    ]
    best = choose_best_effort([blocking, minor], _by_id(pairs))
    assert best is not None
    assert best.candidate.candidate_id == minor.candidate_id


def test_an_unverified_candidate_loses_to_a_verified_one():
    """No evidence is not mild evidence — a candidate that never reached the verifier
    ranks below one that failed it."""
    unverified, verified = _candidate(2), _candidate(1)
    pairs = [(unverified, None), (verified, _verification(verified, failures=5))]
    best = choose_best_effort([unverified, verified], _by_id(pairs))
    assert best is not None
    assert best.candidate.candidate_id == verified.candidate_id


def test_an_all_unverified_run_still_returns_its_latest_attempt():
    first, second = _candidate(1), _candidate(2)
    best = choose_best_effort([first, second], _by_id([(first, None), (second, None)]))
    assert best is not None
    assert best.candidate.candidate_id == second.candidate_id
    assert best.failed_checks == []
    assert best.critic_summary is None


def test_the_evidence_carried_forward_names_the_failing_checks():
    candidate = _candidate(1)
    best = choose_best_effort(
        [candidate], _by_id([(candidate, _verification(candidate, failures=2))])
    )
    assert best is not None
    assert best.failed_checks == ["check_0", "check_1"]
    assert best.critic_summary == "severity minor"
    assert best.residual_risks == ["the measured distribution was not reproduced"]


def test_strict_attempt_checks_can_rank_a_failed_candidate():
    candidate = _candidate(1)
    attempt = StrictVerificationAttempt(
        attempt_id=uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=uuid4(),
        semantic_review_id=uuid4(),
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        checks=[
            {"method": "structural", "result": "pass"},
            {"method": "schema", "result": "fail"},
        ],
        decision=VerifierDecision.FAIL,
        reason_code="strict_check_failed",
        candidate_defect_observed=True,
        failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
        retry_target=RetryTarget.CODE_GENERATION,
        verifier_version="verification-v2",
    )

    best = choose_best_effort([candidate], _by_id([(candidate, attempt)]))

    assert best is not None
    assert best.failed_checks == ["schema"]
    assert best.critic_summary is None
