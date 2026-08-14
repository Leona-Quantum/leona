"""Compose output-language policy onto user-facing LLM stages.

The pipeline's safety, execution, and verification rules stay in one canonical
prompt.  Locale overlays are deliberately small: duplicating every system
prompt in English and Japanese would let the two execution policies drift.
"""

from __future__ import annotations

from typing import Literal


ResponseLocale = Literal["en", "ja"]
PromptSurface = Literal["chat", "plan", "review", "alignment", "title", "analysis"]


def normalize_response_locale(value: object) -> ResponseLocale:
    """Fail closed to the established English behavior for unknown callers."""

    return "ja" if value == "ja" else "en"


_SURFACE_FIELDS: dict[PromptSurface, dict[ResponseLocale, str]] = {
    "chat": {
        "en": "Write the entire natural-language answer and follow-up questions in English.",
        "ja": "自然言語の回答全体とフォローアップ質問を、読みやすく自然な日本語で書いてください。",
    },
    "plan": {
        "en": (
            "Write user-facing schema values such as problem_summary, "
            "algorithm_rationale, and additional_notes in English."
        ),
        "ja": (
            "problem_summary、algorithm_rationale、additional_notes など、利用者に"
            "表示されるスキーマ値は自然な日本語で書いてください。"
        ),
    },
    "review": {
        "en": (
            "Write user-facing review values such as summary, mismatches, suggestions, "
            "repair_instructions, residual_risks, and suggested_follow_ups in English."
        ),
        "ja": (
            "summary、mismatches、suggestions、repair_instructions、residual_risks、"
            "suggested_follow_ups など、"
            "利用者に表示されるレビュー文は自然な日本語で書いてください。"
        ),
    },
    "alignment": {
        "en": ("Write authoritative_task_summary, missing_inputs, and mismatches in English."),
        "ja": (
            "authoritative_task_summary、missing_inputs、mismatches は自然な日本語で"
            "書いてください。"
        ),
    },
    "title": {
        "en": "Write the title in English.",
        "ja": "タイトルは自然で簡潔な日本語にしてください。",
    },
    "analysis": {
        "en": "Write the entire final explanation in natural English.",
        "ja": "最終解説の全文を、読みやすく自然な日本語で書いてください。",
    },
}


_PRESERVE_TECHNICAL = {
    "en": (
        "Preserve JSON property names, enum values, code, identifiers, RESULT keys, "
        "formulas, framework/API names, and user-supplied symbols exactly; do not "
        "translate or rename them. The selected output language overrides the language "
        "used in the request or conversation history."
    ),
    "ja": (
        "JSONのプロパティ名、enum値、コード、識別子、RESULTキー、数式、"
        "フレームワーク/API名、利用者が指定した記号は翻訳・改名せず、そのまま保持して"
        "ください。依頼文や会話履歴の言語より、この出力言語設定を優先してください。"
    ),
}


def with_response_locale(
    system: str,
    response_locale: ResponseLocale,
    *,
    surface: PromptSurface,
) -> str:
    """Append one bounded locale overlay to a user-facing system prompt."""

    locale = normalize_response_locale(response_locale)
    heading = "Output language: English" if locale == "en" else "出力言語: 日本語"
    return (
        f"{system}\n\n{heading}\n{_SURFACE_FIELDS[surface][locale]}\n{_PRESERVE_TECHNICAL[locale]}"
    )
