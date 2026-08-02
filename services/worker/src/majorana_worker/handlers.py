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
from datetime import UTC, datetime, timedelta
from typing import Any, Awaitable, Callable

from majorana_contracts import Scope
from majorana_contracts.enums import (
    CHAT_USAGE_ROLE,
    EvidenceStrength,
    Framework,
    ImportProvider,
    QpuRunStatus,
    Role,
    RunMode,
    RunStatus,
    Stage,
    UsageKind,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_agent import (
    SimpleCircuitPipeline,
    SimplePipelineOutcome,
    SimplePipelineStage,
    SimplePipelineStatus,
)
from majorana_contracts.events import run_event_adapter
from majorana_llm import (
    CHAT_SYSTEM_PROMPT,
    LLMClient,
    LLMRequest,
    default_llm,
    model_for,
    render_conversation_title_prompt,
)
from majorana_qpu import (
    QpuJobRequest,
    QpuJobStatus,
    QpuRunJobPayload,
    submission_block_reason,
)
from pydantic import ValidationError
from majorana_sandbox import LocalSubprocessSandbox, Sandbox, VercelSandbox
from opentelemetry import metrics

from pathlib import Path

from majorana_api import credential_crypto
from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.catalog_bootstrap_manifest import BootstrapManifestSource
from majorana_api.catalog_import_fixtures import LocalFixtureSource
from majorana_api.catalog_import_sources import ImportSource
from majorana_api.db import AsyncSession
from majorana_api.jobs import CATALOG_IMPORT_JOB_KIND, QPU_RUN_JOB_KIND, RUN_EXECUTE_JOB_KIND
from majorana_api.orm import ImportJob, User
from majorana_api.repos import catalog_import as catalog_import_repo
from majorana_api.repos import provider_credentials as credentials_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.repos import system
from majorana_api.repos import usage as usage_repo
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.tiers import EnvTierSources, limits_for, tier_of

from .agent_llm import MeteredAgentLLM
from .agent_store import RepoAgentStore
from .context import RunContext
from .intent import resolve_mode
from majorana_frameworks.roles import result_was_derived

from .runtime_ports import SandboxCandidateExecutor, TrustedOpenQASMConverter
from .simple_events import SimpleEventObserver
from .simple_ports import (
    ProductionSimplePipelinePorts,
    RepoReviewArtifactSaver,
    SimpleIntentReviewer,
    passed_reference_methods,
    simple_pipeline_verification_summary,
)

log = logging.getLogger("majorana_worker")

# DeepSeek V4 Pro can legitimately spend several minutes across planning,
# generation, and review. Keep the worker default aligned with the API's
# explicit upper bound so an omitted timeout is not stricter than an accepted
# client timeout.
DEFAULT_RUN_TIMEOUT_S = 600.0

_verification_meter = metrics.get_meter("majorana.worker.verification")
_verification_decisions = _verification_meter.create_counter("majorana.verification.decisions")
_verification_routes = _verification_meter.create_counter("majorana.verification.routes")
_verification_errors = _verification_meter.create_counter("majorana.verification.errors")
_DECISIONS = frozenset(decision.value for decision in VerifierDecision)
_FAILURE_CLASSES = frozenset(item.value for item in VerificationFailureClass)
_ROUTE_BY_REASON = {
    "strict_pass": "pass",
    "legacy_verified": "legacy",
    "resource_exhausted": "resource_exhausted",
    "run_timeout": "timeout",
}


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
    timeout_s = float(run.timeout_s or DEFAULT_RUN_TIMEOUT_S)
    run_deadline = asyncio.get_running_loop().time() + timeout_s
    try:
        async with asyncio.timeout(timeout_s):
            provider = llm or _default_llm()
            ctx = await _resolve_mode(
                ctx,
                store,
                scope=scope,
                session=session,
                llm=provider,
                has_source_code=bool(payload.get("source_code")),
            )
            ctx = await _title_conversation(ctx, store, scope=scope, session=session, llm=provider)
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
                    run_deadline=run_deadline,
                )
    except _RunAllowanceExhausted as exhausted:
        # A refusal, not a fault: the run ends in its own event stream with a
        # reason the user recognises, exactly as the API's admission gate words it.
        final = await _finish_allowance_exhausted(ctx, store, exhausted)
    except TimeoutError:
        # The stage coroutine was cancelled mid-flight; reset the session and
        # record the failure so the event log never ends mid-run.
        await session.rollback()
        if await store.current_status() is RunStatus.RUNNING:
            await _finish_timed_out_run(ctx, store)
        final = RunStatus.FAILED
    log.info("run %s finished: %s", run_id, final)


