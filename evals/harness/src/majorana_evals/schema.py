"""Corpus + report schema. A corpus case is a prompt plus honest expectations:
did the terminal review/verifier decision match, was export classified as claimed,
were promised keys present in protected RESULT evidence, and was an artifact saved.
Mirrors evals/benchmark-suite-v0.md categories."""

from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any, Literal

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
from pydantic import BaseModel, ConfigDict, Field, model_validator

Difficulty = Literal["basic", "intermediate", "advanced", "research"]
Workload = Literal["educational", "practical", "scientific"]
CorpusSplit = Literal["calibration", "holdout"]


class ExpectedValueRange(BaseModel):
    """Inclusive independently derived interval for one numeric RESULT field."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    minimum: float
    maximum: float

    @model_validator(mode="after")
    def _minimum_does_not_exceed_maximum(self) -> "ExpectedValueRange":
        if self.minimum > self.maximum:
            raise ValueError("expected value range minimum must not exceed maximum")
        return self


class ExpectedCountMarginal(BaseModel):
    """Probability interval for selected displayed bits of one RESULT counts mapping."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    result_key: str = Field(default="counts", min_length=1)
    bit_indices: list[int] = Field(min_length=1)
    expected_bits: str = Field(pattern=r"^[01]+$")
    probability_range: ExpectedValueRange

    @model_validator(mode="after")
    def _bit_selection_is_well_formed(self) -> "ExpectedCountMarginal":
        if any(index < 0 for index in self.bit_indices):
            raise ValueError("count marginal bit indices must be nonnegative")
        if len(set(self.bit_indices)) != len(self.bit_indices):
            raise ValueError("count marginal bit indices must be unique")
        if len(self.expected_bits) != len(self.bit_indices):
            raise ValueError("count marginal expected_bits length must match bit_indices")
        if not 0.0 <= self.probability_range.minimum <= self.probability_range.maximum <= 1.0:
            raise ValueError("count marginal probability range must stay within 0..1")
        return self


class Expect(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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
    expected_value_ranges: dict[str, ExpectedValueRange] = Field(
        default_factory=dict,
        description=(
            "Inclusive finite ranges for stochastic or non-unique numeric RESULT fields. "
            "Use a range derived independently from the instance and sampling policy; "
            "never use it to loosen an exact-value oracle."
        ),
    )
    expected_count_marginals: list[ExpectedCountMarginal] = Field(
        default_factory=list,
        description=(
            "Probability intervals computed directly from protected RESULT count "
            "mappings. bit_indices use the displayed key from left to right after "
            "Qiskit register-separator spaces are removed."
        ),
    )
    expected_result_subset: dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Structured RESULT fields that must recursively match. Mapping expectations "
            "are subsets; sequences and scalar leaves match exactly, except numeric leaves "
            "use expected_value_tolerance. Use only when the instance has a unique honest "
            "answer; do not reject alternative optima by pinning one arbitrarily."
        ),
    )
    expected_value_tolerance: float = Field(default=0.01, ge=0)
    expected_native_statevector: list[tuple[float, float]] | None = Field(
        default=None,
        description=(
            "Expected native FINAL_CIRCUIT amplitudes as [real, imaginary] pairs in the "
            "framework observer's declared order. Compared up to one global phase."
        ),
    )
    native_statevector_tolerance: float = Field(default=1e-9, ge=0)
    allowed_qasm_gate_names: list[str] | None = Field(
        default=None,
        min_length=1,
        description=(
            "When set, the trusted interchange QASM must exist and every executable "
            "gate statement must use one of these lowercase operation names."
        ),
    )
    requires_native_optimization: bool | None = Field(
        default=None,
        description=("Optional expectation for the trusted native_optimization.applied evidence."),
    )

    @model_validator(mode="after")
    def _numeric_expectation_kinds_do_not_overlap(self) -> "Expect":
        overlap = self.expected_values.keys() & self.expected_value_ranges.keys()
        if overlap:
            raise ValueError(
                "numeric RESULT fields cannot have both exact and range expectations: "
                + ", ".join(sorted(overlap))
            )
        marginal_identities = [
            (item.result_key, tuple(item.bit_indices), item.expected_bits)
            for item in self.expected_count_marginals
        ]
        if len(set(marginal_identities)) != len(marginal_identities):
            raise ValueError("count marginal expectations must be unique")
        statevector = self.expected_native_statevector
        if statevector is not None:
            size = len(statevector)
            if size < 2 or size & (size - 1):
                raise ValueError("expected native statevector length must be a power of two >= 2")
            norm = sum(real * real + imaginary * imaginary for real, imaginary in statevector)
            if not math.isclose(norm, 1.0, rel_tol=0.0, abs_tol=1e-9):
                raise ValueError("expected native statevector must be normalized")
        if self.allowed_qasm_gate_names is not None:
            invalid = [
                name
                for name in self.allowed_qasm_gate_names
                if re.fullmatch(r"[a-z][a-z0-9_]*", name) is None
            ]
            if invalid:
                raise ValueError(
                    "allowed QASM gate names must be lowercase identifiers: " + ", ".join(invalid)
                )
            if len(set(self.allowed_qasm_gate_names)) != len(self.allowed_qasm_gate_names):
                raise ValueError("allowed QASM gate names must be unique")
        return self


