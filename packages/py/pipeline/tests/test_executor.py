"""Executor choreography tests against in-memory sink/store fakes. The event
sequences asserted here are the replay contract the SSE stream and UI rely on."""

import uuid
from typing import Any

from majorana_contracts.enums import Framework, RunMode, RunStatus, Stage, VerifierDecision
from majorana_pipeline import STAGE_ORDER, RunContext, StageOutcome, default_handlers, execute_run


class FakeSink:
    def __init__(self) -> None:
        self.events: list[tuple[str, dict[str, Any]]] = []

    async def emit(self, type: str, payload: dict[str, Any]) -> None:
        self.events.append((type, payload))

    @property
    def types(self) -> list[str]:
        return [t for t, _ in self.events]


class FakeStore:
    def __init__(self, status: RunStatus = RunStatus.QUEUED) -> None:
        self.status = status
        self.fields_history: list[dict[str, Any]] = []

    async def set_status(self, new: RunStatus, **fields: Any) -> None:
        self.status = new
        self.fields_history.append({"status": new, **fields})

    async def current_status(self) -> RunStatus:
        return self.status


def make_ctx(sink: FakeSink) -> RunContext:
    return RunContext(
        run_id=uuid.uuid4(),
        task_prompt="bell state",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=42,
        shots=1024,
        tolerances=None,
        timeout_s=120,
        sink=sink,
    )


async def test_happy_path_emits_full_choreography():
    sink, store = FakeSink(), FakeStore()
    final = await execute_run(make_ctx(sink), store)

    assert final is RunStatus.SUCCEEDED
    assert store.status is RunStatus.SUCCEEDED
    expected = ["run.started"]
    for stage in STAGE_ORDER:
        expected += ["stage.started", "stage.finished"]
    expected += ["run.finished"]
    assert sink.types == expected
    # every stage.finished ok, in declaration order
    finished = [p for t, p in sink.events if t == "stage.finished"]
    assert [p["stage"] for p in finished] == list(STAGE_ORDER)
    assert all(p["ok"] for p in finished)
    # the spine has verified nothing — run.finished must say so
    assert sink.events[-1][1]["verifier_decision"] is VerifierDecision.INCONCLUSIVE


async def test_stage_failure_stops_pipeline_and_fails_run():
    sink, store = FakeSink(), FakeStore()

    async def bad_screen(ctx):
        return StageOutcome(ok=False, error_code="boom", error_message="qubit fell over")

    handlers = default_handlers() | {Stage.SCREEN: bad_screen}
    final = await execute_run(make_ctx(sink), store, handlers)

    assert final is RunStatus.FAILED
    assert store.status is RunStatus.FAILED
    assert sink.types.count("stage.started") == 3  # plan, generate, screen — then stop
    assert (
        "run.error",
        {"stage": Stage.SCREEN, "code": "boom", "message": "qubit fell over"},
    ) in sink.events
    assert sink.events[-1] == ("run.finished", {"status": RunStatus.FAILED})


async def test_repairable_failure_diagnoses_and_restarts_from_requested_stage():
    sink, store = FakeSink(), FakeStore()

    async def flaky_screen(ctx):
        if not ctx.state.get("screen_attempted"):
            ctx.state["screen_attempted"] = True
            return StageOutcome(
                ok=False,
                error_code="screen_failed",
                error_message="missing FINAL_CIRCUIT",
                retry_from=Stage.GENERATE,
                diagnosis="bind the final circuit before screening again",
            )
        return StageOutcome(ok=True)

    handlers = default_handlers() | {Stage.SCREEN: flaky_screen}
    final = await execute_run(make_ctx(sink), store, handlers)

    assert final is RunStatus.SUCCEEDED
    assert sink.types.count("stage.started") == len(STAGE_ORDER) + 2
    diagnosed = next(payload for kind, payload in sink.events if kind == "run.diagnosed")
    assert diagnosed == {
        "failed_stage": Stage.SCREEN,
        "restart_from": Stage.GENERATE,
        "code": "screen_failed",
        "message": "bind the final circuit before screening again",
        "attempt": 1,
    }
    restarted = next(payload for kind, payload in sink.events if kind == "run.restarted")
    assert restarted["from_stage"] is Stage.GENERATE
    assert restarted["attempt"] == 1


async def test_handler_exception_is_absorbed_into_failed():
    sink, store = FakeSink(), FakeStore()

    async def explode(ctx):
        raise RuntimeError("kaboom")

    handlers = default_handlers() | {Stage.PLAN: explode}
    final = await execute_run(make_ctx(sink), store, handlers)

    assert final is RunStatus.FAILED
    errors = [p for t, p in sink.events if t == "run.error"]
    assert errors == [{"stage": Stage.PLAN, "code": "stage_exception", "message": "kaboom"}]


async def test_cancelled_before_start_is_a_noop():
    sink, store = FakeSink(), FakeStore(status=RunStatus.CANCELLED)
    final = await execute_run(make_ctx(sink), store)
    assert final is RunStatus.CANCELLED
    assert sink.events == []


async def test_cancel_between_stages_stops_cooperatively():
    sink, store = FakeSink(), FakeStore()

    async def cancel_during_generate(ctx):
        store.status = RunStatus.CANCELLED  # what the API cancel endpoint does
        return StageOutcome(ok=True)

    handlers = default_handlers() | {Stage.GENERATE: cancel_during_generate}
    final = await execute_run(make_ctx(sink), store, handlers)

    assert final is RunStatus.CANCELLED
    assert sink.types.count("stage.started") == 2  # plan, generate; screen never starts
    assert sink.events[-1] == ("run.finished", {"status": RunStatus.CANCELLED})


async def test_duplicate_delivery_of_terminal_run_is_a_noop():
    sink, store = FakeSink(), FakeStore(status=RunStatus.SUCCEEDED)
    final = await execute_run(make_ctx(sink), store)
    assert final is RunStatus.SUCCEEDED
    assert sink.events == []
