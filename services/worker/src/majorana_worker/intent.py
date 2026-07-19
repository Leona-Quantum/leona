"""Decide which mode a run should actually execute in.

Every submission from the chat composer used to be sent as `mode: "execute"`, so
"hi" entered plan → generate → sandbox → verify and came back to the user as a
failed run. The execute pipeline has no graceful answer for a message that is not
a task: it exhausts its candidate budget trying to implement one.

This module is the gate in front of that. It resolves a requested mode to the
mode the run really dispatches in, using the cheapest sufficient evidence:

1. an explicit non-auto mode the router has no business overriding (`ideate`,
   `explain`, or a studio run carrying source code) passes straight through;
2. a message that is obviously not a task — a greeting, an acknowledgement, a
   couple of words with nothing to implement — resolves without an LLM call;
3. anything else costs one short classification on the cheap model tier.

Every path returns a `ModeDecision` carrying why, which the worker emits as
`run.mode_resolved` so the choice is visible in the event stream rather than
being an invisible behaviour change.

The safe direction is chat. Answering a real task in chat costs the user one more
turn to say "run it"; running a non-task costs a full pipeline and shows a
failure. So every ambiguity, parse error, and provider outage lands on chat —
except when the caller explicitly asked for execute, which is a stated intent the
router will not overrule on the strength of its own failure.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.enums import RunMode
from majorana_llm import LLMClient, LLMRequest, model_for, render_intent_prompt

log = logging.getLogger(__name__)

DecisionSource = Literal["passthrough", "heuristic", "classifier", "fallback"]

# One short JSON verdict. Generous enough for a reasoning-tier model to think
# briefly, small enough that routing never becomes a latency cost of its own.
_ROUTER_MAX_TOKENS = 512

# Modes the router is allowed to produce. ideate/explain are deliberate user
# selections, never inferred: nothing in a bare message distinguishes "explain
# this to me" from "answer this" reliably enough to route on.
_ROUTABLE = {RunMode.CHAT, RunMode.EXECUTE}

# Messages that are complete in themselves and ask for no work. Matched whole, so
# "hi" routes to chat while "hi, build me a GHZ state on 4 qubits" does not.
_PLEASANTRIES = frozenset(
    {
        "hi",
        "hii",
        "hey",
        "yo",
        "hello",
        "helo",
        "hiya",
        "sup",
        "good morning",
        "good afternoon",
        "good evening",
        "howdy",
        "greetings",
        "thanks",
        "thank you",
        "thx",
        "ty",
        "cheers",
        "ok",
        "okay",
        "k",
        "cool",
        "nice",
        "great",
        "got it",
        "sure",
        "yes",
        "yeah",
        "yep",
        "no",
        "nope",
        "bye",
        "goodbye",
        "test",
        "testing",
        "ping",
        "you there",
        "are you there",
        "who are you",
        "what are you",
        "what is this",
        "what can you do",
        "help",
        "?",
    }
)

# A word long enough to be a term rather than a filler particle. Used only to ask
# "does this message contain enough to be a task at all", never to judge content.
_WORD = re.compile(r"[A-Za-z0-9_+\-]{2,}")


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


def _normalize(prompt: str) -> str:
    """Lowercase, collapse whitespace, drop trailing punctuation.

    Terminal punctuation is stripped so "hello!" and "what can you do?" match the
    same entries as their bare forms. A message that is nothing but punctuation
    normalizes to empty, which is itself a chat answer.
    """
    return " ".join(prompt.lower().split()).strip(" .!,?")


def heuristic_decision(prompt: str, requested: RunMode) -> ModeDecision | None:
    """Resolve the cases that need no model, or None to ask the classifier.

    Only ever routes *towards* chat. A heuristic confident enough to commit a run
    to the execute pipeline on keyword evidence would be exactly the kind of
    cheap plausible story that keeps being wrong here — "explain Grover's
    algorithm" mentions an algorithm and is not a task.
    """
    normalized = _normalize(prompt)
    if not normalized:
        return ModeDecision(requested, RunMode.CHAT, "heuristic", "empty message")
    if normalized in _PLEASANTRIES:
        return ModeDecision(requested, RunMode.CHAT, "heuristic", "greeting or acknowledgement")
    words = _WORD.findall(normalized)
    if len(words) < 3:
        # Too little to implement, whatever it says. A real task names at least a
        # method and an instance; three words cannot carry both.
        return ModeDecision(requested, RunMode.CHAT, "heuristic", "too short to be a task")
    return None


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
) -> ModeDecision:
    """Resolve `requested` to the mode this run will actually dispatch in."""
    if has_source_code:
        # Studio ran this: the user pressed Simulate or Verify on code they are
        # looking at. There is no intent left to infer.
        return ModeDecision(requested, requested, "passthrough", "run carries source code")
    if requested not in _ROUTABLE | {RunMode.AUTO}:
        return ModeDecision(requested, requested, "passthrough", "mode explicitly selected")

    heuristic = heuristic_decision(prompt, requested)
    if heuristic is not None:
        return heuristic

    fallback = RunMode.EXECUTE if requested is RunMode.EXECUTE else RunMode.CHAT
    rendered = render_intent_prompt(prompt)
    try:
        response = await llm.complete(
            LLMRequest(
                model=model_for("route"),
                system=rendered.system,
                user=rendered.user,
                max_tokens=_ROUTER_MAX_TOKENS,
                temperature=0.0,
            )
        )
    except Exception:  # noqa: BLE001 - routing must never be what fails a run
        log.exception("intent router provider call failed")
        return ModeDecision(requested, fallback, "fallback", "router unavailable")

    verdict = _parse_verdict(response.text or "")
    if verdict is None:
        log.warning("intent router returned an unusable verdict: %r", (response.text or "")[:200])
        return ModeDecision(requested, fallback, "fallback", "router verdict unreadable")

    resolved, reason = verdict
    return ModeDecision(requested, resolved, "classifier", reason or "classified from the message")
