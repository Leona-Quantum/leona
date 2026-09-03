"""The course lane's job handlers: plan, revise, the one retry, and every failure
path landing the course readable and the run FAILED rather than dead-lettering.

Fakes follow `test_notebook_handlers.py` (`Session`, `FakeEventSink`,
`FakeRunStore`, `QueueLLM`) with a `MemoryCourseStore` for
`course_handlers.CourseStore`. No LLM and no database are reached.
"""

from __future__ import annotations

import json
import uuid
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import RunStatus
from majorana_llm import LLMResponse

from majorana_worker import course_handlers as ch
from majorana_worker import handlers


def _plan_json(*modules, title="Qiskit study group", summary="Eight weeks."):
    return json.dumps({"title": title, "summary": summary, "modules": list(modules)})


def _module(slug, **overrides):
    base = {
        "slug": slug,
        "title": slug.replace("-", " ").title(),
        "topic": "Qubits",
        "key_concepts": ["superposition"],
        "objectives": [f"Do {slug}"],
        "deliverable": "A notebook",
        "kind": "lesson",
        "duration_minutes": 45,
        "prerequisites": [],
        "brief": f"Teach {slug}, self-contained.",
    }
    base.update(overrides)
    return base


GOOD_PLAN = _plan_json(_module("week-01"), _module("week-02", prerequisites=["week-01"]))
#: `week-01` requires `week-02`, which comes AFTER it — refused by `CoursePlan`'s
#: own validator before `check_plan` is ever reached.
FORWARD_PREREQUISITE_PLAN = _plan_json(
    _module("week-01", prerequisites=["week-02"]), _module("week-02")
)
#: Structurally fine, pedagogically useless — this one gets past the validator and
#: is caught by `check_plan`.
NO_OBJECTIVES_PLAN = _plan_json(_module("week-01", objectives=[], brief=""))


# --------------------------------------------------------------------------- fakes


class Session:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        self.rollbacks += 1

    async def get(self, _model, _pk):
        return None


class FakeEventSink:
    def __init__(self, scope, session, run_id):
        self.events: list[tuple[str, dict]] = []

    async def emit(self, type, payload, *, event_id=None):
        self.events.append((type, payload))


class FakeRunStore:
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
    def __init__(self, texts):
        self.texts = list(texts)
        self.requests = []

    async def complete(self, request, *, on_delta=None):
        self.requests.append(request)
        return LLMResponse(
            text=self.texts.pop(0), model=request.model, input_tokens=1, output_tokens=1
        )


class RaisingLLM:
    def __init__(self, exc):
        self._exc = exc

    async def complete(self, request, *, on_delta=None):
        raise self._exc


class MemoryCourseStore:
    """`course_handlers.CourseStore` in memory. `replace_modules` implements the one
    rule that matters here: a surviving slug keeps its row, and with it its
    notebook."""

    def __init__(self, course_id, *, title="Qiskit study group", summary=""):
        self.course = SimpleNamespace(
            id=course_id,
            title=title,
            summary=summary,
            audience={},
            style={},
            framework={"name": "qiskit"},
            language="en",
            status="planning",
            plan=None,
        )
        self.modules: list[SimpleNamespace] = []
        self.turns: list[SimpleNamespace] = []
        self.statuses: list[str] = []

    def seed_module(self, slug, *, seq, notebook_id=None, **overrides):
        row = SimpleNamespace(
            id=uuid.uuid4(),
            course_id=self.course.id,
            seq=seq,
            slug=slug,
            title=slug.replace("-", " ").title(),
            topic="Qubits",
            key_concepts=["superposition"],
            objectives=[f"Do {slug}"],
            deliverable="A notebook",
            kind="lesson",
            duration_minutes=45,
            prerequisites=[],
            brief=f"Teach {slug}.",
            notebook_id=notebook_id,
        )
        for key, value in overrides.items():
            setattr(row, key, value)
        self.modules.append(row)
        return row

    async def get_course(self, scope, session, course_id):
        return self.course

    async def list_modules(self, scope, session, course_id):
        return sorted(self.modules, key=lambda row: row.seq)

    async def replace_modules(self, scope, session, course_id, plan):
        existing = {row.slug: row for row in self.modules}
        ordered = []
        for index, module in enumerate(plan.modules, start=1):
            row = existing.get(module.slug)
            if row is None:
                row = self.seed_module(module.slug, seq=index)
                self.modules.remove(row)
                row.notebook_id = None
            row.seq = index
            if row.notebook_id is None:
                row.title = module.title
                row.brief = module.brief
                row.kind = module.kind.value
                row.objectives = list(module.objectives)
            ordered.append(row)
        self.modules = ordered
        self.course.plan = plan.model_dump(mode="json")
        self.course.title = plan.title
        return ordered

    async def set_course_status(self, scope, session, course_id, status):
        self.course.status = status
        self.statuses.append(status)
        return self.course

    async def append_turn(self, scope, session, course_id, *, role, content, run_id):
        turn = SimpleNamespace(
            id=uuid.uuid4(),
            course_id=course_id,
            seq=len(self.turns) + 1,
            role=role,
            content=content,
            run_id=run_id,
        )
        self.turns.append(turn)
        return turn

    async def list_turns(self, scope, session, course_id, *, limit=200):
        return self.turns[-limit:]


