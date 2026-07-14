"""GET /v1/me — the auth round-trip: verified identity + derived scope."""

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class UpdateMeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_name: str | None = Field(default=None, max_length=120)

    @field_validator("display_name")
    @classmethod
    def normalize_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = " ".join(value.strip().split())
        return normalized or None


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


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    scope: CurrentScope,
    session: DbSession,
) -> MeResponse:
    user = await workspaces_repo.update_display_name(
        scope,
        session,
        display_name=body.display_name,
    )
    workspace = await workspaces_repo.get_workspace(scope, session)
    return MeResponse(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        workspace_id=str(scope.workspace_id),
        workspace_name=workspace.name,
        role=str(scope.role),
    )
