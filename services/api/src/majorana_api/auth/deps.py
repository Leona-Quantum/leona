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
from ..repos import set_rls_context, system
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
    """Yield one transaction-scoped session and release it before responses send.

    A request-scoped yield dependency is kept alive until the response finishes.
    That is correct for ordinary response serialization, but it is unsafe for
    ``StreamingResponse``: an SSE client can keep the response open for an hour
    while the session continues to reserve one pool connection.  Function scope
    is declared at every dependency boundary below so the session is closed as
    soon as the path operation returns, before a streaming body is consumed.
    """
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

    # Post-deploy probe. Checked BEFORE the WorkOS verify because it is not a JWT
    # and would only fail there.
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
            audience=settings.workos_jwt_audience,
        )
    except TokenError:
        raise HTTPException(401, "invalid token", headers=challenge) from None


async def get_identity(
    token: Annotated[VerifiedToken, Depends(get_verified_token)],
    session: Annotated[AsyncSession, Depends(get_session, scope="function")],
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
    session: Annotated[AsyncSession, Depends(get_session, scope="function")],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Scope:
    """Derive the scope for the authenticated user's active workspace.

    Do not accept a workspace id from the request. The active workspace is a
    server-side pointer (`users.active_workspace_id`, migration 0037) that only
    `POST /v1/workspaces/active` writes, and it is re-validated against the
    membership table on every request. A caller cannot widen their own scope by
    editing a header, and a proxy route cannot narrow it by forgetting to
    forward one.

    Absent or stale, the pointer resolves to the personal workspace — the
    pre-collaboration behaviour, unchanged for every account that never switches.

    Also arms the RLS GUCs (`repos.set_rls_context`, ai-ops#143) for whatever
    this scope resolved to — a no-op unless `settings.rls_enforced`, see that
    field's docstring in `settings.py`. This is the ONLY place in the request
    path that does, which is what makes "every route reachable through
    `CurrentScope` is covered" a fact about this one function rather than a
    claim about every route handler. Deliberately after `get_identity` has
    already used this same session: `get_or_provision_user`/
    `resolve_active_workspace` read `users`, `workspaces` and `memberships`,
    none of which carry an RLS policy (they are the identity/bootstrap tables a
    caller must be able to read before a workspace_id is even known — see
    0053's docstring), so the ordering is safe regardless, but stating it here
    means a future policy on one of those tables would have to reckon with
    this comment rather than silently break login.

    The `set_config` call itself lives in `repos/_base.py`, not here:
    `scripts/check_raw_queries.py` only allows raw SQL inside the repository
    layer (+ `db.py`/`orm.py`), and this module is deliberately not in it.
    """
    user, personal_ws = identity
    active = await system.resolve_active_workspace(
        session,
        user=user,
        personal_workspace_id=personal_ws.id,
    )
    if active is None:
        raise HTTPException(404, "workspace not found")
    scope = Scope(user_id=user.id, workspace_id=active.workspace_id, role=active.role)
    await set_rls_context(session, scope, enforce=settings.rls_enforced)
    return scope


CurrentScope = Annotated[Scope, Depends(get_scope, scope="function")]
CurrentIdentity = Annotated[tuple[User, Workspace], Depends(get_identity, scope="function")]
DbSession = Annotated[AsyncSession, Depends(get_session, scope="function")]
__all__ = ["CurrentIdentity", "CurrentScope", "DbSession"]
