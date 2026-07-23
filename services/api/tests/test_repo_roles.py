"""Role gates fail CLOSED before any statement is issued: viewers cannot write,
members cannot administer."""

import uuid

import pytest
from repo_test_helpers import make_scope
from majorana_contracts.enums import Role, RunMode, RunStatus, UsageKind, VerificationMethod

from majorana_api.repos import (
    AuthzError,
    agent,
    artifacts,
    audit,
    folders,
    runs,
    usage,
    workspaces,
)

VIEWER_BLOCKED_WRITES = [
    lambda s, db: artifacts.create_artifact(
        s, db, slug="x", title="x", family="VQE", framework="qiskit"
    ),
    lambda s, db: artifacts.create_version(
        s,
        db,
        uuid.uuid4(),
        qasm_version="3.0",
        qasm="OPENQASM 3.0;",
        code="",
        code_lang="python",
        fingerprint="f",
        export_status="lossless",
    ),
    lambda s, db: runs.create_run(s, db, task_prompt="p", mode=RunMode.EXECUTE, framework="qiskit"),
    lambda s, db: folders.create_folder(s, db, name="folder"),
    lambda s, db: folders.set_run_folder(s, db, uuid.uuid4(), uuid.uuid4()),
    lambda s, db: runs.update_run_status(s, db, uuid.uuid4(), "running"),
    lambda s, db: runs.finish_run(
        s,
        db,
        uuid.uuid4(),
        RunStatus.FAILED,
        event_payload={"status": "failed", "reason_code": "agent_failed"},
        event_id=uuid.uuid4(),
    ),
    lambda s, db: runs.append_run_event(s, db, uuid.uuid4(), type="run.started", payload={}),
    lambda s, db: runs.add_verification_record(
        s, db, uuid.uuid4(), method=VerificationMethod.EXACT, result="pass"
    ),
    lambda s, db: usage.record_usage(s, db, kind=UsageKind.RUN, quantity=1),
    lambda s, db: agent.begin_step(
        s,
        db,
        uuid.uuid4(),
        tool_call_id="call",
        name="request_plan",
        arguments={},
    ),
]

MEMBER_BLOCKED_ADMIN = [
    lambda s, db: artifacts.set_visibility(s, db, uuid.uuid4(), "public"),
    lambda s, db: artifacts.soft_delete_artifact(s, db, uuid.uuid4()),
    lambda s, db: workspaces.add_member(s, db, user_id=uuid.uuid4(), role=Role.MEMBER),
    lambda s, db: audit.list_audit(s, db),
]


@pytest.mark.parametrize("call", VIEWER_BLOCKED_WRITES)
async def test_viewer_cannot_write(call, session):
    with pytest.raises(AuthzError):
        await call(make_scope(Role.VIEWER), session)
    assert session.statements == [] and session.added == []  # failed closed


@pytest.mark.parametrize("call", MEMBER_BLOCKED_ADMIN)
async def test_member_cannot_administer(call, session):
    with pytest.raises(AuthzError):
        await call(make_scope(Role.MEMBER), session)
    assert session.statements == [] and session.added == []


@pytest.mark.parametrize("role", [Role.OWNER, Role.ADMIN])
async def test_admin_roles_pass_gates(role, session):
    artifact = await artifacts.create_artifact(
        make_scope(role), session, slug="x", title="x", family="VQE", framework="qiskit"
    )
    assert artifact in session.added
