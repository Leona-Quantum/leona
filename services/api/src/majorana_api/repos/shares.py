"""Project grants — the second authorization path to an artifact row (0042).

Everywhere else in this package there is exactly one way to reach a row: the
workspace it lives in, named by `scope.workspace_id`, bound by the statement
itself. This module is the only exception, and it is written so that the
exception is a *place* rather than a property of the codebase.

## The shape, and why it is this shape

`repos/projects.py` said what it should be before it existed: grants "arrive as
their own functions with their own scoping proof, not as an extra branch inside
these". So nothing in this file changes any existing query, and `Scope` is
unchanged — a grant-aware field on `Scope` would mean every one of the ~90
repository functions is one `or` away from honouring a grant nobody audited it
for.

## The two halves, and the two different predicates

- **Granting** (`list_shares`, `count_shares`, `grant_share`, `revoke_share`,
  `revoke_all_shares`) belongs to the workspace that OWNS the project. There is
  no separate `update_share`: `grant_share` is idempotent on the person, so
  changing a role is granting again with a different one, and a second function
  would be a second place for the refusals below to be forgotten. Every one binds
  `scope.workspace_id` through `projects.get_project`, exactly like the rest of
  the package, and needs ADMIN — a grant is a door into the tenant, so it is
  the same bar as adding a member.
- **Using** (everything below `resolve_share`) belongs to the GRANTEE, and binds
  `scope.user_id` instead. That is the inversion that makes this file dangerous
  and the reason the resolution is one function.

## The elevated scope

A shared read or write has to reuse the tested machinery in `artifacts.py` — the
row lock, the fingerprint reinstatement, the `seq` allocation, the `deleted_at`
and `kept_at` predicates. So `_elevated` builds a `Scope` pointing at the OWNING
workspace. `tests/authz/test_authz_matrix.py::test_the_test_forged_scope_reaches_data`
exists to say out loud that such a scope reaches data; this is the one place
allowed to build one, and two things confine it:

1. **It never leaves this module.** No function here returns a Scope, and every
   caller outside gets rows.
2. **Every id used with it is proven to be in the shared project first** —
   `artifact.project_id == access.project_id`, checked after the read and before
   anything is done with the row. That single comparison is the security
   boundary of the whole feature, and `test_project_shares_live.py` probes it
   from both directions: a sibling artifact in the same workspace but a
   different project, and an artifact in a different workspace entirely.

The role mapping is a third gate that costs nothing: EDITOR becomes MEMBER and
VIEWER becomes VIEWER, so every `require_admin` operation in `artifacts.py`
(soft-delete, set_visibility) refuses a grantee without anybody maintaining a
list of forbidden operations that a new function could be added outside of.
"""

import datetime as dt
import hashlib
import uuid
from dataclasses import dataclass
from typing import Any

from majorana_contracts import Scope
from majorana_contracts.enums import ExportStatus, Role, ShareRole
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ..ids import uuid7
from ..orm import Artifact, ArtifactVersion, Membership, Project, ProjectShare, User, Workspace
from . import artifacts as artifacts_repo
from ._base import AuthzError, NotFoundError, require_admin, touched_now
from .audit import record_audit
from .projects import get_project, set_artifact_project

#: Grants one project may carry. A share is a permission, not a distribution
#: channel: an artifact becomes readable by the world through `set_visibility`,
#: which demands verified physical PASS evidence. Without a ceiling here, sharing
#: the same project with a thousand addresses would be that same publication with
#: none of that gate, one grant at a time.
MAX_SHARES_PER_PROJECT = 50

#: A grantee's edit is capped at the same size as a Studio source submitted with
#: a run (`routes/runs.CreateRunRequest.source_code`). The rows land in someone
#: else's workspace, so the bound belongs on the write rather than on the reader.
MAX_SHARED_CODE_CHARS = 100_000

#: What `projects.max_artifacts IS NULL` means (migration 0043). NOT unlimited:
#: every project that predates the column is NULL and every one of them can be
#: shared, so reading NULL as unbounded would make the column's own migration the
#: hole it exists to close. Resolving it here rather than as a database DEFAULT
#: means this number can be changed for everyone who never chose one.
DEFAULT_PROJECT_ARTIFACT_LIMIT = 50

#: The ceiling on what an owner may set, mirrored by `ck_projects_max_artifacts_range`.
MAX_PROJECT_ARTIFACT_LIMIT = 500


def project_artifact_limit(project: Project) -> int:
    """The effective cap on a project's contents. One reader, three writers."""
    limit = project.max_artifacts
    return DEFAULT_PROJECT_ARTIFACT_LIMIT if limit is None else int(limit)


class ShareError(Exception):
    """A grant was refused for a reason the caller should be told in words."""


class VersionConflict(Exception):
    """Someone else saved this artifact since the caller loaded it.

    Carries the version that actually won, because the only useful next move is
    to look at it — and re-submitting with that id IS the confirmation to
    overwrite. There is deliberately no `force` flag: forcing without having been
    shown what you are overwriting is the lost update this exists to prevent.
    """

    def __init__(self, current_version_id: uuid.UUID | None) -> None:
        super().__init__(str(current_version_id))
        self.current_version_id = current_version_id


