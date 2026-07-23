import uuid
from types import SimpleNamespace

import pytest
from majorana_agent import SemanticReviewEvidence, StrictVerificationAttempt
from majorana_contracts.enums import (
    EvidenceStrength,
    Framework,
    RetryTarget,
    RunMode,
    RunStatus,
    SemanticReviewDecision,
    VerificationFailureClass,
    VerifierDecision,
)
from majorana_llm import PLAN_SYSTEM_PROMPT, QUANTUM_AGENT_SYSTEM_PROMPT, LLMResponse
from majorana_sandbox import LocalSubprocessSandbox
from majorana_worker import handlers
from majorana_worker.context import RunContext


async def test_dead_letter_handler_commits_terminal_sequence_once(monkeypatch):
    commits = 0
    observed = {}

    class Session:
        async def commit(self):
            nonlocal commits
            commits += 1

    async def fail_run(scope, session, run_id, **kwargs):
        observed.update(scope=scope, session=session, run_id=run_id, **kwargs)
        return True

    monkeypatch.setattr(handlers.runs_repo, "fail_run_from_dead_letter", fail_run, raising=False)
    run_id = uuid.uuid4()
    payload = {
        "run_id": str(run_id),
        "user_id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
    }

    await handlers.handle_run_dead_letter(Session(), payload, "worker failed")

    assert commits == 1
    assert observed["run_id"] == run_id
    assert observed["error_payload"]["code"] == "job_dead_letter"
    assert "finished_payload" not in observed


def _clear_deploy_markers(monkeypatch):
    for name in ("K_SERVICE", "K_REVISION", "K_CONFIGURATION", "VERCEL", "CI"):
        monkeypatch.delenv(name, raising=False)


def test_default_sandbox_can_use_local_double_only_in_development(monkeypatch):
    _clear_deploy_markers(monkeypatch)
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_SANDBOX", "local")

    assert isinstance(handlers._default_sandbox(), LocalSubprocessSandbox)


def test_default_sandbox_rejects_local_double_outside_development(monkeypatch):
    _clear_deploy_markers(monkeypatch)
    monkeypatch.setenv("MAJORANA_ENV", "production")
    monkeypatch.setenv("MAJORANA_SANDBOX", "local")

    with pytest.raises(RuntimeError, match="requires MAJORANA_ENV=development"):
        handlers._default_sandbox()


def test_default_sandbox_rejects_local_double_in_ci(monkeypatch):
    _clear_deploy_markers(monkeypatch)
    monkeypatch.setenv("MAJORANA_ENV", "development")
    monkeypatch.setenv("MAJORANA_SANDBOX", "local")
    monkeypatch.setenv("CI", "true")

    with pytest.raises(RuntimeError, match="requires MAJORANA_ENV=development"):
        handlers._default_sandbox()


def test_default_sandbox_rejects_unknown_provider(monkeypatch):
    monkeypatch.setenv("MAJORANA_SANDBOX", "unknown")

    with pytest.raises(RuntimeError, match="must be 'vercel' or 'local'"):
        handlers._default_sandbox()


@pytest.mark.parametrize(
    ("raw", "expected"),
    [(None, True), ("1", True), ("true", True), ("0", False), ("off", False)],
)
def test_inconclusive_materialization_rollout_flag(monkeypatch, raw, expected):
    name = "MAJORANA_INCONCLUSIVE_MATERIALIZATION_ENABLED"
    if raw is None:
        monkeypatch.delenv(name, raising=False)
    else:
        monkeypatch.setenv(name, raw)
    assert handlers._enabled(name, default=True) is expected


def test_invalid_rollout_flag_fails_closed(monkeypatch):
    name = "MAJORANA_INCONCLUSIVE_MATERIALIZATION_ENABLED"
    monkeypatch.setenv(name, "sometimes")
    with pytest.raises(RuntimeError, match="boolean feature flag"):
        handlers._enabled(name, default=True)


