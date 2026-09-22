"""Which routes a personal access token may reach, and on which of its scopes.

The owner's ruling, **ai-ops 362 option 1**, quoted in full because every rule below
is one clause of it:

    "Tokens may read and start verified runs, and expire after at most 90 days;
    hardware jobs come later under their own permission"

and, from the question he was answering, the standing exclusion: a token *"would never
work on the pages that hold their IBM key, billing, or account deletion"*.

## The shape: reads default open, writes default SHUT

A token with `read` may `GET` anything except the few templates named in
`READ_DENIED`. A token may perform a write — `POST`, `PATCH`, `PUT`, `DELETE` — only
if that exact (method, template) pair is named in `READ_WRITES` or `RUN_WRITES`. There
is no third case, and in particular there is no "anything else is probably fine".

That asymmetry is the whole design, and it is the opposite of the rule
`scripts/vercel-ignore-build.sh` uses, deliberately. There, an unrecognised package
must BUILD, because the cost of being wrong is a wasted build. Here, an unrecognised
route must be REFUSED, because the cost of being wrong is a credential reaching
something nobody reviewed. So a route added next month is unreachable by every
existing token until somebody adds it to a list in this file, which is a line a
security review can actually be asked to look at.

`test_token_access.py` holds the other half of that promise: it walks the live
OpenAPI schema and asserts that every write template is either in a list here or
provably refused, so "we forgot" fails in CI rather than in production.

## There is no hardware entry, and that is the ruling

`POST /qpu/submissions` — the route that spends a person's IBM time — appears in no
allowlist, so it is refused by the default-shut rule rather than by a named exception.
`majorana_contracts.tokens.TokenScope` correspondingly has no `hardware` member, so
there is not even a scope a token could be minted with to reach it. "Hardware jobs come
later under their own permission" is therefore enforced twice, in the alphabet of the
scopes and in the absence of a route, and granting it later is a visible widening in
both places.

## Matched on the route TEMPLATE, never the raw path

As `DEPLOY_PROBE_ROUTES` in `deps.py` already argues: a raw-path match has to reason
about trailing slashes, percent-encoding and `..` segments, while the template is what
FastAPI actually decided to run. The templates here are as each sub-router registered
them, without the `/v1` the app mounts them under — that is the value FastAPI puts in
`scope["route"]` — and the mount point is checked separately rather than assumed. If a
future FastAPI changes that shape, nothing matches, and the default-shut rule means
every token is refused everywhere: loud, and in the safe direction.
"""

from __future__ import annotations

from dataclasses import dataclass

from majorana_contracts.tokens import TokenScope

#: Every router in `app.py` is mounted here, checked so an unprefixed template cannot
#: be reached through some future second mount point.
V1_PREFIX = "/v1/"

#: Templates a token may not even READ. Short, and each entry is one clause of what the
#: owner said a token must never reach.
READ_DENIED: frozenset[tuple[str, str]] = frozenset(
    {
        # The IBM key. `GET` returns no key material, but it does answer "does this
        # person have a hardware account, and what did they label it" — which is
        # account-settings information about a credential a token may not use.
        ("GET", "/qpu/credentials"),
        # Billing.
        ("GET", "/billing/status"),
        # A token must not be able to enumerate the account's other tokens: knowing
        # what automations exist, when each was last used and when each expires is
        # reconnaissance for which one to go after, and it is account settings.
        ("GET", "/tokens"),
    }
)

#: Write-shaped requests a `read` token may make. Exactly one, and it earns its place
#: by doing nothing a GET would not: `POST /qpu/estimates` is arithmetic over the rate
#: card in `majorana_qpu` (`routes/qpu.py::qpu_estimate` takes no session), so it
#: touches no database, no provider and no money. It is a POST only because it takes a
#: body. The plan's own pitch for this feature is "an Atlas method, a verified run or
#: an estimate", and an estimate should not need the power to start a run.
READ_WRITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/qpu/estimates"),
    }
)

#: What `run` adds: start a verified run, and stop one you started. Cancelling is here
#: rather than in a scope of its own because a credential that can start work it cannot
#: stop is worse for the account holder, not better.
RUN_WRITES: frozenset[tuple[str, str]] = frozenset(
    {
        ("POST", "/runs"),
        ("POST", "/runs/{run_id}/cancel"),
    }
)

_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


@dataclass(frozen=True)
class Refusal:
    """Why a token was refused, in words the holder of the token can act on."""

    reason: str
    detail: str


#: Refusal reasons are machine-readable so the web app and the MCP client can tell
#: "this token will never work here" from "mint one with more scope", which are
#: different instructions to the person reading the error.
FORBIDDEN_ROUTE = "token_route_forbidden"
INSUFFICIENT_SCOPE = "token_scope_insufficient"


def check(method: str, template: str, path: str, scopes: frozenset[str]) -> Refusal | None:
    """`None` when the token may proceed, otherwise why not.

    `template` is the resolved route template; `path` is the raw request path, used
    only to confirm the mount point. Pure, and takes no request object, so the policy
    can be tested directly against the route table rather than through a client.
    """
    if not path.startswith(V1_PREFIX):
        return Refusal(
            FORBIDDEN_ROUTE,
            "a personal access token can only be used on the versioned API",
        )

    pair = (method.upper(), template)

    if pair in READ_DENIED:
        return Refusal(
            FORBIDDEN_ROUTE,
            "personal access tokens cannot reach your hardware credential, billing, "
            "or your tokens themselves — sign in on the website for those",
        )

    if method.upper() in _READ_METHODS:
        return None

    if pair in READ_WRITES:
        return None

    if pair in RUN_WRITES:
        if TokenScope.RUN not in scopes:
            return Refusal(
                INSUFFICIENT_SCOPE,
                "this token can read but not start runs; mint one with the run scope",
            )
        return None

    return Refusal(
        FORBIDDEN_ROUTE,
        "personal access tokens cannot make this change; sign in on the website",
    )


__all__ = [
    "FORBIDDEN_ROUTE",
    "INSUFFICIENT_SCOPE",
    "READ_DENIED",
    "READ_WRITES",
    "RUN_WRITES",
    "V1_PREFIX",
    "Refusal",
    "check",
]
