"""Production adapters for the deterministic ADR-0023 circuit pipeline."""

from __future__ import annotations

import ast
import hashlib
import json
import logging
import math
from dataclasses import asdict
from typing import Any, Awaitable, Callable, Literal, Mapping, Protocol, Sequence
from uuid import UUID, uuid5

from majorana_agent import (
    AgentState,
    BasicContractResult,
    CandidateRevision,
    CandidateStatus,
    ConversionEvidence,
    ExecutionEvidence,
    MaterializedArtifact,
    PlanRevision,
    SemanticReviewEvidence,
    SimpleFailureKind,
    SimplePipelineFailure,
    SimplePipelineStage,
    SimplePlan,
    SimplePortResult,
    SimpleReferenceProblem,
    SimpleRepairFeedback,
    SimpleRetryTarget,
    ToolCall,
    ToolName,
    ToolResult,
    parse_simple_plan,
)
from majorana_agent.templates import known_reference_for_task, trusted_hamiltonian_for_task
from majorana_contracts import Scope, VerificationSummary
from majorana_contracts.enums import (
    Algorithm,
    ArtifactType,
    ExportStatus,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_contracts.plan import (
    ConstraintTerm,
    ExactLinearSystemReference,
    ExactLindbladReference,
    IndexedPauliTerm,
    LindbladOperator,
    LinearConstraint,
    PauliTerm,
    Plan,
    ProblemTerm,
    ReferenceProblem,
    VerificationPlan,
)
from majorana_verification import (
    BaselineProblemError,
    DynamicsReferenceError,
    LindbladReferenceError,
    LindbladSpecification,
    LinearSystemReferenceError,
    PhaseEstimationReferenceError,
    ProblemSpecification,
    exact_dynamics_comparison,
    exact_dynamics_value,
    exact_lindblad_comparison,
    exact_lindblad_values,
    exact_linear_system_comparison,
    exact_linear_system_values,
    exact_phase_estimation_comparison,
    lindblad_references_equivalent,
    linear_system_references_equivalent,
    optimal_objective,
    reference_problems_equivalent,
    verify_brute_force,
    verify_exact_diag,
)
from majorana_frameworks import FrameworkProgram, extract_circuit_ir
from majorana_frameworks.roles import ProgramRole, result_was_derived
from majorana_llm import (
    LLMClient,
    LLMProviderError,
    LLMRequest,
    SIMPLE_ARTIFACT_REVIEW_SYSTEM_PROMPT,
    SIMPLE_BUSINESS_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_CONVERSATION_PLAN_ALIGNMENT_SYSTEM_PROMPT,
    SIMPLE_DYNAMICS_REFERENCE_AUDIT_SYSTEM_PROMPT,
    SIMPLE_LINDBLAD_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_LINEAR_SYSTEM_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
    SIMPLE_PLAN_SYSTEM_PROMPT,
    SIMPLE_REVIEW_SYSTEM_PROMPT,
    StageOutputError,
    extract_json,
    conversation_request_messages,
    model_for,
    simple_generation_system_prompt,
    with_execution_conversation_context,
)
from majorana_sandbox import DEFAULT_QUBIT_CEILING
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from majorana_api.db import AsyncSession
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo

from .runtime_ports import SandboxCandidateExecutor, TrustedOpenQASMConverter

log = logging.getLogger("majorana_worker.simple_ports")

# First generation stays deterministic; a REPAIR samples. At temperature 0 a repair
# whose prompt changed only slightly reproduces nearly the same program, so a run
# could spend its whole budget re-deriving one defect — the failure mode namekoQ
# avoids by accident, since it never pins temperature at all. Replay determinism is
# unaffected: every candidate is stored as its own immutable revision, and the
# durable LLM-call inbox replays the recorded response rather than re-sampling.
_REPAIR_TEMPERATURE = 0.4


def _prior_user_requests(
    conversation_messages: Sequence[Mapping[str, str]],
) -> list[str]:
    """Return the authoritative side of prior conversation turns.

    The role-preserving history remains on the provider request so the model can
    understand the conversation.  This second, structured view exists for a
    different reason: execution stages end in a large JSON user message, and a
    short referential instruction such as ``build it`` can otherwise be much
    more salient there than the concrete task several messages earlier.

    Only user text is copied.  Assistant explanations can help the model follow
    the dialogue, but they are not allowed to become missing instance data or a
    changed requirement merely because they are repeated near the current task.
    Production history is already bounded by the repository before it reaches
    this adapter; preserving every supplied user turn also lets the model decide
    whether the current request continues or replaces an older task.
    """

    return [
        content.strip()
        for message in conversation_messages
        if message.get("role") == "user"
        and isinstance((content := message.get("content")), str)
        and content.strip()
    ]


def _conversation_context_payload(
    prior_user_requests: Sequence[str],
    *,
    proposed_plan_summary: str | None = None,
    current_request: str | None = None,
) -> dict[str, object]:
    """Add explicit grounding only when a request actually has prior user turns."""

    if not prior_user_requests:
        return {}
    payload: dict[str, object] = {"prior_user_requests": list(prior_user_requests)}
    if proposed_plan_summary is not None:
        payload["proposed_plan_summary"] = proposed_plan_summary
    if current_request is not None:
        payload["current_request"] = current_request
    return payload


class SimpleStepObserver(Protocol):
    async def candidate_generated(
        self,
        run_id: UUID,
        candidate: CandidateRevision,
    ) -> None: ...

    async def tool_finished(self, run_id: UUID, result: ToolResult) -> None: ...


class SimplePipelineStore(Protocol):
    """Only the durable operations used by the fixed pipeline."""

    async def completed_tool_call(
        self,
        run_id: UUID,
        tool_call_id: str,
    ) -> ToolResult | None: ...

    async def begin_tool_call(self, run_id: UUID, call: ToolCall) -> None: ...

    async def finish_tool_call(self, run_id: UUID, result: ToolResult) -> None: ...

    async def plan_revision(self, run_id: UUID, plan_id: UUID) -> PlanRevision: ...

    async def append_plan_revision(self, record: PlanRevision) -> None: ...

    async def select_current_plan(self, run_id: UUID, plan_id: UUID) -> None: ...

    async def candidate_for_tool_call(
        self,
        run_id: UUID,
        tool_call_id: str,
    ) -> CandidateRevision | None: ...

    async def add_candidate(self, candidate: CandidateRevision) -> None: ...

    async def set_candidate_status(
        self,
        run_id: UUID,
        candidate_id: UUID,
        status: str,
    ) -> None: ...

    async def execution_for(
        self,
        run_id: UUID,
        candidate_id: UUID,
    ) -> ExecutionEvidence | None: ...

    async def add_execution(self, evidence: ExecutionEvidence) -> None: ...

    async def semantic_review(
        self,
        run_id: UUID,
        candidate_id: UUID,
        review_id: UUID,
    ) -> SemanticReviewEvidence | None: ...

    async def latest_semantic_review(
        self,
        run_id: UUID,
        candidate_id: UUID,
    ) -> SemanticReviewEvidence | None: ...

    async def append_semantic_review(self, evidence: SemanticReviewEvidence) -> None: ...

    async def conversion_for(
        self,
        run_id: UUID,
        candidate_id: UUID,
    ) -> ConversionEvidence | None: ...

    async def add_conversion(self, evidence: ConversionEvidence) -> None: ...

    async def materialization_for(
        self,
        run_id: UUID,
        candidate_id: UUID,
    ) -> MaterializedArtifact | None: ...

    async def add_materialization(self, materialization: MaterializedArtifact) -> None: ...


class ReviewArtifactSaver(Protocol):
    async def save(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact: ...

    async def save_unexecuted(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact: ...


class SimpleIntentReviewResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    decision: SemanticReviewDecision
    critic: dict[str, Any]
    failure_class: VerificationFailureClass | None = None
    retry_target: RetryTarget = RetryTarget.NONE
    reason_code: str


class IntentReviewer(Protocol):
    async def review(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        basic_checks: list[dict[str, Any]],
        attempt: int,
    ) -> SimpleIntentReviewResult: ...


_REVIEWABLE_DECISIONS = (
    SemanticReviewDecision.READY,
    SemanticReviewDecision.CODE_REPAIR,
    SemanticReviewDecision.REPLAN,
)

_REVIEW_ROUTING: dict[
    SemanticReviewDecision, tuple[VerificationFailureClass | None, RetryTarget]
] = {
    SemanticReviewDecision.READY: (None, RetryTarget.NONE),
    SemanticReviewDecision.CODE_REPAIR: (
        VerificationFailureClass.CANDIDATE_DEFECT,
        RetryTarget.CODE_GENERATION,
    ),
    SemanticReviewDecision.REPLAN: (
        VerificationFailureClass.PLAN_DEFECT,
        RetryTarget.PLANNING,
    ),
}


#: The only severities and confidences that clear a review, stated as a positive
#: permission rather than as a list of prohibitions. A grade this module does not
#: recognise — a new enum member, a model that answered off-schema, a field that
#: some later refactor made optional and left unset — is therefore a denial. The
#: inverse spelling ("severity not in {major, blocking}") reads an absent grade as
#: permission, which is precisely how a blocking review reaches a user as passed.
_ACCEPTING_SEVERITIES = frozenset({"none", "minor"})
_ACCEPTING_CONFIDENCES = frozenset({"high", "medium"})


def _decide(
    output: "_IntentReviewOutput",
    deterministic_failed: list[str],
) -> SemanticReviewDecision:
    """Turn one advisory review into an actionable next step. Never a dead end.

    The controller — not the reviewer — owns transitions, so this only has to
    answer "accept, or fix which layer?". The verdict and its disposition are two
    separate questions, asked in that order and never fused:

    * VERDICT — does this review clear the candidate? Only a review that passed
      every deterministic check AND graded itself acceptable does. A blocking or
      major severity, a low confidence, or a grade this module cannot read is a
      refusal, and no amount of missing follow-up detail converts it into an
      acceptance. `_summary_reason_code` publishes READY to the user as
      "ai_review_aligned", which `apps/web/lib/run-outcome.ts` renders as "the
      circuit executed and matched the request" — so collapsing a refusal into
      READY tells a user their circuit passed a review that said it had not.
    * DISPOSITION — given a refusal, which layer gets the next attempt? Only that
      second question consults the reviewer's own routing, defaulting to the
      candidate.

    Deliberately no fourth "cannot tell" outcome. That state named no next step,
    so the controller regenerated identical evidence until the candidate budget
    ran out — and because the Plan escalation in SimpleCircuitPipeline._next_action
    keys on CONSECUTIVE code repairs, a run stuck this way never spent its replan
    budget at all. Repairing the candidate is a strictly better fallback: it is
    bounded by the same budget, it feeds the reviewer's own findings back to the
    generator, and two consecutive repairs now escalate to a replan on their own.

    Within an accepting grade, uncertainty alone does not consume a source
    revision: a reviewer that asks for another candidate while naming no failed
    check, no mismatch and no repair instruction has described a residual risk,
    not a defect, and the artifact still saves as INCONCLUSIVE. That allowance is
    scoped to a clean grade on purpose. `failed_checks`, `mismatches` and
    `repair_instructions` all default to `[]` in model-authored JSON, so an empty
    one is an absence of evidence and must never be read as evidence of absence.

    A refusal is not a failed run. The controller repairs, and if it exhausts its
    budget the run still delivers on trusted evidence — as
    `trusted_evidence_without_review_acceptance`, with "intent alignment" listed
    among the unverified claims. That is the honest surface for this state, and it
    already exists; reaching it costs a candidate revision, which is cheaper than
    a wrong sentence on a user's screen.
    """

    graded_acceptable = (
        output.severity in _ACCEPTING_SEVERITIES and output.confidence in _ACCEPTING_CONFIDENCES
    )
    if deterministic_failed or not graded_acceptable:
        if output.decision is SemanticReviewDecision.REPLAN:
            return SemanticReviewDecision.REPLAN
        return SemanticReviewDecision.CODE_REPAIR

    if output.decision is SemanticReviewDecision.READY:
        return SemanticReviewDecision.READY
    actionable_finding = bool(
        output.failed_checks or output.mismatches or output.repair_instructions
    )
    if not actionable_finding:
        return SemanticReviewDecision.READY
    if output.decision is SemanticReviewDecision.REPLAN:
        return SemanticReviewDecision.REPLAN
    return SemanticReviewDecision.CODE_REPAIR


class _StaticRiskAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Literal[
        "execution_unverified",
        "hardware_unverified",
        "sampling_uncertainty",
        "formulation_uncertainty",
        "implementation_uncertainty",
        "baseline_incomplete",
        "backend_contract_uncertainty",
    ]
    detail: str = Field(min_length=1, max_length=1_000)


class _StaticReadiness(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective_and_constraints_preserved: bool
    plan_source_consistent: bool
    backend_entrypoint_complete: bool
    baseline_requirement_satisfied: bool
    no_fabricated_results: bool


class _IntentReviewOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    # The reviewer picks between three ACTIONABLE outcomes. `inconclusive` stays in
    # SemanticReviewDecision so stored reviews from the tool-loop era still decode,
    # but schema-guided decoding must not be able to ask for it: it named no next
    # step, so the controller could only regenerate the same evidence until the
    # candidate budget ran out. See _decide() below.
    decision: SemanticReviewDecision = Field(
        json_schema_extra={"enum": [decision.value for decision in _REVIEWABLE_DECISIONS]}
    )
    confidence: Literal["high", "medium", "low"]
    severity: Literal["none", "minor", "major", "blocking"]
    # Review prose is advisory evidence, not a machine-control field. DeepSeek
    # occasionally gives a sound review that exceeds the requested prose budget
    # by a few words; reject malformed decisions, but normalize bounded display
    # fields rather than converting that harmless excess into a failed run.
    summary: str = Field(min_length=1, max_length=1_200)
    passed_checks: list[str] = Field(default_factory=list, max_length=12)
    failed_checks: list[str] = Field(default_factory=list, max_length=12)
    mismatches: list[str] = Field(default_factory=list, max_length=6)
    repair_instructions: list[str] = Field(default_factory=list, max_length=6)
    residual_risks: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode="before")
    @classmethod
    def _normalize_display_bounds(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        summary = normalized.get("summary")
        if isinstance(summary, str):
            normalized["summary"] = summary.strip()[:1_200]
        for name, limit in {
            "passed_checks": 12,
            "failed_checks": 12,
            "mismatches": 6,
            "repair_instructions": 6,
            "residual_risks": 6,
        }.items():
            entries = normalized.get(name)
            if isinstance(entries, list):
                normalized[name] = [
                    item.strip()[:1_000] if isinstance(item, str) else item
                    for item in entries[:limit]
                ]
        return normalized


class _ConversationPlanAlignmentChecks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objective: bool
    instance_data: bool
    constraints: bool
    scale: bool
    requested_algorithm_or_framework: bool = Field(
        description=(
            "True when every explicitly requested algorithm/framework is preserved, or "
            "when the user did not constrain that choice; false only for contradiction "
            "of an explicit user choice"
        )
    )
    requested_outputs: bool

    @property
    def all_preserved(self) -> bool:
        return all(self.model_dump().values())


class _ConversationPlanAlignmentOutput(BaseModel):
    """Independent request reconstruction and pre-generation Plan gate."""

    model_config = ConfigDict(extra="forbid")

    ready_for_execution: bool = Field(
        description=(
            "Whether authoritative user text supplies the answer-determining task data; "
            "independent of Plan quality and not contingent on user-supplied quantum design"
        )
    )
    authoritative_task_summary: str = Field(min_length=1, max_length=2_000)
    missing_inputs: list[str] = Field(
        default_factory=list,
        max_length=8,
        description="Missing user problem data only, never Plan defects or design choices",
    )
    request_alignment: _ConversationPlanAlignmentChecks
    mismatches: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="before")
    @classmethod
    def _normalize_bounded_text(cls, value: Any) -> Any:
        if not isinstance(value, dict):
            return value
        normalized = dict(value)
        summary = normalized.get("authoritative_task_summary")
        if isinstance(summary, str):
            normalized["authoritative_task_summary"] = summary.strip()[:2_000]
        for name in ("missing_inputs", "mismatches"):
            entries = normalized.get(name)
            if isinstance(entries, list):
                normalized[name] = [
                    item.strip()[:1_000] if isinstance(item, str) else item for item in entries[:8]
                ]
        return normalized

    @model_validator(mode="after")
    def _validate_decision_evidence(self) -> _ConversationPlanAlignmentOutput:
        if not self.ready_for_execution:
            if not self.missing_inputs:
                raise ValueError("an input-incomplete request must name missing inputs")
        elif self.missing_inputs:
            raise ValueError("an execution-ready request cannot retain missing inputs")
        if (
            self.ready_for_execution
            and not self.request_alignment.all_preserved
            and not self.mismatches
        ):
            raise ValueError("a rejected Plan must name at least one mismatch")
        if self.ready_for_execution and self.request_alignment.all_preserved and self.mismatches:
            raise ValueError("an accepted Plan cannot retain mismatches")
        return self


class _ArtifactIntentReviewOutput(_IntentReviewOutput):
    """Static-only fields are schema-required only when execution was not run."""

    risk_assessments: list[_StaticRiskAssessment] = Field(max_length=6)
    static_readiness: _StaticReadiness


_STATIC_REPLAN_FIELDS = frozenset({"objective_and_constraints_preserved"})
_STATIC_BLOCKING_RISKS = frozenset(
    {
        "formulation_uncertainty",
        "implementation_uncertainty",
        "baseline_incomplete",
        "backend_contract_uncertainty",
    }
)


def _static_review_failures(output: _ArtifactIntentReviewOutput) -> tuple[list[str], bool]:
    """Return deterministic static-review gates and whether Plan must change.

    Execution, hardware, and sampling uncertainty are honest residual risks for an
    unexecuted artifact. A risk that can change the objective, feasible set, source,
    baseline, or backend contract is a defect and cannot coexist with READY.
    """

    failed = [
        f"static_readiness.{name}"
        for name, value in output.static_readiness.model_dump().items()
        if value is not True
    ]
    force_replan = any(item.rsplit(".", 1)[-1] in _STATIC_REPLAN_FIELDS for item in failed)

    if len(output.risk_assessments) != len(output.residual_risks):
        failed.append("static_risk_classification")
    for risk in output.risk_assessments:
        if risk.category in _STATIC_BLOCKING_RISKS:
            failed.append(f"static_risk.{risk.category}")
            force_replan = force_replan or risk.category == "formulation_uncertainty"
    return list(dict.fromkeys(failed)), force_replan


class SimpleIntentReviewer:
    """One model call that advises on intent alignment without strict checks."""

    def __init__(
        self,
        *,
        llm: LLMClient,
        task_prompt: str,
        conversation_messages: Sequence[Mapping[str, str]] = (),
    ) -> None:
        self._llm = llm
        self._task_prompt = task_prompt
        self._conversation_messages = tuple(conversation_messages)
        self._prior_user_requests = _prior_user_requests(self._conversation_messages)

    async def review(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        basic_checks: list[dict[str, Any]],
        attempt: int,
    ) -> SimpleIntentReviewResult:
        artifact_only = execution.was_not_run
        output_model = _ArtifactIntentReviewOutput if artifact_only else _IntentReviewOutput
        user = json.dumps(
            {
                "request": self._task_prompt,
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.problem_summary,
                ),
                "review_attempt": attempt,
                "plan": plan.model_dump(mode="json"),
                "candidate": {
                    "framework": candidate.framework.value,
                    "source": candidate.source,
                    "source_fingerprint": candidate.source_fingerprint,
                },
                "execution": {
                    "status": "not_run" if artifact_only else "executed",
                    "execution_id": str(execution.execution_id),
                    "source_fingerprint": execution.source_fingerprint,
                    "exit_code": execution.exit_code,
                    "result": execution.result,
                    "resource_metrics": execution.observation.get("resource_metrics"),
                    "reason_code": execution.observation.get("execution_reason_code"),
                    "target_backend": execution.observation.get("target_backend"),
                    "declared_qubits": execution.observation.get("qubits"),
                    "local_execution_ceiling_qubits": execution.observation.get(
                        "local_execution_ceiling_qubits"
                    ),
                },
                "basic_checks": basic_checks,
                "known_reference": known_reference_for_task(
                    (
                        f"{self._task_prompt}\n{plan.problem_summary}"
                        if self._prior_user_requests
                        else self._task_prompt
                    )
                ),
            },
            default=str,
            sort_keys=True,
        )
        response = await self._llm.complete(
            LLMRequest(
                model=model_for("verify"),
                system=with_execution_conversation_context(
                    (
                        SIMPLE_ARTIFACT_REVIEW_SYSTEM_PROMPT
                        if artifact_only
                        else SIMPLE_REVIEW_SYSTEM_PROMPT
                    ),
                    has_history=bool(self._conversation_messages),
                ),
                user=user,
                messages=conversation_request_messages(
                    self._conversation_messages,
                    user,
                ),
                temperature=0.0,
                response_schema=output_model.model_json_schema(),
                schema_name="intent_alignment",
            )
        )
        output = output_model.model_validate_json(extract_json(response.text))
        deterministic_passed = [
            str(check.get("method"))
            for check in basic_checks
            if check.get("result") == "pass" and check.get("method")
        ]
        deterministic_failed = [
            str(check.get("method"))
            for check in basic_checks
            if check.get("result") != "pass" and check.get("method")
        ]
        force_replan = False
        if artifact_only:
            static_failed, force_replan = _static_review_failures(output)
            deterministic_failed.extend(static_failed)
            if force_replan:
                output = output.model_copy(update={"decision": SemanticReviewDecision.REPLAN})
        output = output.model_copy(
            update={
                "passed_checks": list(
                    dict.fromkeys([*output.passed_checks, *deterministic_passed])
                )[:12],
                "failed_checks": list(
                    dict.fromkeys([*output.failed_checks, *deterministic_failed])
                )[:12],
            }
        )

        decision = _decide(output, deterministic_failed)
        failure_class, retry_target = _REVIEW_ROUTING[decision]
        return SimpleIntentReviewResult(
            decision=decision,
            critic=output.model_dump(mode="json"),
            failure_class=failure_class,
            retry_target=retry_target,
            reason_code=(
                {
                    SemanticReviewDecision.READY: "static_intent_aligned",
                    SemanticReviewDecision.CODE_REPAIR: "static_code_mismatch",
                    SemanticReviewDecision.REPLAN: "static_plan_mismatch",
                }
                if artifact_only
                else {
                    SemanticReviewDecision.READY: "intent_aligned",
                    SemanticReviewDecision.CODE_REPAIR: "intent_code_mismatch",
                    SemanticReviewDecision.REPLAN: "intent_plan_mismatch",
                }
            )[decision],
        )


#: Widest histogram a saved artifact carries. A 20-qubit measurement can produce
#: more distinct bitstrings than anything a reader or a chart can use, so the
#: stored copy keeps the heaviest outcomes and says so.
MAX_STORED_OUTCOMES = 64
#: Scalars beyond this are display noise; the program's own RESULT stays intact
#: in the run's execution evidence either way.
MAX_STORED_VALUES = 16
#: Longest accepted outcome/metric key. Wider than any simulable bitstring.
MAX_KEY_CHARS = 64


def _representable(value: int | float) -> float | None:
    """The value as a finite float, or None if it cannot be one.

    Python ints are arbitrary precision, so a sandbox program returning something
    like 10**400 reaches here as a perfectly valid int — and `math.isfinite` on it
    raises OverflowError rather than answering, which would abort the save of a run
    that had already executed and passed review. It also could not survive the JSON
    round-trip into the browser, which parses it as Infinity and drops it anyway.

    A number that cannot reach the reader is not storable evidence.
    """
    try:
        number = float(value)
    except (OverflowError, ValueError):
        return None
    return number if math.isfinite(number) else None


def measured_result_summary(result: dict[str, Any]) -> dict[str, Any] | None:
    """Bounded projection of what the program actually measured, for the artifact.

    The run surface reads these numbers from the event stream, but the artifact is
    the object a researcher keeps, reopens and cites — and it carried the verdict,
    the prose and the resource estimates while the measured distribution existed
    only on the run. Reopening a saved Bell state showed "3 checks passed" and no
    counts.

    Everything here is sandbox output derived from model-authored code, so nothing
    is passed through: keys are coerced and length-capped, values must really be
    numbers, cardinality is bounded, and `shots`/`outcome_count` describe the FULL
    distribution even when `counts` holds only the heaviest slice. A truncated
    histogram that silently reported a truncated total would misstate the
    experiment rather than abbreviate it.

    Returns None when nothing survives projection, so an artifact never carries an
    empty shell that the UI would have to distinguish from real emptiness.
    """

    counts: dict[str, int] = {}
    values: dict[str, float] = {}
    for key, value in result.items():
        name = str(key)
        # Reject an overlong key rather than truncate it. Truncating makes two
        # distinct outcomes collide on their shared prefix and silently overwrite
        # each other, which would leave `shots` and `outcome_count` describing a
        # distribution that never existed — the opposite of what they promise. A
        # measured bitstring longer than MAX_KEY_CHARS is past every simulation
        # ceiling in the product anyway, so nothing real is lost.
        if len(name) > MAX_KEY_CHARS:
            continue
        if name == "counts" and isinstance(value, dict):
            for bitstring, count in value.items():
                # bool is an int subclass; a measurement count is never a bool.
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    continue
                outcome = str(bitstring)
                if len(outcome) > MAX_KEY_CHARS or _representable(count) is None:
                    continue
                counts[outcome] = count
        elif isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        elif (number := _representable(value)) is not None:
            values[name] = number

    outcome_count = len(counts)
    shots = sum(counts.values())
    if outcome_count > MAX_STORED_OUTCOMES:
        heaviest = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
        counts = dict(heaviest[:MAX_STORED_OUTCOMES])

    summary: dict[str, Any] = {}
    if outcome_count:
        summary["counts"] = counts
        summary["shots"] = shots
        summary["outcome_count"] = outcome_count
        summary["truncated"] = outcome_count > MAX_STORED_OUTCOMES
    if values:
        summary["values"] = dict(list(values.items())[:MAX_STORED_VALUES])
    return summary or None


def _return_contract_check(result: dict[str, Any], observation: dict[str, Any]) -> dict[str, Any]:
    """Did the SOURCE return what it said it would?

    The third writer of a claim whose other two were already fixed, and it was
    missed. This list is persisted in `feedback["basic_checks"]` and is sent to
    the reviewer model, so a derived result made one run tell the reviewer the
    return contract passed while telling the artifact there was no return to
    contract with.

    `n/a`, not `fail`: nothing went wrong. A circuit reported nothing because a
    circuit reports nothing.
    """
    if result_was_derived(observation):
        return {
            "method": "return_contract",
            "result": "n/a",
            "details": {
                "result_origin": "derived_from_circuit",
                "result_keys": sorted(result),
            },
        }
    return {
        "method": "return_contract",
        "result": "pass",
        "details": {"result_keys": sorted(result)},
    }


#: How a recorded check's bare string maps onto the typed public vocabulary.
#:
#: Every value the worker writes has a member except `"n/a"`, which
#: `_return_contract_check` records when the platform derived the result from the
#: circuit: the program made no claim, so the check did not run rather than
#: failing. SKIPPED is that state — see `VerificationResultKind`, which says
#: SKIPPED means "not applicable by design" and that it never establishes a
#: candidate defect.
_RECORDED_RESULT_KINDS: dict[str, VerificationResultKind] = {
    "pass": VerificationResultKind.PASS,
    "fail": VerificationResultKind.FAIL,
    "skipped": VerificationResultKind.SKIPPED,
    "unavailable": VerificationResultKind.UNAVAILABLE,
    "error": VerificationResultKind.ERROR,
    "n/a": VerificationResultKind.SKIPPED,
}


def _project_recorded_checks(
    recorded: Sequence[Mapping[str, Any]],
) -> tuple[list[dict[str, object]], bool]:
    """Narrow a review's own deterministic checks into the public projection.

    Returns the typed checks and whether ANY recorded check failed.

    The second value is computed over every recorded entry, including the ones
    that do not project. `framework_boundary` and `execution_claims` are recorded
    by the unexecuted path and are not `VerificationMethod` members, so they
    cannot be *named* in a `VerificationCheckSummary` — but a failure that cannot
    be named must still be counted. Dropping an unprojectable check from the list
    AND from the verdict is precisely how a summary comes to report that nothing
    failed while something did.
    """

    projected: list[dict[str, object]] = []
    any_failed = False
    for check in recorded:
        if not isinstance(check, Mapping):
            continue
        result = _RECORDED_RESULT_KINDS.get(str(check.get("result")))
        if result is VerificationResultKind.FAIL:
            any_failed = True
        try:
            method = VerificationMethod(str(check.get("method")))
        except ValueError:
            continue
        if result is None:
            continue
        projected.append({"method": method, "result": result})
    return projected, any_failed


def simple_pipeline_verification_summary(
    reference_methods: Sequence[VerificationMethod] = (),
    semantic_review_decision: SemanticReviewDecision = SemanticReviewDecision.READY,
    *,
    result_derived: bool = False,
    recorded_checks: Sequence[Mapping[str, Any]],
    review_severity: str | None = None,
) -> dict[str, object]:
    """Return the single typed trust projection for a completed simple run.

    A simple pipeline proves that the generated program executed and how it fared
    against its basic structural/result contract. The AI review is advisory, so a
    clean run's decision stays explicitly inconclusive rather than becoming a PASS.

    `recorded_checks` is the review's own `basic_checks` and it is REQUIRED, with
    no default, on purpose. This function used to synthesise an all-PASS list from
    nothing but the reference methods, which meant a candidate whose
    `success_criteria` check had come back FAIL was filed with a summary asserting
    that it passed. Making the evidence an argument the caller cannot forget is
    what stops that from being one missing keyword away — see
    `_project_recorded_checks` for why a failure that cannot be projected is still
    counted.

    Plan-declared reference checks that ran and passed raise evidence_strength to
    PHYSICAL — the grade `EvidenceStrength` was split out to express: one limited
    claim really was compared against what the physics should do, while the overall
    decision remains INCONCLUSIVE because the other claims still are not supported.
    A physical check that ran and FAILED does not lift the grade, which is
    `evidence_strength_of`'s rule rather than one restated here.
    """

    checks, any_check_failed = _project_recorded_checks(recorded_checks)
    if VerificationMethod.EXACT in reference_methods and not any(
        check["method"] is VerificationMethod.EXACT for check in checks
    ):
        # `passed_reference_methods` reads a PASSING success_criteria check whose
        # declared protocol is an exact one as an EXACT comparison. That is the one
        # piece of real evidence not recorded under its own method name, so it is
        # added here rather than silently lost from the grade.
        checks.append({"method": VerificationMethod.EXACT, "result": VerificationResultKind.PASS})

    unverified = ["physical fidelity", "optimality"]
    if not recorded_checks:
        # An empty `checks` list is read by a person as "nothing failed". Say which
        # of the two it is, because "no check found a problem" and "no check ran"
        # are the same picture and opposite facts.
        unverified.insert(0, "every deterministic check (none was recorded for this candidate)")
    if review_severity in {"major", "blocking"}:
        # Model-authored opinion, so it never becomes a FAIL decision — that word is
        # reserved for a check that ran and established a mismatch. But an artifact
        # the reviewer called broken must not be filed under a label that mentions
        # only what the deterministic checks did not catch. The store used to refuse
        # this candidate outright; now that it is kept, the severity has to be
        # carried rather than dropped along with the refusal.
        unverified.append(f"intent alignment (the reviewer recorded a {review_severity} defect)")
    if result_derived:
        # RETURN_CONTRACT is "the program reported what it said it would". A
        # CIRCUIT reported nothing — the platform sampled it and made that the
        # result — so the recorded check is SKIPPED rather than passed: nothing
        # went wrong, there was simply no return to contract with.
        #
        # The claim withdrawn beside it is the one that matters most. A derived
        # result comes from the same trusted evidence any later check would
        # compare it against, so agreement between them is `f(x) == f(x)` — a
        # comparison that cannot fail, which is worse than no comparison.
        unverified.insert(0, "reported output (the result was derived, not returned)")
    if not reference_methods:
        unverified.insert(0, "quantum correctness")
    if semantic_review_decision is not SemanticReviewDecision.READY:
        # Delivered on trusted evidence alone. Say so rather than letting a reader
        # infer that the reviewer signed off on intent.
        unverified.append("intent alignment")

    if any_check_failed:
        # The repository classifies, it does not exclude (owner, 2026-08-03) — so
        # this candidate is still filed. What must not happen is filing it under a
        # label that describes a different candidate. A deterministic check that
        # ran and established a mismatch IS a candidate defect, which is the one
        # thing `VerifierDecision.INCONCLUSIVE` is forbidden to say: the contract's
        # `inconclusive_never_blames_the_candidate` validator would reject it.
        summary = VerificationSummary(
            decision=VerifierDecision.FAIL,
            semantic_review_decision=semantic_review_decision,
            evidence_strength=evidence_strength_of(checks),
            reason_code="deterministic_check_failed",
            candidate_defect_observed=True,
            failure_class=VerificationFailureClass.CANDIDATE_DEFECT,
            retry_target=RetryTarget.CODE_GENERATION,
            unverified_claims=unverified,
            checks=checks,
        )
        return summary.model_dump(mode="json")

    summary = VerificationSummary(
        decision=VerifierDecision.INCONCLUSIVE,
        semantic_review_decision=semantic_review_decision,
        evidence_strength=evidence_strength_of(checks),
        reason_code=_summary_reason_code(reference_methods, semantic_review_decision),
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.EVIDENCE_GAP,
        retry_target=RetryTarget.NONE,
        unverified_claims=unverified,
        checks=checks,
    )
    return summary.model_dump(mode="json")


def unexecuted_artifact_verification_summary(
    review: SemanticReviewEvidence | None = None,
) -> dict[str, object]:
    """Trust projection for source that no connected backend executed."""

    reason_code = "artifact_generated_execution_not_run"
    if review is not None:
        reason_code = (
            "artifact_static_review_ready_execution_not_run"
            if review.decision is SemanticReviewDecision.READY
            else "artifact_static_review_unresolved_execution_not_run"
        )

    return VerificationSummary(
        decision=VerifierDecision.INCONCLUSIVE,
        semantic_review_decision=review.decision if review is not None else None,
        evidence_strength=None,
        reason_code=reason_code,
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.EVIDENCE_GAP,
        retry_target=RetryTarget.NONE,
        unverified_claims=[
            "reported output",
            "quantum correctness",
            "physical fidelity",
            "optimality",
            "intent alignment",
        ],
        checks=[],
    ).model_dump(mode="json")


def _artifact_review_status(
    review: SemanticReviewEvidence | None,
    *,
    unexecuted: bool,
) -> str:
    if review is None:
        return "not_available"
    if unexecuted:
        return (
            "static_aligned"
            if review.decision is SemanticReviewDecision.READY
            else "static_not_accepted"
        )
    return "aligned" if review.decision is SemanticReviewDecision.READY else "not_accepted"


def _artifact_review_advisory(
    plan: Plan,
    review: SemanticReviewEvidence | None,
    reference_methods: Sequence[VerificationMethod],
    *,
    unexecuted: bool,
) -> str:
    if unexecuted and review is None:
        return (
            "The framework-native source was generated, but static AI review was "
            "unavailable and no connected backend could execute this scale. No RESULT "
            "or correctness claim was evaluated."
        )
    if unexecuted and review is not None:
        if review.decision is SemanticReviewDecision.READY:
            return (
                "Static AI review found no concrete request/Plan/source mismatch, but "
                "no connected backend executed this scale. No RESULT, quantum-"
                "correctness, fidelity, optimality, or hardware claim was evaluated."
            )
        return (
            "Static AI review left concrete issues unresolved when the bounded repair "
            "budget ended. The source is retained for inspection, and no RESULT or "
            "correctness claim was evaluated."
        )
    if review is not None and review.decision is not SemanticReviewDecision.READY:
        return (
            "The AI intent review did not accept this candidate within the run's "
            "budget. It is delivered on its trusted evidence alone: it executed, "
            "satisfied the basic result contract"
            + (
                f", and matched the Plan's declared reference "
                f"({', '.join(method.value for method in reference_methods)})."
                if reference_methods
                else "."
            )
            + " Intent alignment was not established."
        )
    if reference_methods:
        return (
            "AI intent review is advisory. The reported "
            f"{plan.success_criteria.primary_metric} was checked against the Plan's "
            "declared reference "
            f"({', '.join(method.value for method in reference_methods)}); no other "
            "quantum property, and no claim of optimality, was evaluated."
        )
    return (
        "AI intent review is advisory; strict quantum correctness and optimality "
        "were not evaluated."
    )


def _artifact_export_reason(
    qasm: str | None,
    conversion: ConversionEvidence | None,
    *,
    unexecuted: bool,
) -> str | None:
    if qasm:
        return None
    if conversion is not None:
        return conversion.reason
    if unexecuted:
        return "full execution not run; framework-native source is canonical"
    return "framework export unavailable"


def _summary_reason_code(
    reference_methods: Sequence[VerificationMethod],
    semantic_review_decision: SemanticReviewDecision,
) -> str:
    if semantic_review_decision is not SemanticReviewDecision.READY:
        return "trusted_evidence_without_review_acceptance"
    return "ai_review_aligned_with_reference_check" if reference_methods else "ai_review_aligned"


class RepoReviewArtifactSaver:
    """Persist a private AI-reviewed artifact without fabricating strict evidence."""

    def __init__(
        self,
        *,
        scope: Scope,
        session: AsyncSession,
        run_id: UUID,
        parent_artifact_id: UUID | None,
        title: str,
        parent_artifact_version_id: UUID | None = None,
        parent_artifact_fingerprint: str | None = None,
        auto_keep: bool = False,
        artifact_limit: int | None = None,
    ) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id
        self._parent_artifact_id = parent_artifact_id
        self._parent_artifact_version_id = parent_artifact_version_id
        self._parent_artifact_fingerprint = parent_artifact_fingerprint
        self._title = title
        # Resolved once when the run is set up, not on the save path: save runs
        # after every expensive stage has succeeded and is the worst place to
        # add a query that can fail. Defaults False -- the direction where an
        # artifact still exists and can be kept by hand.
        self._auto_keep = auto_keep
        # The owner's allowance, resolved at setup for exactly the same reason.
        # `None` means unlimited. Auto-keep used to file straight past this by
        # passing `kept=True` into `create_artifact`, which takes no limit and
        # reserves nothing -- so a workspace that opted into auto-keep had no
        # artifact cap at all, one run at a time.
        self._artifact_limit = artifact_limit

    async def save(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact:
        if not execution.succeeded:
            raise ValueError("artifact save requires successful execution")
        review.assert_binding(candidate, execution)
        # Permissive about the VERDICT, never about whether there is a record. A
        # failed check is evidence and is filed under a FAIL label; a review that
        # examined nothing would be filed under no label at all.
        if not review.has_recorded_checks():
            raise ValueError("artifact save requires recorded deterministic checks")
        if conversion is not None and not (
            conversion.candidate_id == candidate.candidate_id
            and conversion.execution_id == execution.execution_id
            and conversion.source_fingerprint == candidate.source_fingerprint
        ):
            raise ValueError("conversion fingerprint/execution binding mismatch")

        return await self._materialize(
            candidate,
            plan,
            execution=execution,
            review=review,
            conversion=conversion,
            execution_status="executed",
        )

    async def save_unexecuted(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence | None,
        plan: Plan,
    ) -> MaterializedArtifact:
        if not execution.was_not_run:
            raise ValueError("unexecuted artifact save requires trusted not-run preflight evidence")
        if execution.candidate_id != candidate.candidate_id or (
            execution.source_fingerprint != candidate.source_fingerprint
        ):
            raise ValueError("unexecuted artifact fingerprint/execution binding mismatch")
        if review is not None:
            review.assert_binding(candidate, execution)
        return await self._materialize(
            candidate,
            plan,
            execution=execution,
            review=review,
            conversion=None,
            execution_status="not_run",
        )

    async def _materialize(
        self,
        candidate: CandidateRevision,
        plan: Plan,
        *,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence | None,
        conversion: ConversionEvidence | None,
        execution_status: Literal["executed", "not_run"],
    ) -> MaterializedArtifact:
        unexecuted = execution_status == "not_run"
        if not unexecuted and review is None:
            raise ValueError("executed materialization requires semantic review evidence")
        artifact_id = self._parent_artifact_id
        save_as_copy = (
            artifact_id is not None
            and self._parent_artifact_fingerprint != candidate.source_fingerprint
        )
        if artifact_id is None or save_as_copy:
            # The run always materializes -- the Run surface's conversion tabs
            # read this version and the next turn forks from it. What the
            # workspace setting decides is only whether the result is listed in
            # the Vault straight away or waits for "Keep this" (0036). A new
            # version of an artifact the user already kept is not re-asked
            # about: this branch is the only one that mints a new artifact.
            artifact = await artifacts_repo.create_artifact(
                self._scope,
                self._session,
                slug=f"run-{self._run_id.hex[:12]}",
                title=self._title[:200],
                family=plan.algorithm,
                framework=candidate.framework,
                parent_artifact_id=self._parent_artifact_id if save_as_copy else None,
                # Never filed here. Filing is `keep_artifact`'s job, because that
                # is where the workspace's cap lock is held across the comparison
                # and the write.
                kept=False,
            )
            artifact_id = artifact.id
            if self._auto_keep:
                try:
                    await artifacts_repo.keep_artifact(
                        self._scope,
                        self._session,
                        artifact.id,
                        workspace_artifact_limit=self._artifact_limit,
                    )
                except artifacts_repo.ArtifactCapReached:
                    # Left UNKEPT rather than raised. The run already succeeded
                    # and has already been paid for in model tokens and sandbox
                    # time; failing it here would destroy a result the account is
                    # entitled to over a listing preference. The artifact exists,
                    # the Run surface still shows it, and "Keep this" files it as
                    # soon as the workspace has room -- which is exactly what a
                    # workspace without auto-keep does for every run.
                    pass
                except artifacts_repo.ProjectFull:  # pragma: no cover - new rows have no project
                    pass

        qasm = (
            conversion.qasm
            if not unexecuted and conversion is not None and conversion.status == "available"
            else None
        )
        export_status = ExportStatus.LOSSLESS if qasm else ExportStatus.UNSUPPORTED
        export_reason = _artifact_export_reason(qasm, conversion, unexecuted=unexecuted)
        critic = review.feedback.get("critic") if review is not None else None
        critic = critic if isinstance(critic, dict) else {}
        residual_risks = critic.get("residual_risks")
        residual_risks = (
            [str(item)[:1000] for item in residual_risks][:20]
            if isinstance(residual_risks, list)
            else []
        )
        review_status = _artifact_review_status(review, unexecuted=unexecuted)
        reference_methods = (
            passed_reference_methods(review) if review is not None and not unexecuted else ()
        )
        advisory = _artifact_review_advisory(
            plan,
            review,
            reference_methods,
            unexecuted=unexecuted,
        )
        limitations = "\n".join(dict.fromkeys([*residual_risks, advisory]))
        if unexecuted:
            verification_summary = unexecuted_artifact_verification_summary(review)
        else:
            assert review is not None
            verification_summary = simple_pipeline_verification_summary(
                reference_methods,
                review.decision,
                result_derived=result_was_derived(execution.observation),
                recorded_checks=recorded_basic_checks(review),
                review_severity=review.severity,
            )
        metadata: dict[str, object] = {
            "source": "simple_pipeline_candidate",
            "candidate_id": str(candidate.candidate_id),
            "candidate_revision": candidate.revision,
            "source_fingerprint": candidate.source_fingerprint,
            "execution_id": str(execution.execution_id),
            "semantic_review_id": str(review.review_id) if review is not None else None,
            "canonical_representation": "framework_code",
            "openqasm_role": "interchange" if qasm else "unavailable",
            "review_summary": {
                "status": review_status,
                "decision": review.decision.value if review is not None else None,
                "reason_code": (
                    review.reason_code
                    if review is not None
                    else "execution_not_run_no_semantic_review"
                ),
                "confidence": review.confidence if review is not None else None,
                "severity": review.severity if review is not None else None,
                "summary": critic.get("summary"),
                "residual_risks": residual_risks,
            },
            "verification_summary": verification_summary,
            # What the run produced, and — when the source was a circuit — WHERE
            # it came from. A reader looking at counts on a saved artifact cannot
            # otherwise tell a program's own finding from a sample the platform
            # took of a circuit that reported nothing, and those are different
            # claims about the same numbers.
            "result_origin": (
                "not_available"
                if unexecuted
                else "derived_from_circuit"
                if result_was_derived(execution.observation)
                else "returned_by_program"
            ),
            "measured_result": (None if unexecuted else measured_result_summary(execution.result)),
            "execution": {
                "status": execution_status,
                "provider": execution.sandbox_provider,
                "reason_code": execution.observation.get("execution_reason_code"),
                "target_backend": execution.observation.get("target_backend"),
            },
            "export_manifest": {
                "review_status": review_status,
                "warning": (
                    "OpenQASM does not carry AI-review context; retain this manifest "
                    "with the exported file."
                    if qasm
                    else None
                ),
            },
        }
        # Studio's display sidecar is derived by provider-owned observer code
        # from the exact FINAL_CIRCUIT that ran. It is optional like OpenQASM,
        # but serves a different purpose: unknown framework instructions remain
        # visible as read-only blocks instead of forcing a lossy decomposition
        # or an empty canvas. Re-validate the sandbox JSON before persistence;
        # malformed or user-shaped values never cross into artifact metadata.
        circuit_ir = None if unexecuted else extract_circuit_ir(execution.observation).circuit_ir
        if circuit_ir is not None:
            metadata["circuit_ir"] = circuit_ir
        if save_as_copy:
            metadata["provenance"] = {
                "kind": "save_as_copy",
                "parent_artifact_id": str(self._parent_artifact_id),
                "parent_artifact_version_id": (
                    str(self._parent_artifact_version_id)
                    if self._parent_artifact_version_id is not None
                    else None
                ),
            }
        resource_metrics = execution.observation.get("resource_metrics")
        if unexecuted:
            resource_metrics = {
                key: execution.observation[key]
                for key in (
                    "qubits",
                    "estimated_memory_mb",
                    "memory_limit_mb",
                    "estimate_model",
                    "local_execution_ceiling_qubits",
                    "target_backend",
                )
                if key in execution.observation
            }
        version = await artifacts_repo.create_version(
            self._scope,
            self._session,
            artifact_id,
            qasm_version="3.0" if qasm else None,
            qasm=qasm,
            metadata=metadata,
            code=candidate.source,
            code_lang=candidate.framework.value,
            fingerprint=candidate.source_fingerprint,
            export_status=export_status,
            export_reason=export_reason,
            framework_variants=None,
            resource_estimates=(resource_metrics if isinstance(resource_metrics, dict) else None),
            limitations=limitations,
        )
        await runs_repo.set_run_artifact_version(
            self._scope, self._session, self._run_id, version.id
        )
        return MaterializedArtifact(
            artifact_id=artifact_id,
            version_id=version.id,
            version_seq=version.seq,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
            execution_status=execution_status,
        )


class _GeneratedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=200_000)


class _ReferenceAuditOutput(BaseModel):
    """Independent request-to-reference check before generation can inherit it."""

    model_config = ConfigDict(extra="forbid")

    valid: bool
    errors: list[str] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def _validity_matches_errors(self) -> "_ReferenceAuditOutput":
        self.errors = [item.strip()[:1_000] for item in self.errors if item.strip()]
        if self.valid and self.errors:
            raise ValueError("a valid audit cannot report semantic mismatches")
        if not self.valid and not self.errors:
            raise ValueError("an invalid audit must name at least one mismatch")
        return self


class _BusinessReferenceExtraction(BaseModel):
    """A second derivation, not a yes/no opinion about the planner's reference."""

    model_config = ConfigDict(extra="forbid")

    supported: bool
    reason: str | None = Field(default=None, max_length=1_000)
    reference: SimpleReferenceProblem | None = None

    @model_validator(mode="after")
    def _support_matches_the_reference(self) -> "_BusinessReferenceExtraction":
        if self.supported != (self.reference is not None):
            raise ValueError("supported must be true exactly when reference is present")
        if not self.supported and (self.reason is None or not self.reason.strip()):
            raise ValueError("an unsupported extraction must state the missing capability or data")
        if self.reason is not None:
            self.reason = self.reason.strip()[:1_000] or None
        return self


class _LindbladReferenceExtraction(BaseModel):
    """A second typed derivation of one bounded open-system problem."""

    model_config = ConfigDict(extra="forbid")

    supported: bool
    reason: str | None = Field(default=None, max_length=1_000)
    reference: ExactLindbladReference | None = None

    @model_validator(mode="after")
    def _support_matches_the_reference(self) -> "_LindbladReferenceExtraction":
        if self.supported != (self.reference is not None):
            raise ValueError("supported must be true exactly when reference is present")
        if not self.supported and (self.reason is None or not self.reason.strip()):
            raise ValueError("an unsupported extraction must state the missing capability or data")
        if self.reason is not None:
            self.reason = self.reason.strip()[:1_000] or None
        return self


class _LinearSystemReferenceExtraction(BaseModel):
    """A request-derived bounded A*x=b problem and its scalar meanings."""

    model_config = ConfigDict(extra="forbid")

    supported: bool
    reason: str | None = Field(default=None, max_length=1_000)
    reference: ExactLinearSystemReference | None = None

    @model_validator(mode="after")
    def _support_matches_the_reference(self) -> "_LinearSystemReferenceExtraction":
        if self.supported != (self.reference is not None):
            raise ValueError("supported must be true exactly when reference is present")
        if not self.supported and (self.reason is None or not self.reason.strip()):
            raise ValueError("an unsupported extraction must state the missing capability or data")
        if self.reason is not None:
            self.reason = self.reason.strip()[:1_000] or None
        return self


_SIMULATION_TOOL = {
    Framework.QISKIT: ToolName.SIMULATE_QISKIT,
    Framework.CIRQ: ToolName.SIMULATE_CIRQ,
    Framework.PENNYLANE: ToolName.SIMULATE_PENNYLANE,
    Framework.BRAKET: ToolName.SIMULATE_BRAKET,
    Framework.QIBO: ToolName.SIMULATE_QIBO,
    Framework.QULACS: ToolName.SIMULATE_QULACS,
}


def _plan_fingerprint(plan: Plan) -> str:
    payload = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


def _reference_problem_requires_audit(plan: Plan) -> bool:
    """Every model-authored combinatorial reference needs independent consensus.

    In prior real evaluations, a boolean reviewer both rejected a correct assignment
    oracle and approved a sign-flipped project-selection oracle. A second derivation can
    instead be compared over all assignments. Only agreement earns the reference;
    disagreement removes the unsafe check without blocking otherwise runnable work.
    """

    verification = plan.verification_plan
    if verification is None or VerificationMethod.BRUTE_FORCE not in verification.methods:
        return False
    problem = verification.reference_problem
    return problem is not None


def _reference_problem_spec(problem: ReferenceProblem) -> ProblemSpecification:
    return {
        "kind": problem.kind,
        "num_variables": problem.num_variables,
        "terms": [(term.i, term.j, term.weight) for term in problem.terms],
        "offset": problem.offset,
        "objective": problem.objective,
        "constraints": [
            (
                [(term.i, term.weight) for term in constraint.terms],
                constraint.sense,
                constraint.rhs,
            )
            for constraint in problem.constraints
        ],
    }


def _reference_problem_call_args(plan: Plan) -> ProblemSpecification:
    verification = plan.verification_plan
    if verification is None or verification.reference_problem is None:
        raise BaselineProblemError("brute-force reference problem is missing")
    return _reference_problem_spec(verification.reference_problem)


def _durable_business_reference(reference: SimpleReferenceProblem) -> ReferenceProblem:
    objective = reference.business_objective
    return ReferenceProblem(
        kind="qubo",
        num_variables=reference.num_variables,
        terms=[
            ProblemTerm(
                i=term.variable,
                j=term.variable,
                weight=term.coefficient,
            )
            for term in objective.linear_coefficients
        ]
        + [
            ProblemTerm(
                i=term.left,
                j=term.right,
                weight=term.coefficient,
            )
            for term in objective.quadratic_coefficients
        ],
        offset=objective.constant,
        objective=objective.direction,
        constraints=[
            LinearConstraint(
                terms=[
                    ConstraintTerm(i=term.variable, weight=term.coefficient)
                    for term in constraint.coefficients
                ],
                sense=constraint.sense,
                rhs=constraint.rhs,
            )
            for constraint in reference.business_constraints
        ],
    )


def _without_brute_force_reference(plan: Plan) -> Plan:
    verification = plan.verification_plan
    if verification is None:
        return plan
    methods = [
        method for method in verification.methods if method is not VerificationMethod.BRUTE_FORCE
    ]
    if not methods:
        methods = [VerificationMethod.RETURN_CONTRACT]
    reference_method = (
        verification.reference_method
        if any(
            method in {VerificationMethod.EXACT_DIAG, VerificationMethod.EXACT}
            for method in methods
        )
        else None
    )
    return plan.model_copy(
        update={
            "verification_plan": verification.model_copy(
                update={
                    "methods": methods,
                    "reference_problem": None,
                    "reference_method": reference_method,
                }
            )
        }
    )


def _indexed_pauli_string(term: IndexedPauliTerm, num_qubits: int) -> str:
    """Materialize identity padding deterministically, with q0 leftmost."""

    paulis = ["I"] * num_qubits
    for factor in term.factors:
        paulis[factor.qubit] = factor.pauli
    return "".join(paulis)


def _dynamics_reference_call_args(plan: Plan) -> dict[str, Any]:
    verification = plan.verification_plan
    if verification is None or verification.exact_dynamics_reference is None:
        raise DynamicsReferenceError("exact dynamics reference is missing")
    reference = verification.exact_dynamics_reference
    return {
        "terms": [
            (term.coefficient, _indexed_pauli_string(term, reference.num_qubits))
            for term in reference.hamiltonian
        ],
        "initial_basis_state": reference.initial_basis_state,
        "evolution_time": reference.evolution_time,
        "metric": reference.metric,
        "observable": (
            [
                (term.coefficient, _indexed_pauli_string(term, reference.num_qubits))
                for term in reference.observable
            ]
            if reference.observable is not None
            else None
        ),
    }


def _lindblad_operator_spec(
    operator: LindbladOperator,
) -> list[tuple[complex, list[tuple[int, str]]]]:
    return [
        (
            complex(term.coefficient.real, term.coefficient.imag),
            [(factor.qubit, factor.operator) for factor in term.factors],
        )
        for term in operator.terms
    ]


def _lindblad_reference_spec(reference: ExactLindbladReference) -> LindbladSpecification:
    results: list[dict[str, Any]] = []
    for result in reference.results:
        item: dict[str, Any] = {
            "result_key": result.result_key,
            "metric": result.metric,
        }
        for name in ("basis_state", "row_state", "column_state"):
            value = getattr(result, name)
            if value is not None:
                item[name] = value
        if result.observable is not None:
            item["observable"] = _lindblad_operator_spec(result.observable)
        results.append(item)
    return {
        "num_qubits": reference.num_qubits,
        "initial_product_state": list(reference.initial_product_state),
        "hamiltonian": (
            _lindblad_operator_spec(reference.hamiltonian)
            if reference.hamiltonian is not None
            else None
        ),
        "dissipators": [
            (dissipator.rate, _lindblad_operator_spec(dissipator.jump))
            for dissipator in reference.dissipators
        ],
        "evolution_time": reference.evolution_time,
        "results": results,
    }


def _should_attempt_lindblad_reference(plan: Plan, task_prompt: str) -> bool:
    """Route likely open-system tasks to optional typed reference extraction.

    This is a domain router, not an answer parser: coefficients, states, times, and
    result meanings remain typed model output and must survive independent semantic
    comparison before the deterministic verifier can use them. A false routing
    decision only costs a bounded extraction call before falling back to weaker review.
    """

    verification = plan.verification_plan
    if verification is not None and verification.exact_lindblad_reference is not None:
        return True
    domain = plan.domain.lower().replace("_", "-")
    if "open" in domain and ("quantum" in domain or "system" in domain):
        return True
    request = f"{task_prompt}\n{plan.problem_summary}".lower()
    return any(
        marker in request
        for marker in (
            "lindblad",
            "liouvillian",
            "master equation",
            "d rho/dt",
            "dρ/dt",
            "dissipator",
        )
    )


def _should_attempt_linear_system_reference(plan: Plan, task_prompt: str) -> bool:
    """Route likely A*x=b tasks without interpreting their numeric answer."""

    verification = plan.verification_plan
    if verification is not None and verification.exact_linear_system_reference is not None:
        return True
    domain = plan.domain.lower().replace("_", "-")
    if "linear" in domain and ("quantum" in domain or "system" in domain):
        return True
    request = f"{task_prompt}\n{plan.problem_summary}".lower()
    return any(
        marker in request
        for marker in (
            "hhl",
            "linear system",
            "linear-system",
            "a*x=b",
            "ax=b",
            "matrix a",
        )
    )


def _apply_trusted_task_reference(plan: Plan, task_prompt: str) -> Plan:
    """Replace model-authored H2 coefficients with the server-owned reference.

    The model still chooses the result key and implementation, but it cannot earn a
    physical evidence grade by making the Plan and generated code agree on the same
    fabricated Hamiltonian. Preserve only a tightening tolerance from the Plan.
    """

    terms = trusted_hamiltonian_for_task(task_prompt)
    if terms is None or plan.algorithm is not Algorithm.VQE:
        return plan
    thresholds = plan.verification_plan.thresholds if plan.verification_plan is not None else None
    return plan.model_copy(
        update={
            "verification_plan": VerificationPlan(
                methods=[VerificationMethod.EXACT_DIAG],
                reference_method="server_owned_task_reference",
                reference_hamiltonian=[
                    PauliTerm(coefficient=coefficient, pauli=pauli) for coefficient, pauli in terms
                ],
                thresholds=thresholds,
            )
        }
    )


def _reconcile_exact_diag_success_criteria(plan: Plan) -> SimplePortResult[Plan]:
    """Let exact diagonalization, not model-authored prose, own the numeric criterion."""

    verification = plan.verification_plan
    if (
        verification is None
        or VerificationMethod.EXACT_DIAG not in verification.methods
        or not verification.reference_hamiltonian
    ):
        return SimplePortResult.success(plan)
    outcome = verify_exact_diag(
        [(term.coefficient, term.pauli) for term in verification.reference_hamiltonian],
        0.0,
        shots=plan.parameters.shots,
    )
    if outcome.details.get("fault") == "plan":
        return _failure(
            kind=SimpleFailureKind.PLAN,
            stage=SimplePipelineStage.PLANNING,
            code="exact_diag_reference_unusable",
            message="Plan-declared Hamiltonian cannot be diagonalized",
            retryable=True,
            retry_target=SimpleRetryTarget.PLANNING,
            details={"reference_errors": [str(outcome.details.get("reason", "unknown"))]},
        )
    scores = outcome.details.get("scores")
    exact = scores.get("exact_ground_state_energy") if isinstance(scores, dict) else None
    if (
        not isinstance(exact, int | float)
        or isinstance(exact, bool)
        or not math.isfinite(float(exact))
    ):
        return _failure(
            kind=SimpleFailureKind.PLAN,
            stage=SimplePipelineStage.PLANNING,
            code="exact_diag_reference_unusable",
            message="Exact diagonalization did not produce a finite ground-state energy",
            retryable=True,
            retry_target=SimpleRetryTarget.PLANNING,
        )
    reference_metric = verification.reference_result_key or plan.success_criteria.primary_metric
    expected_range = (
        (plan.success_criteria.expected_range or {})
        if reference_metric == plan.success_criteria.primary_metric
        else {}
    )
    lower = expected_range.get("min")
    upper = expected_range.get("max")
    outside = (
        isinstance(lower, int | float)
        and not isinstance(lower, bool)
        and exact < float(lower)
        and not math.isclose(exact, float(lower), rel_tol=1e-12, abs_tol=1e-12)
    ) or (
        isinstance(upper, int | float)
        and not isinstance(upper, bool)
        and exact > float(upper)
        and not math.isclose(exact, float(upper), rel_tol=1e-12, abs_tol=1e-12)
    )
    criteria_updates: dict[str, Any] = {"additional_notes": None}
    if outside:
        criteria_updates["expected_range"] = None
    reconciled_verification = verification.model_copy(
        update={
            "reference_method": verification.reference_method
            or "plan_declared_hamiltonian_exact_diagonalization"
        }
    )
    return SimplePortResult.success(
        plan.model_copy(
            update={
                "success_criteria": plan.success_criteria.model_copy(update=criteria_updates),
                "verification_plan": reconciled_verification,
            }
        )
    )


def _reconcile_exact_qpe_success_criteria(plan: Plan) -> Plan:
    """Remove model-authored prose/ranges that contradict exact dyadic QPE truth."""

    verification = plan.verification_plan
    reference = verification.exact_phase_estimation_reference if verification is not None else None
    if reference is None:
        return plan
    scale = 1 << reference.counting_qubits
    exact_values = {
        reference.phase_integer_result_key: float(round(reference.eigenphase * scale) % scale),
        reference.phase_estimate_result_key: reference.eigenphase,
        reference.peak_probability_result_key: 1.0,
    }
    exact = exact_values[plan.success_criteria.primary_metric]
    expected_range = plan.success_criteria.expected_range or {}
    lower = expected_range.get("min")
    upper = expected_range.get("max")
    outside = (
        isinstance(lower, int | float)
        and not isinstance(lower, bool)
        and exact < float(lower)
        and not math.isclose(exact, float(lower), rel_tol=1e-12, abs_tol=1e-12)
    ) or (
        isinstance(upper, int | float)
        and not isinstance(upper, bool)
        and exact > float(upper)
        and not math.isclose(exact, float(upper), rel_tol=1e-12, abs_tol=1e-12)
    )
    return plan.model_copy(
        update={
            "success_criteria": plan.success_criteria.model_copy(
                update={
                    "additional_notes": None,
                    **({"expected_range": None} if outside else {}),
                }
            ),
            "verification_plan": verification.model_copy(
                update={
                    "reference_method": verification.reference_method
                    or "plan_declared_exact_dyadic_phase_estimation"
                }
            ),
        }
    )


def _preserve_replan_range_strength(previous: Plan, proposed: Plan) -> Plan:
    """Do not let rejected candidate output launder itself into a weaker threshold."""

    previous_criteria = previous.success_criteria
    proposed_criteria = proposed.success_criteria
    if previous_criteria.primary_metric != proposed_criteria.primary_metric:
        return proposed
    previous_range = previous_criteria.expected_range
    if not previous_range:
        return proposed
    proposed_range = proposed_criteria.expected_range
    if not proposed_range:
        weakened = True
    else:
        previous_lower = previous_range.get("min")
        previous_upper = previous_range.get("max")
        proposed_lower = proposed_range.get("min")
        proposed_upper = proposed_range.get("max")
        weakened = (
            previous_lower is not None
            and (proposed_lower is None or float(proposed_lower) < float(previous_lower))
        ) or (
            previous_upper is not None
            and (proposed_upper is None or float(proposed_upper) > float(previous_upper))
        )
    if not weakened:
        return proposed
    return proposed.model_copy(
        update={
            "success_criteria": proposed_criteria.model_copy(
                update={
                    "expected_range": previous_range,
                    "additional_notes": previous_criteria.additional_notes,
                }
            )
        }
    )


def _reconcile_exact_linear_system_success_criteria(
    plan: Plan,
) -> SimplePortResult[Plan]:
    """Make the independently solved linear system own numeric Plan truth."""

    verification = plan.verification_plan
    reference = verification.exact_linear_system_reference if verification else None
    if reference is None:
        return SimplePortResult.success(plan)
    try:
        exact_values, _ = exact_linear_system_values(reference)
    except LinearSystemReferenceError as exc:
        return _failure(
            kind=SimpleFailureKind.PLAN,
            stage=SimplePipelineStage.PLANNING,
            code="linear_system_reference_unusable",
            message="Plan-declared linear system cannot be solved independently",
            retryable=True,
            retry_target=SimpleRetryTarget.PLANNING,
            details={"reference_errors": [str(exc)]},
        )
    exact = exact_values[plan.success_criteria.primary_metric]
    expected_range = plan.success_criteria.expected_range or {}
    lower = expected_range.get("min")
    upper = expected_range.get("max")
    outside = (
        isinstance(lower, int | float)
        and not isinstance(lower, bool)
        and exact < float(lower)
        and not math.isclose(exact, float(lower), rel_tol=1e-12, abs_tol=1e-12)
    ) or (
        isinstance(upper, int | float)
        and not isinstance(upper, bool)
        and exact > float(upper)
        and not math.isclose(exact, float(upper), rel_tol=1e-12, abs_tol=1e-12)
    )
    return SimplePortResult.success(
        plan.model_copy(
            update={
                "success_criteria": plan.success_criteria.model_copy(
                    update={
                        "additional_notes": None,
                        **({"expected_range": None} if outside else {}),
                    }
                ),
                "verification_plan": verification.model_copy(
                    update={
                        "reference_method": verification.reference_method
                        or "plan_declared_dense_linear_system"
                    }
                ),
            }
        )
    )


def _feedback_digest(feedback: SimpleRepairFeedback | None) -> str:
    if feedback is None:
        return "initial"
    payload = json.dumps(asdict(feedback), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


def _success_criteria_check(
    plan: Plan,
    execution: ExecutionEvidence,
) -> dict[str, Any]:
    """Project namekoQ's result-vs-success-criteria check into trusted evidence."""

    metric = plan.success_criteria.primary_metric
    expected_range = plan.success_criteria.expected_range or {}
    observed = execution.result.get(metric)
    details: dict[str, Any] = {
        "primary_metric": metric,
        "observed": observed,
        "expected_range": expected_range or None,
        "additional_notes": plan.success_criteria.additional_notes,
    }
    if metric not in execution.result:
        return {
            "method": "success_criteria",
            "result": "fail",
            "details": details | {"reason": "primary metric is missing from RESULT"},
        }
    qpe_reference = (
        plan.verification_plan.exact_phase_estimation_reference
        if plan.verification_plan is not None
        else None
    )
    if qpe_reference is not None:
        try:
            passed, reference_details = exact_phase_estimation_comparison(
                qpe_reference,
                execution.result,
                requested_shots=plan.parameters.shots,
            )
        except PhaseEstimationReferenceError as exc:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | {
                    "reason": "exact phase-estimation reference could not read RESULT",
                    "error": str(exc),
                },
            }
        exact_values = {
            qpe_reference.phase_integer_result_key: reference_details["scores"][
                "exact_phase_integer"
            ],
            qpe_reference.phase_estimate_result_key: reference_details["scores"][
                "exact_phase_estimate"
            ],
            qpe_reference.peak_probability_result_key: 1.0,
        }
        exact = float(exact_values[metric])
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        if (
            isinstance(lower, int | float) and not isinstance(lower, bool) and exact < float(lower)
        ) or (
            isinstance(upper, int | float) and not isinstance(upper, bool) and exact > float(upper)
        ):
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | reference_details
                | {
                    "reason": "Plan expected_range excludes exact phase-estimation truth",
                    "fault": "plan",
                },
            }
        return {
            "method": "success_criteria",
            "result": "pass" if passed else "fail",
            "details": details
            | reference_details
            | {
                "reason": (
                    "all QPE scalars and protected counts match exact dyadic truth"
                    if passed
                    else "QPE RESULT disagrees with exact dyadic phase-estimation truth"
                )
            },
        }
    linear_reference = (
        plan.verification_plan.exact_linear_system_reference
        if plan.verification_plan is not None
        else None
    )
    if linear_reference is not None:
        try:
            passed, reference_details = exact_linear_system_comparison(
                linear_reference,
                execution.result,
            )
        except LinearSystemReferenceError as exc:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | {
                    "reason": "exact linear-system reference is unusable as declared",
                    "error": str(exc),
                    "fault": "plan",
                },
            }
        exact = float(reference_details["scores"][metric]["exact"])
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        if (
            isinstance(lower, int | float) and not isinstance(lower, bool) and exact < float(lower)
        ) or (
            isinstance(upper, int | float) and not isinstance(upper, bool) and exact > float(upper)
        ):
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | reference_details
                | {
                    "reason": "Plan expected_range excludes exact linear-system truth",
                    "fault": "plan",
                },
            }
        return {
            "method": "success_criteria",
            "result": "pass" if passed else "fail",
            "details": details
            | reference_details
            | {
                "reason": (
                    "all declared scalars match the independently solved linear system"
                    if passed
                    else "declared scalars disagree with the exact linear-system solution"
                )
            },
        }
    lindblad_reference = (
        plan.verification_plan.exact_lindblad_reference
        if plan.verification_plan is not None
        else None
    )
    if lindblad_reference is not None:
        try:
            passed, reference_details = exact_lindblad_comparison(
                _lindblad_reference_spec(lindblad_reference),
                execution.result,
            )
        except LindbladReferenceError as exc:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | {
                    "reason": "exact Lindblad reference is unusable as declared",
                    "error": str(exc),
                    "fault": "plan",
                },
            }
        exact = reference_details["scores"][metric]["exact"]
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        truth_below = (
            isinstance(lower, int | float)
            and not isinstance(lower, bool)
            and exact < float(lower)
            and not math.isclose(exact, float(lower), rel_tol=1e-12, abs_tol=1e-12)
        )
        truth_above = (
            isinstance(upper, int | float)
            and not isinstance(upper, bool)
            and exact > float(upper)
            and not math.isclose(exact, float(upper), rel_tol=1e-12, abs_tol=1e-12)
        )
        if truth_below or truth_above:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | reference_details
                | {
                    "reason": "Plan expected_range excludes exact Lindblad truth",
                    "fault": "plan",
                },
            }
        return {
            "method": "success_criteria",
            "result": "pass" if passed else "fail",
            "details": details
            | reference_details
            | {
                "reason": (
                    "all declared scalars match exact Plan-declared Lindblad evolution"
                    if passed
                    else "declared scalars disagree with exact Plan-declared Lindblad evolution"
                )
            },
        }
    dynamics_reference = (
        plan.verification_plan.exact_dynamics_reference
        if plan.verification_plan is not None
        else None
    )
    if dynamics_reference is not None:
        if (
            isinstance(observed, bool)
            or not isinstance(observed, (int, float))
            or not math.isfinite(float(observed))
        ):
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | {"reason": "exact dynamics requires a finite numeric primary metric"},
            }
        try:
            passed, reference_details = exact_dynamics_comparison(
                **_dynamics_reference_call_args(plan),
                reported_value=float(observed),
            )
        except DynamicsReferenceError as exc:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | {
                    "reason": "exact dynamics reference is unusable as declared",
                    "error": str(exc),
                    "fault": "plan",
                },
            }
        exact = reference_details["scores"]["exact_dynamics_value"]
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        truth_below = (
            isinstance(lower, int | float)
            and not isinstance(lower, bool)
            and exact < float(lower)
            and not math.isclose(exact, float(lower), rel_tol=1e-12, abs_tol=1e-12)
        )
        truth_above = (
            isinstance(upper, int | float)
            and not isinstance(upper, bool)
            and exact > float(upper)
            and not math.isclose(exact, float(upper), rel_tol=1e-12, abs_tol=1e-12)
        )
        if truth_below or truth_above:
            return {
                "method": "success_criteria",
                "result": "fail",
                "details": details
                | reference_details
                | {
                    "reason": "Plan expected_range excludes exact dynamics truth",
                    "fault": "plan",
                },
            }
        return {
            "method": "success_criteria",
            "result": "pass" if passed else "fail",
            "details": details
            | reference_details
            | {
                "reason": (
                    "primary metric matches exact Plan-declared dynamics"
                    if passed
                    else "primary metric disagrees with exact Plan-declared dynamics"
                )
            },
        }
    if not expected_range:
        return {
            "method": "success_criteria",
            "result": "pass",
            "details": details | {"reason": "primary metric is present; no range was supplied"},
        }
    if (
        isinstance(observed, bool)
        or not isinstance(observed, (int, float))
        or not math.isfinite(float(observed))
    ):
        return {
            "method": "success_criteria",
            "result": "fail",
            "details": details
            | {"reason": "expected_range requires a finite numeric primary metric"},
        }
    lower = expected_range.get("min")
    upper = expected_range.get("max")
    observed_number = float(observed)

    # Simulator results often differ from an exact Plan boundary by only a handful of
    # IEEE-754 ulps. Treating that as a semantic defect can burn the entire candidate
    # budget while the source and result remain mathematically correct. This tolerance
    # is many orders of magnitude tighter than physical or shot-noise tolerance; it
    # absorbs only floating-point representation error at a closed interval boundary.
    def meets_lower(bound: float | None) -> bool:
        return (
            bound is None
            or observed_number >= bound
            or math.isclose(
                observed_number,
                bound,
                rel_tol=1e-12,
                abs_tol=1e-12,
            )
        )

    def meets_upper(bound: float | None) -> bool:
        return (
            bound is None
            or observed_number <= bound
            or math.isclose(
                observed_number,
                bound,
                rel_tol=1e-12,
                abs_tol=1e-12,
            )
        )

    passed = meets_lower(lower) and meets_upper(upper)
    return {
        "method": "success_criteria",
        "result": "pass" if passed else "fail",
        "details": details
        | {
            "reason": (
                "primary metric satisfies the supplied range"
                if passed
                else "primary metric is outside the supplied range"
            )
        },
    }


