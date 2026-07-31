import uuid
from types import SimpleNamespace

import pytest
from majorana_agent import (
    SimpleFailureKind,
    SimplePipelineCounters,
    SimplePipelineFailure,
    SimplePipelineOutcome,
    SimplePipelineStage,
    SimplePipelineStatus,
)
from majorana_contracts.enums import (
    Framework,
    RunMode,
    RunStatus,
    SemanticReviewDecision,
    VerifierDecision,
)
from majorana_llm import CHAT_SYSTEM_PROMPT, LLMResponse
from majorana_sandbox import LocalSubprocessSandbox
from majorana_worker import handlers
from majorana_worker.context import RunContext


def test_default_run_timeout_matches_api_maximum():
    assert handlers.DEFAULT_RUN_TIMEOUT_S == 600.0


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


async def test_simple_terminal_success_records_typed_advisory_outcome():
    run_id = uuid.uuid4()
    candidate_id = uuid.uuid4()
    candidate = SimpleNamespace(
        candidate_id=candidate_id,
        source_fingerprint="a" * 64,
    )
    execution = SimpleNamespace()
    review = SimpleNamespace(
        decision=SemanticReviewDecision.READY,
        feedback={"critic": {"residual_risks": ["AI review is advisory"]}},
        assert_binding=lambda _candidate, _execution: None,
    )
    artifact = SimpleNamespace(
        candidate_id=candidate_id,
        source_fingerprint="a" * 64,
    )
    outcome = SimplePipelineOutcome(
        status=SimplePipelineStatus.SUCCEEDED,
        stage=SimplePipelineStage.COMPLETED,
        counters=SimplePipelineCounters(),
        candidate=candidate,
        execution=execution,
        review=review,
        artifact=artifact,
    )

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.observed = (status, payload, fields)
            return status

    run_store = RunStore()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="Bell state",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=object(),
    )
    result = await handlers._finish_simple_pipeline(ctx, run_store, outcome)

    assert result is RunStatus.SUCCEEDED
    status, payload, fields = run_store.observed
    assert status is RunStatus.SUCCEEDED
    assert payload["reason_code"] == "ai_review_aligned"
    assert payload["verifier_decision"] == "inconclusive"
    assert payload["evidence_strength"] == "structural"
    summary = payload["verification_summary"]
    assert summary["decision"] == "inconclusive"
    assert summary["semantic_review_decision"] == "ready"
    assert summary["candidate_defect_observed"] is False
    assert summary["failure_class"] == "evidence_gap"
    assert summary["retry_target"] == "none"
    assert summary["checks"] == [
        {"method": "structural", "result": "pass"},
        {"method": "return_contract", "result": "pass"},
        {"method": "success_criteria", "result": "pass"},
    ]
    assert fields == {
        "verifier_decision": VerifierDecision.INCONCLUSIVE,
        "verification_summary": summary,
        "residual_risks": "AI review is advisory",
    }


async def test_simple_terminal_failure_emits_typed_sanitized_error():
    run_id = uuid.uuid4()
    emitted = []

    class Sink:
        async def emit(self, event_type, payload, *, event_id=None):
            emitted.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.observed = (status, payload, fields)
            return status

    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.MODEL_OUTPUT,
        stage=SimplePipelineStage.GENERATING,
        code="generation_output_invalid",
        message="generation model returned invalid source",
    )
    outcome = SimplePipelineOutcome(
        status=SimplePipelineStatus.FAILED,
        stage=failure.stage,
        counters=SimplePipelineCounters(generation_attempts=2),
        failure=failure,
    )
    ctx = RunContext(
        run_id=run_id,
        task_prompt="Bell state",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=Sink(),
    )
    run_store = RunStore()

    result = await handlers._finish_simple_pipeline(ctx, run_store, outcome)

    assert result is RunStatus.FAILED
    assert emitted[0][0] == "run.error"
    assert emitted[0][1] == {
        "stage": "generate",
        "code": "generation_output_invalid",
        "message": "generation model returned invalid source",
    }
    assert run_store.observed[1]["reason_code"] == "generation_output_invalid"