@dataclass(frozen=True)
class SharedAccess:
    """A resolved grant. The only thing `resolve_share` hands out.

    Frozen for the same reason `Scope` is: a decision about who may do what must
    not be editable by the code that acts on it.
    """

    project_id: uuid.UUID
    project_name: str
    owner_workspace_id: uuid.UUID
    owner_workspace_name: str
    role: ShareRole
    granted_by_user_id: uuid.UUID
    expires_at: dt.datetime | None
    shared_at: dt.datetime

    @property
    def may_edit(self) -> bool:
        return self.role is ShareRole.EDITOR


# --------------------------------------------------------------------------- #
# Granting — owned by the workspace the project lives in. Binds scope.workspace_id.
# --------------------------------------------------------------------------- #


async def list_shares(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID
) -> list[tuple[ProjectShare, User, User | None]]:
    """Who this project is shared with. Admin only, and scoped to the owner.

    `get_project` first, so a project in another workspace is a NotFound before
    any grant is read — otherwise this route would answer "does project X exist"
    for every id on the internet.

    The granter is an OUTER join: an account can be deleted while the grants it
    made are still live, and the answer to "who has access" must not disappear
    because the answer to "who let them in" did.
    """
    require_admin(scope)
    project = await get_project(scope, session, project_id)
    grantee = aliased(User, name="grantee")
    granter = aliased(User, name="granter")
    stmt = (
        select(ProjectShare, grantee, granter)
        .join(grantee, grantee.id == ProjectShare.grantee_user_id)
        .join(granter, granter.id == ProjectShare.granted_by_user_id, isouter=True)
        .where(ProjectShare.project_id == project.id)
        .order_by(ProjectShare.created_at, ProjectShare.id)
    )
    rows = (await session.execute(stmt)).all()
    return [(row[0], row[1], row[2]) for row in rows]


