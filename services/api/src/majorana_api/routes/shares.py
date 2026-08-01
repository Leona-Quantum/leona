"""Project sharing — the granting side, and the grantee's side (migration 0042).

Two prefixes on purpose, and they are not symmetrical:

- `/workspace/projects/{id}/shares` sits under the workspace surface, because
  managing a grant is a workspace administration action on a row the workspace
  owns. It is the same neighbourhood as `/workspace/members`.
- `/shared/projects/...` is its own tree, because the caller's workspace has
  nothing to do with what these return. Putting them under `/workspace` would
  have made every one of them look like it reads the active workspace, which is
  the misreading most likely to end in somebody adding a `scope.workspace_id`
  filter that silently empties the surface — or removing one that mattered.

Every handler here delegates the authorization decision to `repos/shares.py`.
None of them takes a workspace id from the caller: the granting half derives it
from the scope like every other route, and the grantee half derives it from the
grant. `test_no_route_accepts_a_caller_supplied_scope` covers both.
"""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from majorana_contracts import Artifact as ArtifactResource
from majorana_contracts import ArtifactVersion as ArtifactVersionResource
from majorana_contracts import ProjectShare as ProjectShareResource
from majorana_contracts import SharedProject as SharedProjectResource
from majorana_contracts.enums import Algorithm, Framework, ShareRole
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..orm import ProjectShare as ProjectShareRow
from ..orm import User as UserRow
from ..repos import artifacts as artifacts_repo
from ..repos import shares as shares_repo
from ..repos import workspaces as workspaces_repo
from ..settings import Settings
from ..tiers import limits_for, resolve_tier

# The two row→resource mappers, imported rather than copied. A shared artifact
# must render EXACTLY as an owned one does — same verification grade, same
# absent-means-absent handling — and a second copy of that mapping is how a
# shared circuit ends up claiming a verdict the same row does not claim
# elsewhere.
from .artifacts import _artifact_cap_refusal, _to_artifact, _to_version

router = APIRouter()

#: A shared project's contents, in one page. Higher than the Vault's default 50
#: because this list is not paginated in the UI — a project is a hand-made
#: grouping, and one with more than this many circuits in it is not the case
#: worth adding a cursor for today.
SHARED_ARTIFACT_LIMIT = 200
SHARED_VERSION_LIMIT = 50


class GrantShareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: The person is named by address, never by user id. An id would let this
    #: route be driven with values guessed or scraped from elsewhere; an address
    #: is something the granter typed because they know whose it is.
    #:
    #: Validated exactly as `InviteMemberRequest.email` is, and deliberately not
    #: with `EmailStr`: that pulls in `email-validator` and would mean the two
    #: routes that take an address in this service disagree about what one is.
    email: str = Field(min_length=3, max_length=320)
    role: ShareRole = ShareRole.VIEWER
    #: Optional. Absent means the grant does not expire.
    expires_at: dt.datetime | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("an email address is required")
        return normalized

    @field_validator("expires_at")
    @classmethod
    def require_timezone(cls, value: dt.datetime | None) -> dt.datetime | None:
        """A naive datetime here would be compared against an aware one below.

        Refused rather than assumed-UTC: the difference between the two readings
        is up to a day of access, and guessing is how a grant expires at a time
        nobody chose.
        """
        if value is not None and value.tzinfo is None:
            raise ValueError("expires_at must carry a timezone offset")
        return value


class SaveSharedVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: What the editor believes is current. Required and nullable rather than
    #: optional-with-a-default: a client that forgets to send it would otherwise
    #: get last-write-wins, which is the exact failure this field exists to stop.
    expected_current_version_id: uuid.UUID | None
    code: str = Field(min_length=1, max_length=shares_repo.MAX_SHARED_CODE_CHARS)
    code_lang: str = Field(min_length=1, max_length=40)


class CopySharedArtifactRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: A project in the CALLER's workspace to file the copy under. Resolved
    #: against their scope, so another workspace's project id is a 404.
    target_project_id: uuid.UUID | None = None