#: How long naming may take before the run gives up and uses its own fallback.
#: A name is decoration; a user waiting on an answer is not, so this is short.
_TITLE_TIMEOUT_S = 8.0
_TITLE_MAX_WORDS = 5
_TITLE_MAX_CHARS = 60


def normalize_conversation_title(raw: str) -> str | None:
    """Reduce a model's reply to a title, or None if there is nothing usable.

    Word-capping is whitespace-based, which is the right rule for the languages
    that use spaces and a no-op for Japanese — where a five-"word" cap has no
    meaning and the character cap is what actually bounds the row. Applying a
    space-based cap to Japanese would truncate nothing; applying only a character
    cap to English would let a nine-word title through. Both run, in that order.
    """
    text = " ".join(raw.strip().split())
    if not text:
        return None
    # Models like to answer a naming request with `Title: "Bell state"`.
    lowered = text.lower()
    for prefix in ("title:", "タイトル:", "タイトル："):
        if lowered.startswith(prefix):
            text = text[len(prefix) :].strip()
            break
    text = text.strip("\"'`“”«»「」『』 \t")
    words = text.split()
    if len(words) > _TITLE_MAX_WORDS:
        text = " ".join(words[:_TITLE_MAX_WORDS])
    text = text[:_TITLE_MAX_CHARS].rstrip(" .、。,")
    return text or None


def fallback_conversation_title(task_prompt: str) -> str | None:
    """The name to use when the model could not supply one.

    Deliberately the same shape as a model title — first clause, five words —
    rather than the whole prompt. The failure mode being fixed is sidebar rows
    that are paragraphs, and a fallback that reintroduces them just moves the
    defect behind a provider outage.
    """
    first_line = task_prompt.strip().split("\n", 1)[0]
    return normalize_conversation_title(first_line)


async def _title_conversation(
    ctx: RunContext,
    store: RepoRunStateStore,
    *,
    scope: Scope,
    session: AsyncSession,
    llm: LLMClient,
) -> RunContext:
    """Name this turn, and — on the opening turn only — the conversation.

    Runs before dispatch so both modes are named the same way. The name is
    always computed, because an artifact saved by *any* turn needs a short title
    and the alternative is the raw prompt. The `conversation.titled` event is
    emitted only when no earlier turn exists: a sidebar row that renamed itself
    every time the user sent another message would not be an identity for the
    thread.

    Nothing here may fail a run. A conversation with a clumsy name is a working
    conversation; a run that died naming itself is not.
    """
    if await store.current_status() not in {RunStatus.QUEUED, RunStatus.RUNNING}:
        return ctx
    opening_turn = True
    if ctx.conversation_id is not None:
        earlier = await runs_repo.list_conversation_messages(
            scope, session, ctx.conversation_id, exclude_run_id=ctx.run_id
        )
        opening_turn = not earlier

    title: str | None = None
    source = "model"
    prompt = render_conversation_title_prompt(ctx.task_prompt)
    try:
        async with asyncio.timeout(_TITLE_TIMEOUT_S):
            response = await llm.complete(
                LLMRequest(
                    model=model_for("writeback"),
                    system=prompt.system,
                    user=prompt.user,
                    temperature=0.0,
                    # max_tokens is deliberately unset. The writeback role runs a
                    # reasoning model, and a small ceiling is what bench-14 proved
                    # can consume the whole budget on reasoning and return empty
                    # content — the exact failure a title cap looks safe against.
                )
            )
        title = normalize_conversation_title(response.text)
    except Exception:
        log.warning("conversation naming failed for run %s", ctx.run_id, exc_info=True)
    if title is None:
        title = fallback_conversation_title(ctx.task_prompt)
        source = "fallback"
    if title is None:
        return ctx
    if opening_turn:
        await ctx.sink.emit("conversation.titled", {"title": title, "source": source})
    return replace(ctx, conversation_title=title)


#: Seven days, matching the API's TIER_WINDOW so a user never sees two different
#: "used" numbers depending on which service refused them.
_TIER_WINDOW = timedelta(days=7)


