"""Grades a `ModelAnswer` against a `ResourceEstimationTask`'s reference values.

Grading rule: LOG-RELATIVE error against a per-quantity, per-case band (`tolerance_log10`,
in log10 units — 0.301 is a factor of 2, 0.176 is a factor of 1.5). Using log-relative error
rather than absolute or linear-relative error is deliberate: these quantities span many
orders of magnitude across the corpus (hundreds of logical qubits to tens of billions of
gates), and a model that is "wrong by 2x" should be graded the same way whether the reference
is 100 or 10^10 — a fixed absolute tolerance cannot do that, and a fixed linear-relative
tolerance (e.g. "within 20%") penalizes small numbers and barely constrains huge ones because
rounding in the source itself is usually multiplicative, not additive (a paper says "~20
million", not "20,000,000 plus or minus 50,000").

`ResourceEstimationTask` enforces `0 < tolerance_log10 < 1` at load time (see schema.py), so
every band here is strictly tighter than a full order of magnitude — this is what makes the
benchmark's own 10x-perturbation control (see adapters.py) fail on every quantity in every
case, by construction, not by coincidence."""

from __future__ import annotations

import math

from majorana_evals.resource_estimation.schema import (
    ModelAnswer,
    QuantityGrade,
    QuantityName,
    ResourceEstimationTask,
    RUNTIME_UNIT_SECONDS,
    TaskResult,
)


def _grade_value(
    quantity: QuantityName,
    *,
    reference_value: float,
    model_value: float | None,
    tolerance_log10: float,
    reason_if_missing: str,
) -> QuantityGrade:
    if model_value is None:
        return QuantityGrade(
            quantity=quantity,
            reference_value=reference_value,
            model_value=None,
            log10_abs_error=None,
            tolerance_log10=tolerance_log10,
            passed=False,
            score=0.0,
            reason=reason_if_missing,
        )
    if model_value <= 0:
        return QuantityGrade(
            quantity=quantity,
            reference_value=reference_value,
            model_value=model_value,
            log10_abs_error=None,
            tolerance_log10=tolerance_log10,
            passed=False,
            score=0.0,
            reason=f"{quantity}: model value {model_value!r} is non-positive; "
            "log-relative error is undefined",
        )
    log10_abs_error = abs(math.log10(model_value / reference_value))
    passed = log10_abs_error <= tolerance_log10
    # Linear falloff to 0 exactly at the band edge — a near-miss scores just above 0 rather
    # than falling off a cliff, while a 10x-perturbed control (log10_abs_error == 1.0, and
    # tolerance_log10 < 1.0 always — see schema.py's validator) is clamped to exactly 0.0.
    score = max(0.0, 1.0 - log10_abs_error / tolerance_log10)
    reason = (
        None
        if passed
        else f"{quantity}: log10 error {log10_abs_error:.3f} > band {tolerance_log10:.3f}"
    )
    return QuantityGrade(
        quantity=quantity,
        reference_value=reference_value,
        model_value=model_value,
        log10_abs_error=log10_abs_error,
        tolerance_log10=tolerance_log10,
        passed=passed,
        score=score,
        reason=reason,
    )


def grade_task(task: ResourceEstimationTask, answer: ModelAnswer) -> TaskResult:
    if answer.task_id != task.task_id:
        raise ValueError(f"answer.task_id={answer.task_id!r} does not match task {task.task_id!r}")

    grades: list[QuantityGrade] = []
    for quantity in task.quantities_pinned:
        reference_value = task.reference[quantity]
        tolerance_log10 = task.tolerance_log10[quantity]
        model_value = answer.values.get(quantity)

        if quantity == "runtime_value" and model_value is not None:
            unit = answer.runtime_unit
            if unit not in RUNTIME_UNIT_SECONDS:
                grades.append(
                    QuantityGrade(
                        quantity=quantity,
                        reference_value=reference_value,
                        model_value=None,
                        log10_abs_error=None,
                        tolerance_log10=tolerance_log10,
                        passed=False,
                        score=0.0,
                        reason=f"runtime_value given but runtime_unit={unit!r} is not one of "
                        f"{sorted(RUNTIME_UNIT_SECONDS)}",
                    )
                )
                continue
            reference_seconds = reference_value * RUNTIME_UNIT_SECONDS[task.units["runtime_value"]]
            model_seconds = model_value * RUNTIME_UNIT_SECONDS[unit]
            grades.append(
                _grade_value(
                    quantity,
                    reference_value=reference_seconds,
                    model_value=model_seconds,
                    tolerance_log10=tolerance_log10,
                    reason_if_missing="no answer given for runtime_value",
                )
            )
            continue

        grades.append(
            _grade_value(
                quantity,
                reference_value=reference_value,
                model_value=model_value,
                tolerance_log10=tolerance_log10,
                reason_if_missing=f"no answer given for {quantity}",
            )
        )

    passed = all(grade.passed for grade in grades)
    score = sum(grade.score for grade in grades) / len(grades) if grades else 0.0
    reasons = [grade.reason for grade in grades if grade.reason]
    return TaskResult(
        task_id=task.task_id, grades=grades, passed=passed, score=score, reasons=reasons
    )
