"""Job handlers — the worker's dispatch table, and the repo-backed adapters that
let the pure executor (majorana-pipeline) persist through the scoped repository
layer. The worker acts under the run creator's scope (carried in the job payload
at enqueue time), never a broader one; repos.system stays provisioning+jobs only.
"""

import asyncio
import logging
import os
import uuid
from dataclasses import replace
from typing import Any, Awaitable, Callable

from majorana_contracts import Scope
from majorana_contracts.enums import (
    EvidenceStrength,
    Framework,
    ImportProvider,
    RetryTarget,
    Role,
    RunMode,
    RunStatus,
    VerificationFailureClass,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_agent import (
    AgentPolicy,
    AgentRuntime,
    AgentState,
    AgentStore,
    CircuitToolset,
    StructuredToolModel,
    ToolBroker,
)
from majorana_contracts.events import run_event_adapter
from majorana_llm import LLMClient, LLMRequest, QUANTUM_AGENT_SYSTEM_PROMPT, default_llm, model_for
from majorana_qpu import QpuRunJobPayload, submission_block_reason
from pydantic import ValidationError
from majorana_sandbox import LocalSubprocessSandbox, Sandbox, VercelSandbox
from opentelemetry import metrics

from pathlib import Path

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.catalog_bootstrap_manifest import BootstrapManifestSource
from majorana_api.catalog_import_fixtures import LocalFixtureSource
from majorana_api.catalog_import_sources import ImportSource
from majorana_api.db import AsyncSession
from majorana_api.jobs import CATALOG_IMPORT_JOB_KIND, QPU_RUN_JOB_KIND, RUN_EXECUTE_JOB_KIND
from majorana_api.orm import ImportJob
from majorana_api.repos import catalog_import as catalog_import_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import system

from .agent_events import AgentEventObserver
from .agent_llm import MeteredAgentLLM
from .agent_ports import (
    EvidenceReviewer,
    EvidenceStrictVerifier,
    LLMPlanner,
    RepoArtifactMaterializer,
    SandboxCandidateExecutor,
    TrustedOpenQASMConverter,
)
from .agent_store import RepoAgentStore
from .best_effort import choose_best_effort
from .context import RunContext
from .intent import resolve_mode

log = logging.getLogger("majorana_worker")

DEFAULT_RUN_TIMEOUT_S = 300.0

_verification_meter = metrics.get_meter("majorana.worker.verification")
_verification_decisions = _verification_meter.create_counter("majorana.verification.decisions")
_verification_routes = _verification_meter.create_counter("majorana.verification.routes")
_verification_errors = _verification_meter.create_counter("majorana.verification.errors")
_fingerprint_mismatches = _verification_meter.create_counter(
    "majorana.verification.fingerprint_mismatches"
)
_DECISIONS = frozenset(decision.value for decision in VerifierDecision)
_FAILURE_CLASSES = frozenset(item.value for item in VerificationFailureClass)
_ROUTE_BY_REASON = {
    "strict_pass": "pass",
    "legacy_verified": "legacy",
    "resource_exhausted": "resource_exhausted",
    "run_timeout": "timeout",
}


def _enabled(name: str, *, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be a boolean feature flag")


def _record_verification_summary(summary: dict[str, Any]) -> None:
    raw_decision = summary.get("decision")
    decision = raw_decision if raw_decision in _DECISIONS else "unknown"
    raw_failure_class = summary.get("failure_class")
    failure_class = (
        raw_failure_class
        if raw_failure_class in _FAILURE_CLASSES
        else "none"
        if raw_failure_class is None
        else "other"
    )
    reason_code = summary.get("reason_code")
    route = _ROUTE_BY_REASON.get(reason_code)
    if route is None and failure_class in _FAILURE_CLASSES:
        route = failure_class
    if route is None:
        route = "other"
    attributes = {
        "decision": decision,
        "route": route,
        "failure_class": failure_class,
    }
    _verification_decisions.add(1, {"decision": decision})
    _verification_routes.add(1, attributes)
    checks = summary.get("checks")
    has_error_check = isinstance(checks, list) and any(
        isinstance(check, dict) and check.get("result") == "error" for check in checks
    )
    if failure_class == VerificationFailureClass.VERIFIER_FAILURE.value or has_error_check:
        _verification_errors.add(1, {"route": route})


def _default_llm() -> LLMClient:
    """Production LLM client for the active provider profile (keys read at call time)."""
    return default_llm()


def _default_sandbox() -> Sandbox:
    """Choose the execution boundary without silently weakening production.

    The local subprocess double is useful for a paid-provider walkthrough on a
    developer machine, but it is not a security boundary and must never be
    selected by a Cloud Run, Vercel, or CI process.
    """
    provider = os.environ.get("MAJORANA_SANDBOX", "vercel").strip().lower()
    if provider == "local":
        if os.environ.get("MAJORANA_ENV", "").strip().lower() != "development" or any(
            os.environ.get(name)
            for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI")
        ):
            raise RuntimeError(
                "MAJORANA_SANDBOX=local requires MAJORANA_ENV=development and a local process"
            )
        return LocalSubprocessSandbox()
    if provider == "vercel":
        return VercelSandbox()
    raise RuntimeError("MAJORANA_SANDBOX must be 'vercel' or 'local'")


class RepoEventSink:
    """EventSink → runs_repo.append_run_event, validating each event against the
    contracts union before it's persisted (a malformed event must never enter
    the replay log)."""

    def __init__(self, scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def emit(
        self, type: str, payload: dict[str, Any], *, event_id: uuid.UUID | None = None
    ) -> None:
        wire = _validated_event_payload(self._run_id, type, payload)
        await runs_repo.append_run_event(
            self._scope,
            self._session,
            self._run_id,
            type=type,
            payload=wire,
            event_id=event_id,
        )
        await self._session.commit()  # each event visible to SSE readers immediately


def _validated_event_payload(
    run_id: uuid.UUID, type: str, payload: dict[str, Any]
) -> dict[str, Any]:
    candidate = {
        "run_id": run_id,
        "seq": 0,  # placeholder; the repo assigns the real seq under lock
        "ts": "1970-01-01T00:00:00Z",
        "type": type,
        **payload,
    }
    validated = run_event_adapter.validate_python(candidate)
    return validated.model_dump(mode="json", exclude={"run_id", "seq", "ts", "type"})


class RepoRunStateStore:
    """RunStateStore → runs.status column, with started/finished timestamps."""

    def __init__(self, scope: Scope, session: AsyncSession, run_id: uuid.UUID) -> None:
        self._scope = scope
        self._session = session
        self._run_id = run_id

    async def set_status(self, new: RunStatus, **fields: Any) -> None:
        set_started_at = bool(fields.pop("started_at_now", False))
        set_finished_at = bool(fields.pop("finished_at_now", False))
        await runs_repo.update_run_status(
            self._scope,
            self._session,
            self._run_id,
            new,
            set_started_at=set_started_at,
            set_finished_at=set_finished_at,
            **fields,
        )
        await self._session.commit()

    async def finish(self, status: RunStatus, payload: dict[str, Any], **fields: Any) -> RunStatus:
        wire = _validated_event_payload(self._run_id, "run.finished", payload)
        final = await runs_repo.finish_run(
            self._scope,
            self._session,
            self._run_id,
            status,
            event_payload=wire,
            event_id=uuid.uuid5(self._run_id, "run.finished"),
            **fields,
        )
        await self._session.commit()
        return final

    async def current_status(self) -> RunStatus:
        run = await runs_repo.get_run(self._scope, self._session, self._run_id)
        status = RunStatus(run.status)
        # Expire AFTER reading: the next get_run must repopulate from the DB
        # (an API-side cancel commits in another session), and reading an
        # expired attribute here would lazy-refresh synchronously.
        self._session.expire(run)
        return status


def _scope_from_payload(payload: dict[str, Any]) -> Scope:
    return Scope(
        user_id=uuid.UUID(payload["user_id"]),
        workspace_id=uuid.UUID(payload["workspace_id"]),
        role=Role.MEMBER,  # write, never admin — least authority that can execute
    )


async def handle_run_execute(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
) -> None:
    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    run = await runs_repo.get_run(scope, session, run_id)
    parent_artifact_id = None
    parent_artifact_version_id = run.artifact_version_id
    parent_artifact_fingerprint = None
    if run.artifact_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, run.artifact_version_id)
        parent_artifact_id = version.artifact_id
        # Provenance only — contracts 2.0.0 forbids treating a prior artifact
        # version as a correctness reference; the fingerprint decides forking.
        parent_artifact_fingerprint = version.fingerprint
    ctx = RunContext(
        run_id=run_id,
        task_prompt=run.task_prompt,
        mode=RunMode(run.mode),
        framework=Framework(run.framework),
        seed=run.seed,
        shots=run.shots,
        timeout_s=run.timeout_s,
        sink=RepoEventSink(scope, session, run_id),
        conversation_id=run.conversation_id,
        source_code=payload.get("source_code"),
        source_framework=Framework(run.framework),
        parent_artifact_id=parent_artifact_id,
    )
    store = RepoRunStateStore(scope, session, run_id)
    try:
        async with asyncio.timeout(run.timeout_s or DEFAULT_RUN_TIMEOUT_S):
            provider = llm or _default_llm()
            ctx = await _resolve_mode(
                ctx,
                store,
                scope=scope,
                session=session,
                llm=provider,
                has_source_code=bool(payload.get("source_code")),
            )
            if ctx.mode is not RunMode.EXECUTE:
                final = await _handle_conversation(ctx, store, provider)
            else:
                final = await _handle_agent_execution(
                    ctx,
                    store,
                    scope=scope,
                    session=session,
                    llm=provider,
                    sandbox=sandbox or _default_sandbox(),
                    parent_artifact_id=parent_artifact_id,
                    parent_artifact_version_id=parent_artifact_version_id,
                    parent_artifact_fingerprint=parent_artifact_fingerprint,
                )
    except TimeoutError:
        # The stage coroutine was cancelled mid-flight; reset the session and
        # record the failure so the event log never ends mid-run.
        await session.rollback()
        if await store.current_status() is RunStatus.RUNNING:
            await _finish_timed_out_run(
                ctx,
                store,
                RepoAgentStore(scope, session),
            )
        final = RunStatus.FAILED
    log.info("run %s finished: %s", run_id, final)


async def _resolve_mode(
    ctx: RunContext,
    store: RepoRunStateStore,
    *,
    scope: Scope,
    session: AsyncSession,
    llm: LLMClient,
    has_source_code: bool,
) -> RunContext:
    """Settle which mode this run dispatches in, before anything else happens.

    Runs ahead of `run.started` on purpose: the resolved mode decides which
    handler owns the run's whole lifecycle, so it has to be known before any
    stage claims it.

    The run row is rewritten to the resolved mode rather than left holding the
    request. Everything downstream — the API resource, the Library, a later
    diagnosis of this run — reads that column, and a row saying `auto` after the
    fact would describe a mode nothing ever ran in.

    Being first in the sequence means this is also now the first thing that can
    touch a run the user already cancelled. Both dispatch handlers re-check the
    status themselves, but they check it *after* this — so without the guard a
    cancelled run would still rewrite its own mode, append an event to a
    finished stream, and spend a model call deciding how to run something that
    will never run.
    """
    if await store.current_status() not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return ctx
    decision = await resolve_mode(
        ctx.task_prompt,
        ctx.mode,
        llm,
        has_source_code=has_source_code,
    )
    if not decision.changed:
        return ctx
    await runs_repo.set_run_mode(scope, session, ctx.run_id, decision.resolved)
    await session.commit()
    await ctx.sink.emit("run.mode_resolved", decision.as_event_payload())
    log.info(
        "run %s mode %s -> %s (%s: %s)",
        ctx.run_id,
        decision.requested,
        decision.resolved,
        decision.source,
        decision.reason,
    )
    return replace(ctx, mode=decision.resolved)


async def _agent_failure_message(
    runtime: AgentRuntime,
    agent_store: AgentStore,
    run_id: uuid.UUID,
) -> str:
    """Explain why the agent loop gave up, in one line a user can act on.

    Two facts are needed and neither was previously reachable from here: the
    budget the runtime hit, and the verifier's actual objection. The critic's
    verdict can be the only failing signal in a run whose deterministic checks all
    pass. It is retained in semantic-review events as well as this terminal
    diagnostic so live failures and later replay tell the same story.
    """
    parts = ["agent tool loop failed"]
    if runtime.failure_reason:
        parts.append(f"({runtime.failure_reason})")

    try:
        candidate = await agent_store.latest_candidate(run_id)
    except Exception:  # noqa: BLE001 - diagnostics must never mask the failure
        candidate = None

    verification = None
    strict = None
    review = None
    if candidate is not None:
        try:
            verification = await agent_store.verification_for(run_id, candidate.candidate_id)
        except Exception:  # noqa: BLE001 - each evidence source is independently optional
            pass
        try:
            strict = await agent_store.latest_strict_verification(run_id, candidate.candidate_id)
        except Exception:  # noqa: BLE001 - preserve any readable legacy evidence
            pass
        try:
            review = await agent_store.latest_semantic_review(run_id, candidate.candidate_id)
        except Exception:  # noqa: BLE001 - preserve any readable strict evidence
            pass

    checks = (
        verification.deterministic_checks
        if verification is not None
        else strict.checks
        if strict
        else []
    )
    if checks:
        failed = [str(check.get("method")) for check in checks if check.get("result") != "pass"]
        if failed:
            parts.append(f"failing checks: {', '.join(failed)}")
        elif verification is not None and verification.critic:
            # All deterministic checks passed, so the critic is what refused.
            summary = verification.critic.get("summary") or verification.critic.get("decision")
            severity = verification.critic.get("severity")
            confidence = verification.critic.get("confidence")
            parts.append(
                f"verifier objection (severity={severity}, confidence={confidence}): {summary}"
            )
        elif review is not None and isinstance(review.feedback.get("critic"), dict):
            critic = review.feedback["critic"]
            summary = critic.get("summary") or review.reason_code
            parts.append(f"semantic objection: {summary}")
    return " — ".join(parts)


def _agent_failure_reason_code(runtime: AgentRuntime) -> str:
    reason = runtime.failure_reason
    if reason and reason.endswith("_budget_exhausted") and reason.replace("_", "").isalnum():
        return reason
    if reason and reason.startswith("replayed tool call "):
        return "replayed_tool_call"
    return "agent_failed"


async def _emit_best_effort(
    ctx: RunContext,
    agent_store: AgentStore,
    failure_reason: str | None,
) -> None:
    """Hand back the closest thing to an answer before reporting the failure.

    A user who waited through four candidates and paid for four model calls used to
    receive one line saying the run did not complete. The code existed the whole
    time. This emits it with the evidence that stopped it, ordered by
    best_effort.choose_best_effort.

    Emitted before `run.error` so a reader of the event stream meets the attempt
    before the epitaph, and wrapped so a diagnostic can never turn a failed run into
    a crashed one — the failure path must stay the most reliable path in the system.
    """
    try:
        candidates = await agent_store.list_candidates(ctx.run_id)
        verifications = {}
        for candidate in candidates:
            legacy = await agent_store.verification_for(ctx.run_id, candidate.candidate_id)
            verifications[candidate.candidate_id] = (
                legacy
                or await agent_store.latest_strict_verification(ctx.run_id, candidate.candidate_id)
            )
        best = choose_best_effort(candidates, verifications)
    except Exception:  # noqa: BLE001 - never mask the failure being reported
        log.exception("best-effort selection failed for run %s", ctx.run_id)
        return
    if best is None:
        return
    await ctx.sink.emit(
        "run.best_effort",
        {
            "language": best.candidate.framework.value,
            "code": best.candidate.source,
            "revision": best.candidate.revision,
            "candidates_considered": best.candidates_considered,
            "exhausted_budget": failure_reason,
            "failed_checks": best.failed_checks,
            "critic_summary": best.critic_summary,
            "residual_risks": best.residual_risks,
        },
        event_id=uuid.uuid5(ctx.run_id, "run.best_effort"),
    )


async def _finish_materialized_agent(ctx, run_store, agent_store) -> RunStatus:
    """Fence a terminal strict verdict into the event stream and Run row."""
    candidate = await agent_store.latest_candidate(ctx.run_id)
    strict = (
        await agent_store.latest_strict_verification(ctx.run_id, candidate.candidate_id)
        if candidate is not None
        else None
    )
    review = (
        await agent_store.latest_semantic_review(ctx.run_id, candidate.candidate_id)
        if candidate is not None
        else None
    )
    legacy = await agent_store.published_verification(ctx.run_id) if strict is None else None
    if strict is not None:
        if candidate.source_fingerprint != strict.source_fingerprint:
            _fingerprint_mismatches.add(1, {"boundary": "candidate_to_strict"})
            raise RuntimeError("terminal strict verdict has a stale candidate fingerprint")
        if review is None or review.review_id != strict.semantic_review_id:
            raise RuntimeError("terminal strict verdict is not bound to the latest review")
        if review.source_fingerprint != strict.source_fingerprint:
            _fingerprint_mismatches.add(1, {"boundary": "review_to_strict"})
            raise RuntimeError("terminal review and strict fingerprints differ")
    decision = strict.decision if strict is not None else legacy.decision if legacy else None
    if decision not in {VerifierDecision.PASS, VerifierDecision.INCONCLUSIVE}:
        raise RuntimeError("materialized run lacks a strict terminal verdict")
    strength = (
        strict.evidence_strength
        if strict is not None and strict.evidence_strength is not None
        else evidence_strength_of(legacy.deterministic_checks)
        if legacy is not None
        else EvidenceStrength.STRUCTURAL
    )
    summary = (
        {
            "decision": strict.decision.value,
            "semantic_review_decision": review.decision.value if review else None,
            "evidence_strength": strength.value,
            "reason_code": strict.reason_code,
            "candidate_defect_observed": strict.candidate_defect_observed,
            "failure_class": strict.failure_class.value if strict.failure_class else None,
            "retry_target": strict.retry_target.value,
            "unverified_claims": strict.unverified_claims,
            "checks": [
                {"method": check.get("method"), "result": check.get("result")}
                for check in strict.checks[:50]
            ],
        }
        if strict is not None
        else None
    )
    result = await run_store.finish(
        RunStatus.SUCCEEDED,
        {
            "status": RunStatus.SUCCEEDED,
            "verifier_decision": decision.value,
            "evidence_strength": strength.value,
            "verification_summary": summary,
            "reason_code": strict.reason_code if strict else "legacy_verified",
        },
        verifier_decision=decision.value,
        verification_summary=summary,
    )
    _record_verification_summary(
        summary
        or {
            "decision": decision.value,
            "reason_code": "legacy_verified",
            "failure_class": None,
            "checks": [],
        }
    )
    return result


async def _finish_resource_exhausted(ctx, run_store, agent_store, failure_reason) -> RunStatus:
    await _emit_best_effort(ctx, agent_store, failure_reason or "resource_exhausted")
    await ctx.sink.emit(
        "run.error",
        {
            "stage": None,
            "code": "resource_exhausted",
            "message": (
                "The selected execution lane does not have enough memory or capacity "
                "for this circuit. The candidate was not sent through code repair."
            ),
        },
        event_id=uuid.uuid5(ctx.run_id, "run.error.resource_exhausted"),
    )
    summary = {
        "decision": "inconclusive",
        "evidence_strength": "structural",
        "reason_code": "resource_exhausted",
        "candidate_defect_observed": False,
        "failure_class": "capability_limit",
        "retry_target": "none",
        "unverified_claims": ["candidate execution within configured resources"],
        "checks": [],
    }
    result = await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "verifier_decision": "inconclusive",
            "reason_code": "resource_exhausted",
            "verification_summary": summary,
        },
        verifier_decision="inconclusive",
        verification_summary=summary,
    )
    _record_verification_summary(summary)
    return result


