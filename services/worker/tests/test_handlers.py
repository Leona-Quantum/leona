import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from majorana_agent import (
    SemanticReviewEvidence,
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
    RetryTarget,
    SemanticReviewDecision,
    VerifierDecision,
)
from majorana_api import credential_crypto
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
    # `ExecutionEvidence.observation` is a required field with a default factory,
    # so it is never absent on the real type. A double thinner than the thing it
    # stands in for fails on the first caller that reads a real field.
    execution = SimpleNamespace(observation={})
    review = SimpleNamespace(
        decision=SemanticReviewDecision.READY,
        severity="none",
        # `basic_checks` is what the summary projects now, so a double that omits it
        # describes a run in which nothing was ever examined — which is not the run
        # this test is about.
        feedback={
            "critic": {"residual_risks": ["AI review is advisory"]},
            "basic_checks": [
                {"method": "structural", "result": "pass"},
                {"method": "return_contract", "result": "pass"},
                {"method": "success_criteria", "result": "pass"},
            ],
        },
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


async def test_unexecuted_artifact_finishes_successfully_without_result_claims():
    run_id = uuid.uuid4()
    candidate = SimpleNamespace(candidate_id=uuid.uuid4(), source_fingerprint="a" * 64)
    execution = SimpleNamespace(was_not_run=True)
    artifact = SimpleNamespace(
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        execution_status="not_run",
    )
    outcome = SimplePipelineOutcome(
        status=SimplePipelineStatus.SUCCEEDED,
        stage=SimplePipelineStage.COMPLETED,
        counters=SimplePipelineCounters(),
        candidate=candidate,
        execution=execution,
        artifact=artifact,
    )

    class RunStore:
        async def finish(self, status, payload, **fields):
            self.observed = (status, payload, fields)
            return status

    run_store = RunStore()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="Build a 480-qubit assignment artifact",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=object(),
    )

    result = await handlers._finish_simple_pipeline(ctx, run_store, outcome)

    assert result is RunStatus.SUCCEEDED
    _, payload, fields = run_store.observed
    assert payload["reason_code"] == "artifact_generated_execution_not_run"
    assert payload["evidence_strength"] is None
    assert payload["verification_summary"]["checks"] == []
    assert "reported output" in payload["verification_summary"]["unverified_claims"]
    assert fields["verifier_decision"] is VerifierDecision.INCONCLUSIVE


async def test_static_reviewed_artifact_remains_inconclusive_until_execution():
    run_id = uuid.uuid4()
    candidate = SimpleNamespace(candidate_id=uuid.uuid4(), source_fingerprint="a" * 64)
    execution = SimpleNamespace(
        execution_id=uuid.uuid4(),
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        was_not_run=True,
    )
    review = SemanticReviewEvidence(
        review_id=uuid.uuid4(),
        candidate_id=candidate.candidate_id,
        execution_id=execution.execution_id,
        source_fingerprint=candidate.source_fingerprint,
        attempt_seq=1,
        decision=SemanticReviewDecision.READY,
        confidence="high",
        severity="none",
        reason_code="static_intent_aligned",
        retry_target=RetryTarget.NONE,
        feedback={"basic_checks": [{"method": "structural", "result": "pass"}]},
    )
    artifact = SimpleNamespace(
        candidate_id=candidate.candidate_id,
        source_fingerprint=candidate.source_fingerprint,
        execution_status="not_run",
    )
    outcome = SimplePipelineOutcome(
        status=SimplePipelineStatus.SUCCEEDED,
        stage=SimplePipelineStage.COMPLETED,
        counters=SimplePipelineCounters(review_attempts=1),
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
        task_prompt="Build a reviewed 480-qubit assignment artifact",
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=object(),
    )

    result = await handlers._finish_simple_pipeline(ctx, run_store, outcome)

    assert result is RunStatus.SUCCEEDED
    _, payload, _ = run_store.observed
    assert payload["reason_code"] == "artifact_static_review_ready_execution_not_run"
    assert payload["verifier_decision"] == "inconclusive"
    assert payload["evidence_strength"] is None
    assert payload["verification_summary"]["semantic_review_decision"] == "ready"


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


