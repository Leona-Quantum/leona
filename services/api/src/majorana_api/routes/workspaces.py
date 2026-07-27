"""Workspace settings and collaboration endpoints."""

import datetime as dt
import uuid

from fastapi import APIRouter, HTTPException
from majorana_contracts import Workspace as WorkspaceResource
from majorana_contracts import WorkspaceFolder as WorkspaceFolderResource
from majorana_contracts import WorkspaceMember, WorkspaceOverview, WorkspaceSummary
from majorana_contracts.enums import Role, WorkspaceKind
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession
from ..orm import Membership, User
from ..orm import Workspace as WorkspaceRow
from ..orm import WorkspaceFolder
from ..repos import folders as folders_repo
from ..repos import system
from ..repos import workspaces as workspaces_repo

router = APIRouter()


class WorkspaceSettingsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    auto_keep_artifacts: bool


class SwitchWorkspaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    workspace_id: uuid.UUID


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
