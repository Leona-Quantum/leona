"""Request context shared by direct chat and the circuit agent assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from majorana_contracts.enums import Framework, RunMode
from majorana_llm import ResponseLocale


class EventSink(Protocol):
    async def emit(
        self, type: str, payload: dict[str, Any], *, event_id: Any | None = None
    ) -> None: ...


@dataclass(frozen=True)
class RunContext:
    run_id: Any
    task_prompt: str
    mode: RunMode
    framework: Framework
    seed: int | None
    shots: int | None
    timeout_s: int | None
    sink: EventSink
    response_locale: ResponseLocale = "en"
    allow_ai_assumptions: bool = False
    needs_user_inputs: bool = False
    conversation_id: Any | None = None
    source_code: str | None = None
    source_framework: Framework | None = None
    parent_artifact_id: Any | None = None
    #: Short model-written name for this conversation, settled before dispatch.
    #: None on a later turn, which already has one, or when naming failed.
    conversation_title: str | None = None
