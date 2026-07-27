"""System repository — the ONLY unscoped surface, by design.

Three callers, all of them questions a Scope cannot answer:

1. Identity bootstrap: WorkOS first-login provisioning runs before any Scope
   exists (it *creates* the personal workspace a Scope would point at).
2. Worker job loop: jobs are control-plane internal rows with no workspace_id.
3. Questions a user asks ABOUT their tenants rather than inside one (0037/0038):
   which workspaces am I in, which one am I acting in, which was I added to and
   not told about, let me out of this one. A Scope names a single tenant and is
   derived from the pointer these functions read and write, so none of them can
   be expressed in terms of one — the switcher's whole job is to name a
   workspace the caller is not currently scoped into.

Category 3 is bounded by the predicate, not by convention: every query in it is
keyed on `Membership.user_id == <the caller>`, so it can only ever return
workspaces the caller holds a membership in. That is what keeps "may never
expose tenant data to request handlers" true — the rows these return are the
caller's own memberships, and their *contents* (runs, artifacts, versions) stay
behind the scoped repositories where a Scope gates every read.

Nothing else may import this module from request-handling code.
"""

import datetime as dt
import uuid
from dataclasses import dataclass
from typing import Any

from majorana_contracts.enums import Role, RunStatus, WorkspaceKind
from majorana_openqasm import fingerprint as qasm_fingerprint
from majorana_openqasm import normalize
from sqlalchemy import case, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion, Job, Membership, Run, User, Workspace

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
# Comfortably past the dead-letter retry budget (5 attempts ~30s apart) so the
# reaper only ever sees runs delivery has genuinely finished with.
ORPHANED_RUN_GRACE_S = 900.0


class JobLeaseLostError(RuntimeError):
    """The worker no longer owns the fenced lease for a job."""


@dataclass(frozen=True)
class StaleJobRecovery:
    requeued: int
    dead_jobs: tuple[Job, ...]


