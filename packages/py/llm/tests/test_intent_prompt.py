"""Guards on the router prompt.

These are string-presence assertions and it is worth being honest about that:
they carry no behavioural signal and cannot fail unless someone edits the
prompt. That is the point. Each clause below was deleted once, by a change whose
stated purpose was removing a hard-coded keyword list — and deleting the list is
right, while deleting the *concept* it stood for is not. The real behaviour is
the model's, and testing it belongs in an intent eval corpus rather than here.
"""

from majorana_llm.prompts import INTENT_ROUTER_SYSTEM_PROMPT, render_intent_prompt


def test_intent_router_treats_chat_and_execute_equally():
    assert "Treat both outcomes equally" in INTENT_ROUTER_SYSTEM_PROMPT
    assert "do not prefer execution or chat" in INTENT_ROUTER_SYSTEM_PROMPT
    assert "Examples that MUST execute" not in INTENT_ROUTER_SYSTEM_PROMPT


def test_intent_router_still_names_greetings_as_chat():
    """A misrouted "thanks" spends one of a free account's five weekly runs.

    The deterministic short-circuit that made that structurally impossible is
    gone; with only the classifier left, the taxonomy has to describe greetings.
    The neutral definition of chat — "asking for information, explanation,
    discussion, advice" — does not describe "ok" or "ありがとう".
    """
    lowered = " ".join(INTENT_ROUTER_SYSTEM_PROMPT.lower().split())
    assert "greeting" in lowered
    assert "acknowledgement" in lowered or "acknowledgment" in lowered
    assert "allowance" in lowered, "the prompt should say what a misroute costs"


def test_intent_router_still_names_the_bare_task_statement():
    """The shape the deleted heuristic listed by name, and the one a neutral
    prompt is most likely to get wrong: a noun phrase with no question on it."""
    assert "bare noun phrase" in INTENT_ROUTER_SYSTEM_PROMPT
    # At least one non-ASCII example, because the product ships a Japanese locale
    # and every Japanese example was removed alongside the keyword list.
    assert any(ord(character) > 0x2000 for character in INTENT_ROUTER_SYSTEM_PROMPT), (
        "the prompt carries no Japanese example"
    )


def test_intent_router_requires_data_and_capability_readiness_without_keyword_rules():
    """Execution must be possible as stated, not merely phrased as an action.

    This pins the general decision boundary rather than any one benchmark prompt:
    missing instance data and known runtime limits both need a conversational answer,
    while canonical circuits and harmless execution defaults stay executable.
    """
    lowered = " ".join(INTENT_ROUTER_SYSTEM_PROMPT.lower().split())

    assert "input readiness" in lowered
    assert "capability readiness" in lowered
    assert "do not guess an omitted problem instance" in lowered
    assert "25 qubits the executable circuit/simulation maximum" in lowered
    assert "26- or 27-qubit circuit is rejected before a sandbox is created" in lowered
    assert "package list is exhaustive" in lowered
    assert "never silently shrink" in lowered
    assert "shot count or random seed" in lowered
    assert "canonical circuit" in lowered


def test_render_intent_prompt_passes_the_message_through_unchanged():
    rendered = render_intent_prompt("Bell状態とは？")

    assert rendered.system == INTENT_ROUTER_SYSTEM_PROMPT
    assert rendered.user == "User message:\nBell状態とは？"
