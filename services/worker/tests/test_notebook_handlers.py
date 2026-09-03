"""The notebook lane's job handlers: generate, revise (incl. the no-op reply
path), and every failure path landing the version FAILED / run FAILED rather
than dead-lettering silently.

Fakes follow the shapes established by `test_handlers.py` (`Session`, `Sink`,
`Store`) and `test_simple_ports.py` (`QueueLLM`) / `test_qapp_handlers.py`
(`FakeSandbox`), adapted for the notebook lane's own ports and its
`NotebookStore` protocol (`majorana_worker.notebook_handlers`).

`LESSON` is copied verbatim from `packages/py/notebooks/tests/
leona_notebook_fixtures.py` rather than imported, since this suite is run as
`pytest services/worker -k notebook` — a directory `packages/py/notebooks/tests`
never collected in that invocation is never added to `sys.path`, so a bare
`from leona_notebook_fixtures import LESSON` would only work by accident of
which other tests happen to run alongside it.
"""

from __future__ import annotations

import json
import re
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import RunStatus
from majorana_llm import LLMResponse
from majorana_sandbox import SandboxResult
from majorana_sandbox.local import LocalSubprocessSandbox

from leona_notebooks.source import parse_source
from leona_notebooks.spec import NotebookSpec

from majorana_worker import handlers, notebook_handlers as nh

LESSON = """\
# ---
# title: Quantum coin
# kind: lesson
# summary: A one-qubit circuit that behaves like a fair coin.
# objectives:
#   - Build a one-qubit circuit and sample it
# duration_minutes: 20
# ---

# %% [markdown] role=objective
# ## What you will build
# A circuit that behaves like a *fair coin*, with $p = 1/2$.

# %% role=setup
import qiskit
print(qiskit.__version__)

# %% [markdown] role=concept
# A qubit starts in $|0\\rangle$.

# %% [markdown] role=predict
# Before running: how many of 1000 shots land on `1`?

# %% role=run
from qiskit import QuantumCircuit
from qiskit.primitives import StatevectorSampler
qc = QuantumCircuit(1)
qc.h(0)
qc.measure_all()
counts = StatevectorSampler(seed=7).run([qc], shots=1000).result()[0].data.meas.get_counts()
counts

# %% [markdown] role=observe
# Roughly half and half.

# %% [markdown] role=explain
# The Hadamard gate puts the qubit in an equal superposition.

# %% role=modify
qc2 = QuantumCircuit(1)
qc2.x(0)
qc2.measure_all()

# %% role=checkpoint
assert 400 < counts.get("1", 0) < 600, f"expected a fair coin, got {counts}"

# %% [markdown] role=summary
# You built a quantum coin.
"""

GUARD_VIOLATING_DRAFT = """\
# ---
# title: Not allowed
# kind: scratch
# ---

# %% role=run
import os
os.system("echo hi")
"""

OUTLINE_JSON = json.dumps(
    {
        "title": "Quantum coin",
        "kind": "lesson",
        "summary": "s",
        "objectives": ["Build a coin"],
        "duration_minutes": 20,
        "sections": [
            {
                "heading": "h",
                "purpose": "p",
                "cells": [{"kind": "markdown", "role": "objective", "intent": "i"}],
            }
        ],
    }
)
REVIEW_JSON = json.dumps({"verdict": "ready", "findings": []})


# --------------------------------------------------------------------------- fakes


class Session:
    """Mirrors `test_handlers.py`'s `Session`: `.get` answers the owner-tier
    lookup, defaulting to `None` (free-lane fallback, ai-ops#171)."""

    def __init__(self, user=None):
        self.commits = 0
        self.rollbacks = 0
        self.user = user

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def get(self, _model, _pk):
        return self.user


class FakeEventSink:
    """Records every emitted event; the ports write to it live."""

    def __init__(self, scope, session, run_id):
        self.events: list[tuple[str, dict]] = []

    async def emit(self, type, payload, *, event_id=None):
        self.events.append((type, payload))


class FakeRunStore:
    """Mirrors `test_handlers.py`'s `Store`, constructed the way
    `RepoRunStateStore(scope, session, run_id)` is."""

    def __init__(self, scope, session, run_id):
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


