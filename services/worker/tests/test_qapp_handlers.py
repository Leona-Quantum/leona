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
    def __init__(self, user=None):
        self.commits = 0
        self.rollbacks = 0
        # The row `session.get(User, ...)` returns. `None` is the DEFAULT here on
        # purpose: it is the "owner row is gone" branch, which every test that is
        # not about tier sizing should take, and which must resolve to the
        # free-lane default rather than to the ceiling (ai-ops#181, and #171
        # before it). A fake that handed back a paid account by default would
        # make every one of these tests assert 4096 without saying so.
        self.user = user

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def get(self, _model, _pk):
        return self.user


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


async def _memory_for_visitor(monkeypatch, visitor):
    """Run one Qapp execution as `visitor` and return the `memory_mb` it asked for."""
    execution_id = uuid.uuid4()
    qapp_id = uuid.uuid4()
    execution = SimpleNamespace(
        id=execution_id, qapp_id=qapp_id, status="queued", started_at=None, inputs={}
    )
    version = SimpleNamespace(
        id=uuid.uuid4(),
        qapp_id=qapp_id,
        quantum_source="RESULT = {'summary': 'ok'}",
        qubits_estimate=2,
        fingerprint="b" * 64,
        output_schema={
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
        },
    )
    captured = {}

    async def get_source(_scope, _session, _requested):
        return execution, version

    async def mark_running(*_args):
        execution.status = "running"
        return True

    async def finish(*_args, **_kwargs):
        return None

    async def record_usage(*_args, **_kwargs):
        return None

    monkeypatch.setattr(handlers.qapps_repo, "get_execution_source", get_source)
    monkeypatch.setattr(handlers.qapps_repo, "mark_execution_running", mark_running)
    monkeypatch.setattr(handlers.qapps_repo, "finish_execution", finish)
    monkeypatch.setattr(handlers.usage_repo, "record_usage", record_usage)
    # The allowlists are read from the environment by `EnvTierSources.from_env`.
    # Cleared here so the tier comes from the account row alone and the test does
    # not pass or fail on whoever's address happens to be exported locally.
    for name in ("MAJORANA_DEVELOPER_EMAILS", "MAJORANA_TEAM_EMAILS", "MAJORANA_PRO_EMAILS"):
        monkeypatch.delenv(name, raising=False)

    class CapturingSandbox:
        provider = "fake"

        async def _execute(self, spec):
            captured["memory_mb"] = spec.memory_mb
            return SandboxResult(
                ok=True,
                exit_code=0,
                duration_ms=1,
                stdout="",
                stderr="",
                provider="fake",
                protected_result={"result": {"summary": "ok"}},
            )

    await handlers.handle_qapp_execute(
        Session(user=visitor),
        {
            "execution_id": str(execution_id),
            "workspace_id": str(uuid.uuid4()),
            "user_id": str(uuid.uuid4()),
        },
        sandbox=CapturingSandbox(),
    )
    return captured["memory_mb"]


async def test_a_paid_visitor_gets_the_paid_sandbox_on_someone_elses_qapp(monkeypatch):
    """ai-ops#181, the owner's ruling: *"The visitor's tier — a paying visitor
    gets 4096 MB on anyone's Qapp, a free visitor gets 2048 and may see it fail."*

    The account this reads is the one on the JOB PAYLOAD, which `execute_qapp`
    fills from the caller's own scope — so on a published Qapp at `/q/<slug>` it
    is whoever opened the page, not whoever wrote it. Nothing in this path
    consults `qapp.owner_user_id`, and that is the whole content of the ruling.
    """
    assert (
        await _memory_for_visitor(
            monkeypatch, SimpleNamespace(email="paying@example.com", plan="pro")
        )
        == 4096
    )


async def test_a_free_visitor_gets_the_free_sandbox_on_someone_elses_qapp(monkeypatch):
    """The other half of the same ruling, and the half that makes it a decision:
    a free visitor may see a Qapp fail that works for a paying one."""
    assert (
        await _memory_for_visitor(monkeypatch, SimpleNamespace(email="free@example.com", plan=None))
        == 2048
    )


