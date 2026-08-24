"""Bounded extraction for structured LLM stage outputs."""

from __future__ import annotations

import json
import re

_FENCE_RE = re.compile(r"```(?:json|python)?\s*(.*?)```", re.DOTALL)


class StageOutputError(ValueError):
    """The model's output could not be parsed into the expected structured form."""


def extract_json(text: str) -> str:
    """Return the first JSON object in `text`, tolerating a ```json fence or prose
    around it. Public because every stage that asks for structured output needs the
    same salvage; the critic failed runs for want of it."""
    decoder = json.JSONDecoder()
    candidates = [match.group(1).strip() for match in _FENCE_RE.finditer(text)]
    candidates.append(text)
    for candidate in candidates:
        for match in re.finditer(r"\{", candidate):
            start = match.start()
            try:
                value, end = decoder.raw_decode(candidate, start)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict):
                return candidate[start:end]
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        # Machine-safe metadata only — this flows into durable run events, so it must
        # never carry raw model output.
        raise StageOutputError(
            f"no JSON object found in model output (len={len(text)}, "
            f"blank={not text.strip()}, unclosed_brace={start != -1 and end <= start})"
        )
    raise StageOutputError(
        f"no complete JSON object found in model output (len={len(text)}, blank=False, "
        "unclosed_brace=False)"
    )