def _reference_checks(
    plan: Plan,
    execution: ExecutionEvidence,
) -> list[dict[str, Any]]:
    """Run every reference the Plan declared as data against the reported metric.

    The only checks in the fixed pipeline that can disagree with a program which is
    internally consistent but physically wrong. Both verifiers read the protected
    ``RESULT`` and the Plan's own declared operator/instance — never the candidate
    source, never stdout — so nothing the generator writes can satisfy them by
    construction.

    Every declared method runs. A Plan may name more than one, and quietly checking
    only the first would put a method in the evidence that nothing ever evaluated —
    the precise failure this feature exists to make impossible.

    Returns an empty list when the Plan declared no usable reference; that is an
    honest weaker grade, not a pass, and the run is graded exactly as it was before
    these checks existed.
    """

    verification_plan = plan.verification_plan
    if verification_plan is None:
        return []
    primary_metric = plan.success_criteria.primary_metric
    thresholds = verification_plan.thresholds or {}
    outcomes: list[tuple[Any, str, Any]] = []

    if VerificationMethod.EXACT_DIAG in verification_plan.methods:
        terms = verification_plan.reference_hamiltonian
        # The Plan contract already refuses `exact_diag` without an operator; skipping
        # rather than diagonalizing an empty one keeps a stored plan that predates that
        # rule from being reported as a check that ran.
        if terms:
            metric = verification_plan.reference_result_key or primary_metric
            reported = execution.result.get(metric)
            outcomes.append(
                (
                    verify_exact_diag(
                        [(term.coefficient, term.pauli) for term in terms],
                        reported,
                        shots=plan.parameters.shots,
                        # A declared tolerance may only TIGHTEN the computed bound;
                        # verify_exact_diag applies the min() itself, so pass it through
                        # rather than pre-selecting a winner here.
                        declared_tolerance=thresholds.get(
                            f"{metric}_error_max", thresholds.get("energy_error_max")
                        ),
                    ),
                    metric,
                    reported,
                )
            )

    if VerificationMethod.BRUTE_FORCE in verification_plan.methods:
        problem = verification_plan.reference_problem
        if problem is not None:
            metric = primary_metric
            reported = execution.result.get(metric)
            args = _reference_problem_call_args(plan)
            outcomes.append(
                (
                    verify_brute_force(
                        args.pop("kind"),
                        args.pop("num_variables"),
                        args.pop("terms"),
                        reported,
                        **args,
                    ),
                    metric,
                    reported,
                )
            )

    return [
        {
            "method": outcome.method.value,
            "result": "pass" if outcome.result is VerificationResultKind.PASS else "fail",
            "details": dict(outcome.details) | {"primary_metric": metric, "reported": reported},
        }
        for outcome, metric, reported in outcomes
    ]