async def test_simple_terminal_failure_exposes_last_candidate_without_strict_lookup():
    run_id = uuid.uuid4()
    emitted = []

    class Sink:
        async def emit(self, event_type, payload, *, event_id=None):
            emitted.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.observed = status, payload, fields
            return status

    candidate = SimpleNamespace(
        framework=Framework.QISKIT,
        source="from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)",
        revision=3,
    )
    review = SimpleNamespace(
        feedback={
            "critic": {
                "summary": "The requested measurement is missing.",
                "failed_checks": ["measurement contract"],
                "residual_risks": ["No counts were produced."],
            }
        }
    )
    failure = SimplePipelineFailure(
        kind=SimpleFailureKind.REVIEW,
        stage=SimplePipelineStage.REVIEWING,
        code="candidate_budget_exhausted",
        message="review requested repair after the bounded generation budget",
    )
    outcome = SimplePipelineOutcome(
        status=SimplePipelineStatus.FAILED,
        stage=failure.stage,
        counters=SimplePipelineCounters(generation_attempts=3, review_attempts=2),
        candidate=candidate,
        review=review,
        failure=failure,
    )
    ctx = RunContext(
        run_id=run_id,
        task_prompt="Bell counts",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=Sink(),
    )

    result = await handlers._finish_simple_pipeline(ctx, RunStore(), outcome)

    assert result is RunStatus.FAILED
    assert [event[0] for event in emitted] == ["run.best_effort", "run.error"]
    best = emitted[0][1]
    assert best["code"] == candidate.source
    assert best["revision"] == 3
    assert best["candidates_considered"] == 3
    assert best["failed_checks"] == ["measurement contract"]
    assert best["critic_summary"] == "The requested measurement is missing."
    assert best["residual_risks"] == ["No counts were produced."]


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


async def test_timeout_emits_one_typed_error_without_legacy_verification_state():
    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, event_type, payload, *, event_id=None):
            self.events.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = status, payload, fields
            return status

    run_id = uuid.uuid4()
    sink = Sink()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="timeout before strict",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=1,
        sink=sink,
    )
    run_store = RunStore()

    await handlers._finish_timed_out_run(ctx, run_store)

    _, payload, fields = run_store.terminal
    assert payload == {
        "status": RunStatus.FAILED,
        "reason_code": "run_timeout",
    }
    assert fields == {}
    assert sink.events == [
        (
            "run.error",
            {
                "stage": None,
                "code": "run_timeout",
                "message": "run exceeded its time budget",
            },
            uuid.uuid5(run_id, "run.error.run_timeout"),
        )
    ]


async def test_legacy_progress_is_terminalized_without_resuming_old_runtime():
    run_id = uuid.uuid4()

    class Sink:
        def __init__(self):
            self.events = []

        async def emit(self, event_type, payload, *, event_id=None):
            self.events.append((event_type, payload, event_id))

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.terminal = status, payload, fields
            return status

    sink = Sink()
    store = RunStore()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="old partial run",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )

    status = await handlers._finish_legacy_progress(ctx, store)

    assert status is RunStatus.FAILED
    assert store.terminal == (
        RunStatus.FAILED,
        {
            "status": RunStatus.FAILED,
            "reason_code": "legacy_run_requires_restart",
        },
        {},
    )
    assert sink.events[0][1]["code"] == "legacy_run_requires_restart"


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
    assert llm.request.system == CHAT_SYSTEM_PROMPT
    assert [message.model_dump() for message in llm.request.messages] == [
        {"role": "user", "content": "What is a Bell state?"}
    ]
    assert store.finished == [(RunStatus.SUCCEEDED, {"status": RunStatus.SUCCEEDED}, {})]


async def test_conversation_mode_passes_prior_execute_output_to_the_model(monkeypatch):
    prior = (
        "[Prior Execute output — durable context from an earlier turn]"
        "\n\nGenerated source (qiskit):\n```python\nenergy = -1.137\n```"
    )

    async def list_messages(scope, session, conversation_id, *, exclude_run_id=None):
        assert scope is store._scope
        assert session is store._session
        assert conversation_id == ctx.conversation_id
        assert exclude_run_id == ctx.run_id
        return [
            {"role": "user", "content": "Find the H2 ground-state energy."},
            {"role": "assistant", "content": prior},
        ]

    monkeypatch.setattr(handlers.runs_repo, "list_conversation_messages", list_messages)
    sink = _RecordingSink()
    ctx = RunContext(
        run_id=uuid.uuid4(),
        task_prompt="これを解説して",
        mode=RunMode.CHAT,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
        conversation_id=uuid.uuid4(),
    )
    store = _FakeStore()
    store._scope = object()
    store._session = object()
    llm = _ConversationLLM()

    final = await handlers._handle_conversation(ctx, store, llm)

    assert final is RunStatus.SUCCEEDED
    assert [message.model_dump() for message in llm.request.messages] == [
        {"role": "user", "content": "Find the H2 ground-state energy."},
        {"role": "assistant", "content": prior},
        {"role": "user", "content": "これを解説して"},
    ]


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


def _qpu_payload(qpu_run_id: str | None = None) -> dict:
    return {
        "workspace_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "qpu_run_id": qpu_run_id or str(uuid.uuid4()),
        "device_id": "braket.ionq.forte",
        "shots": 128,
        "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0]; c[0] = measure q[0];',
        "source_fingerprint": "fnv1a-deadbeef",
    }


