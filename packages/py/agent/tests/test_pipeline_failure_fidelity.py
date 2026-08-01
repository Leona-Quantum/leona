"""The two worker defects the session-31 production sweep found.

Both are honest failures reported badly. One tells the user the wrong thing; the
other spends a whole repair budget learning nothing. Neither is about whether the
pipeline works — they are about what it says and when it stops.
"""

from __future__ import annotations

import hashlib
import json
from uuid import uuid4

from majorana_agent import (
    BasicContractResult,
    CandidateRevision,
    ExecutionEvidence,
    ExecutionFailureKind,
    PlanRevision,
    SimpleCircuitPipeline,
    SimpleFailureKind,
    SimplePipelineBudget,
    SimplePipelineFailure,
    SimplePipelineStage,
    SimplePipelineStatus,
    SimplePortResult,
)
from majorana_contracts.enums import Framework
from majorana_frameworks import FrameworkProgram

from test_simple_pipeline import FakePorts, _plan_revision


class MemoryRefusedThenUnplannable(FakePorts):
    """The shape of run 019f9ea8-5c20-718a-bbff-9168ccd5543e.

    `Simulate a 40-qubit random circuit`: the statevector memory preflight
    refuses it before it runs (exit 75, duration 0), which correctly retries at
    PLANNING — and the replan then fails.
    """

    def __init__(self) -> None:
        super().__init__()
        self.plan_calls = 0

    async def plan(self, run_id, previous, feedback):
        self.calls.append("plan")
        self.plan_feedback.append(feedback)
        self.plan_calls += 1
        if self.plan_calls == 1:
            return SimplePortResult.success(_plan_revision(run_id, 1))
        return SimplePortResult.failed(
            SimplePipelineFailure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="plan_output_invalid",
                message="planner returned a plan that could not be read",
            )
        )

    async def run_execution(self, _run_id, _plan, candidate):
        self.calls.append("execute")
        return SimplePortResult.success(
            ExecutionEvidence(
                execution_id=uuid4(),
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                environment_fingerprint="e" * 64,
                sandbox_provider="test",
                exit_code=75,
                failure_kind=ExecutionFailureKind.RESOURCE_LIMIT,
                duration_ms=0,
                result={},
                observation={
                    "evidence_error": "statevector would not fit in memory",
                    "estimated_memory_mb": 17_592_186_044,
                    "memory_limit_mb": 3_500,
                    "qubits": 40,
                },
            )
        )


async def test_a_failed_replan_reports_what_forced_it_not_just_itself():
    outcome = await SimpleCircuitPipeline(ports=MemoryRefusedThenUnplannable()).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    failure = outcome.failure
    assert failure is not None

    # The bug: the user read "the planner returned a plan that could not be
    # read" for a circuit that was refused for memory before it ever ran.
    assert failure.code != "plan_output_invalid"
    assert failure.code.startswith("execution_resource_limit")
    # A run refused for memory is a RESOURCE failure however the replan went.
    assert failure.kind is SimpleFailureKind.RESOURCE
    assert "replanning to fit" in failure.message

    # The numbers were always in the originating failure; only the terminal one
    # dropped them. They are what makes the message actionable.
    cause = failure.details["originating_failure"]
    assert cause["estimated_memory_mb"] == 17_592_186_044
    assert cause["memory_limit_mb"] == 3_500
    assert cause["qubits"] == 40
    assert cause["exit_code"] == 75
    # The replan's own code survives too — it is real, just not the headline.
    assert failure.details["replan_failure_code"] == "plan_output_invalid"


async def test_a_plan_failure_with_no_prior_cause_is_reported_unchanged():
    """The helper must not invent a cause where there is none.

    A first plan that fails is exactly what it says it is; wrapping it would be
    as misleading as the bug being fixed.
    """
    ports = FakePorts()

    async def failing_plan(_run_id, _previous, _feedback):
        ports.calls.append("plan")
        return SimplePortResult.failed(
            SimplePipelineFailure(
                kind=SimpleFailureKind.PLAN,
                stage=SimplePipelineStage.PLANNING,
                code="plan_output_invalid",
                message="planner returned a plan that could not be read",
            )
        )

    ports.plan = failing_plan  # type: ignore[method-assign]
    outcome = await SimpleCircuitPipeline(ports=ports).run(uuid4())

    assert outcome.failure is not None
    assert outcome.failure.code == "plan_output_invalid"
    assert "originating_failure" not in outcome.failure.details