_REFERENCE_METHODS = frozenset(
    {VerificationMethod.EXACT, VerificationMethod.EXACT_DIAG, VerificationMethod.BRUTE_FORCE}
)
_EXACT_SUCCESS_PROTOCOLS = frozenset(
    {
        "exact_pauli_dynamics",
        "exact_lindblad_evolution",
        "exact_dyadic_phase_estimation",
        "exact_dense_linear_system",
    }
)


def _reference_check_routing(
    checks: list[dict[str, Any]],
    success_criteria_check: dict[str, Any] | None = None,
) -> tuple[SemanticReviewDecision, str] | None:
    """Route a failed reference check deterministically, without asking the model.

    namekoQ hands an equivalent verdict to its critic as prose and lets the model
    decide what to do with it. Here the check already established a concrete mismatch
    against declared data, so the routing is a fact, not a judgement: a reference the
    verifier could not use at all is a Plan defect (``fault: plan``), and a reference
    it used to contradict the reported number is a candidate defect.

    A Plan defect outranks a candidate defect when both appear. Rewriting the source
    against a reference that is itself unusable cannot converge, and the run has a
    separate, larger budget for exactly that escalation. The same is true when the
    Plan's expected range excludes the independently computed truth itself: no
    candidate can satisfy both checks, so replan immediately instead of spending a
    code-repair candidate first.
    """

    failed = [check for check in checks if check.get("result") != "pass"]
    if any((check.get("details") or {}).get("fault") == "plan" for check in failed):
        return SemanticReviewDecision.REPLAN, "reference_declaration_unusable"
    success_details = (
        success_criteria_check.get("details")
        if isinstance(success_criteria_check, dict)
        and success_criteria_check.get("result") == "fail"
        else None
    )
    expected_range = (
        success_details.get("expected_range") if isinstance(success_details, dict) else None
    )
    if isinstance(expected_range, dict):
        success_metric = success_details.get("primary_metric")
        reference_values: list[float] = []
        for check in checks:
            details = check.get("details")
            if not isinstance(details, dict) or details.get("primary_metric") != success_metric:
                continue
            scores = details.get("scores") if isinstance(details, dict) else None
            if not isinstance(scores, dict):
                continue
            value = scores.get(
                "exact_ground_state_energy",
                scores.get("optimal_value", scores.get("exact_dynamics_value")),
            )
            if isinstance(value, int | float) and not isinstance(value, bool):
                reference_values.append(float(value))
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        if any(
            (isinstance(lower, int | float) and value < float(lower))
            or (isinstance(upper, int | float) and value > float(upper))
            for value in reference_values
        ):
            return SemanticReviewDecision.REPLAN, "success_criteria_excludes_reference_truth"
    if not failed:
        return None
    return SemanticReviewDecision.CODE_REPAIR, "reference_check_failed"