class _RunAllowanceExhausted(Exception):
    """An AUTO run resolved to EXECUTE with the account's weekly runs spent.

    Raised rather than handled in place because the caller dispatches on
    `ctx.mode` immediately afterwards: quietly leaving the mode unresolved would
    send a finished run into the conversation handler.
    """

    def __init__(self, used: int, limit: int) -> None:
        super().__init__(f"{used}/{limit} weekly execute runs used")
        self.used = used
        self.limit = limit


async def _assert_execute_allowance(scope: Scope, session: AsyncSession) -> None:
    """The other half of the per-tier gate the API applies at admission.

    The API can only refuse an EXPLICIT `mode=execute` submission: an AUTO
    request has not decided what it is yet, and refusing those would refuse
    ordinary chat, which is unmetered by policy. So a caller could spend an
    unlimited number of executions simply by omitting `mode`. This is where that
    closes, because this is where AUTO actually becomes EXECUTE.

    Reads the tier from the same three signals the API does (majorana_api.tiers).

    The allowlist is read straight from the environment rather than through
    `Settings.from_env()`, and that is not a shortcut. Settings validates the
    whole API service's configuration, including `WORKOS_CLIENT_ID` — which the
    worker has never had and does not need, because it authenticates nothing.
    Constructing Settings here therefore raised RuntimeError on every AUTO run
    that resolved to EXECUTE in production, turning an allowance check into an
    outage. The worker needs one value; it reads that one value.
    """
    user = await session.get(User, scope.user_id)
    if user is None:  # pragma: no cover - a run cannot outlive its owner
        return
    limits = limits_for(tier_of(user, EnvTierSources.from_env()))
    if limits.agent_runs_per_week is None:
        return
    since = datetime.now(UTC) - _TIER_WINDOW
    used = await runs_repo.count_execute_runs_since(scope, session, since)
    # The run being resolved is still AUTO in the database, so it is not in this
    # count — `used >= limit` is the correct comparison, not `>`.
    if used >= limits.agent_runs_per_week:
        raise _RunAllowanceExhausted(used, limits.agent_runs_per_week)


async def _finish_allowance_exhausted(
    ctx: RunContext,
    run_store: RepoRunStateStore,
    exhausted: _RunAllowanceExhausted,
) -> RunStatus:
    """Refuse the execution in the run's own event stream, not as a crash."""
    await ctx.sink.emit(
        "run.error",
        {
            "stage": None,
            "code": "run_allowance_exhausted",
            "message": (
                f"Your plan includes {exhausted.limit} verified runs per week and all "
                f"{exhausted.limit} are used. Browser simulation in Studio stays available."
            ),
        },
        event_id=uuid.uuid5(ctx.run_id, "run.error.run_allowance_exhausted"),
    )
    return await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": "run_allowance_exhausted",
        },
    )


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
    if decision.resolved is RunMode.EXECUTE:
        # Checked BEFORE the row is rewritten, so this run is not counted
        # against its own allowance.
        await _assert_execute_allowance(scope, session)
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


async def _finish_timed_out_run(ctx: RunContext, run_store: RepoRunStateStore) -> RunStatus:
    """Close a cancelled stage without consulting legacy verification state."""
    await ctx.sink.emit(
        "run.error",
        {"stage": None, "code": "run_timeout", "message": "run exceeded its time budget"},
        event_id=uuid.uuid5(ctx.run_id, "run.error.run_timeout"),
    )
    return await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": "run_timeout",
        },
    )


async def _finish_legacy_progress(
    ctx: RunContext,
    run_store: RepoRunStateStore,
) -> RunStatus:
    """Stop an old partial tool loop instead of mixing two orchestration engines."""
    await ctx.sink.emit(
        "run.error",
        {
            "stage": None,
            "code": "legacy_run_requires_restart",
            "message": (
                "This unfinished run uses the retired agent pipeline. "
                "Start a new run to use the fixed circuit workflow."
            ),
        },
        event_id=uuid.uuid5(ctx.run_id, "run.error.legacy_run_requires_restart"),
    )
    return await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": "legacy_run_requires_restart",
        },
    )