async def count_shares(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> int:
    """How many people this project is shared with.

    Deliberately NOT admin-gated, unlike `list_shares`: the count is what the
    sidebar puts on a project row so that deleting one can say how many people
    are about to lose access, and a member who can delete the project has to be
    able to see that sentence. The count says nothing about WHO.
    """
    project = await get_project(scope, session, project_id)
    return int(
        (
            await session.execute(
                select(func.count(ProjectShare.id)).where(ProjectShare.project_id == project.id)
            )
        ).scalar_one()
    )


async def _lock_project(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> Project:
    """The project row, locked, having proven it belongs to this workspace.

    Locked rather than merely read because grant, role change and revoke all
    read-then-write the share table: two admins acting at once must serialize on
    something, and the project is the thing they are both talking about. The
    unique index is still what makes it true — this only makes the loser wait
    instead of raising.
    """
    await get_project(scope, session, project_id)
    project = (
        await session.execute(
            select(Project)
            .where(Project.id == project_id, Project.workspace_id == scope.workspace_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if project is None:  # pragma: no cover - get_project just proved it exists
        raise NotFoundError("project")
    return project


async def _share_row(
    session: AsyncSession, project_id: uuid.UUID, grantee_user_id: uuid.UUID
) -> ProjectShare | None:
    return (
        (
            await session.execute(
                select(ProjectShare).where(
                    ProjectShare.project_id == project_id,
                    ProjectShare.grantee_user_id == grantee_user_id,
                )
            )
        )
        .scalars()
        .first()
    )


async def _user_by_email(session: AsyncSession, email: str) -> User:
    """The one account at this address — and a refusal when there is more than one.

    `users.email` carries NO unique constraint; only `workos_user_id` does. Two
    rows can hold the same address, and this is not hypothetical: switching WorkOS
    environments mints a new `sub` for the same person, which is the entire reason
    `repos/identity_migration.py` exists.

    This used to be `.first()` with no ORDER BY, so a duplicated address granted
    access to whichever row Postgres happened to return — and the grant list then
    displayed the address, so it looked exactly right. The likely outcome is a
    grant to the ORPHANED account: it appears in the owner's list, the person
    never sees the project, and nothing anywhere reports a problem.

    Refusing follows the rule `identity_migration` already set for this table and
    this exact situation — "picking one would silently decide which of two
    histories the person keeps". A grant is a door into a tenant, so guessing
    which of two accounts to open it for is the one thing not to do. The refusal
    names the ambiguity, which is something an operator can act on.

    Found by driving a share in a browser and noticing the grantee id was not the
    id the fixture had created.
    """
    normalized = email.strip().lower()
    rows = list(
        (
            await session.execute(
                select(User)
                .where(func.lower(User.email) == normalized)
                .order_by(User.created_at, User.id)
            )
        )
        .scalars()
        .all()
    )
    if not rows:
        raise NotFoundError("user")
    if len(rows) > 1:
        raise ShareError(
            f"{len(rows)} accounts on this deployment use that address; "
            "it cannot be shared with until they are resolved"
        )
    return rows[0]


async def grant_share(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    email: str,
    role: ShareRole,
    expires_at: dt.datetime | None = None,
) -> tuple[ProjectShare, User]:
    """Grant, or change the grant this person already holds. Admin only.

    Idempotent on the person rather than refusing a duplicate: sharing with
    somebody who already has access is a role change, and the alternative — an
    error — would make the obvious UI (pick a person, pick a role, press Share)
    wrong for half its uses. The unique index is what makes that true under two
    concurrent grants; the read-then-write below only makes the message nicer.

    Four refusals, each for a different reason:

    - **Yourself.** A grant to the person making it is a no-op that looks like a
      permission, and it would appear in the list as a door that is not one.
    - **An existing member of this workspace.** They can already read everything
      here through the front door. A grant would be a second, revocable-looking
      path to something revoking it would not take away.
    - **An expiry already in the past.** It would be a grant that never grants,
      recorded as one that does.
    - **Past MAX_SHARES_PER_PROJECT.** See the constant.
    """
    require_admin(scope)
    project = await _lock_project(scope, session, project_id)
    grantee = await _user_by_email(session, email)
    if grantee.id == scope.user_id:
        raise ShareError("you already have access to this project")
    member = (
        await session.execute(
            select(Membership.user_id).where(
                Membership.workspace_id == scope.workspace_id,
                Membership.user_id == grantee.id,
            )
        )
    ).scalar_one_or_none()
    if member is not None:
        raise ShareError("that person is already a member of this workspace")
    if expires_at is not None and expires_at <= dt.datetime.now(dt.timezone.utc):
        raise ShareError("the expiry date must be in the future")

    existing = await _share_row(session, project.id, grantee.id)
    if existing is None:
        count = int(
            (
                await session.execute(
                    select(func.count(ProjectShare.id)).where(ProjectShare.project_id == project.id)
                )
            ).scalar_one()
        )
        if count >= MAX_SHARES_PER_PROJECT:
            raise ShareError(
                f"a project can be shared with at most {MAX_SHARES_PER_PROJECT} people"
            )
        share = ProjectShare(
            id=uuid7(),
            project_id=project.id,
            grantee_user_id=grantee.id,
            role=role.value,
            granted_by_user_id=scope.user_id,
            expires_at=expires_at,
        )
        session.add(share)
        action = "project_share.granted"
    else:
        share = existing
        share.role = role.value
        share.expires_at = expires_at
        # Not re-stamped as a new grant: the person has had access since
        # `created_at`, and a role change is not the moment they got in.
        share.granted_by_user_id = scope.user_id
        share.updated_at = touched_now()
        action = "project_share.role_changed"
    await session.flush()
    await record_audit(
        scope,
        session,
        action=action,
        target_kind="project",
        target_id=project.id,
        meta={
            "grantee_user_id": str(grantee.id),
            "grantee_email": grantee.email,
            "role": role.value,
            "expires_at": expires_at.isoformat() if expires_at else None,
        },
    )
    return share, grantee


async def revoke_share(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID, *, grantee_user_id: uuid.UUID
) -> None:
    """Take the grant away. Admin only, and effective on their next request.

    Not idempotent-by-silence: revoking a grant that is not there raises, because
    "revoked" and "there was nothing to revoke" are different answers and an
    admin pressing the button on a stale list deserves the second one.

    The row is DELETEd rather than stamped — see migration 0042. The audit row
    written here is the history, and `audit_log` is append-only by database
    grant, which this table deliberately is not.
    """
    require_admin(scope)
    project = await _lock_project(scope, session, project_id)
    share = await _share_row(session, project.id, grantee_user_id)
    if share is None:
        raise NotFoundError("project share")
    grantee = (
        (await session.execute(select(User).where(User.id == grantee_user_id))).scalars().first()
    )
    await session.execute(
        delete(ProjectShare).where(
            ProjectShare.project_id == project.id,
            ProjectShare.grantee_user_id == grantee_user_id,
        )
    )
    await record_audit(
        scope,
        session,
        action="project_share.revoked",
        target_kind="project",
        target_id=project.id,
        meta={
            "grantee_user_id": str(grantee_user_id),
            "grantee_email": grantee.email if grantee is not None else None,
        },
    )
    await session.flush()


async def revoke_all_shares(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> int:
    """Every grant on this project, gone. Returns how many there were.

    Called before a project is deleted. The foreign key CASCADEs, so this is not
    what makes the rows go away — it is what makes the removal *auditable*: a
    cascade writes no history, and "the project was deleted" is a different
    sentence from "four people lost access to it", which is the one an admin
    reviewing the log needs.
    """
    require_admin(scope)
    project = await get_project(scope, session, project_id)
    grantees = list(
        (
            await session.execute(
                select(ProjectShare.grantee_user_id).where(ProjectShare.project_id == project.id)
            )
        )
        .scalars()
        .all()
    )
    if not grantees:
        return 0
    await session.execute(delete(ProjectShare).where(ProjectShare.project_id == project.id))
    await record_audit(
        scope,
        session,
        action="project_share.revoked_all",
        target_kind="project",
        target_id=project.id,
        meta={"grantee_user_ids": [str(g) for g in grantees], "count": len(grantees)},
    )
    await session.flush()
    return len(grantees)


# --------------------------------------------------------------------------- #
# Using a grant — owned by the grantee. Binds scope.user_id, NOT workspace_id.
# --------------------------------------------------------------------------- #


def _access_from_row(share: ProjectShare, project: Project, workspace: Workspace) -> SharedAccess:
    return SharedAccess(
        project_id=project.id,
        project_name=project.name,
        owner_workspace_id=workspace.id,
        owner_workspace_name=workspace.name,
        role=ShareRole(share.role),
        granted_by_user_id=share.granted_by_user_id,
        expires_at=share.expires_at,
        shared_at=share.created_at or dt.datetime.now(dt.timezone.utc),
    )


def _live_share_predicates() -> list[Any]:
    """What makes a grant currently good. Written once, used by both readers.

    `func.now()` rather than a Python timestamp so the clock that decides is the
    database's — the same clock that stamped `created_at` — and so a caller
    cannot influence it at all. Inside a transaction it is the transaction's
    start time, which is what makes a request that reads twice see one answer.
    """
    return [
        (ProjectShare.expires_at.is_(None)) | (ProjectShare.expires_at > func.now()),
        Workspace.deleted_at.is_(None),
    ]


async def resolve_share(scope: Scope, session: AsyncSession, project_id: uuid.UUID) -> SharedAccess:
    """The ONE function that turns a grant into permission. Everything uses it.

    Four conditions, evaluated together because evaluating any three of them is a
    leak: the row exists for THIS user, it has not expired, the project is still
    there, and the workspace that owns it has not been deleted.

    Deliberately keyed on `scope.user_id` and not on `scope.workspace_id`: the
    grant was made to a person, so it follows them into whichever of their own
    workspaces is active. Nobody else in that workspace gains anything — their
    user id is not on the row.

    A revoked grant is refused on the caller's very next request rather than at
    their next sign-in, because this runs per request. That is the same guarantee
    `remove_member` gives, and for the same reason.
    """
    stmt = (
        select(ProjectShare, Project, Workspace)
        .join(Project, Project.id == ProjectShare.project_id)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .where(
            ProjectShare.project_id == project_id,
            ProjectShare.grantee_user_id == scope.user_id,
            *_live_share_predicates(),
        )
    )
    row = (await session.execute(stmt)).first()
    if row is None:
        raise NotFoundError("shared project")
    return _access_from_row(row[0], row[1], row[2])


def _elevated(access: SharedAccess, user_id: uuid.UUID) -> Scope:
    """A scope pointing at somebody else's workspace. Never leaves this module.

    EDITOR maps to MEMBER and not to ADMIN, so `require_admin` refuses a grantee
    every destructive and every publishing operation without a denylist. VIEWER
    maps to VIEWER, so `require_write` refuses every write — which makes the
    explicit editor check below a second gate rather than the only one.
    """
    return Scope(
        user_id=user_id,
        workspace_id=access.owner_workspace_id,
        role=Role.MEMBER if access.may_edit else Role.VIEWER,
    )


async def _bound_artifact(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    *,
    need_edit: bool = False,
    for_update: bool = False,
) -> tuple[Scope, SharedAccess, Artifact]:
    """Resolve the grant, then prove the artifact is inside the project it names.

    THE security boundary. The elevated scope can read every artifact in the
    owning workspace; what stops it is `artifact.project_id != access.project_id`
    two lines down. A shared project confers access to its CONTENTS, and an id
    the caller guessed — a sibling artifact in the same workspace, or one filed
    nowhere — is a NotFound identical to a row that does not exist.

    Unkept artifacts are refused for the same reason `list_artifacts` hides them:
    a materialized run the owner has not filed is not part of their Vault yet,
    and a grant on a project must not be the one place it becomes visible.
    """
    access = await resolve_share(scope, session, project_id)
    if need_edit and not access.may_edit:
        raise AuthzError("this project is shared with you read-only")
    elevated = _elevated(access, scope.user_id)
    artifact = await artifacts_repo.get_artifact(
        elevated, session, artifact_id, for_update=for_update
    )
    if artifact.project_id != access.project_id or artifact.kept_at is None:
        raise NotFoundError("artifact")
    return elevated, access, artifact


def _visible_artifacts_of(project_id: Any, workspace_id: Any) -> list[Any]:
    """What a grantee can see inside a project — one list, four callers.

    `workspace_id` is in here as well as `project_id`, and it is not redundant:
    `artifacts.project_id` is a plain foreign key, so nothing in the DATABASE
    stops a row in workspace B from pointing at a project in workspace A. Today
    only `set_artifact_project` writes that column and it checks both halves —
    but "one function currently gets it right" is not the guarantee to rest a
    tenant boundary on, and adding the column here costs one predicate and lets
    every one of these queries use `ix_artifacts_workspace_project`.
    """
    return [
        Artifact.project_id == project_id,
        Artifact.workspace_id == workspace_id,
        Artifact.deleted_at.is_(None),
        Artifact.kept_at.is_not(None),
    ]


@dataclass(frozen=True)
class Person:
    """Just enough of an account to name it. Not an ORM row, on purpose.

    Returning a `User` here would hand a caller a live mapped instance for
    somebody in another workspace, which is a thing that can be edited and
    flushed by accident. Three read-only strings cannot.
    """

    user_id: uuid.UUID
    email: str
    display_name: str | None


def _person(user: User | None) -> Person | None:
    if user is None:
        return None
    return Person(user_id=user.id, email=user.email, display_name=user.display_name)


@dataclass(frozen=True)
class SharedProjectRow:
    """What a grantee is told about a project they do not own."""

    access: SharedAccess
    granted_by: Person | None
    artifact_count: int
    revision: dt.datetime
    project_updated_at: dt.datetime
    #: What `contribute_artifact` will refuse past (migration 0043). On the
    #: grantee's own header rather than only in the refusal, so an editor can see
    #: the room before they write something and lose it to a 409.
    artifact_limit: int


async def list_shared_projects(scope: Scope, session: AsyncSession) -> list[SharedProjectRow]:
    """Every live grant this person holds, newest share first.

    The count and the newest-change stamp are correlated subqueries rather than a
    grouped join over the whole artifacts table: there are few shared projects
    and many artifacts, and both read `ix_artifacts_workspace_project` directly
    this way. They are derived from ONE predicate list so the number of circuits
    and the "something changed" stamp can never describe different sets.
    """
    granter = aliased(User, name="granter")
    visible = _visible_artifacts_of(Project.id, Project.workspace_id)
    artifact_count = (
        select(func.count(Artifact.id)).where(*visible).correlate(Project).scalar_subquery()
    )
    newest_artifact = (
        select(func.max(Artifact.updated_at)).where(*visible).correlate(Project).scalar_subquery()
    )
    stmt = (
        select(ProjectShare, Project, Workspace, granter, artifact_count, newest_artifact)
        .join(Project, Project.id == ProjectShare.project_id)
        .join(Workspace, Workspace.id == Project.workspace_id)
        .join(granter, granter.id == ProjectShare.granted_by_user_id, isouter=True)
        .where(ProjectShare.grantee_user_id == scope.user_id, *_live_share_predicates())
        .order_by(ProjectShare.created_at.desc(), ProjectShare.id.desc())
    )
    rows = []
    for share, project, workspace, granter_row, count, newest in (
        await session.execute(stmt)
    ).all():
        access = _access_from_row(share, project, workspace)
        updated_at = project.updated_at or access.shared_at
        rows.append(
            SharedProjectRow(
                access=access,
                granted_by=_person(granter_row),
                artifact_count=int(count or 0),
                revision=max(updated_at, newest) if newest is not None else updated_at,
                project_updated_at=updated_at,
                artifact_limit=project_artifact_limit(project),
            )
        )
    return rows


async def get_shared_project(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID
) -> SharedProjectRow:
    """One shared project's header. Same resolution as everything else here."""
    access = await resolve_share(scope, session, project_id)
    project = (
        await session.execute(select(Project).where(Project.id == access.project_id))
    ).scalar_one()
    granter = (
        (await session.execute(select(User).where(User.id == access.granted_by_user_id)))
        .scalars()
        .first()
    )
    updated_at = project.updated_at or access.shared_at
    visible = _visible_artifacts_of(access.project_id, access.owner_workspace_id)
    count, newest = (
        await session.execute(
            select(func.count(Artifact.id), func.max(Artifact.updated_at)).where(*visible)
        )
    ).one()
    return SharedProjectRow(
        access=access,
        granted_by=_person(granter),
        artifact_count=int(count or 0),
        revision=max(updated_at, newest) if newest is not None else updated_at,
        project_updated_at=updated_at,
        artifact_limit=project_artifact_limit(project),
    )


async def list_shared_artifacts(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID, *, limit: int = 200
) -> tuple[SharedAccess, list[tuple[Artifact, dict[str, Any] | None]]]:
    """The circuits inside a shared project, with their verification grades.

    Goes through `artifacts.list_artifacts` with the elevated scope and a
    `project_id` filter rather than issuing its own SELECT. That function already
    excludes deleted and unkept rows and already carries the current version's
    metadata; a second copy of it here would be a second place for those
    predicates to be forgotten.
    """
    access = await resolve_share(scope, session, project_id)
    elevated = _elevated(access, scope.user_id)
    rows = await artifacts_repo.list_artifacts(
        elevated, session, limit=limit, project_id=access.project_id
    )
    return access, rows


async def get_shared_artifact(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID, artifact_id: uuid.UUID
) -> tuple[SharedAccess, Artifact, dict[str, Any] | None]:
    """One circuit from a shared project, plus its current version's metadata."""
    elevated, access, artifact = await _bound_artifact(scope, session, project_id, artifact_id)
    metadata: dict[str, Any] | None = None
    if artifact.current_version_id is not None:
        version = await artifacts_repo.get_version(elevated, session, artifact.current_version_id)
        metadata = (
            version.artifact_metadata if isinstance(version.artifact_metadata, dict) else None
        )
    return access, artifact, metadata


async def list_shared_versions(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    *,
    before_seq: int | None = None,
    limit: int = 50,
) -> tuple[SharedAccess, Artifact, list[ArtifactVersion]]:
    """A shared circuit's history. The grant reaches the artifact's whole life.

    Not narrowed to versions authored after the share began, deliberately: a
    circuit's history is the evidence for what it is, and a reader shown only the
    tail would be reading a version's verdict without the executions that earned
    it. The granter is sharing a body of work, not a time window on it.
    """
    elevated, access, artifact = await _bound_artifact(scope, session, project_id, artifact_id)
    versions = await artifacts_repo.list_versions(
        elevated, session, artifact.id, before_seq=before_seq, limit=limit
    )
    return access, artifact, versions


async def get_shared_version(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    version_id: uuid.UUID,
) -> tuple[SharedAccess, Artifact, ArtifactVersion]:
    """One version's actual content.

    The `version.artifact_id != artifact.id` check is the same argument as the
    project binding one level up: `get_version` binds the workspace, so without
    it any version in the owning workspace would be readable through a grant on
    one project.
    """
    elevated, access, artifact = await _bound_artifact(scope, session, project_id, artifact_id)
    version = await artifacts_repo.get_version(elevated, session, version_id)
    if version.artifact_id != artifact.id:
        raise NotFoundError("artifact version")
    return access, artifact, version


async def create_shared_version(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    *,
    expected_current_version_id: uuid.UUID | None,
    code: str,
    code_lang: str,
) -> tuple[SharedAccess, Artifact, ArtifactVersion]:
    """Save an edit to a shared circuit. EDITOR only.

    ## The concurrency argument, which is the whole point of this function

    Two people with editor access open the same circuit. One saves. The other
    saves. Without a check the second save is simply the newer version and the
    first person's work is a row nobody will look at again — a lost update that
    nothing in the product would ever report.

    So the caller must say which version they were editing, and it is compared
    **under the artifact's row lock**, not before it: taking the lock first is
    what makes this a check rather than a race with a smaller window.
    `expected_current_version_id=None` is a real assertion too — it means "this
    circuit had no version when I opened it" and conflicts with any version at
    all.

    Re-submitting with the id the conflict reported IS the overwrite, and that is
    why there is no force flag: the only way to overwrite is to have been handed
    the thing you are overwriting.

    ## What the saved version claims

    Nothing. `verification_summary.verified` is False with a reason code, exactly
    as `_create_stale_source_draft` does for the owner's own edits, because
    evidence belongs to the execution that earned it and these are bytes a person
    typed. The metadata records WHICH person, in a workspace they are not a
    member of, which is the whole reason the audit row below is written against
    the owning workspace rather than the editor's.
    """
    if len(code) > MAX_SHARED_CODE_CHARS:
        raise ShareError(f"a saved circuit is limited to {MAX_SHARED_CODE_CHARS} characters")
    elevated, access, artifact = await _bound_artifact(
        scope, session, project_id, artifact_id, need_edit=True, for_update=True
    )
    if artifact.current_version_id != expected_current_version_id:
        raise VersionConflict(artifact.current_version_id)
    fingerprint = hashlib.sha256(code.encode()).hexdigest()
    version = await artifacts_repo.create_version(
        elevated,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "shared_project_edit",
            "edited_by_user_id": str(scope.user_id),
            "edited_from_workspace_id": str(scope.workspace_id),
            "based_on_version_id": (
                str(expected_current_version_id) if expected_current_version_id else None
            ),
            "source_fingerprint": fingerprint,
            "verification_summary": {
                "verified": False,
                "decision": None,
                "evidence_strength": None,
                "reason_code": "source_changed_pending_verification",
                "stale": True,
            },
        },
        code=code,
        code_lang=code_lang,
        fingerprint=fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="edited source requires fresh conversion",
        limitations="Edited through a project share; rerun before relying on verification evidence.",
    )
    # Written against the OWNING workspace, because that is the log its admins
    # read and this is a change to their rows. `record_audit` stamps
    # `actor_user_id` from the scope, so the elevated scope is what makes the row
    # say "this outsider, in our workspace" rather than losing one half of it.
    await record_audit(
        elevated,
        session,
        action="project_share.version_saved",
        target_kind="artifact",
        target_id=artifact.id,
        meta={
            "project_id": str(access.project_id),
            "version_id": str(version.id),
            "editor_workspace_id": str(scope.workspace_id),
        },
    )
    return access, artifact, version


async def copy_shared_artifact(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    *,
    target_project_id: uuid.UUID | None = None,
) -> tuple[SharedAccess, Artifact]:
    """Take a copy of a shared circuit into the caller's OWN workspace.

    The move that makes sharing useful without making it dangerous: the read
    happens through the grant, and the write is an ordinary scoped write into the
    caller's workspace, so the new rows count against the caller's allowance and
    are governed by the caller's roles. No elevated scope touches the create.

    **The copy carries no verdict.** The source version's
    `verification_summary` is not brought across — evidence belongs to the
    execution that earned it (ADR-0022), and a copy is a new row containing the
    same characters, not the same execution. It arrives unverified with a
    `limitations` sentence saying so, exactly as an import from the public
    repository does.

    Created UNKEPT. The Vault cap is enforced at `keep_artifact`, which is the
    one place an artifact is filed by a user's choice; creating this kept would
    walk around the cap, and enforcing the cap here would be a second copy of
    that rule to drift from the first.
    """
    elevated, access, artifact = await _bound_artifact(scope, session, project_id, artifact_id)
    if artifact.current_version_id is None:
        raise ShareError("that circuit has no saved version to copy")
    source = await artifacts_repo.get_version(elevated, session, artifact.current_version_id)
    if target_project_id is not None:
        # Resolved against the CALLER's workspace, so a copy cannot be filed into
        # somebody else's project by passing its id.
        await get_project(scope, session, target_project_id)

    slug = f"shared-copy-{uuid7().hex}"
    copy = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=slug,
        title=artifact.title,
        family=artifact.family,
        framework=artifact.framework,
        kept=False,
    )
    metadata: dict[str, Any] = {
        "source": {
            "kind": "shared_project",
            "project_id": str(access.project_id),
            "project_name": access.project_name,
            "workspace_name": access.owner_workspace_name,
            "artifact_id": str(artifact.id),
            "version_id": str(source.id),
        },
        "verification_summary": {
            "verified": False,
            "decision": None,
            "evidence_strength": None,
            "reason_code": "copied_from_shared_project_not_verified",
        },
    }
    await artifacts_repo.create_version(
        scope,
        session,
        copy.id,
        qasm_version=source.qasm_version,
        qasm=source.qasm,
        metadata=metadata,
        code=source.code,
        code_lang=source.code_lang,
        # Namespaced by the new artifact's id: `uq_artifact_versions_fingerprint`
        # is per artifact, but two copies of the same circuit taken by the same
        # person must still be two artifacts, and reusing the source fingerprint
        # would make the second copy reinstate the first one's version.
        fingerprint=hashlib.sha256(f"{copy.id}:{source.fingerprint}".encode()).hexdigest(),
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="copied from a shared project; re-run to earn exports",
        resource_estimates=source.resource_estimates,
        limitations=(
            "Copied from a project shared with you. This is the same source, not the same "
            "execution: it carries no verification evidence of its own. Re-run it before "
            "relying on any result."
        ),
    )
    if target_project_id is not None:
        await set_artifact_project(scope, session, copy.id, target_project_id)
    await record_audit(
        elevated,
        session,
        action="project_share.artifact_copied",
        target_kind="artifact",
        target_id=artifact.id,
        meta={
            "project_id": str(access.project_id),
            "copied_to_workspace_id": str(scope.workspace_id),
        },
    )
    return access, await artifacts_repo.get_artifact(scope, session, copy.id)


async def shared_project_owner(
    scope: Scope, session: AsyncSession, project_id: uuid.UUID
) -> tuple[SharedAccess, User]:
    """The account whose allowance a contribution would spend.

    A grantee's new artifact is a row in the OWNER's workspace, counted by
    `workspaces.get_overview` and shown on the owner's account page. So the tier
    that bounds it is the owner's, not the contributor's, and the contributor's
    own plan is irrelevant to whether the write is allowed.

    Behind `resolve_share`, so an address that holds no grant learns nothing —
    including whether the project exists.
    """
    access = await resolve_share(scope, session, project_id)
    owner = (
        (
            await session.execute(
                select(User)
                .join(Workspace, Workspace.owner_user_id == User.id)
                .where(Workspace.id == access.owner_workspace_id)
            )
        )
        .scalars()
        .first()
    )
    if owner is None:  # pragma: no cover - workspaces.owner_user_id is NOT NULL
        raise NotFoundError("workspace owner")
    return access, owner


async def contribute_artifact(
    scope: Scope,
    session: AsyncSession,
    project_id: uuid.UUID,
    *,
    title: str,
    family: str,
    framework: str,
    code: str,
    code_lang: str,
    workspace_artifact_limit: int | None,
) -> tuple[SharedAccess, Artifact, ArtifactVersion]:
    """Add a NEW circuit to a project shared with you. EDITOR only.

    ## Why this was refused until now, and what changed

    Session 49 shipped editing and stopped deliberately short of this, because a
    new artifact in somebody else's project is a row in **their** workspace,
    counted against **their** tier allowance — and nothing in the product let
    that account say how much of it a guest could spend. Migration 0043 is that
    statement: `projects.max_artifacts` bounds the container, the owner sets it,
    and it is the reason this function can exist at all.

    ## Two limits, and they are not the same limit

    - **The project cap** is the owner's *consent*: how much of their workspace
      this project may become. Zero is legal and means "edit what is here, add
      nothing".
    - **The owning workspace's tier allowance** is what the owner's account can
      *hold*. It is passed in rather than read here because the tier table lives
      in `tiers.py` and is applied at the route boundary for every other artifact
      write; a second copy of that resolution here would be a second thing to
      drift. It is a REQUIRED argument, not a defaulted one, so a caller cannot
      omit it and silently get no allowance check at all.

    They are refused separately because a contributor can do something about one
    of them (ask for more room) and nothing at all about the other, and a single
    "limit reached" sentence would leave them retrying against the wrong wall.

    ## Why the project row is locked

    The cap is a read-then-write. Two grantees contributing at once against a
    project with one slot left both read `count == 49` and both insert, and the
    fiftieth-and-first artifact is a row the owner never consented to. Taking
    `_lock_project` first — on the OWNING workspace's row, through the elevated
    scope — is what makes the comparison a check rather than a race. This is the
    same argument `create_shared_version` makes for locking the artifact before
    comparing versions.

    ## What the contributed artifact claims

    Nothing. Same as `create_shared_version` and for the same reason: evidence
    belongs to the execution that earned it, and this is bytes a person typed in
    a workspace they are not a member of. It arrives verified=False with a reason
    code, and the metadata names the contributor and the workspace they were
    working from, because the owner reviewing their own project has to be able to
    tell their work from a guest's.
    """
    if len(code) > MAX_SHARED_CODE_CHARS:
        raise ShareError(f"a contributed circuit is limited to {MAX_SHARED_CODE_CHARS} characters")
    normalized_title = " ".join(title.strip().split())[:200]
    if not normalized_title:
        raise ShareError("a contributed circuit needs a title")
    access = await resolve_share(scope, session, project_id)
    if not access.may_edit:
        raise AuthzError("this project is shared with you read-only")
    elevated = _elevated(access, scope.user_id)

    # Locked before either count is read. Everything from here to the flush is
    # serialized against another contributor doing the same thing.
    project = await _lock_project(elevated, session, access.project_id)
    limit = project_artifact_limit(project)
    held = int(
        (
            await session.execute(
                select(func.count(Artifact.id)).where(
                    *_visible_artifacts_of(access.project_id, access.owner_workspace_id)
                )
            )
        ).scalar_one()
    )
    if held >= limit:
        # Zero gets its own sentence. "holds 0 of its 0-circuit limit" is
        # arithmetically true and reads as a bug; the owner set it deliberately
        # and the contributor should be told that, not shown a full-up counter.
        if limit == 0:
            raise ShareError("this project does not accept new circuits")
        raise ShareError(
            f"this project holds {held} of its {limit}-circuit limit; "
            "its owner can raise the limit or remove a circuit"
        )
    if workspace_artifact_limit is not None:
        owner_kept = int(
            (
                await session.execute(
                    select(func.count(Artifact.id)).where(
                        Artifact.workspace_id == access.owner_workspace_id,
                        Artifact.deleted_at.is_(None),
                        Artifact.kept_at.is_not(None),
                    )
                )
            ).scalar_one()
        )
        if owner_kept >= workspace_artifact_limit:
            raise ShareError(
                f"the workspace that owns this project is at its {workspace_artifact_limit}-"
                "artifact plan limit; only its owner can make room"
            )

    # Content, with no nonce. `create_version` treats the fingerprint as exact
    # content identity and REINSTATES a matching row rather than writing a second
    # one, so a nonce would mean a contributor who edits this circuit and then
    # undoes the edit gets a third version holding bytes identical to the first.
    # There is no collision to avoid — the artifact below is new and
    # `uq_artifact_versions_fingerprint` is per artifact. Same rule as
    # `create_shared_version`, the function this one sits beside.
    fingerprint = hashlib.sha256(code.encode()).hexdigest()
    artifact = await artifacts_repo.create_artifact(
        elevated,
        session,
        slug=f"contributed-{uuid7().hex}",
        title=normalized_title,
        family=family,
        framework=framework,
        kept=True,
    )
    version = await artifacts_repo.create_version(
        elevated,
        session,
        artifact.id,
        qasm_version=None,
        qasm=None,
        metadata={
            "source": "shared_project_contribution",
            "contributed_by_user_id": str(scope.user_id),
            "contributed_from_workspace_id": str(scope.workspace_id),
            "source_fingerprint": fingerprint,
            "verification_summary": {
                "verified": False,
                "decision": None,
                "evidence_strength": None,
                "reason_code": "contributed_to_shared_project_not_verified",
                "stale": True,
            },
        },
        code=code,
        code_lang=code_lang,
        fingerprint=fingerprint,
        export_status=ExportStatus.UNSUPPORTED,
        export_reason="contributed source requires a run before it can be exported",
        limitations=(
            "Contributed through a project share. It carries no verification evidence of "
            "its own; run it before relying on any result."
        ),
    )
    # Filed into the project through the elevated scope, which resolves BOTH ids
    # against the owning workspace — so this cannot file the new row under a
    # different project, and it is the same function the owner's own drag uses.
    await set_artifact_project(elevated, session, artifact.id, access.project_id)
    await record_audit(
        elevated,
        session,
        action="project_share.artifact_contributed",
        target_kind="artifact",
        target_id=artifact.id,
        meta={
            "project_id": str(access.project_id),
            "version_id": str(version.id),
            "contributor_workspace_id": str(scope.workspace_id),
            "project_artifacts_after": held + 1,
            "project_artifact_limit": limit,
        },
    )
    await session.flush()
    return access, await artifacts_repo.get_artifact(elevated, session, artifact.id), version
