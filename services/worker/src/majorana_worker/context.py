"""Request context shared by direct chat and the circuit agent assembly."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal, Protocol

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
    # "verify" reproduces every run's behavior from before this field existed:
    # `source_code`, when present, is returned byte-for-byte by the first
    # generation attempt. "revise" is the explicit, opt-in signal that
    # `source_code` is a starting point to change per `task_prompt` rather
    # than a program to preserve unchanged — see `ProductionSimplePipelinePorts`
    # in `simple_ports.py`. A job payload persisted before this field existed
    # has no key for it; `handle_run_execute` reads it with `.get(..., "verify")`
    # so an old, replayed payload deserializes to today's only behavior.
    source_intent: Literal["verify", "revise"] = "verify"
    source_framework: Framework | None = None
    parent_artifact_id: Any | None = None
    #: The web app's Atlas workflow planner's cited output for this task, when
    #: the web supplied one on `POST /v1/runs` — see `WorkflowContext` in
    #: `majorana_api.routes.runs`. Read-only context for the planner
    #: (`ProductionSimplePipelinePorts.plan`), never instructions and never a
    #: verified claim. A job payload persisted before this field existed has
    #: no key for it; `handle_run_execute` reads it with `.get(...)` so an old,
    #: replayed payload deserializes to `None`, today's only behavior for a
    #: run that never carried one.
    workflow_context: dict[str, Any] | None = None
    #: Short model-written name for this conversation, settled before dispatch.
    #: None on a later turn, which already has one, or when naming failed.
    conversation_title: str | None = None