def _payload(*, run_id, course_id, kind="plan", request=None):
    return {
        "run_id": str(run_id),
        "course_id": str(course_id),
        "user_id": str(uuid.uuid4()),
        "workspace_id": str(uuid.uuid4()),
        "kind": kind,
        "request": request or {},
        "response_locale": "en",
    }


@pytest.fixture(autouse=True)
def _fake_run_plumbing(monkeypatch):
    monkeypatch.setattr(handlers, "RepoEventSink", FakeEventSink)
    monkeypatch.setattr(handlers, "RepoRunStateStore", FakeRunStore)

    async def no_seeds(_scope, _session, _request):
        return "", None

    monkeypatch.setattr(ch, "_seed_material_for", no_seeds)


# ---------------------------------------------------------------------------- plan


async def test_plan_saves_the_modules_marks_the_course_planned_and_finishes_the_run():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM([GOOD_PLAN])

    await ch.handle_course_plan(
        Session(),
        _payload(
            run_id=run_id,
            course_id=course_id,
            request={"brief": "Teach me Qiskit in eight weeks", "module_count": 2},
        ),
        llm=llm,
        store=store,
    )

    assert [row.slug for row in store.modules] == ["week-01", "week-02"]
    assert [row.seq for row in store.modules] == [1, 2]
    assert store.course.status == "planned"
    assert store.course.plan["title"] == "Qiskit study group"
    assert len(store.turns) == 1 and store.turns[0].role == "nala"
    assert "Eight weeks." in store.turns[0].content
    # One call: the plan came back good the first time.
    assert len(llm.requests) == 1
    assert llm.requests[0].schema_name == "course_plan"


async def test_plan_prompt_carries_the_brief_the_module_count_and_the_schema():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    llm = QueueLLM([GOOD_PLAN])
    await ch.handle_course_plan(
        Session(),
        _payload(
            run_id=run_id,
            course_id=course_id,
            request={"brief": "A weekend on Grover", "module_count": 4},
        ),
        llm=llm,
        store=MemoryCourseStore(course_id),
    )
    request = llm.requests[0]
    assert "A weekend on Grover" in request.user
    assert "Plan EXACTLY 4 modules." in request.user
    assert "COURSE PLAN JSON SCHEMA" in request.user
    assert "self-contained" in request.system


async def test_a_plan_whose_prerequisites_point_forward_is_refused_and_re_asked():
    """The failure `CoursePlan`'s validator catches. The retry must quote it back."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM([FORWARD_PREREQUISITE_PLAN, GOOD_PLAN])

    await ch.handle_course_plan(
        Session(),
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=llm,
        store=store,
    )

    assert len(llm.requests) == 2, "a rejected plan must be re-asked exactly once"
    retry = llm.requests[1].user
    assert "YOUR PREVIOUS ANSWER WAS REJECTED" in retry
    assert "week-02" in retry
    # The second, good plan was saved.
    assert [row.slug for row in store.modules] == ["week-01", "week-02"]
    assert store.course.status == "planned"


async def test_a_plan_with_no_objectives_is_refused_by_check_plan_and_re_asked():
    """The other half: structurally valid, so only `check_plan` sees it."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM([NO_OBJECTIVES_PLAN, GOOD_PLAN])

    await ch.handle_course_plan(
        Session(),
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=llm,
        store=store,
    )

    retry = llm.requests[1].user
    assert "no objectives" in retry
    assert "empty brief" in retry
    assert store.course.status == "planned"


