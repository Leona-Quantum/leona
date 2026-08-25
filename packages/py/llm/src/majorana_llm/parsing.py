"""Bounded extraction for structured LLM stage outputs."""

from __future__ import annotations

import json
import re

_FENCE_RE = re.compile(r"```(?:json|python)?\s*(.*?)```", re.DOTALL)


# How many `{` positions this will try before giving up on a candidate.
#
# Without a cap this scan is quadratic, and reachably so. `raw_decode` fails only
# after reading to the end of the text, so a JSON-shaped string that never closes
# — `'{"a":1,' * n` — costs one near-full scan per brace. Measured on this
# machine, doubling the input quadrupled the time:
#
#     87,500 chars   0.36s
#    175,000 chars   1.43s
#    350,000 chars   5.57s
#    700,000 chars  22.26s      single-threaded, synchronous, no timeout
#
# It is reachable because the caller feeds this the model's full untruncated
# response, and the one generation attempt that is not a targeted repair sends
# `max_tokens=None` — which this package deliberately omits from the request on
# OpenAI-compatible providers (see `LLMRequest.max_tokens`), so the response size
# is the provider's ceiling rather than ours. The worker runs this on the same
# event loop as its lease heartbeat and its liveness endpoint, so a stall there
# is not just a slow job: the lease can expire and the job be reclaimed while
# this instance is still crunching.
#
# A cap fixes the complexity without truncating anything — the work is now
# bounded at a constant number of scans, i.e. linear in the input, and no
# legitimate response is affected. Salvage exists for a model that wraps its
# object in prose or trails commentary after it; the object is at one of the
# first few braces in every real shape. Sixty-four is far past that and still
# costs milliseconds at the sizes above.
_MAX_DECODE_ATTEMPTS = 64


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
        attempts = 0
        for match in re.finditer(r"\{", candidate):
            if attempts >= _MAX_DECODE_ATTEMPTS:
                break
            attempts += 1
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