def test_verification_metrics_separate_decision_route_and_error(monkeypatch):
    class Counter:
        def __init__(self):
            self.calls = []

        def add(self, value, attributes):
            self.calls.append((value, attributes))

    decisions = Counter()
    routes = Counter()
    errors = Counter()
    monkeypatch.setattr(handlers, "_verification_decisions", decisions)
    monkeypatch.setattr(handlers, "_verification_routes", routes)
    monkeypatch.setattr(handlers, "_verification_errors", errors)

    handlers._record_verification_summary(
        {
            "decision": "inconclusive",
            "reason_code": "strict_verifier_error",
            "failure_class": "verifier_failure",
            "checks": [{"method": "structural", "result": "error"}],
        }
    )

    assert decisions.calls == [(1, {"decision": "inconclusive"})]
    assert routes.calls[0][1]["route"] == "verifier_failure"
    assert errors.calls == [(1, {"route": "verifier_failure"})]


def test_verification_metrics_collapse_arbitrary_labels_to_closed_buckets(monkeypatch):
    class Counter:
        def __init__(self):
            self.calls = []

        def add(self, value, attributes):
            self.calls.append((value, attributes))

    decisions = Counter()
    routes = Counter()
    monkeypatch.setattr(handlers, "_verification_decisions", decisions)
    monkeypatch.setattr(handlers, "_verification_routes", routes)

    for suffix in ("first-user-shaped-value", "second-distinct-value"):
        handlers._record_verification_summary(
            {
                "decision": f"unknown-{suffix}",
                "reason_code": suffix,
                "failure_class": f"unknown-{suffix}",
                "checks": [],
            }
        )

    assert decisions.calls == [
        (1, {"decision": "unknown"}),
        (1, {"decision": "unknown"}),
    ]
    assert routes.calls == [
        (1, {"decision": "unknown", "route": "other", "failure_class": "other"}),
        (1, {"decision": "unknown", "route": "other", "failure_class": "other"}),
    ]


class _RecordingSink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload):
        self.events.append((event_type, payload))


async def test_materialized_inconclusive_finishes_successfully_without_best_effort():
    run_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    review = SemanticReviewEvidence(
        review_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint="a" * 64,
        attempt_seq=1,
        decision=SemanticReviewDecision.INCONCLUSIVE,
        reason_code="semantic_evidence_gap",
        failure_class=VerificationFailureClass.EVIDENCE_GAP,
        retry_target=RetryTarget.VERIFICATION,
    )
    strict = StrictVerificationAttempt(
        attempt_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        semantic_review_id=review.review_id,
        source_fingerprint="a" * 64,
        attempt_seq=1,
        decision=VerifierDecision.INCONCLUSIVE,
        evidence_strength=EvidenceStrength.STRUCTURAL,
        reason_code="unsupported_dynamic_circuit",
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.CAPABILITY_LIMIT,
        retry_target=RetryTarget.NONE,
        unverified_claims=["dynamic-circuit behavior"],
        verifier_version="verification-v2",
    )

    class Sink:
        def __init__(self):
            self.events = {}

        async def emit(self, event_type, payload, *, event_id=None):
            self.events.setdefault(event_id, (event_type, payload))

    class AgentStore:
        async def latest_candidate(self, _run_id):
            return type(
                "Candidate",
                (),
                {"candidate_id": candidate_id, "source_fingerprint": "a" * 64},
            )()

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return strict

        async def latest_semantic_review(self, _run_id, _candidate_id):
            return review

        async def published_verification(self, _run_id):
            raise AssertionError("strict terminal evidence must be authoritative")

    class RunStore:
        def __init__(self):
            self.finishes = []

        async def finish(self, status, payload, **kwargs):
            self.finishes.append((status, payload, kwargs))
            return status

    sink = Sink()
    run_store = RunStore()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="dynamic circuit",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )

    result = await handlers._finish_materialized_agent(ctx, run_store, AgentStore())

    assert result is RunStatus.SUCCEEDED
    assert sink.events == {}
    status, payload, fields = run_store.finishes[0]
    assert status is RunStatus.SUCCEEDED
    assert payload["status"] is RunStatus.SUCCEEDED
    assert payload["verifier_decision"] == "inconclusive"
    assert payload["verification_summary"]["candidate_defect_observed"] is False
    assert fields["verifier_decision"] == "inconclusive"
    assert fields["verification_summary"] == payload["verification_summary"]


