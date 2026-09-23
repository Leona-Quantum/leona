"""Tests for the SDK-drift benchmark (ai-ops#357 option 3, first increment).

Pure, no DB, no network. `_minimal_task` is a synthetic fixture (not a shipped corpus case)
used to test the GRADER's plumbing — in particular, that `drift_reason_matched` correctly
tells "failed for the cited reason" apart from "failed for some other reason" — without
depending on real Qiskit version behaviour. The shipped corpus's REAL Qiskit-version
behaviour is exercised by `test_loads_shipped_cases_and_controls_pass_and_fail_correctly`
below, which is also the source of the pass counts quoted in the PR body."""

from __future__ import annotations

import pytest

from majorana_evals.sdk_drift import (
    CanonicalAdapter,
    OutdatedAdapter,
    SdkDriftTask,
    dataset_sha256,
    leaked_identifiers,
    load_sdk_drift_tasks,
    qiskit_installed_version,
    run_benchmark,
    score_sdk_drift_task,
)

_CHANGE = {
    "drift_topic": "synthetic-fixture",
    "old_api": "undefined_removed_function()",
    "new_api": "return 42",
    "changed_in_version": "1.0.0",
    "release_note_url": "https://example.invalid/migration-guide",
    "release_note_quote": "fixture only — not a real citation",
}


def _minimal_task(**overrides) -> SdkDriftTask:
    base = dict(
        task_id="t",
        change=_CHANGE,
        prompt="p",
        entry_point="f",
        scaffold="def f():\n",
        canonical_solution="    return 42\n",
        # Deliberately references an undefined name rather than depending on real Qiskit
        # version drift — this is a plumbing fixture, not a corpus case (see module
        # docstring). NameError is a stand-in for "the removed/old API blew up".
        outdated_solution="    return undefined_removed_function()\n",
        hidden_test="def check(candidate):\n    assert candidate() == 42\n",
        expected_failure_pattern="NameError",
        qiskit_pin_at_authoring="2.5.2",
    )
    base.update(overrides)
    return SdkDriftTask.model_validate(base)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _dump_yaml(task: SdkDriftTask) -> str:
    import yaml

    return yaml.safe_dump(task.model_dump())


def test_loader_raises_on_empty_directory(tmp_path):
    with pytest.raises(ValueError, match="no case files found"):
        load_sdk_drift_tasks(tmp_path)