async def _bound_latest_strict_summary(run_id, agent_store):
    candidate = await agent_store.latest_candidate(run_id)
    if candidate is None:
        return None, None
    strict = await agent_store.latest_strict_verification(run_id, candidate.candidate_id)
    if strict is None:
        return None, None
    execution = await agent_store.execution_for(run_id, candidate.candidate_id)
    review = await agent_store.latest_semantic_review(run_id, candidate.candidate_id)
    if execution is None or review is None:
        raise RuntimeError("strict terminal evidence is missing its bound execution or review")
    try:
        strict.assert_binding(candidate, execution, review)
    except ValueError:
        _fingerprint_mismatches.add(1, {"boundary": "terminal_evidence_chain"})
        raise
    strength = strict.evidence_strength or evidence_strength_of(strict.checks)
    return strict, {
        "decision": strict.decision.value,
        "semantic_review_decision": review.decision.value,
        "evidence_strength": strength.value,
        "reason_code": strict.reason_code,
        "candidate_defect_observed": strict.candidate_defect_observed,
        "failure_class": strict.failure_class.value if strict.failure_class else None,
        "retry_target": strict.retry_target.value,
        "unverified_claims": strict.unverified_claims,
        "checks": [
            {"method": check.get("method"), "result": check.get("result")}
            for check in strict.checks[:50]
        ],
    }


