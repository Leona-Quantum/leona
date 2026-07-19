"""Helpers to turn LLM text into the structured stage outputs the pipeline needs.
Kept here so the worker's stage handlers stay thin and the parsing is unit-tested."""

from __future__ import annotations

import json
import re

from majorana_contracts.plan import Plan
from majorana_llm.models import AnalysisOutput
from pydantic import ValidationError

_FENCE_RE = re.compile(r"```(?:json|python)?\s*(.*?)```", re.DOTALL)


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
        payload = json.loads(raw)
        # DeepSeek's json_object mode has occasionally emitted the optional
        # list-valued notes field as one string. Preserve the note while restoring
        # the contract shape before validation; no semantic plan field is inferred.
        success_criteria = payload.get("success_criteria") if isinstance(payload, dict) else None
        if isinstance(success_criteria, dict) and isinstance(
            success_criteria.get("additional_notes"), str
        ):
            payload = dict(payload)
            payload["success_criteria"] = {
                **success_criteria,
                "additional_notes": [success_criteria["additional_notes"]],
            }
        # Retired verification methods and baseline_plan are normalized away by the
        # Plan contract itself rather than rejected here. Rejecting them was the
        # single largest source of permanently-failed runs, and nothing downstream
        # ever read either one. See majorana_contracts.plan.
        return Plan.model_validate(payload)
    except StageOutputError:
        raise
    except (ValidationError, json.JSONDecodeError, TypeError) as exc:
        raise StageOutputError(f"planning output is not a valid Plan: {exc}") from exc


def parse_analysis(text: str) -> AnalysisOutput:
    """Parse the internal analysis record without exposing its JSON framing."""
    raw = _extract_json(text)
    try:
        return AnalysisOutput.model_validate(json.loads(raw))
    except (ValidationError, json.JSONDecodeError, TypeError) as exc:
        raise StageOutputError(f"analysis output is not valid narrative data: {exc}") from exc


def extract_code(text: str) -> str:
    """Pull the Python code block out of the generation stage's output."""
    for match in _FENCE_RE.finditer(text):
        body = match.group(1).strip()
        if body and not body.startswith("{"):
            return body
    if text.strip():
        return text.strip()
    # Machine-safe metadata only: this message flows into durable run events, so it
    # must never carry raw model output. Length + blankness still make an empty or
    # truncated completion diagnosable.
    raise StageOutputError(
        f"no code found in generation output (len={len(text)}, blank={not text.strip()})"
    )
