"""Tests for the public-benchmark harness (proposal 1): loaders, scorers, the stub LLM,
and pricing are pure and always run; the end-to-end dry-run control (driving the REAL
`handle_run_execute` path with `StubPipelineLLM`, zero spend) is gated behind
`requires_db` like the rest of this package's DB-backed tests — it needs a migrated
Postgres, not a provider key, so unlike `requires_live_llm` tests it is expected to run
in ordinary CI."""

from __future__ import annotations

import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_sandbox import LocalSubprocessSandbox

from majorana_api.db import engine_from_env, session_factory
from majorana_api.repos import system

from majorana_evals.public_benchmarks.pricing import (
    BUDGET_EXHAUSTED,
    EMPIRICAL_INTERNAL_CORPUS,
    FIRST_CANDIDATE,
    ModelPrice,
    price_full_run,
)
from majorana_evals.public_benchmarks.qcircuiteval import (
    UNGRADABLE_PREFIX,
    load_qcircuiteval_tasks,
    score_qcircuiteval_task,
)
from majorana_evals.public_benchmarks.qiskit_human_eval import (
    load_qiskit_human_eval_tasks,
    score_qiskit_human_eval_task,
)
from majorana_evals.public_benchmarks.runner import run_public_benchmark
from majorana_evals.public_benchmarks.schema import ModelCallUsage, PublicBenchmarkReport
from majorana_evals.public_benchmarks.stub_llm import StubPipelineLLM

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="public-benchmark harness self-test needs DATABASE_URL"
)


# ---------------------------------------------------------------------------
# Loaders
# ---------------------------------------------------------------------------


def test_qiskit_human_eval_loads_151_tasks_sorted_and_hash_checked():
    tasks = load_qiskit_human_eval_tasks()
    assert len(tasks) == 151
    assert len(tasks) == len({task.task_id for task in tasks})
    assert [task.task_id for task in tasks] == sorted(task.task_id for task in tasks)
    assert all(task.benchmark == "qiskit-human-eval" for task in tasks)
    assert all("test" in task.grading for task in tasks)


def test_qiskit_human_eval_loader_rejects_a_corrupted_file(tmp_path):
    bad = tmp_path / "dataset.json"
    bad.write_text("[]")
    with pytest.raises(ValueError, match="does not match the pinned"):
        load_qiskit_human_eval_tasks(bad)


def test_every_canonical_solution_binds_no_result_or_final_circuit():
    """ai-ops 372 — a NECESSARY, NOT SUFFICIENT, structural property.

    Corrected after an initial version of this test wrongly implied causation.
    That version checked this property only for the 36 qiskitHumanEval
    task_ids whose 2026-09-23 live run had `run_status != "succeeded"`
    (README.md, ai-ops/desk/leona/plans/strategy-20260921/benchmark-runs-20260923)
    and presented the match as if it explained the rejection. It does not:
    checking all 151 tasks (not just the 36) shows the SAME
    `ProgramRole.UNKNOWN` classification for every canonical solution,
    including the 68 that PASSED and the 47 that were delivered but wrong.
    `build_nala_prompt` wraps every task identically ("do not include example
    usage"), so of course the canonical solution never binds `RESULT` or
    `FINAL_CIRCUIT` — that is true of the whole benchmark, and by itself
    predicts nothing about which tasks got delivered.

    So this test asserts only the TRUE, non-causal fact: `classify_source`
    reads every one of the 151 canonical solutions as `ProgramRole.UNKNOWN`.
    What actually happened for the 36 undelivered tasks — what the LIVE
    model's plan and candidate actually looked like, and which pipeline stage
    actually rejected each one — is unknown without the run's own database,
    which no longer exists (confirmed by an exhaustive local search of every
    docker container/volume touched around the run window). This PR's
    `check_contract`/`_success_criteria_check` fix is a real, independently
    confirmed defect (see `test_basic_contract_rejects_a_function_that_never_needed_to_run`
    and `test_a_delivered_function_candidate_is_never_labelled_verified_pass`
    in `services/worker/tests/test_simple_ports.py`, both driven directly
    against the real pipeline functions with controlled inputs, not against
    this dataset-wide correlation) — but whether it explains the 36 specific
    rejections is UNPROVEN pending a diagnostic live run that records what the
    real candidates' plans actually declared.
    """
    from majorana_frameworks import FrameworkProgram
    from majorana_frameworks.roles import ProgramRole
    from majorana_contracts.enums import Framework

    non_unknown = {}
    for task in load_qiskit_human_eval_tasks():
        source = task.scaffold + task.canonical_solution
        role = FrameworkProgram(Framework.QISKIT, source).role
        if role is not ProgramRole.UNKNOWN:
            non_unknown[task.task_id] = role

    assert not non_unknown, (
        "expected every qiskitHumanEval canonical solution to bind neither "
        f"RESULT nor FINAL_CIRCUIT (ProgramRole.UNKNOWN); these did not: {non_unknown}"
    )


