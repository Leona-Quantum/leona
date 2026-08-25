from types import SimpleNamespace
import datetime as dt
import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus
from majorana_llm import LLMResponse
from majorana_sandbox import SandboxResult

from majorana_worker import handlers
from majorana_worker.context import RunContext


class Session:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1


class Sink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload, *, event_id=None):
        self.events.append((event_type, payload, event_id))


class Store:
    def __init__(self):
        self.status = RunStatus.QUEUED
        self.finished = None

    async def current_status(self):
        return self.status

    async def set_status(self, status, **_fields):
        self.status = status

    async def finish(self, status, payload, **_fields):
        self.status = status
        self.finished = payload
        return status


def test_targeted_qapp_contract_repair_ignores_unrequested_bundle_metadata():
    repaired = handlers._QappContractRepair.model_validate(
        {
            "title": "unchanged title echoed by the model",
            "description": "unchanged description echoed by the model",
            "ui_document": "<html><script>void 0</script></html>",
            "quantum_source": "RESULT = {}",
            "input_schema": {"type": "object", "properties": {}},
            "output_schema": {"type": "object", "properties": {}},
            "qubits_estimate": 2,
        }
    )

    assert repaired.qubits_estimate == 2
    assert "title" not in repaired.model_dump()


def test_qapp_truncated_json_feedback_requests_a_compact_full_retry():
    feedback = handlers._qapp_repair_feedback(
        ValueError("Invalid JSON: EOF while parsing a string")
    )

    assert "8,192-token completion limit" in feedback
    assert "total serialized output under 12,000 characters" in feedback


def test_initial_qapp_bundle_accepts_bounded_rich_source():
    fields = {
        "title": "H2",
        "description": "VQE",
        "ui_document": "<html></html>",
        "quantum_source": "x" * 5_000,
        "input_schema": {"type": "object", "properties": {}},
        "output_schema": {"type": "object", "properties": {}},
        "qubits_estimate": 2,
    }

    assert len(handlers._GeneratedQapp.model_validate(fields).quantum_source) == 5_000


async def test_qapp_generation_persists_a_private_free_form_bundle(monkeypatch):
    run_id = uuid.uuid4()
    qapp_id = uuid.uuid4()
    version_id = uuid.uuid4()
    sink = Sink()
    store = Store()
    session = Session()
    captured = {}
    response_text = """{
      "title": "Bell explorer",
      "description": "Explore Bell-state correlations",
      "ui_document": "<!doctype html><html><head></head><body><button>Run</button><script>button.onclick=()=>window.qapp.run({})</script></body></html>",
      "quantum_source": "RESULT = {'summary': 'Bell counts collected'}",
      "input_schema": {
        "type": "object",
        "properties": {"shots": {"type": "integer", "minimum": 1, "maximum": 4096}},
        "required": ["shots"]
      },
      "output_schema": {
        "type": "object",
        "properties": {"summary": {"type": "string"}},
        "required": ["summary"]
      },
      "qubits_estimate": 2
    }"""
    rejected_response_text = response_text.replace(
        "RESULT = {'summary': 'Bell counts collected'}",
        "import os\\nRESULT = {'summary': 'Bell counts collected'}",
    )
    repaired_source_text = """{
      "quantum_source": "RESULT = {'summary': 'Bell counts collected'}"
    }"""

    class FakeMeteredLLM:
        def __init__(self, **_kwargs):
            self.requests = []

        async def complete(self, request):
            self.requests.append(request)
            captured["requests"] = self.requests
            return LLMResponse(
                text=rejected_response_text if len(self.requests) == 1 else repaired_source_text,
                model=request.model,
                input_tokens=10,
                output_tokens=20,
            )

    async def create_generated(_scope, _session, **fields):
        captured["fields"] = fields
        return (
            SimpleNamespace(id=qapp_id, slug="bell-explorer-12345678", title=fields["title"]),
            SimpleNamespace(id=version_id),
        )

    async def smoke_run(sandbox, spec):
        captured["smoke_sandbox"] = sandbox
        captured["smoke_spec"] = spec
        return SandboxResult(
            ok=True,
            exit_code=0,
            duration_ms=5,
            stdout="",
            stderr="",
            provider="test",
            protected_result={"result": {"summary": "Bell counts collected"}},
        )

    monkeypatch.setattr(handlers, "MeteredAgentLLM", FakeMeteredLLM)
    monkeypatch.setattr(handlers.qapps_repo, "create_generated", create_generated)
    monkeypatch.setattr(handlers, "run_sandbox", smoke_run)
    ctx = RunContext(
        run_id=run_id,
        task_prompt="Turn this circuit into an interactive Bell explorer",
        mode=RunMode.QAPP,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=None,
        sink=sink,
        source_code="from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)",
    )
    scope = Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.MEMBER)

    result = await handlers._handle_qapp_generation(
        ctx,
        store,
        scope=scope,
        session=session,
        llm=SimpleNamespace(),
        sandbox=SimpleNamespace(provider="test"),
        source_artifact_version_id=uuid.uuid4(),
    )

    assert result is RunStatus.SUCCEEDED
    assert captured["fields"]["ui_document"].startswith("<!doctype html>")
    assert captured["fields"]["input_schema"]["additionalProperties"] is False
    assert len(captured["requests"]) == 2
    assert "Selected-framework source to preserve" in captured["requests"][0].user
    assert "Qiskit is version 2.5.2" in captured["requests"][0].user
    assert "disallowed_import:os" in captured["requests"][1].user
    assert rejected_response_text in captured["requests"][1].user
    assert set(captured["requests"][1].response_schema["properties"]) == {"quantum_source"}
    assert "repair one rejected portion" in captured["requests"][1].system
    assert captured["requests"][1].max_tokens == 1800
    assert captured["smoke_spec"].timeout_s == 30
    assert "QAPP_INPUTS" in captured["smoke_spec"].trusted_setup
    assert any(event_type == "qapp.generated" for event_type, _payload, _id in sink.events)
    assert store.finished == {"status": RunStatus.SUCCEEDED, "reason_code": "qapp_generated"}
    assert session.commits == 1