class QueueLLM:
    """From `test_simple_ports.py`: pops canned response texts in order."""

    def __init__(self, texts):
        self.texts = list(texts)
        self.requests = []

    async def complete(self, request, *, on_delta=None):
        self.requests.append(request)
        return LLMResponse(
            text=self.texts.pop(0), model=request.model, input_tokens=1, output_tokens=1
        )


class RaisingLLM:
    def __init__(self, exc: Exception):
        self._exc = exc

    async def complete(self, request, *, on_delta=None):
        raise self._exc


_CALL_ID_RE = re.compile(r"__leona_run_cell__\('([^']+)'")


class FakeSandbox:
    """A protocol-shaped stand-in for the real sandbox: parses the composed
    program's `__leona_run_cell__(id, ...)` calls back out of `spec.code` and
    answers `ok` for every cell (or errors at `fail_cell_id`), shaped exactly
    like `sandbox_program._OBSERVER` writes — see `report_from_observation`."""

    provider = "fake"

    def __init__(self, *, fail_cell_id: str | None = None):
        self.fail_cell_id = fail_cell_id
        self.specs: list = []

    async def _execute(self, spec):
        self.specs.append(spec)
        cells = []
        stopped = False
        for cell_id in _CALL_ID_RE.findall(spec.code):
            if stopped:
                cells.append({"id": cell_id, "status": "not_run"})
                continue
            if cell_id == self.fail_cell_id:
                cells.append(
                    {
                        "id": cell_id,
                        "status": "error",
                        "stdout": "",
                        "stderr": "",
                        "outputs": [],
                        "error": {
                            "ename": "NameError",
                            "evalue": "name 'undefined_name' is not defined",
                            "traceback": ["NameError: name 'undefined_name' is not defined"],
                        },
                        "duration_ms": 5,
                        "execution_count": None,
                        "note": "",
                    }
                )
                stopped = True
            else:
                cells.append(
                    {
                        "id": cell_id,
                        "status": "ok",
                        "stdout": "",
                        "stderr": "",
                        "outputs": [
                            {
                                "mime": "text/plain",
                                "data": "{'0': 512, '1': 488}",
                                "truncated": False,
                            }
                        ],
                        "duration_ms": 5,
                        "execution_count": None,
                        "note": "",
                    }
                )
        return SandboxResult(
            ok=not stopped,
            exit_code=0,
            duration_ms=20,
            stdout="",
            stderr="",
            provider="fake",
            protected_result={
                "notebook": {
                    "cells": cells,
                    "environment": {
                        "python": "3.11.9",
                        "qiskit": "2.5.2",
                        "figures": "unavailable",
                    },
                    "image_bytes": 0,
                    "dropped_bytes": 0,
                    "stopped": stopped,
                }
            },
        )


class MemoryNotebookStore:
    """`notebook_handlers.NotebookStore` in memory, for tests only."""

    def __init__(self):
        self.versions: dict[uuid.UUID, SimpleNamespace] = {}
        self.turns: list[SimpleNamespace] = []

    def seed_version(self, notebook_id, version_id, *, seq=1, status="queued", **overrides):
        row = SimpleNamespace(
            id=version_id,
            notebook_id=notebook_id,
            seq=seq,
            status=status,
            request=None,
            spec=None,
            source="",
            ipynb=None,
            report=None,
            review=None,
            error="",
            message=None,
        )
        for key, value in overrides.items():
            setattr(row, key, value)
        self.versions[version_id] = row
        return row

    async def get_version(self, scope, session, version_id):
        return self.versions[version_id]

    async def get_version_by_seq(self, scope, session, notebook_id, seq):
        for row in self.versions.values():
            if row.notebook_id == notebook_id and row.seq == seq:
                return row
        raise KeyError((notebook_id, seq))

    async def get_current_version(self, scope, session, notebook_id):
        candidates = [
            row
            for row in self.versions.values()
            if row.notebook_id == notebook_id and row.status == "ready"
        ]
        return max(candidates, key=lambda row: row.seq) if candidates else None

    async def set_version_running(self, scope, session, version_id):
        row = self.versions[version_id]
        row.status = "running"
        return row

    async def set_version_result(
        self,
        scope,
        session,
        version_id,
        *,
        status,
        spec,
        source,
        ipynb,
        report,
        review,
        error,
        message=None,
    ):
        row = self.versions[version_id]
        row.status = status
        row.spec = spec
        row.source = source
        row.ipynb = ipynb
        row.report = report
        row.review = review
        row.error = error
        row.message = message
        return row

    async def append_turn(self, scope, session, notebook_id, *, role, content, version_id, run_id):
        seq = sum(1 for t in self.turns if t.notebook_id == notebook_id) + 1
        turn = SimpleNamespace(
            id=uuid.uuid4(),
            notebook_id=notebook_id,
            seq=seq,
            role=role,
            content=content,
            version_id=version_id,
            run_id=run_id,
        )
        self.turns.append(turn)
        return turn

    async def list_turns(self, scope, session, notebook_id, *, limit=200):
        rows = [t for t in self.turns if t.notebook_id == notebook_id]
        return rows[-limit:]


