"""A least-authority Scope for the anonymous, public-only Qapp projection."""

from typing import Annotated
from uuid import UUID

from fastapi import Depends
from majorana_contracts import Scope
from majorana_contracts.enums import Role

from ..repos import set_rls_context
from ..settings import Settings
from .deps import DbSession, get_settings


async def get_public_qapp_scope(
    session: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> Scope:
    # Nil ids match no provisioned tenant. Repository predicates still require
    # visibility=public, so this scope cannot read a private row. Arm RLS for
    # anonymous requests too: without this call the tenant policy's rollout
    # fallback treats an unset enforcement GUC as unrestricted.
    scope = Scope(user_id=UUID(int=0), workspace_id=UUID(int=0), role=Role.VIEWER)
    await set_rls_context(session, scope, enforce=settings.rls_enforced)
    return scope


PublicQappScope = Annotated[Scope, Depends(get_public_qapp_scope)]
