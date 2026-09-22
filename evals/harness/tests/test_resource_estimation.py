"""Tests for the resource-estimation benchmark (ai-ops#357 option 1, first increment).

Pure, no DB, no network, no pipeline — everything here runs in ordinary CI. The three
adapter tests double as the "controls" the spec requires: `test_reference_adapter_scores_100_percent`,
`test_perturbed_adapter_scores_zero_on_every_quantity`, and
`test_constant_guess_baseline_scores_near_zero` are exactly the three zero-spend controls
described in the PR, pinned as regressions."""

from __future__ import annotations

import math

import pytest
from pydantic import ValidationError

from majorana_evals.resource_estimation import (
    ConstantGuessAdapter,
    ModelAnswer,
    PerturbedAdapter,
    ReferenceAdapter,
    ResourceEstimationTask,
    dataset_sha256,
    grade_task,
    load_resource_estimation_tasks,
    run_benchmark,
)

EXPECTED_TASK_IDS = {
    "babbush-2018-hubbard-8x8",
    "babbush-2018-jellium-n128",
    "beverland-2022-chemistry-complex18",
    "beverland-2022-factoring-majorana",
    "gidney-2025-rsa2048",
    "gidney-ekera-2019-rsa2048",
    "kivlichan-2020-hubbard-8x8",
    "lee-2021-femoco-thc",
    "reiher-2017-femoco-trotter",
}


def _minimal_task(**overrides) -> ResourceEstimationTask:
    base = dict(
        task_id="t",
        algorithm="a",
        problem_size={},
        hardware_assumptions={},
        prompt="p",
        assumptions=["x"],
        quantities_pinned=["logical_qubits"],
        reference={"logical_qubits": 100.0},
        units={},
        tolerance_log10={"logical_qubits": 0.1},
        tolerance_rationale={"logical_qubits": "because"},
        source={
            "arxiv_id": "0000.00000",
            "title": "t",
            "authors": ["a"],
            "location": "p.1",
            "url": "https://arxiv.org/abs/0000.00000",
            "retrieved": "2026-09-21",
        },
        cross_check={"ran": False, "note": "test fixture"},
    )
    base.update(overrides)
    return ResourceEstimationTask.model_validate(base)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def test_loads_nine_cases_sorted_unique_and_all_expected_ids_present():
    tasks, sha = load_resource_estimation_tasks()
    assert len(tasks) == 9
    assert {task.task_id for task in tasks} == EXPECTED_TASK_IDS
    assert [task.task_id for task in tasks] == sorted(task.task_id for task in tasks)
    assert len(sha) == 64  # hex sha256


def test_dataset_sha256_is_stable_and_order_independent(tmp_path):
    a = tmp_path / "a.txt"
    b = tmp_path / "b.txt"
    a.write_text("hello")
    b.write_text("world")
    before = dataset_sha256([a, b])
    assert dataset_sha256([a, b]) == dataset_sha256([b, a]), "hash must not depend on list order"
    b.write_text("world!")
    after = dataset_sha256([a, b])
    assert before != after, "hash must change when a file's content changes"


