"""System repository — the ONLY unscoped surface, by design.

Two callers, both pre-/extra-tenant:
1. Identity bootstrap: WorkOS first-login provisioning runs before any Scope
   exists (it *creates* the personal workspace a Scope would point at).
2. Worker job loop: jobs are control-plane internal rows with no workspace_id.

Nothing else may import this module from request-handling code. Tenant data
stays behind the scoped repositories.
"""

import datetime as dt
from typing import Any

from majorana_contracts.enums import Role
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion, Job, Membership, User, Workspace

STARTER_BELL_SLUG_PREFIX = "starter-bell-state"
STARTER_BELL_CODE = """from qiskit import QuantumCircuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()
"""
STARTER_BELL_QASM = """OPENQASM 3.0;
include \"stdgates.inc\";
bit[2] c;
qubit[2] q;
h q[0];
cx q[0], q[1];
c[0] = measure q[0];
c[1] = measure q[1];
"""


def starter_bell_slug(workspace_id) -> str:
    return f"{STARTER_BELL_SLUG_PREFIX}-{workspace_id.hex}"


def starter_bell_ir() -> dict[str, Any]:
    return {
        "ir_version": 3,
        "qubits": 2,
        "classical_bits": 2,
        "operations": [
            {"gate": "h", "qubits": [0]},
            {"gate": "cx", "qubits": [0, 1]},
            {
                "gate": "measure",
                "qubits": [0],
                "clbits": [0],
                "measurement": {"basis": "Z", "register_name": "c"},
            },
            {
                "gate": "measure",
                "qubits": [1],
                "clbits": [1],
                "measurement": {"basis": "Z", "register_name": "c"},
            },
        ],
        "quantum_registers": [{"name": "q", "size": 2, "offset": 0}],
        "classical_registers": [{"name": "c", "size": 2, "offset": 0}],
        "gate_definitions": [],
        "decomposition_applied": None,
        "objective_functions": [],
        "noise_model_annotations": {},
        "annotations": {"starter": True},
        "metadata": {"description": "Two-qubit Bell state preparation."},
    }