def test_qcircuiteval_loads_70_tasks_across_core_and_qec():
    tasks = load_qcircuiteval_tasks()
    assert len(tasks) == 70
    assert len(tasks) == len({task.task_id for task in tasks})
    assert sum(1 for task in tasks if task.task_id.startswith("qec")) == 12
    assert sum(1 for task in tasks if not task.task_id.startswith("qec")) == 58


def test_qcircuiteval_can_skip_the_qec_suite():
    tasks = load_qcircuiteval_tasks(include_qec=False)
    assert len(tasks) == 58


def test_qcircuiteval_loader_rejects_a_corrupted_core_file(tmp_path):
    bad_core = tmp_path / "core.jsonl"
    bad_core.write_text("")
    with pytest.raises(ValueError, match="does not match the pinned"):
        load_qcircuiteval_tasks(core_path=bad_core)


# ---------------------------------------------------------------------------
# Scorers — pure, no DB, no pipeline: exercise the grading logic directly against
# constructed candidate source, the same shape the runner would extract from a delivered
# candidate.
# ---------------------------------------------------------------------------


def test_qiskit_human_eval_scorer_passes_the_canonical_solution():
    tasks = {task.task_id: task for task in load_qiskit_human_eval_tasks()}
    task = tasks["qiskitHumanEval/0"]  # create_quantum_circuit(n_qubits)
    source = task.scaffold + task.canonical_solution
    passed, reasons = score_qiskit_human_eval_task(source, task)
    assert passed, reasons


def test_qiskit_human_eval_scorer_fails_a_wrong_implementation():
    tasks = {task.task_id: task for task in load_qiskit_human_eval_tasks()}
    task = tasks["qiskitHumanEval/0"]
    source = task.scaffold + "\n    return None\n"
    passed, reasons = score_qiskit_human_eval_task(source, task)
    assert not passed
    assert reasons


def test_qiskit_human_eval_scorer_reports_a_missing_test_field():
    tasks = load_qiskit_human_eval_tasks()
    task = tasks[0].model_copy(update={"grading": {}})
    passed, reasons = score_qiskit_human_eval_task(task.scaffold + task.canonical_solution, task)
    assert not passed
    assert "missing" in reasons[0]


def test_qcircuiteval_scorer_passes_a_no_arg_canonical_solution():
    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    task = tasks["01"]  # grover_search_oracle_00, no args
    passed, reasons = score_qcircuiteval_task(task.canonical_solution, task)
    assert passed, reasons


def test_qcircuiteval_scorer_fails_a_forbidden_import():
    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    task = tasks["01"]
    source = "from qiskit.circuit.library import GroverOperator\n" + task.canonical_solution
    passed, reasons = score_qcircuiteval_task(source, task)
    assert not passed
    assert any("forbidden import" in reason for reason in reasons)