async def test_qapp_execution_uses_guarded_sandbox_and_persists_only_protected_result(
    monkeypatch,
):
    execution_id = uuid.uuid4()
    qapp_id = uuid.uuid4()
    execution = SimpleNamespace(
        id=execution_id,
        qapp_id=qapp_id,
        status="queued",
        started_at=None,
        inputs={"qubits": 2},
    )
    version = SimpleNamespace(
        id=uuid.uuid4(),
        qapp_id=qapp_id,
        quantum_source="RESULT = {'counts': {'00': 7, '11': 9}}",
        qubits_estimate=2,
        fingerprint="a" * 64,
        output_schema={
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
        },
    )
    captured = {}

    async def get_source(_scope, _session, requested):
        assert requested == execution_id
        return execution, version

    async def mark_running(*_args):
        # Returns True, like the real `mark_execution_running` does when THIS
        # call made the transition. A fake that returned None hid the redelivery
        # guard entirely — a stub with a different contract from the function it
        # stands in for makes the check untestable while looking green.
        execution.status = "running"
        execution.started_at = dt.datetime(2026, 8, 25, tzinfo=dt.timezone.utc)
        return True

    async def finish(_scope, _session, requested, **fields):
        captured.update(id=requested, **fields)

    async def record_usage(*_args, **_kwargs):
        return None

    monkeypatch.setattr(handlers.qapps_repo, "get_execution_source", get_source)
    monkeypatch.setattr(handlers.qapps_repo, "mark_execution_running", mark_running)
    monkeypatch.setattr(handlers.qapps_repo, "finish_execution", finish)
    monkeypatch.setattr(handlers.usage_repo, "record_usage", record_usage)

    class FakeSandbox:
        provider = "fake"

        async def _execute(self, spec):
            captured["spec"] = spec
            return SandboxResult(
                ok=True,
                exit_code=0,
                duration_ms=10,
                stdout="untrusted output is not persisted as the result",
                stderr="",
                provider="fake",
                protected_result={"result": {"summary": "Bell counts collected"}},
            )

    session = Session()
    await handlers.handle_qapp_execute(
        session,
        {
            "execution_id": str(execution_id),
            "workspace_id": str(uuid.uuid4()),
            "user_id": str(uuid.uuid4()),
        },
        sandbox=FakeSandbox(),
    )

    assert captured["result"] == {"summary": "Bell counts collected"}
    assert captured["error_code"] is None
    assert captured["spec"].qubits_estimate == 2
    assert "QAPP_INPUTS" in captured["spec"].trusted_setup
    # The result path must name this execution. A constant collides whenever two
    # executions share a filesystem, and Qapp executions are cross-tenant by
    # design, so one caller could read another's result.
    assert execution_id.hex in captured["spec"].protected_result_path
    assert captured["sandbox_meta"]["provider"] == "fake"


