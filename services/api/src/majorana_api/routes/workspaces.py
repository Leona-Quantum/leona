"""Workspace settings and collaboration endpoints."""

import datetime as dt
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from majorana_contracts import Project as ProjectResource
from majorana_contracts import Workspace as WorkspaceResource
from majorana_contracts import WorkspaceFolder as WorkspaceFolderResource
from majorana_contracts import (
    WorkspaceInvitation,
    WorkspaceMember,
    WorkspaceOverview,
    WorkspaceSummary,
)
from majorana_contracts.enums import Role, WorkspaceKind
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..orm import Membership, Project, User
from ..orm import Workspace as WorkspaceRow
from ..orm import WorkspaceFolder
from ..repos import audit as audit_repo
from ..repos import folders as folders_repo
from ..repos import projects as projects_repo
from ..repos import shares as shares_repo
from ..repos import system
from ..repos import workspaces as workspaces_repo
from ..settings import Settings
from ..tiers import limits_for, tier_of

router = APIRouter()


class WorkspaceSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_keep_artifacts: bool


class WorkspaceRefRequest(BaseModel):
    """A workspace named in a body, never in a path.

    The three routes that take one — switch, acknowledge, leave — all act on the
    caller's OWN membership of it, and all validate it against `memberships`. It
    is not a scope selector, and `test_no_route_accepts_a_caller_supplied_scope`
    is what keeps it from becoming one.
    """

    model_config = ConfigDict(extra="forbid")

    workspace_id: uuid.UUID


class SwitchWorkspaceRequest(WorkspaceRefRequest):
    pass


class CreateWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=120)

    @field_validator("name")
    @classmethod
    def require_non_blank_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("workspace name cannot be blank")
        return normalized


#: Roles an invite may grant. OWNER and ADMIN are both absent, for different
#: reasons: OWNER is an ownership transfer, and ADMIN is an authority that should
#: be granted to someone already in the workspace rather than handed out with the
#: invitation that lets them in.
INVITABLE_ROLES = (Role.MEMBER, Role.VIEWER)


class InviteMemberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    role: Role = Role.MEMBER

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or normalized.startswith("@") or normalized.endswith("@"):
            raise ValueError("an email address is required")
        return normalized

    @field_validator("role")
    @classmethod
    def only_invitable_roles(cls, value: Role) -> Role:
        if value not in INVITABLE_ROLES:
            raise ValueError("role must be member or viewer")
        return value


class MemberRoleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Role

    @field_validator("role")
    @classmethod
    def role_is_assignable(cls, value: Role) -> Role:
        if value == Role.OWNER:
            # Ownership transfer exists now, but it is not this. Granting OWNER
            # also demotes the caller, and a one-sided role change is the wrong
            # shape for a two-sided operation.
            raise ValueError("use POST /workspace/transfer-ownership")
        return value


class TransferOwnershipRequest(BaseModel):
    """The member who is to receive the workspace, by user id.

    Never an email. `add_member_by_email` exists one route away, and accepting an
    address here would collapse "let this person in" and "give them the
    workspace" into a single call.
    """

    model_config = ConfigDict(extra="forbid")

    user_id: uuid.UUID


class CreateFolderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def require_non_blank_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("folder name cannot be blank")
        return normalized


class ReorderFoldersRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Every folder the client knows about, in the order it wants them shown.
    #: Not a {folder, index} pair: two tabs dragging against a positional API
    #: interleave into an order neither person chose, whereas last-write-wins on
    #: a whole list is at least an order somebody actually saw.
    order: list[uuid.UUID] = Field(max_length=500)


class CreateProjectRequest(BaseModel):
    """Separate from `CreateFolderRequest` so the message names what failed.

    The two are structurally identical today. Sharing one model would mean a
    blank project name is refused with "folder name cannot be blank", which is a
    sentence about a different part of the product.
    """

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def require_non_blank_name(cls, value: str) -> str:
        normalized = " ".join(value.strip().split())
        if not normalized:
            raise ValueError("project name cannot be blank")
        return normalized


class ReorderProjectsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    #: Every project the client knows about, in the order it wants them shown —
    #: the whole list, for the reason given on `ReorderFoldersRequest`.
    order: list[uuid.UUID] = Field(max_length=500)


def _to_member(membership: Membership, user: User) -> WorkspaceMember:
    return WorkspaceMember(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=Role(membership.role),
        created_at=membership.created_at or dt.datetime.now(dt.timezone.utc),
    )


def _to_folder(folder: WorkspaceFolder) -> WorkspaceFolderResource:
    now = dt.datetime.now(dt.timezone.utc)
    return WorkspaceFolderResource(
        id=folder.id,
        workspace_id=folder.workspace_id,
        name=folder.name,
        created_at=folder.created_at or now,
        updated_at=folder.updated_at or now,
    )


def _to_project(project: Project) -> ProjectResource:
    now = dt.datetime.now(dt.timezone.utc)
    return ProjectResource(
        id=project.id,
        workspace_id=project.workspace_id,
        name=project.name,
        # Resolved here, not on the wire as NULL: `shares.project_artifact_limit`
        # is the one function that knows what an unset column means, and a client
        # reimplementing it would be a second copy of the default to drift from.
        max_artifacts=shares_repo.project_artifact_limit(project),
        created_at=project.created_at or now,
        updated_at=project.updated_at or now,
    )


def _to_workspace(workspace: WorkspaceRow) -> WorkspaceResource:
    return WorkspaceResource(
        id=workspace.id,
        kind=WorkspaceKind(workspace.kind),
        name=workspace.name,
        owner_user_id=workspace.owner_user_id,
        plan=workspace.plan or "free",
        auto_keep_artifacts=bool(workspace.auto_keep_artifacts),
        created_at=workspace.created_at,
        deleted_at=workspace.deleted_at,
    )


def _to_summary(
    workspace: WorkspaceRow,
    membership: Membership,
    *,
    user_id: uuid.UUID,
    active_workspace_id: uuid.UUID,
) -> WorkspaceSummary:
    return WorkspaceSummary(
        id=workspace.id,
        kind=WorkspaceKind(workspace.kind),
        name=workspace.name,
        role=Role(membership.role),
        is_personal=(
            workspace.kind == WorkspaceKind.PERSONAL and workspace.owner_user_id == user_id
        ),
        is_active=workspace.id == active_workspace_id,
    )


@router.get("/workspaces", response_model=list[WorkspaceSummary])
async def list_workspaces(
    identity: CurrentIdentity, scope: CurrentScope, session: DbSession
) -> list[WorkspaceSummary]:
    """Every workspace the caller can act in — the switcher's data.

    `scope` is a dependency rather than `identity.active_workspace_id` on
    purpose: it is the resolved answer, so a pointer at a workspace the caller
    was removed from shows the personal workspace as active, which is where the
    next request will actually land.
    """
    user, _personal = identity
    rows = await system.list_user_workspaces(session, user_id=user.id)
    return [
        _to_summary(
            workspace,
            membership,
            user_id=user.id,
            active_workspace_id=scope.workspace_id,
        )
        for workspace, membership in rows
    ]


@router.post("/workspaces/active", response_model=WorkspaceSummary)
async def switch_active_workspace(
    body: SwitchWorkspaceRequest,
    identity: CurrentIdentity,
    session: DbSession,
) -> WorkspaceSummary:
    """Change which workspace subsequent requests act in.

    Takes no `CurrentScope`: the scope of the request that performs a switch is
    the one being left, and depending on it would only add a lookup nobody reads.
    A workspace the caller has no membership in is 404 — the same answer as one
    that does not exist, because telling them apart would confirm the existence
    of another tenant's workspace to a stranger holding its id.
    """
    user, _personal = identity
    switched = await system.set_active_workspace(session, user=user, workspace_id=body.workspace_id)
    if switched is None:
        raise HTTPException(404, "workspace not found")
    workspace, membership = switched
    return _to_summary(
        workspace,
        membership,
        user_id=user.id,
        active_workspace_id=workspace.id,
    )