class CorpusCase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    category: str = Field(description="Benchmark suite category, e.g. 'A — Bell/GHZ'")
    split: CorpusSplit = "calibration"
    difficulty: Difficulty = "intermediate"
    workload: Workload = "scientific"
    semantic_group_id: str | None = Field(default=None, min_length=1)
    prompt_variant: str | None = Field(default=None, min_length=1)
    prompt: str
    framework: Framework = Framework.QISKIT
    expect: Expect = Field(default_factory=Expect)

    @model_validator(mode="after")
    def _metamorphic_provenance_is_complete(self) -> "CorpusCase":
        if (self.semantic_group_id is None) != (self.prompt_variant is None):
            raise ValueError("semantic_group_id and prompt_variant must be set together")
        return self


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
    candidates_considered: int = Field(default=0, ge=0)
    plans_produced: int = Field(default=0, ge=0)
    sandbox_attempts: int = Field(default=0, ge=0)
    semantic_review_attempts: int = Field(default=0, ge=0)
    recorded_llm_calls: int = Field(default=0, ge=0)
    recorded_input_tokens: int = Field(default=0, ge=0)
    recorded_output_tokens: int = Field(default=0, ge=0)


class CaseResult(BaseModel):
    id: str
    category: str
    split: CorpusSplit = "calibration"
    difficulty: Difficulty = "intermediate"
    workload: Workload = "scientific"
    semantic_group_id: str | None = Field(default=None, min_length=1)
    prompt_variant: str | None = Field(default=None, min_length=1)
    trial: int = Field(default=1, ge=1)
    passed: bool
    run_status: str
    terminal_reason: str | None = None
    verifier_decision: str | None = None
    export_status: str | None = None
    saved: bool = False
    product_accepted: bool = False
    oracle_passed: bool | None = None
    false_positive: bool = False
    false_negative: bool = False
    first_candidate_passed: bool = False
    observed_values: dict[str, float] = Field(default_factory=dict)
    observed_top_bitstring: str | None = None
    reasons: list[str] = Field(default_factory=list)
    evidence: CaseEvidence = Field(default_factory=CaseEvidence)

    @model_validator(mode="after")
    def _metamorphic_provenance_is_complete(self) -> "CaseResult":
        if (self.semantic_group_id is None) != (self.prompt_variant is None):
            raise ValueError("semantic_group_id and prompt_variant must be set together")
        return self


class CaseAggregate(BaseModel):
    id: str
    category: str
    split: CorpusSplit = "calibration"
    difficulty: Difficulty = "intermediate"
    workload: Workload = "scientific"
    trials: int = Field(ge=1)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=1)
    product_accepted: int = Field(ge=0)
    oracle_trials: int = Field(ge=0)
    oracle_passed: int = Field(ge=0)
    false_positives: int = Field(ge=0)
    false_negatives: int = Field(ge=0)
    first_candidate_passed: int = Field(ge=0)
    mean_candidates: float = Field(ge=0)


class SliceAggregate(BaseModel):
    """Trial-level metrics for one difficulty or workload slice."""

    name: str
    trials: int = Field(ge=1)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=1)
    false_positives: int = Field(ge=0)
    false_negatives: int = Field(ge=0)
    first_candidate_passed: int = Field(ge=0)
    mean_candidates: float = Field(ge=0)


