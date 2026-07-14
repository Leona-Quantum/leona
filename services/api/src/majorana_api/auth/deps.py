"""Request-scoped identity — the ONLY place a Scope is constructed for handlers.

Flow per request: Bearer token → JWKS verify → user lookup (provision on first
login) → membership row → Scope(user, workspace, role). A workspace the caller
has no membership in yields 401/404 — indistinguishable from absence.
"""

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from majorana_contracts import Scope

from ..db import AsyncSession
from ..orm import User, Workspace
from ..repos import system
from ..settings import Settings
from .jwt import TokenError, VerifiedToken, verify_bearer_token


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request):
    async with request.app.state.session_factory() as session:
        yield session
        await session.commit()


async def get_verified_token(
    settings: Annotated[Settings, Depends(get_settings)],
    authorization: Annotated[str | None, Header()] = None,
) -> VerifiedToken:
    challenge = {"WWW-Authenticate": "Bearer"}

    if settings.local_dev_auth:
        if authorization != f"Bearer {settings.local_dev_token}":
            raise HTTPException(401, "invalid local development token", headers=challenge)
        return VerifiedToken(
            workos_user_id=settings.local_dev_user_id,
            session_id="local-dev-session",
            claims={
                "email": settings.local_dev_email,
                "name": settings.local_dev_display_name,
            },
        )

    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(401, "missing bearer token", headers=challenge)
    try:
        return await verify_bearer_token(
            authorization.removeprefix("Bearer "),
            jwks_url=settings.workos_jwks_url,
            issuer=settings.workos_jwt_issuer,
        )
    except TokenError:
        raise HTTPException(401, "invalid token", headers=challenge) from None


async def get_identity(
    token: Annotated[VerifiedToken, Depends(get_verified_token)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> tuple[User, Workspace]:
    """User + personal workspace; provisions both on first login.

    Requires an email claim — AuthKit doesn't include it by default, so the
    WorkOS JWT template must add it (docs/runbooks/auth-dev.md). Failing closed
    beats persisting a placeholder identity.
    """
    email = token.claims.get("email")
    if not email:
        raise HTTPException(
            403, "access token lacks email claim; configure the WorkOS JWT template"
        )
    return await system.get_or_provision_user(
        session,
        workos_user_id=token.workos_user_id,
        email=email,
        display_name=token.claims.get("name"),
    )


async def get_scope(
    identity: Annotated[tuple[User, Workspace], Depends(get_identity)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Scope:
    """Derive a private personal-workspace scope for the authenticated user.

    Collaboration is intentionally deferred. Do not accept a browser-selected
    workspace id here: the personal workspace is the only tenant exposed by
    the current product contract.
    """
    user, personal_ws = identity
    membership = await system.find_membership(
        session,
        workspace_id=personal_ws.id,
        user_id=user.id,
    )
    if membership is None:
        raise HTTPException(404, "workspace not found")
    return Scope(user_id=user.id, workspace_id=personal_ws.id, role=membership.role)


CurrentScope = Annotated[Scope, Depends(get_scope)]
CurrentIdentity = Annotated[tuple[User, Workspace], Depends(get_identity)]
DbSession = Annotated[AsyncSession, Depends(get_session)]
__all__ = ["CurrentIdentity", "CurrentScope", "DbSession"]