async def _finish_failed_agent(
    ctx, run_store, agent_store, *, failure_reason: str, failure_message: str
) -> RunStatus:
    await _emit_best_effort(ctx, agent_store, failure_reason)
    await ctx.sink.emit(
        "run.error",
        {"stage": None, "code": "agent_failed", "message": failure_message},
        event_id=uuid.uuid5(ctx.run_id, "run.error.agent_failed"),
    )
    strict, summary = await _bound_latest_strict_summary(ctx.run_id, agent_store)
    payload = {"status": RunStatus.FAILED, "reason_code": failure_reason}
    fields = {}
    if strict is not None and summary is not None:
        payload.update(
            verifier_decision=strict.decision.value,
            verification_summary=summary,
        )
        fields.update(
            verifier_decision=strict.decision.value,
            verification_summary=summary,
        )
    result = await run_store.finish(RunStatus.FAILED, payload, **fields)
    if summary is not None:
        _record_verification_summary(summary)
    return result


async def _finish_timed_out_run(ctx, run_store, agent_store) -> RunStatus:
    await ctx.sink.emit(
        "run.error",
        {"stage": None, "code": "run_timeout", "message": "run exceeded its time budget"},
    )
    strict, summary = await _bound_latest_strict_summary(ctx.run_id, agent_store)
    if strict is None or summary is None:
        decision = VerifierDecision.INCONCLUSIVE
        summary = {
            "decision": decision.value,
            "semantic_review_decision": None,
            "evidence_strength": None,
            "reason_code": "run_timeout",
            "candidate_defect_observed": False,
            "failure_class": VerificationFailureClass.VERIFIER_FAILURE.value,
            "retry_target": RetryTarget.VERIFICATION.value,
            "unverified_claims": ["verification completion"],
            "checks": [],
        }
    else:
        decision = strict.decision
    result = await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": "run_timeout",
            "verifier_decision": decision.value,
            "verification_summary": summary,
        },
        verifier_decision=decision.value,
        verification_summary=summary,
    )
    _record_verification_summary(summary)
    return result