async def _handle_agent_execution(
    ctx: RunContext,
    run_store: RepoRunStateStore,
    *,
    scope: Scope,
    session: AsyncSession,
    llm: LLMClient,
    sandbox: Sandbox,
    parent_artifact_id: uuid.UUID | None,
    run_deadline: float,
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
    if await agent_store.has_legacy_progress(ctx.run_id):
        return await _finish_legacy_progress(ctx, run_store)
    metered_llm = MeteredAgentLLM(
        delegate=llm,
        sink=ctx.sink,
        scope=scope,
        session=session,
        run_id=ctx.run_id,
    )

    async def cancelled() -> bool:
        return await run_store.current_status() is RunStatus.CANCELLED

    observer = SimpleEventObserver(store=agent_store, sink=ctx.sink)
    await observer.recover(ctx.run_id)
    # Read here rather than on the save path: save runs only after every
    # expensive stage has already succeeded, and is the worst place to introduce
    # a query that can fail (0036).
    auto_keep_artifacts = await workspaces_repo.auto_keep_artifacts(scope, session)
    # The owner's artifact allowance, resolved here for the same reason and from
    # the same two environment variables the run allowance uses. `None` when the
    # owner row is gone, which cannot happen to a live run and which reads as
    # "unlimited" — the safe direction for a worker: an artifact the account is
    # entitled to is never lost because a lookup came back empty.
    owner = await session.get(User, scope.user_id)
    artifact_limit = (
        limits_for(tier_of(owner, EnvTierSources.from_env())).private_artifacts
        if owner is not None
        else None
    )
    ports = ProductionSimplePipelinePorts(
        store=agent_store,
        observer=observer,
        llm=metered_llm,
        executor=SandboxCandidateExecutor(sandbox),
        reviewer=SimpleIntentReviewer(
            llm=metered_llm,
            task_prompt=ctx.task_prompt,
        ),
        converter=TrustedOpenQASMConverter(),
        saver=RepoReviewArtifactSaver(
            scope=scope,
            session=session,
            run_id=ctx.run_id,
            parent_artifact_id=parent_artifact_id,
            parent_artifact_version_id=parent_artifact_version_id,
            parent_artifact_fingerprint=parent_artifact_fingerprint,
            # The conversation's own short name when it has one. Falling back to
            # the raw prompt is what titled every Vault row with a paragraph;
            # keep it only as the last resort it is.
            title=ctx.conversation_title or ctx.task_prompt,
            auto_keep=auto_keep_artifacts,
            artifact_limit=artifact_limit,
        ),
        task_prompt=ctx.task_prompt,
        framework=ctx.framework,
        requested_shots=ctx.shots,
        requested_seed=ctx.seed,
        initial_source=ctx.source_code,
        rollback=session.rollback,
    )
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        cancel_requested=cancelled,
        remaining_time_s=lambda: run_deadline - asyncio.get_running_loop().time(),
        monotonic=asyncio.get_running_loop().time,
    ).run(ctx.run_id)
    if ports.projection_dirty:
        # Durable records are authoritative. Do not terminalize until their
        # idempotent public projection has caught up.
        await observer.recover(ctx.run_id)
    return await _finish_simple_pipeline(ctx, run_store, outcome)


_SIMPLE_EVENT_STAGE = {
    SimplePipelineStage.PLANNING: Stage.PLAN,
    SimplePipelineStage.GENERATING: Stage.GENERATE,
    SimplePipelineStage.EXECUTING: Stage.FINAL_EXECUTE,
    SimplePipelineStage.CHECKING: Stage.SCREEN,
    SimplePipelineStage.REVIEWING: Stage.VERIFY,
    SimplePipelineStage.EXPORTING: Stage.EXPORT,
    SimplePipelineStage.SAVING: Stage.SAVE,
    SimplePipelineStage.COMPLETED: Stage.SAVE,
}


def _string_list(value: object, *, limit: int) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    return [str(item)[:1000] for item in value[:limit] if str(item).strip()]