@router.get("/workspaces/invitations", response_model=list[WorkspaceInvitation])
async def list_invitations(
    identity: CurrentIdentity, session: DbSession
) -> list[WorkspaceInvitation]:
    """Workspaces the caller was added to and has not been told about (0038).

    The whole reason this route exists: an invite grants access silently, so
    before it, a collaborator had no way to learn they had one except to be told
    out of band. Read on every authenticated page load and empty almost always.

    Takes no `CurrentScope` — an invitation is about a workspace the caller has
    never been scoped into, which is what makes it worth announcing.
    """
    user, _personal = identity
    rows = await system.list_unacknowledged_memberships(session, user_id=user.id)
    now = dt.datetime.now(dt.timezone.utc)
    return [
        WorkspaceInvitation(
            workspace_id=workspace.id,
            workspace_name=workspace.name,
            role=Role(membership.role),
            invited_by_email=inviter.email if inviter is not None else None,
            invited_by_name=inviter.display_name if inviter is not None else None,
            created_at=membership.created_at or now,
        )
        for workspace, membership, inviter in rows
    ]


@router.post("/workspaces/acknowledge", status_code=204)
async def acknowledge_invitation(
    body: WorkspaceRefRequest,
    identity: CurrentIdentity,
    session: DbSession,
) -> None:
    """Stop announcing a workspace without entering it — the notice's "not now".

    Carries the workspace in the BODY rather than the path for the same reason
    the switch does: `test_no_route_accepts_a_caller_supplied_scope` sweeps
    handler signatures for a `workspace_id` argument, because one would be a
    second way to choose the tenant a handler reads. This one selects nothing —
    it names a membership of the caller's own, validated against `memberships`,
    and a workspace they are not in is a 404.
    """
    user, _personal = identity
    if not await system.acknowledge_membership(session, user=user, workspace_id=body.workspace_id):
        raise HTTPException(404, "workspace not found")


@router.post("/workspaces/leave", status_code=204)
async def leave_workspace(
    body: WorkspaceRefRequest,
    identity: CurrentIdentity,
    session: DbSession,
) -> None:
    """Give up your own access to a workspace somebody else runs.

    Not `DELETE /workspace/members/{me}`: that route is admin-only and scoped to
    the workspace already open, so declining an invitation would have meant
    switching into the tenant you want out of, and being an admin of it. This
    one is the member's own decision about a workspace named by id.

    The owner is refused with 409 rather than 403: it is not that they lack
    authority, it is that there would be nobody left to run the workspace.
    """
    user, _personal = identity
    try:
        left = await system.leave_workspace(session, user=user, workspace_id=body.workspace_id)
    except system.CannotLeaveOwnedWorkspace:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "You own this workspace, so you cannot leave it. "
                    "Remove the other members instead."
                ),
                "reason": "owner_cannot_leave",
            },
        ) from None
    if not left:
        raise HTTPException(404, "workspace not found")


@router.post("/workspaces/delete", status_code=204)
async def delete_workspace(
    body: WorkspaceRefRequest,
    identity: CurrentIdentity,
    session: DbSession,
) -> None:
    """Retire a shared workspace you own.

    Named in the body like leave and acknowledge, and for the same reason: the
    workspace being deleted is usually not the one the caller is standing in, and
    making them switch into a tenant in order to destroy it would bounce them out
    of it halfway through the request that did it.

    Not a member of it at all is 404 — the same answer as a workspace that does
    not exist, so an id alone tells a stranger nothing. A member who is not the
    owner is 403: they can see it, they simply may not do this.
    """
    user, _personal = identity
    try:
        deleted = await system.delete_workspace(session, user=user, workspace_id=body.workspace_id)
    except system.NotWorkspaceOwner:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "Only the owner can delete a workspace.",
                "reason": "not_workspace_owner",
            },
        ) from None
    except system.CannotDeletePersonalWorkspace:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "Your personal workspace cannot be deleted — it is where "
                    "your account falls back to."
                ),
                "reason": "personal_workspace",
            },
        ) from None
    if not deleted:
        raise HTTPException(404, "workspace not found")


