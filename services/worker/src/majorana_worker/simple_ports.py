"""Production adapters for the deterministic ADR-0023 circuit pipeline."""

from __future__ import annotations

import hashlib
import json
import logging
import math
from dataclasses import asdict
from typing import Any, Awaitable, Callable, Literal, Protocol
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
from majorana_agent.templates import REFERENCE_TEMPLATES
from majorana_contracts import Scope, VerificationSummary
from majorana_contracts.enums import (
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
from majorana_contracts.plan import Plan
from majorana_frameworks import FrameworkProgram
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
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from majorana_api.db import AsyncSession
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import runs as runs_repo

from .runtime_ports import SandboxCandidateExecutor, TrustedOpenQASMConverter

log = logging.getLogger("majorana_worker.simple_ports")


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


class _IntentReviewOutput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    decision: SemanticReviewDecision
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

        decision = output.decision
        concrete_repair = bool(output.mismatches and output.repair_instructions)
        if decision is SemanticReviewDecision.READY and (
            output.confidence == "low"
            or output.severity in {"major", "blocking"}
            or output.failed_checks
            or output.mismatches
        ):
            decision = SemanticReviewDecision.INCONCLUSIVE
        elif decision in {
            SemanticReviewDecision.CODE_REPAIR,
            SemanticReviewDecision.REPLAN,
        } and (
            output.confidence == "low"
            or output.severity not in {"major", "blocking"}
            or not concrete_repair
        ):
            decision = SemanticReviewDecision.INCONCLUSIVE

        failure_class, retry_target = {
            SemanticReviewDecision.READY: (None, RetryTarget.NONE),
            SemanticReviewDecision.CODE_REPAIR: (
                VerificationFailureClass.CANDIDATE_DEFECT,
                RetryTarget.CODE_GENERATION,
            ),
            SemanticReviewDecision.REPLAN: (
                VerificationFailureClass.PLAN_DEFECT,
                RetryTarget.PLANNING,
            ),
            SemanticReviewDecision.INCONCLUSIVE: (
                VerificationFailureClass.EVIDENCE_GAP,
                RetryTarget.VERIFICATION,
            ),
        }[decision]
        return SimpleIntentReviewResult(
            decision=decision,
            critic=output.model_dump(mode="json"),
            failure_class=failure_class,
            retry_target=retry_target,
            reason_code={
                SemanticReviewDecision.READY: "intent_aligned",
                SemanticReviewDecision.CODE_REPAIR: "intent_code_mismatch",
                SemanticReviewDecision.REPLAN: "intent_plan_mismatch",
                SemanticReviewDecision.INCONCLUSIVE: "intent_review_inconclusive",
            }[decision],
        )


def simple_pipeline_verification_summary() -> dict[str, object]:
    """Return the single typed trust projection for a successful simple run.

    A successful simple pipeline proves that the generated program executed and
    satisfied its basic structural/result contract. The AI review is advisory,
    so the final verification decision remains explicitly inconclusive.
    """

    summary = VerificationSummary(
        decision=VerifierDecision.INCONCLUSIVE,
        semantic_review_decision=SemanticReviewDecision.READY,
        evidence_strength=EvidenceStrength.STRUCTURAL,
        reason_code="ai_review_aligned",
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.EVIDENCE_GAP,
        retry_target=RetryTarget.NONE,
        unverified_claims=[
            "quantum correctness",
            "physical fidelity",
            "optimality",
        ],
        checks=[
            {
                "method": VerificationMethod.STRUCTURAL,
                "result": VerificationResultKind.PASS,
            },
            {
                "method": VerificationMethod.RETURN_CONTRACT,
                "result": VerificationResultKind.PASS,
            },
            {
                "method": VerificationMethod.SUCCESS_CRITERIA,
                "result": VerificationResultKind.PASS,
            },
        ],
    )
    return summary.model_dump(mode="json")


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
    ) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id
        self._parent_artifact_id = parent_artifact_id
        self._parent_artifact_version_id = parent_artifact_version_id
        self._parent_artifact_fingerprint = parent_artifact_fingerprint
        self._title = title

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
        if review.decision is not SemanticReviewDecision.READY:
            raise ValueError("artifact save requires an aligned intent review")
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
            artifact = await artifacts_repo.create_artifact(
                self._scope,
                self._session,
                slug=f"run-{self._run_id.hex[:12]}",
                title=self._title[:200],
                family=plan.algorithm,
                framework=candidate.framework,
                parent_artifact_id=self._parent_artifact_id if save_as_copy else None,
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
        advisory = (
            "AI intent review is advisory; strict quantum correctness and optimality "
            "were not evaluated."
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
                "status": "aligned",
                "decision": review.decision.value,
                "reason_code": review.reason_code,
                "confidence": review.confidence,
                "severity": review.severity,
                "summary": critic.get("summary"),
                "residual_risks": residual_risks,
            },
            "verification_summary": simple_pipeline_verification_summary(),
            "export_manifest": {
                "review_status": "aligned",
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


def _provider_failure(
    *,
    stage: SimplePipelineStage,
    role: str,
    exception: Exception,
) -> SimplePortResult:
    """A provider call already exhausted the one client-level retry policy."""

    if isinstance(exception, LLMProviderError):
        status = f", HTTP {exception.status_code}" if exception.status_code is not None else ""
        return _failure(
            kind=SimpleFailureKind.PROVIDER,
            stage=stage,
            code=f"{role}_provider_{exception.code}",
            message=(
                f"{role} provider unavailable ({exception.provider}:{exception.code}{status})"
            ),
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
            plan = draft.to_durable_plan(
                selected_framework=self._framework,
                requested_shots=self._requested_shots,
                requested_seed=self._requested_seed,
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
        plan = plan.model_copy(
            update={
                "parameters": parameters,
                "artifact_contract": None,
                "verification_plan": None,
            }
        )
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
                "previous_source": previous.source[-100_000:] if previous else None,
                "repair_feedback": asdict(feedback) if feedback else None,
                "reference_template": REFERENCE_TEMPLATES.get(self._framework),
            }
            try:
                response = await self._llm.complete(
                    LLMRequest(
                        model=model_for("generate"),
                        system=SIMPLE_GENERATION_SYSTEM_PROMPT,
                        user=json.dumps(user, default=str, sort_keys=True),
                        temperature=0.0,
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

    async def check_contract(
        self,
        _run_id: UUID,
        plan: PlanRevision,
        candidate: CandidateRevision,
        execution: ExecutionEvidence,
    ) -> SimplePortResult[BasicContractResult]:
        diagnostics = FrameworkProgram(candidate.framework, candidate.source).contract_diagnostics(
            circuit_expected=self._circuit_expected(plan.plan)
        )
        missing_keys = [
            key for key in plan.plan.expected_output_keys if key not in execution.result
        ]
        diagnostics.extend(f"RESULT missing key {key!r}" for key in missing_keys)
        if self._circuit_expected(plan.plan):
            if execution.observation.get("resource_metrics_error"):
                diagnostics.append("FINAL_CIRCUIT could not be observed as a circuit")
            elif not isinstance(execution.observation.get("resource_metrics"), dict):
                diagnostics.append("FINAL_CIRCUIT resource observation is missing")
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
        evidence = SemanticReviewEvidence(
            review_id=review_id,
            candidate_id=candidate.candidate_id,
            execution_id=execution.execution_id,
            source_fingerprint=candidate.source_fingerprint,
            attempt_seq=attempt,
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