class _FakeQpuSession:
    def __init__(self) -> None:
        self.commits = 0

    async def commit(self) -> None:
        self.commits += 1


def _qpu_record(status: str, *, provider_job_id: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        status=status,
        provider_job_id=provider_job_id,
        device_id="braket.ionq.forte",
        shots=128,
        qasm="OPENQASM 3.0;",
        source_fingerprint="fnv1a-deadbeef",
        submitted_at=None,
        created_at=None,
    )


def _patch_qpu_repo(monkeypatch, record: SimpleNamespace) -> dict:
    captured: dict = {}

    async def fake_get_record(scope, session, record_id):
        return record

    async def fake_transition(scope, session, record_id, status, **kwargs):
        captured["transition"] = {"status": status, **kwargs}
        return record

    async def fake_enqueue(session, *, kind, payload, **kwargs):
        captured["enqueued"] = {"kind": kind, "payload": payload, **kwargs}

    monkeypatch.setattr(handlers.qpu_runs_repo, "get_record", fake_get_record)
    monkeypatch.setattr(handlers.qpu_runs_repo, "transition", fake_transition)
    monkeypatch.setattr(handlers.system, "enqueue_job", fake_enqueue)
    return captured


def test_qpu_run_kind_is_registered_with_its_dead_letter_closer():
    assert handlers.HANDLERS["qpu.run"] is handlers.handle_qpu_run
    assert handlers.DEAD_LETTER_HANDLERS["qpu.run"] is handlers.handle_qpu_run_dead_letter


async def test_qpu_run_rejects_malformed_payloads_permanently():
    with pytest.raises(RuntimeError, match="payload malformed"):
        await handlers.handle_qpu_run(object(), {"device_id": "braket.ionq.forte"})


async def test_qpu_run_closes_the_record_when_the_gate_shut_after_enqueue(monkeypatch):
    """A deployment that closed the gate between enqueue and execution must
    close the record with the typed reason, never contact the provider."""
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload(str(record.id)))

    assert captured["transition"]["status"].value == "error"
    assert "submission_disabled" in captured["transition"]["error"]
    assert "enqueued" not in captured
    assert session.commits == 1


async def test_qpu_run_submits_a_queued_record_and_schedules_the_poll(monkeypatch):
    from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

    monkeypatch.setattr(handlers, "submission_block_reason", lambda: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()

    class FakeProvider:
        def submit(self, request):
            captured["submitted"] = request
            return QpuJobRecord(
                provider=QpuProviderKey.BRAKET,
                provider_job_id="prov-123",
                device_id=request.device_id,
                shots=request.shots,
                status=QpuJobStatus.QUEUED,
                submitted_at="2026-07-23T00:00:00+00:00",
                source_fingerprint=request.source_fingerprint,
            )

    await handlers.handle_qpu_run(session, _qpu_payload(str(record.id)), provider=FakeProvider())

    assert captured["submitted"].qasm == record.qasm
    assert captured["transition"]["status"].value == "running"
    assert captured["transition"]["provider_job_id"] == "prov-123"
    assert captured["enqueued"]["kind"] == "qpu.run"
    assert captured["enqueued"]["run_after"] is not None
    assert session.commits == 1


async def test_qpu_run_poll_completes_the_record_with_raw_counts(monkeypatch):
    from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

    monkeypatch.setattr(handlers, "submission_block_reason", lambda: None)
    record = _qpu_record("running", provider_job_id="prov-123")
    captured = _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()

    class FakeProvider:
        def poll(self, provider_job_id):
            return QpuJobRecord(
                provider=QpuProviderKey.BRAKET,
                provider_job_id=provider_job_id,
                device_id="braket.ionq.forte",
                shots=0,
                status=QpuJobStatus.DONE,
                source_fingerprint="",
                raw_counts={"0": 66, "1": 62},
            )

    await handlers.handle_qpu_run(session, _qpu_payload(str(record.id)), provider=FakeProvider())

    assert captured["transition"]["status"].value == "done"
    assert captured["transition"]["raw_counts"] == {"0": 66, "1": 62}
    assert "enqueued" not in captured


async def test_qpu_dead_letter_closes_an_open_record(monkeypatch):
    record = _qpu_record("running", provider_job_id="prov-123")
    captured = _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()

    await handlers.handle_qpu_run_dead_letter(
        session, _qpu_payload(str(record.id)), "job lease expired 3 times"
    )

    assert captured["transition"]["status"].value == "error"
    assert "dead-lettered" in captured["transition"]["error"]
    assert session.commits == 1
