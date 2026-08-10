"""The half of the per-tier run allowance that only the worker can enforce.

The API refuses an explicit `mode=execute` submission once an account's weekly
runs are spent. It cannot refuse an AUTO submission: AUTO has not decided what it
is yet, and refusing those would refuse ordinary chat, which is unmetered by
policy. So a caller could have spent an unbounded number of executions simply by
omitting `mode`.

This is where that closes — at the moment AUTO actually becomes EXECUTE.
"""

import uuid

import pytest
from majorana_contracts.enums import Framework, RunMode, RunStatus
from majorana_api.tiers import TIER_LIMITS
from majorana_worker import handlers
from majorana_worker.context import RunContext

FREE_TOKENS = TIER_LIMITS["free"].agent_tokens_per_week
FREE_RUNS = TIER_LIMITS["free"].agent_runs_per_week
assert FREE_TOKENS is not None and FREE_RUNS is not None


class _RecordingSink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload, *, event_id=None):
        self.events.append((event_type, payload))


class _FakeStore:
    def __init__(self, status=RunStatus.QUEUED):
        self.status = status
        self.finished = None

    async def current_status(self):
        return self.status

    async def finish(self, status, payload):
        self.finished = (status, payload)
        return status


class _ExecuteLLM:
    async def complete(self, request, *, on_delta=None):
        from majorana_llm import LLMResponse

        return LLMResponse(
            text='{"intent": "execute", "reason": "runs a circuit"}',
            model="test",
            input_tokens=1,
            output_tokens=1,
        )


class _Scope:
    user_id = uuid.uuid4()
    workspace_id = uuid.uuid4()


class _User:
    def __init__(self, email: str, plan: str | None = None):
        self.email = email
        self.plan = plan


class _Session:
    def __init__(self, user, trace=None):
        self._user = user
        self._trace = trace

    async def get(self, _model, _pk):
        return self._user

    async def commit(self):
        if self._trace is not None:
            self._trace.append("commit")
        return None


def _ctx(sink) -> RunContext:
    return RunContext(
        run_id=uuid.uuid4(),
        task_prompt="Build a Bell pair and measure it",
        mode=RunMode.AUTO,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )


@pytest.fixture(autouse=True)
def _worker_production_environment(monkeypatch):
    """The environment the worker actually runs in on Cloud Run.

    No LEONA_DEVELOPER_EMAILS and — the part that matters — no WORKOS_CLIENT_ID.
    The worker authenticates nothing, so it has never had one. The first cut of
    this check resolved the allowlist through `Settings.from_env()`, which
    validates the whole API service's configuration and raises RuntimeError
    without that variable: every AUTO run that resolved to EXECUTE would have
    failed in production. Setting the variable here to make the test pass is
    exactly how that ships again.
    """
    for name in ("LEONA_DEVELOPER_EMAILS", "WORKOS_CLIENT_ID"):
        monkeypatch.delenv(name, raising=False)

    async def reserve_execute_run_slot(_scope, _session, _since, _limit):
        return None

    # The repository's live race suite proves the real row lock. Unit tests for
    # mode resolution replace it with the one outcome each test is about.
    monkeypatch.setattr(handlers.runs_repo, "reserve_execute_run_slot", reserve_execute_run_slot)


async def test_auto_cannot_be_used_to_spend_an_exhausted_allowance(monkeypatch):
    """The bypass this file exists to close."""

    async def reserve_execute_run_slot(_scope, _session, _since, _limit):
        raise handlers.runs_repo.RunAllowanceReached(FREE_TOKENS, FREE_TOKENS)

    monkeypatch.setattr(handlers.runs_repo, "reserve_execute_run_slot", reserve_execute_run_slot)

    sink = _RecordingSink()
    with pytest.raises(handlers._RunAllowanceExhausted) as caught:
        await handlers._resolve_mode(
            _ctx(sink),
            _FakeStore(),
            scope=_Scope(),
            session=_Session(_User("someone@example.com")),
            llm=_ExecuteLLM(),
            has_source_code=False,
        )

    assert caught.value.used == FREE_TOKENS
    assert caught.value.limit == FREE_TOKENS
    # The message a user reads is built from the run count, not this one.
    assert f"about {FREE_RUNS} verified runs a week" in caught.value.allowance_phrase


