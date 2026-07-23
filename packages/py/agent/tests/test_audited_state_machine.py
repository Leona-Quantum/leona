from uuid import UUID, uuid4

import pytest
from majorana_agent import (
    AgentBudget,
    AgentPolicy,
    AgentState,
    CircuitToolset,
    ConversionEvidence,
    ExecutionFailureKind,
    ExecutionOutput,
    MemoryAgentStore,
    MaterializedArtifact,
    SemanticReviewOutput,
    ToolBroker,
    ToolCall,
    ToolName,
    VerificationOutput,
)
from majorana_agent.broker import _ALLOWED
from majorana_contracts.enums import (
    Algorithm,
    Framework,
    RetryTarget,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_contracts.plan import Plan


def _plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": Algorithm.BELL,
            "problem_summary": "Build a Bell state",
            "algorithm_rationale": "Entanglement matches the request",
            "parameters": {"shots": 1000, "seed": 7},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
        }
    )


class Planner:
    async def create_plan(self, _run_id):
        return _plan()

    async def revise_plan(self, _run_id, previous, _feedback):
        return previous


class Executor:
    calls = 0

    async def run_candidate(self, _candidate, _plan):
        self.calls += 1
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=0,
            duration_ms=1,
            result={"counts": {"00": 5, "11": 5}},
            observation={},
        )


class ResourceLimitExecutor:
    """A plan whose estimate does not fit the sandbox lane, rejected pre-flight."""

    async def run_candidate(self, _candidate, _plan):
        return ExecutionOutput(
            environment_fingerprint="1" * 64,
            sandbox_provider="test",
            exit_code=75,
            duration_ms=0,
            result={},
            observation={},
            failure_kind=ExecutionFailureKind.RESOURCE_LIMIT,
        )


class ReadyReviewer:
    calls = 0

    async def review(self, _candidate, _execution, _plan):
        self.calls += 1
        return SemanticReviewOutput(
            decision=SemanticReviewDecision.READY,
            feedback={"critic": {"decision": "pass"}},
            reason_code="semantic_ready",
            retry_target=RetryTarget.NONE,
        )


class UncertainReviewer:
    async def review(self, _candidate, _execution, _plan):
        return SemanticReviewOutput(
            decision=SemanticReviewDecision.INCONCLUSIVE,
            feedback={"critic": {"confidence": "low"}},
            reason_code="semantic_evidence_gap",
            failure_class=VerificationFailureClass.EVIDENCE_GAP,
            retry_target=RetryTarget.VERIFICATION,
        )


class FlakyStrictVerifier:
    def __init__(self, *, fail_once=False):
        self.fail_once = fail_once
        self.calls = 0

    async def verify_strict(self, _candidate, _execution, _plan, _review):
        self.calls += 1
        if self.fail_once and self.calls == 1:
            raise RuntimeError("trusted verifier temporarily unavailable")
        return VerificationOutput(
            decision=VerifierDecision.PASS,
            deterministic_checks=[{"method": "bell_state_property", "result": "pass"}],
            reason_code="strict_pass",
            retry_target=RetryTarget.NONE,
        )


class InconclusiveStrictVerifier:
    async def verify_strict(self, _candidate, _execution, _plan, _review):
        return VerificationOutput(
            decision=VerifierDecision.INCONCLUSIVE,
            deterministic_checks=[{"method": "statistical", "result": "unavailable"}],
            reason_code="strict_inconclusive",
            retry_target=RetryTarget.VERIFICATION,
        )


class PlanDefectStrictVerifier:
    async def verify_strict(self, _candidate, _execution, _plan, _review):
        return VerificationOutput(
            decision=VerifierDecision.FAIL,
            deterministic_checks=[
                {
                    "method": "success_criteria",
                    "result": "fail",
                    "details": {"fault": "plan"},
                }
            ],
            reason_code="strict_plan_defect",
            failure_class=VerificationFailureClass.PLAN_DEFECT,
            retry_target=RetryTarget.PLANNING,
        )


class Converter:
    async def convert(self, *_args):
        return None, "unavailable"


class AvailableConverter:
    async def convert(self, *_args):
        return "OPENQASM 3.0;\nqubit q;", None