async def test_a_redelivered_execution_does_not_run_the_paid_sandbox_twice(monkeypatch):
    """CodeRabbit's finding on PR 764: cost, not just correctness.

    The handler's early return covers only `succeeded` and `failed`. A job
    redelivered while its execution is still `running` fell straight through it,
    because `mark_execution_running` promotes only a `queued` row and the
    handler ignored what it returned — so the second delivery started a SECOND
    paid sandbox for the same execution alongside the first, and then raced it
    to `finish_execution`.
    """
    execution_id = uuid.uuid4()
    qapp_id = uuid.uuid4()
    execution = SimpleNamespace(
        id=execution_id,
        qapp_id=qapp_id,
        # Already claimed by the delivery that is still in flight.
        status="running",
        started_at=dt.datetime(2026, 8, 25, tzinfo=dt.timezone.utc),
        inputs={"qubits": 2},
    )
    version = SimpleNamespace(
        id=uuid.uuid4(),
        qapp_id=qapp_id,
        quantum_source="RESULT = {}",
        qubits_estimate=2,
        fingerprint="a" * 64,
        output_schema={"type": "object", "properties": {}, "required": []},
    )
    runs = []

    async def get_source(*_args):
        return execution, version

    async def mark_running(*_args):
        # False: the real function refuses a row that is not queued, and says so.
        return False

    async def finish(*_args, **_kwargs):
        runs.append("finished")

    class CountingSandbox:
        provider = "counting"

        async def _execute(self, spec):
            runs.append("sandbox")
            raise AssertionError("a redelivered execution reached the paid sandbox")

    monkeypatch.setattr(handlers.qapps_repo, "get_execution_source", get_source)
    monkeypatch.setattr(handlers.qapps_repo, "mark_execution_running", mark_running)
    monkeypatch.setattr(handlers.qapps_repo, "finish_execution", finish)

    session = Session()
    await handlers.handle_qapp_execute(
        session,
        {
            "execution_id": str(execution_id),
            "workspace_id": str(uuid.uuid4()),
            "user_id": str(uuid.uuid4()),
        },
        sandbox=CountingSandbox(),
    )

    assert runs == [], f"the redelivery did work it should have skipped: {runs}"
    assert session.commits == 0, "a skipped redelivery must not commit a claim it did not make"


async def _run_redelivery(monkeypatch, *, status, started_at, claimed):
    """One redelivery against an execution in a given state. Returns what ran."""
    execution_id = uuid.uuid4()
    qapp_id = uuid.uuid4()
    execution = SimpleNamespace(
        id=execution_id,
        qapp_id=qapp_id,
        status=status,
        started_at=started_at,
        inputs={"qubits": 2},
    )
    version = SimpleNamespace(
        id=uuid.uuid4(),
        qapp_id=qapp_id,
        quantum_source="RESULT = {}",
        qubits_estimate=2,
        fingerprint="a" * 64,
        output_schema={"type": "object", "properties": {}, "required": []},
    )
    ran = []

    async def get_source(*_args):
        return execution, version

    async def mark_running(*_args, **_kwargs):
        return claimed

    async def finish(*_args, **_kwargs):
        ran.append("finished")

    async def record_usage(*_args, **_kwargs):
        return None

    class CountingSandbox:
        provider = "counting"

        async def _execute(self, spec):
            ran.append("sandbox")
            return SandboxResult(
                ok=True,
                exit_code=0,
                duration_ms=1,
                stdout="",
                stderr="",
                provider="counting",
                protected_result={"result": {}},
            )

    monkeypatch.setattr(handlers.qapps_repo, "get_execution_source", get_source)
    monkeypatch.setattr(handlers.qapps_repo, "mark_execution_running", mark_running)
    monkeypatch.setattr(handlers.qapps_repo, "finish_execution", finish)
    monkeypatch.setattr(handlers.usage_repo, "record_usage", record_usage)

    await handlers.handle_qapp_execute(
        Session(),
        {
            "execution_id": str(execution_id),
            "workspace_id": str(uuid.uuid4()),
            "user_id": str(uuid.uuid4()),
        },
        sandbox=CountingSandbox(),
    )
    return ran


async def test_a_live_redelivery_is_refused_but_a_dead_one_is_re_run(monkeypatch):
    """Both halves, because fixing one of them alone breaks the other.

    Refusing every non-queued row stops the double charge and creates a worse
    bug: `recover_stale_jobs` requeues a job only when its LEASE HAS EXPIRED, so
    the redelivery it produces is the one case where the previous worker really
    did die mid-execution. Declining that one leaves the execution `running`
    with no result and no error for ever, while the queue counts the job done.

    `mark_execution_running` decides which it is from the row's age; this asserts
    the handler acts on that answer in both directions.
    """
    fresh = dt.datetime.now(dt.timezone.utc)
    refused = await _run_redelivery(monkeypatch, status="running", started_at=fresh, claimed=False)
    assert refused == [], f"a live delivery's work was duplicated: {refused}"

    dead = await _run_redelivery(
        monkeypatch,
        status="running",
        started_at=fresh - dt.timedelta(minutes=30),
        claimed=True,
    )
    assert "sandbox" in dead, (
        "an execution abandoned by a dead worker was never re-run — it would sit "
        "in 'running' with no result and no error while the queue counted the job done"
    )
    assert "finished" in dead