@dataclass(frozen=True)
class OrphanedRun:
    """An active run whose execution job is terminal and past dead-letter delivery."""

    run_id: uuid.UUID
    workspace_id: uuid.UUID
    user_id: uuid.UUID
    job_id: uuid.UUID
    delivery_error: str | None


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
            .values(
                workspace_id=workspace_id,
                user_id=user_id,
                role=role,
                # Nobody invited a system identity (0038). These two never sign
                # in, so no notice could reach them — but leaving the column NULL
                # would make "unacknowledged means somebody was invited" false in
                # the one place it is never read, which is exactly where a wrong
                # invariant survives.
                acknowledged_at=func.now(),
            )
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
        # This row is built directly rather than through create_artifact, so it
        # does not inherit that function's kept default. It must be kept: the
        # whole point of the starter example is that a brand-new Vault is not
        # empty, and an unkept one is invisible to the list (0036).
        kept_at=dt.datetime.now(dt.UTC),
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
    # Keyed on OWNERSHIP, not on membership.
    #
    # This used to join `memberships` and take the first personal workspace the
    # user belonged to. That was unambiguous only while nobody could be a member
    # of anyone else's workspace — and a personal workspace is exactly what an
    # invite attaches a collaborator to. Once that happens the old query matches
    # two rows with no ORDER BY, so a user's "personal workspace" could resolve
    # to someone else's tenant, on some requests and not others. Ownership is
    # single-valued: `get_or_provision_user` sets owner_user_id to the user it
    # just created the workspace for, and nothing reassigns it.
    ws = (
        (
            await session.execute(
                select(Workspace).where(
                    Workspace.owner_user_id == user.id,
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


@dataclass(frozen=True)
class ActiveWorkspace:
    """The tenant a request acts in, and the caller's role in it."""

    workspace_id: uuid.UUID
    role: str


async def resolve_active_workspace(
    session: AsyncSession,
    *,
    user: User,
    personal_workspace_id: Any,
) -> ActiveWorkspace | None:
    """Which workspace this request acts in (migration 0037).

    `users.active_workspace_id` is a *preference*. The grant is the membership
    row, and it is read here on every request, so revoking someone's access takes
    effect on their next request rather than on their next sign-in.

    A pointer that no longer resolves — access revoked, workspace soft-deleted —
    falls back to the personal workspace and is cleared, rather than refusing the
    request. Locking a user out of their own account because someone else removed
    them from a shared workspace would be a worse outcome than the one it
    prevents, and there is nothing to protect: the fallback is the tenant they
    own.

    Returns None only when the personal membership itself is missing, which is a
    broken account rather than an authorization decision; the caller turns that
    into a 404.
    """
    target_id = user.active_workspace_id
    if target_id is not None and target_id != personal_workspace_id:
        membership = await find_membership(session, workspace_id=target_id, user_id=user.id)
        if membership is not None:
            live = (
                await session.execute(
                    select(Workspace.id).where(
                        Workspace.id == target_id, Workspace.deleted_at.is_(None)
                    )
                )
            ).scalar_one_or_none()
            if live is not None:
                return ActiveWorkspace(workspace_id=target_id, role=membership.role)
        # Stale pointer. Clear it so the next request costs one lookup, not three.
        user.active_workspace_id = None
        await session.flush()

    personal = await find_membership(session, workspace_id=personal_workspace_id, user_id=user.id)
    if personal is None:
        return None
    return ActiveWorkspace(workspace_id=personal_workspace_id, role=personal.role)


async def list_user_workspaces(
    session: AsyncSession, *, user_id: Any
) -> list[tuple[Workspace, Membership]]:
    """Every live workspace the user is a member of, personal first then by name.

    Pre-Scope like the rest of this module: a workspace switcher has to be able
    to name a tenant the caller is not currently scoped into.
    """
    stmt = (
        select(Workspace, Membership)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user_id, Workspace.deleted_at.is_(None))
        # Personal first, then by name. The first term is the same predicate the
        # `is_personal` flag is computed from, and it has to be BOTH halves: an
        # "owned first" key looks identical until the user owns a team workspace
        # too, and then it sorts their own workspace under whatever they happened
        # to name the other one. Found by reading the list on a running server,
        # where a workspace called "Ion trap group" pushed the personal one
        # second on the alphabet.
        .order_by(
            case(
                (
                    (Workspace.kind == "personal") & (Workspace.owner_user_id == user_id),
                    0,
                ),
                else_=1,
            ),
            Workspace.name,
            Workspace.id,
        )
    )
    return list((await session.execute(stmt)).all())


async def set_active_workspace(
    session: AsyncSession, *, user: User, workspace_id: uuid.UUID
) -> tuple[Workspace, Membership] | None:
    """Point the user at a workspace they belong to. None if they do not.

    Membership is checked here as well as in `resolve_active_workspace` — this
    one gives the caller an honest 404 instead of a switch that appears to work
    and silently keeps them where they were.
    """
    membership = await find_membership(session, workspace_id=workspace_id, user_id=user.id)
    if membership is None:
        return None
    workspace = (
        await session.execute(
            select(Workspace).where(Workspace.id == workspace_id, Workspace.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if workspace is None:
        return None
    user.active_workspace_id = workspace_id
    # Entering a workspace is knowing about it. Acknowledging here rather than
    # leaving it to the client is what stops the notice following someone around
    # inside the very workspace it is announcing — the Settings switcher can
    # move them too, and it has never called an acknowledge route.
    await _stamp_acknowledged(session, workspace_id=workspace_id, user_id=user.id)
    await session.flush()
    return workspace, membership


async def list_unacknowledged_memberships(
    session: AsyncSession, *, user_id: Any
) -> list[tuple[Workspace, Membership, User | None]]:
    """Workspaces this user was added to and has not been told about (0038).

    Pre-Scope for the same reason as the switcher: the whole point is to name a
    tenant the caller has never been scoped into. Read on every authenticated
    page load and empty almost every time, which is what
    `ix_memberships_unacknowledged` is for.

    The inviter is an OUTER join. A membership whose inviter has since been
    deleted still has to be announced — losing the author is not a reason to
    leave someone permanently unaware of a workspace they are in.
    """
    inviter = aliased(User)
    stmt = (
        select(Workspace, Membership, inviter)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .outerjoin(inviter, inviter.id == Membership.invited_by_user_id)
        .where(
            Membership.user_id == user_id,
            Membership.acknowledged_at.is_(None),
            Workspace.deleted_at.is_(None),
        )
        .order_by(Membership.created_at, Workspace.id)
    )
    return [tuple(row) for row in (await session.execute(stmt)).all()]  # type: ignore[misc]


async def _stamp_acknowledged(session: AsyncSession, *, workspace_id: Any, user_id: Any) -> None:
    """Record that this person has been told. First write wins.

    Conditional in the DATABASE rather than in Python. Two tabs answering the
    same notice — or one opening the workspace while the other dismisses it —
    both read `acknowledged_at IS NULL` before either writes, so a Python-side
    guard lets both through and the stored moment becomes whichever transaction
    committed *last*. Postgres re-evaluates this WHERE clause after taking the
    row lock, so the second UPDATE matches nothing.

    `func.now()` for the neighbouring reason: the database's clock rather than
    one of however many API instances'.

    Nothing reads the value today beyond NULL/NOT NULL, which is exactly why it
    is worth pinning now — the day something does, the defect is a wrong date in
    a record nobody thought was approximate.
    """
    await session.execute(
        update(Membership)
        .where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == user_id,
            Membership.acknowledged_at.is_(None),
        )
        .values(acknowledged_at=func.now())
        .execution_options(synchronize_session="fetch")
    )


async def acknowledge_membership(
    session: AsyncSession, *, user: User, workspace_id: uuid.UUID
) -> bool:
    """Mark an invitation as seen without acting on it. False if not a member.

    The membership is looked up first so a workspace the caller does not belong
    to is an honest 404, rather than an UPDATE that matches nothing and reports
    success.
    """
    membership = await find_membership(session, workspace_id=workspace_id, user_id=user.id)
    if membership is None:
        return False
    await _stamp_acknowledged(session, workspace_id=workspace_id, user_id=user.id)
    await session.flush()
    return True


class CannotLeaveOwnedWorkspace(Exception):
    """The caller owns this workspace, so leaving it would orphan it."""


async def leave_workspace(session: AsyncSession, *, user: User, workspace_id: uuid.UUID) -> bool:
    """Give up your own access to a workspace. False if you were not in it.

    The counterpart to `remove_member`, and NOT the same operation: that one is
    admin-only and refuses to touch the caller's own row, so before this there
    was no way out of a workspace somebody put you in except to ask them to
    remove you. A notice that can only be dismissed is not a choice.

    The owner is refused. Their leaving would leave `workspaces.owner_user_id`
    pointing at someone with no membership — the same state `set_member_role`
    refuses to create, and the fix for it is an ownership transfer, which does
    not exist yet.

    Their runs and artifacts stay. They belong to the workspace.
    """
    membership = await find_membership(session, workspace_id=workspace_id, user_id=user.id)
    if membership is None:
        return False
    if membership.role == Role.OWNER:
        raise CannotLeaveOwnedWorkspace(str(workspace_id))
    await session.execute(
        Membership.__table__.delete().where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == user.id,
        )
    )
    # Same reason as remove_member: resolve_active_workspace would fall back on
    # the next request anyway, but a user should not walk away holding a pointer
    # at a tenant they just left.
    if user.active_workspace_id == workspace_id:
        user.active_workspace_id = None
    await session.flush()
    return True


class NotWorkspaceOwner(Exception):
    """Only the owner may dispose of a workspace."""


class CannotDeletePersonalWorkspace(Exception):
    """The account's own tenant is not deletable — it is where everything falls back to."""


async def delete_workspace(session: AsyncSession, *, user: User, workspace_id: uuid.UUID) -> bool:
    """Retire a shared workspace. False if the caller is not a member of it.

    The other half of ownership transfer, and the reason it is in the same
    change: those are the only two ways out of a workspace you own, and shipping
    one without the other leaves an owner who does not want to hand the group to
    anybody still stuck with it forever.

    Pre-Scope for the same reason `leave_workspace` is — the workspace being
    disposed of is usually not the one the caller is standing in, and requiring a
    switch first would mean entering a tenant in order to destroy it, then being
    bounced out of it mid-request.

    A SOFT delete. `deleted_at` is already the predicate every workspace read
    filters on — the switcher, the invitation list, scope resolution — so setting
    it removes the workspace from all of them in one write, and the runs and
    artifacts underneath keep pointing at a row that still exists. Nothing here
    is recoverable through the product; it is recoverable by an operator with a
    SQL prompt, which is the right amount of difficulty for an operation the UI
    asks about twice.
    """
    membership = await find_membership(session, workspace_id=workspace_id, user_id=user.id)
    if membership is None:
        return False
    if membership.role != Role.OWNER:
        raise NotWorkspaceOwner(str(workspace_id))
    workspace = (
        await session.execute(
            select(Workspace)
            .where(Workspace.id == workspace_id, Workspace.deleted_at.is_(None))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if workspace is None:
        return False
    if workspace.kind == WorkspaceKind.PERSONAL:
        raise CannotDeletePersonalWorkspace(str(workspace_id))
    workspace.deleted_at = dt.datetime.now(dt.timezone.utc)
    # Everyone standing in it, not just the owner. `resolve_active_workspace`
    # already falls back on a pointer that no longer resolves, so this is not
    # what makes the deletion correct — it is what stops every other member
    # paying a failed lookup on their next request for a tenant that is gone.
    await session.execute(
        update(User)
        .where(User.active_workspace_id == workspace_id)
        .values(active_workspace_id=None)
    )
    await session.flush()
    return True


async def count_owned_workspaces(session: AsyncSession, *, user_id: Any) -> int:
    """Live workspaces this user owns, personal included.

    Personal is counted rather than exempted so the number the tier limit is
    compared against is the same number the user can see in their switcher.
    """
    return int(
        (
            await session.execute(
                select(func.count(Workspace.id)).where(
                    Workspace.owner_user_id == user_id,
                    Workspace.deleted_at.is_(None),
                )
            )
        ).scalar_one()
    )


class WorkspaceLimitReached(Exception):
    """The account already owns as many workspaces as its tier allows."""

    def __init__(self, owned: int, limit: int) -> None:
        super().__init__(f"{owned}/{limit} workspaces owned")
        self.owned = owned
        self.limit = limit


async def create_team_workspace(
    session: AsyncSession,
    *,
    owner: User,
    name: str,
    owned_workspace_limit: int | None,
) -> tuple[Workspace, Membership]:
    """Create a shared workspace with its creator as OWNER.

    Unscoped like the rest of this module by necessity: a workspace that does
    not exist yet cannot be the subject of a Scope. The authority checked is
    "you are a signed-in user", which is all creating your own tenant requires.

    Deliberately does NOT set the creator's active workspace. `get_scope` reads
    one pointer and exactly one route writes it, and that property is worth more
    than saving the client a round trip.

    No starter artifact. The Bell circuit exists to give a new *account* a
    working example; a second workspace is made by someone who already has one,
    and filing an unasked-for artifact into a shared Vault is noise.
    """
    normalized = " ".join(name.strip().split())
    if not normalized:
        raise ValueError("workspace name cannot be blank")
    if owned_workspace_limit is not None:
        owned = await count_owned_workspaces(session, user_id=owner.id)
        if owned >= owned_workspace_limit:
            raise WorkspaceLimitReached(owned, owned_workspace_limit)
    workspace = Workspace(
        id=uuid7(),
        kind="team",
        name=normalized,
        owner_user_id=owner.id,
    )
    session.add(workspace)
    await session.flush()
    membership = Membership(
        workspace_id=workspace.id,
        user_id=owner.id,
        role=Role.OWNER,
        # Self-created: they are looking at the form that made it.
        acknowledged_at=dt.datetime.now(dt.timezone.utc),
    )
    session.add(membership)
    await session.flush()
    return workspace, membership


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
    session.add(
        Membership(
            workspace_id=ws.id,
            user_id=user.id,
            role=Role.OWNER,
            # Nobody invited them here — this workspace was created for them, by
            # signing in. An unacknowledged membership would announce their own
            # account to them on their first page load (migration 0038).
            acknowledged_at=dt.datetime.now(dt.timezone.utc),
        )
    )
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


async def list_orphaned_runs(
    session: AsyncSession,
    *,
    grace_seconds: float = ORPHANED_RUN_GRACE_S,
    limit: int = 10,
) -> tuple[OrphanedRun, ...]:
    """Runs still active whose execution job is terminal and past all delivery.

    Dead-letter delivery is the only thing that closes a run whose job died, and
    it is not guaranteed to succeed: `mark_job_dead_lettered` sets
    `dead_lettered_at` after its retry budget is exhausted whether the callback
    worked or not. When that happens the job leaves the delivery candidate set
    and nothing ever revisits the run — it spins in `running` forever, which is
    what stranded 12 production runs between 2026-07-16 and 07-19.

    This is the reconciliation query behind the reaper, and every predicate here
    exists to keep it from ever closing a live run — much the worse failure. The
    job must be terminal, delivery must have finished with it (`dead_lettered_at`
    is set), the grace period must have cleared the delivery retry budget (5
    attempts ~30s apart), and — belt and braces against a future second
    run-bearing job kind — the run must have no other job still working.
    """
    if grace_seconds < 0:
        raise ValueError("grace_seconds must not be negative")
    # Deliberately not _lease_delta: that enforces a lease bound of (0, 3600],
    # which is a different quantity with different valid values. Reusing it
    # made grace_seconds=0 ("no grace") and any grace over an hour fail this
    # function's own check with a misleading message about lease_seconds.
    grace = dt.timedelta(seconds=grace_seconds)
    live_job = Job.__table__.alias("live_job")
    stmt = (
        select(Run.id, Run.workspace_id, Run.user_id, Job.id, Job.dead_letter_error)
        .join(Job, Job.run_id == Run.id)
        .where(
            Run.status.in_((RunStatus.QUEUED.value, RunStatus.RUNNING.value)),
            Job.status.in_(("failed", "dead")),
            Job.dead_lettered_at.is_not(None),
            Job.dead_lettered_at <= func.now() - grace,
            ~select(live_job.c.id)
            .where(
                live_job.c.run_id == Run.id,
                live_job.c.status.not_in(("failed", "dead")),
            )
            .exists(),
        )
        .order_by(Job.dead_lettered_at)
        .limit(limit)
    )
    rows = (await session.execute(stmt)).all()
    return tuple(
        OrphanedRun(
            run_id=run_id,
            workspace_id=workspace_id,
            user_id=user_id,
            job_id=job_id,
            delivery_error=delivery_error,
        )
        for run_id, workspace_id, user_id, job_id, delivery_error in rows
    )


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