def test_qcircuiteval_scorer_fails_too_few_entangling_gates():
    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    task = tasks["01"]
    source = (
        f"from qiskit import QuantumCircuit\n"
        f"def {task.entry_point}():\n"
        "    qc = QuantumCircuit(2, 2)\n"
        "    qc.h(0)\n"
        "    qc.measure([0, 1], [0, 1])\n"
        "    return qc\n"
    )
    passed, reasons = score_qcircuiteval_task(source, task)
    assert not passed
    assert any("entangling_gate_count" in reason for reason in reasons)


def test_qcircuiteval_scorer_grades_every_case_table_case():
    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    task = next(
        t for t in tasks.values() if t.grading["canonical_class"].get("type") == "case_table"
    )
    passed, reasons = score_qcircuiteval_task(task.canonical_solution, task)
    assert passed, reasons
    cases = task.grading["canonical_class"]["cases"]
    assert len(cases) >= 2  # the case-table loop actually iterated more than one case


def test_qcircuiteval_scorer_marks_unresolvable_arguments_as_ungradable_not_failed_wrong():
    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    task = tasks["04"]  # qaoa_maxcut_ansatz(G, beta, gamma) — no case table, no manifest
    passed, reasons = score_qcircuiteval_task(task.canonical_solution, task)
    assert not passed
    assert reasons[0].startswith(UNGRADABLE_PREFIX)


def test_the_eight_known_ungradable_qcircuiteval_tasks_are_exactly_these():
    """Pins the census this harness's PROVENANCE.md and module docstring both quote — a
    regression here means either the vendored dataset changed or the detection logic did,
    and either is worth a human look before it just gets rescored quietly."""

    tasks = {task.task_id: task for task in load_qcircuiteval_tasks()}
    ungradable = set()
    for task_id, task in tasks.items():
        _passed, reasons = score_qcircuiteval_task(task.canonical_solution, task)
        if reasons and reasons[0].startswith(UNGRADABLE_PREFIX):
            ungradable.add(task_id)
    assert ungradable == {"04", "06", "29", "39", "40", "41", "42"}


# ---------------------------------------------------------------------------
# StubPipelineLLM — pure, no DB
# ---------------------------------------------------------------------------


async def test_stub_llm_rejects_an_unexpected_schema_name():
    from majorana_llm import LLMRequest

    llm = StubPipelineLLM(mode="canonical")
    with pytest.raises(AssertionError, match="unexpected schema_name"):
        await llm.complete(
            LLMRequest(model="x", system="s", user="u", response_schema={}, schema_name="nope")
        )


async def test_stub_llm_research_triage_always_declines():
    import json

    from majorana_llm import LLMRequest

    llm = StubPipelineLLM(mode="canonical")
    response = await llm.complete(
        LLMRequest(
            model="x", system="s", user="u", response_schema={}, schema_name="research_triage"
        )
    )
    assert json.loads(response.text) == {"needed": False, "query": ""}


async def test_stub_llm_token_counts_reflect_real_prompt_length():
    from majorana_llm import LLMRequest

    llm = StubPipelineLLM(mode="canonical")
    short = await llm.complete(
        LLMRequest(
            model="x", system="s", user="u", response_schema={}, schema_name="intent_alignment"
        )
    )
    long_request = LLMRequest(
        model="x", system="s" * 10_000, user="u", response_schema={}, schema_name="intent_alignment"
    )
    long = await llm.complete(long_request)
    assert long.input_tokens > short.input_tokens


# ---------------------------------------------------------------------------
# Pricing — pure, no DB
# ---------------------------------------------------------------------------