@router.post("/workspace/transfer-ownership", response_model=list[WorkspaceMember])
async def transfer_ownership(
    body: TransferOwnershipRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> list[WorkspaceMember]:
    """Hand this workspace to one of its existing members. Owner only.

    Scoped, unlike delete: the members list this chooses from is the open
    workspace's, so the operation is already standing in the right tenant, and
    the response is that same list with two roles changed.

    The recipient's `owned_workspaces` allowance is checked against *their* tier,
    not the caller's — the workspace is about to become theirs. See the repo
    function for why an operation that creates no workspace enforces a cap on
    how many exist.
    """
    # A user id that is not a member of this workspace raises NotFoundError,
    # which the app turns into a 404 — the same answer as an id that does not
    # exist, so this cannot be used to probe for accounts.
    _membership, target = await workspaces_repo.member_with_user(
        scope, session, user_id=body.user_id
    )
    limits = limits_for(tier_of(target, settings))
    try:
        members = await workspaces_repo.transfer_ownership(
            scope,
            session,
            user_id=body.user_id,
            owned_workspace_limit=limits.owned_workspaces,
        )
    except workspaces_repo.AlreadyTheOwner:
        raise HTTPException(
            status_code=409,
            detail={"error": "You already own this workspace.", "reason": "already_owner"},
        ) from None
    except workspaces_repo.CannotTransferPersonalWorkspace:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    "A personal workspace belongs to its account and cannot be "
                    "handed over. Create a shared workspace to collaborate."
                ),
                "reason": "personal_workspace",
            },
        ) from None
    except system.WorkspaceLimitReached as reached:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    f"That person's plan includes {reached.limit} workspaces and "
                    f"all {reached.limit} are in use, so they cannot take on "
                    "another one."
                ),
                "reason": "recipient_workspace_allowance_exhausted",
                "used": reached.owned,
                "limit": reached.limit,
            },
        ) from None
    return [_to_member(membership, user) for membership, user in members]


