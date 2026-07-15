"""Stage executor — drives one run through STAGE_ORDER, emitting the typed event
log as it goes. Persistence is behind two narrow protocols (EventSink, RunStateStore)
so this module stays pure; the worker supplies repo-backed implementations.

Event/status choreography per run:
  run.started + RUNNING → (stage.started → handler → stage.finished) × 12
  → run.finished(succeeded) + SUCCEEDED
Repairable failures emit run.diagnosed + run.restarted and resume at the
diagnosed stage, bounded by MAX_RESTARTS. Non-repairable failures continue to
analysis when the handler returns ok=True with a failed verifier decision.
Cancellation is checked between stages (co-operative; a stage in flight finishes).
"""

import time
from dataclasses import dataclass, field
from typing import Any, Protocol

from majorana_contracts.enums import Framework, RunMode, RunStatus, Stage, VerifierDecision

from .machine import STAGE_ORDER, assert_transition

MAX_RESTARTS = 2


class EventSink(Protocol):
    async def emit(self, type: str, payload: dict[str, Any]) -> None:
        """Append one run_events row; the sink owns the envelope (run_id/seq/ts)."""
        ...


class RunStateStore(Protocol):
    async def set_status(self, new: RunStatus, **fields: Any) -> None: ...

    async def current_status(self) -> RunStatus:
        """Re-read from storage — how a cancel issued via the API becomes visible."""
        ...


@dataclass
class RunContext:
    """Everything a stage handler may see. Stage outputs accumulate in `state`
    (e.g. the plan, generated code) for downstream stages within the same run."""

    run_id: Any
    task_prompt: str
    mode: RunMode
    framework: Framework
    seed: int | None
    shots: int | None
    tolerances: dict[str, Any] | None
    timeout_s: int | None
    sink: EventSink
    conversation_id: Any | None = None
    source_code: str | None = None
    source_framework: Framework | None = None
    parent_artifact_id: Any | None = None
    state: dict[str, Any] = field(default_factory=dict)


@dataclass
class StageOutcome:
    ok: bool
    error_code: str | None = None
    error_message: str | None = None
    retry_from: Stage | None = None
    diagnosis: str | None = None


class StageHandler(Protocol):
    async def __call__(self, ctx: RunContext) -> StageOutcome: ...


async def _stub_stage(ctx: RunContext) -> StageOutcome:
    """Placeholder until the real stage lands (08-phases.md §Phase 2 steps 2-6:
    sandbox, llm+prompts, verification+baselines, IR/export, writeback)."""
    return StageOutcome(ok=True)


def default_handlers() -> dict[Stage, StageHandler]:
    return {stage: _stub_stage for stage in STAGE_ORDER}


