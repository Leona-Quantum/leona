"""DB-free checks for atomic conditional Run terminal closure."""

import uuid
from datetime import UTC, datetime

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Framework, Role, RunMode, RunStatus

from majorana_api.orm import Run
from majorana_api.repos import runs
from majorana_api.routes import runs as run_routes


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
        created_at=datetime.now(UTC),
    )


def test_run_resource_exposes_typed_summary_and_preserves_legacy_none():
    scope = _scope()
    row = _run(scope, RunStatus.SUCCEEDED)
    row.verifier_decision = "inconclusive"
    row.verification_summary = {
        "decision": "inconclusive",
        "semantic_review_decision": "inconclusive",
        "evidence_strength": "structural",
        "reason_code": "required_check_unavailable",
        "candidate_defect_observed": False,
        "failure_class": "capability_limit",
        "retry_target": "none",
        "unverified_claims": ["phase"],
        "checks": [{"method": "return_contract", "result": "pass"}],
    }

    resource = run_routes._to_resource(row)
    assert resource.verification_summary.reason_code == "required_check_unavailable"
    assert resource.verification_summary.checks[0].method.value == "return_contract"

    row.verification_summary = None
    assert run_routes._to_resource(row).verification_summary is None


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
        error_event_id=uuid.uuid4(),
        finished_event_id=uuid.uuid4(),
    )

    assert changed is True
    assert [event[1]["type"] for event in appended] == ["run.error", "run.finished"]
    assert appended[1][1]["payload"] == {
        "status": RunStatus.FAILED.value,
        "reason_code": "job_dead_letter",
    }
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
        error_event_id=uuid.uuid4(),
        finished_event_id=uuid.uuid4(),
    )

    assert changed is False
    assert appended == []
    assert len(session.statements) == 1


async def test_finish_run_appends_event_and_updates_row_in_one_transaction(monkeypatch):
    scope = _scope()
    run = _run(scope, RunStatus.RUNNING)
    session = _Session(_Result(row=run), _Result(rowcount=1))
    appended = []
    event_id = uuid.uuid4()

    async def append(_scope, _session, run_id, **event):
        appended.append((run_id, event))

    monkeypatch.setattr(runs, "append_run_event", append)
    status = await runs.finish_run(
        scope,
        session,
        run.id,
        RunStatus.FAILED,
        event_payload={"status": "failed", "reason_code": "run_timeout"},
        event_id=event_id,
    )

    assert status is RunStatus.FAILED
    assert appended == [
        (
            run.id,
            {
                "type": "run.finished",
                "payload": {"status": "failed", "reason_code": "run_timeout"},
                "event_id": event_id,
            },
        )
    ]
    assert len(session.statements) == 2


async def test_finish_run_loses_cleanly_to_concurrent_cancellation(monkeypatch):
    scope = _scope()
    run = _run(scope, RunStatus.CANCELLED)
    session = _Session(_Result(row=run))
    appended = []

    async def append(*args, **kwargs):
        appended.append((args, kwargs))

    monkeypatch.setattr(runs, "append_run_event", append)
    status = await runs.finish_run(
        scope,
        session,
        run.id,
        RunStatus.SUCCEEDED,
        event_payload={"status": "succeeded"},
        event_id=uuid.uuid4(),
    )

    assert status is RunStatus.CANCELLED
    assert appended == []
    assert len(session.statements) == 1


async def test_finish_run_rejects_failed_terminal_without_reason():
    scope = _scope()
    session = _Session()

    with pytest.raises(ValueError, match="machine-readable reason_code"):
        await runs.finish_run(
            scope,
            session,
            uuid.uuid4(),
            RunStatus.FAILED,
            event_payload={"status": "failed"},
            event_id=uuid.uuid4(),
        )

    assert session.statements == []