@router.post("/workspaces", response_model=WorkspaceSummary, status_code=201)
async def create_workspace(
    body: CreateWorkspaceRequest,
    identity: CurrentIdentity,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> WorkspaceSummary:
    """Create a shared workspace, owned by the caller.

    Does not switch to it. `get_scope` reads one pointer and exactly one route
    writes it; a client that wants to land in the new workspace calls
    `POST /v1/workspaces/active` next, and pays one round trip for a property
    worth more than the round trip.

    The tier's `owned_workspaces` limit is enforced here and is not a product
    feature gate. The Vault artifact cap is per workspace because it bounds one
    tenant's disk — so an account that can mint tenants without bound has no
    artifact cap at all.
    """
    user, _personal = identity
    limits = limits_for(tier_of(user, settings))
    try:
        workspace, membership = await system.create_team_workspace(
            session,
            owner=user,
            name=body.name,
            owned_workspace_limit=limits.owned_workspaces,
        )
    except system.WorkspaceLimitReached as reached:
        raise HTTPException(
            status_code=409,
            detail={
                "error": (
                    f"Your plan includes {reached.limit} workspaces and all "
                    f"{reached.limit} are in use. Rename or reuse one you already have."
                ),
                "reason": "workspace_allowance_exhausted",
                "used": reached.owned,
                "limit": reached.limit,
            },
        ) from None
    return _to_summary(
        workspace,
        membership,
        user_id=user.id,
        # Creating a workspace does not enter it, so it is never the active one
        # at this point. Saying otherwise would make the switcher show the user
        # somewhere they are not.
        active_workspace_id=user.active_workspace_id or _personal.id,
    )


@router.post("/workspace/members", response_model=WorkspaceMember, status_code=201)
async def invite_member(
    body: InviteMemberRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceMember:
    """Attach an existing account to this workspace by email address.

    The invitee must have signed in to this deployment at least once: an account
    is provisioned from a verified WorkOS token, and inviting an address that has
    never presented one would create a membership pointing at a user row this
    service invented. So an unknown address is a 404 on `user`, and the UI says
    what to do about it.

    Read the room this opens. A member sees every run and every Vault artifact in
    the workspace, including work saved before they arrived — that is what a
    shared tenant means, and it is why this is admin-only.
    """
    membership, user = await workspaces_repo.add_member_by_email(
        scope, session, email=body.email, role=body.role
    )
    return _to_member(membership, user)


@router.patch("/workspace/members/{user_id}", response_model=WorkspaceMember)
async def update_member_role(
    user_id: uuid.UUID,
    body: MemberRoleRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceMember:
    membership, user = await workspaces_repo.set_member_role(
        scope, session, user_id=user_id, role=body.role
    )
    return _to_member(membership, user)


@router.delete("/workspace/members/{user_id}", status_code=204)
async def remove_member(
    user_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> None:
    """Revoke access. Their runs and artifacts stay — they are the workspace's."""
    await workspaces_repo.remove_member(scope, session, user_id=user_id)


@router.get("/workspace", response_model=WorkspaceOverview)
async def get_workspace(scope: CurrentScope, session: DbSession) -> WorkspaceOverview:
    workspace, members, artifact_count, run_count = await workspaces_repo.get_overview(
        scope, session
    )
    return WorkspaceOverview(
        workspace=_to_workspace(workspace),
        members=[_to_member(membership, user) for membership, user in members],
        artifact_count=artifact_count,
        run_count=run_count,
    )


@router.patch("/workspace/settings", response_model=WorkspaceResource)
async def update_workspace_settings(
    body: WorkspaceSettingsRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceResource:
    """Change workspace-level preferences.

    Only `auto_keep_artifacts` today. It is read at save time, so flipping it
    never reaches backwards: turning it on does not file runs already finished,
    and turning it off does not remove anything already kept.
    """
    workspace = await workspaces_repo.set_auto_keep_artifacts(
        scope, session, enabled=body.auto_keep_artifacts
    )
    return _to_workspace(workspace)


@router.get("/workspace/folders", response_model=list[WorkspaceFolderResource])
async def list_workspace_folders(
    scope: CurrentScope, session: DbSession
) -> list[WorkspaceFolderResource]:
    """Folders in the user's chosen order.

    The order is carried by the ARRAY, not by a field. `workspace_folders.position`
    (migration 0040) deliberately stays server-side: putting it on the wire would
    add a field to a shared contract model — a CONTRACTS_VERSION bump and a
    regenerated openapi.json — to tell the client something a JSON array already
    says. Clients must preserve the order they receive rather than re-sorting.
    """
    folders = await folders_repo.list_folders(scope, session)
    return [_to_folder(folder) for folder in folders]


@router.post("/workspace/folders", response_model=WorkspaceFolderResource, status_code=201)
async def create_workspace_folder(
    body: CreateFolderRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceFolderResource:
    folder = await folders_repo.create_folder(scope, session, name=body.name)
    return _to_folder(folder)


@router.patch("/workspace/folders/order", response_model=list[WorkspaceFolderResource])
async def reorder_workspace_folders(
    body: ReorderFoldersRequest,
    scope: CurrentScope,
    session: DbSession,
) -> list[WorkspaceFolderResource]:
    """Set the whole workspace's folder order from the list the client holds.

    Declared BEFORE `/workspace/folders/{folder_id}` on purpose: FastAPI matches
    routes in declaration order, so the parameterised route would otherwise
    swallow `/order` and try to parse it as a UUID.
    """
    try:
        folders = await folders_repo.reorder_folders(scope, session, list(body.order))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [_to_folder(folder) for folder in folders]


@router.patch("/workspace/folders/{folder_id}", response_model=WorkspaceFolderResource)
async def rename_workspace_folder(
    folder_id: uuid.UUID,
    body: CreateFolderRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceFolderResource:
    try:
        folder = await folders_repo.rename_folder(scope, session, folder_id, name=body.name)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_folder(folder)


@router.delete("/workspace/folders/{folder_id}", status_code=204)
async def delete_workspace_folder(
    folder_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> Response:
    """Delete the folder. The runs inside it survive, unfiled."""
    await folders_repo.delete_folder(scope, session, folder_id)
    return Response(status_code=204)


@router.get("/workspace/projects", response_model=list[ProjectResource])
async def list_workspace_projects(scope: CurrentScope, session: DbSession) -> list[ProjectResource]:
    """Studio's projects in the user's chosen order.

    As with folders, the order is carried by the ARRAY and `projects.position`
    stays server-side. Clients must preserve the order they receive rather than
    re-sorting — the web's `loadChatFolders` once re-sorted by `createdAt` and
    made every drag appear to work and then revert.
    """
    return [_to_project(project) for project in await projects_repo.list_projects(scope, session)]


@router.post("/workspace/projects", response_model=ProjectResource, status_code=201)
async def create_workspace_project(
    body: CreateProjectRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ProjectResource:
    try:
        project = await projects_repo.create_project(scope, session, name=body.name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _to_project(project)


@router.patch("/workspace/projects/order", response_model=list[ProjectResource])
async def reorder_workspace_projects(
    body: ReorderProjectsRequest,
    scope: CurrentScope,
    session: DbSession,
) -> list[ProjectResource]:
    """Set the whole workspace's project order from the list the client holds.

    Declared BEFORE `/workspace/projects/{project_id}` on purpose: FastAPI
    matches routes in declaration order, so the parameterised route would
    otherwise swallow `/order` and try to parse it as a UUID.
    """
    try:
        projects = await projects_repo.reorder_projects(scope, session, list(body.order))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [_to_project(project) for project in projects]


class UpdateProjectRequest(BaseModel):
    """A partial update. Omitted means unchanged; there is no way to send NULL.

    `max_artifacts` is deliberately not resettable to the platform default. The
    column's NULL means "whatever the default is today", and an owner who has
    chosen 10 must not have that choice re-floated by a later change to the
    default — so the API can move the number but not un-choose it.
    """

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=80)
    max_artifacts: int | None = Field(
        default=None, ge=0, le=projects_repo.MAX_PROJECT_ARTIFACT_LIMIT
    )

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("project name cannot be blank")
        return value


@router.patch("/workspace/projects/{project_id}", response_model=ProjectResource)
async def update_workspace_project(
    project_id: uuid.UUID,
    body: UpdateProjectRequest,
    scope: CurrentScope,
    session: DbSession,
) -> ProjectResource:
    """Rename the project, change what a share grantee may grow it to, or both.

    Still accepts the rename-only body every existing client sends — `name` was
    required before and is now optional, which is the widening direction, so a web
    deploy that lands before this one keeps working.
    """
    if body.name is None and body.max_artifacts is None:
        raise HTTPException(status_code=422, detail="nothing to update")
    try:
        project = await projects_repo.get_project(scope, session, project_id)
        if body.name is not None:
            project = await projects_repo.rename_project(scope, session, project_id, name=body.name)
        if body.max_artifacts is not None:
            project = await projects_repo.set_project_artifact_limit(
                scope, session, project_id, max_artifacts=body.max_artifacts
            )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _to_project(project)


@router.delete("/workspace/projects/{project_id}", status_code=204)
async def delete_workspace_project(
    project_id: uuid.UUID,
    scope: CurrentScope,
    session: DbSession,
) -> Response:
    """Delete the project. The artifacts inside it survive, ungrouped.

    The grants go too — `project_shares.project_id` CASCADEs (migration 0042) —
    and that is worth a line in the audit log, because a cascade writes no
    history and "a project was deleted" is a different sentence from "four people
    outside this workspace lost access to it". The count is read BEFORE the
    delete for the obvious reason.

    Counted rather than listed: `count_shares` needs only the write role that
    deleting a project already needs, whereas naming the grantees is
    `list_shares` and admin-only. A member deleting their own project should be
    able to have the fact recorded without being able to read the guest list.
    """
    share_count = await shares_repo.count_shares(scope, session, project_id)
    await projects_repo.delete_project(scope, session, project_id)
    if share_count:
        await audit_repo.record_audit(
            scope,
            session,
            action="project_share.revoked_by_project_delete",
            target_kind="project",
            target_id=project_id,
            meta={"count": share_count},
        )
    return Response(status_code=204)
