"""Request-scoped identity — the ONLY place a Scope is constructed for handlers.

Flow per request: Bearer token → JWKS verify → user lookup (provision on first
login) → membership row → Scope(user, workspace, role). A workspace the caller
has no membership in yields 401/404 — indistinguishable from absence.

**Three credentials reach this module, not one.** The WorkOS session JWT is the
browser's; the deploy probe token is the post-deploy smoke test's, bound to three
routes; and, since proposal 7 Phase B (owner ruling ai-ops 362), a personal access
token is an outside tool's, bound to one workspace and to the routes
`auth/token_access.py` allows. Each is recognised BEFORE the WorkOS verify, because
neither of the other two is a JWT and both would only fail there.
"""

import uuid
from dataclasses import dataclass
from hmac import compare_digest
from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import TOKEN_PREFIX

from ..db import AsyncSession
from ..orm import User, Workspace
from ..repos import personal_access_tokens as tokens_repo
from ..repos import set_rls_context, system
from ..settings import Settings
from . import token_access
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


#: Where the resolved personal access token is parked for the rest of the request.
#: On `request.state` rather than threaded through `VerifiedToken` because the one
#: dependency that needs it — `get_scope`, for the workspace the token is bound to —
#: sits on the other side of `get_identity`, which has no business knowing which
#: credential it was handed.
PAT_STATE_ATTR = "personal_access_token"


@dataclass(frozen=True)
class PresentedToken:
    """What a resolved personal access token contributes to the rest of the request.

    Plain values, not the ORM row. The row belongs to the short-lived session the
    lookup opened; parking it here would hand every later dependency a detached
    instance that raises on first attribute access, somewhere that looks nothing like
    an auth problem. Nothing here is a secret — the id is a uuid and the scopes are
    two words — so this object is safe anywhere the request is.
    """

    id: uuid.UUID
    user_id: uuid.UUID
    workspace_id: uuid.UUID
    scopes: frozenset[str]


def auth_session_factory(request: Request):
    """The session factory the personal-access-token lookup uses.

    Deliberately NOT a `Depends(get_session)` on `get_verified_token`. Declaring one
    there opens a database session for EVERY request, including ones carrying no
    credential at all — measured, not theorised: against an app with no database, a
    request missing its bearer token went from 401 to 500, and in production a
    database blip would do the same to every unauthenticated refusal. Auth has to be
    able to say "no" without the database being up.

    So the lookup happens inside the one branch that needs it, and this is the seam a
    test overrides (`app.state.auth_session_factory`) to point it at an open
    transaction instead.
    """
    override = getattr(request.app.state, "auth_session_factory", None)
    return override if override is not None else request.app.state.session_factory


def presented_token(request: Request) -> PresentedToken | None:
    """The personal access token this request presented, if it presented one."""
    return getattr(request.state, PAT_STATE_ATTR, None)


def _pat_route_refusal(request: Request, scopes) -> token_access.Refusal | None:
    route = request.scope.get("route")
    template = getattr(route, "path", None)
    if template is None:
        # No route resolved: a 404 path, or a FastAPI whose scope no longer carries
        # one. Refuse rather than guess — see `token_access`'s module docstring on
        # which direction "we could not tell" has to fail in.
        return token_access.Refusal(
            token_access.FORBIDDEN_ROUTE,
            "personal access tokens cannot reach this route",
        )
    return token_access.check(
        request.method,
        template,
        request.scope.get("path", ""),
        frozenset(scopes),
    )


