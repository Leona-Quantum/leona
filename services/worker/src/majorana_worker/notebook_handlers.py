"""Job handlers for the notebook lane (`leona_notebooks` pipeline): generate a
version from a brief, revise the current version from a chat turn, or rerun the
base spec unchanged. A generation/revision is a Run with `mode=notebook`
(quota, SSE events and the tier table come for free) whose product is a
notebook version, not an artifact — see
`~/Developer/ai-ops/desk/leona/plans/notebooks/00-notebooks-surface.md` §3.

This module owns:
  - `ProductionNotebookPorts`, the real `leona_notebooks.pipeline.NotebookPorts`
    implementation (LLM calls, the sandbox, the run's event stream).
  - `handle_notebook_generate` / `handle_notebook_revise`, registered into
    `HANDLERS` in `handlers.py` under `NOTEBOOK_GENERATE_JOB_KIND` /
    `NOTEBOOK_REVISE_JOB_KIND`.
  - `NotebookStore`, a small Protocol this module codes against instead of
    `majorana_api.repos.notebooks` directly.

**Persistence is written in parallel.** `majorana_api.repos.notebooks` does not
exist in this worktree; another agent is writing it to the exact signatures
`NotebookStore` declares below. `RepoNotebookStore` imports it LAZILY inside
each method so this module imports cleanly today; tests inject
`MemoryNotebookStore` instead. `RepoNotebookStore` is UNTESTED against the real
module — say so wherever this lands.

**`observe()` is awaited by the pipeline** (`leona_notebooks.pipeline.NotebookPorts`
declares it as a coroutine), so each stage transition is written to the run's event
stream as it happens, on the handler's own `AsyncSession`, with nothing else using
that session concurrently. A synchronous fire-and-forget `asyncio.create_task` would
have raced the handler's session between two back-to-back transitions (execute
"finished" immediately followed by repair "started"), which is why the port is async
rather than sync-plus-buffer.
"""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import Awaitable, Callable
from typing import Any, Literal, Protocol

from pydantic import ValidationError

from majorana_contracts import Scope
from majorana_contracts.enums import Role, RunStatus, Stage, UsageKind
from majorana_contracts.courses import CreateCourseRequest
from majorana_contracts.notebooks import CreateNotebookRequest, NotebookReview
from majorana_llm import (
    LLMClient,
    LLMRequest,
    StageOutputError,
    default_llm,
    extract_json,
    model_for,
    normalize_response_locale,
)
from majorana_sandbox import Sandbox
from majorana_sandbox import run as run_sandbox
from majorana_sandbox.spec import DEFAULT_MEMORY_MB

from leona_notebooks.atlas import seed_from_record
from leona_notebooks.circuits import validate_circuit_seed
from leona_notebooks.dependencies import RunPlan, plan_run
from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.grading import GradedAttempt, grades_from_report, spec_with_graders
from leona_notebooks.authoring import advisory_structure, spec_from_author_request
from leona_notebooks.ipynb import to_ipynb
from leona_notebooks.live_draft import LiveDraftGuard
from leona_notebooks.pipeline import (
    GenerationRequest,
    NotebookPorts,
    PipelineBudget,
    PipelineOutcome,
    RevisionRequest,
    describe_failure,
    generate,
    is_usable,
    revise,
)
from leona_notebooks.prompts import (
    DRAFT_SYSTEM_PROMPT,
    OUTLINE_SYSTEM_PROMPT,
    REPAIR_SYSTEM_PROMPT,
    REVIEW_SYSTEM_PROMPT,
    REVISE_SYSTEM_PROMPT,
    NotebookOutline,
    RepairContext,
    execution_summary_text,
    render_circuit_seed_material,
    render_draft_user_prompt,
    render_outline_user_prompt,
    render_repair_user_prompt,
    render_review_user_prompt,
    render_revise_user_prompt,
)
from leona_notebooks.revision import RevisionPlan
from leona_notebooks.sandbox_program import (
    RUN_UNTIL_NOTE,
    NotebookGuardError,
    build_execution_spec,
    compose_notebook_program,
    prepare_cell_source,
    report_from_sandbox_result,
)
from leona_notebooks.source import SourceParseError, parse_source, render_source
from leona_notebooks.spec import (
    SOLUTION_ONLY_ROLES,
    Audience,
    CellRole,
    Framework,
    NotebookKind,
    NotebookSpec,
    Style,
)

from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.db import AsyncSession
from majorana_api.orm import User
from majorana_api.repos import catalog as catalog_repo
from majorana_api.repos import usage as usage_repo
from majorana_api.tiers import EnvTierSources, limits_for, tier_of

# The SAME live-delta chunk size the circuit Run lane's own streaming uses
# (`MeteredAgentLLM`, `agent_llm.py`) — reused rather than re-picked so the two
# streaming lanes buffer on the same cadence for the same reason (one `run_events`
# row, and one `session.commit()`, per chunk — see `RepoEventSink.emit`).
from majorana_worker.agent_llm import _LIVE_DELTA_CHARS

log = logging.getLogger("majorana_worker.notebook_handlers")

# Notebook-lane LLM roles, resolved through the shared `model_for` machinery
# (registered in `packages/py/llm/src/majorana_llm/models.py`).
_ROLE_OUTLINE = "notebook_outline"
_ROLE_DRAFT = "notebook_draft"
_ROLE_REPAIR = "notebook_repair"
_ROLE_REVISE = "notebook_revise"
_ROLE_REVIEW = "notebook_review"

# `leona_notebooks.pipeline.Stage` values (fine-grained, e.g. "notebook.outline")
# have no matching member in `majorana_contracts.enums.Stage` (the DB-level
# `stage.started`/`stage.finished` events are typed against THAT enum, not a
# free string — see `StageStarted`/`StageFinished` in
# `packages/py/contracts/src/majorana_contracts/events.py`). This is the
# closest-fit mapping onto the existing, DB-accepted vocabulary; the exact
# pipeline stage name is preserved as the `code` on a `run.error` event
# instead, since neither `StageStarted` nor `StageFinished` carries free text.
_STAGE_MAP: dict[str, Stage] = {
    "notebook.outline": Stage.PLAN,
    "notebook.draft": Stage.GENERATE,
    "notebook.execute": Stage.FINAL_EXECUTE,
    "notebook.repair": Stage.GENERATE,
    "notebook.review": Stage.VERIFY,
    "notebook.revise": Stage.GENERATE,
    "notebook.save": Stage.SAVE,
}


class CircuitSeedRejected(ValueError):
    """A `kind="circuit"` seed failed `leona_notebooks.circuits.validate_circuit_seed`
    (OpenQASM 3 that would not parse, or Python the sandbox guard refused).
    `findings` is shown to the reader so they know what to fix; caught specifically
    in `handle_notebook_generate` and reported as `circuit_seed_rejected` rather than
    falling into the generic `notebook_generation_failed` catch-all."""

    def __init__(self, findings: list[str]) -> None:
        self.findings = findings
        super().__init__("the circuit you pasted was rejected: " + "; ".join(findings))


def _scope_from_payload(payload: dict[str, Any]) -> Scope:
    return Scope(
        user_id=uuid.UUID(payload["user_id"]),
        workspace_id=uuid.UUID(payload["workspace_id"]),
        role=Role.MEMBER,  # write, never admin — least authority that can execute
    )


