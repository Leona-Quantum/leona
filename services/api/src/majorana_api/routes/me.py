"""GET /v1/me — the auth round-trip: verified identity + derived scope."""

from fastapi import APIRouter
from pydantic import BaseModel

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession
from ..repos import workspaces as workspaces_repo

router = APIRouter()


class MeResponse(BaseModel):
    user_id: str
    email: str
    display_name: str | None
    workspace_id: str
    workspace_name: str
    role: str


@router.get("/me", response_model=MeResponse)
async def me(identity: CurrentIdentity, scope: CurrentScope, session: DbSession) -> MeResponse:
    user, _ = identity
    workspace = await workspaces_repo.get_workspace(scope, session)
    return MeResponse(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        workspace_id=str(scope.workspace_id),
        workspace_name=workspace.name,
        role=str(scope.role),
    )
