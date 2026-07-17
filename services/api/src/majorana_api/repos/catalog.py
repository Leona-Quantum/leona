"""Public catalog boundary; data queries arrive in later repository steps."""

from majorana_contracts import Scope
from majorana_contracts.enums import Role
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..catalog_authority import CatalogAuthority
from ..orm import Membership, Workspace
from ._base import AuthzError, NotFoundError


async def get_catalog_workspace(
    scope: Scope,
    session: AsyncSession,
    *,
    authority: CatalogAuthority,
) -> Workspace:
    """Validate the exact server-owned reader scope and system workspace.

    Requiring both the configured IDs and the persisted viewer membership means
    a caller cannot substitute a personal workspace even if a future route is
    wired incorrectly.
    """
    if not authority.enabled or not authority.is_public_scope(scope):
        raise AuthzError("invalid catalog reader scope")
    stmt = (
        select(Workspace)
        .join(
            Membership,
            (Membership.workspace_id == Workspace.id) & (Membership.user_id == scope.user_id),
        )
        .where(
            Workspace.id == scope.workspace_id,
            Workspace.kind == "system",
            Workspace.deleted_at.is_(None),
            Membership.role == Role.VIEWER,
        )
    )
    workspace = (await session.execute(stmt)).scalars().first()
    if workspace is None:
        raise NotFoundError("catalog workspace")
    return workspace