def test_loader_rejects_task_id_filename_mismatch(tmp_path):
    task = _minimal_task(task_id="mismatched-id")
    (tmp_path / "wrong-filename.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="does not match filename stem"):
        load_sdk_drift_tasks(tmp_path)


def test_loader_rejects_a_canonical_solution_the_sandbox_guard_blocks(tmp_path):
    task = _minimal_task(
        task_id="blocked",
        scaffold="import subprocess\n\n\ndef f():\n",
        canonical_solution="    return subprocess.run(['echo'])\n",
    )
    (tmp_path / "blocked.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="blocked by the sandbox import guard"):
        load_sdk_drift_tasks(tmp_path)


def test_loader_rejects_a_prompt_that_names_the_old_api_it_grades(tmp_path):
    task = _minimal_task(
        task_id="leaky",
        prompt="Write a function that avoids calling undefined_removed_function().",
    )
    (tmp_path / "leaky.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="prompt names the very API drift"):
        load_sdk_drift_tasks(tmp_path)


def test_loader_rejects_a_prompt_that_names_the_new_api_it_grades(tmp_path):
    task = _minimal_task(
        task_id="leaky2",
        change={**_CHANGE, "new_api": "return modern_replacement_value()"},
        prompt="Write a function that calls modern_replacement_value().",
    )
    (tmp_path / "leaky2.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="prompt names the very API drift"):
        load_sdk_drift_tasks(tmp_path)


def test_loader_rejects_a_prompt_naming_removed_deprecated_or_a_version_number(tmp_path):
    for word in ("removed", "deprecated", "legacy"):
        task = _minimal_task(task_id=f"leaky-{word}", prompt=f"This API was {word} here.")
        (tmp_path / f"leaky-{word}.yaml").write_text(_dump_yaml(task))
        with pytest.raises(ValueError, match="prompt names the very API drift"):
            load_sdk_drift_tasks(tmp_path)

    version_task = _minimal_task(task_id="leaky-version", prompt="This changed in Qiskit 1.0.0.")
    (tmp_path / "leaky-version.yaml").write_text(_dump_yaml(version_task))
    with pytest.raises(ValueError, match="prompt names the very API drift"):
        load_sdk_drift_tasks(tmp_path)


def test_leaked_identifiers_allows_a_neutral_prompt():
    task = _minimal_task(prompt="Write a function that returns the correct integer answer.")
    assert leaked_identifiers(task) == []


def test_leaked_identifiers_ignores_a_token_shared_by_old_and_new_api():
    # "shared_call" appears on BOTH sides — it does not distinguish which idiom to use,
    # so naming it is not a leak (the mechanical form of "name the concept, not the
    # V1/V2 class" — see prompt_neutrality.py).
    task = _minimal_task(
        change={**_CHANGE, "old_api": "shared_call(old_kw=1)", "new_api": "shared_call(new_kw=1)"},
        prompt="Write a function that uses a shared_call to compute the answer.",
    )
    assert leaked_identifiers(task) == []


def test_leaked_identifiers_catches_a_leak_inside_a_longer_identifier():
    # Substring, not exact-token, matching: a test-harness function name that CONTAINS
    # the banned old_api identifier is exactly the priming effect being guarded against.
    task = _minimal_task(prompt="Write `undefined_removed_function_wrapper()`.")
    assert "undefined_removed_function" in leaked_identifiers(task)


# ---------------------------------------------------------------------------
# Prompt-neutrality mutation check (see this test's own docstring)
# ---------------------------------------------------------------------------


def test_mutation_prompt_neutrality_check_actually_fires_on_the_shipped_corpus(monkeypatch):
    """Mutation-check for the prompt-neutrality guard itself: temporarily patch ONE
    shipped case's prompt (in memory, never written to disk) to re-insert its own old_api
    text, and confirm `leaked_identifiers` — the exact function `loader.py` calls — flags
    it. This is the same break/observe/revert discipline as the grader mutation-checks
    elsewhere in this corpus, applied to the neutrality guard instead of the grader."""

    tasks, _ = load_sdk_drift_tasks()
    task = tasks[0]
    assert leaked_identifiers(task) == [], "fixture assumption: the real case starts clean"

    mutated = task.model_copy(update={"prompt": task.prompt + f"\n\n{task.change.old_api}"})
    assert leaked_identifiers(mutated) != [], (
        "re-inserting the case's own old_api text must be caught — the guard did not fire"
    )


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


# ---------------------------------------------------------------------------
# Grader plumbing
# ---------------------------------------------------------------------------


def test_grader_passes_the_canonical_modern_idiom():
    task = _minimal_task()
    passed, reasons, drift_matched = score_sdk_drift_task(
        task.scaffold + task.canonical_solution, task
    )
    assert passed, reasons
    assert drift_matched is None, "nothing to match when the run passed"


def test_grader_fails_the_outdated_idiom_for_the_cited_drift_reason():
    task = _minimal_task()
    passed, reasons, drift_matched = score_sdk_drift_task(
        task.scaffold + task.outdated_solution, task
    )
    assert not passed
    assert drift_matched is True, reasons


def test_grader_reports_drift_mismatch_when_failure_is_for_a_different_reason():
    task = _minimal_task(expected_failure_pattern="SomeOtherErrorThatWillNotAppear")
    passed, reasons, drift_matched = score_sdk_drift_task(
        task.scaffold + task.outdated_solution, task
    )
    assert not passed
    assert drift_matched is False, "the raised NameError does not match the wrong pattern"
    assert "did NOT match" in reasons[0]


def test_grader_blocks_disallowed_import_before_running_and_reports_no_drift_verdict():
    task = _minimal_task(
        scaffold="import socket\n\n\ndef f():\n", canonical_solution="    return 42\n"
    )
    passed, reasons, drift_matched = score_sdk_drift_task(
        task.scaffold + task.canonical_solution, task
    )
    assert not passed
    assert "blocked by sandbox guard" in reasons[0]
    assert drift_matched is None, "a guard block is not the drift being tested for"


# ---------------------------------------------------------------------------
# Adapters + runner (the zero-spend controls)
# ---------------------------------------------------------------------------


def test_canonical_adapter_passes_and_outdated_adapter_fails_for_the_drift_reason():
    task = _minimal_task()
    passed, _, _ = score_sdk_drift_task(CanonicalAdapter().answer(task), task)
    assert passed

    passed, reasons, drift_matched = score_sdk_drift_task(OutdatedAdapter().answer(task), task)
    assert not passed
    assert drift_matched is True, reasons


def test_run_benchmark_reports_100_percent_canonical_and_0_percent_outdated():
    tasks = [_minimal_task(task_id="a"), _minimal_task(task_id="b")]
    report_ok = run_benchmark(
        tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256="x"
    )
    assert report_ok.passed == 2
    assert report_ok.qiskit_version == qiskit_installed_version()

    report_bad = run_benchmark(
        tasks, adapter=OutdatedAdapter(), run_mode="stub-outdated", dataset_sha256="x"
    )
    assert report_bad.passed == 0
    assert all(result.drift_reason_matched for result in report_bad.results)


# ---------------------------------------------------------------------------
# The shipped corpus itself, against the ACTUAL pinned Qiskit — this is where the PR's
# quoted pass counts come from.
# ---------------------------------------------------------------------------


def test_loads_shipped_cases_and_controls_pass_and_fail_correctly():
    tasks, sha = load_sdk_drift_tasks()
    assert len(tasks) >= 15
    assert [task.task_id for task in tasks] == sorted(task.task_id for task in tasks)
    assert len(sha) == 64

    canonical_report = run_benchmark(
        tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256=sha
    )
    assert canonical_report.passed == canonical_report.total, [
        (r.task_id, r.reasons) for r in canonical_report.results if not r.passed
    ]

    outdated_report = run_benchmark(
        tasks, adapter=OutdatedAdapter(), run_mode="stub-outdated", dataset_sha256=sha
    )
    assert outdated_report.passed == 0, [r.task_id for r in outdated_report.results if r.passed]
    unmatched = [r.task_id for r in outdated_report.results if not r.drift_reason_matched]
    assert not unmatched, f"these outdated solutions failed for the WRONG reason: {unmatched}"