def _meter_token(request: Request, token_id: uuid.UUID) -> None:
    """Count one request against this token's own per-minute ceiling.

    Keyed on the token's **id**, never on the secret: a limiter key is a dictionary
    key that can end up in a log line or a warning, and the id is already in the
    database. Per token rather than per account, so one runaway script cannot lock
    its owner out of their other automations, and separate from the anonymous and
    trusted limiters because its subject is a credential rather than an address.
    """
    limiter = getattr(request.app.state, "token_limiter", None)
    if limiter is None:  # not configured (a test app built without it)
        return
    decision = limiter.check(str(token_id))
    if not decision.allowed:
        raise HTTPException(
            429,
            detail={
                "error": "This access token is making requests too quickly. "
                "Wait a moment and try again.",
                "reason": "token_rate_limited",
            },
            headers={"Retry-After": str(decision.retry_after_s)},
        )


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

    # Personal access token (proposal 7 Phase B, owner ruling ai-ops 362). Checked
    # BEFORE the WorkOS verify for the same reason the probe is: it is not a JWT.
    #
    # The order inside this branch matters. The token is resolved FIRST, and only a
    # live token reaches the route check — so a caller holding no valid token learns
    # nothing about which routes tokens may reach, and one holding a valid token gets
    # a refusal that says what to do about it. Resolution answers 401 identically for
    # "no such token", "revoked" and "expired" (see `resolve_presented`).
    if presented.startswith(TOKEN_PREFIX):
        # Refused before any lookup while the feature is off. The switch is checked
        # HERE, at the one place a token can enter the system, rather than only on the
        # routes that mint one: a token minted while it was on must stop working the
        # moment it is turned off, which is what makes the switch a kill switch and
        # not merely a hide-the-button. It also costs no database round trip, which
        # matters because it runs before one is opened.
        if not settings.personal_access_tokens_enabled:
            raise HTTPException(401, "invalid token", headers=challenge)
        async with auth_session_factory(request)() as lookup:
            row = await tokens_repo.resolve_presented(lookup, presented)
            if row is None:
                raise HTTPException(401, "invalid token", headers=challenge)
            refusal = _pat_route_refusal(request, row.scopes)
            if refusal is not None:
                raise HTTPException(403, detail={"error": refusal.detail, "reason": refusal.reason})
            _meter_token(request, row.id)
            user = await lookup.get(User, row.user_id)
            if user is None:  # the FK makes this unreachable; fail closed regardless
                raise HTTPException(401, "invalid token", headers=challenge)
            # Plain values, read before the session closes. A detached ORM row on
            # `request.state` would raise on first attribute access somewhere much
            # later, in a handler, as something that looks nothing like an auth bug.
            resolved = PresentedToken(
                id=row.id,
                user_id=row.user_id,
                workspace_id=row.workspace_id,
                scopes=frozenset(row.scopes),
            )
            identity = (user.workos_user_id, user.email, user.display_name)
            await lookup.commit()
        setattr(request.state, PAT_STATE_ATTR, resolved)
        workos_user_id, email, display_name = identity
        return VerifiedToken(
            workos_user_id=workos_user_id,
            session_id=f"pat:{resolved.id}",
            claims={"email": email, "name": display_name},
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


async def _token_scope(session: AsyncSession, *, user: User, row: PresentedToken) -> Scope:
    """The scope a personal access token acts in: the workspace it was MINTED in.

    Not `users.active_workspace_id`. A token's tenant is fixed at mint and never
    re-read, so an automation's reach cannot change because its owner clicked a
    workspace switcher on the website hours later.

    The membership is still read on every request, exactly as
    `resolve_active_workspace` reads it, so removing someone from a workspace takes
    effect on their automations' next request too.

    **Where this deliberately differs from the browser path: it refuses instead of
    falling back.** `resolve_active_workspace` answers a stale pointer by dropping to
    the caller's personal workspace, because locking a person out of their own account
    would be worse than the alternative. Here the alternative is worse: a token that
    quietly moved to a different tenant would keep working while writing a script's
    runs, notebooks and comments into a workspace nobody pointed it at. So a token
    whose workspace it no longer belongs to — or which has been deleted — is 404, the
    same answer any absent workspace gives, and the person mints a new token.
    """
    membership = await system.find_membership(
        session, workspace_id=row.workspace_id, user_id=user.id
    )
    if membership is None:
        raise HTTPException(404, "workspace not found")
    if await system.find_live_workspace(session, workspace_id=row.workspace_id) is None:
        raise HTTPException(404, "workspace not found")
    return Scope(user_id=user.id, workspace_id=row.workspace_id, role=Role(membership.role))


async def get_presented_token(
    request: Request,
    _identity: Annotated[tuple[User, Workspace], Depends(get_identity)],
) -> PresentedToken | None:
    """The personal access token this request presented, or `None` for a browser.

    Depends on `get_identity` for ORDERING, not for its value: `request.state` is
    written by `get_verified_token`, which `get_identity` resolves first, and FastAPI
    resolves a dependency's parameters in declaration order. Read as a bare `Request`
    parameter of `get_scope` instead, this could be resolved BEFORE the credential had
    been verified and would answer `None` for a perfectly valid token — a browser's
    scope for an automation's request, which is exactly the bug class `get_scope`'s
    "no request input" rule exists to prevent.
    """
    return presented_token(request)


async def get_scope(
    identity: Annotated[tuple[User, Workspace], Depends(get_identity)],
    session: Annotated[AsyncSession, Depends(get_session, scope="function")],
    settings: Annotated[Settings, Depends(get_settings)],
    token: Annotated[PresentedToken | None, Depends(get_presented_token, scope="function")] = None,
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
    if token is not None:
        scope = await _token_scope(session, user=user, row=token)
    else:
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
#: `None` for a browser session, the resolved token for a personal-access-token
#: request. A handler takes this only when it needs to tell the two apart in what it
#: WRITES — `token_access.check` has already decided, before the handler runs at all,
#: whether this request may proceed, so no handler needs this dependency to enforce a
#: scope. `routes/qpu.py::qpu_submit` is the first caller (ai-ops 376): a
#: token-initiated hardware submission records the token's id on the audit trail, the
#: one thing a browser-authenticated row and a token-authenticated row would
#: otherwise not let a reader tell apart.
CurrentPresentedToken = Annotated[
    PresentedToken | None, Depends(get_presented_token, scope="function")
]
__all__ = ["CurrentIdentity", "CurrentPresentedToken", "CurrentScope", "DbSession"]