class Publisher:
    async def materialize(self, candidate, *_args):
        return MaterializedArtifact(
            artifact_id=uuid4(),
            version_id=uuid4(),
            version_seq=1,
            candidate_id=candidate.candidate_id,
            framework=candidate.framework,
            source_fingerprint=candidate.source_fingerprint,
        )


def _stack(*, store=None, reviewer=None, strict=None, converter=None, budget=None, executor=None):
    store = store or MemoryAgentStore()
    reviewer = reviewer or ReadyReviewer()
    strict = strict or FlakyStrictVerifier()
    tools = CircuitToolset(
        store=store,
        framework=Framework.QISKIT,
        planner=Planner(),
        executor=executor or Executor(),
        reviewer=reviewer,
        strict_verifier=strict,
        converter=converter or Converter(),
        materializer=Publisher(),
    )
    broker = ToolBroker(
        store=store,
        policy=AgentPolicy(framework=Framework.QISKIT, budget=budget or AgentBudget()),
        handlers=tools.handlers(),
    )
    return store, broker, reviewer, strict


async def _execute_one(store, broker, run_id):
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    return await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="candidate-1",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {}}"},
        ),
    )


def test_allowed_transition_table_is_exhaustive_and_legacy_tools_are_not_live():
    simulation = frozenset(
        {ToolName.SIMULATE_QISKIT, ToolName.SIMULATE_CIRQ, ToolName.SIMULATE_PENNYLANE}
    )
    # Every state reachable after a READY semantic review offers the same three
    # "finishing" choices (strict_verify/convert/materialize) and lets the model
    # pick freely among them, repeatedly — see ALLOWED_TOOLS_BY_STATE's comment.
    finishing = frozenset(
        {ToolName.STRICT_VERIFY, ToolName.CONVERT_TO_OPENQASM, ToolName.MATERIALIZE_ARTIFACT}
    )
    expected = {
        AgentState.NEW: frozenset({ToolName.REQUEST_PLAN}),
        AgentState.PLANNED: simulation,
        AgentState.EXECUTED: frozenset({ToolName.REVIEW_CANDIDATE}),
        AgentState.REVIEWED: frozenset({ToolName.REVIEW_CANDIDATE, ToolName.STRICT_VERIFY}),
        AgentState.READY_FOR_STRICT_VERIFICATION: finishing,
        AgentState.REPAIR_REQUIRED: simulation,
        AgentState.REPLAN_REQUIRED: frozenset({ToolName.REPLAN}),
        AgentState.VERIFIED: finishing,
        AgentState.INCONCLUSIVE: finishing,
        AgentState.QASM_ATTEMPTED: finishing,
    }
    for state in AgentState:
        assert _ALLOWED[state] == expected.get(state, frozenset())
    assert all(
        ToolName.VERIFY_INTENT_ALIGNMENT not in allowed and ToolName.PUBLISH_ARTIFACT not in allowed
        for allowed in _ALLOWED.values()
    )


async def test_strict_and_materialization_cannot_skip_required_boundaries():
    store, broker, _, _ = _stack()
    run_id = uuid4()
    early_strict = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-before-execution",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": str(uuid4())},
        ),
    )
    assert early_strict.error_code == "invalid_transition"
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    before_review = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-before-review",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert before_review.error_code == "invalid_transition"
    materialize = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="materialize-before-verdict",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert materialize.error_code == "invalid_transition"


async def test_verifier_retry_keeps_candidate_execution_and_appends_attempt():
    strict = FlakyStrictVerifier(fail_once=True)
    store, broker, _, _ = _stack(strict=strict)
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    review = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert review.state is AgentState.READY_FOR_STRICT_VERIFICATION
    first = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-1",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert first.state is AgentState.REVIEWED
    assert first.payload["decision"] == "inconclusive"
    second = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-2",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert second.state is AgentState.VERIFIED
    assert second.payload["attempt_seq"] == 2
    assert len(await store.list_candidates(run_id)) == 1
    candidate = await store.latest_candidate(run_id)
    execution = await store.execution_for(run_id, candidate.candidate_id)
    assert (
        first.payload["execution_id"]
        == second.payload["execution_id"]
        == str(execution.execution_id)
    )


