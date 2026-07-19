"""Intent routing: which mode a run actually dispatches in.

The bug this guards against is asymmetric, and so are these tests. Sending a real
task to chat costs the user one extra turn. Sending "hi" to execute spends the
whole candidate budget on an unimplementable plan and reports a failed run — that
is the failure worth being paranoid about, so chat is the safe direction and
every uncertain path must land there.
"""

import pytest
from majorana_contracts.enums import RunMode
from majorana_llm import LLMResponse
from majorana_worker.intent import ModeDecision, heuristic_decision, resolve_mode


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
async def test_pleasantries_route_to_chat_without_spending_a_model_call(prompt):
    llm = _ScriptedLLM()

    decision = await resolve_mode(prompt, RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "heuristic"
    assert llm.calls == 0


async def test_a_greeting_sent_as_execute_is_still_downgraded():
    """The owner's requirement: a stray message must not break the run whatever
    mode it arrives in. An explicit execute does not make "hi" implementable."""
    llm = _ScriptedLLM()

    decision = await resolve_mode("hi", RunMode.EXECUTE, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.changed


async def test_a_greeting_with_a_task_attached_is_not_a_greeting():
    llm = _ScriptedLLM()

    decision = await resolve_mode(
        "hi, build a GHZ state on 4 qubits and measure it", RunMode.AUTO, llm
    )

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "classifier"
    assert llm.calls == 1


async def test_the_heuristic_never_routes_towards_execute():
    """It may only shortcut to chat. Deciding to spend the pipeline on keyword
    evidence is exactly the cheap-plausible-story failure this system keeps
    hitting — 'explain Grover's algorithm' names an algorithm and is not a task."""
    for prompt in ["run grover", "qaoa maxcut", "hi", "", "vqe"]:
        decision = heuristic_decision(prompt, RunMode.AUTO)
        assert decision is None or decision.resolved is RunMode.CHAT


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
async def test_an_unreadable_verdict_falls_back_instead_of_guessing(text):
    """Including 'ideate': the router may only produce chat or execute, so a
    verdict naming a mode outside that set is unusable, not a third answer."""
    llm = _ScriptedLLM(text)

    decision = await resolve_mode("Some ambiguous request about circuits", RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "fallback"


async def test_a_provider_outage_does_not_fail_the_run():
    llm = _BrokenLLM()

    decision = await resolve_mode("Some ambiguous request about circuits", RunMode.AUTO, llm)

    assert decision.resolved is RunMode.CHAT
    assert decision.source == "fallback"


async def test_an_explicit_execute_survives_the_router_failing():
    """The fallback direction flips here on purpose. Chat is the safe default for
    an *undecided* run, but silently downgrading a stated execute because our own
    classifier fell over would substitute our failure for the user's intent."""
    llm = _BrokenLLM()

    decision = await resolve_mode("Run VQE on H2 at 0.735 angstroms", RunMode.EXECUTE, llm)

    assert decision.resolved is RunMode.EXECUTE
    assert not decision.changed


async def test_studio_runs_carrying_source_code_are_never_reclassified():
    llm = _ScriptedLLM('{"intent": "chat", "reason": "looks conversational"}')

    decision = await resolve_mode(
        "Please simulate the edited quantum circuit", RunMode.EXECUTE, llm, has_source_code=True
    )

    assert decision.resolved is RunMode.EXECUTE
    assert decision.source == "passthrough"
    assert llm.calls == 0


@pytest.mark.parametrize("mode", [RunMode.IDEATE, RunMode.EXPLAIN])
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


async def test_the_event_payload_is_serialisable_strings():
    decision = ModeDecision(RunMode.AUTO, RunMode.CHAT, "heuristic", "greeting")

    assert decision.as_event_payload() == {
        "requested": "auto",
        "resolved": "chat",
        "source": "heuristic",
        "reason": "greeting",
    }
