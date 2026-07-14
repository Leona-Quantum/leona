"""Live authz suite dataset (Phase 1 step 4; 05-security.md §1 AuthN/AuthZ).

Runs against DATABASE_URL (skipped when unset). CI points it at the PR's
throwaway Neon branch after migrate+seed; locally use a disposable branch too —
the session fixture COMMITS its two-workspace dataset.

Workspace A carries one user per role; workspace B is the victim: every entity
gets a row there, and the matrix proves scope-A access can never see it.
"""

import dataclasses
import os
import uuid

import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role, RunMode, UsageKind, VerificationMethod
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact
from majorana_api.repos import artifacts, audit, folders, runs, system, usage, workspaces

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ, reason="authz suite needs DATABASE_URL"
)

ALL_ROLES = (Role.OWNER, Role.ADMIN, Role.MEMBER, Role.VIEWER)


@dataclasses.dataclass
class WorkspaceData:
    workspace_id: uuid.UUID
    users: dict[Role, uuid.UUID]
    starter_artifact_id: uuid.UUID
    artifact_id: uuid.UUID
    version_id: uuid.UUID
    run_id: uuid.UUID
    folder_id: uuid.UUID
    usage_quantity: float


def scope_for(ws: WorkspaceData, role: Role) -> Scope:
    return Scope(user_id=ws.users[role], workspace_id=ws.workspace_id, role=role)


async def _build_workspace(session, tag: str) -> WorkspaceData:
    owner, ws = await system.get_or_provision_user(
        session, workos_user_id=f"authz-{tag}-owner-{uuid.uuid4()}", email=f"{tag}@authz.test"
    )
    users = {Role.OWNER: owner.id}
    owner_scope = Scope(user_id=owner.id, workspace_id=ws.id, role=Role.OWNER)
    for role in (Role.ADMIN, Role.MEMBER, Role.VIEWER):
        member, _ = await system.get_or_provision_user(
            session,
            workos_user_id=f"authz-{tag}-{role}-{uuid.uuid4()}",
            email=f"{tag}-{role}@authz.test",
        )
        await workspaces.add_member(owner_scope, session, user_id=member.id, role=role)
        users[role] = member.id

    starter_artifact_id = (
        await session.execute(
            select(Artifact.id).where(
                Artifact.workspace_id == ws.id,
                Artifact.slug == system.starter_bell_slug(ws.id),
            )
        )
    ).scalar_one()
    artifact = await artifacts.create_artifact(
        owner_scope,
        session,
        slug=f"authz-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"authz probe {tag}",
        family="Bell",
        framework="qiskit",
    )
    version = await artifacts.create_version(
        owner_scope,
        session,
        artifact.id,
        ir_version="1",
        ir={"tag": tag},
        code="pass",
        code_lang="python",
        fingerprint=f"fp-{tag}-{uuid.uuid4().hex[:8]}",
        export_status="lossless",
    )
    run = await runs.create_run(
        owner_scope, session, task_prompt=f"authz {tag}", mode=RunMode.EXECUTE, framework="qiskit"
    )
    folder = await folders.create_folder(owner_scope, session, name=f"{tag} folder")
    await folders.set_run_folder(owner_scope, session, run.id, folder.id)
    await runs.append_run_event(owner_scope, session, run.id, type="run.queued", payload={})
    await runs.append_run_event(owner_scope, session, run.id, type="run.started", payload={})
    await runs.add_verification_record(
        owner_scope, session, run.id, method=VerificationMethod.EXACT, result="pass"
    )
    await usage.record_usage(owner_scope, session, kind=UsageKind.RUN, quantity=7)
    await audit.record_audit(owner_scope, session, action=f"authz.fixture.{tag}")
    return WorkspaceData(
        workspace_id=ws.id,
        users=users,
        starter_artifact_id=starter_artifact_id,
        artifact_id=artifact.id,
        version_id=version.id,
        run_id=run.id,
        folder_id=folder.id,
        usage_quantity=7.0,
    )


async def provision() -> tuple[WorkspaceData, WorkspaceData]:
    engine = engine_from_env()
    try:
        async with session_factory(engine)() as session:
            a = await _build_workspace(session, "a")
            b = await _build_workspace(session, "b")
            await session.commit()
    finally:
        await engine.dispose()
    return a, b
