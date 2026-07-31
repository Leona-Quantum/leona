"""Offline contract metrics for the Phase 9 candidate-response validator."""

from __future__ import annotations

import dataclasses

from majorana_llm.research_extraction import (
    ResearchEvidenceBundle,
    ResearchResponseRejected,
    parse_research_candidate_response,
)


@dataclasses.dataclass(frozen=True)
class ResearchValidationFixture:
    name: str
    raw_response: str | bytes
    expected_outcome: str
    expected_rejection_code: str | None = None

    def __post_init__(self) -> None:
        if not self.name or self.expected_outcome not in {"accept", "reject"}:
            raise ValueError("invalid research validation fixture")
        if (self.expected_outcome == "reject") != (self.expected_rejection_code is not None):
            raise ValueError("rejection fixtures require one expected code")


@dataclasses.dataclass(frozen=True)
class ResearchValidationMetrics:
    fixture_count: int
    expected_accept_count: int
    expected_reject_count: int
    correct_accept_count: int
    correct_reject_count: int
    stable_rejection_code_matches: int
    deterministic_replay_matches: int
    contract_decision_accuracy: float
    rejection_code_accuracy: float
    deterministic_replay_accuracy: float

    def as_dict(self) -> dict[str, int | float]:
        return dataclasses.asdict(self)


def evaluate_research_validation_fixtures(
    bundle: ResearchEvidenceBundle,
    fixtures: tuple[ResearchValidationFixture, ...],
) -> ResearchValidationMetrics:
    """Measure only labelled validator behavior; never call an LLM provider."""

    if not fixtures:
        raise ValueError("at least one validation fixture is required")
    names = [fixture.name for fixture in fixtures]
    if len(names) != len(set(names)):
        raise ValueError("fixture names must be unique")

    correct_accepts = 0
    correct_rejects = 0
    code_matches = 0
    replay_matches = 0
    for fixture in fixtures:
        first = _validation_outcome(bundle, fixture.raw_response)
        second = _validation_outcome(bundle, fixture.raw_response)
        replay_matches += int(first == second)
        outcome, code = first
        if fixture.expected_outcome == "accept":
            correct_accepts += int(outcome == "accept")
        else:
            correct_rejects += int(outcome == "reject")
            code_matches += int(code == fixture.expected_rejection_code)

    expected_accepts = sum(fixture.expected_outcome == "accept" for fixture in fixtures)
    expected_rejects = len(fixtures) - expected_accepts
    return ResearchValidationMetrics(
        fixture_count=len(fixtures),
        expected_accept_count=expected_accepts,
        expected_reject_count=expected_rejects,
        correct_accept_count=correct_accepts,
        correct_reject_count=correct_rejects,
        stable_rejection_code_matches=code_matches,
        deterministic_replay_matches=replay_matches,
        contract_decision_accuracy=(correct_accepts + correct_rejects) / len(fixtures),
        rejection_code_accuracy=(code_matches / expected_rejects if expected_rejects else 1.0),
        deterministic_replay_accuracy=replay_matches / len(fixtures),
    )


def _validation_outcome(
    bundle: ResearchEvidenceBundle,
    raw_response: str | bytes,
) -> tuple[str, str | None]:
    try:
        response = parse_research_candidate_response(raw_response, bundle=bundle)
    except ResearchResponseRejected as exc:
        return "reject", exc.code
    return "accept", response.model_dump_json()