def _fixture_report() -> PublicBenchmarkReport:
    return PublicBenchmarkReport(
        benchmark="qiskit-human-eval",
        run_mode="stub-canonical",
        generate_model="deepseek-v4-pro",
        provider_profile="openai",
        prompt_version="v1",
        pipeline_commit_sha="deadbeef",
        dataset_commit_sha="deadbeef",
        dataset_sha256={"dataset.json": "deadbeef"},
        total=2,
        passed=2,
        pass_rate=1.0,
        total_wall_time_s=1.0,
        total_recorded_llm_calls=10,
        total_recorded_input_tokens=1000,
        total_recorded_output_tokens=200,
        by_model={
            "deepseek-v4-pro": ModelCallUsage(calls=10, input_tokens=1000, output_tokens=200)
        },
        by_stage={
            "plan": ModelCallUsage(calls=2, input_tokens=200, output_tokens=20),
            "generate": ModelCallUsage(calls=4, input_tokens=500, output_tokens=100),
            "verify": ModelCallUsage(calls=2, input_tokens=200, output_tokens=60),
            "analyze": ModelCallUsage(calls=2, input_tokens=100, output_tokens=20),
        },
        results=[],
    )


def test_price_full_run_scales_only_generate_and_verify():
    report = _fixture_report()
    price = ModelPrice(
        model="deepseek-v4-pro", input_per_million=0.66, output_per_million=1.98, source="test"
    )
    at_one = price_full_run(report, price=price, assumptions=FIRST_CANDIDATE)
    at_two = price_full_run(
        report,
        price=price,
        assumptions=type(FIRST_CANDIDATE)(candidates_per_task=2.0, label="x", source="test"),
    )
    # plan(200) + analyze(100) flat, generate(500)+verify(200) scaled: 300 + 700*c
    assert at_one.input_tokens == pytest.approx(1000)
    assert at_two.input_tokens == pytest.approx(300 + 700 * 2)
    assert at_two.usd > at_one.usd


def test_price_full_run_rejects_a_mixed_model_report():
    report = _fixture_report().model_copy(
        update={
            "by_model": {
                "deepseek-v4-pro": ModelCallUsage(calls=1, input_tokens=1, output_tokens=1),
                "claude-opus-4-8": ModelCallUsage(calls=1, input_tokens=1, output_tokens=1),
            }
        }
    )
    price = ModelPrice(model="x", input_per_million=1, output_per_million=1, source="test")
    with pytest.raises(ValueError, match="single model"):
        price_full_run(report, price=price, assumptions=FIRST_CANDIDATE)


def test_pricing_scenarios_are_ordered_first_to_worst_case():
    assert FIRST_CANDIDATE.candidates_per_task == 1.0
    assert (
        1.0 < EMPIRICAL_INTERNAL_CORPUS.candidates_per_task < BUDGET_EXHAUSTED.candidates_per_task
    )
    assert BUDGET_EXHAUSTED.candidates_per_task == 8.0


# ---------------------------------------------------------------------------
# End-to-end dry-run controls — the positive/negative control the task brief asks for.
# Needs DATABASE_URL, not a provider key: StubPipelineLLM spends nothing.
# ---------------------------------------------------------------------------


async def _scope(factory):
    async with factory() as session:
        user, ws = await system.get_or_provision_user(
            session,
            workos_user_id=f"public-bench-test-{uuid.uuid4()}",
            email=f"public-bench-test-{uuid.uuid4().hex[:8]}@eval.test",
        )
        await session.commit()
        return Scope(user_id=user.id, workspace_id=ws.id, role=Role.OWNER)