async def test_materialized_terminal_rejects_stale_candidate_fingerprint(monkeypatch):
    candidate_id = uuid.uuid4()
    calls = []
    counter = SimpleNamespace(add=lambda value, attributes: calls.append((value, attributes)))
    monkeypatch.setattr(handlers, "_fingerprint_mismatches", counter)

    class AgentStore:
        async def latest_candidate(self, _run_id):
            return type(
                "Candidate",
                (),
                {"candidate_id": candidate_id, "source_fingerprint": "b" * 64},
            )()

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return type("Strict", (), {"source_fingerprint": "a" * 64})()

        async def latest_semantic_review(self, _run_id, _candidate_id):
            return object()

        async def published_verification(self, _run_id):
            raise AssertionError("strict evidence must remain authoritative")

    ctx = RunContext(
        run_id=uuid.uuid4(),
        task_prompt="stale evidence",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=object(),
    )

    with pytest.raises(RuntimeError, match="stale candidate fingerprint"):
        await handlers._finish_materialized_agent(ctx, object(), AgentStore())
    assert calls == [(1, {"boundary": "candidate_to_strict"})]


async def test_materialized_terminal_rejects_mismatched_latest_review():
    candidate_id = uuid.uuid4()
    strict = type(
        "Strict",
        (),
        {
            "source_fingerprint": "a" * 64,
            "semantic_review_id": uuid.uuid4(),
        },
    )()
    review = type(
        "Review",
        (),
        {"review_id": uuid.uuid4(), "source_fingerprint": "a" * 64},
    )()

    class AgentStore:
        async def latest_candidate(self, _run_id):
            return type(
                "Candidate",
                (),
                {"candidate_id": candidate_id, "source_fingerprint": "a" * 64},
            )()

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return strict

        async def latest_semantic_review(self, _run_id, _candidate_id):
            return review

        async def published_verification(self, _run_id):
            raise AssertionError("strict evidence must remain authoritative")

    ctx = RunContext(
        run_id=uuid.uuid4(),
        task_prompt="mismatched evidence",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=object(),
    )

    with pytest.raises(RuntimeError, match="not bound to the latest review"):
        await handlers._finish_materialized_agent(ctx, object(), AgentStore())


async def test_repo_run_store_terminalizes_with_one_commit_and_stable_event_id(monkeypatch):
    run_id = uuid.uuid4()
    commits = 0
    captured = {}

    class Session:
        async def commit(self):
            nonlocal commits
            commits += 1

    async def finish_run(scope, session, observed_run_id, status, **kwargs):
        captured.update(
            scope=scope,
            session=session,
            run_id=observed_run_id,
            status=status,
            **kwargs,
        )
        return status

    monkeypatch.setattr(handlers.runs_repo, "finish_run", finish_run)
    session = Session()
    scope = object()
    store = handlers.RepoRunStateStore(scope, session, run_id)

    result = await store.finish(
        RunStatus.FAILED,
        {"status": RunStatus.FAILED, "reason_code": "provider_failed"},
    )

    assert result is RunStatus.FAILED
    assert commits == 1
    assert captured["event_id"] == uuid.uuid5(run_id, "run.finished")
    assert captured["event_payload"]["reason_code"] == "provider_failed"