def _reference_routing_critic(
    advisory: dict[str, Any],
    checks: list[dict[str, Any]],
    decision: SemanticReviewDecision,
) -> dict[str, Any]:
    """Keep deterministic reference evidence from becoming speculative repair prose."""

    failed = [check for check in checks if check.get("result") != "pass"]
    disagreements: list[str] = []
    for check in failed:
        details = check.get("details") or {}
        plural = details.get("disagreements")
        if isinstance(plural, list):
            disagreements.extend(str(item) for item in plural)
        singular = details.get("disagreement")
        if isinstance(singular, str) and singular.strip():
            disagreements.append(singular)
    if decision is SemanticReviewDecision.REPLAN:
        return advisory | {
            "decision": "replan",
            "confidence": "high",
            "severity": "major",
            "summary": (
                "The deterministic reference is unusable or contradicts the Plan; "
                "source repair cannot satisfy this declaration."
            ),
            "failed_checks": [str(check.get("method", "reference")) for check in failed],
            "mismatches": disagreements
            or ["The Plan's declared reference cannot be used consistently."],
            "repair_instructions": [
                "Re-derive the typed reference and success criterion from the request; "
                "do not modify candidate code against a contradictory Plan."
            ],
        }

    protocols: set[str] = set()
    exact_diag_failures: list[dict[str, Any]] = []
    for check in failed:
        details = check.get("details") or {}
        protocol = details.get("protocol")
        if isinstance(protocol, dict) and isinstance(protocol.get("name"), str):
            protocols.add(protocol["name"])
            if protocol["name"] == "exact_diagonalization":
                exact_diag_failures.append(details)
    instructions = [
        "Repair the computation that produces the protected RESULT values first. "
        "Do not replace or broaden unrelated artifact code solely from this scalar mismatch; "
        "artifact semantics can be reviewed after the exact numeric check passes."
    ]
    if "exact_lindblad_evolution" in protocols:
        instructions.append(
            "Rebuild the declared Lindblad generator in basis |0>,|1>: lowering "
            "|0><1| is [[0,1],[0,0]] and raising |1><0| is [[0,0],[1,0]]. "
            "Apply every written dissipator multiplier literally and recompute all "
            "declared density-matrix scalars."
        )
    if any(
        details.get("failure_mode") in {"reported_above_ground_state", "converged_to_excited_state"}
        and (details.get("protocol") or {}).get("expectation_mode") == "exact_statevector"
        for details in exact_diag_failures
    ):
        instructions.append(
            "The exact-statevector variational energy is above the independently "
            "diagonalized ground state, so this is not shot noise. First confirm every "
            "written Pauli term is included once. If the independently reported exact "
            "energy already matches the reference, materially change the variational "
            "search: use an ansatz that connects the Hamiltonian's coupled basis states, "
            "change or deepen the entangler pattern, and run deterministic starts that "
            "include the best diagonal-basis state plus points spread across the full "
            "parameter range. Use a robust bounded optimizer from the best starts and "
            "keep the lowest energy actually reached. Do not substitute the exact "
            "eigenvector or exact baseline for the variational RESULT or FINAL_CIRCUIT."
        )
    if "exact_pauli_dynamics" in protocols:
        instructions.append(
            "Rebuild every Hamiltonian and observable Pauli string from the Plan's "
            "sparse factors instead of copying a prior full string. With q0 leftmost, "
            "factor index i occupies character i and every other character is I. "
            "Then recompute the exact matrix exponential and both requested scalars."
        )
    if "exact_dyadic_phase_estimation" in protocols:
        instructions.append(
            "Repair the controlled-power and inverse-QFT circuit so an exactly "
            "representable eigenphase concentrates the protected count distribution. "
            "Derive phase_integer, phase_estimate, and peak_probability from those "
            "same counts; do not return the known input phase as a substitute."
        )
    if "exact_dense_linear_system" in protocols:
        instructions.append(
            "Trace the HHL-style circuit on each matrix eigenvector: verify phase "
            "estimation, reciprocal controlled rotation, and the exact inverse of the "
            "forward phase-estimation subcircuit. Extract the postselected system "
            "amplitudes and canonicalize their global sign. A raw Qiskit statevector "
            "reshapes as axes q_(n-1),...,q_0: postselect qubit a by testing "
            "((basis_index >> a) & 1), or use subsystem APIs, rather than treating "
            "reshape axis a as qubit a. Do not replace circuit amplitudes with the "
            "classical baseline values."
        )
    if "brute_force_enumeration" in protocols:
        if any("SUBOPTIMAL" in disagreement for disagreement in disagreements):
            instructions.append(
                "The reported objective is achievable but suboptimal, so preserve the "
                "scoring and feasibility rules and improve the quantum search. For an "
                "enumerated diagonal cost, use a length-2**n DiagonalGate phase vector, "
                "never a dense np.diag UnitaryGate; tune bounded QAOA parameters and "
                "select the best feasible bitstring actually present in sampled counts. "
                "Do not copy the enumerated optimum into the quantum RESULT."
            )
        else:
            instructions.append(
                "Recheck Qiskit count-key reversal, original-variable indices, every "
                "feasibility predicate, and the objective sign before changing QAOA "
                "search parameters. The reported value must be recomputed from the same "
                "sampled bitstring returned as the selection."
            )
    return advisory | {
        "decision": "code_repair",
        "confidence": "high",
        "severity": "major",
        "summary": (
            "Protected RESULT values disagree with a deterministic reference; repair "
            "the reported computation before making broader artifact changes."
        ),
        "failed_checks": [str(check.get("method", "reference")) for check in failed],
        "mismatches": disagreements
        or ["At least one protected RESULT value disagrees with its exact reference."],
        "repair_instructions": instructions,
    }