def _payload(
    *, run_id, notebook_id, version_id, kind="generate", request=None, base_version_id=None
):
    payload = {
        "run_id": str(run_id),
        "notebook_id": str(notebook_id),
        "version_id": str(version_id),
        "user_id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "kind": kind,
        "request": request or {},
        "response_locale": "en",
    }
    if base_version_id is not None:
        payload["base_version_id"] = str(base_version_id)
    return payload


@pytest.fixture(autouse=True)
def _fake_run_plumbing(monkeypatch):
    """Every handler test runs against fakes, never a real DB: the sink/run
    store classes the handler constructs internally, and usage metering."""
    monkeypatch.setattr(handlers, "RepoEventSink", FakeEventSink)
    monkeypatch.setattr(handlers, "RepoRunStateStore", FakeRunStore)
    usage_calls: list[dict] = []

    async def fake_record_usage(scope, session, *, kind, quantity, meta, event_id=None):
        usage_calls.append({"kind": kind, "quantity": quantity, "meta": meta})

    monkeypatch.setattr(nh.usage_repo, "record_usage", fake_record_usage, raising=False)
    return usage_calls


# --------------------------------------------------------------------------- generate


async def test_generate_happy_path_saves_a_ready_version_with_outputs(_fake_run_plumbing):
    usage_calls = _fake_run_plumbing
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_generate(
        session,
        _payload(
            run_id=run_id,
            notebook_id=notebook_id,
            version_id=version_id,
            request={"brief": "teach me a coin"},
        ),
        llm=QueueLLM([OUTLINE_JSON, LESSON, REVIEW_JSON]),
        sandbox=FakeSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    assert version.ipynb is not None
    code_cell_outputs = [
        cell["outputs"] for cell in version.ipynb["cells"] if cell["cell_type"] == "code"
    ]
    assert any(outputs for outputs in code_cell_outputs), "expected at least one cell with outputs"
    assert version.review is not None and version.review["verdict"] == "ready"

    assert len(store.turns) == 1
    assert store.turns[0].role == "nala"
    assert store.turns[0].notebook_id == notebook_id

    # usage: SANDBOX_SECONDS recorded once for the run.
    assert len(usage_calls) == 1
    assert usage_calls[0]["quantity"] > 0


async def test_guard_violating_draft_ends_failed_with_the_guard_message(_fake_run_plumbing):
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_generate(
        session,
        _payload(
            run_id=run_id,
            notebook_id=notebook_id,
            version_id=version_id,
            request={"brief": "do something unsafe"},
        ),
        llm=QueueLLM([OUTLINE_JSON, GUARD_VIOLATING_DRAFT]),
        sandbox=FakeSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "failed"
    assert "safety guard" in version.error
    assert store.turns and "couldn't finish" in store.turns[0].content


async def test_provider_exception_ends_failed_with_an_error_and_the_run_failed(_fake_run_plumbing):
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_generate(
        session,
        _payload(
            run_id=run_id, notebook_id=notebook_id, version_id=version_id, request={"brief": "b"}
        ),
        llm=RaisingLLM(RuntimeError("provider is down")),
        sandbox=FakeSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "failed"
    assert "provider is down" in version.error
    assert store.turns and store.turns[0].role == "nala"


# --------------------------------------------------------------------------- revise


async def test_revise_with_no_ops_yields_a_ready_no_change_version_and_a_reply_turn(
    _fake_run_plumbing,
):
    run_id, notebook_id = uuid.uuid4(), uuid.uuid4()
    base_version_id, new_version_id = uuid.uuid4(), uuid.uuid4()
    base_spec = parse_source(LESSON)
    store = MemoryNotebookStore()
    store.seed_version(
        notebook_id,
        base_version_id,
        seq=1,
        status="ready",
        spec=base_spec.model_dump(mode="json"),
        source=LESSON,
        ipynb={"cells": []},
        report={"notebook_slug": base_spec.slug, "ok": True, "runner": "sandbox", "cells": []},
        review=None,
    )
    store.seed_version(notebook_id, new_version_id, seq=2)
    session = Session()

    plan_json = json.dumps({"reply": "It is a Hadamard gate.", "summary": "", "ops": []})
    await nh.handle_notebook_revise(
        session,
        _payload(
            run_id=run_id,
            notebook_id=notebook_id,
            version_id=new_version_id,
            kind="revise",
            request={"message": "what is H?"},
            base_version_id=base_version_id,
        ),
        llm=QueueLLM([plan_json]),
        sandbox=FakeSandbox(),
        store=store,
    )

    version = store.versions[new_version_id]
    assert version.status == "ready"
    assert version.message == "no change"
    assert version.spec == base_spec.model_dump(mode="json")
    assert store.turns and store.turns[-1].content == "It is a Hadamard gate."


# --------------------------------------------------------------------------- real sandbox, end to end


async def test_generate_through_the_real_local_subprocess_sandbox(_fake_run_plumbing):
    """Exercises the real path once: compose -> subprocess -> report, with no
    fake standing in for the sandbox."""
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_generate(
        session,
        _payload(
            run_id=run_id,
            notebook_id=notebook_id,
            version_id=version_id,
            request={"brief": "teach me a coin"},
        ),
        llm=QueueLLM([OUTLINE_JSON, LESSON, REVIEW_JSON]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    # The real sandbox actually executed the checkpoint cell's assertion, and
    # the spec round-trips through NotebookSpec cleanly.
    NotebookSpec.model_validate(version.spec)
    assert version.report["ok"] is True


# ------------------------------------------------------------- author (the editor)

AUTHORED = """\
# ---
# title: My own edit
# kind: scratch
# ---

# %% id=c01
x = 21
print("first")

# %% id=c02
print("second", x * 2)

# %% id=c03
print("third")
"""


@pytest.fixture
def run_stores(monkeypatch, _fake_run_plumbing):
    """Every `RepoRunStateStore` the handler builds, so a test can read how the run was
    finished. Depends on `_fake_run_plumbing`, which patches the same name, so this
    patch is the one that wins."""
    built: list[FakeRunStore] = []

    class RecordingRunStore(FakeRunStore):
        def __init__(self, scope, session, run_id):
            super().__init__(scope, session, run_id)
            built.append(self)

    monkeypatch.setattr(handlers, "RepoRunStateStore", RecordingRunStore)
    return built


def _author_payload(
    *, run_id, notebook_id, version_id, source=AUTHORED, run_until=None, slug="my-own-edit"
):
    spec = parse_source(source, slug=slug)
    payload = _payload(
        run_id=run_id,
        notebook_id=notebook_id,
        version_id=version_id,
        kind="author",
        request={"spec": spec.model_dump(mode="json"), "message": "my edit"},
    )
    payload["slug"] = slug
    payload["run_until"] = run_until
    return payload


async def test_author_runs_the_readers_spec_in_the_real_sandbox_and_saves_it_ready(
    _fake_run_plumbing,
):
    """The whole point of the lane: the reader's own cells, executed by the same
    sandbox path Nala's builds use, with no LLM anywhere."""
    usage_calls = _fake_run_plumbing
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_revise(
        session,
        _author_payload(run_id=run_id, notebook_id=notebook_id, version_id=version_id),
        # An empty queue: any LLM call at all on this path raises IndexError, so this
        # is the assertion that the author branch never reaches a model.
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    NotebookSpec.model_validate(version.spec)
    assert version.report["ok"] is True
    by_id = {cell["id"]: cell for cell in version.report["cells"]}
    assert by_id["c01"]["stdout"] == "first\n"
    assert by_id["c02"]["stdout"] == "second 42\n"
    assert by_id["c03"]["status"] == "ok"
    assert version.ipynb is not None
    assert usage_calls, "a sandbox dispatch must be metered"
    # The chat rail says what happened, without a model having said it.
    assert store.turns[-1].role == "nala"
    assert "3" in store.turns[-1].content


async def test_author_with_a_failing_cell_is_still_a_ready_version_and_a_succeeded_run(
    run_stores,
):
    """A cell that raised is a result the reader asked to see, not a failed run — the
    version stays `ready` (so it becomes what the notebook shows) and the run finishes
    SUCCEEDED with `notebook_authored`."""
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()
    source = (
        "# ---\n# title: Broken on purpose\n# kind: scratch\n# ---\n"
        "# %% id=c01\nprint('ran')\n"
        "# %% id=c02\nraise ValueError('boom')\n"
    )

    await nh.handle_notebook_revise(
        session,
        _author_payload(
            run_id=run_id, notebook_id=notebook_id, version_id=version_id, source=source
        ),
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    assert version.error == ""
    by_id = {cell["id"]: cell for cell in version.report["cells"]}
    assert by_id["c01"]["status"] == "ok"
    assert by_id["c02"]["status"] == "error"
    assert by_id["c02"]["error"]["ename"] == "ValueError"
    # The report itself is honest that the notebook did not run clean...
    assert version.report["ok"] is False
    # ...and the RUN still succeeded, because showing the traceback is the deliverable.
    assert run_stores[0].status is RunStatus.SUCCEEDED
    assert run_stores[0].finished["reason_code"] == "notebook_authored"


async def test_author_with_run_until_stops_and_reports_the_rest_not_run(run_stores):
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_revise(
        session,
        _author_payload(
            run_id=run_id, notebook_id=notebook_id, version_id=version_id, run_until="c02"
        ),
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    by_id = {cell["id"]: cell for cell in version.report["cells"]}
    assert by_id["c01"]["status"] == "ok" and by_id["c02"]["status"] == "ok"
    assert by_id["c03"]["status"] == "not_run"
    # Stopping where the reader asked is a clean run, not a truncated one.
    assert version.report["ok"] is True
    assert run_stores[0].status is RunStatus.SUCCEEDED
    assert "c02" in store.turns[-1].content


async def test_author_records_structure_warnings_without_refusing_the_save(_fake_run_plumbing):
    """A scratch notebook has no structure rules to fail, so this uses a `lesson`,
    which has several — and the save still lands `ready`."""
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()
    source = "# ---\n# title: Bare lesson\n# kind: lesson\n# ---\n# %% id=c01\nprint('hi')\n"

    await nh.handle_notebook_revise(
        session,
        _author_payload(
            run_id=run_id, notebook_id=notebook_id, version_id=version_id, source=source
        ),
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "ready", version.error
    assert version.review is not None
    assert version.review["warnings"], "a bare lesson fails several structure rules"
    assert version.review["verdict"] == "needs-attention"
    assert version.review["findings"] == []


async def test_author_whose_cells_the_guard_refuses_ends_failed(run_stores):
    """Nothing ran, so there is no result to show: this one IS a failure."""
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()

    await nh.handle_notebook_revise(
        session,
        _author_payload(
            run_id=run_id,
            notebook_id=notebook_id,
            version_id=version_id,
            source=GUARD_VIOLATING_DRAFT,
        ),
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    version = store.versions[version_id]
    assert version.status == "failed"
    assert version.error
    assert run_stores[0].status is RunStatus.FAILED
    assert run_stores[0].finished["reason_code"] == "notebook_author_failed"


async def test_author_needs_no_base_version(_fake_run_plumbing):
    """The store holds only the queued version being written — no ready base at all.
    An authored spec is self-contained, so this must still run."""
    run_id, notebook_id, version_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    store = MemoryNotebookStore()
    store.seed_version(notebook_id, version_id)
    session = Session()
    assert await store.get_current_version(None, None, notebook_id) is None

    await nh.handle_notebook_revise(
        session,
        _author_payload(run_id=run_id, notebook_id=notebook_id, version_id=version_id),
        llm=QueueLLM([]),
        sandbox=LocalSubprocessSandbox(),
        store=store,
    )

    assert store.versions[version_id].status == "ready"
