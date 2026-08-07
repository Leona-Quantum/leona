from majorana_llm import (
    CHAT_SYSTEM_PROMPT,
    render_conversation_title_prompt,
    with_response_locale,
)


def test_japanese_overlay_localizes_prose_without_renaming_machine_values():
    prompt = with_response_locale(CHAT_SYSTEM_PROMPT, "ja", surface="chat")

    assert "出力言語: 日本語" in prompt
    assert "自然な日本語" in prompt
    assert "フォローアップ質問" in prompt
    assert "RESULTキー" in prompt
    assert "翻訳・改名せず" in prompt
    assert CHAT_SYSTEM_PROMPT in prompt


def test_english_mode_is_authoritative_even_for_other_language_input():
    prompt = with_response_locale(CHAT_SYSTEM_PROMPT, "en", surface="chat")

    assert "Output language: English" in prompt
    assert "overrides the language used in the request" in prompt
    assert "follow-up questions in English" in prompt


def test_title_prompt_uses_the_explicit_interface_locale():
    rendered = render_conversation_title_prompt("Build a Bell state", "ja")

    assert "タイトルは自然で簡潔な日本語" in rendered.system
    assert rendered.user.endswith("Build a Bell state")