async def _emit_failed_candidate(
    ctx: RunContext,
    outcome: SimplePipelineOutcome,
) -> None:
    """Expose the last bounded candidate without querying legacy verifier state."""
    candidate = outcome.candidate
    failure = outcome.failure
    if candidate is None or failure is None:
        return

    critic = (
        outcome.review.feedback.get("critic")
        if outcome.review is not None and isinstance(outcome.review.feedback, dict)
        else None
    )
    critic = critic if isinstance(critic, dict) else {}
    failed_checks = _string_list(critic.get("failed_checks"), limit=30)
    if not failed_checks:
        failed_checks = _string_list(failure.details.get("diagnostics"), limit=30)
    mismatches = _string_list(critic.get("mismatches"), limit=30)
    if not failed_checks:
        failed_checks = mismatches

    await ctx.sink.emit(
        "run.best_effort",
        {
            "language": candidate.framework.value,
            "code": candidate.source,
            "revision": candidate.revision,
            "candidates_considered": max(1, outcome.counters.generation_attempts),
            "exhausted_budget": failure.code,
            "failed_checks": failed_checks,
            "critic_summary": (
                str(critic["summary"])[:2000] if critic.get("summary") is not None else None
            ),
            "residual_risks": _string_list(critic.get("residual_risks"), limit=20),
        },
        event_id=uuid.uuid5(ctx.run_id, "run.best_effort"),
    )


async def _finish_simple_pipeline(
    ctx: RunContext,
    run_store: RepoRunStateStore,
    outcome: SimplePipelineOutcome,
) -> RunStatus:
    """Close one fixed-pipeline outcome with an explicit, non-PASS trust state."""
    if outcome.status is SimplePipelineStatus.CANCELLED:
        return await run_store.finish(
            RunStatus.CANCELLED,
            {
                "status": RunStatus.CANCELLED,
                "reason_code": "run_cancelled",
            },
        )
    if outcome.status is SimplePipelineStatus.SUCCEEDED:
        candidate = outcome.candidate
        execution = outcome.execution
        review = outcome.review
        artifact = outcome.artifact
        if candidate is None or execution is None or review is None or artifact is None:
            raise RuntimeError("simple pipeline succeeded without its durable evidence chain")
        review.assert_binding(candidate, execution)
        if (
            artifact.candidate_id != candidate.candidate_id
            or artifact.source_fingerprint != candidate.source_fingerprint
        ):
            raise RuntimeError("simple pipeline artifact is not bound to the executed candidate")
        critic = review.feedback.get("critic")
        risks = critic.get("residual_risks") if isinstance(critic, dict) else None
        residual_risks = (
            "\n".join(str(item)[:1000] for item in risks[:20]) if isinstance(risks, list) else None
        )
        reference_methods = passed_reference_methods(review)
        # The run's summary and the artifact's are two writers of one claim. A
        # flag passed to one and not the other is how a run says the program
        # returned its result while the artifact saved from that same execution
        # says the platform derived it.
        summary = simple_pipeline_verification_summary(
            reference_methods,
            review.decision,
            result_derived=result_was_derived(execution.observation),
        )
        final = await run_store.finish(
            RunStatus.SUCCEEDED,
            {
                "status": RunStatus.SUCCEEDED,
                "verifier_decision": VerifierDecision.INCONCLUSIVE,
                "evidence_strength": (
                    EvidenceStrength.PHYSICAL if reference_methods else EvidenceStrength.STRUCTURAL
                ),
                "reason_code": summary["reason_code"],
                "residual_risks": residual_risks,
                "verification_summary": summary,
            },
            verifier_decision=VerifierDecision.INCONCLUSIVE,
            verification_summary=summary,
            residual_risks=residual_risks,
        )
        _record_verification_summary(summary)
        return final

    failure = outcome.failure
    if failure is None:
        raise RuntimeError("failed simple pipeline lacks a typed failure")
    await _emit_failed_candidate(ctx, outcome)
    await ctx.sink.emit(
        "run.error",
        {
            "stage": _SIMPLE_EVENT_STAGE[failure.stage],
            "code": failure.code,
            "message": failure.message,
        },
        event_id=uuid.uuid5(ctx.run_id, f"run.error.simple:{failure.code}"),
    )
    return await run_store.finish(
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": failure.code,
        },
    )


def _is_uuid(value: Any) -> bool:
    try:
        uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return False
    return True


