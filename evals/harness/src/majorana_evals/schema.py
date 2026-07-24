"""Corpus + report schema. A corpus case is a prompt plus honest expectations:
did the terminal review/verifier decision match, was export classified as claimed,
were promised keys present in protected RESULT evidence, and was an artifact saved.
Mirrors evals/benchmark-suite-v0.md categories."""

from __future__ import annotations

from pathlib import Path

import yaml
from majorana_contracts.enums import (
    EvidenceStrength,
    ExportStatus,
    Framework,
    RetryTarget,
    RunStatus,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from pydantic import BaseModel, ConfigDict, Field


class Expect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    run_status: RunStatus = RunStatus.SUCCEEDED
    terminal_reason: str | None = "ai_review_aligned"
    verifier_decision: VerifierDecision | None = None
    export_status: ExportStatus | None = None
    output_keys: list[str] = Field(default_factory=list)
    saves_artifact: bool = True
    expected_top_bitstring: str | None = Field(
        default=None,
        description=(
            "Value-level correctness check for search/oracle cases: the most-probable "
            "measured bitstring the run must recover, written in Qiskit measurement order. "
            "The deterministic verifier only checks circuit-consistency, so a well-formed "
            "wrong answer (e.g. an endianness bit-reversal) passes it — this pins the answer."
        ),
    )
    expected_values: dict[str, float] = Field(
        default_factory=dict,
        description="Numeric result fields that must match within expected_value_tolerance.",
    )
    expected_value_tolerance: float = Field(default=0.01, ge=0)


class CorpusCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: str = Field(description="Benchmark suite category, e.g. 'A — Bell/GHZ'")
    prompt: str
    framework: Framework = Framework.QISKIT
    expect: Expect = Field(default_factory=Expect)


class CaseEvidence(BaseModel):
    """Reproducible attribution fields observed during one pipeline attempt."""

    failed_stage: str | None = None
    error_code: str | None = None
    qasm_source: str | None = None
    qasm_epilogue_applied: bool | None = None
    qasm_available: bool | None = None
    qasm_epilogue_error: str | None = None
    trusted_result_available: bool = False
    candidate_id: str | None = None
    execution_id: str | None = None
    result_evidence_error: str | None = None


class CaseResult(BaseModel):
    id: str
    category: str
    passed: bool
    run_status: str
    terminal_reason: str | None = None
    verifier_decision: str | None = None
    export_status: str | None = None
    saved: bool = False
    reasons: list[str] = Field(default_factory=list)
    evidence: CaseEvidence = Field(default_factory=CaseEvidence)


class Report(BaseModel):
    total: int
    passed: int
    pass_rate: float
    cases: list[CaseResult]
    note: str | None = None


class RoutingOutcome(BaseModel):
    """Expected or observed trust-state outcome for one seeded regression."""

    model_config = ConfigDict(extra="forbid")

    decision: VerifierDecision | None = None
    semantic_review_decision: SemanticReviewDecision | None = None
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget = RetryTarget.NONE
    candidate_revisions_consumed: int = Field(ge=0)
    evidence_strength: EvidenceStrength | None = None
    materialized: bool
    public_eligible: bool
    verdict_preserved: bool = True
    readable: bool = True


class SeededCase(BaseModel):
    """One provider-free regression seed with an honest routing expectation."""

    model_config = ConfigDict(extra="forbid")

    id: str
    category: str
    description: str
    expected: RoutingOutcome


class RoutingCaseResult(BaseModel):
    id: str
    passed: bool
    mismatches: list[str] = Field(default_factory=list)
    expected: RoutingOutcome
    observed: RoutingOutcome | None = None


class RoutingMetrics(BaseModel):
    decision_accuracy: float
    semantic_review_accuracy: float
    failure_class_accuracy: float
    retry_target_accuracy: float
    candidate_revision_accuracy: float
    candidate_revisions_consumed: int
    false_negative_rate: float
    false_positive_rate: float
    inconclusive_calibration: float
    evidence_strength_honesty: float
    materialization_behavior_accuracy: float
    publication_behavior_accuracy: float
    verdict_preservation_accuracy: float
    replay_readability_accuracy: float


class RoutingReport(BaseModel):
    total: int
    passed: int
    pass_rate: float
    missing_observations: list[str] = Field(default_factory=list)
    metrics: RoutingMetrics
    cases: list[RoutingCaseResult]


def load_corpus(directory: str | Path) -> list[CorpusCase]:
    """Load every *.yaml case in a directory, sorted by id for determinism."""
    cases: list[CorpusCase] = []
    for path in sorted(Path(directory).glob("*.yaml")):
        data = yaml.safe_load(path.read_text())
        cases.append(CorpusCase.model_validate(data))
    return cases


def load_seeded_corpus(directory: str | Path) -> list[SeededCase]:
    """Load seeded routing regressions, rejecting duplicate IDs."""

    cases = [
        SeededCase.model_validate(yaml.safe_load(path.read_text()))
        for path in sorted(Path(directory).glob("*.yaml"))
    ]
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("seeded corpus case IDs must be unique")
    return sorted(cases, key=lambda case: case.id)
