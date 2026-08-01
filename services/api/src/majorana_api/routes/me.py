"""GET /v1/me — the auth round-trip: verified identity + derived scope."""

from typing import Annotated

from fastapi import APIRouter, Depends
from majorana_contracts.enums import WorkspaceKind
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..auth.deps import CurrentIdentity, CurrentScope, DbSession, get_settings
from ..repos import workspaces as workspaces_repo
from ..settings import Settings
from ..tiers import tier_of

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
    #: The tier THIS service resolved, which is the one that enforces.
    #:
    #: The web app resolves a tier of its own from the email allowlists, and
    #: that resolution cannot see `users.plan` — it has no database. So an
    #: account put on the Team plan by its column read as `free` in the browser
    #: and was offered no Share button, while this service would have allowed
    #: the grant. The client is a renderer; the tier is a fact it should be told
    #: rather than guess.
    #:
    #: A plain `str` and not `AccountTier`: `MeResponse` is route-local by
    #: design (it is not in `majorana_contracts` and does not reach
    #: `openapi.json`), and a client that receives a tier it does not recognise
    #: must degrade to its own answer rather than fail to parse the payload.
    tier: str = "free"


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


def _me(user, workspace, scope, settings: Settings) -> MeResponse:
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
        tier=tier_of(user, settings),
    )


@router.get("/me", response_model=MeResponse)
async def me(
    identity: CurrentIdentity,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeResponse:
    user, _ = identity
    workspace = await workspaces_repo.get_workspace(scope, session)
    return _me(user, workspace, scope, settings)


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: UpdateMeRequest,
    scope: CurrentScope,
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> MeResponse:
    user = await workspaces_repo.update_display_name(
        scope,
        session,
        display_name=body.display_name,
    )
    workspace = await workspaces_repo.get_workspace(scope, session)
    return _me(user, workspace, scope, settings)