async def _handle_agent_execution(
    ctx: RunContext,
    run_store: RepoRunStateStore,
    *,
    scope: Scope,
    session: AsyncSession,
    llm: LLMClient,
    sandbox: Sandbox,
    parent_artifact_id: uuid.UUID | None,
    parent_artifact_version_id: uuid.UUID | None = None,
    parent_artifact_fingerprint: str | None = None,
) -> RunStatus:
    status = await run_store.current_status()
    if status not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return status
    if status is RunStatus.QUEUED:
        await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    # Re-emitting on RUNNING repairs a crash between the status transition and
    # event append; the deterministic ID prevents a duplicate event.
    await ctx.sink.emit("run.started", {}, event_id=uuid.uuid5(ctx.run_id, "run.started"))

    agent_store = RepoAgentStore(scope, session)
    metered_llm = MeteredAgentLLM(
        delegate=llm,
        sink=ctx.sink,
        scope=scope,
        session=session,
        run_id=ctx.run_id,
    )
    toolset = CircuitToolset(
        store=agent_store,
        framework=ctx.framework,
        planner=LLMPlanner(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
            framework=ctx.framework,
            requested_shots=ctx.shots,
            requested_seed=ctx.seed,
        ),
        executor=SandboxCandidateExecutor(sandbox),
        reviewer=EvidenceReviewer(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
        ),
        strict_verifier=EvidenceStrictVerifier(),
        converter=TrustedOpenQASMConverter(),
        materializer=RepoArtifactMaterializer(
            scope=scope,
            session=session,
            run_id=ctx.run_id,
            parent_artifact_id=parent_artifact_id,
            parent_artifact_version_id=parent_artifact_version_id,
            parent_artifact_fingerprint=parent_artifact_fingerprint,
            title=ctx.task_prompt,
            allow_inconclusive=_enabled(
                "MAJORANA_INCONCLUSIVE_MATERIALIZATION_ENABLED", default=True
            ),
        ),
    )
    broker = ToolBroker(
        store=agent_store,
        policy=AgentPolicy(framework=ctx.framework),
        handlers=toolset.handlers(),
    )

    async def cancelled() -> bool:
        return await run_store.current_status() is RunStatus.CANCELLED

    observer = AgentEventObserver(store=agent_store, sink=ctx.sink)
    await observer.recover(ctx.run_id)
    runtime = AgentRuntime(
        store=agent_store,
        broker=broker,
        model=StructuredToolModel(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
            framework=ctx.framework,
            initial_source=ctx.source_code,
        ),
        observer=observer,
        cancel_requested=cancelled,
    )
    final = await runtime.run(ctx.run_id)
    if final is AgentState.CANCELLED:
        return await run_store.finish(
            RunStatus.CANCELLED,
            {"status": RunStatus.CANCELLED},
        )
    if final in {AgentState.MATERIALIZED, AgentState.PUBLISHED}:
        return await _finish_materialized_agent(ctx, run_store, agent_store)
    if final is AgentState.RESOURCE_EXHAUSTED:
        return await _finish_resource_exhausted(
            ctx,
            run_store,
            agent_store,
            runtime.failure_reason,
        )
    # "agent tool loop failed" alone is undiagnosable: the run that exposed this
    # showed four passing verification checks and then died. Carry the exhausted
    # budget here as well as the now-replayable semantic-review objection.
    return await _finish_failed_agent(
        ctx,
        run_store,
        agent_store,
        failure_reason=_agent_failure_reason_code(runtime),
        failure_message=await _agent_failure_message(runtime, agent_store, ctx.run_id),
    )