async def test_an_unresolvable_visitor_falls_back_to_the_free_lane_not_the_ceiling(monkeypatch):
    """The fallback direction, which is the arm with a real failure mode.

    `artifact_limit` treats a missing owner row as *unlimited*, because losing an
    artifact an account already owns is the worse error. Memory goes the other
    way and must keep going the other way: this is a CROSS-TENANT path — any
    signed-in visitor may execute any published Qapp — so an unresolvable tier
    that fell back to `MAX_MEMORY_MB` would buy a second vCPU against a paid
    provider for a caller nobody could identify. Asserting `DEFAULT_MEMORY_MB`
    rather than the literal 2048 is deliberate: it is the same constant the code
    falls back to, so this test cannot pass by coincidence if the free tier's
    allowance is ever changed.
    """
    from majorana_sandbox import DEFAULT_MEMORY_MB

    memory = await _memory_for_visitor(monkeypatch, None)
    assert memory == DEFAULT_MEMORY_MB
    assert memory != 4096


# --- ai-ops#180: smoke at both ends -----------------------------------------
#
# His ruling, quoted: *"Smoke at both ends but only warn the creator, publish
# either way."* Every test below asserts a REPORT, never a refusal — a version
# that fails at its top of range is still generated and still publishable, and a
# test that asserted otherwise would be pinning the option he did not pick.


def test_the_low_end_chooser_is_unchanged():
    """The gate the repair loop drives must keep behaving exactly as it did.

    This is the regression arm for the whole change: `end="low"` is what proves
    the generated program runs at all, and altering it would alter which
    candidates are accepted — a much larger blast radius than the warning this
    issue asked for.
    """
    assert handlers._qapp_smoke_value({"type": "integer", "minimum": 1, "maximum": 20_000}) == 1
    assert handlers._qapp_smoke_value({"type": "integer", "minimum": 1, "default": 1024}) == 1024
    assert handlers._qapp_smoke_value({"enum": ["a", "b", "c"]}) == "a"
    assert handlers._qapp_smoke_value({"type": "boolean"}) is False
    assert handlers._qapp_smoke_value({"type": "string", "minLength": 3}) == "xxx"
    assert handlers._qapp_smoke_value(
        {"type": "array", "items": {"type": "integer"}, "minItems": 2, "maxItems": 50}
    ) == [0, 0]


def test_the_high_end_chooser_takes_the_top_of_every_declared_bound():
    """The issue's own example: `shots 1 to 20000` was published on a 1-shot run."""
    assert (
        handlers._qapp_smoke_value({"type": "integer", "minimum": 1, "maximum": 20_000}, end="high")
        == 20_000
    )
    assert (
        handlers._qapp_smoke_value({"type": "number", "minimum": 0.0, "maximum": 3.5}, end="high")
        == 3.5
    )
    assert handlers._qapp_smoke_value({"type": "string", "maxLength": 4}, end="high") == "xxxx"
    assert handlers._qapp_smoke_value(
        {"type": "array", "items": {"type": "integer", "maximum": 9}, "maxItems": 3}, end="high"
    ) == [9, 9, 9]
    # A second point rather than a maximum, and the docstring says so: an enum
    # declares no order and a boolean declares no magnitude.
    assert handlers._qapp_smoke_value({"enum": ["a", "b", "c"]}, end="high") == "c"
    assert handlers._qapp_smoke_value({"type": "boolean"}, end="high") is True


def test_a_comfortable_default_does_not_win_at_the_high_end():
    """The inversion that makes the second run worth its sandbox.

    `default` beats everything at the low end. If it also won here, a schema
    declaring `1 to 20000` with `default: 1024` would run 1024 twice and report
    a pass at "its largest declared inputs" — a warning that is silent in
    exactly the case it exists for.
    """
    schema = {"type": "integer", "minimum": 1, "maximum": 20_000, "default": 1024}
    assert handlers._qapp_smoke_value(schema) == 1024
    assert handlers._qapp_smoke_value(schema, end="high") == 20_000


def test_an_unbounded_property_has_no_top_of_range_to_run():
    """No declared ceiling means the top of the range IS the bottom.

    `normalize_qapp_schema` requires no `maximum`, no `maxLength` and no
    `maxItems`, so this is the ordinary case and not an edge one. Returning the
    low value here is what lets `_qapp_range_smoke` skip the second sandbox
    instead of paying for a duplicate run.
    """
    assert handlers._qapp_smoke_value({"type": "integer", "minimum": 7}, end="high") == 7
    assert handlers._qapp_smoke_value({"type": "string", "minLength": 2}, end="high") == "xx"
    assert handlers._qapp_smoke_value(
        {"type": "array", "items": {"type": "integer"}, "minItems": 1}, end="high"
    ) == [0]
    assert handlers._qapp_smoke_value({"type": "integer", "default": 512}, end="high") == 512