async def ensure_starter_bell_artifact(session: AsyncSession, workspace_id) -> None:
    """Provision one durable Bell example for a workspace.

    Existing workspaces take a read-only fast path. The workspace row lock and
    second existence check make first-login creation idempotent when two browser
    tabs cross the auth boundary at the same time.
    """
    slug = starter_bell_slug(workspace_id)
    existing = (
        (
            await session.execute(
                select(Artifact).where(
                    Artifact.workspace_id == workspace_id,
                    Artifact.slug == slug,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return

    workspace = (
        (
            await session.execute(
                select(Workspace).where(Workspace.id == workspace_id).with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if workspace is None:
        raise RuntimeError(f"workspace {workspace_id} disappeared during provisioning")

    existing = (
        (
            await session.execute(
                select(Artifact).where(
                    Artifact.workspace_id == workspace_id,
                    Artifact.slug == slug,
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return

    artifact = Artifact(
        id=uuid7(),
        workspace_id=workspace_id,
        slug=slug,
        title="Bell state measurement",
        family="Bell",
        framework="qiskit",
        visibility="private",
    )
    session.add(artifact)
    await session.flush()
    version = ArtifactVersion(
        id=uuid7(),
        artifact_id=artifact.id,
        seq=1,
        ir_version="ir-v1",
        ir=starter_bell_ir(),
        code=STARTER_BELL_CODE,
        code_lang="python",
        fingerprint="starter-bell-state-v1",
        export_status="lossless",
        qasm=STARTER_BELL_QASM,
        resource_estimates={
            "qubits": 2,
            "depth": 2,
            "gate_count": 2,
            "two_qubit_gate_count": 1,
            "measurement_count": 2,
        },
        limitations="Simulator reference artifact; rerun it to produce fresh evidence.",
    )
    session.add(version)
    await session.flush()
    artifact.current_version_id = version.id
    await session.flush()


async def _existing_user(
    session: AsyncSession, workos_user_id: str
) -> tuple[User, Workspace] | None:
    user = (
        (await session.execute(select(User).where(User.workos_user_id == workos_user_id)))
        .scalars()
        .first()
    )
    if user is None:
        return None
    ws = (
        (
            await session.execute(
                select(Workspace)
                .join(Membership, Membership.workspace_id == Workspace.id)
                .where(
                    Membership.user_id == user.id,
                    Workspace.kind == "personal",
                    Workspace.deleted_at.is_(None),
                )
            )
        )
        .scalars()
        .first()
    )
    if ws is None:
        raise RuntimeError(f"user {user.id} has no personal workspace")
    return user, ws


async def find_membership(
    session: AsyncSession, *, workspace_id: Any, user_id: Any
) -> Membership | None:
    """Scope derivation (auth layer): the membership row, if any. Pre-Scope by
    necessity — this lookup is what a Scope is built FROM."""
    return (
        (
            await session.execute(
                select(Membership).where(
                    Membership.workspace_id == workspace_id, Membership.user_id == user_id
                )
            )
        )
        .scalars()
        .first()
    )


async def default_workspace_id(
    session: AsyncSession,
    *,
    user_id: Any,
    personal_workspace_id: Any,
) -> Any:
    """Prefer a workspace where the user was added as a collaborator.

    Owners keep their personal workspace by default. A member or viewer who
    has been attached to another workspace should see that shared workspace
    without needing to copy an internal workspace header into the browser.
    """
    shared = (
        (
            await session.execute(
                select(Membership.workspace_id)
                .join(Workspace, Workspace.id == Membership.workspace_id)
                .where(
                    Membership.user_id == user_id,
                    Membership.role != Role.OWNER,
                    Workspace.deleted_at.is_(None),
                )
                .order_by(Membership.created_at.desc(), Membership.workspace_id)
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    return shared or personal_workspace_id


async def get_or_provision_user(
    session: AsyncSession,
    *,
    workos_user_id: str,
    email: str,
    display_name: str | None = None,
) -> tuple[User, Workspace]:
    """First login: create user + personal workspace + owner membership (04 §1)."""
    found = await _existing_user(session, workos_user_id)
    if found is not None:
        await ensure_starter_bell_artifact(session, found[1].id)
        return found

    user = User(id=uuid7(), workos_user_id=workos_user_id, email=email, display_name=display_name)
    session.add(user)
    try:
        await session.flush()
    except IntegrityError as exc:
        await session.rollback()
        # Exactly one retry, and only for losing the workos_user_id unique race
        # (23505): the winner's row must exist now. Anything else re-raises.
        if getattr(exc.orig, "sqlstate", None) != "23505":
            raise
        found = await _existing_user(session, workos_user_id)
        if found is None:
            raise
        await ensure_starter_bell_artifact(session, found[1].id)
        return found
    ws = Workspace(id=uuid7(), kind="personal", name=email, owner_user_id=user.id)
    session.add(ws)
    await session.flush()
    session.add(Membership(workspace_id=ws.id, user_id=user.id, role=Role.OWNER))
    await session.flush()
    await ensure_starter_bell_artifact(session, ws.id)
    return user, ws


async def enqueue_job(
    session: AsyncSession,
    *,
    kind: str,
    payload: dict[str, Any],
    run_id: Any | None = None,
    run_after: dt.datetime | None = None,
) -> Job:
    job = Job(id=uuid7(), kind=kind, payload=payload, run_id=run_id)
    if run_after is not None:
        job.run_after = run_after
    session.add(job)
    await session.flush()
    return job


async def claim_job(session: AsyncSession, *, worker_id: str) -> Job | None:
    """FOR UPDATE SKIP LOCKED claim (AD-7); polls run_after — no LISTEN/NOTIFY."""
    stmt = (
        select(Job)
        .where(Job.status == "queued", Job.run_after <= func.now())
        .order_by(Job.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = (await session.execute(stmt)).scalars().first()
    if job is None:
        return None
    await session.execute(
        update(Job)
        .where(Job.id == job.id)
        .values(
            status="running",
            locked_by=worker_id,
            locked_at=func.now(),
            attempts=Job.attempts + 1,
            updated_at=func.now(),
        )
    )
    return job


async def finish_job(
    session: AsyncSession, *, job_id: Any, status: str, last_error: str | None = None
) -> None:
    if status not in ("done", "failed", "dead"):
        raise ValueError(f"not a terminal job status: {status}")
    result = await session.execute(
        update(Job)
        .where(Job.id == job_id)
        .values(
            status=status,
            last_error=last_error,
            locked_by=None,
            locked_at=None,
            updated_at=func.now(),
        )
    )
    if result.rowcount == 0:
        raise ValueError(f"no such job: {job_id}")
