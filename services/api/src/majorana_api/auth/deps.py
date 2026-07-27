"""Request-scoped identity — the ONLY place a Scope is constructed for handlers.

Flow per request: Bearer token → JWKS verify → user lookup (provision on first
login) → membership row → Scope(user, workspace, role). A workspace the caller
has no membership in yields 401/404 — indistinguishable from absence.
"""

from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from majorana_contracts import Scope

from ..db import AsyncSession
from ..orm import User, Workspace
from ..repos import system
from ..settings import Settings
from .jwt import TokenError, VerifiedToken, verify_bearer_token

#: The only (method, route) pairs the post-deploy probe credential may reach:
#: submit one run, then watch that run finish. Everything else — listing runs,
#: cancelling, reading a conversation, and every artifact, workspace, billing and
#: QPU route — refuses it.
#:
#: Matched against the *route template* resolved by the router, never against the
#: raw request path. A raw-path match has to reason about trailing slashes,
#: percent-encoding and `..` segments; the template is what FastAPI actually
#: decided to run, so "which handler is about to execute" is answered directly.
#:
#: The templates are as the sub-router registered them, without the `/v1` the app
#: mounts them under — that is the value FastAPI puts in `scope["route"]`, and
#: reconstructing the full path from it would be guesswork. The mount point is
#: pinned separately below rather than assumed. If a future FastAPI changes that
#: shape, nothing here matches and the probe is refused everywhere: the deploy
#: gate fails loudly, which is the safe direction, and the enumeration test in
#: tests/test_deploy_probe_credential.py fails in CI first.
DEPLOY_PROBE_ROUTES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/runs"),
        ("GET", "/runs/{run_id}"),
        ("GET", "/runs/{run_id}/events"),
    }
)

#: Every router in app.py is mounted here. Checked so an unprefixed template
#: cannot be reached through some future second mount point.
DEPLOY_PROBE_PREFIX = "/v1/"


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


async def get_session(request: Request):
    async with request.app.state.session_factory() as session:
        yield session
        await session.commit()


def _probe_may_reach(request: Request) -> bool:
    route = request.scope.get("route")
    path = getattr(route, "path", None)
    if path is None:
        return False
    if not request.scope.get("path", "").startswith(DEPLOY_PROBE_PREFIX):
        return False
    return (request.method, path) in DEPLOY_PROBE_ROUTES


async def get_verified_token(
    request: Request,
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
    presented = authorization.removeprefix("Bearer ")

    # Single-operator lock: the API half of the web perimeter. While it is on,
    # the lock token is the ONLY accepted credential — a WorkOS JWT must not
    # also work, or any WorkOS account could walk past the username/password.
    # Settings.__post_init__ has already refused a weak or placeholder token.
    if settings.single_user_lock:
        if not compare_digest(presented, settings.single_user_lock_token):
            raise HTTPException(401, "invalid token", headers=challenge)
        return VerifiedToken(
            workos_user_id=settings.single_user_lock_user_id,
            session_id="single-user-lock-session",
            claims={
                "email": settings.single_user_lock_email,
                "name": settings.single_user_lock_display_name,
            },
        )

    # Post-deploy probe. Checked BEFORE the WorkOS verify because it is not a
    # JWT and would only fail there, and AFTER the lock because while the lock is
    # on nothing but the lock token may pass.
    #
    # The route check is inside this branch on purpose. Refusing the probe on an
    # out-of-scope route must not tell an unrelated caller anything, and the
    # comparison is constant-time either way — an attacker who does not hold the
    # token never reaches the route check at all.
    if settings.deploy_probe_token and compare_digest(presented, settings.deploy_probe_token):
        if not _probe_may_reach(request):
            raise HTTPException(403, "the deploy probe credential cannot reach this route")
        return VerifiedToken(
            workos_user_id=settings.deploy_probe_user_id,
            session_id="deploy-probe-session",
            claims={
                "email": settings.deploy_probe_email,
                "name": settings.deploy_probe_display_name,
            },
        )

    try:
        return await verify_bearer_token(
            presented,
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
    if token.workos_user_id.startswith("system:"):
        raise HTTPException(
            401, "reserved service identity", headers={"WWW-Authenticate": "Bearer"}
        )
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
