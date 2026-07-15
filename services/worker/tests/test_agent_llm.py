from uuid import uuid4

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

    async def emit(self, event_type, payload):
        self.events.append((event_type, payload))


class Session:
    def __init__(self):
        self.commits = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass


async def test_agent_llm_records_event_and_token_usage(monkeypatch):
    recorded = []

    async def record_usage(scope, session, **values):
        recorded.append((scope, session, values))

    monkeypatch.setattr("majorana_worker.agent_llm.usage_repo.record_usage", record_usage)
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
    assert recorded[0][2] == {
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
    assert session.commits == 1


async def test_metering_failure_does_not_retry_completed_provider_call(monkeypatch):
    calls = 0

    class CountingDelegate:
        async def complete(self, request, *, on_delta=None):
            nonlocal calls
            calls += 1
            return LLMResponse(text="{}", model=request.model, input_tokens=1, output_tokens=1)

    async def fail_usage(*_args, **_kwargs):
        raise RuntimeError("meter unavailable")

    monkeypatch.setattr("majorana_worker.agent_llm.usage_repo.record_usage", fail_usage)
    llm = MeteredAgentLLM(
        delegate=CountingDelegate(),
        sink=Sink(),
        scope=Scope(user_id=uuid4(), workspace_id=uuid4(), role=Role.MEMBER),
        session=Session(),
        run_id=uuid4(),
    )
    response = await llm.complete(LLMRequest(model="test", system="test"))
    assert response.text == "{}"
    assert calls == 1