def _strip_fences(text: str) -> str:
    """The draft/repair prompts ask for source with no fences; strip them if a
    model added them anyway rather than feeding a fenced block to `parse_source`."""
    stripped = text.strip()
    if stripped.startswith("```"):
        lines = stripped.split("\n")[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        stripped = "\n".join(lines).strip()
    return stripped + "\n" if stripped else stripped


# --------------------------------------------------------------------------- persistence


class NotebookStore(Protocol):
    """What the handlers need from `majorana_api.repos.notebooks`, written in
    parallel. Coding against this Protocol (rather than importing that module
    directly) lets this file and its tests exist before it does."""

    async def get_version(
        self, scope: Scope, session: AsyncSession, version_id: uuid.UUID
    ) -> Any: ...

    async def get_version_by_seq(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, seq: int
    ) -> Any: ...

    async def get_current_version(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID
    ) -> Any | None: ...

    async def set_version_running(
        self, scope: Scope, session: AsyncSession, version_id: uuid.UUID
    ) -> Any: ...

    async def set_version_result(
        self,
        scope: Scope,
        session: AsyncSession,
        version_id: uuid.UUID,
        *,
        status: str,
        spec: dict[str, Any] | None,
        source: str,
        ipynb: dict[str, Any] | None,
        report: dict[str, Any] | None,
        review: dict[str, Any] | None,
        error: str,
        message: str | None = None,
    ) -> Any: ...

    async def append_turn(
        self,
        scope: Scope,
        session: AsyncSession,
        notebook_id: uuid.UUID,
        *,
        role: str,
        content: str,
        version_id: uuid.UUID | None,
        run_id: uuid.UUID | None,
    ) -> Any: ...

    async def list_turns(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, *, limit: int = 200
    ) -> list[Any]: ...


class RepoNotebookStore:
    """`NotebookStore` over `majorana_api.repos.notebooks`, imported LAZILY per
    call so this module imports cleanly whether or not that module exists yet.
    UNTESTED against the real module (it does not exist in this worktree) —
    only its declared signatures are assumed."""

    async def get_version(self, scope: Scope, session: AsyncSession, version_id: uuid.UUID) -> Any:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.get_version(scope, session, version_id)

    async def get_version_by_seq(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, seq: int
    ) -> Any:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.get_version_by_seq(scope, session, notebook_id, seq)

    async def get_current_version(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID
    ) -> Any | None:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.get_current_version(scope, session, notebook_id)

    async def set_version_running(
        self, scope: Scope, session: AsyncSession, version_id: uuid.UUID
    ) -> Any:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.set_version_running(scope, session, version_id)

    async def set_version_result(
        self,
        scope: Scope,
        session: AsyncSession,
        version_id: uuid.UUID,
        *,
        status: str,
        spec: dict[str, Any] | None,
        source: str,
        ipynb: dict[str, Any] | None,
        report: dict[str, Any] | None,
        review: dict[str, Any] | None,
        error: str,
        message: str | None = None,
    ) -> Any:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.set_version_result(
            scope,
            session,
            version_id,
            status=status,
            spec=spec,
            source=source,
            ipynb=ipynb,
            report=report,
            review=review,
            error=error,
            message=message,
        )

    async def append_turn(
        self,
        scope: Scope,
        session: AsyncSession,
        notebook_id: uuid.UUID,
        *,
        role: str,
        content: str,
        version_id: uuid.UUID | None,
        run_id: uuid.UUID | None,
    ) -> Any:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.append_turn(
            scope,
            session,
            notebook_id,
            role=role,
            content=content,
            version_id=version_id,
            run_id=run_id,
        )

    async def list_turns(
        self, scope: Scope, session: AsyncSession, notebook_id: uuid.UUID, *, limit: int = 200
    ) -> list[Any]:
        from majorana_api.repos import notebooks as notebooks_repo

        return await notebooks_repo.list_turns(scope, session, notebook_id, limit=limit)


# --------------------------------------------------------------------------- ports


class _DraftDeltaStreamer:
    """One draft/repair completion's `on_delta` handler: redact, buffer, emit.

    `LiveDraftGuard` decides what is SAFE to release as the raw text streams in;
    this wraps it with the same fixed-size chunking `agent_llm.py`'s circuit-run
    streaming uses (`_LIVE_DELTA_CHARS`), so a `notebook.draft.delta` event goes
    out roughly every 160 characters of SAFE text rather than once per provider
    token — each event is one `run_events` row and one commit
    (`RepoEventSink.emit`), and per-token would be a write storm.

    One instance per streamed call (construct fresh for each `_complete()`); it is
    not reusable across draft attempts or repairs, because `LiveDraftGuard` tracks
    one cell's-worth of state at a time and a new completion starts a new stream.
    """

    def __init__(self, sink: Any, attempt: int) -> None:
        self._sink = sink
        self._attempt = attempt
        self._guard = LiveDraftGuard()
        self._buffer = ""

    async def on_delta(self, text: str, kind: str) -> None:
        # The reasoning channel is the model's scratch space, never notebook text —
        # `agent_llm.py`'s own circuit-run streaming draws the same line.
        if kind != "output" or not text:
            return
        safe = self._guard.feed(text)
        if not safe:
            return
        self._buffer += safe
        while len(self._buffer) >= _LIVE_DELTA_CHARS:
            chunk, self._buffer = (
                self._buffer[:_LIVE_DELTA_CHARS],
                self._buffer[_LIVE_DELTA_CHARS:],
            )
            await self._emit(chunk)

    async def flush(self) -> None:
        """Call once after the streamed call returns OR raises — the provider may
        disconnect mid-cell, and whatever the guard can still prove safe (the tail of
        an already-classified-safe cell) should still reach the reader rather than
        being lost with the connection."""
        tail = self._guard.flush()
        if tail:
            self._buffer += tail
        if self._buffer:
            await self._emit(self._buffer)
            self._buffer = ""

    async def _emit(self, text: str) -> None:
        try:
            await self._sink.emit("notebook.draft.delta", {"text": text, "attempt": self._attempt})
        except Exception:
            log.exception("notebook draft delta emit failed (attempt=%s)", self._attempt)


class ProductionNotebookPorts(NotebookPorts):
    """`NotebookPorts` backed by real LLM calls and the real sandbox."""

    def __init__(
        self,
        *,
        llm: LLMClient,
        sandbox: Sandbox,
        sink: Any,
        response_locale: str,
        sandbox_memory_mb: int = DEFAULT_MEMORY_MB,
        max_repairs: int = PipelineBudget().max_repairs,
    ) -> None:
        self._llm = llm
        self._sandbox = sandbox
        self._sink = sink
        self._response_locale = normalize_response_locale(response_locale)
        self._sandbox_memory_mb = sandbox_memory_mb
        self._started_at: dict[str, float] = {}
        #: Total sandbox seconds this generation/revision spent, across every
        #: `execute()` call (the initial run and every repair rerun) — summed
        #: here so the handler records ONE `SANDBOX_SECONDS` usage event per
        #: run rather than one per cell execution.
        self.sandbox_seconds_used: float = 0.0
        #: The repair budget `notebook.repair`'s "of" field reports. No caller passes
        #: a custom `PipelineBudget` into `generate()`/`revise()` today (see
        #: `handle_notebook_generate`/`handle_notebook_revise`), so the default here
        #: is read from the SAME `PipelineBudget` the pipeline itself defaults to
        #: (`budget or PipelineBudget()`), rather than a second, independently-typed
        #: constant that could drift from it.
        self._max_repairs = max_repairs
        #: One counter per streamed completion (draft's retry loop, each repair) —
        #: shared across both roles because a client tells them apart from OTHER
        #: events on the stream (`stage.started`, `notebook.repair`), not from this
        #: field; it only needs to distinguish "a fresh completion" from "more of the
        #: one already showing".
        self._stream_attempt = 0
        #: Counts every `run_notebook()` dispatch (the initial run and each repair's
        #: rerun) — `notebook.cells`' own "attempt", independent of `_stream_attempt`
        #: and of the pipeline's own repair counter (an execute is not a repair).
        self._execution_attempt = 0
        #: Counts every `repair()` call — mirrors the pipeline's own `repairs` local
        #: in `_execute_and_repair` exactly, because both increment once per call to
        #: this port's `repair()`, in the same order, starting from the same zero.
        self._repair_attempt = 0

    async def _complete(
        self,
        *,
        role: str,
        system: str,
        user: str,
        temperature: float,
        schema: dict[str, Any] | None = None,
        schema_name: str | None = None,
        on_delta: Callable[[str, str], Awaitable[None]] | None = None,
    ):
        # `ProductionNotebookPorts` calls `self._llm.complete()` directly — `default_llm()`
        # (`RetryingLLM` wrapping `OpenAICompatibleLLM`/`AnthropicLLM`) — never through
        # `MeteredAgentLLM` (`agent_llm.py`), which is the circuit-run lane's own metering
        # wrapper and the one place in this codebase that can replay a STORED response
        # (`agent_repo.get_llm_call`) without ever calling `on_delta`. Verified by reading
        # every `MeteredAgentLLM(...)` construction site (`services/worker/handlers.py`):
        # none of them wraps the LLM client this port receives. So there is no
        # stored-response-replay path here to special-case — every call below either
        # streams for real or (on a cache miss that never happens today) returns whole,
        # in which case `on_delta` is simply never invoked and the streamer's `flush()`
        # still fires (its `finally`), emitting nothing, which is correct: nothing was
        # ever withheld from a delta that did not arrive.
        return await self._llm.complete(
            LLMRequest(
                model=model_for(role),
                system=system,
                user=user,
                response_schema=schema,
                schema_name=schema_name or role,
                temperature=temperature,
            ),
            on_delta=on_delta,
        )

    # -- LLM stages -----------------------------------------------------

    async def outline(self, request: GenerationRequest) -> NotebookOutline:
        audience = Audience.model_validate(request.audience) if request.audience else None
        style = Style.model_validate(request.style) if request.style else None
        framework = Framework.model_validate(request.framework) if request.framework else None
        kind_hint = NotebookKind(request.kind_hint) if request.kind_hint else None
        user = render_outline_user_prompt(
            brief=request.brief,
            kind_hint=kind_hint,
            audience=audience,
            style=style,
            framework=framework,
            seeds=list(request.seeds),
            seed_material=request.seed_material,
            response_locale=self._response_locale,
        )
        last_error: Exception | None = None
        for _attempt in range(2):  # one retry on a malformed response, then raise
            response = await self._complete(
                role=_ROLE_OUTLINE,
                system=OUTLINE_SYSTEM_PROMPT,
                user=user,
                schema=NotebookOutline.model_json_schema(),
                schema_name="notebook_outline",
                temperature=0.0,
            )
            try:
                return NotebookOutline.model_validate_json(extract_json(response.text))
            except (StageOutputError, ValidationError) as exc:
                last_error = exc
                continue
        assert last_error is not None
        raise last_error

    async def draft(
        self, request: GenerationRequest, outline: NotebookOutline, feedback: str | None
    ) -> str:
        user = render_draft_user_prompt(
            outline,
            brief=request.brief,
            seed_material=request.seed_material,
            response_locale=self._response_locale,
        )
        if feedback:
            user += (
                "\n\nYOUR PREVIOUS DRAFT WAS REJECTED:\n"
                f"{feedback}\n"
                "Fix it and return the full corrected notebook source."
            )
        self._stream_attempt += 1
        streamer = _DraftDeltaStreamer(self._sink, self._stream_attempt)
        try:
            response = await self._complete(
                role=_ROLE_DRAFT,
                system=DRAFT_SYSTEM_PROMPT,
                user=user,
                temperature=0.0 if feedback is None else 0.4,
                on_delta=streamer.on_delta,
            )
        finally:
            # Fires whether the call returned or raised (a provider disconnect mid-draft
            # still owes the reader whatever the guard could already prove safe).
            await streamer.flush()
        text = _strip_fences(response.text)
        await self._emit_draft_parsed(text, request.slug)
        return text

    async def _emit_draft_parsed(self, text: str, slug: str | None) -> None:
        """`notebook.draft.parsed`: the SAME redaction `notebook.draft.delta` already
        applied live, reapplied to the finished draft this attempt produced —
        `for_learner()`, not a second redaction rule, so the two can never disagree
        about which cell is safe. Silent on anything that is not this attempt's
        concern: a draft that fails to parse here is exactly what the pipeline's own
        retry-on-bad-structure loop exists for, and every failure mode of `for_learner()`
        itself (none known, but `observe()`'s own rule applies) must not take the run
        down over an event that is advisory to begin with."""
        try:
            candidate = parse_source(text, slug=slug)
        except (SourceParseError, ValueError):
            return
        try:
            learner = candidate.for_learner()
            cells = [
                {
                    "id": cell.id,
                    "kind": cell.kind,
                    "role": cell.role.value if cell.role is not None else None,
                    "source": cell.source,
                }
                for cell in learner.cells
            ]
            await self._sink.emit("notebook.draft.parsed", {"cells": cells})
        except Exception:
            log.exception("notebook draft.parsed emit failed")

    async def repair(self, spec: NotebookSpec, context: RepairContext) -> str:
        self._repair_attempt += 1
        attempt = self._repair_attempt
        origin_error = (
            f"{context.error_name}: {context.error_value}" if context.error_name else None
        )
        await self._emit_repair(
            cell_id=context.cell_id,
            status="started",
            error=origin_error,
            attempt=attempt,
            before_running=context.before_running,
        )
        self._stream_attempt += 1
        streamer = _DraftDeltaStreamer(self._sink, self._stream_attempt)
        try:
            response = await self._complete(
                role=_ROLE_REPAIR,
                system=REPAIR_SYSTEM_PROMPT,
                user=render_repair_user_prompt(context, framework=spec.framework.name),
                temperature=0.4,
                on_delta=streamer.on_delta,
            )
        except Exception as exc:
            await streamer.flush()
            await self._emit_repair(
                cell_id=context.cell_id,
                status="failed",
                error=str(exc)[:2000],
                attempt=attempt,
                before_running=context.before_running,
            )
            raise
        await streamer.flush()
        text = _strip_fences(response.text)
        await self._emit_repair(
            cell_id=context.cell_id,
            status="finished",
            error=origin_error,
            attempt=attempt,
            before_running=context.before_running,
            source=self._redact_repair_source(spec, context.cell_id, text),
        )
        return text

    def _redact_repair_source(self, spec: NotebookSpec, cell_id: str, text: str) -> str | None:
        """The same rule `NotebookSpec.for_learner()` applies, read off the cell BEING
        repaired (the pre-repair spec still names its role/check/answer — a repair
        replaces a cell's SOURCE, not what makes it graded) rather than re-deriving a
        second rule from the repaired text: a graded or solution-only cell's new
        source never reaches the wire, whatever the fix turned out to be."""
        try:
            target = spec.cell_by_id(cell_id)
        except KeyError:
            return None  # unknown cell id: nothing proven safe, so nothing is sent
        sensitive = (
            target.check is not None
            or target.answer is not None
            or target.role in SOLUTION_ONLY_ROLES
        )
        return None if sensitive else text

    async def _emit_repair(
        self,
        *,
        cell_id: str,
        status: Literal["started", "finished", "failed"],
        error: str | None,
        attempt: int,
        before_running: bool,
        source: str | None = None,
    ) -> None:
        try:
            await self._sink.emit(
                "notebook.repair",
                {
                    "cell_id": cell_id,
                    "status": status,
                    "error": error,
                    "attempt": attempt,
                    "of": self._max_repairs,
                    "before_running": before_running,
                    "source": source,
                },
            )
        except Exception:
            log.exception("notebook.repair emit failed for cell=%s status=%s", cell_id, status)

    async def revise(self, request: RevisionRequest) -> RevisionPlan:
        response = await self._complete(
            role=_ROLE_REVISE,
            system=REVISE_SYSTEM_PROMPT,
            user=render_revise_user_prompt(
                source_text=render_source(request.spec),
                message=request.message,
                history=list(request.history),
                framework=request.spec.framework.name,
                response_locale=self._response_locale,
            ),
            schema=RevisionPlan.model_json_schema(),
            schema_name="notebook_revise",
            temperature=0.4,
        )
        return RevisionPlan.model_validate_json(extract_json(response.text))

    async def review(self, spec: NotebookSpec, report: ExecutionReport) -> NotebookReview:
        response = await self._complete(
            role=_ROLE_REVIEW,
            system=REVIEW_SYSTEM_PROMPT,
            user=render_review_user_prompt(
                source_text=render_source(spec),
                execution_summary=execution_summary_text(report.model_dump()["cells"]),
                response_locale=self._response_locale,
            ),
            schema=NotebookReview.model_json_schema(),
            schema_name="notebook_review",
            temperature=0.0,
        )
        return NotebookReview.model_validate_json(extract_json(response.text))

    # -- execute ----------------------------------------------------------

    async def run_notebook(
        self,
        spec: NotebookSpec,
        *,
        run_until: str | None = None,
        only: set[str] | None = None,
    ) -> ExecutionReport:
        """`run_until` is the editor's "Run to here": cells after that id are left out
        of the program and come back `not_run`. `only` further restricts the dispatch
        to exactly that set of cell ids (dependency-graph replay's `RunPlan.execute` —
        `leona_notebooks.dependencies.plan_run`); a cell it excludes comes back
        `not_run` too, never counted against the report's `ok`. Both are optional with
        a default so this still satisfies `NotebookPorts.run_notebook(spec)`, which
        every other caller uses."""
        self._execution_attempt += 1
        attempt = self._execution_attempt
        try:
            program = compose_notebook_program(spec, run_until=run_until, only=only)
        except NotebookGuardError as exc:
            report = ExecutionReport(
                notebook_slug=spec.slug,
                ok=False,
                runner="sandbox",
                cells=[
                    CellResult(id=cell.id, status="skipped", note=str(exc))
                    for cell in spec.cells
                    if cell.is_code
                ],
                note=str(exc),
            )
            await self._emit_cells(report, attempt)
            return report
        exec_spec = build_execution_spec(
            program,
            timeout_s=120,
            memory_mb=self._sandbox_memory_mb,
            qubits_estimate=None,
        )
        result = await run_sandbox(self._sandbox, exec_spec)
        self.sandbox_seconds_used += max(
            float(getattr(result, "duration_ms", 0) or 0) / 1000.0, 0.0
        )
        report = report_from_sandbox_result(result, spec, program)
        await self._emit_cells(report, attempt)
        return report

    async def _emit_cells(self, report: ExecutionReport, attempt: int) -> None:
        """`notebook.cells`: status and error NAME/VALUE only, per cell — no stdout, no
        outputs, no figures (plan 10-notebook-ide, "Live" lane). Fired on every
        dispatch this port makes (the initial run, every repair's rerun, a reader's own
        edit via `_handle_author`, a plain rerun, and a grading pass), all through this
        one method, so "attempt" counts DISPATCHES rather than needing a caller-specific
        variant.

        Not fully redaction-proof: `evalue` comes from executing the cell's REAL,
        unredacted source (a failing grader's assertion can echo the expected value in
        its message). The brief's event shape asks for ename/evalue verbatim and this
        follows it; flagged in the Live lane's report as a residual finding for the
        owner rather than silently narrowed here.
        """
        try:
            await self._sink.emit(
                "notebook.cells",
                {
                    "attempt": attempt,
                    "ok": report.ok,
                    "cells": [
                        {
                            "id": cell.id,
                            "status": cell.status,
                            "ename": cell.error.ename if cell.error is not None else None,
                            "evalue": cell.error.evalue if cell.error is not None else None,
                            "duration_ms": cell.duration_ms,
                        }
                        for cell in report.cells
                    ],
                },
            )
        except Exception:
            log.exception("notebook.cells emit failed (attempt=%s)", attempt)

    # -- observe: live, on the handler's session -----------------------------

    async def observe(
        self, stage: str, status: Literal["started", "finished", "failed"], detail: str = ""
    ) -> None:
        """Write the stage transition to the run's event stream now. The pipeline
        awaits this, so the write happens on the handler's own session with nothing
        else using it — the reason `NotebookPorts.observe` is a coroutine."""
        try:
            now = time.monotonic()
            mapped = _STAGE_MAP.get(stage, Stage.GENERATE)
            if status == "started":
                self._started_at[stage] = now
                await self._sink.emit("stage.started", {"stage": mapped.value})
                return
            duration_ms = int(max(now - self._started_at.pop(stage, now), 0.0) * 1000)
            ok = status == "finished"
            await self._sink.emit(
                "stage.finished",
                {"stage": mapped.value, "ok": ok, "duration_ms": duration_ms},
            )
            if not ok and detail:
                await self._sink.emit(
                    "run.error",
                    {"stage": mapped.value, "code": stage, "message": detail[:2000]},
                )
        except Exception:
            log.exception("notebook observe() failed for stage=%s status=%s", stage, status)


# --------------------------------------------------------------------------- shared handler plumbing


async def _resolve_sandbox_memory_mb(session: AsyncSession, scope: Scope) -> int:
    """Same rule as `_handle_agent_execution`/`handle_qapp_execute`: the
    OWNER's tier sizes the sandbox; an unresolvable tier falls back to the
    free-lane default, never to the ceiling (ai-ops#171)."""
    owner = await session.get(User, scope.user_id)
    owner_limits = (
        limits_for(tier_of(owner, EnvTierSources.from_env())) if owner is not None else None
    )
    return owner_limits.sandbox_memory_mb if owner_limits is not None else DEFAULT_MEMORY_MB


async def _record_sandbox_usage(
    session: AsyncSession, scope: Scope, run_id: uuid.UUID, ports: ProductionNotebookPorts
) -> None:
    """Record this ATTEMPT's sandbox seconds, not this run's.

    A notebook job is re-run on the same `run_id` when its lease expires —
    `system.recover_stale_jobs()` requeues the same job row after a worker is
    killed or restarted mid-run. (Nothing in this module raises
    `RetryableJobError`, so `system.retry_job()` is not the path here, though
    it reuses the row the same way.) The re-run legitimately burns a
    different number of sandbox seconds. Keying the idempotency id on `run_id` alone meant the second
    attempt's insert hit `ON CONFLICT DO NOTHING` against the first
    attempt's row, the content compare below in `usage_repo.record_usage`
    disagreed, and the resulting `ValueError` was caught and only logged —
    so that attempt's seconds were silently never recorded (observed in
    production 2026-09-16). Every attempt really consumed sandbox time, so
    dropping one loses true cost; keeping all of them loses nothing, since
    `meta["attempt"]` lets any later summing choose to count only the
    successful attempt if that ever becomes the policy.

    `attempt` is the 1-based count `system.claim_job()` already stamps onto
    the job row before this handler runs, threaded here via
    `session.info["job_attempt"]` (set in `__main__._execute_with_heartbeat`,
    the same mechanism `news_job_lease` uses to hand a handler per-job
    context without changing every handler's — or every job kind's
    `payload` contract's — shape). A session with nothing set there (a
    handler invoked directly, as in older tests) defaults to attempt 1,
    which is also correct: a brand-new run's first attempt cannot collide
    with anything, because it has a brand-new `run_id`.

    A true duplicate delivery of the SAME attempt (the sink retries the
    commit, say) still carries the same quantity, so the ON CONFLICT DO
    NOTHING + content-match path below returns the existing row rather than
    raising — idempotency within an attempt is unchanged. Same attempt,
    different quantity is still the real bug signal it was before, and
    still only logged, never raised into the run.
    """
    if ports.sandbox_seconds_used <= 0:
        return
    attempt = session.info.get("job_attempt", 1)
    try:
        await usage_repo.record_usage(
            scope,
            session,
            kind=UsageKind.SANDBOX_SECONDS,
            quantity=ports.sandbox_seconds_used,
            meta={"run_id": str(run_id), "lane": "notebook", "attempt": attempt},
            event_id=uuid.uuid5(run_id, f"usage:sandbox:{attempt}"),
        )
        await session.commit()
    except Exception:
        await session.rollback()
        log.exception("notebook run %s finished but sandbox usage metering failed", run_id)


class SeedNotFoundError(Exception):
    """A `notebook`-kind seed's `ref` did not resolve to a readable current
    version. Raised instead of the soft skip-and-log the other seed kinds get
    (below) because a quiz built with no seed material is not "a slightly
    thinner quiz" — it is a quiz on the wrong thing, silently. Caught in
    `handle_notebook_generate` and mapped to reason_code `seed_not_found`."""


async def _seed_material_for(
    scope: Scope,
    session: AsyncSession,
    request: CreateNotebookRequest | CreateCourseRequest,
    notebook_store: NotebookStore | None = None,
) -> tuple[str, str | None]:
    """Seed material text and the verbatim run cell, from every `atlas-record`,
    `circuit` and `notebook` seed on the request. The other seed kinds (`paper`,
    `artifact`, `upload`, `curriculum`) are passed through to the outline/draft
    prompts as bare `Seed` objects with no fetched material — building their own
    fetch paths is out of this lane's scope (see the handoff).

    Takes a course request as well as a notebook one — the two carry `seeds` and
    `framework` with identical meaning, and the course lane resolves the reader's
    Atlas seeds once, for the planner, rather than re-resolving them per module.
    The union is spelled out rather than left to duck typing so that adding a
    field this function needs breaks at the annotation, not in the worker.

    A `notebook` seed ("Quiz me on this notebook") loads that OTHER notebook's
    current version through `notebook_store`, with the same `scope` this run
    itself carries, so the repository layer's own workspace filter is what makes
    this "same workspace only": a foreign or missing id comes back not-found from
    that layer (a real store raises, the in-memory test fake returns `None` —
    both are treated the same way here) and is raised onward as
    `SeedNotFoundError` rather than silently skipped. The `.nb.py` source stored
    on that version becomes the seed material verbatim, prefaced so the model
    knows to stay inside it. A caller that passes no store (the course planner)
    cannot resolve notebook seeds; one on its request is a `SeedNotFoundError`.

    Precedence when both an `atlas-record` and a `circuit` seed are present: the
    circuit wins the first `run` cell — it is the reader's own text, asked for by
    name, where the Atlas record is one more piece of the request's own context.

    Raises `CircuitSeedRejected` if a `circuit` seed's content fails validation
    (OpenQASM 3 that will not parse, or Python the sandbox guard refuses); this
    fails the whole run before an LLM call is ever made, rather than shipping a
    notebook built around code the reader will not be able to run."""
    parts: list[str] = []
    atlas_run_cell: str | None = None
    circuit_run_cell: str | None = None
    framework_name = request.framework.name if request.framework else "qiskit"
    for seed in request.seeds:
        if seed.kind == "circuit":
            if not seed.content.strip():
                continue
            material = validate_circuit_seed(seed.content)
            if isinstance(material, list):
                raise CircuitSeedRejected(material)
            parts.append(render_circuit_seed_material(material))
            if circuit_run_cell is None:
                circuit_run_cell = material.run_cell_source
            continue
        if seed.kind == "notebook":
            if not seed.ref:
                raise SeedNotFoundError("notebook seed has no ref")
            try:
                seed_notebook_id = uuid.UUID(seed.ref)
            except ValueError as exc:
                raise SeedNotFoundError(
                    f"notebook seed ref {seed.ref!r} is not a notebook id"
                ) from exc
            if notebook_store is None:
                raise SeedNotFoundError(
                    "notebook seeds cannot be resolved without a notebook store"
                )
            try:
                base = await notebook_store.get_current_version(scope, session, seed_notebook_id)
            except Exception as exc:  # noqa: BLE001 - any store failure reads as "not found" here
                raise SeedNotFoundError(f"notebook seed {seed.ref!r} not found: {exc}") from exc
            if base is None or not getattr(base, "source", ""):
                raise SeedNotFoundError(f"notebook seed {seed.ref!r} not found")
            parts.append("The quiz covers ONLY what this notebook teaches:\n\n" + base.source)
            continue
        if seed.kind != "atlas-record" or not seed.ref:
            continue
        entry = await catalog_repo.get_public_catalog_entry(
            scope, session, seed.ref, authority=CatalogAuthority.from_env()
        )
        record = dict(entry.record or {})
        record.setdefault("slug", entry.slug)
        try:
            _seed, material, cell, _refs = seed_from_record(record, framework=framework_name)
        except (KeyError, ValueError) as exc:
            log.warning("notebook seed %r could not be resolved: %s", seed.ref, exc)
            continue
        parts.append(material)
        if atlas_run_cell is None:
            atlas_run_cell = cell
    return "\n\n---\n\n".join(parts), circuit_run_cell or atlas_run_cell


async def _save_outcome(
    *,
    notebook_store: NotebookStore,
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    version_id: uuid.UUID,
    run_id: uuid.UUID,
    outcome: PipelineOutcome,
    sink: Any,
    run_store: Any,
    turn_content: str | None = None,
    success_reason_code: str,
    failure_reason_code: str,
    response_locale: str = "en",
) -> None:
    """Persist a `PipelineOutcome` as the version's result, append the nala
    turn, and finish the run. Shared by generate, revise and rerun.

    A `ready` outcome can carry a cell that raised (`outcome.cell_errors`): the pipeline
    keeps a notebook whose cells ran even when one of them still fails after repair
    (plan 10-notebook-ide, rule 1). The run then finishes SUCCEEDED with the success code
    plus `_with_errors`, so a count of runs by reason can still tell a clean build from a
    kept one, and the turn says which cell raised in words the reader can act on."""
    spec = outcome.spec
    ready = outcome.status == "ready"
    with_errors = ready and bool(outcome.cell_errors)
    ipynb = to_ipynb(spec, report=outcome.report) if spec is not None else None
    await notebook_store.set_version_result(
        scope,
        session,
        version_id,
        status="ready" if ready else "failed",
        spec=spec.model_dump(mode="json") if spec is not None else None,
        source=outcome.source,
        ipynb=ipynb,
        report=outcome.report.model_dump(mode="json") if outcome.report is not None else None,
        review=outcome.review.model_dump(mode="json") if outcome.review is not None else None,
        error=outcome.error,
        message=outcome.summary or None,
    )
    if with_errors:
        note = _kept_with_errors_note(outcome, response_locale)
        content = f"{turn_content}\n\n{note}" if turn_content else note
    else:
        content = (
            turn_content
            or (outcome.summary if ready and outcome.summary else None)
            or ("Built the notebook." if ready else f"I couldn't finish this: {outcome.error}")
        )
    await notebook_store.append_turn(
        scope,
        session,
        notebook_id,
        role="nala",
        content=content,
        version_id=version_id,
        run_id=run_id,
    )
    await session.commit()
    if not ready and outcome.error:
        await sink.emit(
            "run.error",
            {"stage": None, "code": failure_reason_code, "message": outcome.error[:2000]},
        )
    final_status = RunStatus.SUCCEEDED if ready else RunStatus.FAILED
    reason_code = success_reason_code if ready else failure_reason_code
    if with_errors:
        reason_code = f"{success_reason_code}_with_errors"
    await run_store.finish(final_status, {"status": final_status, "reason_code": reason_code})


#: What Nala says when a notebook is kept although a cell still raises. Not model output:
#: the pipeline decided this, so the words are written here in both locales rather than
#: left to a prompt that might soften "this cell raises" into "there may be an issue".
#: Two shapes per locale, because a plain re-run makes no repair at all and "I tried 0
#: fixes" would be a sentence about work that never happened.
_KEPT_WITH_ERRORS: dict[str, dict[str, str]] = {
    "en": {
        "detail": "cell {cell} raised {error}",
        #: A `role=checkpoint` cell that raised `AssertionError` is not a bug the reader's
        #: code has — it is Nala's OWN claim about the result disagreeing with what the
        #: simulator actually returned (ai-ops#375 round 1: 8 of 10 kept-with-errors
        #: notebooks in the 2026-09-24 eval were exactly this). Naming that distinction
        #: here points the reader at the claim, not at their own (correct) code.
        "checkpoint_detail": "Nala's own check (cell {cell}) disagrees with the simulator: {error}",
        "repaired": (
            "Heads up: {detail}. I tried {repairs} and it still raises, so the notebook is "
            "here with that cell marked. The cells before it ran. Ask me to fix it, or edit "
            "the cell yourself and run it again."
        ),
        "unrepaired": (
            "Heads up: {detail}. The notebook is here with that cell marked, and the cells "
            "before it ran. Ask me to fix it, or edit the cell yourself and run it again."
        ),
    },
    "ja": {
        "detail": "セル {cell} で {error} が発生しました",
        "checkpoint_detail": "Nala自身のチェック（セル {cell}）がシミュレーターの結果と食い違っています: {error}",
        "repaired": (
            "ご注意ください: {detail}。{repairs}回修正を試みましたが、まだ例外が出ます。"
            "そのセルに印を付けた状態でノートブックを残しています。それより前のセルは実行できました。"
            "修正を頼むか、セルを自分で編集してもう一度実行してください。"
        ),
        "unrepaired": (
            "ご注意ください: {detail}。そのセルに印を付けた状態でノートブックを残しています。"
            "それより前のセルは実行できました。修正を頼むか、セルを自分で編集してもう一度実行してください。"
        ),
    },
}


def _failing_cell_is_a_checkpoint(spec: NotebookSpec | None, cell_id: str) -> bool:
    """Whether the cell that raised is `role=checkpoint` — the model's own assertion
    about an earlier result, as opposed to code a reader wrote or edited. `spec` is
    `None` on some test doubles and, defensively, whenever the pipeline could not build
    one; either way "unknown" reads as "not a checkpoint" rather than raising."""
    if spec is None:
        return False
    try:
        cell = spec.cell_by_id(cell_id)
    except KeyError:
        return False
    return cell.role == CellRole.CHECKPOINT


def _kept_with_errors_note(outcome: PipelineOutcome, locale: str) -> str:
    copy = _KEPT_WITH_ERRORS.get(locale, _KEPT_WITH_ERRORS["en"])
    first = outcome.report.first_error() if outcome.report is not None else None
    if first is not None and first.error is not None:
        error = f"{first.error.ename}: {first.error.evalue[:300]}"
        # An AssertionError from a checkpoint is the notebook disagreeing with itself,
        # not a bug in the reader's code — say so, so the reader looks at the claim
        # first rather than assuming their own (unrelated) edit broke something.
        template = (
            copy["checkpoint_detail"]
            if first.error.ename == "AssertionError"
            and _failing_cell_is_a_checkpoint(outcome.spec, first.id)
            else copy["detail"]
        )
        detail = template.format(cell=first.id, error=error)
    else:
        # No structured error to name (a report note, say): fall back to the pipeline's
        # own one-line description rather than inventing a cell.
        detail = outcome.cell_errors
    repairs = sum(1 for attempt in outcome.attempts if attempt.stage == "notebook.repair")
    if repairs == 0:
        return copy["unrepaired"].format(detail=detail)
    if locale == "ja":
        return copy["repaired"].format(detail=detail, repairs=repairs)
    return copy["repaired"].format(
        detail=detail, repairs="one fix" if repairs == 1 else f"{repairs} fixes"
    )


#: What the chat rail says after a reader's own edit ran. Not model output — there is
#: no LLM call on this path at all — so the two locales are written here rather than
#: left to a prompt. Keyed the way `normalize_response_locale` returns.
#:
#: The `_reused` variants are new (dependency-graph replay, DESIGN §3): they fire
#: whenever ANY cell in the merged report carries `cached_from_seq` — i.e. was reused
#: rather than re-run this dispatch — and otherwise the ORIGINAL, unreplayed wording
#: is unchanged, so a run that never touches the cache (a brand-new notebook, or
#: `reuse_results=false`) reads exactly as it always has.
_AUTHORED_TURN: dict[str, dict[str, str]] = {
    "en": {
        "ok": "Ran your edit: {ran} of {total} code cells ran cleanly.",
        "partial": "Ran your edit: {ran} of {total} code cells ran, and {failed} raised.",
        "stopped": "Ran your edit up to {run_until}: {ran} code cells ran, {not_run} left for later.",
        "nothing": "I could not run your edit: {note}",
        "ok_reused": "Ran {ran} cells that changed or depend on your edit; {reused} unchanged cells kept their results.",
        "partial_reused": "Ran {ran} cells that changed or depend on your edit, and {failed} raised; {reused} unchanged cells kept their results.",
        "stopped_reused": "Ran {ran} cells up to {run_until} that changed or depend on your edit; {reused} unchanged cells kept their results, {not_run} left for later.",
        "all_reused": "Nothing needed to change: all {reused} cells kept their results from before.",
    },
    "ja": {
        "ok": "編集を実行しました: コードセル {total} 個のうち {ran} 個が正常に実行されました。",
        "partial": "編集を実行しました: コードセル {total} 個のうち {ran} 個が実行され、{failed} 個で例外が発生しました。",
        "stopped": "{run_until} まで編集を実行しました: コードセル {ran} 個を実行し、{not_run} 個は未実行です。",
        "nothing": "編集を実行できませんでした: {note}",
        "ok_reused": "編集の影響を受けたセル {ran} 個を実行しました。変更のないセル {reused} 個は前回の結果を保持しています。",
        "partial_reused": "編集の影響を受けたセル {ran} 個を実行し、{failed} 個で例外が発生しました。変更のないセル {reused} 個は前回の結果を保持しています。",
        "stopped_reused": "{run_until} まで、編集の影響を受けたセル {ran} 個を実行しました。変更のないセル {reused} 個は前回の結果を保持し、{not_run} 個は未実行です。",
        "all_reused": "変更はありませんでした。セル {reused} 個はすべて前回の結果を保持しています。",
    },
}


def _authored_turn(report: ExecutionReport, *, run_until: str | None, locale: str) -> str:
    strings = _AUTHORED_TURN.get(locale, _AUTHORED_TURN["en"])
    total = len(report.cells)
    executed = report.executed_count()  # fresh + reused "ok"/"error" cells
    failed = len(report.failing_cells())
    not_run = sum(1 for cell in report.cells if cell.status == "not_run")
    # A reused cell always carries status="ok" (`plan_run` never reuses an error), so
    # it is never itself a member of `failed`, and subtracting it out of `executed`
    # leaves exactly the cells THIS dispatch actually ran.
    reused = sum(1 for cell in report.cells if cell.cached_from_seq is not None)
    ran = executed - reused
    if executed == 0 and not report.ok:
        return strings["nothing"].format(note=report.note or "the sandbox produced no evidence")
    if reused > 0:
        if run_until:
            return strings["stopped_reused"].format(
                ran=ran, reused=reused, not_run=not_run, run_until=run_until
            )
        if failed:
            return strings["partial_reused"].format(ran=ran, reused=reused, failed=failed)
        if ran == 0:
            return strings["all_reused"].format(reused=reused)
        return strings["ok_reused"].format(ran=ran, reused=reused)
    if run_until:
        return strings["stopped"].format(ran=ran, not_run=not_run, run_until=run_until)
    if failed:
        return strings["partial"].format(ran=ran, total=total, failed=failed)
    return strings["ok"].format(ran=ran, total=total)


async def _load_parent_for_replay(
    notebook_store: NotebookStore,
    scope: Scope,
    session: AsyncSession,
    parent_version_id: str,
) -> tuple[NotebookSpec | None, ExecutionReport | None, int | None]:
    """The parent version's spec, report and seq for `plan_run` — `(None, None,
    None)` when there is nothing usable to reuse from (a bad id, a version with no
    spec). That is not an error here: `plan_run` already treats a `None` parent
    report as "every cell is stale", which is the honest answer when nothing was
    ever cached, not a special case this function needs to guard against."""
    try:
        parent = await notebook_store.get_version(scope, session, uuid.UUID(parent_version_id))
    except (KeyError, ValueError):
        return None, None, None
    if parent is None:
        return None, None, None
    parent_spec = (
        NotebookSpec.model_validate(parent.spec)
        if getattr(parent, "spec", None) is not None
        else None
    )
    parent_report = (
        ExecutionReport.model_validate(parent.report)
        if getattr(parent, "report", None) is not None
        else None
    )
    return parent_spec, parent_report, getattr(parent, "seq", None)


def _merge_replay_report(
    report: ExecutionReport, plan: RunPlan, parent_seq: int | None
) -> ExecutionReport:
    """Stamp each cell this dispatch actually EXECUTED with its own fresh
    `cache_key`, and replace every cell `plan` says to REUSE with the PARENT's own
    `CellResult` — `cached_from_seq` set to `parent_seq`, its original `cache_key`
    kept intact. The composer (`compose_notebook_program`) only knows `skipped` and
    `not_run`; it has never heard of a cached value, so the merge happens here, one
    level up, where both the fresh report and the plan are in scope."""
    merged: list[CellResult] = []
    for cell in report.cells:
        if cell.id in plan.execute:
            merged.append(cell.model_copy(update={"cache_key": plan.cache_keys.get(cell.id)}))
        elif cell.id in plan.reused:
            merged.append(plan.reused[cell.id].model_copy(update={"cached_from_seq": parent_seq}))
        else:
            merged.append(cell)  # a genuine not_run: past `run_until`, or never cacheable at all
    return report.model_copy(update={"cells": merged})


def _all_cached_report(
    spec: NotebookSpec, plan: RunPlan, parent_seq: int | None
) -> ExecutionReport:
    """`plan.execute` is empty: nothing needs a sandbox dispatch at all (plan brief
    item 5 — "if the plan executes nothing, do not dispatch a sandbox"). Built
    directly from `plan.reused` and each remaining cell's OWN skip classification via
    `prepare_cell_source` — the SAME check `compose_notebook_program` runs internally
    — so this can never drift from what a real, empty-`only` dispatch would have
    reported for the cells it left out.
    """
    cells: list[CellResult] = []
    for cell in spec.code_cells():
        if cell.id in plan.reused:
            cells.append(plan.reused[cell.id].model_copy(update={"cached_from_seq": parent_seq}))
            continue
        _source, skip_reason = prepare_cell_source(cell)
        if skip_reason is not None:
            cells.append(CellResult(id=cell.id, status="skipped", note=skip_reason))
        else:
            cells.append(CellResult(id=cell.id, status="not_run", note=RUN_UNTIL_NOTE))
    return ExecutionReport(
        notebook_slug=spec.slug,
        ok=True,
        runner="sandbox",
        cells=cells,
        duration_ms=0,
        environment={},
        dropped_bytes=0,
        note="",
    )


async def _handle_author(
    *,
    notebook_store: NotebookStore,
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    version_id: uuid.UUID,
    run_id: uuid.UUID,
    payload: dict[str, Any],
    ports: ProductionNotebookPorts,
    sink: Any,
    run_store: Any,
    response_locale: str,
) -> None:
    """A version the READER wrote. No LLM call anywhere on this path — the reader
    already said what the notebook should be, so there is nothing to ask a model.

    **A cell that raised is a result, not a failed run.** Someone editing a notebook is
    frequently running code they expect to break; marking the version `failed` would
    hide the traceback they are trying to read behind an error banner and would leave
    `current_version_id` pointing at their previous edit. So the version is `ready`,
    the report carries the failing cell marked `error`, and the run finishes SUCCEEDED
    with `reason_code: notebook_authored`. `_save_outcome` needed no flag for this: it
    keys off `PipelineOutcome.status` alone and never inspects the report, so passing
    `status="ready"` beside a report with a failing cell is already the shape it wants.

    The one thing that IS a failure: nothing ran at all — the guard refused every cell,
    or the sandbox came back with no evidence. Then there is no result to show and the
    version is `failed` with the report's own note as the error.

    **Dependency-graph replay (DESIGN §3).** `plan_run` always runs — even on a
    notebook's very first save, with no parent at all — because it is also what
    stamps `CellResult.cache_key` on every cell this dispatch executes, and a report
    with no cache keys would give the NEXT author run nothing to match against,
    silently disabling replay for every notebook forever (its first version never has
    a parent). What varies is only what `plan_run` is handed as the parent:
    `payload["reuse_results"]` false, or no `parent_version_id` (nothing to reuse
    from yet), passes `parent_report=None` — `plan_run` then treats every cell as
    stale, so `execute` is every graph cell, identical to an unreplayed full run, and
    `reused` is empty. Otherwise the resolved parent's report decides staleness for
    real, and only what changed (plus its downstream and their own deps — the
    dependency graph's mutation rule) is actually dispatched.

    `report.ok` keeps meaning exactly what it means today — "every cell THIS dispatch
    ran, ran cleanly" — because a reused cell is never counted against it either way:
    it always carries `status="ok"` (`plan_run` never reuses an error, see its own
    docstring), so folding it in can only ever leave `ok` as true as it already was.
    `report.executed_count()` (ok+error) DOES include reused cells, by design — that
    count means "how many cells does this report have a real verdict for", which a
    reused "ok" answers just as much as a freshly-run one — and `_authored_turn` is
    the one place that cares about the distinction, so it is the one place that
    subtracts reused cells back out to report "ran" and "reused" separately.
    """
    raw_request = payload.get("request") or {}
    spec_payload = raw_request.get("spec")
    if not isinstance(spec_payload, dict):
        raise ValueError("an author job must carry the resolved spec in request.spec")
    # Through the same entry point the route used, so a producer that queues this job
    # without going through the route (another lane's `%nala push`) gets the identical
    # normalisation rather than a second, drifting one. `payload["slug"]` is the
    # notebook's own: an edit may not move the notebook's address by rewriting the
    # front matter of the source it came from.
    authored = spec_from_author_request(spec=spec_payload, slug=payload.get("slug") or None)
    run_until = payload.get("run_until") or None
    reuse_results = bool(payload.get("reuse_results", True))
    parent_version_id = payload.get("parent_version_id")

    parent_spec: NotebookSpec | None = None
    parent_report: ExecutionReport | None = None
    parent_seq: int | None = None
    if reuse_results and parent_version_id:
        parent_spec, parent_report, parent_seq = await _load_parent_for_replay(
            notebook_store, scope, session, parent_version_id
        )
    plan = plan_run(authored, parent_spec, parent_report, run_until)

    if not plan.execute:
        report = _all_cached_report(authored, plan, parent_seq)
    else:
        report = await ports.run_notebook(authored, run_until=run_until, only=set(plan.execute))
        report = _merge_replay_report(report, plan, parent_seq)
    await _record_sandbox_usage(session, scope, run_id, ports)

    warnings = advisory_structure(authored)
    review = NotebookReview(verdict="needs-attention", warnings=warnings) if warnings else None
    ran_nothing = report.executed_count() == 0 and not report.ok
    outcome = PipelineOutcome(
        status="failed" if ran_nothing else "ready",
        spec=authored,
        report=report,
        review=review,
        summary=raw_request.get("message") or "",
        error=(report.note or "the notebook did not run") if ran_nothing else "",
    )
    await _save_outcome(
        notebook_store=notebook_store,
        scope=scope,
        session=session,
        notebook_id=notebook_id,
        version_id=version_id,
        run_id=run_id,
        outcome=outcome,
        sink=sink,
        run_store=run_store,
        turn_content=_authored_turn(report, run_until=run_until, locale=response_locale),
        success_reason_code="notebook_authored",
        failure_reason_code="notebook_author_failed",
    )


async def _fail_run(
    *,
    notebook_store: NotebookStore,
    scope: Scope,
    session: AsyncSession,
    notebook_id: uuid.UUID,
    version_id: uuid.UUID,
    run_id: uuid.UUID,
    run_store: Any,
    sink: Any,
    error: str,
    reason_code: str,
) -> None:
    """The catch-all failure path: every way a generation/revision can go
    wrong (a port raising, a guard error, the provider being down, an
    exception while saving) ends here — the version FAILED with a readable
    error, a nala turn saying so, and the run FAILED. Never a dead-lettered
    job with the version stuck in `running`."""
    try:
        await notebook_store.set_version_result(
            scope,
            session,
            version_id,
            status="failed",
            spec=None,
            source="",
            ipynb=None,
            report=None,
            review=None,
            error=error,
            message=None,
        )
        await notebook_store.append_turn(
            scope,
            session,
            notebook_id,
            role="nala",
            content=f"I couldn't finish this: {error}",
            version_id=version_id,
            run_id=run_id,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        log.exception("notebook run %s: failed to persist the failure itself", run_id)
    try:
        await sink.emit("run.error", {"stage": None, "code": reason_code, "message": error[:2000]})
    except Exception:
        log.exception("notebook run %s: failed to emit run.error", run_id)
    try:
        await run_store.finish(
            RunStatus.FAILED, {"status": RunStatus.FAILED, "reason_code": reason_code}
        )
    except Exception:
        log.exception("notebook run %s: failed to finish the run as FAILED", run_id)


# --------------------------------------------------------------------------- handlers


async def handle_notebook_generate(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
    store: NotebookStore | None = None,
) -> None:
    from .handlers import RepoEventSink, RepoRunStateStore, _default_sandbox

    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    notebook_id = uuid.UUID(payload["notebook_id"])
    version_id = uuid.UUID(payload["version_id"])
    notebook_store = store or RepoNotebookStore()
    response_locale = normalize_response_locale(payload.get("response_locale"))

    run_store = RepoRunStateStore(scope, session, run_id)
    sink = RepoEventSink(scope, session, run_id)
    status = await run_store.current_status()
    if status is not RunStatus.QUEUED:
        return
    await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    await notebook_store.set_version_running(scope, session, version_id)
    await session.commit()
    await sink.emit("run.started", {})

    ports = ProductionNotebookPorts(
        llm=llm or default_llm(),
        sandbox=sandbox or _default_sandbox(),
        sink=sink,
        response_locale=response_locale,
        sandbox_memory_mb=await _resolve_sandbox_memory_mb(session, scope),
    )
    try:
        create_request = CreateNotebookRequest.model_validate(payload.get("request") or {})
        seed_material, seed_run_cell = await _seed_material_for(
            scope, session, create_request, notebook_store
        )
        gen_request = GenerationRequest(
            brief=create_request.brief,
            kind_hint=create_request.kind.value if create_request.kind else None,
            audience=create_request.audience.model_dump() if create_request.audience else None,
            style=create_request.style.model_dump() if create_request.style else None,
            framework=create_request.framework.model_dump() if create_request.framework else None,
            seeds=tuple(create_request.seeds),
            seed_material=seed_material,
            seed_run_cell=seed_run_cell,
            response_locale=response_locale,
            slug=payload.get("slug"),
        )
        outcome = await generate(ports, gen_request)
        await _record_sandbox_usage(session, scope, run_id, ports)
        await _save_outcome(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            outcome=outcome,
            sink=sink,
            run_store=run_store,
            success_reason_code="notebook_generated",
            failure_reason_code="notebook_generation_failed",
            response_locale=response_locale,
        )
    except CircuitSeedRejected as exc:
        log.warning("notebook.generate run %s: circuit seed rejected: %s", run_id, exc.findings)
        await _fail_run(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=str(exc),
            reason_code="circuit_seed_rejected",
        )
    except SeedNotFoundError as exc:
        log.warning("notebook.generate run %s: seed not found: %s", run_id, exc)
        await _fail_run(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"notebook generation failed: {exc}",
            reason_code="seed_not_found",
        )
    except Exception as exc:
        log.exception("notebook.generate run %s failed", run_id)
        await _fail_run(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"notebook generation failed: {exc}",
            reason_code="notebook_generation_failed",
        )


async def handle_notebook_revise(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
    store: NotebookStore | None = None,
) -> None:
    from .handlers import RepoEventSink, RepoRunStateStore, _default_sandbox

    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    notebook_id = uuid.UUID(payload["notebook_id"])
    version_id = uuid.UUID(payload["version_id"])
    notebook_store = store or RepoNotebookStore()
    response_locale = normalize_response_locale(payload.get("response_locale"))
    kind = payload.get("kind", "revise")

    run_store = RepoRunStateStore(scope, session, run_id)
    sink = RepoEventSink(scope, session, run_id)
    status = await run_store.current_status()
    if status is not RunStatus.QUEUED:
        return
    await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    await notebook_store.set_version_running(scope, session, version_id)
    await session.commit()
    await sink.emit("run.started", {})

    ports = ProductionNotebookPorts(
        llm=llm or default_llm(),
        sandbox=sandbox or _default_sandbox(),
        sink=sink,
        response_locale=response_locale,
        sandbox_memory_mb=await _resolve_sandbox_memory_mb(session, scope),
    )
    try:
        # BEFORE the base-version lookup on purpose: an authored version carries its
        # whole spec, so it needs no base — and requiring one would refuse the first
        # thing a reader does to a notebook whose only generation failed, and the
        # first `%nala push` into an empty notebook.
        if kind == "author":
            await _handle_author(
                notebook_store=notebook_store,
                scope=scope,
                session=session,
                notebook_id=notebook_id,
                version_id=version_id,
                run_id=run_id,
                payload=payload,
                ports=ports,
                sink=sink,
                run_store=run_store,
                response_locale=response_locale,
            )
            return

        base_version_id = payload.get("base_version_id")
        base = (
            await notebook_store.get_version(scope, session, uuid.UUID(base_version_id))
            if base_version_id
            else await notebook_store.get_current_version(scope, session, notebook_id)
        )
        if base is None or getattr(base, "spec", None) is None:
            raise ValueError("no base version to revise from")
        base_spec = NotebookSpec.model_validate(base.spec)

        if kind == "rerun":
            report = await ports.run_notebook(base_spec)
            review = None
            if report.ok:
                try:
                    review = await ports.review(base_spec, report)
                except Exception as exc:  # noqa: BLE001 - advisory, like the pipeline's own review stage
                    log.warning("notebook rerun %s: review failed: %s", run_id, exc)
            # The same rule the pipeline applies (`is_usable`): a re-run whose cells ran is
            # a result even when one raised, so the reader sees the traceback instead of a
            # version marked failed that the page cannot show.
            usable = is_usable(report)
            outcome = PipelineOutcome(
                status="ready" if usable else "failed",
                spec=base_spec,
                report=report,
                review=review,
                summary="re-executed" if report.ok else "",
                error="" if usable else (report.note or "the notebook did not execute cleanly"),
                cell_errors="" if report.ok or not usable else describe_failure(report),
            )
            await _record_sandbox_usage(session, scope, run_id, ports)
            await _save_outcome(
                notebook_store=notebook_store,
                scope=scope,
                session=session,
                notebook_id=notebook_id,
                version_id=version_id,
                run_id=run_id,
                outcome=outcome,
                sink=sink,
                run_store=run_store,
                success_reason_code="notebook_rerun",
                failure_reason_code="notebook_rerun_failed",
                response_locale=response_locale,
            )
            return

        raw_request = payload.get("request") or {}
        message = str(raw_request.get("message", ""))
        history_rows = sorted(
            await notebook_store.list_turns(scope, session, notebook_id, limit=8),
            key=lambda row: getattr(row, "seq", 0),
        )
        history = tuple(
            {
                "role": getattr(row.role, "value", row.role),
                "content": row.content,
            }
            for row in history_rows
        )
        rev_request = RevisionRequest(
            spec=base_spec, message=message, history=history, response_locale=response_locale
        )
        outcome = await revise(ports, rev_request)
        await _record_sandbox_usage(session, scope, run_id, ports)

        if outcome.status == "ready" and outcome.spec is None:
            # Answered without editing (RevisionPlan.ops == []): the base
            # version's content stands; only the reply is new.
            await notebook_store.set_version_result(
                scope,
                session,
                version_id,
                status="ready",
                spec=base.spec,
                source=base.source,
                ipynb=base.ipynb,
                report=base.report,
                review=base.review,
                error="",
                message="no change",
            )
            await notebook_store.append_turn(
                scope,
                session,
                notebook_id,
                role="nala",
                content=outcome.reply or "No change made.",
                version_id=version_id,
                run_id=run_id,
            )
            await session.commit()
            await run_store.finish(
                RunStatus.SUCCEEDED,
                {"status": RunStatus.SUCCEEDED, "reason_code": "notebook_no_change"},
            )
            return

        await _save_outcome(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            outcome=outcome,
            sink=sink,
            run_store=run_store,
            turn_content=outcome.reply or None,
            success_reason_code="notebook_revised",
            failure_reason_code="notebook_revision_failed",
            response_locale=response_locale,
        )
    except Exception as exc:
        log.exception("notebook.revise run %s failed", run_id)
        await _fail_run(
            notebook_store=notebook_store,
            scope=scope,
            session=session,
            notebook_id=notebook_id,
            version_id=version_id,
            run_id=run_id,
            run_store=run_store,
            sink=sink,
            error=f"notebook revision failed: {exc}",
            reason_code="notebook_revision_failed",
        )


async def handle_notebook_grade(
    session: AsyncSession,
    payload: dict[str, Any],
    *,
    llm: LLMClient | None = None,
    sandbox: Sandbox | None = None,
    store: NotebookStore | None = None,
) -> None:
    """Grade one reader's attempt at a notebook version, and emit the verdicts.

    The whole lane in four moves: take the AUTHORED spec (the only copy that still
    holds the assertions), substitute the reader's own source into each graded cell
    and insert each check after it, run that once in the sandbox, and read the
    verdicts back out. `spec_with_graders` and `grades_from_report` are the same pair
    `scripts/check_graders.py` and the generation-time audit use, so a reader's grade
    is decided by exactly the code those two prove can fail.

    **No notebook version is written and none is touched.** An attempt is not an edit
    — the derived spec never leaves this function, and the reader's code is executed
    without ever being stored as the notebook's. That is why this handler takes the
    version id but never calls `set_version_running` or `set_version_result`: the
    version rows are the notebook's history, and one reader trying an exercise is not
    a moment in it.

    **No model is in the path.** Every verdict this emits is `graded_by:
    deterministic` — an assertion that raised or did not, a choice that matched or did
    not. The model-graded `rubric` kind comes back `ungradable` rather than being
    quietly sent to an LLM: an honest gap is better than a verdict whose reproducibility
    depends on a model's mood, and the reader can see which is which.

    The failure path is deliberately not `_fail_run`: that closes a notebook VERSION as
    failed, which here would mark a perfectly good notebook broken because someone's
    attempt timed out.
    """
    from .handlers import RepoEventSink, RepoRunStateStore, _default_sandbox

    scope = _scope_from_payload(payload)
    run_id = uuid.UUID(payload["run_id"])
    version_id = uuid.UUID(payload["version_id"])
    notebook_store = store or RepoNotebookStore()

    run_store = RepoRunStateStore(scope, session, run_id)
    sink = RepoEventSink(scope, session, run_id)
    if await run_store.current_status() is not RunStatus.QUEUED:
        return
    await run_store.set_status(RunStatus.RUNNING, started_at_now=True)
    await session.commit()
    await sink.emit("run.started", {})

    ports = ProductionNotebookPorts(
        llm=llm or default_llm(),
        sandbox=sandbox or _default_sandbox(),
        sink=sink,
        response_locale=normalize_response_locale(payload.get("response_locale")),
        sandbox_memory_mb=await _resolve_sandbox_memory_mb(session, scope),
    )
    try:
        version = await notebook_store.get_version(scope, session, version_id)
        spec = NotebookSpec.model_validate(getattr(version, "spec", None) or {})
        raw = payload.get("attempt") or {}
        attempt = GradedAttempt(
            code={str(k): str(v) for k, v in (raw.get("code") or {}).items()},
            answers={str(k): str(v) for k, v in (raw.get("answers") or {}).items()},
        )
        await ports.observe("notebook.execute", "started")
        report = await ports.run_notebook(spec_with_graders(spec, attempt))
        # ORDER, and it is the whole of the fix: the verdicts are emitted BEFORE any
        # event a consumer treats as terminal.
        #
        # `observe(..., "failed")` emits `run.error`, and `useRunProgress` — like every
        # other consumer of a run stream — stops reading at one. Emitting it first
        # would end the stream on the way to the reader's own verdict, leaving the cell
        # on "Running your code…" forever, and it would have looked like a flake
        # because whether the browser saw the grades at all depends on the two events
        # landing in the same chunk. Greptile caught it on PR 832.
        #
        # The failure is still reported, just after the grades rather than instead of
        # them: a guard-refused attempt is something the reader needs told, and
        # suppressing it to fix the ordering would have traded one silence for another.
        grades = grades_from_report(spec, report, attempt)
        await sink.emit(
            "notebook.grades",
            {
                "version_id": str(version_id),
                "grades": grades.model_dump(mode="json"),
                "passed": grades.passed,
                "failed": grades.failed,
                "attempted": grades.attempted,
                # Why nothing could be graded, when that is the answer — a guard
                # refusal, a sandbox note. Empty on an ordinary wrong answer.
                "note": report.note if not report.ok else "",
            },
        )
        await ports.observe("notebook.execute", "finished" if report.ok else "failed", report.note)
        # `run_store.finish`, not `set_status` + a hand-built `run.finished`. Every other
        # handler in this module closes a run this way, and I did not: the payload I
        # wrote — `{"ok": True}` — is not the `RunFinished` shape, which requires
        # `status` and forbids extras, so the production sink would have REJECTED it.
        # A successful grade would then have fallen into the exception handler below and
        # persisted the run as FAILED, after the reader had already been sent a correct
        # verdict. `finish` also writes the event and the status together, which the two
        # separate calls did not. Greptile, PR 832.
        await run_store.finish(RunStatus.SUCCEEDED, {"status": RunStatus.SUCCEEDED})
    except Exception as exc:  # noqa: BLE001 - one reader's attempt, never the notebook
        log.exception("notebook.grade run %s failed", run_id)
        try:
            await session.rollback()
            await sink.emit(
                "run.error",
                {
                    "stage": Stage.FINAL_EXECUTE.value,
                    "code": "grade_failed",
                    "message": str(exc)[:2000],
                },
            )
            await run_store.finish(
                RunStatus.FAILED,
                {"status": RunStatus.FAILED, "reason_code": "grade_failed"},
            )
        except Exception:
            log.exception("notebook.grade run %s: could not close the run", run_id)
    finally:
        await _record_sandbox_usage(session, scope, run_id, ports)


async def handle_notebook_dead_letter(
    session: AsyncSession,
    payload: dict[str, Any],
    reason: str,
    *,
    store: NotebookStore | None = None,
) -> None:
    """Close an active run AND its notebook version when the durable job that
    was generating/revising it cannot continue (worker crash, exhausted
    retries, lost lease) — the same failure mode `_fail_run` handles for an
    exception caught inside the handler, but for one the process never got a
    chance to catch at all. Without this a dead-lettered notebook job leaves
    the version stuck in `running` forever, with nothing to ever move it."""
    from .handlers import handle_run_dead_letter

    await handle_run_dead_letter(session, payload, reason)
    version_id = payload.get("version_id")
    notebook_id = payload.get("notebook_id")
    run_id = payload.get("run_id")
    if not version_id or not notebook_id or not run_id:
        return
    scope = _scope_from_payload(payload)
    notebook_store = store or RepoNotebookStore()
    try:
        await notebook_store.set_version_result(
            scope,
            session,
            uuid.UUID(version_id),
            status="failed",
            spec=None,
            source="",
            ipynb=None,
            report=None,
            review=None,
            error=f"job dead-lettered: {reason[:1900]}",
            message=None,
        )
        await notebook_store.append_turn(
            scope,
            session,
            uuid.UUID(notebook_id),
            role="nala",
            content=f"I couldn't finish this: job dead-lettered: {reason[:500]}",
            version_id=uuid.UUID(version_id),
            run_id=uuid.UUID(run_id),
        )
        await session.commit()
    except Exception:
        await session.rollback()
        log.exception("notebook dead-letter: failed to mark version %s failed", version_id)