async def test_a_chat_turn_is_written_to_the_usage_ledger(monkeypatch):
    """Chat is the one unmetered surface by policy — unmetered is not the same
    as unrecorded. Execute runs go through MeteredAgentLLM; this path calls the
    provider directly, so without this the tokens existed only inside one run's
    chat.completed event and no cost question could be answered."""
    recorded = []

    async def record_usage(scope, session, **values):
        recorded.append(values)

    monkeypatch.setattr(handlers.usage_repo, "record_usage", record_usage)
    run_id = uuid.uuid4()
    sink = _RecordingSink()
    ctx = RunContext(
        run_id=run_id,
        task_prompt="What is a Bell state?",
        mode=RunMode.CHAT,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )
    store = _FakeStore()
    store._scope = object()
    store._session = object()

    await handlers._handle_conversation(ctx, store, _ConversationLLM(), conversation_messages=[])

    assert len(recorded) == 1, "one chat turn is one ledger entry"
    entry = recorded[0]
    assert entry["quantity"] == 7, "input + output tokens, not one of them"
    assert entry["meta"]["role"] == "chat", "chat spend must be separable from run spend"
    assert entry["meta"]["run_id"] == str(run_id)
    assert entry["event_id"] == uuid.uuid5(run_id, "usage:chat"), (
        "a deterministic id is what stops a redelivered job counting the turn twice"
    )


