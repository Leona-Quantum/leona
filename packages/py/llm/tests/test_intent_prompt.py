from majorana_llm.prompts import INTENT_ROUTER_SYSTEM_PROMPT, render_intent_prompt


def test_intent_router_treats_chat_and_execute_equally():
    assert "Treat both outcomes equally" in INTENT_ROUTER_SYSTEM_PROMPT
    assert "do not prefer execution or chat" in INTENT_ROUTER_SYSTEM_PROMPT
    assert "Examples that MUST execute" not in INTENT_ROUTER_SYSTEM_PROMPT


def test_intent_router_keeps_explicit_explanatory_requests_in_chat():
    rendered = render_intent_prompt("Bell状態とは？")

    assert rendered.system == INTENT_ROUTER_SYSTEM_PROMPT
    assert rendered.user == "User message:\nBell状態とは？"
