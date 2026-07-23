"""Step 13 seeds exercised against the production strict-routing policy."""

import builtins
import sys
from types import SimpleNamespace
from uuid import uuid4

from majorana_agent import CandidateRevision, ExecutionEvidence
from majorana_contracts.enums import (
    Algorithm,
    EvidenceStrength,
    Framework,
    RetryTarget,
    RunMode,
    RunStatus,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
    evidence_strength_of,
)
from majorana_contracts.plan import Plan
from majorana_evals import RoutingOutcome, load_seeded_corpus, score_seeded_corpus
from majorana_frameworks import FrameworkProgram
from majorana_worker import handlers
from majorana_worker.agent_ports import SemanticReviewResult, StrictEvidenceVerifier
from majorana_worker.context import RunContext


def _cases():
    from pathlib import Path

    return {
        case.id: case
        for case in load_seeded_corpus(Path(__file__).parents[3] / "evals" / "seeded-mistakes")
    }


def _route(
    checks: list[dict],
    *,
    algorithm: Algorithm = Algorithm.BELL,
    semantic: SemanticReviewResult | None = None,
):
    verifier = StrictEvidenceVerifier()
    verifier.check = lambda _execution, _plan: checks
    candidate = SimpleNamespace(framework=Framework.QISKIT)
    execution = SimpleNamespace(result={})
    plan = SimpleNamespace(algorithm=algorithm, expected_output_keys=[])
    return verifier.verify(
        candidate,
        execution,
        plan,
        semantic
        or SemanticReviewResult(
            decision=SemanticReviewDecision.READY,
            critic={},
            reason_code="semantic_ready",
        ),
        [],
    )


def _assert_seeded_route(case_id: str, output) -> None:
    expected = _cases()[case_id].expected
    assert output.decision is expected.decision
    assert output.failure_class is expected.failure_class
    assert (output.retry_target or RetryTarget.NONE) is expected.retry_target
    assert evidence_strength_of(output.deterministic_checks) is expected.evidence_strength


def test_seeded_physical_pass_and_candidate_defect_use_real_strict_router():
    passed = _route([{"method": "bell_state_property", "result": "pass"}])
    _assert_seeded_route("v2-01-bell-ghz-pass", passed)
    assert passed.candidate_defect_observed is False
    assert evidence_strength_of(passed.deterministic_checks) is EvidenceStrength.PHYSICAL

    failed = _route([{"method": "bell_state_property", "result": "fail"}])
    _assert_seeded_route("v2-02-wrong-relative-phase", failed)
    assert failed.candidate_defect_observed is True
    assert failed.retry_target is RetryTarget.CODE_GENERATION


def test_seeded_verifier_failure_retains_candidate_as_inconclusive():
    semantic = SemanticReviewResult(
        decision=SemanticReviewDecision.INCONCLUSIVE,
        critic={"failed_checks": ["critic_output_schema"]},
        failure_class=VerificationFailureClass.VERIFIER_FAILURE,
        retry_target=RetryTarget.VERIFICATION,
        reason_code="semantic_reviewer_malformed",
    )
    output = _route([{"method": "structural", "result": "pass"}], semantic=semantic)

    _assert_seeded_route("v2-05-critic-malformed-twice", output)
    assert output.decision is VerifierDecision.INCONCLUSIVE
    assert output.candidate_defect_observed is False


def test_seeded_capability_limit_and_evidence_gap_remain_distinct():
    checks = [{"method": "structural", "result": "pass"}]
    structural_only = _route(checks, algorithm=Algorithm.BELL)
    _assert_seeded_route("v2-07-structural-only", structural_only)
    assert structural_only.failure_class is VerificationFailureClass.EVIDENCE_GAP
    assert structural_only.candidate_defect_observed is False


def _dynamic_plan() -> Plan:
    return Plan.model_validate(
        {
            "domain": "quantum information",
            "framework": "qiskit",
            "algorithm": "other",
            "problem_summary": "Run a feed-forward dynamic circuit",
            "algorithm_rationale": "Classical control is required by the request",
            "parameters": {},
            "qubits_estimate": 2,
            "expected_runtime_sec": 1,
            "success_criteria": {"primary_metric": "counts"},
            "expected_output_keys": ["counts"],
            "verification_plan": {"methods": ["statistical"]},
        }
    )


def _observer_scope(namespace, observation):
    return {
        "_majorana_namespace": namespace,
        "_majorana_observation": observation,
        "_majorana_exception": builtins.Exception,
        "_majorana_getattr": builtins.getattr,
        "_majorana_hasattr": builtins.hasattr,
        "_majorana_int": builtins.int,
        "_majorana_len": builtins.len,
        "_majorana_list": builtins.list,
        "_majorana_str": builtins.str,
        "_majorana_sum": builtins.sum,
        "_majorana_type": builtins.type,
    }


