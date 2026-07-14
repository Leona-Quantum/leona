"""Workspace settings and collaboration endpoints."""

import datetime as dt

from fastapi import APIRouter
from majorana_contracts import Workspace as WorkspaceResource
from majorana_contracts import WorkspaceFolder as WorkspaceFolderResource
from majorana_contracts import WorkspaceMember, WorkspaceOverview
from majorana_contracts.enums import Role, WorkspaceKind
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth.deps import CurrentScope, DbSession
from ..orm import Membership, User, WorkspaceFolder
from ..repos import folders as folders_repo
from ..repos import workspaces as workspaces_repo

router = APIRouter()


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


@router.get("/workspace", response_model=WorkspaceOverview)
async def get_workspace(scope: CurrentScope, session: DbSession) -> WorkspaceOverview:
    workspace, members, artifact_count, run_count = await workspaces_repo.get_overview(
        scope, session
    )
    return WorkspaceOverview(
        workspace=WorkspaceResource(
            id=workspace.id,
            kind=WorkspaceKind(workspace.kind),
            name=workspace.name,
            owner_user_id=workspace.owner_user_id,
            plan=workspace.plan or "free",
            created_at=workspace.created_at,
            deleted_at=workspace.deleted_at,
        ),
        members=[_to_member(membership, user) for membership, user in members],
        artifact_count=artifact_count,
        run_count=run_count,
    )


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