async def _handle_conversation(
    ctx: RunContext, store: RepoRunStateStore, llm: LLMClient
) -> RunStatus:
    """Answer a direct chat turn without invoking the execution pipeline."""
    status = await store.current_status()
    if status is not RunStatus.QUEUED:
        return status
    await store.set_status(RunStatus.RUNNING, started_at_now=True)
    await ctx.sink.emit("run.started", {})

    history = (
        await runs_repo.list_conversation_messages(
            store._scope,
            store._session,
            ctx.conversation_id,
            exclude_run_id=ctx.run_id,
        )
        if ctx.conversation_id is not None
        else []
    )
    model = model_for("chat")
    started = asyncio.get_running_loop().time()
    buffers = {"reasoning": "", "output": ""}

    async def on_delta(text: str, kind: str) -> None:
        normalized = kind if kind in buffers else "output"
        if not text:
            return
        buffers[normalized] += text
        while len(buffers[normalized]) >= 160:
            chunk, buffers[normalized] = (
                buffers[normalized][:160],
                buffers[normalized][160:],
            )
            await ctx.sink.emit(
                "chat.delta",
                {"kind": normalized, "text": chunk},
            )

    async def flush_deltas() -> None:
        for kind, text in buffers.items():
            if text:
                await ctx.sink.emit("chat.delta", {"kind": kind, "text": text})

    try:
        response = await llm.complete(
            LLMRequest(
                model=model,
                system=QUANTUM_AGENT_SYSTEM_PROMPT,
                user=ctx.task_prompt,
                messages=[*history, {"role": "user", "content": ctx.task_prompt}],
                temperature=0.7,
            ),
            on_delta=on_delta,
        )
    except Exception:
        log.exception("chat provider failed for run %s", ctx.run_id)
        await flush_deltas()
        await ctx.sink.emit(
            "chat.error",
            {
                "code": "provider_failed",
                "message": "The assistant could not complete this response.",
            },
        )
        return await store.finish(
            RunStatus.FAILED,
            {"status": RunStatus.FAILED, "reason_code": "provider_failed"},
        )

    await flush_deltas()
    interpretation = response.text.strip() or "The assistant returned an empty response."
    await ctx.sink.emit(
        "chat.completed",
        {
            "text": interpretation,
            "model": response.model,
            "input_tokens": response.input_tokens,
            "output_tokens": response.output_tokens,
            "duration_ms": int((asyncio.get_running_loop().time() - started) * 1000),
        },
    )
    return await store.finish(
        RunStatus.SUCCEEDED,
        {
            "status": RunStatus.SUCCEEDED,
        },
    )