class AlwaysTheSameSource(FakePorts):
    """The shape of run 019f9ea8-deac-7650-babc-5925d7585211.

    `Convert a Bell state circuit to Cirq` routed to execute with
    framework=qiskit, and the generator emitted `FINAL_CIRCUIT = None` plus a
    comment saying Qiskit cannot produce Cirq — eight times, byte-identical.
    """

    SOURCE = (
        "# Qiskit cannot emit Cirq source.\n"
        "from qiskit import QuantumCircuit\n"
        "FINAL_CIRCUIT = None\n"
        "RESULT = {}\n"
    )

    def __init__(self) -> None:
        super().__init__()
        self.generated = 0

    async def generate(self, run_id, plan, previous, feedback):
        self.calls.append("generate")
        self.generation_feedback.append(feedback)
        self.generated += 1
        program = FrameworkProgram(framework=Framework.QISKIT, source=self.SOURCE)
        return SimplePortResult.success(
            CandidateRevision(
                candidate_id=uuid4(),
                run_id=run_id,
                tool_call_id=f"same-{self.generated}",
                revision=1 if previous is None else previous.revision + 1,
                parent_candidate_id=previous.candidate_id if previous else None,
                plan_id=plan.plan_id,
                framework=Framework.QISKIT,
                source=self.SOURCE,
                source_fingerprint=program.fingerprint,
            )
        )

    async def run_execution(self, _run_id, _plan, candidate):
        self.calls.append("execute")
        return SimplePortResult.success(
            ExecutionEvidence(
                execution_id=uuid4(),
                candidate_id=candidate.candidate_id,
                source_fingerprint=candidate.source_fingerprint,
                environment_fingerprint="e" * 64,
                sandbox_provider="test",
                exit_code=1,
                failure_kind=ExecutionFailureKind.CODE_ERROR,
                duration_ms=5,
                result={},
                observation={"evidence_error": "FINAL_CIRCUIT is None"},
            )
        )

    async def check_contract(self, _run_id, _plan, _candidate, _execution):
        self.calls.append("check")
        return SimplePortResult.success(BasicContractResult(passed=True))


async def test_a_generator_that_repeats_itself_replans_then_ends_finitely():
    ports = AlwaysTheSameSource()
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=8),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.FAILED
    assert outcome.failure is not None
    assert outcome.failure.code == "candidate_not_converging"
    assert outcome.failure.retryable is False
    assert outcome.failure.details["occurrences"] == 4

    # A third copy proves code-only repair is stuck, but unused plan budget can
    # still change the approach. One final replan is attempted; if that also emits
    # the same bytes, the run stops well before spending all eight candidates.
    assert ports.generated == 4
    assert outcome.counters.plan_attempts == 3
    assert ports.calls.count("execute") == 2


async def test_a_replan_can_escape_a_repeated_source_dead_end():
    class ChangesApproachAfterReplan(AlwaysTheSameSource):
        async def generate(self, run_id, plan, previous, feedback):
            if plan.revision < 3:
                return await super().generate(run_id, plan, previous, feedback)
            return await FakePorts.generate(self, run_id, plan, previous, feedback)

        async def run_execution(self, run_id, plan, candidate):
            if candidate.source == self.SOURCE:
                return await super().run_execution(run_id, plan, candidate)
            return await FakePorts.run_execution(self, run_id, plan, candidate)

    ports = ChangesApproachAfterReplan()
    outcome = await SimpleCircuitPipeline(
        ports=ports,
        budget=SimplePipelineBudget(max_generation_attempts=8),
    ).run(uuid4())

    assert outcome.status is SimplePipelineStatus.SUCCEEDED
    assert outcome.plan is not None and outcome.plan.revision == 3
    assert outcome.candidate is not None and outcome.candidate.revision == 4
    assert outcome.counters.generation_attempts == 4


