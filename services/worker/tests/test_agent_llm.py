from types import SimpleNamespace
from uuid import UUID, uuid4

import pytest

from majorana_contracts import Scope
from majorana_contracts.enums import Role, UsageKind
from majorana_llm import LLMRequest, LLMResponse
from majorana_worker.agent_llm import MeteredAgentLLM


class Delegate:
    async def complete(self, request, *, on_delta=None):
        return LLMResponse(
            text="{}",
            model=request.model,
            input_tokens=7,
            output_tokens=5,
        )


class Sink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload, *, event_id=None):
        self.events.append((event_type, payload, event_id))


class Session:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass


async def test_agent_llm_records_event_and_token_usage(monkeypatch):
    recorded = []
    stored = None

    async def record_usage(scope, session, **values):
        recorded.append((scope, session, values))

    async def get_llm_call(*_args):
        return stored

    async def add_llm_call(*_args, response, duration_ms, **_kwargs):
        nonlocal stored
        stored = SimpleNamespace(response=response, duration_ms=duration_ms, metered=False)
        return stored

    async def mark_llm_call_metered(*_args):
        stored.metered = True

    monkeypatch.setattr("majorana_worker.agent_llm.usage_repo.record_usage", record_usage)
    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.get_llm_call", get_llm_call)
    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.add_llm_call", add_llm_call)
    monkeypatch.setattr(
        "majorana_worker.agent_llm.agent_repo.mark_llm_call_metered", mark_llm_call_metered
    )
    scope = Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.MEMBER)
    session = Session()
    sink = Sink()
    run_id = uuid4()
    llm = MeteredAgentLLM(
        delegate=Delegate(),
        sink=sink,
        scope=scope,
        session=session,
        run_id=run_id,
    )
    await llm.complete(
        LLMRequest(
            model="test",
            system="test",
            response_schema={"type": "object"},
            schema_name="intent_alignment",
        )
    )

    assert sink.events[0][0] == "llm.call"
    assert sink.events[0][1]["stage"] == "verify"
    usage_values = recorded[0][2]
    assert isinstance(usage_values.pop("event_id"), UUID)
    assert usage_values == {
        "kind": UsageKind.LLM_TOKENS,
        "quantity": 12,
        "meta": {
            "model": "test",
            "role": "intent_alignment",
            "input_tokens": 7,
            "output_tokens": 5,
            "run_id": str(run_id),
        },
    }
    assert session.commits == 2
    assert stored.metered is True


async def test_metering_failure_does_not_retry_completed_provider_call(monkeypatch):
    calls = 0
    metering_attempts = 0
    stored = None

    class CountingDelegate:
        async def complete(self, request, *, on_delta=None):
            nonlocal calls
            calls += 1
            return LLMResponse(text="{}", model=request.model, input_tokens=1, output_tokens=1)

    async def flaky_usage(*_args, **_kwargs):
        nonlocal metering_attempts
        metering_attempts += 1
        if metering_attempts == 1:
            raise RuntimeError("meter unavailable")

    async def get_llm_call(*_args):
        return stored

    async def add_llm_call(*_args, response, duration_ms, **_kwargs):
        nonlocal stored
        stored = SimpleNamespace(response=response, duration_ms=duration_ms, metered=False)
        return stored

    async def mark_llm_call_metered(*_args):
        stored.metered = True

    monkeypatch.setattr("majorana_worker.agent_llm.usage_repo.record_usage", flaky_usage)
    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.get_llm_call", get_llm_call)
    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.add_llm_call", add_llm_call)
    monkeypatch.setattr(
        "majorana_worker.agent_llm.agent_repo.mark_llm_call_metered", mark_llm_call_metered
    )
    llm = MeteredAgentLLM(
        delegate=CountingDelegate(),
        sink=Sink(),
        scope=Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.MEMBER),
        session=Session(),
        run_id=uuid4(),
    )
    request = LLMRequest(model="test", system="test")
    with pytest.raises(RuntimeError, match="meter unavailable"):
        await llm.complete(request)
    response = await llm.complete(request)
    assert response.text == "{}"
    assert calls == 1
    assert metering_attempts == 2
    assert stored.metered is True


async def test_generated_source_streams_as_bounded_llm_delta_events(monkeypatch):
    stored = None

    class StreamingDelegate:
        async def complete(self, request, *, on_delta=None):
            assert on_delta is not None
            await on_delta("{" + "x" * 170, "output")
            return LLMResponse(
                text='{"source":"print(1)"}', model=request.model, input_tokens=3, output_tokens=4
            )

    async def get_llm_call(*_args):
        return stored

    async def add_llm_call(*_args, response, duration_ms, **_kwargs):
        nonlocal stored
        stored = SimpleNamespace(response=response, duration_ms=duration_ms, metered=False)
        return stored

    async def record_usage(*_args, **_kwargs):
        return None

    async def mark_llm_call_metered(*_args):
        stored.metered = True

    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.get_llm_call", get_llm_call)
    monkeypatch.setattr("majorana_worker.agent_llm.agent_repo.add_llm_call", add_llm_call)
    monkeypatch.setattr("majorana_worker.agent_llm.usage_repo.record_usage", record_usage)
    monkeypatch.setattr(
        "majorana_worker.agent_llm.agent_repo.mark_llm_call_metered", mark_llm_call_metered
    )
    sink = Sink()
    llm = MeteredAgentLLM(
        delegate=StreamingDelegate(),
        sink=sink,
        scope=Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.MEMBER),
        session=Session(),
        run_id=uuid4(),
    )

    await llm.complete(LLMRequest(model="test", system="test", schema_name="generate_circuit"))

    deltas = [event for event in sink.events if event[0] == "llm.delta"]
    assert [event[1]["text"] for event in deltas] == ["{" + "x" * 159, "x" * 11]
    assert all(event[1]["stage"].value == "generate" for event in deltas)
    assert all(event[1]["kind"] == "output" for event in deltas)