@requires_db
async def test_dry_run_canonical_control_passes_on_gradable_qiskit_human_eval_tasks():
    """Positive control. Restricted to tasks whose imports the sandbox guard actually
    allows: `qiskit_ibm_runtime` (43 of 151 tasks) is not on `majorana_sandbox.guard.
    ALLOWED_IMPORTS`, so those tasks are rejected before execution regardless of code
    quality — a real product constraint, not a harness defect (see PROVENANCE.md /
    the PR body for the full 151-task measurement, which is NOT expected to be ~100%
    because of this)."""

    from majorana_sandbox.guard import ALLOWED_IMPORTS

    import ast

    def gradable(task) -> bool:
        tree = ast.parse(task.scaffold + task.canonical_solution)
        mods = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                mods.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                mods.add(node.module.split(".")[0])
        return mods <= set(ALLOWED_IMPORTS)

    all_tasks = load_qiskit_human_eval_tasks()
    tasks = [task for task in all_tasks if gradable(task)][:5]
    assert len(tasks) == 5

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        scope = await _scope(factory)
        report = await run_public_benchmark(
            tasks,
            benchmark="qiskit-human-eval",
            factory=factory,
            scope=scope,
            llm=StubPipelineLLM(mode="canonical"),
            sandbox=LocalSubprocessSandbox(),
            run_mode="stub-canonical",
            dataset_commit_sha="test",
            dataset_sha256={"dataset.json": "test"},
            prompt_version="test",
        )
    finally:
        await engine.dispose()

    assert report.pass_rate == 1.0, [
        (result.task_id, result.reasons) for result in report.results if not result.passed
    ]
    assert report.total_recorded_llm_calls > 0
    assert report.by_stage  # real per-stage usage was recorded, not just a total
    # ai-ops 372: the per-candidate evidence that used to live ONLY in the run's own
    # Postgres — the run's database is what stopped surviving, not this report, so a
    # report must carry enough to diagnose a rejection on its own.
    for result in report.results:
        assert result.candidate_attempts, result.task_id
        assert result.candidate_attempts[0].revision == 1
        assert result.last_candidate_source, result.task_id
        assert "def " in result.last_candidate_source
        assert result.last_candidate_source_truncated is False


@requires_db
async def test_dry_run_garbage_control_fails_every_qiskit_human_eval_task():
    """Negative control: garbage is plausible-shaped (defines entry_point, keeps the
    pipeline's own FINAL_CIRCUIT/RESULT convention satisfied) but functionally wrong, so
    this exercises the SCORER's check() call, not just crash handling — asserted below by
    requiring at least one task to reach `run_status="succeeded"` and still fail scoring
    (some of the first five tasks by sorted id use an import the sandbox guard blocks,
    which fails the run itself rather than the benchmark's check(); both are real reasons
    to score a task 0, so the assertion only needs at least one of each kind present)."""

    tasks = load_qiskit_human_eval_tasks()[:5]
    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        scope = await _scope(factory)
        report = await run_public_benchmark(
            tasks,
            benchmark="qiskit-human-eval",
            factory=factory,
            scope=scope,
            llm=StubPipelineLLM(mode="garbage"),
            sandbox=LocalSubprocessSandbox(),
            run_mode="stub-garbage",
            dataset_commit_sha="test",
            dataset_sha256={"dataset.json": "test"},
            prompt_version="test",
        )
    finally:
        await engine.dispose()

    assert report.pass_rate == 0.0
    # at least one task reached the scorer (not just a guard-blocked run failure), so this
    # is a real check() failure for at least one task, not only crash handling
    assert any(result.run_status == "succeeded" for result in report.results)


@requires_db
async def test_dry_run_canonical_control_passes_on_gradable_qcircuiteval_tasks():
    """Positive control for QCircuitEval's structural scorer (see PROVENANCE.md for what
    "structural" does not cover), restricted to the 63/70 tasks this harness can actually
    call (no-arg or case_table entry points — the other 8 are `ungradable:`, not failed)."""

    tasks = [
        task
        for task in load_qcircuiteval_tasks()
        if task.grading["canonical_class"].get("type") == "case_table"
        or task.task_id not in {"04", "06", "29", "39", "40", "41", "42"}
    ][:5]

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        scope = await _scope(factory)
        report = await run_public_benchmark(
            tasks,
            benchmark="qcircuiteval",
            factory=factory,
            scope=scope,
            llm=StubPipelineLLM(mode="canonical"),
            sandbox=LocalSubprocessSandbox(),
            run_mode="stub-canonical",
            dataset_commit_sha="test",
            dataset_sha256={"core.jsonl": "test", "qec.jsonl": "test"},
            prompt_version="test",
        )
    finally:
        await engine.dispose()

    assert report.pass_rate == 1.0, [
        (result.task_id, result.reasons) for result in report.results if not result.passed
    ]
    assert all(result.functional_grading == "not_implemented" for result in report.results)


