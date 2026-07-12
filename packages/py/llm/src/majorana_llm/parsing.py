"""Helpers to turn LLM text into the structured stage outputs the pipeline needs.
Kept here so the worker's stage handlers stay thin and the parsing is unit-tested."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Literal

from majorana_contracts.plan import Plan
from pydantic import ValidationError

_FENCE_RE = re.compile(r"```(?:json|python)?\s*(.*?)```", re.DOTALL)
# Greedy to the LAST semicolon: QASM statements end in `;`, so this stops before a
# trailing JSON result line (which has none) even when the two share one stdout.
_QASM_RE = re.compile(r"(OPENQASM\s+2\.0;.*;)", re.DOTALL | re.IGNORECASE)

# A Majorana-owned sandbox epilogue wraps its serialization in these line markers.
# They make the execution-produced circuit unambiguous when model code also prints a
# QASM block (or embeds one inside a JSON result).  Keep these strings stable: they
# are a small cross-package execution protocol, not presentation text.
FINAL_QASM_BEGIN = "__MAJORANA_FINAL_QASM_BEGIN__"
FINAL_QASM_END = "__MAJORANA_FINAL_QASM_END__"
FINAL_QASM_ERROR = "__MAJORANA_FINAL_QASM_ERROR__"
_FINAL_QASM_RE = re.compile(
    rf"^{re.escape(FINAL_QASM_BEGIN)}\r?$\n(?P<qasm>.*?)"
    rf"^{re.escape(FINAL_QASM_END)}\r?$",
    re.DOTALL | re.MULTILINE,
)
_FINAL_QASM_ERROR_RE = re.compile(
    rf"^{re.escape(FINAL_QASM_ERROR)}:(?P<error>[A-Za-z_][A-Za-z0-9_]*)\s*$",
    re.MULTILINE,
)


class StageOutputError(ValueError):
    """The model's output could not be parsed into the expected structured form."""


@dataclass(frozen=True)
class QasmExtraction:
    """A recovered QASM payload and the evidence source that produced it."""

    qasm: str | None
    source: Literal["sandbox_epilogue", "model_stdout", "missing"]
    epilogue_error: str | None = None


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
        return Plan.model_validate(payload)
    except (ValidationError, json.JSONDecodeError, TypeError) as exc:
        raise StageOutputError(f"planning output is not a valid Plan: {exc}") from exc


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


def extract_qasm(text: str) -> str | None:
    """Pull an OpenQASM 2 block out of stdout/text, if present.

    Compatibility wrapper for callers that only need the text. New execution paths
    should use :func:`extract_qasm_with_provenance` so their evidence records do not
    blur deterministic serialization with model-provided stdout.
    """
    return extract_qasm_with_provenance(text).qasm


def extract_qasm_with_provenance(text: str) -> QasmExtraction:
    """Recover QASM with deterministic sandbox output taking precedence.

    A model-emitted block remains a compatibility fallback for frameworks without an
    owned serializer and for older runs. It must never override the wrapper's observed
    ``FINAL_CIRCUIT`` serialization.
    """
    errors = _FINAL_QASM_ERROR_RE.findall(text)
    epilogue_error = errors[-1] if errors else None
    envelopes = list(_FINAL_QASM_RE.finditer(text))
    if envelopes:
        qasm = envelopes[-1].group("qasm").strip()
        if qasm:
            return QasmExtraction(qasm, "sandbox_epilogue", epilogue_error)

    match = _QASM_RE.search(text)
    if match:
        return QasmExtraction(match.group(1).strip(), "model_stdout", epilogue_error)
    return QasmExtraction(None, "missing", epilogue_error)