async def _record_chat_usage(ctx: RunContext, store: RepoRunStateStore, response: Any) -> None:
    """Write a chat turn's tokens to the usage ledger.

    Execute runs have always been metered — `MeteredAgentLLM` records every call
    it wraps. Chat does not go through it: this handler calls the provider
    directly, so its tokens reached the `chat.completed` event and nowhere
    durable. That event is a per-run projection, so "what did chat cost last
    week" had no answer — on the one surface with no allowance, no submission
    backstop, and up to 8,000 tokens of history per turn.

    Two deliberate choices:

    * The event id is derived from the run, so a redelivered job cannot count
      the turn twice. It is not the stronger guarantee MeteredAgentLLM gets —
      that one replays a *stored* response, while a retried chat turn calls the
      provider again and legitimately spends different tokens. When the counts
      differ the repository refuses the reused key, which is the honest outcome:
      the first figure stands and the retry is visible in the logs rather than
      silently overwriting it.
    * Failing to meter never fails the turn. The answer has already been
      generated and streamed to the reader; taking it away because accounting
      hiccuped would be strictly worse than an incomplete ledger, and metering
      here is for cost visibility, not enforcement.
    """
    scope = getattr(store, "_scope", None)
    session = getattr(store, "_session", None)
    if scope is None or session is None:
        return
    try:
        await usage_repo.record_usage(
            scope,
            session,
            kind=UsageKind.LLM_TOKENS,
            quantity=(response.input_tokens or 0) + (response.output_tokens or 0),
            meta={
                "model": response.model,
                # The one value `/v1/usage` separates chat spend by. Shared
                # rather than written twice — see CHAT_USAGE_ROLE.
                "role": CHAT_USAGE_ROLE,
                "input_tokens": response.input_tokens,
                "output_tokens": response.output_tokens,
                "run_id": str(ctx.run_id),
            },
            event_id=uuid.uuid5(uuid.UUID(str(ctx.run_id)), "usage:chat")
            if _is_uuid(ctx.run_id)
            else None,
        )
    except Exception:
        log.exception("chat turn %s completed but was not metered", ctx.run_id)


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
                system=CHAT_SYSTEM_PROMPT,
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
    await _record_chat_usage(ctx, store, response)
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


# A hardware queue can hold a job for hours; a lease cannot. So one handler
# invocation performs exactly one provider interaction (submit, or one poll)
# and re-enqueues itself with a delay — the durable qpu_runs row, not the job
# chain, is the record of truth. Polling stops when the provider reports a
# terminal state or the record has been in flight longer than the deadline.
QPU_POLL_DELAY_S = 30
QPU_POLL_DEADLINE_H = 24


#: The provider a stored credential names. One today; `routes/qpu.py` holds the
#: same constant for the API side of the same lookup.
IBM_PROVIDER = "ibm"


def _ibm_provider(token: str, instance: str | None) -> Any:
    from majorana_qpu import IbmRuntimeProvider

    return IbmRuntimeProvider(token, instance=instance)


class _CredentialUnusable(Exception):
    """The submitting user's credential cannot be used for this record.

    Carries the sentence written onto the durable row, which is the only place
    the owner of the run will ever see it — `majorana_failure_evidence` applies
    here too: `error` is the whole of what the person gets. It never carries
    ciphertext or plaintext, only the row's `key_id` where that helps an
    operator.
    """


async def _qpu_credential_for(session: AsyncSession, scope: Any) -> tuple[str, str | None]:
    """The submitting user's IBM token and instance, decrypted.

    Keyed on `scope.user_id`, which `_scope_from_payload` built from the job
    payload the API wrote out of the submitting scope — so it is the same person
    the `qpu_runs` row names, and `handle_qpu_run` asserts that rather than
    assuming it.

    Raises `_CredentialUnusable` for both failure modes, because the record has
    to close terminally either way: a user who disconnected between submission
    and execution, and a row whose encryption key is no longer configured. A
    handler that retried on these would retry forever — neither condition is
    transient, and the job queue would spend three attempts discovering that.
    """
    record = await credentials_repo.get(scope, session, IBM_PROVIDER)
    if record is None:
        raise _CredentialUnusable(
            "the account that submitted this run has no IBM Quantum credential "
            "connected; it was disconnected before the job ran. Reconnect it and "
            "submit again — nothing was sent to IBM."
        )
    try:
        cipher = credential_crypto.load_cipher()
        token = cipher.decrypt(record.ciphertext, key_id=record.key_id)
    except credential_crypto.CredentialCryptoError:
        # `from None`, and the message is built from the row's key_id rather
        # than from the underlying exception: this string is written to a
        # database column and read by the user.
        raise _CredentialUnusable(
            f"the stored IBM Quantum credential for this account (key "
            f"{record.key_id}) could not be decrypted by the worker; nothing was "
            "sent to IBM. Reconnect the credential."
        ) from None
    return token, record.instance