def _to_share(share: ProjectShareRow, grantee: UserRow, granter: UserRow | None):
    return ProjectShareResource(
        project_id=share.project_id,
        grantee_user_id=share.grantee_user_id,
        grantee_email=grantee.email,
        grantee_display_name=grantee.display_name,
        role=ShareRole(share.role),
        granted_by_user_id=share.granted_by_user_id,
        granted_by_email=granter.email if granter is not None else None,
        expires_at=share.expires_at,
        created_at=share.created_at or dt.datetime.now(dt.timezone.utc),
        updated_at=share.updated_at or dt.datetime.now(dt.timezone.utc),
    )


def _to_shared_project(row: shares_repo.SharedProjectRow) -> SharedProjectResource:
    return SharedProjectResource(
        id=row.access.project_id,
        name=row.access.project_name,
        owner_workspace_id=row.access.owner_workspace_id,
        owner_workspace_name=row.access.owner_workspace_name,
        role=row.access.role,
        shared_by_email=row.granted_by.email if row.granted_by else None,
        shared_by_display_name=row.granted_by.display_name if row.granted_by else None,
        expires_at=row.access.expires_at,
        shared_at=row.access.shared_at,
        artifact_count=row.artifact_count,
        artifact_limit=row.artifact_limit,
        revision=row.revision,
    )


def _share_refusal(exc: shares_repo.ShareError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(exc))


# --------------------------------------------------------------------------- #
# Granting — the workspace that owns the project
# --------------------------------------------------------------------------- #