JobHandler = Callable[[AsyncSession, dict[str, Any]], Awaitable[None]]
DeadLetterHandler = Callable[[AsyncSession, dict[str, Any], str], Awaitable[None]]


async def handle_run_dead_letter(
    session: AsyncSession, payload: dict[str, Any], reason: str
) -> None:
    """Close an active run when its durable execution job cannot continue."""
    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    error_payload = _validated_event_payload(
        run_id,
        "run.error",
        {"stage": None, "code": "job_dead_letter", "message": reason[:2000]},
    )
    await runs_repo.fail_run_from_dead_letter(
        scope,
        session,
        run_id,
        error_payload=error_payload,
        error_event_id=uuid.uuid5(run_id, "run.error.job_dead_letter"),
        finished_event_id=uuid.uuid5(run_id, "run.finished"),
    )
    await session.commit()


async def close_orphaned_run(session: AsyncSession, orphan: system.OrphanedRun) -> bool:
    """Close a run whose execution job is terminal but which nothing ever finished.

    Reconciles from the run side, because delivery from the job side is not
    guaranteed to happen: `mark_job_dead_lettered` stamps `dead_lettered_at` once
    its retry budget is spent whether or not the callback succeeded, after which
    the job leaves the delivery candidate set for good. Twelve production runs
    spun in `running` for days that way.

    The event IDs are the same deterministic uuid5 values `handle_run_dead_letter`
    uses, so this completes a partial sequence rather than writing a rival one,
    and `fail_run_from_dead_letter` no-ops on an already-terminal run.
    """
    reason = (
        "execution job ended without closing this run"
        if orphan.delivery_error is None
        else f"dead-letter delivery was abandoned: {orphan.delivery_error}"
    )
    scope = Scope(
        user_id=orphan.user_id,
        workspace_id=orphan.workspace_id,
        role=Role.MEMBER,  # write, never admin — least authority that can close a run
    )
    error_payload = _validated_event_payload(
        orphan.run_id,
        "run.error",
        {"stage": None, "code": "run_orphaned", "message": reason[:2000]},
    )
    closed = await runs_repo.fail_run_from_dead_letter(
        scope,
        session,
        orphan.run_id,
        error_payload=error_payload,
        error_event_id=uuid.uuid5(orphan.run_id, "run.error.job_dead_letter"),
        finished_event_id=uuid.uuid5(orphan.run_id, "run.finished"),
    )
    await session.commit()
    return closed


