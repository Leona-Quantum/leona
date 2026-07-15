import pytest
from majorana_contracts.enums import Framework, RunMode, RunStatus
from majorana_llm import LLMResponse
from majorana_pipeline import RunContext
from majorana_sandbox import LocalSubprocessSandbox
from majorana_worker import handlers


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


class _RecordingSink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload):
        self.events.append((event_type, payload))


class _FakeStore:
    def __init__(self):
        self.status = RunStatus.QUEUED

    async def current_status(self):
        return self.status

    async def set_status(self, new, **_fields):
        self.status = new


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
        tolerances=None,
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
    assert (
        llm.request.system
        == """You are a helpful quantum algorithm assistant.

Answer the user's messages directly. Explain quantum computing and quantum algorithms,
write or review code, and use Markdown and LaTeX when useful. Be accurate and say when
you are uncertain."""
    )
    assert [message.model_dump() for message in llm.request.messages] == [
        {"role": "user", "content": "What is a Bell state?"}
    ]
    assert sink.events[-1][0] == "run.finished"