@router.get("/workspace/projects/{project_id}/shares", response_model=list[ProjectShareResource])
async def list_project_shares(
    project_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> list[ProjectShareResource]:
    """Who this project is shared with. Admin only.

    A project outside this workspace is a 404 before any grant is read, so this
    route cannot be used to ask whether an arbitrary project id exists.
    """
    rows = await shares_repo.list_shares(scope, session, project_id)
    return [_to_share(share, grantee, granter) for share, grantee, granter in rows]


@router.post(
    "/workspace/projects/{project_id}/shares",
    response_model=ProjectShareResource,
    status_code=201,
)
async def grant_project_share(
    project_id: uuid.UUID,
    body: GrantShareRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
) -> ProjectShareResource:
    """Share this project with somebody, or change what they may do with it.

    201 in both cases. A role change is not a new resource, but distinguishing
    them here would mean the client has to know whether the person already had
    access to know which status to expect — and it asked to share with them
    either way.
    """
    try:
        share, grantee = await shares_repo.grant_share(
            scope,
            session,
            project_id,
            email=body.email,
            role=body.role,
            expires_at=body.expires_at,
        )
    except shares_repo.ShareError as exc:
        raise _share_refusal(exc) from exc
    # The granter is the caller, so it comes from the identity already resolved
    # for this request rather than from a second lookup that could disagree.
    granter, _personal_workspace = identity
    return _to_share(share, grantee, granter)


@router.delete("/workspace/projects/{project_id}/shares/{grantee_user_id}", status_code=204)
async def revoke_project_share(
    project_id: uuid.UUID,
    grantee_user_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> Response:
    """Take one person's access away. Effective on their very next request."""
    await shares_repo.revoke_share(scope, session, project_id, grantee_user_id=grantee_user_id)
    return Response(status_code=204)


@router.delete("/workspace/projects/{project_id}/shares", status_code=204)
async def revoke_all_project_shares(
    project_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> Response:
    """Stop sharing this project with everybody, without deleting the project."""
    await shares_repo.revoke_all_shares(scope, session, project_id)
    return Response(status_code=204)


# --------------------------------------------------------------------------- #
# Using a grant — the person it was made to
# --------------------------------------------------------------------------- #


@router.get("/shared/projects", response_model=list[SharedProjectResource])
async def list_shared_projects(
    scope: CurrentScope, session: DbSession
) -> list[SharedProjectResource]:
    """Every project currently shared with the caller, newest share first.

    Expired and revoked grants are simply absent — this route has no concept of
    a grant that used to work, because a client shown one would have to be
    trusted not to try it.
    """
    return [
        _to_shared_project(row) for row in await shares_repo.list_shared_projects(scope, session)
    ]


@router.get("/shared/projects/{project_id}", response_model=SharedProjectResource)
async def get_shared_project(
    project_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> SharedProjectResource:
    """One shared project's header, including the revision a client polls."""
    return _to_shared_project(await shares_repo.get_shared_project(scope, session, project_id))


@router.get("/shared/projects/{project_id}/artifacts", response_model=list[ArtifactResource])
async def list_shared_artifacts(
    project_id: uuid.UUID, scope: CurrentScope, session: DbSession
) -> list[ArtifactResource]:
    _access, rows = await shares_repo.list_shared_artifacts(
        scope, session, project_id, limit=SHARED_ARTIFACT_LIMIT
    )
    return [_to_artifact(artifact, metadata) for artifact, metadata in rows]


@router.get(
    "/shared/projects/{project_id}/artifacts/{artifact_id}", response_model=ArtifactResource
)
async def get_shared_artifact(
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactResource:
    _access, artifact, metadata = await shares_repo.get_shared_artifact(
        scope, session, project_id, artifact_id
    )
    return _to_artifact(artifact, metadata)


class SharedVersionSummary(BaseModel):
    """One row of a shared circuit's history.

    Route-local and deliberately thinner than the owner's `ArtifactVersionSummary`:
    the restore-loss codes on that model exist to warn somebody about to restore,
    and a grantee cannot restore. Sending them would be describing an operation
    that is not offered.
    """

    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID
    seq: int
    is_current: bool
    code_lang: str
    fingerprint: str
    created_at: dt.datetime | None


class SharedVersionPage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    versions: list[SharedVersionSummary]
    current_version_id: uuid.UUID | None
    next_before_seq: int | None


@router.get(
    "/shared/projects/{project_id}/artifacts/{artifact_id}/versions",
    response_model=SharedVersionPage,
)
async def list_shared_versions(
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
    before_seq: Annotated[int | None, Query(ge=1)] = None,
) -> SharedVersionPage:
    _access, artifact, versions = await shares_repo.list_shared_versions(
        scope,
        session,
        project_id,
        artifact_id,
        before_seq=before_seq,
        limit=SHARED_VERSION_LIMIT + 1,
    )
    has_more = len(versions) > SHARED_VERSION_LIMIT
    page = versions[:SHARED_VERSION_LIMIT]
    return SharedVersionPage(
        versions=[
            SharedVersionSummary(
                id=row.id,
                seq=row.seq,
                is_current=row.id == artifact.current_version_id,
                code_lang=row.code_lang,
                fingerprint=row.fingerprint,
                created_at=row.created_at,
            )
            for row in page
        ],
        current_version_id=artifact.current_version_id,
        next_before_seq=page[-1].seq if has_more and page else None,
    )


@router.get(
    "/shared/projects/{project_id}/artifacts/{artifact_id}/versions/{version_id}",
    response_model=ArtifactVersionResource,
)
async def get_shared_version(
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    version_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactVersionResource:
    _access, _artifact, version = await shares_repo.get_shared_version(
        scope, session, project_id, artifact_id, version_id
    )
    return _to_version(version)


@router.post(
    "/shared/projects/{project_id}/artifacts/{artifact_id}/versions",
    response_model=ArtifactVersionResource,
    status_code=201,
)
async def save_shared_version(
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    body: SaveSharedVersionRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ArtifactVersionResource:
    """Save an edit to a shared circuit. Editor grants only.

    409 with `reason: "version_conflict"` when somebody else saved first, and the
    body names the version that won so the client can show it and offer to
    re-save on top of it. That re-save is an ordinary request carrying the new
    id — there is no force flag, because forcing without having seen what you
    are overwriting is the lost update this refuses.
    """
    try:
        _access, _artifact, version = await shares_repo.create_shared_version(
            scope,
            session,
            project_id,
            artifact_id,
            expected_current_version_id=body.expected_current_version_id,
            code=body.code,
            code_lang=body.code_lang,
        )
    except shares_repo.VersionConflict as exc:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "Somebody else saved this circuit while you were editing it. "
                    "Open what they saved before replacing it."
                ),
                "reason": "version_conflict",
                "current_version_id": (
                    str(exc.current_version_id) if exc.current_version_id else None
                ),
            },
        ) from exc
    except shares_repo.ShareError as exc:
        raise _share_refusal(exc) from exc
    return _to_version(version)


@router.post(
    "/shared/projects/{project_id}/artifacts/{artifact_id}/copy",
    response_model=ArtifactResource,
    status_code=201,
)
async def copy_shared_artifact(
    project_id: uuid.UUID,
    artifact_id: uuid.UUID,
    body: CopySharedArtifactRequest,
    scope: CurrentScope,
    session: DbSession,
    identity: CurrentIdentity,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ArtifactResource:
    """Take a copy of a shared circuit into the caller's own workspace.

    The Vault cap is checked HERE and not in the repository, mirroring
    `keep_artifact`: that is the one place an artifact is filed by a user's
    choice, and this is the second. The copy is created unkept, so a caller at
    their cap gets a refusal instead of a row they cannot see — and the check
    runs before anything is written rather than after.
    """
    user, _workspace = identity
    limits = limits_for(
        resolve_tier(user.email, plan=user.plan, developer_emails=settings.developer_emails)
    )
    if limits.private_artifacts is not None:
        _ws, _members, kept, _runs = await workspaces_repo.get_overview(scope, session)
        if kept >= limits.private_artifacts:
            raise _artifact_cap_refusal(kept, limits.private_artifacts)
    try:
        _access, copy = await shares_repo.copy_shared_artifact(
            scope,
            session,
            project_id,
            artifact_id,
            target_project_id=body.target_project_id,
        )
    except shares_repo.ShareError as exc:
        raise _share_refusal(exc) from exc
    # Filed immediately: the caller asked for a copy in their Studio, and an
    # unkept one would be invisible there. The cap above is what makes this safe
    # to do without a second round trip.
    kept_copy = await artifacts_repo.keep_artifact(scope, session, copy.id)
    metadata = None
    if kept_copy.current_version_id is not None:
        version = await artifacts_repo.get_version(scope, session, kept_copy.current_version_id)
        metadata = version.artifact_metadata
    return _to_artifact(kept_copy, metadata)


class ContributeArtifactRequest(BaseModel):
    """A new circuit for a project somebody else owns.

    No `project_id` and no `workspace_id`: both come from the path and the grant.
    A body field for either would be a caller-supplied scope, which is the thing
    `test_no_route_accepts_a_caller_supplied_scope` exists to refuse.
    """

    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=200)
    family: Algorithm = Algorithm.OTHER
    framework: Framework
    code: str = Field(min_length=1, max_length=shares_repo.MAX_SHARED_CODE_CHARS)
    code_lang: str = Field(default="python", max_length=32)

    @field_validator("title")
    @classmethod
    def _title_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("a contributed circuit needs a title")
        return value


@router.post(
    "/shared/projects/{project_id}/artifacts",
    response_model=ArtifactResource,
    status_code=201,
)
async def contribute_shared_artifact(
    project_id: uuid.UUID,
    body: ContributeArtifactRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> ArtifactResource:
    """Add a new circuit to a project shared with you. EDITOR only.

    ## Whose allowance this spends, and why the identity here is not the caller's

    Every other artifact write in this service reads the tier off `CurrentIdentity`
    — the person making the request. This one must not. The row lands in the
    OWNER's workspace and is counted on the OWNER's account page, so the limit
    that applies is theirs, and a developer-tier contributor must not be able to
    fill a free-tier owner's Vault because their own plan says unlimited.

    `shared_project_owner` resolves that account behind the grant, and the
    resolved number is handed to the repository, which enforces it **and** the
    project's own cap under the project row lock. The `Settings` dependency is
    still the caller's request-scoped one — it carries the deployment's developer
    allowlist, which is a property of the deployment, not of who is asking.

    Refused with 409 and a sentence, not 403: at the moment of the refusal the
    caller does have permission — the container is full. The two walls produce
    different sentences because only one of them is one the contributor can do
    anything about.
    """
    _access, owner = await shares_repo.shared_project_owner(scope, session, project_id)
    limits = limits_for(
        resolve_tier(owner.email, plan=owner.plan, developer_emails=settings.developer_emails)
    )
    try:
        _access, artifact, version = await shares_repo.contribute_artifact(
            scope,
            session,
            project_id,
            title=body.title,
            family=body.family,
            framework=body.framework,
            code=body.code,
            code_lang=body.code_lang,
            workspace_artifact_limit=limits.private_artifacts,
        )
    except shares_repo.ShareError as exc:
        raise _share_refusal(exc) from exc
    return _to_artifact(artifact, version.artifact_metadata)