async def test_resource_exhaustion_emits_best_effort_and_typed_terminal(monkeypatch):
    run_id = uuid.uuid4()
    best_effort = []

    async def emit_best_effort(ctx, agent_store, reason):
        best_effort.append((ctx.run_id, agent_store, reason))

    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, event_type, payload, *, event_id=None):
            self.events.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = (status, payload, fields)
            return status

    monkeypatch.setattr(handlers, "_emit_best_effort", emit_best_effort)
    sink = Sink()
    run_store = RunStore()
    agent_store = object()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="large circuit",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )

    result = await handlers._finish_resource_exhausted(
        ctx, run_store, agent_store, "sandbox_memory_exhausted"
    )

    assert result is RunStatus.FAILED
    assert best_effort == [(run_id, agent_store, "sandbox_memory_exhausted")]
    assert sink.events[0][1]["code"] == "resource_exhausted"
    status, payload, fields = run_store.terminal
    assert status is RunStatus.FAILED
    assert payload["reason_code"] == "resource_exhausted"
    assert payload["verification_summary"]["candidate_defect_observed"] is False
    assert fields["verifier_decision"] == "inconclusive"
    assert fields["verification_summary"] == payload["verification_summary"]


@pytest.mark.parametrize(
    ("failure_class", "retry_target", "candidate_defect_observed"),
    [
        (VerificationFailureClass.CANDIDATE_DEFECT, RetryTarget.CODE_GENERATION, True),
        (VerificationFailureClass.PLAN_DEFECT, RetryTarget.PLANNING, False),
    ],
)
async def test_failed_agent_persists_bound_strict_fail_summary(
    monkeypatch, failure_class, retry_target, candidate_defect_observed
):
    run_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    fingerprint = "a" * 64
    candidate = SimpleNamespace(
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
    )
    execution = SimpleNamespace(
        execution_id=execution_id,
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
    )
    review = SemanticReviewEvidence(
        review_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        reason_code="semantic_ready",
        retry_target=RetryTarget.NONE,
    )
    strict = StrictVerificationAttempt(
        attempt_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        semantic_review_id=review.review_id,
        source_fingerprint=fingerprint,
        attempt_seq=1,
        checks=[{"method": "success_criteria", "result": "fail"}],
        decision=VerifierDecision.FAIL,
        evidence_strength=EvidenceStrength.STRUCTURAL,
        reason_code="strict_candidate_defect",
        candidate_defect_observed=candidate_defect_observed,
        failure_class=failure_class,
        retry_target=retry_target,
        verifier_version="verification-v2",
    )

    class AgentStore:
        async def latest_candidate(self, _run_id):
            return candidate

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return strict

        async def execution_for(self, _run_id, _candidate_id):
            return execution

        async def latest_semantic_review(self, _run_id, _candidate_id):
            return review

    class Sink:
        async def emit(self, *_args, **_kwargs):
            return None

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = status, payload, fields
            return status

    async def no_best_effort(*_args):
        return None

    monkeypatch.setattr(handlers, "_emit_best_effort", no_best_effort)
    ctx = RunContext(
        run_id=run_id,
        task_prompt="failing candidate",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=Sink(),
    )
    run_store = RunStore()

    result = await handlers._finish_failed_agent(
        ctx,
        run_store,
        AgentStore(),
        failure_reason="candidate_budget_exhausted",
        failure_message="agent failed",
    )

    assert result is RunStatus.FAILED
    _, payload, fields = run_store.terminal
    assert payload["verification_summary"]["decision"] == "fail"
    assert payload["verification_summary"]["failure_class"] == failure_class.value
    assert fields["verification_summary"] == payload["verification_summary"]
    assert fields["verifier_decision"] == "fail"