class _RangeSandbox:
    provider = "fake"

    def __init__(self, *, ok=True, result=None, stderr="", exit_code=0):
        self.calls = []
        self._ok = ok
        self._result = {"summary": "ok"} if result is None else result
        self._stderr = stderr
        self._exit_code = exit_code

    async def _execute(self, spec):
        self.calls.append(spec)
        return SandboxResult(
            ok=self._ok,
            exit_code=self._exit_code,
            duration_ms=42,
            stdout="",
            stderr=self._stderr,
            provider="fake",
            protected_result={"result": self._result},
        )


def _candidate(input_schema):
    return SimpleNamespace(
        quantum_source="RESULT = {'summary': 'ok'}",
        qubits_estimate=2,
        input_schema=input_schema,
        output_schema={
            "type": "object",
            "properties": {"summary": {"type": "string"}},
            "required": ["summary"],
        },
    )


async def test_a_qapp_that_survives_its_largest_inputs_is_recorded_as_passed():
    sandbox = _RangeSandbox()
    report = await handlers._qapp_range_smoke(
        sandbox,
        uuid.uuid4(),
        _candidate(
            {
                "type": "object",
                "properties": {"shots": {"type": "integer", "minimum": 1, "maximum": 20_000}},
                "required": ["shots"],
            }
        ),
    )
    assert report.status.value == "passed"
    assert report.duration_ms == 42
    assert len(sandbox.calls) == 1
    # The inputs the second run actually used are the declared maxima, not the
    # minima the publication run already proved.
    assert "20000" in sandbox.calls[0].trusted_setup
    # The FREE lane's memory, deliberately, not the creator's tier: since
    # ai-ops#181 a Qapp is sized by the VISITOR who runs it, so the useful
    # warning is the one a free visitor would see.
    assert sandbox.calls[0].memory_mb == 2048


async def test_a_qapp_that_breaks_at_its_largest_inputs_is_warned_about_not_refused():
    """The whole ruling in one assertion: the report says `failed` and the
    function still RETURNS rather than raising. Nothing downstream refuses the
    generation and nothing refuses the publication."""
    sandbox = _RangeSandbox(ok=False, stderr="MemoryError: statevector", exit_code=137)
    report = await handlers._qapp_range_smoke(
        sandbox,
        uuid.uuid4(),
        _candidate(
            {
                "type": "object",
                "properties": {"shots": {"type": "integer", "minimum": 1, "maximum": 20_000}},
                "required": ["shots"],
            }
        ),
    )
    assert report.status.value == "failed"
    assert "MemoryError" in report.detail


async def test_a_schema_with_no_declared_ceiling_spends_no_second_sandbox():
    """`not_applicable` is a measurement, not a skip: it says the top of the
    range was checked and found to be the bottom. The assertion that matters is
    that NO sandbox ran — the cost control, on a surface whose hourly ceilings he
    had just asked to be halved."""
    sandbox = _RangeSandbox()
    report = await handlers._qapp_range_smoke(
        sandbox,
        uuid.uuid4(),
        _candidate(
            {
                "type": "object",
                "properties": {"label": {"type": "string", "minLength": 1}},
                "required": ["label"],
            }
        ),
    )
    assert report.status.value == "not_applicable"
    assert sandbox.calls == []


async def test_declared_maxima_the_input_contract_itself_rejects_are_reported_as_unreachable():
    """A schema whose own maxima exceed the 16 KB input cap. Nothing is run,
    because nothing COULD be — and that is a defect in the schema rather than in
    the program, so it is not reported as a failure of the code."""
    sandbox = _RangeSandbox()
    report = await handlers._qapp_range_smoke(
        sandbox,
        uuid.uuid4(),
        _candidate(
            {
                "type": "object",
                "properties": {
                    f"field{i}": {"type": "string", "maxLength": 1_000} for i in range(24)
                },
                "required": [],
            }
        ),
    )
    assert report.status.value == "unreachable"
    assert sandbox.calls == []


async def test_a_result_that_fails_its_own_output_schema_at_the_top_end_is_a_failure():
    """The low-end run validated the output; the high-end run has to as well.
    A program that returns a valid dict at 1 shot and a malformed one at 20000
    is exactly the class of defect this issue is about, and a check that only
    asked `ok` would pass it."""
    sandbox = _RangeSandbox(result={"summary": 12345})
    report = await handlers._qapp_range_smoke(
        sandbox,
        uuid.uuid4(),
        _candidate(
            {
                "type": "object",
                "properties": {"shots": {"type": "integer", "minimum": 1, "maximum": 8}},
                "required": ["shots"],
            }
        ),
    )
    assert report.status.value == "failed"
    assert len(sandbox.calls) == 1
