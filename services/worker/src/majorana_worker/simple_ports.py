"""Production adapters for the deterministic ADR-0023 circuit pipeline."""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import asdict
from typing import Any, Awaitable, Callable, Literal, Protocol, Sequence
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
    EvidenceStrength,
    ExportStatus,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerificationMethod,
    VerificationResultKind,
    VerifierDecision,
)
from majorana_contracts.plan import PauliTerm, Plan, VerificationPlan
from majorana_verification import verify_brute_force, verify_exact_diag
from majorana_frameworks import FrameworkProgram
from majorana_frameworks.roles import ProgramRole, result_was_derived
from majorana_llm import (
    LLMClient,
    LLMProviderError,
    LLMRequest,
    SIMPLE_GENERATION_SYSTEM_PROMPT,
    SIMPLE_PLAN_SYSTEM_PROMPT,
    SIMPLE_REVIEW_SYSTEM_PROMPT,
    StageOutputError,
    extract_json,
    model_for,
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


class SimpleIntentReviewer:
    """One model call that advises on intent alignment without strict checks."""

    def __init__(self, *, llm: LLMClient, task_prompt: str) -> None:
        self._llm = llm
        self._task_prompt = task_prompt

    async def review(
        self,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
        plan: Plan,
        basic_checks: list[dict[str, Any]],
        attempt: int,
    ) -> SimpleIntentReviewResult:
        response = await self._llm.complete(
            LLMRequest(
                model=model_for("verify"),
                system=SIMPLE_REVIEW_SYSTEM_PROMPT,
                user=json.dumps(
                    {
                        "request": self._task_prompt,
                        "review_attempt": attempt,
                        "plan": plan.model_dump(mode="json"),
                        "candidate": {
                            "framework": candidate.framework.value,
                            "source": candidate.source,
                            "source_fingerprint": candidate.source_fingerprint,
                        },
                        "execution": {
                            "execution_id": str(execution.execution_id),
                            "source_fingerprint": execution.source_fingerprint,
                            "exit_code": execution.exit_code,
                            "result": execution.result,
                            "resource_metrics": execution.observation.get("resource_metrics"),
                        },
                        "basic_checks": basic_checks,
                        "known_reference": known_reference_for_task(self._task_prompt),
                    },
                    default=str,
                    sort_keys=True,
                ),
                temperature=0.0,
                response_schema=_IntentReviewOutput.model_json_schema(),
                schema_name="intent_alignment",
            )
        )
        output = _IntentReviewOutput.model_validate_json(extract_json(response.text))
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
            reason_code={
                SemanticReviewDecision.READY: "intent_aligned",
                SemanticReviewDecision.CODE_REPAIR: "intent_code_mismatch",
                SemanticReviewDecision.REPLAN: "intent_plan_mismatch",
            }[decision],
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


def simple_pipeline_verification_summary(
    reference_methods: Sequence[VerificationMethod] = (),
    semantic_review_decision: SemanticReviewDecision = SemanticReviewDecision.READY,
    *,
    result_derived: bool = False,
) -> dict[str, object]:
    """Return the single typed trust projection for a successful simple run.

    A successful simple pipeline proves that the generated program executed and
    satisfied its basic structural/result contract. The AI review is advisory, so
    the final verification decision stays explicitly inconclusive.

    Plan-declared reference checks that actually ran and passed are recorded here
    and raise evidence_strength to PHYSICAL — the grade EvidenceStrength was split
    out to express: one limited claim really was compared against what the physics
    should do, while the overall decision remains INCONCLUSIVE because the other
    claims still are not supported. It never becomes a PASS or a "verified" label.
    """

    checks: list[dict[str, object]] = [
        {
            "method": VerificationMethod.STRUCTURAL,
            "result": VerificationResultKind.PASS,
        },
        {
            "method": VerificationMethod.SUCCESS_CRITERIA,
            "result": VerificationResultKind.PASS,
        },
    ]
    unverified = ["physical fidelity", "optimality"]
    if result_derived:
        # RETURN_CONTRACT is "the program reported what it said it would". A
        # CIRCUIT reported nothing — the platform sampled it and made that the
        # result — so claiming the check PASSED would be a false statement about
        # source that never made a claim at all. It is DROPPED rather than marked
        # failed: nothing went wrong, there was simply no return to contract with.
        #
        # The claim withdrawn beside it is the one that matters most. A derived
        # result comes from the same trusted evidence any later check would
        # compare it against, so agreement between them is `f(x) == f(x)` — a
        # comparison that cannot fail, which is worse than no comparison.
        unverified.insert(0, "reported output (the result was derived, not returned)")
    else:
        checks.insert(
            1,
            {
                "method": VerificationMethod.RETURN_CONTRACT,
                "result": VerificationResultKind.PASS,
            },
        )
    if not reference_methods:
        unverified.insert(0, "quantum correctness")
    else:
        # The declared references established this one number; the rest of the run's
        # quantum behaviour is still unexamined, so only that claim is withdrawn.
        checks.extend(
            {"method": method, "result": VerificationResultKind.PASS}
            for method in reference_methods
        )
    if semantic_review_decision is not SemanticReviewDecision.READY:
        # Delivered on trusted evidence alone. Say so rather than letting a reader
        # infer that the reviewer signed off on intent.
        unverified.append("intent alignment")

    summary = VerificationSummary(
        decision=VerifierDecision.INCONCLUSIVE,
        semantic_review_decision=semantic_review_decision,
        evidence_strength=(
            EvidenceStrength.PHYSICAL if reference_methods else EvidenceStrength.STRUCTURAL
        ),
        reason_code=_summary_reason_code(reference_methods, semantic_review_decision),
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.EVIDENCE_GAP,
        retry_target=RetryTarget.NONE,
        unverified_claims=unverified,
        checks=checks,
    )
    return summary.model_dump(mode="json")


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
        if not review.is_deliverable():
            raise ValueError("artifact save requires complete trusted evidence")
        if conversion is not None and not (
            conversion.candidate_id == candidate.candidate_id
            and conversion.execution_id == execution.execution_id
            and conversion.source_fingerprint == candidate.source_fingerprint
        ):
            raise ValueError("conversion fingerprint/execution binding mismatch")

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
                kept=self._auto_keep,
            )
            artifact_id = artifact.id

        qasm = (
            conversion.qasm if conversion is not None and conversion.status == "available" else None
        )
        export_status = ExportStatus.LOSSLESS if qasm else ExportStatus.UNSUPPORTED
        export_reason = (
            None
            if qasm
            else conversion.reason
            if conversion is not None
            else "framework export unavailable"
        )
        critic = review.feedback.get("critic")
        critic = critic if isinstance(critic, dict) else {}
        residual_risks = critic.get("residual_risks")
        residual_risks = (
            [str(item)[:1000] for item in residual_risks][:20]
            if isinstance(residual_risks, list)
            else []
        )
        review_status = (
            "aligned" if review.decision is SemanticReviewDecision.READY else "not_accepted"
        )
        reference_methods = passed_reference_methods(review)
        advisory = (
            "AI intent review is advisory; strict quantum correctness and optimality "
            "were not evaluated."
        )
        if review.decision is not SemanticReviewDecision.READY:
            advisory = (
                "The AI intent review did not accept this candidate within the run's "
                "budget. It is delivered on its trusted evidence alone: it executed, "
                "satisfied the basic result contract"
                + (
                    f", and matched the Plan's declared reference "
                    f"({', '.join(m.value for m in reference_methods)})."
                    if reference_methods
                    else "."
                )
                + " Intent alignment was not established."
            )
        elif reference_methods:
            advisory = (
                "AI intent review is advisory. The reported "
                f"{plan.success_criteria.primary_metric} was checked against the Plan's "
                f"declared reference ({', '.join(m.value for m in reference_methods)}); "
                "no other quantum property, and no claim of optimality, was evaluated."
            )
        limitations = "\n".join(dict.fromkeys([*residual_risks, advisory]))
        metadata: dict[str, object] = {
            "source": "simple_pipeline_candidate",
            "candidate_id": str(candidate.candidate_id),
            "candidate_revision": candidate.revision,
            "source_fingerprint": candidate.source_fingerprint,
            "execution_id": str(execution.execution_id),
            "semantic_review_id": str(review.review_id),
            "canonical_representation": "framework_code",
            "openqasm_role": "interchange" if qasm else "unavailable",
            "review_summary": {
                "status": review_status,
                "decision": review.decision.value,
                "reason_code": review.reason_code,
                "confidence": review.confidence,
                "severity": review.severity,
                "summary": critic.get("summary"),
                "residual_risks": residual_risks,
            },
            "verification_summary": simple_pipeline_verification_summary(
                reference_methods,
                review.decision,
                result_derived=result_was_derived(execution.observation),
            ),
            # What the run produced, and — when the source was a circuit — WHERE
            # it came from. A reader looking at counts on a saved artifact cannot
            # otherwise tell a program's own finding from a sample the platform
            # took of a circuit that reported nothing, and those are different
            # claims about the same numbers.
            "result_origin": (
                "derived_from_circuit"
                if result_was_derived(execution.observation)
                else "returned_by_program"
            ),
            "measured_result": measured_result_summary(execution.result),
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
        )


