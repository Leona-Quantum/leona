"""DB-free checks for atomic conditional Run terminal closure."""

import uuid

from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus

from majorana_api.orm import Run
from majorana_api.repos import runs


class _Result:
    def __init__(self, *, row=None, rowcount=0):
        self.row = row
        self.rowcount = rowcount

    def scalars(self):
        return self

    def first(self):
        return self.row


class _Session:
    def __init__(self, *results):
        self.results = list(results)
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.results.pop(0)


def _scope() -> Scope:
    return Scope(user_id=uuid.uuid4(), workspace_id=uuid.uuid4(), role=Role.MEMBER)


def _run(scope: Scope, status: RunStatus) -> Run:
    return Run(
        id=uuid.uuid4(),
        conversation_id=uuid.uuid4(),
        workspace_id=scope.workspace_id,
        user_id=scope.user_id,
        task_prompt="test",
        mode=RunMode.EXECUTE,
        status=status,
        framework=Framework.QISKIT,
    )


async def test_dead_letter_closure_appends_both_events_and_one_status_update(monkeypatch):
    scope = _scope()
    run = _run(scope, RunStatus.RUNNING)
    session = _Session(_Result(row=run), _Result(rowcount=1))
    appended = []

    async def append(_scope, _session, run_id, **event):
        appended.append((run_id, event))

    monkeypatch.setattr(runs, "append_run_event", append)
    changed = await runs.fail_run_from_dead_letter(
        scope,
        session,
        run.id,
        error_payload={"stage": None, "code": "job_dead_letter", "message": "failed"},
        finished_payload={"status": RunStatus.FAILED},
        error_event_id=uuid.uuid4(),
        finished_event_id=uuid.uuid4(),
    )

    assert changed is True
    assert [event[1]["type"] for event in appended] == ["run.error", "run.finished"]
    assert len(session.statements) == 2


async def test_dead_letter_closure_does_not_overwrite_cancelled_run(monkeypatch):
    scope = _scope()
    run = _run(scope, RunStatus.CANCELLED)
    session = _Session(_Result(row=run))
    appended = []

    async def append(*args, **kwargs):
        appended.append((args, kwargs))

    monkeypatch.setattr(runs, "append_run_event", append)
    changed = await runs.fail_run_from_dead_letter(
        scope,
        session,
        run.id,
        error_payload={"stage": None, "code": "job_dead_letter", "message": "failed"},
        finished_payload={"status": RunStatus.FAILED},
        error_event_id=uuid.uuid4(),
        finished_event_id=uuid.uuid4(),
    )

    assert changed is False
    assert appended == []
    assert len(session.statements) == 1
