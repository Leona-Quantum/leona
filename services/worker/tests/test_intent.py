"""Intent routing: which mode a run actually dispatches in."""

import asyncio

import pytest
from majorana_contracts.enums import Framework, RunMode, RunStatus
from majorana_llm import LLMResponse
from majorana_worker import handlers
from majorana_worker.context import RunContext
from majorana_worker import intent
from majorana_worker.intent import ModeDecision, resolve_mode


class _RecordingSink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload, *, event_id=None):
        self.events.append((event_type, payload))


class _FakeStore:
    def __init__(self, status=RunStatus.QUEUED):
        self.status = status

    async def current_status(self):
        return self.status


class _ScriptedLLM:
    """Returns a fixed body; records whether it was consulted at all."""

    def __init__(self, text: str = '{"intent": "execute", "reason": "QAOA on a 5-node ring"}'):
        self._text = text
        self.calls = 0
        self.request = None

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        self.request = request
        return LLMResponse(text=self._text, model=request.model, input_tokens=1, output_tokens=1)


class _BrokenLLM:
    def __init__(self):
        self.calls = 0

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        raise RuntimeError("provider down")


@pytest.mark.parametrize(
    "prompt",
    ["hi", "Hello!", "  THANKS  ", "ok", "test", "what can you do?", "?"],
)
async def test_every_auto_message_uses_the_llm_router(prompt):
    llm = _ScriptedLLM('{"intent": "chat", "reason": "conversation"}')

    decision = await resolve_mode(prompt, RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "classifier"
    assert llm.calls == 1


async def test_an_explicit_execute_is_authoritative_even_for_a_short_prompt():
    llm = _ScriptedLLM()

    decision = await resolve_mode("hi", RunMode.EXECUTE, llm)

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "passthrough"
    assert not decision.changed
    assert llm.calls == 0


async def test_a_greeting_with_a_task_attached_is_not_a_greeting():
    llm = _ScriptedLLM()

    decision = await resolve_mode(
        "hi, build a GHZ state on 4 qubits and measure it", RunMode.AUTO, llm
    )

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "classifier"
    assert llm.calls == 1


async def test_classifier_verdict_of_chat_is_honoured():
    llm = _ScriptedLLM('{"intent": "chat", "reason": "asks how Grover works"}')

    decision = await resolve_mode("How does Grover's algorithm work?", RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.reason == "asks how Grover works"


async def test_verdict_wrapped_in_a_code_fence_still_parses():
    llm = _ScriptedLLM('```json\n{"intent": "execute", "reason": "builds and runs a circuit"}\n```')

    decision = await resolve_mode(
        "Simulate a 3-qubit QFT and report the output state", RunMode.AUTO, llm
    )

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "classifier"


@pytest.mark.parametrize(
    "text",
    ["not json at all", "{}", '{"intent": "maybe"}', '{"intent": "ideate"}', ""],
)
async def test_an_unreadable_verdict_falls_back_to_chat(text):
    """Including 'ideate': the router may only produce chat or execute, so a
    verdict naming a mode outside that set is unusable, not a third answer."""
    llm = _ScriptedLLM(text)

    decision = await resolve_mode("Some ambiguous request about circuits", RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "fallback"


async def test_a_provider_outage_falls_back_to_chat_without_failing_the_run():
    llm = _BrokenLLM()

    decision = await resolve_mode("Some ambiguous request about circuits", RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "fallback"


async def test_an_explicit_execute_never_calls_the_router():
    llm = _BrokenLLM()

    decision = await resolve_mode("Run VQE on H2 at 0.735 angstroms", RunMode.EXECUTE, llm)

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "passthrough"
    assert not decision.changed
    assert llm.calls == 0


async def test_studio_runs_carrying_source_code_are_never_reclassified():
    llm = _ScriptedLLM('{"intent": "chat", "reason": "looks conversational"}')

    decision = await resolve_mode(
        "Please simulate the edited quantum circuit", RunMode.EXECUTE, llm, has_source_code=True
    )

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "passthrough"
    assert llm.calls == 0


@pytest.mark.parametrize("mode", [RunMode.CHAT, RunMode.EXECUTE, RunMode.IDEATE, RunMode.EXPLAIN])
async def test_deliberately_selected_modes_pass_through_untouched(mode):
    llm = _ScriptedLLM()

    decision = await resolve_mode("Anything at all here", mode, llm)

    assert decision.resolved is mode
    assert decision.source == "passthrough"
    assert llm.calls == 0


async def test_the_router_sees_only_the_current_message():
    """No history: after one execute turn, a sticky classifier reads every
    follow-up ("thanks", "why did that work?") as part of the task."""
    llm = _ScriptedLLM()

    await resolve_mode("Build and run a 4-qubit GHZ state", RunMode.AUTO, llm)

    assert llm.request.messages in (None, [])
    assert "Build and run a 4-qubit GHZ state" in llm.request.user


@pytest.mark.parametrize("status", [RunStatus.CANCELLED, RunStatus.SUCCEEDED, RunStatus.FAILED])
async def test_a_run_that_is_already_over_is_not_routed(status):
    """Routing is the first thing to touch a run, so it is the first thing that
    can touch one the user already cancelled. Caught by the pipeline e2e suite:
    a cancelled run must leave `run.queued` as its only event, and this was
    appending `run.mode_resolved` to a finished stream — and paying for a model
    call to decide how to run something that will never run."""
    sink = _RecordingSink()
    store = _FakeStore(status)
    llm = _ScriptedLLM()
    ctx = RunContext(
        run_id="cancelled-run",
        task_prompt="Run VQE on H2 at 0.735 angstroms",
        mode=RunMode.AUTO,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )

    result = await handlers._resolve_mode(
        ctx, store, scope=None, session=None, llm=llm, has_source_code=False
    )

    assert result.mode is RunMode.AUTO
    assert sink.events == []
    assert llm.calls == 0


async def test_the_event_payload_is_serialisable_strings():
    decision = ModeDecision(RunMode.AUTO, RunMode.CHAT, "classifier", "greeting")

    assert decision.as_event_payload() == {
        "requested": "auto",
        "resolved": "chat",
        "source": "classifier",
        "reason": "greeting",
    }


class _HangingLLM:
    """Never answers. Stands in for a wedged provider connection."""

    def __init__(self):
        self.calls = 0

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        await asyncio.Event().wait()


async def test_a_router_that_hangs_falls_back_rather_than_holding_the_run_open(monkeypatch):
    """The router is on the path of every auto message, so a hung provider call
    with no deadline of its own would stall every submission the composer makes.

    The `asyncio.wait_for` is the test's own deadline and is load-bearing, not
    belt-and-braces. The failure mode being guarded against is a hang: delete
    the timeout in `intent.py` and, without this wrapper, the test hangs forever
    rather than failing — this suite has no default deadline (pytest-timeout is
    not a dependency), so a hang surfaces as a stuck CI job instead of a red
    test. The wrapper's budget is two orders of magnitude above the patched
    deadline so it can only fire when the deadline is genuinely gone.
    """
    monkeypatch.setattr(intent, "_ROUTE_TIMEOUT_S", 0.05)
    llm = _HangingLLM()

    decision = await asyncio.wait_for(
        resolve_mode("Build a Bell state", RunMode.AUTO, llm), timeout=5
    )

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "fallback"
    assert llm.calls == 1


async def test_a_bare_task_statement_reaches_the_router_rather_than_being_pre_judged():
    """The four prompts a deleted heuristic used to name explicitly.

    Nothing in this module may decide them without asking: they are exactly the
    messages where a keyword rule and a reader disagree. What is asserted here is
    that they are *classified*, not that they classify one way — the verdict is
    the model's, and the prompt's execute clause names this shape.
    """
    for prompt in ["Bell state", "VQE", "QAOAでMaxCut", "run grover"]:
        llm = _ScriptedLLM('{"intent": "execute", "reason": "names a circuit to build"}')

        decision = await resolve_mode(prompt, RunMode.AUTO, llm)

        assert decision.source == "classifier", prompt
        assert llm.calls == 1, prompt
