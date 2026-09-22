"""`ModelAdapter` implementations. This increment ships ONLY offline, zero-cost adapters —
no adapter here calls a network or a paid model API of any kind (see the PR this ships in:
"spend nothing" was a hard constraint). A real adapter (wrapping an actual LLM call) is future
work for whoever runs this benchmark against a model; `runner.py` takes any object satisfying
`ModelAdapter` so adding one later needs no change here.

The three adapters below ARE the zero-spend controls the spec requires:

- `ReferenceAdapter` — positive control. Echoes the task's own reference values verbatim.
  Every quantity's log-relative error is exactly 0, so this MUST score 100% on every case;
  if it doesn't, the grader (or this adapter) is broken, not the benchmark.
- `PerturbedAdapter` — negative control. Every pinned quantity times a fixed factor (10x by
  default). Because `ResourceEstimationTask` enforces `tolerance_log10 < 1` for every
  quantity in every case (schema.py), a 10x perturbation (log10 error exactly 1.0) is
  GUARANTEED to exceed the band and score exactly 0 on every quantity, in every case, by
  construction — not because this factor happens to be large enough for today's cases.
- `ConstantGuessAdapter` — baseline control. The same fixed numbers regardless of task,
  chosen independent of any case in this corpus (a generic "medium-scale" resource estimate).
  The corpus spans values from hundreds to 10^11+, so a fixed guess should score near zero
  on average, without being tuned to guarantee it for every individual case."""

from __future__ import annotations

from typing import Protocol

from majorana_evals.resource_estimation.schema import (
    ModelAnswer,
    QuantityName,
    ResourceEstimationTask,
)


class ModelAdapter(Protocol):
    """Anything `runner.run_benchmark` can drive: a name for the report, and a way to answer
    one task. A real (future, paid) adapter implements this by calling an LLM and parsing its
    completion into a `ModelAnswer` — nothing else about the harness needs to change."""

    name: str

    def answer(self, task: ResourceEstimationTask) -> ModelAnswer: ...


class ReferenceAdapter:
    """Positive control: the trivial "cheating" adapter that already knows the answer key.
    Exists to prove the grader accepts a correct answer, not to measure anything about a
    model."""

    name = "reference"

    def answer(self, task: ResourceEstimationTask) -> ModelAnswer:
        values: dict[QuantityName, float | None] = dict(task.reference)
        return ModelAnswer(
            task_id=task.task_id,
            values=values,
            runtime_unit=task.units.get("runtime_value"),
            raw="stub: echoes the task's own reference values verbatim",
        )


class PerturbedAdapter:
    """Negative control: every pinned quantity multiplied by `factor` (default 10x, matching
    the brief's "perturbing each by 10x scores 0"). The unit for runtime_value is left
    unchanged (only the value is perturbed), so the perturbation is a pure numeric error, not
    a disguised unit-confusion bug."""

    def __init__(self, factor: float = 10.0) -> None:
        if factor <= 1.0:
            raise ValueError(f"factor={factor} must be > 1 to be a meaningful negative control")
        self.factor = factor
        self.name = f"perturbed-{factor:g}x"

    def answer(self, task: ResourceEstimationTask) -> ModelAnswer:
        values: dict[QuantityName, float | None] = {
            quantity: task.reference[quantity] * self.factor for quantity in task.quantities_pinned
        }
        return ModelAnswer(
            task_id=task.task_id,
            values=values,
            runtime_unit=task.units.get("runtime_value"),
            raw=f"stub: every reference value multiplied by {self.factor:g}",
        )


class ConstantGuessAdapter:
    """Baseline control: answers every task with the SAME fixed numbers, regardless of the
    algorithm, problem size, or hardware in the prompt. The values below were picked by
    looking at roughly what a "medium" resource estimate might be, before any case in this
    corpus's own reference values were consulted for this purpose — they are not fitted to
    minimize or maximize the score against this specific corpus."""

    name = "constant-guess"

    #: A generic order-of-magnitude guess, not tuned against this corpus's own values.
    _GUESS: dict[QuantityName, float] = {
        "logical_qubits": 100.0,
        "t_count": 1_000_000.0,
        "toffoli_count": 1_000_000.0,
        "physical_qubits": 10_000.0,
        "runtime_value": 1.0,
    }
    _GUESS_RUNTIME_UNIT = "hours"

    def answer(self, task: ResourceEstimationTask) -> ModelAnswer:
        values: dict[QuantityName, float | None] = {
            quantity: self._GUESS[quantity] for quantity in task.quantities_pinned
        }
        runtime_unit = (
            self._GUESS_RUNTIME_UNIT if "runtime_value" in task.quantities_pinned else None
        )
        return ModelAnswer(
            task_id=task.task_id,
            values=values,
            runtime_unit=runtime_unit,
            raw="stub: the same fixed guess for every task, regardless of prompt",
        )