async def test_timeout_preserves_already_durable_bound_strict_verdict():
    run_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    execution_id = uuid.uuid4()
    fingerprint = "b" * 64
    candidate = SimpleNamespace(
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
    )
    execution = SimpleNamespace(
        execution_id=execution_id,
        candidate_id=candidate_id,
        source_fingerprint=fingerprint,
    )
    review = SemanticReviewEvidence(
        review_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        source_fingerprint=fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        reason_code="semantic_ready",
        retry_target=RetryTarget.NONE,
    )
    strict = StrictVerificationAttempt(
        attempt_id=uuid.uuid4(),
        candidate_id=candidate_id,
        execution_id=execution_id,
        semantic_review_id=review.review_id,
        source_fingerprint=fingerprint,
        attempt_seq=1,
        checks=[{"method": "success_criteria", "result": "fail"}],
        decision=VerifierDecision.FAIL,
        evidence_strength=EvidenceStrength.STRUCTURAL,
        reason_code="strict_plan_defect",
        candidate_defect_observed=False,
        failure_class=VerificationFailureClass.PLAN_DEFECT,
        retry_target=RetryTarget.PLANNING,
        verifier_version="verification-v2",
    )

    class AgentStore:
        async def latest_candidate(self, _run_id):
            return candidate

        async def latest_strict_verification(self, _run_id, _candidate_id):
            return strict

        async def execution_for(self, _run_id, _candidate_id):
            return execution

        async def latest_semantic_review(self, _run_id, _candidate_id):
            return review

    class Sink:
        async def emit(self, *_args, **_kwargs):
            return None

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = status, payload, fields
            return status

    ctx = RunContext(
        run_id=run_id,
        task_prompt="timeout after strict",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=1,
        sink=Sink(),
    )
    run_store = RunStore()

    result = await handlers._finish_timed_out_run(ctx, run_store, AgentStore())

    assert result is RunStatus.FAILED
    _, payload, fields = run_store.terminal
    assert payload["reason_code"] == "run_timeout"
    assert payload["verification_summary"]["decision"] == "fail"
    assert fields["verification_summary"] == payload["verification_summary"]
    assert fields["verifier_decision"] == "fail"


async def test_timeout_without_strict_evidence_is_explicitly_inconclusive():
    class AgentStore:
        async def latest_candidate(self, _run_id):
            return None

    class Sink:
        async def emit(self, *_args, **_kwargs):
            return None

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = status, payload, fields
            return status

    ctx = RunContext(
        run_id=uuid.uuid4(),
        task_prompt="timeout before strict",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=1,
        sink=Sink(),
    )
    run_store = RunStore()

    await handlers._finish_timed_out_run(ctx, run_store, AgentStore())

    _, payload, fields = run_store.terminal
    assert payload["verification_summary"]["decision"] == "inconclusive"
    assert payload["verification_summary"]["reason_code"] == "run_timeout"
    assert fields["verification_summary"] == payload["verification_summary"]


class _FakeStore:
    def __init__(self):
        self.status = RunStatus.QUEUED
        self.finished = []

    async def current_status(self):
        return self.status

    async def set_status(self, new, **_fields):
        self.status = new

    async def finish(self, status, payload, **fields):
        self.status = status
        self.finished.append((status, payload, fields))
        return status


class _ConversationLLM:
    def __init__(self):
        self.request = None

    async def complete(self, request, *, on_delta=None):
        self.request = request
        if on_delta is not None:
            await on_delta("A short answer.", "output")
        return LLMResponse(
            text="A short answer.",
            model=request.model,
            input_tokens=4,
            output_tokens=3,
        )


async def test_conversation_mode_answers_without_pipeline_or_sandbox():
    sink = _RecordingSink()
    ctx = RunContext(
        run_id="conversation-test",
        task_prompt="What is a Bell state?",
        mode=RunMode.CHAT,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )
    store = _FakeStore()

    llm = _ConversationLLM()
    final = await handlers._handle_conversation(ctx, store, llm)

    assert final is RunStatus.SUCCEEDED
    assert store.status is RunStatus.SUCCEEDED
    assert "stage.started" not in [event_type for event_type, _ in sink.events]
    assert any(event_type == "chat.delta" for event_type, _ in sink.events)
    assert any(event_type == "chat.completed" for event_type, _ in sink.events)
    assert all(event_type != "llm.call" for event_type, _ in sink.events)
    # Asserted by identity, not by literal text: pinning the prose meant every
    # edit to the assistant's persona broke this test for no behavioural reason.
    # What matters here is that chat uses the assistant prompt and not the
    # planner's (the only other live pipeline prompt in majorana_llm).
    assert llm.request.system == QUANTUM_AGENT_SYSTEM_PROMPT
    assert llm.request.system != PLAN_SYSTEM_PROMPT
    assert [message.model_dump() for message in llm.request.messages] == [
        {"role": "user", "content": "What is a Bell state?"}
    ]
    assert store.finished == [(RunStatus.SUCCEEDED, {"status": RunStatus.SUCCEEDED}, {})]