async def test_a_metering_failure_does_not_take_away_the_answer(monkeypatch):
    """The reader already has the response. Losing the turn because accounting
    failed would be strictly worse than an incomplete ledger."""

    attempts = []

    async def exploding_usage(*_args, **_kwargs):
        attempts.append(1)
        raise RuntimeError("ledger unavailable")

    monkeypatch.setattr(handlers.usage_repo, "record_usage", exploding_usage)
    sink = _RecordingSink()
    ctx = RunContext(
        run_id=uuid.uuid4(),
        task_prompt="What is a Bell state?",
        mode=RunMode.CHAT,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
    )
    store = _FakeStore()
    store._scope = object()
    store._session = object()

    final = await handlers._handle_conversation(
        ctx, store, _ConversationLLM(), conversation_messages=[]
    )

    assert attempts, "the ledger must actually be attempted, or this passes vacuously"
    assert final is RunStatus.SUCCEEDED
    assert any(name == "chat.completed" for name, _ in sink.events), (
        "the answer still reaches the reader"
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
    final = await handlers._handle_conversation(ctx, store, llm, conversation_messages=[])

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


@pytest.mark.parametrize("mode", [RunMode.CHAT, RunMode.EXECUTE])
async def test_history_is_loaded_once_and_reaches_whichever_branch_runs(monkeypatch, mode):
    """Both branches used to load their own history and only chat's loader was
    tested. One loader, one query, and the same list on both paths — otherwise
    chat and execute can disagree about what was said in the same conversation.
    """
    history = [
        {"role": "user", "content": "Partition six suppliers."},
        {"role": "assistant", "content": "That is a weighted MaxCut."},
    ]
    loads = []
    delivered = {}

    async def list_messages(scope, session, conversation_id, *, exclude_run_id=None):
        loads.append((conversation_id, exclude_run_id))
        return history

    run_id = uuid.uuid4()
    conversation_id = uuid.uuid4()
    run = SimpleNamespace(
        artifact_version_id=None,
        task_prompt="Build it now.",
        mode=mode.value,
        framework=Framework.QISKIT.value,
        seed=None,
        shots=None,
        timeout_s=30,
        conversation_id=conversation_id,
    )

    async def get_run(scope, session, requested_id):
        return run

    async def resolve(ctx, store, **kwargs):
        delivered["resolve"] = kwargs["conversation_messages"]
        return ctx

    async def title(ctx, store, **_kwargs):
        return ctx

    async def conversation(ctx, store, llm, *, conversation_messages):
        delivered["branch"] = conversation_messages
        return RunStatus.SUCCEEDED

    async def execution(ctx, store, **kwargs):
        delivered["branch"] = kwargs["conversation_messages"]
        return RunStatus.SUCCEEDED

    monkeypatch.setattr(handlers.runs_repo, "get_run", get_run)
    monkeypatch.setattr(handlers.runs_repo, "list_conversation_messages", list_messages)
    monkeypatch.setattr(handlers, "_resolve_mode", resolve)
    monkeypatch.setattr(handlers, "_title_conversation", title)
    monkeypatch.setattr(handlers, "_handle_conversation", conversation)
    monkeypatch.setattr(handlers, "_handle_agent_execution", execution)

    await handlers.handle_run_execute(
        object(),
        {
            "run_id": str(run_id),
            "user_id": str(uuid.uuid4()),
            "workspace_id": str(uuid.uuid4()),
        },
    )

    assert loads == [(conversation_id, run_id)], "exactly one load, excluding this run"
    assert delivered["resolve"] == history, "routing decides against the same history"
    assert delivered["branch"] == history


async def test_conversation_mode_passes_prior_execute_output_to_the_model():
    """The loading moved to `handle_run_execute`; what this boundary owes is
    ordering — history first, the current turn last, roles intact."""
    prior = (
        "[Prior Execute output — durable context from an earlier turn]"
        "\n\nGenerated source (qiskit):\n```python\nenergy = -1.137\n```"
    )
    history = [
        {"role": "user", "content": "Find the H2 ground-state energy."},
        {"role": "assistant", "content": prior},
    ]
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

    final = await handlers._handle_conversation(ctx, store, llm, conversation_messages=history)

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


def _qpu_record(
    status: str, *, provider_job_id: str | None = None, user_id: uuid.UUID | None = None
) -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid.uuid4(),
        user_id=user_id or uuid.uuid4(),
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

    async def fake_claim(scope, session, record_id):
        # Behaves like the real conditional UPDATE: the stamp lands once, and a
        # caller arriving after it matches zero rows. A double that always
        # returned True would make every test below pass against a handler with
        # no at-most-once guarantee at all.
        captured.setdefault("claims", 0)
        captured["claims"] += 1
        if record.submitted_at is not None:
            return False
        record.submitted_at = datetime.now(UTC)
        return True

    monkeypatch.setattr(handlers.qpu_runs_repo, "get_record", fake_get_record)
    monkeypatch.setattr(handlers.qpu_runs_repo, "transition", fake_transition)
    monkeypatch.setattr(handlers.qpu_runs_repo, "claim_submission_attempt", fake_claim)
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

    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
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
    # TWO commits on the submit path, and the extra one is load-bearing: the
    # first durably claims the attempt before the provider is contacted, so a
    # redelivered job cannot contact them again. The second writes the outcome.
    assert session.commits == 2


async def test_qpu_run_poll_completes_the_record_with_raw_counts(monkeypatch):
    from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
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


async def test_a_redelivered_job_never_submits_to_the_provider_twice(monkeypatch):
    """The measurement this guard exists for.

    A `qpu.run` job is redelivered on failure like any other (three attempts by
    default), and this is the one handler where a redelivery spends money. The
    provider below accepts the job every time and loses the FIRST response —
    a read timeout, a reset connection, the ordinary way a network call fails
    after it has already had its effect.

    Before the claim was stamped ahead of the call, this measured two
    `provider.submit` calls for one record, with the attestation row keeping
    only the SECOND provider job id: the first job runs, bills the operator's
    provider account, and is tracked nowhere.
    """
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()
    submits: list[str] = []

    class FlakyProvider:
        def submit(self, request):
            from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

            submits.append(request.source_fingerprint)
            if len(submits) == 1:
                raise TimeoutError("provider accepted the job; the response never arrived")
            return QpuJobRecord(
                provider=QpuProviderKey.BRAKET,
                provider_job_id=f"prov-{len(submits)}",
                device_id=request.device_id,
                shots=request.shots,
                status=QpuJobStatus.QUEUED,
                submitted_at="2026-08-02T00:00:00+00:00",
                source_fingerprint=request.source_fingerprint,
            )

    provider = FlakyProvider()
    body = _qpu_payload(str(record.id))

    with pytest.raises(TimeoutError):
        await handlers.handle_qpu_run(session, body, provider=provider)

    # The stamp survived the failure, which is the whole mechanism: it was
    # committed before the provider was contacted, so it did not roll back with
    # the rest of the handler's transaction.
    assert record.submitted_at is not None

    await handlers.handle_qpu_run(session, body, provider=provider)

    assert len(submits) == 1, f"the provider was contacted {len(submits)} times for one record"
    assert captured["transition"]["status"].value == "error"
    assert "may have accepted" in captured["transition"]["error"]
    assert "enqueued" not in captured, "a record that cannot be submitted must not schedule polls"


async def test_the_claim_is_committed_before_the_provider_is_contacted(monkeypatch):
    """Ordering, not just presence.

    A claim written inside the handler's transaction rolls back with everything
    else when the submit raises, and the redelivery finds the record exactly as
    it left it — which is the bug, with an extra write in front of it.
    """
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    _patch_qpu_repo(monkeypatch, record)
    session = _FakeQpuSession()
    order: list[str] = []

    original_claim = handlers.qpu_runs_repo.claim_submission_attempt

    async def watched_claim(scope, sess, record_id):
        order.append("claim")
        return await original_claim(scope, sess, record_id)

    class WatchedSession(_FakeQpuSession):
        async def commit(self):
            order.append("commit")
            await super().commit()

    class FakeProvider:
        def submit(self, request):
            from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

            order.append("submit")
            return QpuJobRecord(
                provider=QpuProviderKey.BRAKET,
                provider_job_id="prov-1",
                device_id=request.device_id,
                shots=request.shots,
                status=QpuJobStatus.QUEUED,
                submitted_at="2026-08-02T00:00:00+00:00",
                source_fingerprint=request.source_fingerprint,
            )

    monkeypatch.setattr(handlers.qpu_runs_repo, "claim_submission_attempt", watched_claim)
    session = WatchedSession()
    await handlers.handle_qpu_run(session, _qpu_payload(str(record.id)), provider=FakeProvider())

    assert order[:3] == ["claim", "commit", "submit"], order


# ------------------------------------------------- the submitting user's key


def _qpu_payload_for(record: SimpleNamespace) -> dict:
    """A payload whose `user_id` matches the record's owner, as the API writes it."""
    payload = _qpu_payload(str(record.id))
    payload["user_id"] = str(record.user_id)
    return payload


class _CredentialStore:
    """Whatever `credentials_repo.get` should answer, plus what was stamped."""

    def __init__(self, row) -> None:
        self.row = row
        self.successes = 0

    async def get(self, scope, session, provider):
        return self.row

    async def mark_provider_success(self, scope, session, provider):
        self.successes += 1


async def test_a_record_whose_owner_disconnected_fails_terminally_and_names_why(monkeypatch):
    """The disconnected-mid-flight case.

    It is not transient, so retrying it three times changes nothing except how
    long the user waits to be told. And it must not consume the record's one
    submission attempt: `claim_submission_attempt` is the at-most-once mark, and
    a record that spent it on a missing credential would afterwards report "a
    submission was already attempted and may have reached the provider" —
    frightening, and false.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    monkeypatch.setattr(handlers, "credentials_repo", _CredentialStore(None))
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload_for(record))

    assert captured["transition"]["status"].value == "error"
    assert "no IBM Quantum credential" in captured["transition"]["error"]
    # Case-insensitive: the consequence is now a sentence of its own, composed
    # by `_credential_failure_message` from the record rather than baked into
    # the cause. See the RUNNING-record test below for why it had to move.
    assert "nothing was sent to ibm" in captured["transition"]["error"].lower()
    assert captured.get("claims") is None, "a missing credential spent the one attempt"
    assert "enqueued" not in captured
    assert session.commits == 1


async def test_a_credential_that_cannot_be_decrypted_fails_terminally_naming_the_key(monkeypatch):
    """The rotation done by replacement rather than by prepending.

    `key_id` is on the row precisely so this failure is diagnosable without
    decrypting anything, and the message must carry it — never the ciphertext.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    row = SimpleNamespace(ciphertext="gAAAAAB-not-decryptable", key_id="deadbeef", instance=None)
    monkeypatch.setattr(handlers, "credentials_repo", _CredentialStore(row))
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", credential_crypto.generate_key())
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload_for(record))

    error = captured["transition"]["error"]
    assert captured["transition"]["status"].value == "error"
    assert "deadbeef" in error
    assert "could not be decrypted" in error
    assert row.ciphertext not in error, "the failure message carried the stored ciphertext"
    assert captured.get("claims") is None
    assert session.commits == 1


