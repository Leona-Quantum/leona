"""System repository — the ONLY unscoped surface, by design.

Two callers, both pre-/extra-tenant:
1. Identity bootstrap: WorkOS first-login provisioning runs before any Scope
   exists (it *creates* the personal workspace a Scope would point at).
2. Worker job loop: jobs are control-plane internal rows with no workspace_id.

Nothing else may import this module from request-handling code. Tenant data
stays behind the scoped repositories.
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from majorana_contracts.enums import Role
from majorana_openqasm import fingerprint as qasm_fingerprint
from majorana_openqasm import normalize
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
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

DEFAULT_JOB_MAX_ATTEMPTS = 3
MAX_JOB_MAX_ATTEMPTS = 20
DEFAULT_DEAD_LETTER_MAX_ATTEMPTS = 5


class JobLeaseLostError(RuntimeError):
    """The worker no longer owns the fenced lease for a job."""


@dataclass(frozen=True)
class StaleJobRecovery:
    requeued: int
    dead_jobs: tuple[Job, ...]


@dataclass(frozen=True)
class SystemCatalogAuthority:
    workspace: Workspace
    importer: User
    public_reader: User


SYSTEM_CATALOG_IMPORTER_SUB = "system:catalog-importer"
SYSTEM_CATALOG_READER_SUB = "system:catalog-public-reader"
SYSTEM_CATALOG_IMPORTER_EMAIL = "catalog-importer@system.invalid"
SYSTEM_CATALOG_READER_EMAIL = "catalog-public-reader@system.invalid"


async def ensure_system_catalog_authority(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    importer_user_id: uuid.UUID,
    public_reader_user_id: uuid.UUID,
) -> SystemCatalogAuthority:
    """Idempotently provision identities and one empty system workspace.

    This is an explicit operator action. It deliberately creates no catalog
    artifacts and never runs from API startup or an Alembic migration.
    """
    if len({workspace_id, importer_user_id, public_reader_user_id}) != 3:
        raise ValueError("catalog authority IDs must be distinct")

    for user_id, workos_sub, email, display_name in (
        (
            importer_user_id,
            SYSTEM_CATALOG_IMPORTER_SUB,
            SYSTEM_CATALOG_IMPORTER_EMAIL,
            "System catalog importer",
        ),
        (
            public_reader_user_id,
            SYSTEM_CATALOG_READER_SUB,
            SYSTEM_CATALOG_READER_EMAIL,
            "System catalog public reader",
        ),
    ):
        await session.execute(
            pg_insert(User)
            .values(
                id=user_id,
                workos_user_id=workos_sub,
                email=email,
                display_name=display_name,
            )
            .on_conflict_do_nothing(index_elements=[User.id])
        )

    await session.execute(
        pg_insert(Workspace)
        .values(
            id=workspace_id,
            kind="system",
            name="Majorana public quantum catalog",
            owner_user_id=importer_user_id,
        )
        .on_conflict_do_nothing(index_elements=[Workspace.id])
    )
    for user_id, role in (
        (importer_user_id, Role.OWNER),
        (public_reader_user_id, Role.VIEWER),
    ):
        await session.execute(
            pg_insert(Membership)
            .values(workspace_id=workspace_id, user_id=user_id, role=role)
            .on_conflict_do_nothing(index_elements=[Membership.workspace_id, Membership.user_id])
        )
    await session.flush()

    importer = await session.get(User, importer_user_id)
    public_reader = await session.get(User, public_reader_user_id)
    workspace = await session.get(Workspace, workspace_id)
    importer_membership = await session.get(Membership, (workspace_id, importer_user_id))
    reader_membership = await session.get(Membership, (workspace_id, public_reader_user_id))
    if (
        importer is None
        or public_reader is None
        or workspace is None
        or importer.workos_user_id != SYSTEM_CATALOG_IMPORTER_SUB
        or public_reader.workos_user_id != SYSTEM_CATALOG_READER_SUB
        or workspace.kind != "system"
        or workspace.owner_user_id != importer_user_id
        or importer_membership is None
        or importer_membership.role != Role.OWNER
        or reader_membership is None
        or reader_membership.role != Role.VIEWER
    ):
        raise RuntimeError("catalog authority exists but does not match the configured identity")
    return SystemCatalogAuthority(
        workspace=workspace,
        importer=importer,
        public_reader=public_reader,
    )


async def count_workspace_artifacts(session: AsyncSession, *, workspace_id: uuid.UUID) -> int:
    """Operator-only safety check used before catalog data exists."""
    return int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(Artifact.workspace_id == workspace_id)
            )
        ).scalar_one()
    )


def _bounded_error(value: str) -> str:
    return value[:2000]


def _lease_delta(lease_seconds: float) -> dt.timedelta:
    if not 0 < lease_seconds <= 3600:
        raise ValueError("lease_seconds must be in (0, 3600]")
    return dt.timedelta(seconds=lease_seconds)


def starter_bell_slug(workspace_id) -> str:
    """Return the workspace-unique slug for the starter artifact."""
    return f"{STARTER_BELL_SLUG_PREFIX}-{workspace_id.hex}"


def insert_seed_artifact_version(
    cursor: Any,
    *,
    version_id: Any,
    artifact_id: Any,
    seq: int,
    qasm: str | None,
    code: str,
    code_lang: str,
    fallback_fingerprint: str,
    export_status: str,
    resource_estimates: str,
    created_at: dt.datetime,
) -> None:
    """Persist a seed version through the repository-owned QASM boundary."""
    canonical_qasm = normalize(qasm) if qasm is not None else None
    cursor.execute(
        "insert into artifact_versions (id, artifact_id, seq, qasm_version, code,"
        " code_lang, fingerprint, export_status, qasm, resource_estimates, created_at)"
        " values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (
            version_id,
            artifact_id,
            seq,
            "3.0" if canonical_qasm is not None else None,
            code,
            code_lang,
            qasm_fingerprint(canonical_qasm)
            if canonical_qasm is not None
            else fallback_fingerprint,
            export_status,
            canonical_qasm,
            resource_estimates,
            created_at,
        ),
    )


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
    canonical_qasm = normalize(STARTER_BELL_QASM)
    version = ArtifactVersion(
        id=uuid7(),
        artifact_id=artifact.id,
        seq=1,
        qasm_version="3.0",
        qasm=canonical_qasm,
        artifact_metadata={"description": "Two-qubit Bell state preparation.", "starter": True},
        code=STARTER_BELL_CODE,
        code_lang="python",
        fingerprint=qasm_fingerprint(canonical_qasm),
        export_status="lossless",
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
    """Return the personal workspace until collaboration is productized."""
    return personal_workspace_id


async def get_or_provision_user(
    session: AsyncSession,
    *,
    workos_user_id: str,
    email: str,
    display_name: str | None = None,
) -> tuple[User, Workspace]:
    """First login: create user + personal workspace + owner membership (04 §1)."""
    normalized_email = email.strip().lower()
    found = await _existing_user(session, workos_user_id)
    if found is not None:
        user, workspace = found
        changed = False
        if user.email != normalized_email:
            user.email = normalized_email
            changed = True
        if display_name is not None:
            normalized_name = " ".join(display_name.strip().split())
            if normalized_name and user.display_name != normalized_name:
                user.display_name = normalized_name
                changed = True
        if changed:
            await session.flush()
        await ensure_starter_bell_artifact(session, workspace.id)
        return user, workspace

    normalized_name = " ".join(display_name.strip().split()) if display_name else None
    user = User(
        id=uuid7(),
        workos_user_id=workos_user_id,
        email=normalized_email,
        display_name=normalized_name or None,
    )
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
        existing_user, workspace = found
        if display_name:
            existing_user.display_name = normalized_name or existing_user.display_name
        if existing_user.email != normalized_email:
            existing_user.email = normalized_email
        await session.flush()
        await ensure_starter_bell_artifact(session, workspace.id)
        return existing_user, workspace
    ws = Workspace(id=uuid7(), kind="personal", name=normalized_email, owner_user_id=user.id)
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
    max_attempts: int = DEFAULT_JOB_MAX_ATTEMPTS,
) -> Job:
    if not 1 <= max_attempts <= MAX_JOB_MAX_ATTEMPTS:
        raise ValueError(f"max_attempts must be in [1, {MAX_JOB_MAX_ATTEMPTS}]")
    job = Job(
        id=uuid7(),
        kind=kind,
        payload=payload,
        run_id=run_id,
        max_attempts=max_attempts,
    )
    if run_after is not None:
        job.run_after = run_after
    session.add(job)
    await session.flush()
    return job


async def recover_stale_jobs(session: AsyncSession) -> StaleJobRecovery:
    """Requeue expired leases or dead-letter rows that exhausted attempts.

    The predicates are repeated on both updates, so concurrent workers can run
    recovery safely: once one update changes a row, the other workers no longer
    match it.
    """
    stale = (
        Job.status == "running",
        or_(Job.lease_expires_at.is_(None), Job.lease_expires_at <= func.now()),
    )
    dead_result = await session.execute(
        update(Job)
        .where(*stale, Job.attempts >= Job.max_attempts)
        .values(
            status="dead",
            last_error="worker lease expired after maximum attempts",
            last_error_kind="lease_expired",
            locked_by=None,
            locked_at=None,
            lease_token=None,
            lease_expires_at=None,
            last_heartbeat_at=None,
            updated_at=func.now(),
        )
        .returning(Job)
    )
    dead_jobs = tuple(dead_result.scalars().all())
    requeue_result = await session.execute(
        update(Job)
        .where(*stale, Job.attempts < Job.max_attempts)
        .values(
            status="queued",
            run_after=func.now(),
            last_error="worker lease expired; job requeued",
            last_error_kind="lease_expired",
            locked_by=None,
            locked_at=None,
            lease_token=None,
            lease_expires_at=None,
            last_heartbeat_at=None,
            updated_at=func.now(),
        )
    )
    return StaleJobRecovery(requeued=requeue_result.rowcount, dead_jobs=dead_jobs)


async def claim_job(
    session: AsyncSession, *, worker_id: str, lease_seconds: float = 120.0
) -> Job | None:
    """FOR UPDATE SKIP LOCKED claim (AD-7); polls run_after — no LISTEN/NOTIFY."""
    lease_delta = _lease_delta(lease_seconds)
    stmt = (
        select(Job)
        .where(
            Job.status == "queued",
            Job.run_after <= func.now(),
            Job.attempts < Job.max_attempts,
        )
        .order_by(Job.run_after)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = (await session.execute(stmt)).scalars().first()
    if job is None:
        return None
    lease_token = uuid.uuid4()
    next_attempt = int(job.attempts or 0) + 1
    await session.execute(
        update(Job)
        .where(Job.id == job.id, Job.status == "queued")
        .values(
            status="running",
            locked_by=worker_id,
            locked_at=func.now(),
            lease_token=lease_token,
            lease_expires_at=func.now() + lease_delta,
            last_heartbeat_at=func.now(),
            attempts=next_attempt,
            updated_at=func.now(),
        )
    )
    job.status = "running"
    job.locked_by = worker_id
    job.lease_token = lease_token
    job.attempts = next_attempt
    return job


async def heartbeat_job(
    session: AsyncSession,
    *,
    job_id: Any,
    lease_token: uuid.UUID,
    lease_seconds: float = 120.0,
) -> bool:
    """Extend an unexpired lease only when the caller still owns its token."""
    lease_delta = _lease_delta(lease_seconds)
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == "running",
            Job.lease_token == lease_token,
            Job.lease_expires_at > func.now(),
        )
        .values(
            lease_expires_at=func.now() + lease_delta,
            last_heartbeat_at=func.now(),
            updated_at=func.now(),
        )
    )
    return result.rowcount == 1


async def finish_job(
    session: AsyncSession,
    *,
    job_id: Any,
    lease_token: uuid.UUID,
    status: str,
    last_error: str | None = None,
    last_error_kind: str | None = None,
) -> None:
    if status not in ("done", "failed", "dead"):
        raise ValueError(f"not a terminal job status: {status}")
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == "running",
            Job.lease_token == lease_token,
            Job.lease_expires_at > func.now(),
        )
        .values(
            status=status,
            last_error=_bounded_error(last_error) if last_error is not None else None,
            last_error_kind=last_error_kind,
            locked_by=None,
            locked_at=None,
            lease_token=None,
            lease_expires_at=None,
            last_heartbeat_at=None,
            updated_at=func.now(),
        )
    )
    if result.rowcount == 0:
        raise JobLeaseLostError(f"job lease lost before terminal update: {job_id}")


async def retry_job(
    session: AsyncSession,
    *,
    job_id: Any,
    lease_token: uuid.UUID,
    last_error: str,
    last_error_kind: str,
    base_delay_seconds: float = 5.0,
    max_delay_seconds: float = 300.0,
) -> tuple[str, float]:
    """Schedule a fenced bounded retry, or dead-letter an exhausted job."""
    if not 0 < base_delay_seconds <= max_delay_seconds <= 3600:
        raise ValueError("retry delays must satisfy 0 < base <= max <= 3600")
    job = (
        (
            await session.execute(
                select(Job)
                .where(
                    Job.id == job_id,
                    Job.status == "running",
                    Job.lease_token == lease_token,
                    Job.lease_expires_at > func.now(),
                )
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if job is None:
        raise JobLeaseLostError(f"job lease lost before retry update: {job_id}")

    attempts = int(job.attempts or 0)
    max_attempts = int(job.max_attempts or DEFAULT_JOB_MAX_ATTEMPTS)
    terminal = attempts >= max_attempts
    delay_seconds = (
        0.0
        if terminal
        else min(base_delay_seconds * (2 ** max(attempts - 1, 0)), max_delay_seconds)
    )
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status == "running",
            Job.lease_token == lease_token,
            Job.lease_expires_at > func.now(),
        )
        .values(
            status="dead" if terminal else "queued",
            run_after=func.now() + dt.timedelta(seconds=delay_seconds),
            last_error=_bounded_error(last_error),
            last_error_kind=last_error_kind,
            locked_by=None,
            locked_at=None,
            lease_token=None,
            lease_expires_at=None,
            last_heartbeat_at=None,
            updated_at=func.now(),
        )
    )
    if result.rowcount != 1:
        raise JobLeaseLostError(f"job lease expired before retry update: {job_id}")
    return ("dead" if terminal else "queued", delay_seconds)


async def claim_pending_dead_letter(
    session: AsyncSession,
    *,
    worker_id: str,
    lease_seconds: float = 45.0,
) -> Job | None:
    """Atomically reserve one terminal callback with a fenced expiring token.

    The row lock is held only until the caller commits the reservation. Callback
    I/O happens afterward, so another Worker skips this row rather than waiting.
    If the Worker crashes, the expiry predicate makes the row reclaimable.
    """
    lease_delta = _lease_delta(lease_seconds)
    if not worker_id.strip():
        raise ValueError("worker_id must not be empty")
    stmt = (
        select(Job)
        .where(
            Job.status.in_(("failed", "dead")),
            Job.dead_lettered_at.is_(None),
            Job.run_after <= func.now(),
            or_(
                Job.dead_letter_lease_token.is_(None),
                Job.dead_letter_lease_expires_at <= func.now(),
            ),
        )
        .order_by(Job.updated_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = (await session.execute(stmt)).scalars().first()
    if job is None:
        return None
    delivery_token = uuid.uuid4()
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job.id,
            Job.status.in_(("failed", "dead")),
            Job.dead_lettered_at.is_(None),
        )
        .values(
            dead_letter_locked_by=worker_id,
            dead_letter_lease_token=delivery_token,
            dead_letter_lease_expires_at=func.now() + lease_delta,
            updated_at=func.now(),
        )
    )
    if result.rowcount != 1:
        raise JobLeaseLostError(f"dead-letter reservation lost before commit: {job.id}")
    job.dead_letter_locked_by = worker_id
    job.dead_letter_lease_token = delivery_token
    return job


async def mark_job_dead_lettered(
    session: AsyncSession,
    *,
    job_id: Any,
    delivery_token: uuid.UUID,
    error: str | None = None,
    retry_delay_seconds: float = 30.0,
    max_delivery_attempts: int = DEFAULT_DEAD_LETTER_MAX_ATTEMPTS,
) -> bool:
    """Persist delivery success or stop retrying after a bounded error budget.

    An exhausted callback keeps its final error and receives dead_lettered_at,
    distinguishing "delivery abandoned" (error is not null) from successful
    delivery while ensuring the poller cannot retry forever.
    """
    if not 0 < retry_delay_seconds <= 3600:
        raise ValueError("dead-letter retry delay must be in (0, 3600]")
    if not 1 <= max_delivery_attempts <= 20:
        raise ValueError("max_delivery_attempts must be in [1, 20]")
    attempts_after_update = Job.dead_letter_attempts + 1
    values: dict[str, Any] = {
        "dead_letter_error": _bounded_error(error) if error is not None else None,
        "dead_letter_attempts": attempts_after_update,
        "dead_letter_locked_by": None,
        "dead_letter_lease_token": None,
        "dead_letter_lease_expires_at": None,
        "updated_at": func.now(),
    }
    if error is None:
        values["dead_lettered_at"] = func.now()
    else:
        values["run_after"] = func.now() + dt.timedelta(seconds=retry_delay_seconds)
        values["dead_lettered_at"] = case(
            (attempts_after_update >= max_delivery_attempts, func.now()),
            else_=Job.dead_lettered_at,
        )
    result = await session.execute(
        update(Job)
        .where(
            Job.id == job_id,
            Job.status.in_(("failed", "dead")),
            Job.dead_lettered_at.is_(None),
            Job.dead_letter_lease_token == delivery_token,
            Job.dead_letter_lease_expires_at > func.now(),
        )
        .values(**values)
    )
    return result.rowcount == 1