async def test_semantic_uncertainty_mechanically_prevents_strict_pass():
    store, broker, _, _ = _stack(reviewer=UncertainReviewer())
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    reviewed = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="uncertain-review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert reviewed.state is AgentState.REVIEWED
    strict = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-would-pass",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert strict.payload["decision"] == "inconclusive"
    assert strict.payload["reason_code"] == "semantic_uncertainty_prevents_pass"
    assert strict.state is AgentState.REVIEWED
    assert await store.verification_for(run_id, UUID(candidate_id)) is None


async def test_terminal_inconclusive_materializes_privately_without_becoming_verified():
    # strict_verify is a certification badge, not a gate: materialization now
    # authorizes off a READY semantic review alone, so this exercises a READY
    # review paired with a strict verifier that independently lands terminal
    # INCONCLUSIVE (not via the review-uncertainty downgrade path).
    store, broker, _, _ = _stack(
        reviewer=ReadyReviewer(),
        strict=InconclusiveStrictVerifier(),
        converter=AvailableConverter(),
        budget=AgentBudget(max_strict_attempts=1),
    )
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="ready-review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    strict = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="terminal-inconclusive",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert strict.state is AgentState.INCONCLUSIVE
    assert await store.verification_for(run_id, UUID(candidate_id)) is None

    conversion = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="inconclusive-conversion",
            name=ToolName.CONVERT_TO_OPENQASM,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert conversion.ok
    assert conversion.payload["status"] == "available"
    latest_strict = await store.latest_strict_verification(run_id, UUID(candidate_id))
    assert latest_strict.decision is VerifierDecision.INCONCLUSIVE

    materialized = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="private-materialization",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": candidate_id},
        ),
    )

    assert materialized.ok
    assert materialized.state is AgentState.MATERIALIZED
    assert store.materializations[0].candidate_id == UUID(candidate_id)
    assert store.publications == []


async def test_unavailable_conversion_does_not_change_pass_verdict():
    store, broker, _, _ = _stack()
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    strict = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert strict.payload["decision"] == "pass"

    conversion = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="unavailable-conversion",
            name=ToolName.CONVERT_TO_OPENQASM,
            arguments={"candidate_id": candidate_id},
        ),
    )

    assert conversion.payload["status"] == "unavailable"
    latest_strict = await store.latest_strict_verification(run_id, UUID(candidate_id))
    assert latest_strict.decision is VerifierDecision.PASS


async def test_strict_fail_is_a_badge_not_a_gate_even_for_a_plan_defect():
    # strict_verify no longer drives control flow, including for a PLAN_DEFECT
    # finding: review_candidate already decided (READY) that this candidate is
    # good enough to hand back, so a strict FAIL stays in
    # READY_FOR_STRICT_VERIFICATION — materialize remains reachable, and REPLAN
    # (which required landing in REPLAN_REQUIRED) is no longer authorized.
    store, broker, _, _ = _stack(strict=PlanDefectStrictVerifier())
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    strict = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict-plan-defect",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert strict.state is AgentState.READY_FOR_STRICT_VERIFICATION
    materialized = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="materialize-failed-verdict",
            name=ToolName.MATERIALIZE_ARTIFACT,
            arguments={"candidate_id": candidate_id},
        ),
    )
    assert materialized.ok
    assert store.materializations != []
    rejected_replan = await broker.dispatch(
        run_id, ToolCall(tool_call_id="replan", name=ToolName.REPLAN)
    )
    assert rejected_replan.error_code == "invalid_transition"