def recorded_basic_checks(review: SemanticReviewEvidence) -> tuple[Mapping[str, Any], ...]:
    """The deterministic checks recorded against this review, or none.

    `feedback` is a free-form dict on the record, so a caller cannot assume the key
    is present or that its value is a list. One reader for it, because the summary
    and the fallback ranking must not disagree about what evidence exists.
    """

    checks = review.feedback.get("basic_checks")
    if not isinstance(checks, list):
        return ()
    return tuple(check for check in checks if isinstance(check, Mapping))


def passed_reference_methods(review: SemanticReviewEvidence) -> tuple[VerificationMethod, ...]:
    """Read the reference checks back off the stored review, not off the Plan.

    The artifact records what was actually checked for this candidate, so the summary
    is derived from the durable evidence rather than re-deriving a claim from a Plan
    that may have been revised since.
    """

    checks = review.feedback.get("basic_checks")
    if not isinstance(checks, list):
        return ()
    found: list[VerificationMethod] = []
    for check in checks:
        if not isinstance(check, dict) or check.get("result") != "pass":
            continue
        if check.get("method") == VerificationMethod.SUCCESS_CRITERIA.value:
            details = check.get("details")
            protocol = details.get("protocol") if isinstance(details, dict) else None
            if (
                isinstance(protocol, dict)
                and protocol.get("name") in _EXACT_SUCCESS_PROTOCOLS
                and VerificationMethod.EXACT not in found
            ):
                found.append(VerificationMethod.EXACT)
            continue
        try:
            method = VerificationMethod(str(check.get("method")))
        except ValueError:
            continue
        if method in _REFERENCE_METHODS and method not in found:
            found.append(method)
    return tuple(found)


def _failure(
    *,
    kind: SimpleFailureKind,
    stage: SimplePipelineStage,
    code: str,
    message: str,
    retryable: bool = False,
    retry_target: SimpleRetryTarget = SimpleRetryTarget.NONE,
    exception: Exception | None = None,
    details: dict[str, Any] | None = None,
) -> SimplePortResult:
    safe_details = dict(details or {})
    if exception is not None:
        safe_details.setdefault("exception_type", type(exception).__name__)
    return SimplePortResult.failed(
        SimplePipelineFailure(
            kind=kind,
            stage=stage,
            code=code,
            message=message,
            retryable=retryable,
            retry_target=retry_target,
            details=safe_details,
        )
    )


def _model_output_details(
    exception: Exception,
    *,
    raw_output: str | None = None,
) -> dict[str, Any]:
    """Bounded actionable diagnostics without returning raw model output."""

    details: dict[str, Any] = {"exception_type": type(exception).__name__}
    if isinstance(exception, ValidationError):
        issues = exception.errors(include_url=False)
        details["validation_issues"] = [
            {
                "path": ".".join(str(item) for item in issue["loc"]) or "$",
                "type": issue["type"],
                "message": issue["msg"][:500],
            }
            for issue in issues[:12]
        ]
        invalid_fields = _invalid_field_snapshot(raw_output, issues)
        if invalid_fields:
            details["invalid_fields"] = invalid_fields
    elif isinstance(exception, StageOutputError):
        # StageOutputError messages contain only parser metadata, never raw output.
        details["parse_error"] = str(exception)[:500]
    return details


def _invalid_field_snapshot(
    raw_output: str | None,
    issues: list[dict[str, Any]],
) -> dict[str, Any]:
    """Return only invalid values, never the model's complete untrusted response."""

    if raw_output is None:
        return {}
    try:
        payload = json.loads(extract_json(raw_output))
    except (StageOutputError, TypeError, ValueError):
        return {}
    except RecursionError:
        # `json.loads` raises this on a deeply nested document, and RecursionError
        # is not a ValueError, so the handler above does not catch it. This whole
        # function runs inside a failure path — the plan was already invalid — so
        # letting it escape would replace an actionable `plan_output_invalid` with
        # an unexplained stage crash.
        return {}
    snapshot: dict[str, Any] = {}
    for issue in issues[:12]:
        location = issue.get("loc")
        if not isinstance(location, tuple | list) or not location:
            continue
        current: Any = payload
        try:
            for segment in location:
                current = current[segment]
        except (KeyError, IndexError, TypeError):
            continue
        path = ".".join(str(item) for item in location)
        snapshot[path] = _bounded_repair_value(current)
    return snapshot


#: How deep `_bounded_repair_value` will follow untrusted model output. The
#: breadth caps below bound how WIDE a snapshot gets; without this one it could
#: still recurse to whatever depth a model nested, and the input is a JSON
#: document the product did not write.
_MAX_REPAIR_SNAPSHOT_DEPTH = 8


def _bounded_repair_value(value: Any, depth: int = 0) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        return value[:500]
    if depth >= _MAX_REPAIR_SNAPSHOT_DEPTH:
        # Named rather than dropped: the repair prompt reads this snapshot, and a
        # silently truncated branch reads as a field the model did not send.
        return f"<{type(value).__name__} truncated at depth {_MAX_REPAIR_SNAPSHOT_DEPTH}>"
    if isinstance(value, list):
        return [_bounded_repair_value(item, depth + 1) for item in value[:8]]
    if isinstance(value, dict):
        return {
            str(key)[:100]: _bounded_repair_value(item, depth + 1)
            for key, item in list(value.items())[:12]
        }
    return f"<{type(value).__name__}>"


def _plan_repair_contract(feedback: SimpleRepairFeedback | None) -> dict[str, Any] | None:
    if feedback is None or feedback.code != "plan_output_invalid":
        return None
    return {
        "mode": "schema_repair",
        "validation_issues": feedback.details.get("validation_issues", []),
        "invalid_fields": feedback.details.get("invalid_fields", {}),
        "requirements": [
            "Correct every listed validation path rather than regenerating blindly.",
            "Preserve the requested framework, scale, objective, constraints, and outputs.",
            "Keep valid sibling fields unchanged unless a cross-field validator requires it.",
            "Do not delete requested evidence or baseline fields merely to satisfy the schema.",
        ],
    }


# The only stages that ever call _provider_failure; each retries within the
# pipeline's own bounded per-stage budget, the same target its other retryable
# failures (invalid model output, failed execution) already use.
_STAGE_RETRY_TARGET: dict[SimplePipelineStage, SimpleRetryTarget] = {
    SimplePipelineStage.PLANNING: SimpleRetryTarget.PLANNING,
    SimplePipelineStage.GENERATING: SimpleRetryTarget.GENERATION,
    SimplePipelineStage.REVIEWING: SimpleRetryTarget.REVIEW,
}


def _provider_failure(
    *,
    stage: SimplePipelineStage,
    role: str,
    exception: Exception,
) -> SimplePortResult:
    """A provider call already exhausted the one client-level retry policy.

    That policy (RetryingLLM) only covers a ~7s backoff window inside a single
    call. A transient failure that outlives it — a rate limit, an upstream 5xx,
    a timeout, a dropped connection — still deserves one more try inside the
    pipeline's own bounded budget rather than failing the whole run; only
    LLMProviderError already marks which failures are transient
    (classify_provider_error), so that verdict must reach the typed failure
    instead of being silently dropped to non-retryable.
    """

    if isinstance(exception, LLMProviderError):
        status = f", HTTP {exception.status_code}" if exception.status_code is not None else ""
        retry_target = (
            _STAGE_RETRY_TARGET.get(stage, SimpleRetryTarget.NONE)
            if exception.retryable
            else SimpleRetryTarget.NONE
        )
        return _failure(
            kind=SimpleFailureKind.PROVIDER,
            stage=stage,
            code=f"{role}_provider_{exception.code}",
            message=(
                f"{role} provider unavailable ({exception.provider}:{exception.code}{status})"
            ),
            retryable=retry_target is not SimpleRetryTarget.NONE,
            retry_target=retry_target,
            exception=exception,
            details=exception.safe_details(),
        )
    return _failure(
        kind=SimpleFailureKind.PROVIDER,
        stage=stage,
        code=f"{role}_provider_failed",
        message=f"{role} provider call failed",
        exception=exception,
    )