async def test_the_provider_is_built_from_the_submitting_users_key(monkeypatch):
    """The whole point of the change: the token comes from the ROW, per user.

    A provider built from the environment would put every account's hardware job
    on one shared IBM identity and one shared ten-minute Open Plan allowance,
    which is the state this work exists to leave.
    """
    from majorana_qpu import QpuJobRecord, QpuJobStatus, QpuProviderKey

    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", credential_crypto.generate_key())
    cipher = credential_crypto.load_cipher()
    secret = "z" * 44
    ciphertext, key_id = cipher.encrypt(secret)
    row = SimpleNamespace(ciphertext=ciphertext, key_id=key_id, instance="crn:v1:bluemix:x")
    store = _CredentialStore(row)
    monkeypatch.setattr(handlers, "credentials_repo", store)

    record = _qpu_record("queued")
    _patch_qpu_repo(monkeypatch, record)
    built: dict = {}

    class FakeProvider:
        def submit(self, request):
            return QpuJobRecord(
                provider=QpuProviderKey.BRAKET,
                provider_job_id="prov-1",
                device_id=request.device_id,
                shots=request.shots,
                status=QpuJobStatus.QUEUED,
                submitted_at="2026-08-02T00:00:00+00:00",
                source_fingerprint=request.source_fingerprint,
            )

    def fake_build(token, instance):
        built["token"] = token
        built["instance"] = instance
        return FakeProvider()

    monkeypatch.setattr(handlers, "_ibm_provider", fake_build)
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload_for(record))

    assert built["token"] == secret
    assert built["instance"] == "crn:v1:bluemix:x"
    assert store.successes == 1, "a submission IBM accepted must refresh the credential's stamps"