class MetamorphicAggregate(BaseModel):
    """Paired outcomes for semantically identical prompt variants."""

    semantic_group_id: str
    variants: int = Field(ge=2)
    observations: int = Field(ge=2)
    passed: int = Field(ge=0)
    pass_rate: float = Field(ge=0, le=1)
    trial_matrix_complete: bool
    all_variants_passed: bool
    outcome_consistent: bool
    variant_pass_rates: dict[str, float] = Field(default_factory=dict)
    mean_candidates: float = Field(ge=0)


class Report(BaseModel):
    total: int
    passed: int
    pass_rate: float
    pass_rate_ci95_low: float = Field(default=0.0, ge=0, le=1)
    pass_rate_ci95_high: float = Field(default=0.0, ge=0, le=1)
    unique_cases: int = Field(default=0, ge=0)
    stable_passed_cases: int = Field(default=0, ge=0)
    repetitions: int = Field(default=1, ge=1)
    product_accepted: int = Field(default=0, ge=0)
    oracle_cases: int = Field(default=0, ge=0)
    oracle_passed: int = Field(default=0, ge=0)
    false_positives: int = Field(default=0, ge=0)
    false_negatives: int = Field(default=0, ge=0)
    first_candidate_passed: int = Field(default=0, ge=0)
    candidate_revisions: int = Field(default=0, ge=0)
    mean_candidates: float = Field(default=0, ge=0)
    recorded_llm_calls: int = Field(default=0, ge=0)
    recorded_input_tokens: int = Field(default=0, ge=0)
    recorded_output_tokens: int = Field(default=0, ge=0)
    cases: list[CaseResult]
    by_case: list[CaseAggregate] = Field(default_factory=list)
    by_difficulty: list[SliceAggregate] = Field(default_factory=list)
    by_workload: list[SliceAggregate] = Field(default_factory=list)
    metamorphic_groups: int = Field(default=0, ge=0)
    metamorphic_robust_groups: int = Field(default=0, ge=0)
    metamorphic_consistent_groups: int = Field(default=0, ge=0)
    metamorphic_robustness: float = Field(default=0.0, ge=0, le=1)
    metamorphic_consistency: float = Field(default=0.0, ge=0, le=1)
    by_semantic_group: list[MetamorphicAggregate] = Field(default_factory=list)
    by_prompt_variant: list[SliceAggregate] = Field(default_factory=list)
    note: str | None = None


class IntentTurn(BaseModel):
    """One prior conversation turn a follow-up case routes against."""

    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str


class IntentCase(BaseModel):
    """One AUTO-mode routing example, separate from end-to-end execution cases."""

    model_config = ConfigDict(extra="forbid")

    id: str
    split: Literal["calibration", "holdout"]
    cohort: str
    prompt: str
    expected_mode: Literal["chat", "execute"]
    # Attachment presence changes whether a referential request is input-ready;
    # the source itself is deliberately not sent to the routing model.
    has_source_code: bool = False
    # Empty for a standalone prompt. A follow-up routes against what came
    # before it, and the failure mode this exists to catch is the sticky
    # classifier: history that turns "thanks" into another execute run.
    history: list[IntentTurn] = Field(default_factory=list)


class IntentCaseResult(BaseModel):
    id: str
    split: Literal["calibration", "holdout"]
    cohort: str
    expected_mode: Literal["chat", "execute"]
    observed_mode: str
    correct: bool
    decision_source: str
    reason: str


class IntentReport(BaseModel):
    total: int
    correct: int
    accuracy: float
    by_cohort: dict[str, dict[str, int]]
    cases: list[IntentCaseResult]
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


def load_intent_corpus(
    path: str | Path,
    *,
    split: Literal["calibration", "holdout"] | None = None,
) -> list[IntentCase]:
    """Load the routing corpus while preserving its calibration/holdout split."""

    payload = yaml.safe_load(Path(path).read_text())
    if not isinstance(payload, list):
        raise ValueError("intent corpus must be a YAML list")
    cases = [IntentCase.model_validate(item) for item in payload]
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        raise ValueError("intent corpus case IDs must be unique")
    selected = [case for case in cases if split is None or case.split == split]
    return sorted(selected, key=lambda case: case.id)


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