def test_validated_fixtures_dir_refuses_when_root_unset(monkeypatch, tmp_path):
    monkeypatch.delenv("MAJORANA_IMPORT_FIXTURES_ROOT", raising=False)

    with pytest.raises(RuntimeError, match="MAJORANA_IMPORT_FIXTURES_ROOT is not set"):
        handlers.validated_fixtures_dir({"fixtures_dir": str(tmp_path)})


def test_validated_fixtures_dir_rejects_path_outside_root(monkeypatch, tmp_path):
    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "elsewhere"
    outside.mkdir()
    monkeypatch.setenv("MAJORANA_IMPORT_FIXTURES_ROOT", str(root))

    with pytest.raises(RuntimeError, match="escapes MAJORANA_IMPORT_FIXTURES_ROOT"):
        handlers.validated_fixtures_dir({"fixtures_dir": str(outside)})


def test_validated_fixtures_dir_rejects_dotdot_escape(monkeypatch, tmp_path):
    root = tmp_path / "allowed"
    root.mkdir()
    monkeypatch.setenv("MAJORANA_IMPORT_FIXTURES_ROOT", str(root))

    sneaky = root / ".." / "elsewhere"
    with pytest.raises(RuntimeError, match="escapes MAJORANA_IMPORT_FIXTURES_ROOT"):
        handlers.validated_fixtures_dir({"fixtures_dir": str(sneaky)})


def test_validated_fixtures_dir_rejects_symlink_escape(monkeypatch, tmp_path):
    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "secret"
    outside.mkdir()
    (root / "link").symlink_to(outside)
    monkeypatch.setenv("MAJORANA_IMPORT_FIXTURES_ROOT", str(root))

    with pytest.raises(RuntimeError, match="escapes MAJORANA_IMPORT_FIXTURES_ROOT"):
        handlers.validated_fixtures_dir({"fixtures_dir": str(root / "link")})


def test_validated_fixtures_dir_accepts_path_inside_root(monkeypatch, tmp_path):
    root = tmp_path / "allowed"
    nested = root / "batch-1"
    nested.mkdir(parents=True)
    monkeypatch.setenv("MAJORANA_IMPORT_FIXTURES_ROOT", str(root))

    assert handlers.validated_fixtures_dir({"fixtures_dir": str(nested)}) == nested.resolve()


def _qpu_payload() -> dict:
    return {
        "workspace_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "device_id": "braket.ionq.forte",
        "shots": 128,
        "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];',
        "source_fingerprint": "fnv1a-deadbeef",
    }


def test_qpu_run_kind_is_registered_so_it_can_never_dead_letter_as_unknown():
    assert handlers.HANDLERS["qpu.run"] is handlers.handle_qpu_run
    assert "qpu.run" not in handlers.DEAD_LETTER_HANDLERS


async def test_qpu_run_rejects_malformed_payloads_permanently():
    with pytest.raises(RuntimeError, match="payload malformed"):
        await handlers.handle_qpu_run(object(), {"device_id": "braket.ionq.forte"})


async def test_qpu_run_fails_closed_behind_the_deployment_gates(monkeypatch):
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    with pytest.raises(RuntimeError, match="submission_disabled"):
        await handlers.handle_qpu_run(object(), _qpu_payload())


async def test_qpu_run_fails_closed_even_with_every_provider_gate_open(monkeypatch):
    """Defense in depth: until the durable qpu_run record migration lands, a
    job row of this kind fails with a typed reason instead of contacting a
    provider — even if every deployment gate is open."""
    monkeypatch.setattr(handlers, "submission_block_reason", lambda: None)
    with pytest.raises(RuntimeError, match="durable_record_unavailable"):
        await handlers.handle_qpu_run(object(), _qpu_payload())