async def test_a_record_belonging_to_another_user_loads_no_credential(monkeypatch):
    """Payload and row disagreeing about the owner is not a case to guess at.

    Whichever one is wrong, submitting would run a job under somebody else's IBM
    account and spend their allowance.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)

    class _MustNotBeAsked(_CredentialStore):
        async def get(self, scope, session, provider):
            raise AssertionError("no credential may be loaded for a mismatched owner")

    monkeypatch.setattr(handlers, "credentials_repo", _MustNotBeAsked(None))
    session = _FakeQpuSession()

    # `_qpu_payload` mints a fresh user_id, so it does NOT match the record's.
    await handlers.handle_qpu_run(session, _qpu_payload(str(record.id)))

    assert captured["transition"]["status"].value == "error"
    assert "does not match" in captured["transition"]["error"]
    assert captured.get("claims") is None


async def test_a_closed_deployment_is_not_described_as_the_users_missing_key(monkeypatch):
    """Gate ordering. The deployment-wide flag is checked BEFORE the credential,
    so an operator's closed gate is never reported to a user as their problem."""
    monkeypatch.delenv("MAJORANA_QPU_SUBMIT_ENABLED", raising=False)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)

    class _MustNotBeAsked(_CredentialStore):
        async def get(self, scope, session, provider):
            raise AssertionError("a closed deployment must not reach the credential store")

    monkeypatch.setattr(handlers, "credentials_repo", _MustNotBeAsked(None))
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload_for(record))

    assert "submission_disabled" in captured["transition"]["error"]


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


async def test_a_disconnected_credential_on_a_RUNNING_record_does_not_claim_nothing_was_sent(
    monkeypatch,
):
    """The record is already at IBM, and the failure must not say otherwise.

    Every other credential-failure test in this file stages a QUEUED record, and
    that is how the bug survived: the credential block runs BEFORE the
    QUEUED/RUNNING branch, so it also fires for a record the provider already
    accepted. Both messages ended "nothing was sent to IBM ... submit again",
    unconditionally.

    Driven against a RUNNING record carrying `provider_job_id`, that closed the
    row with a sentence telling the user nothing had been sent and to submit
    again — while their job was running on their own IBM account, spending their
    own ten-minutes-per-28-days Open Plan allowance. A user who did as they were
    told would have spent it twice.

    `error` is the whole of what a user gets for a failed hardware run, so the
    assertions here are about what the sentence must NOT claim as much as what
    it must say.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("running", provider_job_id="ibm-job-abc123")
    captured = _patch_qpu_repo(monkeypatch, record)
    monkeypatch.setattr(handlers, "credentials_repo", _CredentialStore(None))
    session = _FakeQpuSession()

    await handlers.handle_qpu_run(session, _qpu_payload_for(record))

    error = captured["transition"]["error"]
    assert captured["transition"]["status"].value == "error"
    assert "no IBM Quantum credential" in error, "the cause must still be named"
    assert "nothing was sent to IBM" not in error.lower(), (
        "the job IS at IBM; claiming otherwise is the defect"
    )
    assert "ibm-job-abc123" in error, "the user needs the job id to check it themselves"
    assert "allowance a second time" in error, "resubmitting has a cost worth naming"


async def test_the_queued_case_still_says_nothing_was_sent(monkeypatch):
    """The control for the test above.

    Without this, narrowing the message to the RUNNING case could silently drop
    the reassurance from the QUEUED one — where "nothing was sent to IBM" is
    true, load-bearing, and the reason a user can safely retry.
    """
    monkeypatch.setenv("MAJORANA_QPU_SUBMIT_ENABLED", "true")
    monkeypatch.setattr(handlers, "submission_block_reason", lambda **_: None)
    record = _qpu_record("queued")
    captured = _patch_qpu_repo(monkeypatch, record)
    monkeypatch.setattr(handlers, "credentials_repo", _CredentialStore(None))

    await handlers.handle_qpu_run(_FakeQpuSession(), _qpu_payload_for(record))

    error = captured["transition"]["error"]
    assert "Nothing was sent to IBM" in error
    assert "submit again" in error
