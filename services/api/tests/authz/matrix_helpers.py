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
from majorana_contracts import CommentTargetType, Scope
from majorana_contracts.enums import QpuRunStatus, Role, RunMode, UsageKind, VerificationMethod
from sqlalchemy import select

from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import Artifact
from majorana_api.repos import (
    artifacts,
    audit,
    comments,
    folders,
    projects,
    qpu_runs,
    runs,
    system,
    usage,
    workspaces,
)
from majorana_api.repos.shares import ShareAllowance
from majorana_api.tiers import limits_for

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
    project_id: uuid.UUID
    usage_quantity: float
    qpu_run_id: uuid.UUID
    qpu_fingerprint: str
    comment_id: uuid.UUID


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
        kept=True,
    )
    version = await artifacts.create_version(
        owner_scope,
        session,
        artifact.id,
        qasm_version="3.0",
        qasm="OPENQASM 3.0;",
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
    # The artifact is FILED under the project, not merely adjacent to it: a
    # cross-workspace probe against an empty project proves only that the
    # container is hidden, and the container is not the thing worth stealing.
    project = await projects.create_project(owner_scope, session, name=f"{tag} project")
    await projects.set_artifact_project(
        owner_scope, session, artifact.id, project.id, workspace_artifact_limit=None
    )
    await runs.append_run_event(owner_scope, session, run.id, type="run.queued", payload={})
    await runs.append_run_event(owner_scope, session, run.id, type="run.started", payload={})
    await runs.add_verification_record(
        owner_scope, session, run.id, method=VerificationMethod.EXACT, result="pass"
    )
    await usage.record_usage(owner_scope, session, kind=UsageKind.RUN, quantity=7)
    await audit.record_audit(owner_scope, session, action=f"authz.fixture.{tag}")
    # A hardware run with a machine recorded, so the probes below have a
    # provider-attested row, counts and a backend name to fail to see. The
    # fingerprint is unique per build: `list_records(source_fingerprint=...)` is
    # probed with the OTHER workspace's value, and a shared one would make that
    # probe unable to tell a leak from a coincidence.
    qpu_fingerprint = f"fnv1a-authz-{tag}-{uuid.uuid4().hex[:8]}"
    qpu_run = await qpu_runs.create_record(
        owner_scope,
        session,
        device_id="ibm.open_plan",
        provider="ibm",
        shots=128,
        qasm="OPENQASM 3.0;",
        source_fingerprint=qpu_fingerprint,
        estimate_basis="free_tier_allowance",
        estimated_total_usd=None,
        rate_source="https://example.invalid/rates",
        rate_confirmed_on="2026-09-22",
    )
    await qpu_runs.transition(
        owner_scope,
        session,
        qpu_run.id,
        QpuRunStatus.RUNNING,
        provider_job_id=f"job-{tag}",
        backend_name=f"ibm_authz_{tag}",
    )
    await qpu_runs.transition(
        owner_scope, session, qpu_run.id, QpuRunStatus.DONE, raw_counts={"0": 64, "1": 64}
    )
    # A comment on the run that mentions the workspace's own member, so the
    # probes have a thread, a body and an inbox row to fail to see (migration
    # 0068). The handle is the member's address before the `@`.
    comment = await comments.create_comment(
        owner_scope,
        session,
        target_type=CommentTargetType.RUN,
        target_id=run.id,
        body=f"authz probe for @{tag}-{Role.MEMBER}",
    )
    return WorkspaceData(
        workspace_id=ws.id,
        users=users,
        starter_artifact_id=starter_artifact_id,
        artifact_id=artifact.id,
        version_id=version.id,
        run_id=run.id,
        folder_id=folder.id,
        project_id=project.id,
        usage_quantity=7.0,
        qpu_run_id=qpu_run.id,
        qpu_fingerprint=qpu_fingerprint,
        comment_id=comment.comments[0].id,
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


def any_team_grantee(_grantee: object) -> ShareAllowance:
    """The permissive grantee allowance, DERIVED from the real team tier.

    Written out as `ShareAllowance(may_receive=True, max_shared_projects=None)`
    it would be a double thinner than the thing it stands in for: `None` is
    "unlimited", which is the developer tier's number, so every share test in
    this suite would have been silently exempt from the membership cap and the
    cap's own tests would have been the only ones that ever saw it.

    Taking the real `team` row instead means these tests grant under the same
    allowance a paying account has, and a change to that number reaches them.

    Lived in three files as `lambda _grantee: True` before the allowance grew a
    second field. One copy is one place to be wrong.
    """
    limits = limits_for("team")
    return ShareAllowance(
        may_receive=limits.project_sharing,
        max_shared_projects=limits.shared_projects,
    )
