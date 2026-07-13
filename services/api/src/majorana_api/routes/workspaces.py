"""Workspace settings and collaboration endpoints."""

import datetime as dt

from fastapi import APIRouter
from majorana_contracts import Workspace as WorkspaceResource
from majorana_contracts import WorkspaceMember, WorkspaceOverview
from majorana_contracts.enums import Role, WorkspaceKind
from pydantic import BaseModel, ConfigDict, Field

from ..auth.deps import CurrentScope, DbSession
from ..orm import Membership, User
from ..repos import workspaces as workspaces_repo

router = APIRouter()


class AddMemberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: str = Field(min_length=3, max_length=320)
    role: Role = Role.MEMBER


def _to_member(membership: Membership, user: User) -> WorkspaceMember:
    return WorkspaceMember(
        user_id=user.id,
        email=user.email,
        display_name=user.display_name,
        role=Role(membership.role),
        created_at=membership.created_at or dt.datetime.now(dt.timezone.utc),
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


@router.post("/workspace/members", response_model=WorkspaceMember, status_code=201)
async def add_workspace_member(
    body: AddMemberRequest,
    scope: CurrentScope,
    session: DbSession,
) -> WorkspaceMember:
    membership, user = await workspaces_repo.add_member_by_email(
        scope, session, email=body.email, role=body.role
    )
    return _to_member(membership, user)
