"""The first real (paid) `ModelAdapter` for the resource-estimation benchmark — every
adapter in `adapters.py` before this one was an offline, zero-cost control (see that
module's docstring and README.md: "A real (future, paid) adapter is out of scope for this
PR"). This is that future adapter, built per the SPEC.md task format: "the smallest honest
runner" — one direct model call per task, asking exactly for the quantities the task pins,
nothing more.

Deliberately NOT routed through Nala's own product pipeline (`handle_run_execute`), unlike
`public_benchmarks`: SPEC.md and README.md both say this benchmark grades a model's direct
answer to a fully-specified numeric question, with "no database, no sandbox, no product
pipeline in the loop" by design (see README.md's "Running it"). So this adapter calls
`majorana_llm.LLMClient.complete` directly with the task's own `prompt` field — the same
production model (`model_for("generate")`) that `public_benchmarks` uses, so both benchmark
runs are priced and served consistently, but with a single free-standing call, not a
five-stage pipeline run.

Structured decoding (`response_schema`) rather than free-text + regex: the schema lists
exactly `task.quantities_pinned` as the JSON keys expected (plus `runtime_unit` when
`runtime_value` is pinned), the same mechanism `majorana_llm` already uses for every other
structured stage call in the product. On the production deepseek-v4-pro profile this maps
to `response_format: json_object` (guarantees syntactically valid JSON, not schema
conformance — see `client.py`'s `decode_params` docstring) with the schema injected into the
system prompt as guidance; a missing or malformed key is handled honestly by
`ModelAnswer.values.get(quantity)` returning `None` (scored as "no answer", per schema.py's
own contract — never coerced to 0, which would be indistinguishable from a large error)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

from majorana_llm import LLMRequest, StageOutputError, extract_json

from majorana_evals.resource_estimation.schema import (
    ModelAnswer,
    QuantityName,
    ResourceEstimationTask,
    RUNTIME_UNIT_SECONDS,
)

if TYPE_CHECKING:
    from majorana_llm import LLMClient

_SYSTEM_PROMPT = (
    "You are a fault-tolerant quantum-computing resource-estimation expert. You will be "
    "given a fully specified algorithm, problem size, and hardware/QEC assumption set, and "
    "asked to estimate specific quantities for that EXACT configuration. Use only the "
    "assumptions stated in the prompt; never invent or substitute an assumption the prompt "
    "does not give. Respond with exactly one JSON object and nothing else — no markdown "
    "fences, no prose before or after it, no chain-of-thought. Every value must be a plain "
    "number (not a string, not a range, not an order-of-magnitude phrase)."
)


def _schema_for(task: ResourceEstimationTask) -> dict:
    properties: dict[str, dict] = {}
    for quantity in task.quantities_pinned:
        properties[quantity] = {
            "type": "number",
            "description": f"Estimated {quantity.replace('_', ' ')} for this exact configuration.",
        }
    required = list(task.quantities_pinned)
    if "runtime_value" in task.quantities_pinned:
        properties["runtime_unit"] = {
            "type": "string",
            "enum": sorted(RUNTIME_UNIT_SECONDS),
            "description": "Unit for runtime_value.",
        }
        required.append("runtime_unit")
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


class LiveModelAdapter:
    """Wraps any real `LLMClient` (e.g. `BudgetGuardedLLM(default_llm(), tracker)`).
    `answer()` is a coroutine — `runner.run_benchmark` awaits it when it is awaitable and
    calls it directly otherwise, so the three existing offline adapters (plain sync
    functions) need no change."""

    def __init__(self, llm: "LLMClient", model: str) -> None:
        self._llm = llm
        self._model = model
        self.name = f"live:{model}"

    async def answer(self, task: ResourceEstimationTask) -> ModelAnswer:
        wanted = ", ".join(task.quantities_pinned)
        user = (
            f"{task.prompt}\n\n"
            f"Respond with a JSON object with exactly these keys: {wanted}"
            + (
                ", runtime_unit (one of seconds/minutes/hours/days/months/years)"
                if "runtime_value" in task.quantities_pinned
                else ""
            )
            + "."
        )
        request = LLMRequest(
            model=self._model,
            system=_SYSTEM_PROMPT,
            user=user,
            response_schema=_schema_for(task),
            schema_name="resource_estimate",
        )
        response = await self._llm.complete(request)
        values, runtime_unit, parse_note = _parse(response.text, task.quantities_pinned)
        raw = response.text if parse_note is None else f"{response.text}\n\n[{parse_note}]"
        return ModelAnswer(task_id=task.task_id, values=values, runtime_unit=runtime_unit, raw=raw)


def _parse(
    text: str, quantities_pinned: list[QuantityName]
) -> tuple[dict[QuantityName, float | None], str | None, str | None]:
    """Never raises: an unparseable or incomplete response scores as "no answer" for
    whichever quantities are missing, exactly like a `ModelAdapter` that answered nothing —
    it must NOT crash the run and must NOT fabricate a 0 or a guessed number."""

    values: dict[QuantityName, float | None] = {}
    try:
        obj = json.loads(extract_json(text))
    except (StageOutputError, json.JSONDecodeError) as exc:
        return {quantity: None for quantity in quantities_pinned}, None, f"parse error: {exc}"

    if not isinstance(obj, dict):
        return {quantity: None for quantity in quantities_pinned}, None, "parsed JSON is not an object"

    note_parts: list[str] = []
    for quantity in quantities_pinned:
        value = obj.get(quantity)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            values[quantity] = float(value)
        else:
            values[quantity] = None
            if quantity in obj:
                note_parts.append(f"{quantity}={value!r} is not a plain number")
    runtime_unit = obj.get("runtime_unit") if "runtime_value" in quantities_pinned else None
    if runtime_unit is not None and not isinstance(runtime_unit, str):
        note_parts.append(f"runtime_unit={runtime_unit!r} is not a string")
        runtime_unit = None
    return values, runtime_unit, ("; ".join(note_parts) if note_parts else None)
