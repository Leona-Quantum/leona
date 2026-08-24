from types import SimpleNamespace
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

    class FakeMeteredLLM:
        def __init__(self, **_kwargs):
            pass

        async def complete(self, request):
            captured["request"] = request
            return LLMResponse(
                text=response_text,
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

    monkeypatch.setattr(handlers, "MeteredAgentLLM", FakeMeteredLLM)
    monkeypatch.setattr(handlers.qapps_repo, "create_generated", create_generated)
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
        source_artifact_version_id=uuid.uuid4(),
    )

    assert result is RunStatus.SUCCEEDED
    assert captured["fields"]["ui_document"].startswith("<!doctype html>")
    assert captured["fields"]["input_schema"]["additionalProperties"] is False
    assert "Selected-framework source to preserve" in captured["request"].user
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
        execution.status = "running"

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
    assert captured["sandbox_meta"]["provider"] == "fake"