async def test_two_identical_candidates_are_not_treated_as_a_dead_loop():
    """Refusing at two would break a legitimate path, and did.

    A blocked review can ask for a repair, the generator can return the same
    source, and the reviewer can then pass it — `test_production_ports_
    regenerate_after_a_blocked_review` in the worker suite exercises exactly
    that. Two occurrences have an innocent explanation; three do not.
    """
    seen: dict[tuple[str, str], int] = {}
    plan = _plan_revision(uuid4(), 1)
    program = FrameworkProgram(framework=Framework.QISKIT, source=AlwaysTheSameSource.SOURCE)

    def _candidate(revision: int, parent) -> CandidateRevision:
        return CandidateRevision(
            candidate_id=uuid4(),
            run_id=uuid4(),
            tool_call_id=f"c-{revision}",
            revision=revision,
            parent_candidate_id=parent,
            plan_id=uuid4(),
            framework=Framework.QISKIT,
            source=AlwaysTheSameSource.SOURCE,
            source_fingerprint=program.fingerprint,
        )

    first = _candidate(1, None)
    assert SimpleCircuitPipeline._repeat_candidate_failure(plan, first, seen) is None
    second = _candidate(2, first.candidate_id)
    assert SimpleCircuitPipeline._repeat_candidate_failure(plan, second, seen) is None
    third = _candidate(3, second.candidate_id)
    assert SimpleCircuitPipeline._repeat_candidate_failure(plan, third, seen) is not None


def test_same_source_is_evaluated_again_after_a_material_plan_change():
    """A repaired success criterion must not blacklist otherwise correct code."""

    run_id = uuid4()
    first_plan = _plan_revision(run_id, 1)
    revised_plan = first_plan.plan.model_copy(update={"expected_runtime_sec": 11})
    revised_fingerprint = hashlib.sha256(
        json.dumps(
            revised_plan.model_dump(mode="json"),
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()
    second_plan = PlanRevision(
        plan_id=uuid4(),
        run_id=run_id,
        revision=2,
        parent_plan_id=first_plan.plan_id,
        plan=revised_plan,
        plan_fingerprint=revised_fingerprint,
        replan_reason="correct the invalid success criterion",
    )
    program = FrameworkProgram(framework=Framework.QISKIT, source=AlwaysTheSameSource.SOURCE)
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=run_id,
        tool_call_id="same-source",
        revision=1,
        plan_id=first_plan.plan_id,
        framework=Framework.QISKIT,
        source=AlwaysTheSameSource.SOURCE,
        source_fingerprint=program.fingerprint,
    )
    seen: dict[tuple[str, str], int] = {}

    assert SimpleCircuitPipeline._repeat_candidate_failure(first_plan, candidate, seen) is None
    assert SimpleCircuitPipeline._repeat_candidate_failure(first_plan, candidate, seen) is None
    assert SimpleCircuitPipeline._repeat_candidate_failure(first_plan, candidate, seen) is not None
    assert SimpleCircuitPipeline._repeat_candidate_failure(second_plan, candidate, seen) is None


def test_different_source_never_trips_the_detector():
    seen: dict[tuple[str, str], int] = {}
    plan = _plan_revision(uuid4(), 1)
    for revision in range(1, 9):
        source = f"FINAL_CIRCUIT = {revision}\nRESULT = {{}}\n"
        program = FrameworkProgram(framework=Framework.QISKIT, source=source)
        candidate = CandidateRevision(
            candidate_id=uuid4(),
            run_id=uuid4(),
            tool_call_id=f"c-{revision}",
            revision=1,
            plan_id=uuid4(),
            framework=Framework.QISKIT,
            source=source,
            source_fingerprint=program.fingerprint,
        )
        assert SimpleCircuitPipeline._repeat_candidate_failure(plan, candidate, seen) is None