async def handle_qpu_run(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    provider: Any | None = None,
) -> None:
    """Submit-or-poll step against the durable qpu_run record (migration 0034).

    The payload is a pointer plus the scope it resumes; every attested value
    is read from and written to the row. The gate re-check is defense in
    depth — the API checked it too, and a deployment that closed the gate
    after enqueue must close the record rather than contact the provider.

    **The provider is contacted at most once per record.** A `qpu.run` job is
    redelivered on failure like any other, and this is the one handler where a
    redelivery spends money: see `claim_submission_attempt` below, which is
    stamped and committed before the submit rather than after it.

    **The credential is the submitting user's own** (migration 0045), loaded and
    decrypted here and passed to the provider explicitly. It is resolved BEFORE
    `claim_submission_attempt`, which matters for the at-most-once invariant in
    both directions: a record whose owner has disconnected must never consume the
    one attempt it gets, and a credential loaded after the claim would turn "you
    disconnected" into "this record was already attempted and cannot be retried".
    Either failure to obtain a usable credential closes the record terminally
    with the cause named — it is not transient, and retrying it three times
    changes nothing except how long the user waits to be told."""
    try:
        job = QpuRunJobPayload.model_validate(payload)
    except ValidationError as exc:
        raise RuntimeError(f"qpu.run payload malformed: {exc}") from exc
    scope = _scope_from_payload(payload)
    record = await qpu_runs_repo.get_record(scope, session, uuid.UUID(job.qpu_run_id))
    status = QpuRunStatus(record.status)
    if status in {QpuRunStatus.DONE, QpuRunStatus.ERROR, QpuRunStatus.CANCELLED}:
        return
    # The DEPLOYMENT-wide half of the gate first — `has_credential=True` because
    # the caller's half is a database question answered immediately below, and
    # passing False here would close every record with `credentials_unconfigured`
    # in a deployment whose flag is simply off. A closed deployment is not the
    # user's problem and must not be described as their missing key.
    reason = submission_block_reason(has_credential=True)
    if reason is not None:
        await qpu_runs_repo.transition(
            scope,
            session,
            record.id,
            QpuRunStatus.ERROR,
            error=f"submission gate closed after enqueue: {reason.value}",
        )
        await session.commit()
        return
    # An injected provider carries its own credential and is how the tests drive
    # this handler without a database of secrets. Real execution takes the other
    # branch, always: `provider` has no production producer.
    credential: tuple[str, str | None] | None = None
    if provider is None:
        if record.user_id != scope.user_id:
            # The payload and the row disagree about whose run this is. There is
            # no correct credential to load, and guessing at one would submit a
            # job under somebody else's IBM account.
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.ERROR,
                error=(
                    "this record's owner does not match the job that carries it; "
                    "no credential was loaded and nothing was sent to IBM"
                ),
            )
            await session.commit()
            return
        try:
            credential = await _qpu_credential_for(session, scope)
        except _CredentialUnusable as unusable:
            await qpu_runs_repo.transition(
                scope, session, record.id, QpuRunStatus.ERROR, error=str(unusable)
            )
            await session.commit()
            return
    qpu = provider if provider is not None else _ibm_provider(*credential)

    if status is QpuRunStatus.QUEUED:
        # Claim the attempt and COMMIT it before the provider is contacted, so a
        # redelivery of this job cannot contact them a second time.
        #
        # Without this the handler submitted, and only then wrote. A submit that
        # reached the provider and failed on the way back — a read timeout, a
        # reset connection — left the record QUEUED with nothing written, the
        # queue redelivered the job, and the handler submitted again. Measured
        # against this handler with a provider that accepts and loses the first
        # response: two `provider.submit` calls for one record, the row keeping
        # only the second provider job id. The first job runs, bills, and is
        # tracked nowhere.
        #
        # The commit is what makes it work. Inside this handler's transaction the
        # stamp would roll back with everything else when the submit raised, and
        # the redelivery would find the record exactly as it left it.
        if not await qpu_runs_repo.claim_submission_attempt(scope, session, record.id):
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.ERROR,
                error=(
                    "a submission for this record was already attempted and did not "
                    "confirm; it is not retried because the provider may have accepted "
                    f"it. Check the provider dashboard for {record.source_fingerprint} "
                    "before submitting again."
                ),
            )
            await session.commit()
            return
        await session.commit()
        submitted = await asyncio.to_thread(
            qpu.submit,
            QpuJobRequest(
                device_id=record.device_id,
                shots=record.shots,
                qasm=record.qasm,
                source_fingerprint=record.source_fingerprint,
            ),
        )
        # No `submitted_at` here: the claim above already stamped it, and that
        # stamp is the moment the request left this process. Re-stamping now
        # would move it later by the provider's whole round trip and make the
        # 24h poll deadline start after the wait it is meant to bound.
        await qpu_runs_repo.transition(
            scope,
            session,
            record.id,
            QpuRunStatus.RUNNING,
            provider_job_id=submitted.provider_job_id,
        )
        if credential is not None:
            # After the provider accepted it, not before. A submit that IBM
            # accepted is proof the key still authenticates, so this refreshes
            # `last_verified_at` as well as `last_used_at` — the alternative is a
            # "Last verified" date that never moves after the day the key was
            # pasted, which would keep reading as verified for a credential
            # revoked on IBM's dashboard months ago. Stamping either field on an
            # attempt that FAILED would be the same lie in the other direction.
            await credentials_repo.mark_provider_success(scope, session, IBM_PROVIDER)
    else:  # RUNNING: one poll
        if record.provider_job_id is None:
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.ERROR,
                error="record is RUNNING with no provider job id; cannot poll",
            )
            await session.commit()
            return
        polled = await asyncio.to_thread(qpu.poll, record.provider_job_id)
        if credential is not None:
            # A poll that answered authenticated too. Refreshed here as well as
            # on submit so `last_verified_at` tracks a long-running job rather
            # than going stale for the hours it queues at IBM.
            await credentials_repo.mark_provider_success(scope, session, IBM_PROVIDER)
        if polled.status is QpuJobStatus.DONE:
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.DONE,
                raw_counts=polled.raw_counts,
            )
            await session.commit()
            return
        if polled.status in {QpuJobStatus.ERROR, QpuJobStatus.CANCELLED}:
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.ERROR
                if polled.status is QpuJobStatus.ERROR
                else QpuRunStatus.CANCELLED,
                error=polled.error,
            )
            await session.commit()
            return
        deadline_base = record.submitted_at or record.created_at
        if deadline_base is not None and datetime.now(UTC) - deadline_base > timedelta(
            hours=QPU_POLL_DEADLINE_H
        ):
            await qpu_runs_repo.transition(
                scope,
                session,
                record.id,
                QpuRunStatus.ERROR,
                error=(
                    f"provider did not reach a terminal state within "
                    f"{QPU_POLL_DEADLINE_H}h; job {record.provider_job_id} may still "
                    "complete provider-side — check the IBM dashboard"
                ),
            )
            await session.commit()
            return

    await system.enqueue_job(
        session,
        kind=QPU_RUN_JOB_KIND,
        payload=payload,
        run_after=datetime.now(UTC) + timedelta(seconds=QPU_POLL_DELAY_S),
    )
    await session.commit()