async def test_two_bad_plans_fail_the_run_with_a_reason_code_and_a_readable_turn():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM([FORWARD_PREREQUISITE_PLAN, FORWARD_PREREQUISITE_PLAN])
    session = Session()

    await ch.handle_course_plan(
        session,
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=llm,
        store=store,
    )

    assert len(llm.requests) == 2, "never a third attempt"
    assert store.course.status == "failed"
    assert store.modules == []
    assert store.turns and "couldn't finish" in store.turns[0].content
    assert "week-02" in store.turns[0].content


async def test_a_non_json_response_is_reported_as_such_and_re_asked():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM(["I would love to help, but here is some prose instead.", GOOD_PLAN])
    await ch.handle_course_plan(
        Session(),
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=llm,
        store=store,
    )
    assert "not JSON" in llm.requests[1].user
    assert store.course.status == "planned"


async def test_a_fenced_plan_is_accepted():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    await ch.handle_course_plan(
        Session(),
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=QueueLLM([f"```json\n{GOOD_PLAN}\n```"]),
        store=store,
    )
    assert store.course.status == "planned"


async def test_a_provider_exception_fails_the_course_and_the_run():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    await ch.handle_course_plan(
        Session(),
        _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
        llm=RaisingLLM(RuntimeError("provider is down")),
        store=store,
    )
    assert store.course.status == "failed"
    assert store.turns and "provider is down" in store.turns[0].content


async def test_a_run_that_is_not_queued_is_left_alone():
    """Replay safety: a job redelivered after the run moved on must do nothing."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    llm = QueueLLM([GOOD_PLAN])

    class AlreadyRunning(FakeRunStore):
        def __init__(self, scope, session, run_id):
            super().__init__(scope, session, run_id)
            self.status = RunStatus.RUNNING

    import majorana_worker.handlers as handlers_module

    original = handlers_module.RepoRunStateStore
    handlers_module.RepoRunStateStore = AlreadyRunning
    try:
        await ch.handle_course_plan(
            Session(),
            _payload(run_id=run_id, course_id=course_id, request={"brief": "b"}),
            llm=llm,
            store=store,
        )
    finally:
        handlers_module.RepoRunStateStore = original

    assert llm.requests == []
    assert store.modules == [] and store.turns == []


# -------------------------------------------------------------------------- revise


REVISION_JSON = json.dumps(
    {
        "reply": "Added a module on transpilation after week 1.",
        "summary": "Added transpilation.",
        "plan": {
            "title": "Qiskit study group",
            "summary": "",
            "modules": [
                _module("week-01"),
                _module("transpilation", prerequisites=["week-01"]),
                _module("week-02", prerequisites=["week-01"]),
            ],
        },
    }
)


async def test_revise_keeps_an_unchanged_modules_slug_and_its_notebook():
    """The rule the revise prompt states and `replace_modules` enforces: a module
    the reader did not ask to change keeps its slug, and therefore keeps the
    notebook already generated for it."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    notebook_id = uuid.uuid4()
    store.seed_module("week-01", seq=1, notebook_id=notebook_id, title="Hand-renamed")
    store.seed_module("week-02", seq=2)
    store.course.status = "planned"
    llm = QueueLLM([REVISION_JSON])

    await ch.handle_course_revise(
        Session(),
        _payload(
            run_id=run_id,
            course_id=course_id,
            kind="revise",
            request={"message": "add a module on transpilation after week 1"},
        ),
        llm=llm,
        store=store,
    )

    by_slug = {row.slug: row for row in store.modules}
    assert set(by_slug) == {"week-01", "transpilation", "week-02"}
    assert by_slug["week-01"].notebook_id == notebook_id
    assert by_slug["week-01"].title == "Hand-renamed", (
        "a generated module's content must not be rewritten by a plan revision"
    )
    assert [row.seq for row in store.modules] == [1, 2, 3]
    assert store.turns[-1].role == "nala"
    assert store.turns[-1].content == "Added a module on transpilation after week 1."
    assert llm.requests[0].schema_name == "course_revise"


