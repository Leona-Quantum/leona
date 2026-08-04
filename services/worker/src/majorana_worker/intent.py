"""Decide which mode a run should actually execute in.

Every submission from the chat composer used to be sent as `mode: "execute"`, so
"hi" entered plan → generate → sandbox → verify and came back to the user as a
failed run. The execute pipeline has no graceful answer for a message that is not
a task: it exhausts its candidate budget trying to implement one.

This module is the gate in front of that. It resolves a requested mode to the
mode the run really dispatches in:

1. an explicit non-auto mode the router has no business overriding (`chat`,
   `execute`, `ideate`, or `explain`) passes straight through;
2. every auto-mode message receives one short classification on the route model.

Every path returns a `ModeDecision` carrying why, which the worker emits as
`run.mode_resolved` so the choice is visible in the event stream rather than
being an invisible behaviour change.

The router treats chat and execution symmetrically. It infers the user's likely
intent from the current message rather than applying keyword lists or a
product-level preference for one mode. If the router is unavailable, the run
falls back to chat so an uncertain classification cannot start a costly execution.
"""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Mapping
from typing import Literal

from majorana_contracts.enums import RunMode
from majorana_llm import (
    LLMClient,
    LLMRequest,
    conversation_request_messages,
    model_for,
    render_intent_prompt,
)

log = logging.getLogger(__name__)

DecisionSource = Literal["passthrough", "classifier", "fallback"]

# Modes the router is allowed to produce. ideate/explain are deliberate user
# selections, never inferred: nothing in a bare message distinguishes "explain
# this to me" from "answer this" reliably enough to route on.
_ROUTABLE = {RunMode.CHAT, RunMode.EXECUTE}

# Matches the conversation-naming deadline in handlers.py. Long enough that a
# healthy provider is never cut off, short enough that a wedged one costs the
# user seconds rather than the whole request.
_ROUTE_TIMEOUT_S = 8.0


@dataclass(frozen=True)
class ModeDecision:
    """The mode a run will dispatch in, and the evidence for it."""

    requested: RunMode
    resolved: RunMode
    source: DecisionSource
    reason: str

    @property
    def changed(self) -> bool:
        return self.resolved is not self.requested

    def as_event_payload(self) -> dict[str, str]:
        return {
            "requested": str(self.requested),
            "resolved": str(self.resolved),
            "source": self.source,
            "reason": self.reason,
        }


def _parse_verdict(text: str) -> tuple[RunMode, str] | None:
    """Read the classifier's JSON verdict, or None if it did not produce one."""
    candidate = text.strip()
    if candidate.startswith("```"):
        candidate = candidate.strip("`")
        candidate = candidate.split("\n", 1)[-1] if "\n" in candidate else candidate
    start, end = candidate.find("{"), candidate.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        payload = json.loads(candidate[start : end + 1])
    except (ValueError, TypeError):
        return None
    if not isinstance(payload, dict):
        return None
    raw = str(payload.get("intent", "")).strip().lower()
    if raw not in {mode.value for mode in _ROUTABLE}:
        return None
    reason = str(payload.get("reason") or "").strip()
    return RunMode(raw), reason[:200]


async def resolve_mode(
    prompt: str,
    requested: RunMode,
    llm: LLMClient,
    *,
    has_source_code: bool = False,
    conversation_messages: Sequence[Mapping[str, str]] = (),
) -> ModeDecision:
    """Resolve `requested` to the mode this run will actually dispatch in."""
    if has_source_code:
        # Studio ran this: the user pressed Simulate or Verify on code they are
        # looking at. There is no intent left to infer.
        return ModeDecision(requested, requested, "passthrough", "run carries source code")
    if requested is not RunMode.AUTO:
        return ModeDecision(requested, requested, "passthrough", "mode explicitly selected")

    rendered = render_intent_prompt(prompt)
    # Routing decides whether USER-SUPPLIED task data is complete. Assistant prose
    # can explain or propose a formulation, but it cannot fill an omitted instance
    # or turn that proposal into authorization to execute. Enforce the prompt's
    # trust boundary structurally instead of relying on the classifier to ignore a
    # confident assistant message.
    authoritative_history = [
        message for message in conversation_messages if message.get("role") == "user"
    ]
    messages = conversation_request_messages(authoritative_history, rendered.user)
    try:
        # Bounded on purpose. This call is now on the path of every auto message
        # — which is every message the composer sends by default — and it is the
        # only model call before dispatch that had no deadline of its own. The
        # route model is the same heavyweight model as generate, and the adjacent
        # conversation-naming call, which is decoration rather than a gate, has
        # been bounded at 8s since it shipped. A router that hangs must degrade
        # to the fallback below, not hold the run open.
        async with asyncio.timeout(_ROUTE_TIMEOUT_S):
            response = await llm.complete(
                LLMRequest(
                    model=model_for("route"),
                    system=rendered.system,
                    user=rendered.user,
                    messages=messages,
                    temperature=0.0,
                )
            )
    except Exception:  # noqa: BLE001 - routing must never be what fails a run
        log.exception("intent router provider call failed")
        return ModeDecision(
            requested, RunMode.CHAT, "fallback", "router unavailable; chat fallback"
        )

    verdict = _parse_verdict(response.text or "")
    if verdict is None:
        log.warning("intent router returned an unusable verdict: %r", (response.text or "")[:200])
        return ModeDecision(
            requested, RunMode.CHAT, "fallback", "router verdict unreadable; chat fallback"
        )

    resolved, reason = verdict
    return ModeDecision(requested, resolved, "classifier", reason or "classified from the message")