async def handle_qpu_run_dead_letter(
    session: AsyncSession, payload: dict[str, Any], reason: str
) -> None:
    """Close the durable record when its job chain cannot continue, so a
    hardware submission never sits QUEUED/RUNNING forever with nothing
    scheduled to move it."""
    try:
        job = QpuRunJobPayload.model_validate(payload)
    except ValidationError:
        return  # nothing to close; the malformed payload is already dead-lettered
    scope = _scope_from_payload(payload)
    try:
        record = await qpu_runs_repo.get_record(scope, session, uuid.UUID(job.qpu_run_id))
    except LookupError:
        return
    if QpuRunStatus(record.status) in {
        QpuRunStatus.DONE,
        QpuRunStatus.ERROR,
        QpuRunStatus.CANCELLED,
    }:
        return
    await qpu_runs_repo.transition(
        scope,
        session,
        record.id,
        QpuRunStatus.ERROR,
        error=f"job dead-lettered: {reason[:1900]}",
    )
    await session.commit()


HANDLERS: dict[str, JobHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_execute,
    CATALOG_IMPORT_JOB_KIND: handle_catalog_import,
    QPU_RUN_JOB_KIND: handle_qpu_run,
}

DEAD_LETTER_HANDLERS: dict[str, DeadLetterHandler] = {
    RUN_EXECUTE_JOB_KIND: handle_run_dead_letter,
    QPU_RUN_JOB_KIND: handle_qpu_run_dead_letter,
}
