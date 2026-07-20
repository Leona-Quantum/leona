import uuid

import pytest
from majorana_contracts.enums import Framework, RunMode, RunStatus
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
    assert sink.events[-1][0] == "run.finished"


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