def validated_fixtures_dir(payload: dict[str, Any]) -> Path:
    """Fail closed on the fixtures path carried in a job payload.

    The payload travels through the database between enqueue and dispatch, so the
    worker must not treat it as a trusted filesystem reference: the resolved path
    (symlinks followed) has to sit inside the operator-pinned
    MAJORANA_IMPORT_FIXTURES_ROOT, and catalog imports refuse to run at all while
    that root is unset.
    """
    root = os.environ.get("MAJORANA_IMPORT_FIXTURES_ROOT", "").strip()
    if not root:
        raise RuntimeError(
            "MAJORANA_IMPORT_FIXTURES_ROOT is not set; refusing to process catalog imports"
        )
    root_path = Path(root).resolve()
    requested = Path(payload["fixtures_dir"]).resolve()
    if not requested.is_relative_to(root_path):
        raise RuntimeError(
            f"fixtures_dir {requested} escapes MAJORANA_IMPORT_FIXTURES_ROOT {root_path}"
        )
    return requested


def _source_for_import(import_job: ImportJob, payload: dict[str, Any]) -> ImportSource:
    """Rebuild the import source recorded on a queued batch, failing closed.

    The provider is read from the durable ImportJob row (server-trusted), not
    the payload. For local fixtures the payload's path is validated against the
    operator-pinned root; for the pinned bootstrap manifest the loaded
    manifest's checksum must still match the one captured at enqueue, or the
    pinned manifest changed under a queued job and we refuse rather than import
    drifted content. Either way, no network fetch happens here.
    """
    provider = ImportProvider(import_job.provider)
    if provider is ImportProvider.LOCAL_FIXTURE:
        return LocalFixtureSource(
            validated_fixtures_dir(payload), upstream_ref=import_job.upstream_ref
        )
    if provider is ImportProvider.CATALOG_BOOTSTRAP:
        source = BootstrapManifestSource()
        if payload.get("manifest_checksum") != source.manifest_checksum:
            raise RuntimeError(
                "bootstrap manifest checksum drifted since this job was enqueued; refusing"
            )
        return source
    raise RuntimeError(f"unsupported import provider {provider!r}")