class _GeneratedSource(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source: str = Field(min_length=1, max_length=200_000)


_SIMULATION_TOOL = {
    Framework.QISKIT: ToolName.SIMULATE_QISKIT,
    Framework.CIRQ: ToolName.SIMULATE_CIRQ,
    Framework.PENNYLANE: ToolName.SIMULATE_PENNYLANE,
}


def _plan_fingerprint(plan: Plan) -> str:
    payload = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


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
                reference_hamiltonian=[
                    PauliTerm(coefficient=coefficient, pauli=pauli) for coefficient, pauli in terms
                ],
                thresholds=thresholds,
            )
        }
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
    passed = (lower is None or observed >= lower) and (upper is None or observed <= upper)
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
    metric = plan.success_criteria.primary_metric
    reported = execution.result.get(metric)
    thresholds = verification_plan.thresholds or {}
    outcomes = []

    if VerificationMethod.EXACT_DIAG in verification_plan.methods:
        terms = verification_plan.reference_hamiltonian
        # The Plan contract already refuses `exact_diag` without an operator; skipping
        # rather than diagonalizing an empty one keeps a stored plan that predates that
        # rule from being reported as a check that ran.
        if terms:
            outcomes.append(
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
                )
            )

    if VerificationMethod.BRUTE_FORCE in verification_plan.methods:
        problem = verification_plan.reference_problem
        if problem is not None:
            outcomes.append(
                verify_brute_force(
                    problem.kind,
                    problem.num_variables,
                    [(term.i, term.j, term.weight) for term in problem.terms],
                    reported,
                )
            )

    return [
        {
            "method": outcome.method.value,
            "result": "pass" if outcome.result is VerificationResultKind.PASS else "fail",
            "details": dict(outcome.details) | {"primary_metric": metric, "reported": reported},
        }
        for outcome in outcomes
    ]