async def test_execution_resource_limit_authorizes_replan():
    # Live run 019f8dd0: a plan whose qubit/memory estimate did not fit the
    # sandbox lane was correctly rejected pre-flight (exit_code 75, no sandbox
    # invoked) and correctly routed to REPLAN_REQUIRED — but replan itself
    # rejected every attempt with replan_not_authorized, because the
    # authorization check only recognized plan-defect feedback shaped like a
    # review_candidate/strict_verify result (failure_class=PLAN_DEFECT). A
    # simulate_* execution failure never sets failure_class — that key belongs
    # to verification, not raw execution — so a resource-limit rejection could
    # never satisfy it. The run burned its entire plan-attempt budget on
    # rejected replan calls and died with plan_attempt_budget_exhausted
    # without ever getting a second chance at a smaller plan.
    store, broker, _, _ = _stack(executor=ResourceLimitExecutor())
    run_id = uuid4()
    await broker.dispatch(run_id, ToolCall(tool_call_id="plan", name=ToolName.REQUEST_PLAN))
    rejected_execution = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="oversized-candidate",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {}}"},
        ),
    )
    assert rejected_execution.ok
    assert rejected_execution.state is AgentState.REPLAN_REQUIRED
    replanned = await broker.dispatch(run_id, ToolCall(tool_call_id="replan", name=ToolName.REPLAN))
    assert replanned.ok
    assert replanned.payload["revision"] == 2


async def test_new_source_requires_fresh_execution_and_review():
    store, broker, _, _ = _stack()
    run_id = uuid4()
    first = await _execute_one(store, broker, run_id)
    first_id = first.payload["candidate_id"]
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="review-1",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": first_id},
        ),
    )
    await store.set_state(run_id, AgentState.REPAIR_REQUIRED)
    second = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="candidate-2",
            name=ToolName.SIMULATE_QISKIT,
            arguments={"source": "FINAL_CIRCUIT = object()\nRESULT = {'counts': {'11': 1}}"},
        ),
    )
    assert second.payload["candidate_id"] != first_id
    rejected = await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="reuse-old-review",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": second.payload["candidate_id"]},
        ),
    )
    assert rejected.error_code == "invalid_transition"
    assert await store.latest_semantic_review(run_id, UUID(second.payload["candidate_id"])) is None


async def test_conversion_rejects_a_stale_source_fingerprint():
    store, broker, _, _ = _stack()
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="review",
            name=ToolName.REVIEW_CANDIDATE,
            arguments={"candidate_id": candidate_id},
        ),
    )
    await broker.dispatch(
        run_id,
        ToolCall(
            tool_call_id="strict",
            name=ToolName.STRICT_VERIFY,
            arguments={"candidate_id": candidate_id},
        ),
    )
    with pytest.raises(ValueError, match="fingerprint"):
        await store.add_conversion(
            ConversionEvidence(
                candidate_id=UUID(candidate_id),
                execution_id=uuid4(),
                source_fingerprint="f" * 64,
                status="unavailable",
                reason="test",
            )
        )


class CrashAfterReviewStore(MemoryAgentStore):
    crash = True

    async def append_semantic_review(self, evidence):
        await super().append_semantic_review(evidence)
        if self.crash:
            self.crash = False
            raise RuntimeError("crash after semantic review")


class CrashAfterStrictStore(MemoryAgentStore):
    crash = True

    async def append_strict_verification(self, evidence):
        await super().append_strict_verification(evidence)
        if self.crash:
            self.crash = False
            raise RuntimeError("crash after strict verification")


@pytest.mark.parametrize("boundary", ["review", "strict"])
async def test_restart_at_evidence_boundaries_does_not_duplicate_work(boundary):
    store = CrashAfterReviewStore() if boundary == "review" else CrashAfterStrictStore()
    store, broker, reviewer, strict = _stack(store=store)
    run_id = uuid4()
    simulation = await _execute_one(store, broker, run_id)
    candidate_id = simulation.payload["candidate_id"]
    review_call = ToolCall(
        tool_call_id="review-crash",
        name=ToolName.REVIEW_CANDIDATE,
        arguments={"candidate_id": candidate_id},
    )
    if boundary == "review":
        with pytest.raises(RuntimeError, match="semantic review"):
            await broker.dispatch(run_id, review_call)
        resumed = await broker.dispatch(run_id, review_call)
        assert resumed.ok and reviewer.calls == 1
        return
    review = await broker.dispatch(run_id, review_call)
    assert review.ok
    strict_call = ToolCall(
        tool_call_id="strict-crash",
        name=ToolName.STRICT_VERIFY,
        arguments={"candidate_id": candidate_id},
    )
    with pytest.raises(RuntimeError, match="strict verification"):
        await broker.dispatch(run_id, strict_call)
    resumed = await broker.dispatch(run_id, strict_call)
    assert resumed.ok and strict.calls == 1
