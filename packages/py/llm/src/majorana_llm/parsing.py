"""Helpers to turn LLM text into the structured stage outputs the pipeline needs.
Kept here so the worker's stage handlers stay thin and the parsing is unit-tested."""

from __future__ import annotations

import json
import re

from majorana_contracts.plan import Plan
from pydantic import ValidationError

_FENCE_RE = re.compile(r"```(?:json|python)?\s*(.*?)```", re.DOTALL)
# Greedy to the LAST semicolon: QASM statements end in `;`, so this stops before a
# trailing JSON result line (which has none) even when the two share one stdout.
_QASM_RE = re.compile(r"(OPENQASM\s+2\.0;.*;)", re.DOTALL | re.IGNORECASE)


class StageOutputError(ValueError):
    """The model's output could not be parsed into the expected structured form."""


def _extract_json(text: str) -> str:
    """Return the first JSON object in `text`, tolerating a ```json fence or prose
    around it."""
    for match in _FENCE_RE.finditer(text):
        body = match.group(1).strip()
        if body.startswith("{"):
            return body
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise StageOutputError("no JSON object found in model output")
    return text[start : end + 1]


def parse_plan(text: str) -> Plan:
    """Parse and validate a Plan from the planning stage's output."""
    raw = _extract_json(text)
    try:
        return Plan.model_validate_json(raw)
    except (ValidationError, json.JSONDecodeError) as exc:
        raise StageOutputError(f"planning output is not a valid Plan: {exc}") from exc


def extract_code(text: str) -> str:
    """Pull the Python code block out of the generation stage's output."""
    for match in _FENCE_RE.finditer(text):
        body = match.group(1).strip()
        if body and not body.startswith("{"):
            return body
    if text.strip():
        return text.strip()
    raise StageOutputError("no code found in generation output")


def extract_qasm(text: str) -> str | None:
    """Pull an OpenQASM 2 block out of stdout/text, if present."""
    match = _QASM_RE.search(text)
    return match.group(1).strip() if match else None