_REFERENCE_METHODS = frozenset({VerificationMethod.EXACT_DIAG, VerificationMethod.BRUTE_FORCE})


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
        reference_values: list[float] = []
        for check in checks:
            details = check.get("details")
            scores = details.get("scores") if isinstance(details, dict) else None
            if not isinstance(scores, dict):
                continue
            value = scores.get("exact_ground_state_energy", scores.get("optimal_value"))
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


def _model_output_details(exception: Exception) -> dict[str, Any]:
    """Bounded actionable diagnostics without returning raw model output."""

    details: dict[str, Any] = {"exception_type": type(exception).__name__}
    if isinstance(exception, ValidationError):
        details["validation_issues"] = [
            {
                "path": ".".join(str(item) for item in issue["loc"]) or "$",
                "type": issue["type"],
                "message": issue["msg"][:500],
            }
            for issue in exception.errors(include_url=False)[:12]
        ]
    elif isinstance(exception, StageOutputError):
        # StageOutputError messages contain only parser metadata, never raw output.
        details["parse_error"] = str(exception)[:500]
    return details


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
            "selected_framework": self._framework.value,
            "requested_shots": self._requested_shots,
            "requested_seed": self._requested_seed,
            "known_reference": known_reference_for_task(self._task_prompt),
            "previous_plan": previous.plan.model_dump(mode="json") if previous else None,
            "repair_feedback": asdict(feedback) if feedback else None,
        }
        try:
            response = await self._llm.complete(
                LLMRequest(
                    model=model_for("plan"),
                    system=SIMPLE_PLAN_SYSTEM_PROMPT,
                    user=json.dumps(user, default=str, sort_keys=True),
                    temperature=0.0,
                    response_schema=schema,
                    schema_name="request_plan",
                )
            )
            draft = parse_simple_plan(response.text)
            plan = _apply_trusted_task_reference(
                draft.to_durable_plan(
                    selected_framework=self._framework,
                    requested_shots=self._requested_shots,
                    requested_seed=self._requested_seed,
                ),
                self._task_prompt,
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
                details=_model_output_details(exc),
            )
        except Exception as exc:
            return _provider_failure(
                stage=stage,
                role="plan",
                exception=exc,
            )

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
                "task": self._task_prompt,
                "selected_framework": self._framework.value,
                "plan": plan.plan.model_dump(mode="json"),
                # CandidateRevision already enforces the source-size ceiling. Repairs
                # need the complete program: keeping only the tail can remove imports,
                # helper definitions, and the exact code a traceback references.
                "previous_source": previous.source if previous else None,
                "previous_execution": await self._previous_execution(run_id, previous),
                "repair_feedback": asdict(feedback) if feedback else None,
                "known_reference": known_reference_for_task(self._task_prompt),
            }
            try:
                response = await self._llm.complete(
                    LLMRequest(
                        model=model_for("generate"),
                        system=SIMPLE_GENERATION_SYSTEM_PROMPT,
                        user=json.dumps(user, default=str, sort_keys=True),
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
        except (ValidationError, ValueError) as exc:
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
            "exit_code": execution.exit_code,
            "failure_kind": execution.failure_kind.value if execution.failure_kind else None,
            "result": execution.result,
            "resource_metrics": observation.get("resource_metrics"),
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
            if not result_was_derived(execution.observation):
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

        fast_checks = [
            {
                "method": "structural",
                "result": "pass",
                "details": {"source_fingerprint": candidate.source_fingerprint},
            },
            {
                "method": "return_contract",
                "result": "pass",
                "details": {"result_keys": sorted(execution.result)},
            },
            _success_criteria_check(plan.plan, execution),
        ]
        reference_checks = _reference_checks(plan.plan, execution)
        fast_checks.extend(reference_checks)
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
        routing = _reference_check_routing(
            reference_checks,
            success_criteria_check=fast_checks[2],
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
        stage = SimplePipelineStage.SAVING
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
            artifact = await self._saver.save(candidate, execution, review, conversion, plan.plan)
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