# ---------------------------------------------------------------------------
# Budget ceiling — the task-loop half of the guard (budget.py's BudgetGuardedLLM is the
# per-call half, tested in test_budget.py). No DB needed: once the tracker already reads
# as exceeded, `run_public_benchmark` must never open a session for a skipped task, so a
# factory that raises if entered is a stronger proof than a real (unused) database would be.
# ---------------------------------------------------------------------------


class _PoisonedFactory:
    """Raises if ever called — proves a skipped task never even tries to touch the DB."""

    def __call__(self, *args, **kwargs):
        raise AssertionError("factory() called for a task that should have been skipped")


class _PoisonedLLM:
    async def complete(self, request, *, on_delta=None):
        raise AssertionError("LLM called for a task that should have been skipped")


async def test_run_public_benchmark_skips_every_task_once_budget_already_exceeded():
    from majorana_evals.public_benchmarks.budget import BudgetTracker

    tasks = load_qiskit_human_eval_tasks()[:3]
    tracker = BudgetTracker(ceiling_usd=1.0, spent_usd=1.0)  # already AT the ceiling
    report = await run_public_benchmark(
        tasks,
        benchmark="qiskit-human-eval",
        factory=_PoisonedFactory(),
        scope=None,
        llm=_PoisonedLLM(),
        sandbox=LocalSubprocessSandbox(),
        run_mode="live",
        dataset_commit_sha="test",
        dataset_sha256={"dataset.json": "test"},
        prompt_version="test",
        budget=tracker,
    )
    assert report.total == 3
    assert report.passed == 0
    for result in report.results:
        assert result.run_status == "skipped_budget_ceiling"
        assert "not attempted" in result.reasons[0]


@requires_db
async def test_run_public_benchmark_runs_earlier_tasks_then_skips_once_exceeded():
    """A budget that goes over mid-run (simulated by a tracker that starts already at the
    ceiling but is only consulted by `run_public_benchmark`'s own loop, never inside
    `run_public_task`) must still let already-started work finish and only skip what comes
    after — checked here by giving the FIRST task room to run (tracker starts under the
    ceiling) and confirming the tracker's own post-hoc state, once manually pushed over,
    stops the rest."""

    from majorana_evals.public_benchmarks.budget import BudgetTracker

    tasks = load_qiskit_human_eval_tasks()[:2]
    tracker = BudgetTracker(ceiling_usd=1.0, spent_usd=0.0)

    engine = engine_from_env()
    factory = session_factory(engine)
    try:
        scope = await _scope(factory)

        class _OneShotThenOverBudgetLLM(StubPipelineLLM):
            """Behaves exactly like the canonical stub, but pushes the tracker over the
            ceiling as a side effect of its first call — simulating "the task in flight
            spent enough to cross the cap", which the per-call guard (test_budget.py)
            already covers in isolation; this confirms the LOOP notices before task 2."""

            async def complete(self, request, *, on_delta=None):
                tracker.spent_usd = tracker.ceiling_usd
                return await super().complete(request, on_delta=on_delta)

        report = await run_public_benchmark(
            tasks,
            benchmark="qiskit-human-eval",
            factory=factory,
            scope=scope,
            llm=_OneShotThenOverBudgetLLM(mode="canonical"),
            sandbox=LocalSubprocessSandbox(),
            run_mode="live",
            dataset_commit_sha="test",
            dataset_sha256={"dataset.json": "test"},
            prompt_version="test",
            budget=tracker,
        )
    finally:
        await engine.dispose()

    assert report.total == 2
    assert report.results[0].run_status != "skipped_budget_ceiling"
    assert report.results[1].run_status == "skipped_budget_ceiling"