async def test_revise_prompt_is_built_from_the_module_rows_not_the_stored_plan_column():
    """A hand edit through `PATCH /courses/{id}` moves the module rows and leaves
    `courses.plan` alone. Sending the model the stale column would have it "keep"
    a title the reader already changed."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    store.seed_module("week-01", seq=1, title="Renamed by the reader")
    store.course.plan = {
        "title": "Qiskit study group",
        "summary": "",
        "modules": [_module("week-01", title="Stale planner title")],
    }
    store.course.status = "planned"
    llm = QueueLLM([REVISION_JSON])

    await ch.handle_course_revise(
        Session(),
        _payload(run_id=run_id, course_id=course_id, kind="revise", request={"message": "tidy it"}),
        llm=llm,
        store=store,
    )

    user = llm.requests[0].user
    assert "Renamed by the reader" in user
    assert "Stale planner title" not in user
    assert "tidy it" in user
    assert "byte-identical" in llm.requests[0].system


async def test_a_rejected_revision_leaves_the_existing_plan_and_status_alone():
    """A bad EDIT is not a broken course: the modules stand and the status is not
    moved to `failed`."""
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    store.seed_module("week-01", seq=1)
    store.course.status = "planned"
    bad = json.dumps(
        {
            "reply": "r",
            "summary": "s",
            "plan": {
                "title": "T",
                "modules": [_module("week-01", prerequisites=["week-02"]), _module("week-02")],
            },
        }
    )

    await ch.handle_course_revise(
        Session(),
        _payload(run_id=run_id, course_id=course_id, kind="revise", request={"message": "m"}),
        llm=QueueLLM([bad, bad]),
        store=store,
    )

    assert store.course.status == "planned", "a failed edit must not fail the course"
    assert [row.slug for row in store.modules] == ["week-01"]
    assert store.turns[-1].role == "nala"
    assert "couldn't finish" in store.turns[-1].content


async def test_revise_on_a_course_with_no_modules_fails_the_turn_not_the_course():
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    store.course.status = "planned"
    await ch.handle_course_revise(
        Session(),
        _payload(run_id=run_id, course_id=course_id, kind="revise", request={"message": "m"}),
        llm=QueueLLM([REVISION_JSON]),
        store=store,
    )
    assert store.course.status == "planned"
    assert "no plan to revise" in store.turns[-1].content


# --------------------------------------------------------------------- dead letter


async def test_a_dead_lettered_plan_job_fails_the_course_rather_than_leaving_it_planning(
    monkeypatch,
):
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)

    async def fake_run_dead_letter(_session, _payload, _reason):
        return None

    monkeypatch.setattr(handlers, "handle_run_dead_letter", fake_run_dead_letter)
    await ch.handle_course_dead_letter(
        Session(),
        _payload(run_id=run_id, course_id=course_id, kind="plan"),
        "lease lost",
        store=store,
    )
    assert store.course.status == "failed"
    assert "dead-lettered" in store.turns[-1].content


async def test_a_dead_lettered_revise_job_does_not_fail_the_course(monkeypatch):
    run_id, course_id = uuid.uuid4(), uuid.uuid4()
    store = MemoryCourseStore(course_id)
    store.course.status = "planned"

    async def fake_run_dead_letter(_session, _payload, _reason):
        return None

    monkeypatch.setattr(handlers, "handle_run_dead_letter", fake_run_dead_letter)
    await ch.handle_course_dead_letter(
        Session(),
        _payload(run_id=run_id, course_id=course_id, kind="revise"),
        "lease lost",
        store=store,
    )
    assert store.course.status == "planned"
    assert "dead-lettered" in store.turns[-1].content


# ------------------------------------------------------------------- registration


def test_both_job_kinds_are_registered_with_a_dead_letter_handler():
    """A job kind the API can enqueue but the worker cannot dispatch dead-letters
    as an unknown kind, silently."""
    from majorana_api.jobs import COURSE_PLAN_JOB_KIND, COURSE_REVISE_JOB_KIND

    for kind in (COURSE_PLAN_JOB_KIND, COURSE_REVISE_JOB_KIND):
        assert kind in handlers.HANDLERS
        assert kind in handlers.DEAD_LETTER_HANDLERS


def test_both_llm_roles_resolve_under_every_provider_profile():
    from majorana_llm.models import _DEFAULTS

    for provider, roles in _DEFAULTS.items():
        assert "course_plan" in roles, provider
        assert "course_revise" in roles, provider
