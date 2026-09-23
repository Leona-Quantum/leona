"""Tests for the paper-to-code benchmark (ai-ops#357 option 2, first increment).

Pure, no DB, no network, no live model call — real Qiskit execution only (statevector
comparison), which is exactly what this benchmark's grader is for. `_bell_task` is a
synthetic fixture (not one of the shipped corpus cases) used to test the GRADER's plumbing
end to end with real Qiskit code; the shipped corpus itself is exercised by
`test_loads_shipped_cases_and_controls_pass_100_and_0_percent` below, which is also the
source of the pass counts quoted in the PR body."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from majorana_evals.paper_to_code import (
    CanonicalAdapter,
    GarbageAdapter,
    PaperToCodeTask,
    dataset_sha256,
    load_paper_to_code_tasks,
    run_benchmark,
    score_paper_to_code_task,
)

_SOURCE = {
    "arxiv_id": "0000.00000",
    "title": "t",
    "authors": ["a"],
    "submitted": "2026-09-01",
    "location": "p.1",
    "url": "https://arxiv.org/abs/0000.00000",
    "license": "arXiv default license",
    "retrieved": "2026-09-21",
}


def _minimal_task(**overrides) -> PaperToCodeTask:
    base = dict(
        task_id="t",
        source=_SOURCE,
        prompt="p",
        quoted_excerpt="the paper says X",
        entry_point="f",
        scaffold="def f():\n",
        canonical_solution="    return 1\n",
        hidden_test="def check(candidate):\n    assert candidate() == 1\n",
        grading_method="statevector",
        qubits=1,
        novelty="paper-specific",
        novelty_reason="test fixture — not a real classification",
    )
    base.update(overrides)
    return PaperToCodeTask.model_validate(base)


#: A real (if trivial) Qiskit fixture — not a shipped corpus case — used to exercise the
#: grader's actual subprocess + Statevector-equivalence path end to end.
_BELL_SCAFFOLD = (
    "from qiskit import QuantumCircuit\n\n\n"
    "def make_bell_pair() -> QuantumCircuit:\n"
    '    """Return a 2-qubit circuit preparing (|00> + |11>) / sqrt(2)."""\n'
)
_BELL_CANONICAL_SOLUTION = (
    "    qc = QuantumCircuit(2)\n    qc.h(0)\n    qc.cx(0, 1)\n    return qc\n"
)
_BELL_HIDDEN_TEST = (
    "def check(candidate):\n"
    "    from qiskit import QuantumCircuit\n"
    "    from qiskit.quantum_info import Statevector\n"
    "    qc = candidate()\n"
    "    ref = QuantumCircuit(2)\n"
    "    ref.h(0)\n"
    "    ref.cx(0, 1)\n"
    "    assert Statevector(qc).equiv(Statevector(ref)), 'not equivalent to the Bell state'\n"
)


def _bell_task(**overrides) -> PaperToCodeTask:
    base = dict(
        task_id="bell-fixture",
        source=_SOURCE,
        prompt="Implement a Bell-pair preparation circuit.",
        quoted_excerpt="the Bell state (|00> + |11>) / sqrt(2)",
        entry_point="make_bell_pair",
        scaffold=_BELL_SCAFFOLD,
        canonical_solution=_BELL_CANONICAL_SOLUTION,
        hidden_test=_BELL_HIDDEN_TEST,
        grading_method="statevector",
        qubits=2,
        novelty="restated",
        novelty_reason="test fixture — a Bell pair is textbook, not a real classification",
    )
    base.update(overrides)
    return PaperToCodeTask.model_validate(base)


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------


def test_schema_rejects_empty_quoted_excerpt():
    with pytest.raises(ValidationError, match="quoted_excerpt"):
        _minimal_task(quoted_excerpt="")


def test_schema_rejects_empty_hidden_test():
    with pytest.raises(ValidationError, match="hidden_test"):
        _minimal_task(hidden_test="")


def test_schema_rejects_empty_novelty_reason():
    with pytest.raises(ValidationError, match="novelty_reason"):
        _minimal_task(novelty_reason="")


def test_schema_rejects_unknown_novelty_value():
    with pytest.raises(ValidationError):
        _minimal_task(novelty="sort-of-new")


def test_schema_rejects_qubits_out_of_bounds():
    with pytest.raises(ValidationError):
        _minimal_task(qubits=0)
    with pytest.raises(ValidationError):
        _minimal_task(qubits=25)


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _dump_yaml(task: PaperToCodeTask) -> str:
    import yaml

    return yaml.safe_dump(task.model_dump())


def test_loader_raises_on_empty_directory(tmp_path):
    with pytest.raises(ValueError, match="no case files found"):
        load_paper_to_code_tasks(tmp_path)


def test_loader_rejects_task_id_filename_mismatch(tmp_path):
    task = _minimal_task(task_id="mismatched-id")
    (tmp_path / "wrong-filename.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="does not match filename stem"):
        load_paper_to_code_tasks(tmp_path)


def test_loader_rejects_a_reference_solution_the_sandbox_guard_blocks(tmp_path):
    task = _minimal_task(
        task_id="blocked",
        scaffold="import subprocess\n\n\ndef f():\n",
        canonical_solution="    return subprocess.run(['echo', 'hi'])\n",
    )
    (tmp_path / "blocked.yaml").write_text(_dump_yaml(task))
    with pytest.raises(ValueError, match="blocked by the sandbox import guard"):
        load_paper_to_code_tasks(tmp_path)


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
# Grader (real Qiskit execution)
# ---------------------------------------------------------------------------


def test_grader_passes_a_correct_bell_circuit():
    task = _bell_task()
    passed, reasons = score_paper_to_code_task(task.scaffold + task.canonical_solution, task)
    assert passed, reasons
    assert reasons == []


def test_grader_fails_a_wrong_circuit():
    task = _bell_task()
    wrong_source = task.scaffold + "    qc = QuantumCircuit(2)\n    qc.h(0)\n    return qc\n"
    passed, reasons = score_paper_to_code_task(wrong_source, task)
    assert not passed
    assert reasons and "not equivalent" in reasons[0]


def test_grader_blocks_disallowed_import_before_running():
    task = _minimal_task(
        scaffold="import socket\n\n\ndef f():\n", canonical_solution="    return 1\n"
    )
    passed, reasons = score_paper_to_code_task(task.scaffold + task.canonical_solution, task)
    assert not passed
    assert "blocked by sandbox guard" in reasons[0]


# ---------------------------------------------------------------------------
# Adapters + runner (the zero-spend controls)
# ---------------------------------------------------------------------------


def test_canonical_adapter_passes_and_garbage_adapter_fails():
    task = _bell_task()
    canonical_source = CanonicalAdapter().answer(task)
    passed, _ = score_paper_to_code_task(canonical_source, task)
    assert passed

    garbage_source = GarbageAdapter().answer(task)
    passed, reasons = score_paper_to_code_task(garbage_source, task)
    assert not passed, "garbage control must not pass"


def test_run_benchmark_reports_100_percent_for_canonical_and_0_for_garbage():
    tasks = [_bell_task(task_id="a"), _bell_task(task_id="b")]
    report_ok = run_benchmark(
        tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256="x"
    )
    assert report_ok.passed == 2
    assert report_ok.pass_rate == 1.0

    report_bad = run_benchmark(
        tasks, adapter=GarbageAdapter(), run_mode="stub-garbage", dataset_sha256="x"
    )
    assert report_bad.passed == 0
    assert report_bad.pass_rate == 0.0


def test_run_benchmark_separates_paper_specific_score_from_the_total():
    # Both _bell_task()s default to novelty="restated" — a Bell pair is textbook.
    restated_tasks = [_bell_task(task_id="a"), _bell_task(task_id="b")]
    report = run_benchmark(
        restated_tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256="x"
    )
    assert report.total == 2
    assert report.paper_specific_total == 0, (
        "no paper-specific tasks in this fixture set — the breakdown must not fabricate one"
    )
    assert report.paper_specific_pass_rate == 0.0

    mixed_tasks = [
        _bell_task(task_id="a"),  # restated
        _bell_task(task_id="b", novelty="paper-specific", novelty_reason="test fixture override"),
    ]
    mixed_report = run_benchmark(
        mixed_tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256="x"
    )
    assert mixed_report.total == 2
    assert mixed_report.passed == 2
    assert mixed_report.paper_specific_total == 1
    assert mixed_report.paper_specific_passed == 1
    assert mixed_report.paper_specific_pass_rate == 1.0
    assert [r.novelty for r in mixed_report.results] == ["restated", "paper-specific"]


# ---------------------------------------------------------------------------
# The shipped corpus itself — this is where the PR's quoted pass counts come from.
# ---------------------------------------------------------------------------


#: The honest classification this corpus ships with (see PROVENANCE.md's "How new is each
#: task?" table) — pinned here as a regression: a case's `novelty` silently flipping (e.g.
#: someone "fixing" a case to read as more impressive) is exactly the kind of drift a
#: reviewer would otherwise have to re-derive from scratch.
EXPECTED_NOVELTY = {
    "virtual-rz-single-layer-ansatz": "restated",
    "ma-qaoa-single-layer": "restated",
    "dicke-state-k1-preparation": "restated",
    "belief-propagation-tree-state-prep": "paper-specific",
    "lcu-block-encoding-rate-matrix": "paper-specific",
}


def test_every_task_has_a_novelty_reason_and_matches_the_pinned_classification():
    tasks, _ = load_paper_to_code_tasks()
    for task in tasks:
        assert task.novelty_reason.strip(), f"{task.task_id} has no novelty_reason"
        if task.task_id in EXPECTED_NOVELTY:
            assert task.novelty == EXPECTED_NOVELTY[task.task_id], (
                f"{task.task_id}: novelty changed to {task.novelty!r} without updating "
                "this regression pin — update EXPECTED_NOVELTY deliberately if that's "
                "correct, don't let it drift silently"
            )


def test_loads_shipped_cases_and_controls_pass_100_and_0_percent():
    tasks, sha = load_paper_to_code_tasks()
    assert len(tasks) >= 5
    assert [task.task_id for task in tasks] == sorted(task.task_id for task in tasks)
    assert len(sha) == 64

    canonical_report = run_benchmark(
        tasks, adapter=CanonicalAdapter(), run_mode="stub-canonical", dataset_sha256=sha
    )
    assert canonical_report.passed == canonical_report.total, [
        (r.task_id, r.reasons) for r in canonical_report.results if not r.passed
    ]
    # The paper-specific slice must also be 100% on its own — a reader trusting only that
    # narrower figure still needs it to be a real positive control.
    assert canonical_report.paper_specific_passed == canonical_report.paper_specific_total
    assert canonical_report.paper_specific_total == sum(
        1 for v in EXPECTED_NOVELTY.values() if v == "paper-specific"
    )

    garbage_report = run_benchmark(
        tasks, adapter=GarbageAdapter(), run_mode="stub-garbage", dataset_sha256=sha
    )
    assert garbage_report.passed == 0, [r.task_id for r in garbage_report.results if r.passed]
    assert garbage_report.paper_specific_passed == 0