class ProductionSimplePipelinePorts:
    """Durable ports; each completed boundary is idempotent and event-replayable."""

    def __init__(
        self,
        *,
        store: SimplePipelineStore,
        observer: SimpleStepObserver,
        llm: LLMClient,
        executor: SandboxCandidateExecutor,
        reviewer: IntentReviewer,
        converter: TrustedOpenQASMConverter,
        saver: ReviewArtifactSaver | None,
        task_prompt: str,
        framework: Framework,
        conversation_messages: Sequence[Mapping[str, str]] = (),
        requested_shots: int | None = None,
        requested_seed: int | None = None,
        initial_source: str | None = None,
        rollback: Callable[[], Awaitable[None]] | None = None,
    ) -> None:
        self._store = store
        self._observer = observer
        self._llm = llm
        self._executor = executor
        self._reviewer = reviewer
        self._converter = converter
        self._saver = saver
        self._task_prompt = task_prompt
        self._conversation_messages = tuple(conversation_messages)
        self._prior_user_requests = _prior_user_requests(self._conversation_messages)
        self._framework = framework
        self._requested_shots = (
            min(requested_shots, 20_000)
            if requested_shots is not None and requested_shots >= 1
            else None
        )
        self._requested_seed = (
            requested_seed
            if requested_seed is not None and 0 <= requested_seed <= 2**31 - 1
            else None
        )
        self._initial_source = initial_source
        self._rollback = rollback
        self._projection_dirty = False

    @property
    def projection_dirty(self) -> bool:
        """Whether a durable step still needs event reconciliation."""

        return self._projection_dirty

    async def _reconcile_reference_problem(self, plan: Plan) -> SimplePortResult[Plan]:
        if not _reference_problem_requires_audit(plan):
            return SimplePortResult.success(plan)
        assert plan.verification_plan is not None
        assert plan.verification_plan.reference_problem is not None
        user_text = json.dumps(
            {
                "request": self._task_prompt,
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.problem_summary,
                ),
                "primary_metric": plan.success_criteria.primary_metric,
            },
            sort_keys=True,
        )
        try:
            response = await self._llm.complete(
                LLMRequest(
                    # A cheaper audit model repeatedly reversed implications and
                    # invented bounded oracles for large underspecified assignment
                    # requests. Use the substantive tier, then still require
                    # deterministic consensus.
                    model=model_for("plan"),
                    system=with_execution_conversation_context(
                        SIMPLE_BUSINESS_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
                        has_history=bool(self._conversation_messages),
                    ),
                    user=user_text,
                    messages=conversation_request_messages(
                        self._conversation_messages,
                        user_text,
                    ),
                    temperature=0.0,
                    response_schema=_BusinessReferenceExtraction.model_json_schema(),
                    schema_name="business_reference_extraction",
                )
            )
            extraction = _BusinessReferenceExtraction.model_validate_json(
                extract_json(response.text)
            )
        except (StageOutputError, ValidationError) as exc:
            log.warning(
                "dropping brute-force reference after invalid independent extraction: %s",
                type(exc).__name__,
            )
            return SimplePortResult.success(_without_brute_force_reference(plan))
        except Exception as exc:
            # This call can only add evidence. A provider outage must not turn an
            # otherwise executable task into a product failure; run with the weaker
            # structural/review evidence instead.
            log.warning(
                "dropping brute-force reference after independent extraction failure: %s",
                type(exc).__name__,
            )
            return SimplePortResult.success(_without_brute_force_reference(plan))

        if not extraction.supported or extraction.reference is None:
            return SimplePortResult.success(_without_brute_force_reference(plan))

        try:
            planner_spec = _reference_problem_call_args(plan)
            independent = _durable_business_reference(extraction.reference)
            equivalent, comparison = reference_problems_equivalent(
                planner_spec,
                _reference_problem_spec(independent),
            )
            reference_optimum = optimal_objective(**planner_spec)
        except (BaselineProblemError, ValidationError, ValueError) as exc:
            log.warning(
                "dropping unusable brute-force reference during consensus: %s",
                type(exc).__name__,
            )
            return SimplePortResult.success(_without_brute_force_reference(plan))
        if not equivalent:
            log.info(
                "dropping brute-force reference without independent consensus: %s",
                comparison.get("reason", "unknown_mismatch"),
            )
            return SimplePortResult.success(_without_brute_force_reference(plan))

        expected_range = plan.success_criteria.expected_range or {}
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        truth_outside_range = (
            isinstance(lower, int | float)
            and not isinstance(lower, bool)
            and reference_optimum < float(lower)
            and not math.isclose(reference_optimum, float(lower), rel_tol=1e-12, abs_tol=1e-12)
        ) or (
            isinstance(upper, int | float)
            and not isinstance(upper, bool)
            and reference_optimum > float(upper)
            and not math.isclose(reference_optimum, float(upper), rel_tol=1e-12, abs_tol=1e-12)
        )
        verification = plan.verification_plan.model_copy(
            update={"reference_method": "independent_business_extraction_consensus"}
        )
        updates: dict[str, Any] = {"verification_plan": verification}
        criteria_updates: dict[str, Any] = {"additional_notes": None}
        if truth_outside_range:
            # Two independently derived references agree over every assignment;
            # a guessed numeric range that excludes their exact optimum is weaker
            # evidence and must not override the deterministic oracle.
            criteria_updates["expected_range"] = None
        if plan.success_criteria.additional_notes is not None or truth_outside_range:
            updates["success_criteria"] = plan.success_criteria.model_copy(update=criteria_updates)
        return SimplePortResult.success(plan.model_copy(update=updates))

    async def _reconcile_linear_system_reference(self, plan: Plan) -> SimplePortResult[Plan]:
        verification = plan.verification_plan
        declared_reference = (
            verification.exact_linear_system_reference if verification is not None else None
        )
        if not _should_attempt_linear_system_reference(plan, self._task_prompt):
            return SimplePortResult.success(plan)

        request_payload = json.dumps(
            {
                "request": self._task_prompt,
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.problem_summary,
                ),
                "expected_output_keys": plan.expected_output_keys,
                "primary_metric": plan.success_criteria.primary_metric,
            },
            sort_keys=True,
        )
        extractions: list[tuple[str, _LinearSystemReferenceExtraction]] = []
        for role, schema_name in (
            ("plan", "linear_system_reference_extraction"),
            ("audit", "linear_system_reference_audit_extraction"),
        ):
            try:
                response = await self._llm.complete(
                    LLMRequest(
                        model=model_for(role),
                        system=with_execution_conversation_context(
                            SIMPLE_LINEAR_SYSTEM_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
                            has_history=bool(self._conversation_messages),
                        ),
                        user=request_payload,
                        messages=conversation_request_messages(
                            self._conversation_messages,
                            request_payload,
                        ),
                        temperature=0.0,
                        response_schema=_LinearSystemReferenceExtraction.model_json_schema(),
                        schema_name=schema_name,
                    )
                )
                extraction = _LinearSystemReferenceExtraction.model_validate_json(
                    extract_json(response.text)
                )
            except (StageOutputError, ValidationError) as exc:
                if role == "audit":
                    log.warning(
                        "continuing with the substantive linear-system extraction after "
                        "invalid audit extraction: %s",
                        type(exc).__name__,
                    )
                    continue
                if declared_reference is None:
                    log.warning(
                        "skipping optional linear-system enrichment after invalid %s "
                        "extraction: %s",
                        role,
                        type(exc).__name__,
                    )
                    return SimplePortResult.success(plan)
                return _failure(
                    kind=SimpleFailureKind.MODEL_OUTPUT,
                    stage=SimplePipelineStage.PLANNING,
                    code="linear_system_reference_extraction_invalid",
                    message=(
                        f"{role}-role linear-system extraction returned invalid structured data"
                    ),
                    retryable=True,
                    retry_target=SimpleRetryTarget.PLANNING,
                    exception=exc,
                    details=_model_output_details(exc),
                )
            except Exception as exc:
                if role == "audit":
                    log.warning(
                        "continuing with the substantive linear-system extraction after "
                        "audit provider failure: %s",
                        type(exc).__name__,
                    )
                    continue
                if declared_reference is None:
                    log.warning(
                        "skipping optional linear-system enrichment after %s provider failure: %s",
                        role,
                        type(exc).__name__,
                    )
                    return SimplePortResult.success(plan)
                return _provider_failure(
                    stage=SimplePipelineStage.PLANNING,
                    role=role,
                    exception=exc,
                )
            if not extraction.supported or extraction.reference is None:
                if role == "audit":
                    # Flash occasionally treats an explicitly out-of-scope circuit
                    # obligation as making a complete A*x=b problem unsupported. An
                    # abstention is not a contradictory typed derivation, so it cannot
                    # veto agreement between the planner (when present) and the
                    # substantive independent extractor.
                    log.info("linear-system audit extractor abstained: %s", extraction.reason)
                    continue
                if declared_reference is None:
                    return SimplePortResult.success(plan)
                return _failure(
                    kind=SimpleFailureKind.PLAN,
                    stage=SimplePipelineStage.PLANNING,
                    code="linear_system_reference_consensus_failed",
                    message=(
                        f"{role}-role extraction does not support the declared "
                        "linear-system reference"
                    ),
                    retryable=True,
                    retry_target=SimpleRetryTarget.PLANNING,
                    details={
                        "comparison": {
                            "reason": f"{role}_extraction_unsupported",
                            "detail": extraction.reason,
                        }
                    },
                )
            extractions.append((role, extraction))

        if declared_reference is None:
            reference = extractions[0][1].reference
            comparison_references = [
                (f"{role}_extraction", extraction.reference) for role, extraction in extractions[1:]
            ]
            reference_method = (
                "dual_model_linear_system_extraction_consensus"
                if comparison_references
                else "independent_linear_system_extraction"
            )
        else:
            reference = declared_reference
            comparison_references = [
                (f"{role}_extraction", extraction.reference) for role, extraction in extractions
            ]
            reference_method = (
                "independent_dual_model_linear_system_consensus"
                if len(comparison_references) > 1
                else "independent_linear_system_extraction_consensus"
            )
        assert reference is not None

        comparison: dict[str, object] = {"reason": "all_linear_system_references_equivalent"}
        mismatch_source: str | None = None
        try:
            equivalent = True
            for source, comparison_reference in comparison_references:
                assert comparison_reference is not None
                equivalent, comparison = linear_system_references_equivalent(
                    reference, comparison_reference
                )
                if not equivalent:
                    mismatch_source = source
                    break
            exact_values, _ = exact_linear_system_values(reference)
        except LinearSystemReferenceError as exc:
            if declared_reference is None:
                log.warning("skipping unusable optional linear-system enrichment: %s", exc)
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="linear_system_reference_unusable",
                message="typed linear-system reference cannot be evaluated as declared",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={"reference_errors": [str(exc)[:1_000]]},
            )
        if not equivalent:
            comparison = comparison | {"source": mismatch_source}
            if declared_reference is None:
                log.info(
                    "skipping optional linear-system enrichment without semantic consensus: %s",
                    comparison.get("reason", "unknown_mismatch"),
                )
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="linear_system_reference_consensus_failed",
                message="planner and independent linear-system extractions disagree",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={"comparison": comparison},
            )

        primary = plan.success_criteria.primary_metric
        declared_keys = {result.result_key for result in reference.results}
        if primary not in declared_keys or not declared_keys.issubset(plan.expected_output_keys):
            if declared_reference is None:
                log.info("skipping optional linear-system enrichment with unbound result keys")
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="linear_system_reference_result_binding_failed",
                message="typed linear-system results are not bound to the Plan output contract",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={
                    "primary_metric": primary,
                    "reference_result_keys": sorted(declared_keys),
                    "expected_output_keys": sorted(plan.expected_output_keys),
                },
            )
        # Solving here ensures the agreed primary meaning is numerically usable before
        # the later reconciliation removes weaker model-authored ranges and notes.
        _ = exact_values[primary]
        base_verification = plan.verification_plan or VerificationPlan(
            methods=[VerificationMethod.RETURN_CONTRACT]
        )
        return SimplePortResult.success(
            plan.model_copy(
                update={
                    "verification_plan": base_verification.model_copy(
                        update={
                            "exact_linear_system_reference": reference,
                            "reference_method": reference_method,
                        }
                    )
                }
            )
        )

    async def _reconcile_lindblad_reference(self, plan: Plan) -> SimplePortResult[Plan]:
        verification = plan.verification_plan
        declared_reference = verification.exact_lindblad_reference if verification else None
        if not _should_attempt_lindblad_reference(plan, self._task_prompt):
            return SimplePortResult.success(plan)
        request_payload = json.dumps(
            {
                "request": self._task_prompt,
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.problem_summary,
                ),
                "expected_output_keys": plan.expected_output_keys,
                "primary_metric": plan.success_criteria.primary_metric,
            },
            sort_keys=True,
        )
        try:
            response = await self._llm.complete(
                LLMRequest(
                    model=model_for("plan"),
                    system=with_execution_conversation_context(
                        SIMPLE_LINDBLAD_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
                        has_history=bool(self._conversation_messages),
                    ),
                    user=request_payload,
                    messages=conversation_request_messages(
                        self._conversation_messages,
                        request_payload,
                    ),
                    temperature=0.0,
                    response_schema=_LindbladReferenceExtraction.model_json_schema(),
                    schema_name="lindblad_reference_extraction",
                )
            )
            extraction = _LindbladReferenceExtraction.model_validate_json(
                extract_json(response.text)
            )
        except (StageOutputError, ValidationError) as exc:
            if declared_reference is None:
                log.warning(
                    "skipping optional Lindblad enrichment after invalid extraction: %s",
                    type(exc).__name__,
                )
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_extraction_invalid",
                message="independent Lindblad extraction returned invalid structured data",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details=_model_output_details(exc),
            )
        except Exception as exc:
            if declared_reference is None:
                log.warning(
                    "skipping optional Lindblad enrichment after provider failure: %s",
                    type(exc).__name__,
                )
                return SimplePortResult.success(plan)
            return _provider_failure(
                stage=SimplePipelineStage.PLANNING,
                role="plan",
                exception=exc,
            )
        if not extraction.supported or extraction.reference is None:
            if declared_reference is None:
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_consensus_failed",
                message="independent extraction does not support the declared Lindblad reference",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={"comparison": {"reason": "independent_extraction_unsupported"}},
            )

        # The broad planner and the Pro extractor are correlated model evidence.
        # Require a second model role even when the Plan already supplied a reference;
        # exact execution is enabled only when all available typed meanings agree.
        try:
            audit_response = await self._llm.complete(
                LLMRequest(
                    model=model_for("audit"),
                    system=with_execution_conversation_context(
                        SIMPLE_LINDBLAD_REFERENCE_EXTRACTION_SYSTEM_PROMPT,
                        has_history=bool(self._conversation_messages),
                    ),
                    user=request_payload,
                    messages=conversation_request_messages(
                        self._conversation_messages,
                        request_payload,
                    ),
                    temperature=0.0,
                    response_schema=_LindbladReferenceExtraction.model_json_schema(),
                    schema_name="lindblad_reference_audit_extraction",
                )
            )
            audit_extraction = _LindbladReferenceExtraction.model_validate_json(
                extract_json(audit_response.text)
            )
        except (StageOutputError, ValidationError) as exc:
            if declared_reference is None:
                log.warning(
                    "skipping optional Lindblad enrichment without dual-model consensus: %s",
                    type(exc).__name__,
                )
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_audit_extraction_invalid",
                message="audit-role Lindblad extraction returned invalid structured data",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details=_model_output_details(exc),
            )
        except Exception as exc:
            if declared_reference is None:
                log.warning(
                    "skipping optional Lindblad enrichment after audit provider failure: %s",
                    type(exc).__name__,
                )
                return SimplePortResult.success(plan)
            return _provider_failure(
                stage=SimplePipelineStage.PLANNING,
                role="audit",
                exception=exc,
            )
        if not audit_extraction.supported or audit_extraction.reference is None:
            if declared_reference is None:
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_consensus_failed",
                message="audit extraction does not support the declared Lindblad reference",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={"comparison": {"reason": "audit_extraction_unsupported"}},
            )

        if declared_reference is None:
            reference = extraction.reference
            comparison_references = [("audit_extraction", audit_extraction.reference)]
            reference_method = "dual_model_lindblad_extraction_consensus"
        else:
            reference = declared_reference
            comparison_references = [
                ("plan_extraction", extraction.reference),
                ("audit_extraction", audit_extraction.reference),
            ]
            reference_method = "independent_dual_model_lindblad_consensus"

        assert reference is not None
        planner_spec = _lindblad_reference_spec(reference)
        try:
            comparison: dict[str, Any] = {"reason": "all_lindblad_references_equivalent"}
            mismatch_source: str | None = None
            for source, comparison_reference in comparison_references:
                equivalent, comparison = lindblad_references_equivalent(
                    planner_spec,
                    _lindblad_reference_spec(comparison_reference),
                )
                if not equivalent:
                    mismatch_source = source
                    break
            exact_values = exact_lindblad_values(**planner_spec)
        except LindbladReferenceError as exc:
            if declared_reference is None:
                log.warning("skipping unusable optional Lindblad enrichment: %s", exc)
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_unusable",
                message="typed Lindblad reference cannot be evaluated as declared",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details={"reference_errors": [str(exc)[:1_000]]},
            )
        if not equivalent:
            comparison = comparison | {"source": mismatch_source}
            if declared_reference is None:
                log.info(
                    "skipping optional Lindblad enrichment without semantic consensus: %s",
                    comparison.get("reason", "unknown_mismatch"),
                )
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_consensus_failed",
                message="planner and independent Lindblad extraction disagree",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={"comparison": comparison},
            )

        primary = plan.success_criteria.primary_metric
        declared_keys = {result.result_key for result in reference.results}
        if primary not in declared_keys or not declared_keys.issubset(plan.expected_output_keys):
            if declared_reference is None:
                log.info("skipping optional Lindblad enrichment with unbound result keys")
                return SimplePortResult.success(plan)
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="lindblad_reference_result_binding_failed",
                message="typed Lindblad results are not bound to the Plan output contract",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={
                    "primary_metric": primary,
                    "reference_result_keys": sorted(declared_keys),
                    "expected_output_keys": sorted(plan.expected_output_keys),
                },
            )
        exact_primary = exact_values[primary]
        expected_range = plan.success_criteria.expected_range or {}
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        truth_outside_range = (
            isinstance(lower, int | float)
            and not isinstance(lower, bool)
            and exact_primary < float(lower)
            and not math.isclose(exact_primary, float(lower), rel_tol=1e-12, abs_tol=1e-12)
        ) or (
            isinstance(upper, int | float)
            and not isinstance(upper, bool)
            and exact_primary > float(upper)
            and not math.isclose(exact_primary, float(upper), rel_tol=1e-12, abs_tol=1e-12)
        )
        base_verification = plan.verification_plan or VerificationPlan(
            methods=[VerificationMethod.RETURN_CONTRACT]
        )
        reconciled = base_verification.model_copy(
            update={
                "exact_lindblad_reference": reference,
                "reference_method": reference_method,
            }
        )
        updates: dict[str, Any] = {"verification_plan": reconciled}
        criteria_updates = {"additional_notes": None}
        if truth_outside_range:
            criteria_updates["expected_range"] = None
        if plan.success_criteria.additional_notes is not None or truth_outside_range:
            updates["success_criteria"] = plan.success_criteria.model_copy(update=criteria_updates)
        return SimplePortResult.success(plan.model_copy(update=updates))

    async def _audit_dynamics_reference(self, plan: Plan) -> SimplePortResult[Plan]:
        verification = plan.verification_plan
        reference = verification.exact_dynamics_reference if verification else None
        if reference is None:
            return SimplePortResult.success(plan)
        user_text = json.dumps(
            {
                "request": self._task_prompt,
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.problem_summary,
                ),
                "success_criteria": plan.success_criteria.model_dump(mode="json"),
                "exact_dynamics_reference": reference.model_dump(mode="json"),
            },
            sort_keys=True,
        )
        try:
            response = await self._llm.complete(
                LLMRequest(
                    model=model_for("audit"),
                    system=with_execution_conversation_context(
                        SIMPLE_DYNAMICS_REFERENCE_AUDIT_SYSTEM_PROMPT,
                        has_history=bool(self._conversation_messages),
                    ),
                    user=user_text,
                    messages=conversation_request_messages(
                        self._conversation_messages,
                        user_text,
                    ),
                    temperature=0.0,
                    response_schema=_ReferenceAuditOutput.model_json_schema(),
                    schema_name="dynamics_reference_audit",
                )
            )
            audit = _ReferenceAuditOutput.model_validate_json(extract_json(response.text))
        except (StageOutputError, ValidationError) as exc:
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=SimplePipelineStage.PLANNING,
                code="dynamics_reference_audit_output_invalid",
                message="independent dynamics-reference audit returned invalid structured data",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details=_model_output_details(exc),
            )
        except Exception as exc:
            return _provider_failure(
                stage=SimplePipelineStage.PLANNING,
                role="audit",
                exception=exc,
            )

        try:
            exact_value = exact_dynamics_value(**_dynamics_reference_call_args(plan))
        except DynamicsReferenceError as exc:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="dynamics_reference_unusable",
                message="model-authored dynamics reference cannot be evaluated as declared",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details={"audit_errors": [str(exc)[:1_000]]},
            )

        expected_range = plan.success_criteria.expected_range or {}
        lower = expected_range.get("min")
        upper = expected_range.get("max")
        outside = (
            isinstance(lower, int | float)
            and not isinstance(lower, bool)
            and exact_value < float(lower)
            and not math.isclose(exact_value, float(lower), rel_tol=1e-12, abs_tol=1e-12)
        ) or (
            isinstance(upper, int | float)
            and not isinstance(upper, bool)
            and exact_value > float(upper)
            and not math.isclose(exact_value, float(upper), rel_tol=1e-12, abs_tol=1e-12)
        )
        if outside:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="dynamics_reference_audit_failed",
                message="typed dynamics truth contradicts the Plan's success range",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={
                    "audit_errors": [
                        f"exact dynamics value {exact_value} is outside "
                        f"success_criteria.expected_range {expected_range}"
                    ],
                    "typed_reference_value": exact_value,
                },
            )
        if not audit.valid:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="dynamics_reference_audit_failed",
                message="independent audit rejected the model-authored dynamics reference",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details={
                    "audit_errors": audit.errors[:8],
                    "typed_reference_value": exact_value,
                },
            )

        assert plan.verification_plan is not None
        audited_verification = plan.verification_plan.model_copy(
            update={"reference_method": "independent_model_audit"}
        )
        return SimplePortResult.success(
            plan.model_copy(
                update={
                    "verification_plan": audited_verification,
                    "success_criteria": plan.success_criteria.model_copy(
                        update={"additional_notes": None}
                    ),
                }
            )
        )

    async def _audit_conversation_plan(self, plan: Plan) -> SimplePortResult[Plan]:
        """Reject an input-incomplete or conversation-divergent Plan before generation.

        The broad planner and the later reviewer both receive the Plan as a large,
        self-consistent object. That can anchor either model on an unrelated fallback
        circuit. This deliberately narrow call reconstructs the task from user text
        first and treats the Plan only as the proposal being audited.
        """

        if not self._prior_user_requests:
            return SimplePortResult.success(plan)

        user_text = json.dumps(
            {
                "prior_user_requests": list(self._prior_user_requests),
                "current_request": self._task_prompt,
                "proposed_plan": plan.model_dump(mode="json"),
            },
            sort_keys=True,
        )
        try:
            response = await self._llm.complete(
                LLMRequest(
                    # This is semantic request reconstruction, not a cheap keyword
                    # classification. Use the substantive planning tier so a compact
                    # follow-up can be resolved across technical or multilingual input.
                    model=model_for("plan"),
                    system=SIMPLE_CONVERSATION_PLAN_ALIGNMENT_SYSTEM_PROMPT,
                    user=user_text,
                    temperature=0.0,
                    response_schema=_ConversationPlanAlignmentOutput.model_json_schema(),
                    schema_name="conversation_plan_alignment",
                )
            )
            audit = _ConversationPlanAlignmentOutput.model_validate_json(
                extract_json(response.text)
            )
        except (StageOutputError, ValidationError) as exc:
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=SimplePipelineStage.PLANNING,
                code="conversation_plan_alignment_invalid",
                message="conversation-to-Plan audit returned invalid structured data",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details=_model_output_details(exc),
            )
        except Exception as exc:
            return _provider_failure(
                stage=SimplePipelineStage.PLANNING,
                role="conversation_plan_alignment",
                exception=exc,
            )

        audit_details = {
            "authoritative_task_summary": audit.authoritative_task_summary,
            "missing_inputs": audit.missing_inputs,
            # When inputs are incomplete, missing_inputs is the only actionable
            # diagnosis. Discard proposal commentary so a model's self-corrected
            # non-mismatch cannot confuse the user or a later repair controller.
            "mismatches": audit.mismatches if audit.ready_for_execution else [],
        }
        if not audit.ready_for_execution:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="conversation_inputs_missing",
                message=(
                    "the referenced request still needs task-specific inputs before "
                    "a circuit can be generated"
                ),
                details=audit_details,
            )
        if not audit.request_alignment.all_preserved:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="conversation_plan_misaligned",
                message="the proposed Plan does not implement the conversational request",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                details=audit_details,
            )
        return SimplePortResult.success(plan)

    async def plan(
        self,
        run_id: UUID,
        previous: PlanRevision | None,
        feedback: SimpleRepairFeedback | None,
    ) -> SimplePortResult[PlanRevision]:
        stage = SimplePipelineStage.PLANNING
        revision = 1 if previous is None else previous.revision + 1
        call_id = f"simple:plan:{revision}:{_feedback_digest(feedback)}"
        call = ToolCall(
            tool_call_id=call_id,
            name=ToolName.REQUEST_PLAN if previous is None else ToolName.REPLAN,
        )
        plan_id = uuid5(run_id, call_id)
        try:
            existing = await self._store.plan_revision(run_id, plan_id)
        except KeyError:
            existing = None
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="plan_lookup_failed",
                message="could not load durable plan state",
                exception=exc,
            )
        if existing is not None:
            await self._store.select_current_plan(run_id, existing.plan_id)
            completed = await self._store.completed_tool_call(run_id, call_id)
            if completed is None:
                await self._complete_plan_step(run_id, call, existing)
            return SimplePortResult.success(existing)

        try:
            await self._store.begin_tool_call(run_id, call)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="plan_step_begin_failed",
                message="could not start durable plan step",
                exception=exc,
            )

        schema = SimplePlan.model_json_schema()
        user = {
            "task": self._task_prompt,
            **_conversation_context_payload(self._prior_user_requests),
            "selected_framework": self._framework.value,
            "requested_shots": self._requested_shots,
            "requested_seed": self._requested_seed,
            "known_reference": known_reference_for_task(self._task_prompt),
            "previous_plan": previous.plan.model_dump(mode="json") if previous else None,
            "repair_feedback": asdict(feedback) if feedback else None,
            "repair_contract": _plan_repair_contract(feedback),
        }
        raw_plan_output: str | None = None
        user_text = json.dumps(user, default=str, sort_keys=True)
        try:
            response = await self._llm.complete(
                LLMRequest(
                    model=model_for("plan"),
                    system=with_execution_conversation_context(
                        SIMPLE_PLAN_SYSTEM_PROMPT,
                        has_history=bool(self._conversation_messages),
                    ),
                    user=user_text,
                    messages=conversation_request_messages(
                        self._conversation_messages,
                        user_text,
                    ),
                    temperature=0.0,
                    response_schema=schema,
                    schema_name="request_plan",
                )
            )
            raw_plan_output = response.text
            draft = parse_simple_plan(response.text)
            plan = _apply_trusted_task_reference(
                draft.to_durable_plan(
                    selected_framework=self._framework,
                    requested_shots=self._requested_shots,
                    requested_seed=self._requested_seed,
                ),
                (
                    f"{self._task_prompt}\n{draft.problem_summary}"
                    if self._prior_user_requests
                    else self._task_prompt
                ),
            )
        except (StageOutputError, ValidationError) as exc:
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=stage,
                code="plan_output_invalid",
                message="planner returned an invalid Plan",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
                exception=exc,
                details=_model_output_details(exc, raw_output=raw_plan_output),
            )
        except Exception as exc:
            return _provider_failure(
                stage=stage,
                role="plan",
                exception=exc,
            )

        aligned = await self._audit_conversation_plan(plan)
        if aligned.failure is not None:
            return SimplePortResult.failed(aligned.failure)
        assert aligned.value is not None
        plan = aligned.value

        reconciled = _reconcile_exact_diag_success_criteria(plan)
        if reconciled.failure is not None:
            return SimplePortResult.failed(reconciled.failure)
        assert reconciled.value is not None
        plan = reconciled.value
        plan = _reconcile_exact_qpe_success_criteria(plan)
        audited = await self._reconcile_linear_system_reference(plan)
        if audited.failure is not None:
            return SimplePortResult.failed(audited.failure)
        assert audited.value is not None
        plan = audited.value
        reconciled = _reconcile_exact_linear_system_success_criteria(plan)
        if reconciled.failure is not None:
            return SimplePortResult.failed(reconciled.failure)
        assert reconciled.value is not None
        plan = reconciled.value
        audited = await self._reconcile_reference_problem(plan)
        if audited.failure is not None:
            return SimplePortResult.failed(audited.failure)
        assert audited.value is not None
        plan = audited.value
        audited = await self._reconcile_lindblad_reference(plan)
        if audited.failure is not None:
            return SimplePortResult.failed(audited.failure)
        assert audited.value is not None
        plan = audited.value
        audited = await self._audit_dynamics_reference(plan)
        if audited.failure is not None:
            return SimplePortResult.failed(audited.failure)
        assert audited.value is not None
        plan = audited.value

        if previous is not None:
            plan = _preserve_replan_range_strength(previous.plan, plan)

        if plan.framework is not self._framework:
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=stage,
                code="plan_framework_mismatch",
                message="planner changed the selected framework",
                retryable=True,
                retry_target=SimpleRetryTarget.PLANNING,
            )
        parameters = plan.parameters.model_copy(
            update={
                "shots": (
                    self._requested_shots
                    if self._requested_shots is not None
                    else previous.plan.parameters.shots
                    if previous is not None
                    else plan.parameters.shots
                ),
                "seed": (
                    self._requested_seed
                    if self._requested_seed is not None
                    else previous.plan.parameters.seed
                    if previous is not None
                    else plan.parameters.seed
                ),
            }
        )
        plan = plan.model_copy(update={"parameters": parameters})
        if previous is not None and (
            plan.parameters.shots != previous.plan.parameters.shots
            or plan.parameters.seed != previous.plan.parameters.seed
        ):
            return _failure(
                kind=SimpleFailureKind.PLAN,
                stage=stage,
                code="replan_parameters_changed",
                message="replan changed the requested shots or seed",
            )

        record = PlanRevision(
            plan_id=plan_id,
            run_id=run_id,
            revision=revision,
            parent_plan_id=previous.plan_id if previous else None,
            plan=plan,
            plan_fingerprint=_plan_fingerprint(plan),
            replan_reason=feedback.message[:2000] if previous and feedback else None,
        )
        try:
            await self._store.append_plan_revision(record)
            await self._store.select_current_plan(run_id, record.plan_id)
            await self._complete_plan_step(run_id, call, record)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="plan_persistence_failed",
                message="could not persist the Plan",
                exception=exc,
            )
        return SimplePortResult.success(record)

    async def generate(
        self,
        run_id: UUID,
        plan: PlanRevision,
        previous: CandidateRevision | None,
        feedback: SimpleRepairFeedback | None,
    ) -> SimplePortResult[CandidateRevision]:
        stage = SimplePipelineStage.GENERATING
        revision = 1 if previous is None else previous.revision + 1
        call_id = f"simple:generate:{revision}:{plan.plan_id}:{_feedback_digest(feedback)}"
        call = ToolCall(
            tool_call_id=call_id,
            name=_SIMULATION_TOOL[self._framework],
            arguments={"plan_id": str(plan.plan_id), "revision": revision},
        )
        try:
            existing = await self._store.candidate_for_tool_call(run_id, call_id)
            if existing is not None:
                await self._project_candidate(run_id, existing)
                return SimplePortResult.success(existing)
            await self._store.begin_tool_call(run_id, call)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="candidate_step_begin_failed",
                message="could not start durable generation step",
                exception=exc,
            )

        source: str
        if previous is None and feedback is None and self._initial_source:
            source = self._initial_source
        else:
            user = {
                # The Plan is the canonical, self-contained handoff after the
                # planner resolves a referential conversation turn.  Keep the
                # literal current request separately for override/cancellation
                # semantics, rather than asking the generator to treat "build
                # it" as the complete task and inviting a canonical fallback.
                "task": (
                    plan.plan.problem_summary if self._prior_user_requests else self._task_prompt
                ),
                **_conversation_context_payload(
                    self._prior_user_requests,
                    proposed_plan_summary=plan.plan.problem_summary,
                    current_request=self._task_prompt,
                ),
                "selected_framework": self._framework.value,
                "plan": plan.plan.model_dump(mode="json"),
                # CandidateRevision already enforces the source-size ceiling. Repairs
                # need the complete program: keeping only the tail can remove imports,
                # helper definitions, and the exact code a traceback references.
                "previous_source": previous.source if previous else None,
                "previous_execution": await self._previous_execution(run_id, previous),
                "repair_feedback": asdict(feedback) if feedback else None,
                "known_reference": known_reference_for_task(
                    (
                        f"{self._task_prompt}\n{plan.plan.problem_summary}"
                        if self._prior_user_requests
                        else self._task_prompt
                    )
                ),
            }
            user_text = json.dumps(user, default=str, sort_keys=True)
            try:
                response = await self._llm.complete(
                    LLMRequest(
                        model=model_for("generate"),
                        system=with_execution_conversation_context(
                            simple_generation_system_prompt(
                                framework=plan.plan.framework.value,
                                domain=plan.plan.domain,
                                algorithm=plan.plan.algorithm.value,
                                problem_summary=plan.plan.problem_summary,
                            ),
                            has_history=bool(self._conversation_messages),
                        ),
                        user=user_text,
                        messages=conversation_request_messages(
                            self._conversation_messages,
                            user_text,
                        ),
                        temperature=_REPAIR_TEMPERATURE if feedback is not None else 0.0,
                        response_schema=_GeneratedSource.model_json_schema(),
                        schema_name="generate_circuit",
                    )
                )
                source = _GeneratedSource.model_validate_json(extract_json(response.text)).source
            except (StageOutputError, ValidationError) as exc:
                return _failure(
                    kind=SimpleFailureKind.MODEL_OUTPUT,
                    stage=stage,
                    code="generation_output_invalid",
                    message="generation model returned invalid source",
                    retryable=True,
                    retry_target=SimpleRetryTarget.GENERATION,
                    exception=exc,
                    details=_model_output_details(exc),
                )
            except Exception as exc:
                return _provider_failure(
                    stage=stage,
                    role="generation",
                    exception=exc,
                )
        try:
            program = FrameworkProgram(self._framework, source)
            ast.parse(program.normalized_source, filename="<majorana-generated>")
            candidate = CandidateRevision(
                candidate_id=uuid5(run_id, f"candidate:{call_id}"),
                run_id=run_id,
                tool_call_id=call_id,
                revision=revision,
                parent_candidate_id=previous.candidate_id if previous else None,
                plan_id=plan.plan_id,
                framework=self._framework,
                source=program.normalized_source,
                source_fingerprint=program.fingerprint,
            )
        except (SyntaxError, ValidationError, ValueError) as exc:
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=stage,
                code="generated_source_invalid",
                message="generated framework source is invalid",
                retryable=True,
                retry_target=SimpleRetryTarget.GENERATION,
                exception=exc,
            )
        try:
            await self._store.add_candidate(candidate)
            await self._project_candidate(run_id, candidate)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="candidate_persistence_failed",
                message="could not persist generated source",
                exception=exc,
            )
        return SimplePortResult.success(candidate)

    async def run_execution(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
    ) -> SimplePortResult[ExecutionEvidence]:
        stage = SimplePipelineStage.EXECUTING
        try:
            evidence = await self._store.execution_for(run_id, candidate.candidate_id)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="execution_lookup_failed",
                message="could not load execution evidence",
                exception=exc,
            )
        if evidence is None:
            try:
                output = await self._executor.run_candidate(candidate, plan.plan)
            except Exception as exc:
                return _failure(
                    kind=SimpleFailureKind.RESOURCE,
                    stage=stage,
                    code="sandbox_provider_failed",
                    message="sandbox provider failed before producing evidence",
                    retryable=True,
                    retry_target=SimpleRetryTarget.EXECUTION,
                    exception=exc,
                )
            evidence = ExecutionEvidence(
                execution_id=uuid5(run_id, f"execution:{candidate.candidate_id}"),
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                environment_fingerprint=output.environment_fingerprint,
                sandbox_provider=output.sandbox_provider,
                exit_code=output.exit_code,
                failure_kind=output.failure_kind,
                duration_ms=output.duration_ms,
                result=output.result,
                observation=output.observation,
            )
            try:
                await self._store.add_execution(evidence)
            except Exception as exc:
                return _failure(
                    kind=SimpleFailureKind.PERSISTENCE,
                    stage=stage,
                    code="execution_persistence_failed",
                    message="could not persist execution evidence",
                    exception=exc,
                )

        status = (
            CandidateStatus.EXECUTED
            if evidence.succeeded
            else CandidateStatus.RESOURCE_EXHAUSTED
            if evidence.resource_exhausted
            else CandidateStatus.REPAIR_REQUIRED
        )
        payload = {
            "candidate_id": str(candidate.candidate_id),
            "revision": candidate.revision,
            "plan_id": str(candidate.plan_id),
            "source_fingerprint": candidate.source_fingerprint,
            "execution_id": str(evidence.execution_id),
            "execution_ok": evidence.succeeded,
            "failure_kind": evidence.failure_kind.value if evidence.failure_kind else None,
            "sandbox_runs": evidence.observation.get("sandbox_runs", 1),
            "result_keys": sorted(str(key) for key in evidence.result)[:100],
        }
        result_state = (
            AgentState.EXECUTED
            if evidence.succeeded
            else AgentState.RESOURCE_EXHAUSTED
            if evidence.resource_exhausted
            else AgentState.REPAIR_REQUIRED
        )
        try:
            await self._store.set_candidate_status(run_id, candidate.candidate_id, status.value)
            # Guard tool completion the way every sibling stage does. Skipping
            # only the sandbox run on replay still rewrote the durable tool row
            # and re-projected `sandbox.result`, so a restarted run emitted the
            # execution event twice for one execution.
            if await self._store.completed_tool_call(run_id, candidate.tool_call_id) is None:
                await self._complete(
                    run_id,
                    ToolCall(
                        tool_call_id=candidate.tool_call_id,
                        name=_SIMULATION_TOOL[candidate.framework],
                        arguments={"plan_id": str(plan.plan_id), "revision": candidate.revision},
                    ),
                    result_state,
                    payload,
                )
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="execution_step_finish_failed",
                message="could not finish durable execution step",
                exception=exc,
            )
        return SimplePortResult.success(evidence)

    async def _previous_execution(
        self,
        run_id: UUID,
        previous: CandidateRevision | None,
    ) -> dict[str, Any] | None:
        """What the previous candidate actually produced when it ran.

        Without this a repair is blind to its own output: the reviewer says the
        reported number is wrong and the generator rewrites the program having never
        seen the number. namekoQ's model gets this for free — every simulate call's
        parsed result and stderr stay in its conversation history — and it is most of
        what "reasoning about the run" means.

        Store-loaded and fingerprint-bound rather than passed down the loop, so what
        the model sees is the durable evidence for THIS candidate. stdout/stderr go in
        as diagnostics only; the graded evidence remains the protected RESULT, which is
        the one the trusted observer wrote.
        """

        if previous is None:
            return None
        try:
            execution = await self._store.execution_for(run_id, previous.candidate_id)
        except Exception:
            log.warning("could not load previous execution for repair context", exc_info=True)
            return None
        if execution is None or execution.source_fingerprint != previous.source_fingerprint:
            return None
        observation = execution.observation or {}
        stderr = observation.get("sandbox_error") or observation.get("sandbox_stderr") or ""
        return {
            "execution_status": "not_run" if execution.was_not_run else "executed",
            "exit_code": execution.exit_code,
            "failure_kind": execution.failure_kind.value if execution.failure_kind else None,
            "result": execution.result,
            "resource_metrics": observation.get("resource_metrics"),
            "execution_reason_code": observation.get("execution_reason_code"),
            "target_backend": observation.get("target_backend"),
            "diagnostics_stderr_tail": str(stderr)[-4_000:] or None,
        }

    async def check_contract(
        self,
        _run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePortResult[BasicContractResult]:
        program = FrameworkProgram(candidate.framework, candidate.source)
        diagnostics = program.contract_diagnostics(
            circuit_expected=self._circuit_expected(plan.plan)
        )
        if program.role is ProgramRole.CIRCUIT:
            # Two questions a reader will reasonably ask about this branch, both
            # checked rather than assumed:
            #
            # 1. **Is skipping the plan's keys too permissive?** It would be, if a
            #    supplied source were a starting point the agent may rewrite. It is
            #    not: `intent.resolve_mode` short-circuits on `has_source_code`
            #    with "Studio ran this … there is no intent left to infer". Running
            #    the user's circuit rather than a model's replacement for it is the
            #    decision this product already made.
            # 2. **What happens downstream when the derived keys do not match
            #    `success_criteria.primary_metric`?** Every consumer reads it with
            #    `execution.result.get(metric)` and handles None, so the metric is
            #    recorded as observed=None and any plan-declared reference check
            #    FAILS rather than passing. `passed_reference_methods` then yields
            #    nothing and the evidence grade stays STRUCTURAL. The mismatch
            #    degrades honestly; it does not crash and it does not inflate.
            #
            # `expected_output_keys` describes what a PROGRAM would report, and
            # this source is a circuit: it reports what it measured, under the
            # names the trusted sampler uses. Checking the plan's keys against a
            # derived result is checking a circuit for not being a script — the
            # failure that sent published circuits to a model to be rewritten.
            #
            # What IS checked is that the derivation produced something. A circuit
            # with no trusted evidence has no result at all, and that is a real
            # contract failure with a real reason attached.
            # `execution.result` as well, not `result_was_derived` alone. A
            # misclassified PROGRAM binds RESULT through a form the classifier
            # missed, derives nothing (its own result was already there), and
            # would otherwise be told "the circuit produced no result" about a
            # result sitting in front of it. Classification can never be perfect,
            # so what is checked is whether a result EXISTS.
            if not execution.result and not result_was_derived(execution.observation):
                reason = execution.observation.get("result_derivation_error")
                diagnostics.append(
                    "the circuit produced no result to report" + (f": {reason}" if reason else "")
                )
        else:
            missing_keys = [
                key for key in plan.plan.expected_output_keys if key not in execution.result
            ]
            diagnostics.extend(f"RESULT missing key {key!r}" for key in missing_keys)
        if self._circuit_expected(plan.plan):
            metrics = execution.observation.get("resource_metrics")
            if execution.observation.get("resource_metrics_error"):
                diagnostics.append("FINAL_CIRCUIT could not be observed as a circuit")
            elif not isinstance(metrics, dict):
                diagnostics.append("FINAL_CIRCUIT resource observation is missing")
            else:
                observed_qubits = metrics.get("qubits")
                if type(observed_qubits) is int and observed_qubits > DEFAULT_QUBIT_CEILING:
                    diagnostics.append(
                        "FINAL_CIRCUIT uses "
                        f"{observed_qubits} qubits, exceeding the "
                        f"{DEFAULT_QUBIT_CEILING}-qubit lane ceiling"
                    )
                if type(observed_qubits) is int and observed_qubits > plan.plan.qubits_estimate:
                    diagnostics.append(
                        "FINAL_CIRCUIT uses "
                        f"{observed_qubits} qubits but the Plan declared "
                        f"{plan.plan.qubits_estimate}"
                    )
        return SimplePortResult.success(
            BasicContractResult(
                passed=not diagnostics,
                code="contract_ok" if not diagnostics else "basic_contract_failed",
                message=(
                    "basic execution contract passed"
                    if not diagnostics
                    else "generated source did not satisfy the basic execution contract"
                ),
                # RESIDUAL, written down rather than silently left. A
                # user-supplied circuit that produced NO trusted evidence —
                # unmeasured AND past the statevector ceiling, or an SDK that
                # would not import — still routes here, and the repair loop still
                # hands it to a model. That is unchanged from before this feature
                # rather than a regression, and it is the narrow case: any
                # measured circuit, and any circuit within the statevector limit,
                # now derives a result and passes.
                #
                # It is not closed here because there is nowhere correct to route
                # it. `BasicContractResult` requires a failure to name PLANNING or
                # GENERATION, and PLANNING does not preserve the user's source
                # either: `candidate` is not reset across a replan, so the next
                # `generate` sees a previous candidate and takes the model branch
                # instead of `_initial_source`. Closing it means relaxing that
                # invariant or resetting the candidate on replan — both changes to
                # the shared pipeline contract, and neither belongs in a change
                # that has already grown this far.
                retry_target=(
                    SimpleRetryTarget.NONE if not diagnostics else SimpleRetryTarget.GENERATION
                ),
                diagnostics=tuple(diagnostics),
            )
        )

    async def review(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        attempt: int,
    ) -> SimplePortResult[SemanticReviewEvidence]:
        stage = SimplePipelineStage.REVIEWING
        call_id = f"simple:review:{candidate.candidate_id}:{attempt}"
        call = ToolCall(
            tool_call_id=call_id,
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": str(candidate.candidate_id), "attempt": attempt},
        )
        review_id = uuid5(run_id, call_id)
        try:
            existing = await self._store.semantic_review(run_id, candidate.candidate_id, review_id)
            if existing is not None:
                completed = await self._store.completed_tool_call(run_id, call_id)
                if completed is None:
                    await self._complete_review_step(run_id, call, existing)
                return SimplePortResult.success(existing)
            latest = await self._store.latest_semantic_review(run_id, candidate.candidate_id)
            semantic_attempt = 1 if latest is None else latest.attempt_seq + 1
            await self._store.begin_tool_call(run_id, call)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="review_step_begin_failed",
                message="could not start durable review step",
                exception=exc,
            )

        artifact_only = execution.was_not_run
        success_criteria_check: dict[str, Any] | None = None
        reference_checks: list[dict[str, Any]] = []
        if artifact_only:
            authoring_diagnostics = FrameworkProgram(
                candidate.framework, candidate.source
            ).contract_diagnostics(circuit_expected=False)
            fast_checks = [
                {
                    "method": "structural",
                    "result": "pass",
                    "details": {"source_fingerprint": candidate.source_fingerprint},
                },
                {
                    "method": "framework_boundary",
                    "result": "pass" if not authoring_diagnostics else "fail",
                    "details": {
                        "selected_framework": candidate.framework.value,
                        "diagnostics": authoring_diagnostics,
                    },
                },
                {
                    "method": "execution_claims",
                    "result": "pass",
                    "details": {
                        "execution_status": "not_run",
                        "reported_result": False,
                        "sandbox_runs": 0,
                        "reason_code": execution.observation.get("execution_reason_code"),
                    },
                },
            ]
        else:
            success_criteria_check = _success_criteria_check(plan.plan, execution)
            fast_checks = [
                {
                    "method": "structural",
                    "result": "pass",
                    "details": {"source_fingerprint": candidate.source_fingerprint},
                },
                _return_contract_check(execution.result, execution.observation),
                success_criteria_check,
            ]
            reference_checks = _reference_checks(plan.plan, execution)
            fast_checks.extend(reference_checks)
        if (
            not artifact_only
            and plan.plan.verification_plan is not None
            and (
                plan.plan.verification_plan.exact_dynamics_reference is not None
                or plan.plan.verification_plan.exact_lindblad_reference is not None
                or plan.plan.verification_plan.exact_phase_estimation_reference is not None
                or plan.plan.verification_plan.exact_linear_system_reference is not None
            )
        ):
            # It uses the existing success_criteria method name so public/event/DB
            # enums remain stable, but it must still participate in deterministic
            # reference routing: a mismatch is a candidate defect and an unusable
            # declaration or contradictory range is a Plan defect.
            reference_checks.append(success_criteria_check)
        try:
            output = await self._reviewer.review(
                candidate,
                execution,
                plan.plan,
                fast_checks,
                attempt,
            )
        except (StageOutputError, ValidationError) as exc:
            return _failure(
                kind=SimpleFailureKind.MODEL_OUTPUT,
                stage=stage,
                code="review_output_invalid",
                message="intent reviewer returned invalid structured data",
                retryable=True,
                retry_target=SimpleRetryTarget.REVIEW,
                exception=exc,
                details=_model_output_details(exc),
            )
        except Exception as exc:
            return _provider_failure(
                stage=stage,
                role="review",
                exception=exc,
            )
        routing = (
            None
            if artifact_only
            else _reference_check_routing(
                reference_checks,
                success_criteria_check=success_criteria_check,
            )
        )
        if routing is not None:
            # The advisory reviewer never gets to overturn a check that already
            # established a concrete mismatch against declared reference data. It can
            # only add prose; the decision, failure class, and retry target come from
            # the check. This also separates the two faults the generic gate cannot
            # tell apart: a reference the verifier could not use at all is the Plan's
            # defect, so it replans instead of rewriting correct code.
            decision, reason_code = routing
            failure_class, retry_target = (
                (VerificationFailureClass.PLAN_DEFECT, RetryTarget.PLANNING)
                if decision is SemanticReviewDecision.REPLAN
                else (VerificationFailureClass.CANDIDATE_DEFECT, RetryTarget.CODE_GENERATION)
            )
            output = output.model_copy(
                update={
                    "decision": decision,
                    "reason_code": reason_code,
                    "failure_class": failure_class,
                    "retry_target": retry_target,
                    "critic": _reference_routing_critic(
                        output.critic,
                        reference_checks,
                        decision,
                    ),
                }
            )
        evidence = SemanticReviewEvidence(
            review_id=review_id,
            candidate_id=candidate.candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=candidate.source_fingerprint,
            # ``attempt`` counts provider/parser calls. Invalid model output is not
            # durable semantic evidence, so its retry must not create a gap in the
            # repository's per-candidate evidence sequence.
            attempt_seq=semantic_attempt,
            decision=output.decision,
            confidence=output.critic.get("confidence") if output.critic else None,
            severity=output.critic.get("severity") if output.critic else None,
            reason_code=output.reason_code,
            failure_class=output.failure_class,
            retry_target=output.retry_target,
            feedback={
                "critic": output.critic,
                "repair": None,
                "basic_checks": fast_checks,
            },
        )
        try:
            await self._store.append_semantic_review(evidence)
            status = (
                CandidateStatus.REPAIR_REQUIRED
                if evidence.decision
                in {SemanticReviewDecision.CODE_REPAIR, SemanticReviewDecision.REPLAN}
                else CandidateStatus.REVIEWED
            )
            await self._store.set_candidate_status(run_id, candidate.candidate_id, status.value)
            await self._complete_review_step(run_id, call, evidence)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="review_persistence_failed",
                message="could not persist intent-review evidence",
                exception=exc,
            )
        return SimplePortResult.success(evidence)

    async def export(
        self,
        run_id: UUID,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePortResult[ConversionEvidence]:
        stage = SimplePipelineStage.EXPORTING
        call = ToolCall(
            tool_call_id=f"simple:export:{candidate.candidate_id}",
            name=ToolName.CONVERT_TO_OPENQASM,
            arguments={"candidate_id": str(candidate.candidate_id)},
        )
        try:
            existing = await self._store.conversion_for(run_id, candidate.candidate_id)
            if existing is not None:
                completed = await self._store.completed_tool_call(run_id, call.tool_call_id)
                if completed is None:
                    await self._complete(
                        run_id,
                        call,
                        AgentState.QASM_ATTEMPTED,
                        existing.model_dump(mode="json", exclude={"qasm"}),
                    )
                return SimplePortResult.success(existing)
            await self._store.begin_tool_call(run_id, call)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="export_step_begin_failed",
                message="could not start durable export step",
                exception=exc,
            )
        try:
            qasm, reason = await self._converter.convert(candidate, execution)
        except ValueError as exc:
            return _failure(
                kind=SimpleFailureKind.INTEGRITY,
                stage=stage,
                code="export_binding_failed",
                message="export evidence binding failed",
                exception=exc,
            )
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.EXPORT,
                stage=stage,
                code="openqasm_export_failed",
                message="OpenQASM export failed; framework source remains usable",
                exception=exc,
            )
        evidence = ConversionEvidence(
            candidate_id=candidate.candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=candidate.source_fingerprint,
            status="available" if qasm else "unavailable",
            qasm=qasm,
            reason=reason,
        )
        try:
            await self._store.add_conversion(evidence)
            await self._complete(
                run_id,
                call,
                AgentState.QASM_ATTEMPTED,
                evidence.model_dump(mode="json", exclude={"qasm"}),
            )
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="export_persistence_failed",
                message="could not persist export evidence",
                exception=exc,
            )
        return SimplePortResult.success(evidence)

    async def save(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence,
        conversion: ConversionEvidence | None,
    ) -> SimplePortResult[MaterializedArtifact]:
        return await self._save_candidate(
            run_id,
            plan,
            candidate,
            execution,
            review=review,
            conversion=conversion,
        )

    async def save_unexecuted(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        review: SemanticReviewEvidence | None,
    ) -> SimplePortResult[MaterializedArtifact]:
        if not execution.was_not_run:
            return _failure(
                kind=SimpleFailureKind.INTEGRITY,
                stage=SimplePipelineStage.SAVING,
                code="unexecuted_artifact_evidence_invalid",
                message="artifact-only save requires trusted not-run preflight evidence",
            )
        return await self._save_candidate(
            run_id,
            plan,
            candidate,
            execution,
            review=review,
            conversion=None,
        )

    async def _save_candidate(
        self,
        run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        *,
        review: SemanticReviewEvidence | None,
        conversion: ConversionEvidence | None,
    ) -> SimplePortResult[MaterializedArtifact]:
        stage = SimplePipelineStage.SAVING
        if not execution.was_not_run and review is None:
            return _failure(
                kind=SimpleFailureKind.INTEGRITY,
                stage=stage,
                code="executed_artifact_review_missing",
                message="executed artifact save requires semantic review evidence",
            )
        if self._saver is None:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="simple_save_not_enabled",
                message="simple pipeline save authority is not enabled",
            )
        call = ToolCall(
            tool_call_id=f"simple:save:{candidate.candidate_id}",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": str(candidate.candidate_id)},
        )
        try:
            existing = await self._store.materialization_for(run_id, candidate.candidate_id)
            if existing is not None:
                completed = await self._store.completed_tool_call(run_id, call.tool_call_id)
                if completed is None:
                    await self._complete(
                        run_id,
                        call,
                        AgentState.MATERIALIZED,
                        existing.model_dump(mode="json"),
                    )
                return SimplePortResult.success(existing)
            await self._store.begin_tool_call(run_id, call)
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="save_step_begin_failed",
                message="could not start durable save step",
                retryable=True,
                retry_target=SimpleRetryTarget.SAVE,
                exception=exc,
            )
        try:
            if execution.was_not_run:
                artifact = await self._saver.save_unexecuted(
                    candidate, execution, review, plan.plan
                )
            else:
                assert review is not None
                artifact = await self._saver.save(
                    candidate,
                    execution,
                    review,
                    conversion,
                    plan.plan,
                )
            await self._store.add_materialization(artifact)
            await self._store.set_candidate_status(
                run_id, candidate.candidate_id, CandidateStatus.MATERIALIZED.value
            )
            await self._complete(
                run_id,
                call,
                AgentState.MATERIALIZED,
                artifact.model_dump(mode="json"),
            )
        except ValueError as exc:
            rollback_failure = await self._rollback_save()
            if rollback_failure is not None:
                return rollback_failure
            return _failure(
                kind=SimpleFailureKind.INTEGRITY,
                stage=stage,
                code="artifact_binding_failed",
                message="artifact save evidence binding failed",
                exception=exc,
            )
        except Exception as exc:
            rollback_failure = await self._rollback_save()
            if rollback_failure is not None:
                return rollback_failure
            return _failure(
                kind=SimpleFailureKind.PERSISTENCE,
                stage=stage,
                code="artifact_save_failed",
                message="artifact save failed",
                retryable=True,
                retry_target=SimpleRetryTarget.SAVE,
                exception=exc,
            )
        return SimplePortResult.success(artifact)

    async def _rollback_save(self) -> SimplePortResult | None:
        if self._rollback is None:
            return None
        try:
            await self._rollback()
        except Exception as exc:
            return _failure(
                kind=SimpleFailureKind.INTERNAL,
                stage=SimplePipelineStage.SAVING,
                code="artifact_save_rollback_failed",
                message="artifact save rollback failed",
                exception=exc,
            )
        return None

    async def _complete_plan_step(self, run_id: UUID, call: ToolCall, plan: PlanRevision) -> None:
        await self._complete(
            run_id,
            call,
            AgentState.PLANNED,
            {
                "plan_id": str(plan.plan_id),
                "revision": plan.revision,
                "parent_plan_id": str(plan.parent_plan_id) if plan.parent_plan_id else None,
                "plan": plan.plan.model_dump(mode="json"),
            },
        )

    async def _complete_review_step(
        self, run_id: UUID, call: ToolCall, review: SemanticReviewEvidence
    ) -> None:
        state = {
            # The fixed pipeline proceeds directly to export/save; its durable
            # review step must not advertise a strict-verification transition.
            SemanticReviewDecision.READY: AgentState.REVIEWED,
            SemanticReviewDecision.CODE_REPAIR: AgentState.REPAIR_REQUIRED,
            SemanticReviewDecision.REPLAN: AgentState.REPLAN_REQUIRED,
            SemanticReviewDecision.INCONCLUSIVE: AgentState.REVIEWED,
        }[review.decision]
        await self._complete(
            run_id,
            call,
            state,
            {
                "candidate_id": str(review.candidate_id),
                "execution_id": str(review.execution_id),
                "review_id": str(review.review_id),
                "attempt_seq": review.attempt_seq,
                "source_fingerprint": review.source_fingerprint,
                "decision": review.decision.value,
                "reason_code": review.reason_code,
                "failure_class": (review.failure_class.value if review.failure_class else None),
                "retry_target": review.retry_target.value,
                "feedback": review.feedback,
            },
        )

    async def _complete(
        self,
        run_id: UUID,
        call: ToolCall,
        state: AgentState,
        payload: dict[str, Any],
    ) -> None:
        result = ToolResult(
            tool_call_id=call.tool_call_id,
            name=call.name,
            ok=True,
            state=state,
            payload=payload,
        )
        await self._store.finish_tool_call(run_id, result)
        try:
            await self._observer.tool_finished(run_id, result)
        except Exception as exc:
            await self._defer_projection("completed step", exc)

    async def _project_candidate(
        self,
        run_id: UUID,
        candidate: CandidateRevision,
    ) -> None:
        try:
            await self._observer.candidate_generated(run_id, candidate)
        except Exception as exc:
            await self._defer_projection("generated candidate", exc)

    async def _defer_projection(self, boundary: str, exception: Exception) -> None:
        """Reset a failed event transaction and let the handler reconcile later.

        The domain record was already committed. Turning a projection outage into
        a failed circuit would be false; terminalization instead waits for replay.
        """

        if self._rollback is None:
            raise exception
        await self._rollback()
        self._projection_dirty = True
        log.warning(
            "%s event projection deferred until reconciliation",
            boundary,
            exc_info=exception,
        )

    @staticmethod
    def _circuit_expected(plan: Plan) -> bool:
        return (
            plan.artifact_contract is None
            or plan.artifact_contract.artifact_type is not ArtifactType.OTHER
        )
