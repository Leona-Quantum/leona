"""GET /v1/me — the auth round-trip: verified identity + derived scope."""

from fastapi import APIRouter
from majorana_contracts.enums import WorkspaceKind
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
    #: True when the active workspace is the one this account owns. NOT
    #: `kind == personal`: a guest in someone else's personal workspace reads
    #: kind=personal for a tenant that is not theirs, and the web app keys the
    #: browser's local mirror on this — getting it wrong would show one
    #: workspace's chat titles and Vault inside another.
    is_personal_workspace: bool = True
    workspace_kind: str = "personal"


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


def _me(user, workspace, scope) -> MeResponse:
    return MeResponse(
        user_id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        workspace_id=str(scope.workspace_id),
        workspace_name=workspace.name,
        role=str(scope.role),
        is_personal_workspace=(
            workspace.kind == WorkspaceKind.PERSONAL and workspace.owner_user_id == user.id
        ),
        workspace_kind=str(workspace.kind),
    )


@router.get("/me", response_model=MeResponse)
async def me(identity: CurrentIdentity, scope: CurrentScope, session: DbSession) -> MeResponse:
    user, _ = identity
    workspace = await workspaces_repo.get_workspace(scope, session)
    return _me(user, workspace, scope)


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
    return _me(user, workspace, scope)