def test_dynamic_required_check_uses_framework_observer_output(monkeypatch):
    source = (
        "from qiskit import QuantumCircuit, ClassicalRegister, QuantumRegister\n"
        "q = QuantumRegister(3)\n"
        "m = ClassicalRegister(2, 'm')\n"
        "out = ClassicalRegister(1, 'out')\n"
        "qc = QuantumCircuit(q, m, out)\n"
        "qc.h(1)\n"
        "qc.cx(1, 2)\n"
        "qc.cx(0, 1)\n"
        "qc.h(0)\n"
        "qc.measure(0, 0)\n"
        "qc.measure(1, 1)\n"
        "with qc.if_test((m, 1)):\n"
        "    qc.x(2)\n"
        "with qc.if_test((m, 3)):\n"
        "    qc.z(2)\n"
        "qc.measure(2, 2)\n"
        "FINAL_CIRCUIT = qc\n"
        "RESULT = {'counts': {'0': 1024}}\n"
    )
    program = FrameworkProgram(Framework.QISKIT, source)
    namespace = {}
    exec(program.source, namespace)
    observation = {}
    monkeypatch.setitem(sys.modules, "qiskit_aer", None)
    observer_scope = _observer_scope(namespace, observation)
    exec(program.trusted_setup(circuit_expected=True), observer_scope)
    exec(program.trusted_observer(circuit_expected=True), observer_scope)

    assert observation["native_statevector_error"].startswith(
        "not unitary up to final measurements"
    )
    assert observation["native_sampled_error"] == "qiskit_aer unavailable"
    assert "native_statevector" not in observation
    assert "native_sampled" not in observation

    fingerprint = program.fingerprint
    candidate = CandidateRevision(
        candidate_id=uuid4(),
        run_id=uuid4(),
        tool_call_id="simulate-dynamic-1",
        revision=1,
        plan_id=uuid4(),
        framework=Framework.QISKIT,
        source=source,
        source_fingerprint=fingerprint,
    )
    execution = ExecutionEvidence(
        execution_id=uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=fingerprint,
        environment_fingerprint="e" * 64,
        sandbox_provider="trusted-test",
        exit_code=0,
        duration_ms=1,
        result=namespace["RESULT"],
        observation=observation,
    )
    semantic = SemanticReviewResult(
        decision=SemanticReviewDecision.READY,
        critic={},
        reason_code="semantic_ready",
    )

    output = StrictEvidenceVerifier().verify(candidate, execution, _dynamic_plan(), semantic, [])

    unavailable = [
        check for check in output.deterministic_checks if check["result"] == "unavailable"
    ]
    assert unavailable
    assert unavailable[0]["details"]["capability_limited"] is True
    _assert_seeded_route("v2-06-dynamic-unsupported", output)
    assert output.candidate_defect_observed is False
    assert candidate.revision == 1


async def test_resource_exhaustion_observation_is_not_materialized_and_scores():
    candidate = SimpleNamespace(
        candidate_id=uuid4(), revision=1, framework=Framework.QISKIT, source="source"
    )

    class AgentStore:
        async def list_candidates(self, _run_id):
            return [candidate]

        async def verification_for(self, _run_id, _candidate_id):
            return None

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return None

    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, event_type, payload, *, event_id=None):
            self.events.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.status = status
            self.payload = payload
            self.fields = fields
            return status

    sink = Sink()
    run_store = RunStore()
    ctx = RunContext(
        run_id=uuid4(),
        task_prompt="large circuit",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )

    status = await handlers._finish_resource_exhausted(
        ctx, run_store, AgentStore(), "resource_exhausted"
    )
    summary = run_store.payload["verification_summary"]
    case = _cases()["v2-08-resource-exhaustion"]
    expected = case.expected
    observation = RoutingOutcome(
        decision=summary["decision"],
        failure_class=summary["failure_class"],
        retry_target=summary["retry_target"],
        candidate_revisions_consumed=len(await AgentStore().list_candidates(ctx.run_id)),
        evidence_strength=summary["evidence_strength"],
        materialized=False,
        public_eligible=False,
    )
    report = score_seeded_corpus([case], {case.id: observation})

    assert status is RunStatus.FAILED
    assert summary["decision"] == expected.decision
    assert summary["failure_class"] == expected.failure_class
    assert summary["retry_target"] == expected.retry_target
    assert summary["candidate_defect_observed"] is False
    assert expected.materialized is False
    assert candidate.revision == expected.candidate_revisions_consumed
    assert report.passed == report.total == 1
