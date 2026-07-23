from majorana_llm.prompts import INTENT_ROUTER_SYSTEM_PROMPT, render_intent_prompt


def test_intent_router_infers_execution_without_an_explicit_run_verb():
    assert '"2量子ビットのBell状態"' in INTENT_ROUTER_SYSTEM_PROMPT
    assert '"QAOAで3ノードMaxCut"' in INTENT_ROUTER_SYSTEM_PROMPT
    assert '"H2のVQE"' in INTENT_ROUTER_SYSTEM_PROMPT
    assert 'prefer\n"execute"' in INTENT_ROUTER_SYSTEM_PROMPT


def test_intent_router_keeps_explicit_explanatory_requests_in_chat():
    rendered = render_intent_prompt("Bell状態とは？")

    assert rendered.system == INTENT_ROUTER_SYSTEM_PROMPT
    assert rendered.user == "User message:\nBell状態とは？"