def test_loader_rejects_task_id_filename_mismatch(tmp_path):
    task = _minimal_task(task_id="mismatched-id")
    (tmp_path / "wrong-filename.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="does not match filename stem"):
        load_resource_estimation_tasks(tmp_path)


def test_loader_rejects_a_second_case_with_a_task_id_that_collides_by_filename(tmp_path):
    """The filename-must-match-task_id rule (tested above) already makes a true duplicate
    task_id impossible without ALSO being a filename mismatch (a filesystem cannot hold two
    files with the same stem in one directory) — the `seen_ids` check in loader.py is
    defense in depth for that invariant, not something reachable as a distinct failure mode
    through this public interface. This test pins that the (necessarily) same failure a
    second colliding file would hit is still a loud ValueError, not a silent overwrite."""

    task = _minimal_task(task_id="dup")
    (tmp_path / "dup.yaml").write_text(_dump_yaml(task))
    # A second file for the SAME task_id can only exist under a DIFFERENT filename stem
    # (filesystems forbid two files sharing a name) — so it is caught by the
    # filename-mismatch check, not the duplicate-id check, and that is the point.
    (tmp_path / "dup-again.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="does not match filename stem"):
        load_resource_estimation_tasks(tmp_path)


def test_loader_raises_on_empty_directory(tmp_path):
    with pytest.raises(ValueError, match="no case files found"):
        load_resource_estimation_tasks(tmp_path)


def _dump_yaml(task: ResourceEstimationTask) -> str:
    import yaml

    return yaml.safe_dump(task.model_dump())


# ---------------------------------------------------------------------------
# Schema validation
# ---------------------------------------------------------------------------


def test_schema_rejects_a_tolerance_band_of_one_order_of_magnitude_or_more():
    """The whole "perturb by 10x scores 0" control depends on every band being < 1.0 in
    log10 — this pins that invariant at the SCHEMA level, not just by observing today's
    cases happen to satisfy it."""

    with pytest.raises(ValidationError, match="tolerance_log10"):
        _minimal_task(tolerance_log10={"logical_qubits": 1.0})
    with pytest.raises(ValidationError, match="tolerance_log10"):
        _minimal_task(tolerance_log10={"logical_qubits": 0.0})


def test_schema_rejects_a_mismatch_between_quantities_pinned_and_reference():
    with pytest.raises(ValidationError, match="missing entries for pinned quantities"):
        _minimal_task(quantities_pinned=["logical_qubits", "t_count"])
    with pytest.raises(ValidationError, match="entries for quantities NOT in quantities_pinned"):
        _minimal_task(reference={"logical_qubits": 100.0, "t_count": 5.0})


def test_schema_requires_a_unit_for_runtime_value():
    with pytest.raises(ValidationError, match="not one of"):
        _minimal_task(
            quantities_pinned=["runtime_value"],
            reference={"runtime_value": 1.0},
            tolerance_log10={"runtime_value": 0.1},
            tolerance_rationale={"runtime_value": "x"},
            units={},
        )


def test_every_vendored_case_has_tolerance_bands_under_one_order_of_magnitude():
    tasks, _ = load_resource_estimation_tasks()
    for task in tasks:
        for quantity, band in task.tolerance_log10.items():
            assert 0.0 < band < 1.0, f"{task.task_id}/{quantity}: band {band} not in (0, 1)"


# ---------------------------------------------------------------------------
# Grader
# ---------------------------------------------------------------------------


def test_grade_task_passes_an_exact_match():
    task = _minimal_task()
    answer = ModelAnswer(task_id="t", values={"logical_qubits": 100.0})
    result = grade_task(task, answer)
    assert result.passed
    assert result.score == 1.0
    assert result.grades[0].log10_abs_error == 0.0


def test_grade_task_fails_a_value_outside_the_band():
    task = _minimal_task(tolerance_log10={"logical_qubits": 0.1})
    # 100 * 10^0.2 is a log10 error of 0.2, outside the 0.1 band.
    answer = ModelAnswer(task_id="t", values={"logical_qubits": 100.0 * 10**0.2})
    result = grade_task(task, answer)
    assert not result.passed
    assert result.score == 0.0
    assert "log10 error" in result.reasons[0]


def test_grade_task_scores_a_near_miss_between_zero_and_one():
    task = _minimal_task(tolerance_log10={"logical_qubits": 0.2})
    # log10 error of 0.1 is HALF of the 0.2 band -> still within the band (passed=True),
    # scored at exactly 0.5 by the linear falloff (score = 1 - error/band).
    answer = ModelAnswer(task_id="t", values={"logical_qubits": 100.0 * 10**0.1})
    result = grade_task(task, answer)
    assert result.passed
    assert math.isclose(result.score, 0.5, rel_tol=1e-9)


def test_grade_task_treats_a_missing_answer_as_failed_not_zero_coerced():
    task = _minimal_task()
    answer = ModelAnswer(task_id="t", values={})
    result = grade_task(task, answer)
    assert not result.passed
    assert result.grades[0].model_value is None
    assert result.grades[0].log10_abs_error is None
    assert "no answer given" in result.reasons[0]


def test_grade_task_rejects_a_non_positive_model_value():
    task = _minimal_task()
    answer = ModelAnswer(task_id="t", values={"logical_qubits": -5.0})
    result = grade_task(task, answer)
    assert not result.passed
    assert "non-positive" in result.reasons[0]


def test_grade_task_converts_runtime_units_before_comparing():
    task = _minimal_task(
        quantities_pinned=["runtime_value"],
        reference={"runtime_value": 1.0},
        units={"runtime_value": "days"},
        tolerance_log10={"runtime_value": 0.1},
        tolerance_rationale={"runtime_value": "x"},
    )
    # 24 hours == 1 day exactly -> zero error despite different units.
    answer = ModelAnswer(task_id="t", values={"runtime_value": 24.0}, runtime_unit="hours")
    result = grade_task(task, answer)
    assert result.passed
    assert math.isclose(result.grades[0].log10_abs_error, 0.0, abs_tol=1e-9)


def test_grade_task_rejects_an_unrecognized_runtime_unit():
    task = _minimal_task(
        quantities_pinned=["runtime_value"],
        reference={"runtime_value": 1.0},
        units={"runtime_value": "days"},
        tolerance_log10={"runtime_value": 0.1},
        tolerance_rationale={"runtime_value": "x"},
    )
    answer = ModelAnswer(task_id="t", values={"runtime_value": 1.0}, runtime_unit="fortnights")
    result = grade_task(task, answer)
    assert not result.passed
    assert "not one of" in result.reasons[0]


def test_grade_task_rejects_a_mismatched_task_id():
    task = _minimal_task()
    answer = ModelAnswer(task_id="different", values={"logical_qubits": 100.0})
    with pytest.raises(ValueError, match="does not match task"):
        grade_task(task, answer)


# ---------------------------------------------------------------------------
# Adapters / controls — the three zero-spend controls the PR requires.
# ---------------------------------------------------------------------------


def test_reference_adapter_scores_100_percent():
    tasks, sha = load_resource_estimation_tasks()
    report = run_benchmark(
        tasks, adapter=ReferenceAdapter(), run_mode="stub-reference", dataset_sha256=sha
    )
    assert report.total == len(tasks)
    assert report.passed == len(tasks)
    assert report.pass_rate == 1.0
    assert report.mean_score == 1.0
    for result in report.results:
        assert result.passed, result.reasons
        for grade in result.grades:
            assert grade.log10_abs_error == 0.0


def test_perturbed_adapter_scores_zero_on_every_quantity():
    tasks, sha = load_resource_estimation_tasks()
    report = run_benchmark(
        tasks,
        adapter=PerturbedAdapter(factor=10.0),
        run_mode="stub-perturbed-10x",
        dataset_sha256=sha,
    )
    assert report.passed == 0
    assert report.pass_rate == 0.0
    assert report.mean_score == 0.0
    for result in report.results:
        assert not result.passed
        for grade in result.grades:
            assert grade.score == 0.0


def test_constant_guess_baseline_scores_near_zero():
    tasks, sha = load_resource_estimation_tasks()
    report = run_benchmark(
        tasks, adapter=ConstantGuessAdapter(), run_mode="stub-constant-guess", dataset_sha256=sha
    )
    assert report.passed == 0
    assert report.mean_score < 0.05, (
        f"constant-guess baseline scored {report.mean_score:.3f} — too high for a fixed "
        "guess against a corpus spanning hundreds to 10^11+ in scale"
    )


def test_perturbed_adapter_rejects_a_factor_of_one_or_less():
    with pytest.raises(ValueError, match="must be > 1"):
        PerturbedAdapter(factor=1.0)


def test_run_benchmark_records_dataset_sha256_and_adapter_name():
    tasks, sha = load_resource_estimation_tasks()
    report = run_benchmark(
        tasks[:1], adapter=ReferenceAdapter(), run_mode="stub-reference", dataset_sha256=sha
    )
    assert report.dataset_sha256 == sha
    assert report.adapter_name == "reference"
    assert report.benchmark == "resource-estimation"