async def handle_catalog_import(session: AsyncSession, payload: dict[str, Any]) -> None:
    """Advance one durable import batch by one pass over its non-terminal
    items (repos/catalog_import.py). Idempotent and crash-safe: re-running
    the same batch (same idempotency_key) only touches items still short of
    a terminal state.

    Step 5a scope only: the importer scope comes from server configuration
    (CatalogAuthority), never the payload, and the source is reconstructed from
    the durable job row — no network fetch happens here.
    """
    authority = CatalogAuthority.from_env()
    scope = authority.importer_scope()
    import_job = await catalog_import_repo.get_import_job_by_idempotency_key(
        session, payload["idempotency_key"]
    )
    source = _source_for_import(import_job, payload)
    await catalog_import_repo.process_import_batch(
        scope,
        session,
        import_job.id,
        authority=authority,
        source=source,
    )


async def handle_qpu_run(session: AsyncSession, payload: dict[str, Any]) -> None:
    """Fail-closed half of the durable qpu_run seam (two-PR schema change).

    No producer enqueues this kind yet — the submission endpoint refuses
    before enqueue — so any row that reaches here fails permanently with a
    typed reason instead of contacting a provider. The migration PR replaces
    this body with submit/poll against the durable qpu_run record; the payload
    validation and gate re-check (defense in depth — the API checked them too)
    stay exactly as written."""
    try:
        QpuRunJobPayload.model_validate(payload)
    except ValidationError as exc:
        raise RuntimeError(f"qpu.run payload malformed: {exc}") from exc
    reason = submission_block_reason()
    if reason is not None:
        raise RuntimeError(f"qpu.run blocked: {reason.value}")
    raise RuntimeError("qpu.run blocked: durable_record_unavailable")


HANDLERS: dict[str, JobHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_execute,
    CATALOG_IMPORT_JOB_KIND: handle_catalog_import,
    QPU_RUN_JOB_KIND: handle_qpu_run,
}

DEAD_LETTER_HANDLERS: dict[str, DeadLetterHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_dead_letter,
}