async def execute_run(
    ctx: RunContext,
    store: RunStateStore,
    handlers: dict[Stage, StageHandler] | None = None,
) -> RunStatus:
    """Drive one claimed run to a terminal status. Returns that status.
    Raises only on infrastructure failure (sink/store errors propagate — the
    job layer decides retry vs dead); stage failures are absorbed into FAILED."""
    handlers = handlers or default_handlers()
    status = await store.current_status()
    if status is not RunStatus.QUEUED:
        return status  # cancelled before start, or a duplicate delivery

    assert_transition(status, RunStatus.RUNNING)
    await store.set_status(RunStatus.RUNNING, started_at_now=True)
    await ctx.sink.emit("run.started", {})
    status = RunStatus.RUNNING

    async def _fail(stage: Stage | None, code: str, message: str) -> RunStatus:
        await ctx.sink.emit(
            "run.error",
            {"stage": stage, "code": code, "message": message},
        )
        assert_transition(RunStatus.RUNNING, RunStatus.FAILED)
        await ctx.sink.emit("run.finished", {"status": RunStatus.FAILED})
        await store.set_status(RunStatus.FAILED, finished_at_now=True)
        return RunStatus.FAILED

    # State keys are tagged with the stage that produced them so a restart can
    # discard stale downstream values while retaining the accepted plan/code.
    state_origin = {
        "plan": Stage.PLAN,
        "code": Stage.GENERATE,
        "screen": Stage.SCREEN,
        "pre_resource_estimate": Stage.RESOURCE_ESTIMATE,
        "result": Stage.VERIFY,
        "qasm": Stage.VERIFY,
        "qasm_source": Stage.VERIFY,
        "circuit": Stage.VERIFY,
        "verifier_decision": Stage.VERIFY,
        "compilation": Stage.COMPILE,
        "compiled_circuit": Stage.COMPILE,
        "compiled_resource_estimate": Stage.COMPILED_RESOURCE_ESTIMATE,
        "export": Stage.FINALIZE,
        "final_code": Stage.FINALIZE,
        "final_result": Stage.FINAL_EXECUTE,
        "final_qasm": Stage.FINAL_EXECUTE,
        "final_circuit": Stage.FINAL_EXECUTE,
        "baseline": Stage.BASELINE,
        "analysis": Stage.ANALYZE,
    }

    def reset_for_restart(from_stage: Stage) -> None:
        restart_index = STAGE_ORDER.index(from_stage)
        for key, origin in state_origin.items():
            if key in ctx.state and STAGE_ORDER.index(origin) >= restart_index:
                del ctx.state[key]

    stage_index = 0
    restart_count = 0
    while stage_index < len(STAGE_ORDER):
        stage = STAGE_ORDER[stage_index]
        if await store.current_status() is RunStatus.CANCELLED:
            await ctx.sink.emit("run.finished", {"status": RunStatus.CANCELLED})
            return RunStatus.CANCELLED
        await ctx.sink.emit("stage.started", {"stage": stage})
        t0 = time.monotonic()
        try:
            outcome = await handlers[stage](ctx)
        except Exception as exc:  # a buggy handler must not kill the worker loop
            await ctx.sink.emit(
                "stage.finished",
                {
                    "stage": stage,
                    "ok": False,
                    "duration_ms": int((time.monotonic() - t0) * 1000),
                },
            )
            return await _fail(stage, "stage_exception", str(exc))
        await ctx.sink.emit(
            "stage.finished",
            {
                "stage": stage,
                "ok": outcome.ok,
                "duration_ms": int((time.monotonic() - t0) * 1000),
            },
        )
        if not outcome.ok:
            retry_from = outcome.retry_from
            if (
                retry_from is not None
                and STAGE_ORDER.index(retry_from) <= stage_index
                and restart_count < MAX_RESTARTS
            ):
                restart_count += 1
                message = outcome.diagnosis or outcome.error_message or f"stage {stage} failed"
                await ctx.sink.emit(
                    "run.diagnosed",
                    {
                        "failed_stage": stage,
                        "restart_from": retry_from,
                        "code": outcome.error_code or "stage_failed",
                        "message": message,
                        "attempt": restart_count,
                    },
                )
                reset_for_restart(retry_from)
                ctx.state["repair_feedback"] = message
                await ctx.sink.emit(
                    "run.restarted",
                    {"from_stage": retry_from, "attempt": restart_count, "reason": message},
                )
                stage_index = STAGE_ORDER.index(retry_from)
                continue
            return await _fail(
                stage,
                outcome.error_code or "stage_failed",
                outcome.error_message or f"stage {stage} failed",
            )
        stage_index += 1

    assert_transition(RunStatus.RUNNING, RunStatus.SUCCEEDED)
    await ctx.sink.emit(
        "run.finished",
        {
            "status": RunStatus.SUCCEEDED,
            # Stub value until the verify stage lands (Phase 2 step 4): the spine
            # has verified nothing, and run.finished must never claim otherwise.
            "verifier_decision": ctx.state.get("verifier_decision", VerifierDecision.INCONCLUSIVE),
            "residual_risks": ctx.state.get("residual_risks"),
        },
    )
    await store.set_status(RunStatus.SUCCEEDED, finished_at_now=True)
    return RunStatus.SUCCEEDED