async def test_the_run_being_resolved_is_reserved_once_before_mode_change(monkeypatch):
    """The AUTO row is charged once before it becomes EXECUTE."""

    called = {}
    trace = []

    async def reserve_execute_run_slot(scope, session, since, limit):
        trace.append("reserve")
        called.update(scope=scope, session=session, since=since, limit=limit)

    monkeypatch.setattr(handlers.runs_repo, "reserve_execute_run_slot", reserve_execute_run_slot)

    recorded = {}

    async def set_run_mode(_scope, _session, run_id, mode):
        trace.append("set_mode")
        recorded["mode"] = mode

    monkeypatch.setattr(handlers.runs_repo, "set_run_mode", set_run_mode)

    sink = _RecordingSink()
    session = _Session(_User("someone@example.com"), trace)
    result = await handlers._resolve_mode(
        _ctx(sink),
        _FakeStore(),
        scope=_Scope(),
        session=session,
        llm=_ExecuteLLM(),
        has_source_code=False,
    )

    assert result.mode is RunMode.EXECUTE
    assert recorded["mode"] is RunMode.EXECUTE
    assert called["scope"].user_id == _Scope.user_id
    assert called["session"].__class__ is _Session
    assert called["limit"] == FREE_TOKENS
    assert trace == ["reserve", "set_mode", "commit"]


async def test_auto_chat_does_not_reserve_execute_allowance(monkeypatch):
    """Conversation traffic remains unmetered when AUTO resolves to CHAT."""

    async def unexpected_reservation(*_args, **_kwargs):
        raise AssertionError("CHAT resolution must not reserve execute allowance")

    monkeypatch.setattr(handlers.runs_repo, "reserve_execute_run_slot", unexpected_reservation)
    monkeypatch.setattr(handlers.runs_repo, "set_run_mode", _noop_set_mode)

    class _ChatLLM:
        async def complete(self, request, *, on_delta=None):
            from majorana_llm import LLMResponse

            return LLMResponse(
                text='{"intent": "chat", "reason": "conversation"}',
                model="test",
                input_tokens=1,
                output_tokens=1,
            )

    result = await handlers._resolve_mode(
        _ctx(_RecordingSink()),
        _FakeStore(),
        scope=_Scope(),
        session=_Session(_User("someone@example.com")),
        llm=_ChatLLM(),
        has_source_code=False,
    )

    assert result.mode is RunMode.CHAT


async def test_the_operator_is_not_metered_without_any_configuration(monkeypatch):
    """A missing allowlist must not throttle an operator-owned synthetic identity."""

    monkeypatch.setattr(handlers.runs_repo, "set_run_mode", _noop_set_mode)

    result = await handlers._resolve_mode(
        _ctx(_RecordingSink()),
        _FakeStore(),
        scope=_Scope(),
        session=_Session(_User("local-dev@majorana.test")),
        llm=_ExecuteLLM(),
        has_source_code=False,
    )
    assert result.mode is RunMode.EXECUTE


async def test_a_developer_by_plan_column_is_not_metered(monkeypatch):
    monkeypatch.setattr(handlers.runs_repo, "set_run_mode", _noop_set_mode)

    result = await handlers._resolve_mode(
        _ctx(_RecordingSink()),
        _FakeStore(),
        scope=_Scope(),
        session=_Session(_User("collaborator@example.com", plan="developer")),
        llm=_ExecuteLLM(),
        has_source_code=False,
    )
    assert result.mode is RunMode.EXECUTE


async def test_the_refusal_lands_in_the_run_stream_as_a_reason_not_a_crash():
    """A refused run must end where the user is looking, with words they know."""
    sink = _RecordingSink()
    store = _FakeStore()
    ctx = _ctx(sink)

    status = await handlers._finish_allowance_exhausted(
        ctx,
        store,
        handlers._RunAllowanceExhausted(FREE_TOKENS, FREE_TOKENS, runs=FREE_RUNS),
    )

    assert status is RunStatus.FAILED
    assert store.finished == (
        RunStatus.FAILED,
        {"status": RunStatus.FAILED, "reason_code": "run_allowance_exhausted"},
    )
    [(event_type, payload)] = sink.events
    # run.error is an EXISTING event type: a new one would need a migration for
    # run_events.ck_type_enum, and the reason belongs in the payload anyway.
    assert event_type == "run.error"
    assert payload["code"] == "run_allowance_exhausted"
    # Both numbers: the run count is the one the plan is sold as, and building
    # the sentence from the enforced figure alone would read "your plan
    # includes 150000 verified runs per week".
    assert f"about {FREE_RUNS} verified runs a week" in payload["message"]
    assert f"{FREE_TOKENS:,} tokens" in payload["message"]
    assert "abuse" not in payload["message"]


async def _noop_set_mode(_scope, _session, _run_id, _mode):
    return None


async def test_the_check_survives_the_worker_environment_it_runs_in(monkeypatch):
    """A regression guard with a name, because this one was a live outage.

    The autouse fixture already strips WORKOS_CLIENT_ID; this asserts the
    consequence directly so the reason cannot be lost if the fixture is edited.
    """
    import os

    assert "WORKOS_CLIENT_ID" not in os.environ

    # No exception is the assertion.
    await handlers._assert_execute_allowance(_Scope(), _Session(_User("someone@example.com")))
