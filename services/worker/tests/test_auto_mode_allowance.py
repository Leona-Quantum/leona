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
    def __init__(self, user):
        self._user = user

    async def get(self, _model, _pk):
        return self._user

    async def commit(self):
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


async def test_auto_cannot_be_used_to_spend_an_exhausted_allowance(monkeypatch):
    """The bypass this file exists to close."""
    used = {"count": FREE_TOKENS}

    async def account_tokens_since(_scope, _session, _since):
        return used["count"]

    monkeypatch.setattr(handlers.usage_repo, "account_tokens_since", account_tokens_since)

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


async def test_the_run_being_resolved_is_not_counted_against_itself(monkeypatch):
    """One token under the limit: this run must still be allowed.

    The run has not spent its own tokens yet at this point, so it is outside
    this sum — which is why `used >= limit` is the right comparison and
    `used > limit` would silently grant everyone one more run.
    """

    async def account_tokens_since(_scope, _session, _since):
        return FREE_TOKENS - 1

    monkeypatch.setattr(handlers.usage_repo, "account_tokens_since", account_tokens_since)

    recorded = {}

    async def set_run_mode(_scope, _session, run_id, mode):
        recorded["mode"] = mode

    monkeypatch.setattr(handlers.runs_repo, "set_run_mode", set_run_mode)

    sink = _RecordingSink()
    result = await handlers._resolve_mode(
        _ctx(sink),
        _FakeStore(),
        scope=_Scope(),
        session=_Session(_User("someone@example.com")),
        llm=_ExecuteLLM(),
        has_source_code=False,
    )

    assert result.mode is RunMode.EXECUTE
    assert recorded["mode"] is RunMode.EXECUTE


async def test_the_operator_is_not_metered_without_any_configuration(monkeypatch):
    """A missing allowlist must not throttle an operator-owned synthetic identity."""

    async def account_tokens_since(_scope, _session, _since):
        return 10_000

    monkeypatch.setattr(handlers.usage_repo, "account_tokens_since", account_tokens_since)
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
    async def account_tokens_since(_scope, _session, _since):
        return 10_000

    monkeypatch.setattr(handlers.usage_repo, "account_tokens_since", account_tokens_since)
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

    async def account_tokens_since(_scope, _session, _since):
        return 0

    monkeypatch.setattr(handlers.usage_repo, "account_tokens_since", account_tokens_since)

    # No exception is the assertion.
    await handlers._assert_execute_allowance(_Scope(), _Session(_User("someone@example.com")))
