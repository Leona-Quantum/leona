"""WorkOS access-token verification via JWKS (RS256, issuer pinned, ±60 s skew).

PyJWKClient caches keys in-process; the blocking fetch is offloaded to a
thread so the event loop never waits on WorkOS.
"""

import dataclasses
from functools import lru_cache

import anyio
import jwt as pyjwt
from jwt import PyJWKClient

LEEWAY_S = 60  # clock skew tolerance (05-security.md §1)


class TokenError(Exception):
    """Verification failed — always maps to 401, never leaks detail to clients."""


@dataclasses.dataclass(frozen=True)
class VerifiedToken:
    workos_user_id: str  # sub
    session_id: str  # sid
    claims: dict


@lru_cache(maxsize=4)
def _jwk_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url, cache_keys=True, lifespan=300)


def _verify(
    token: str, *, jwks_url: str, issuer: str, audience: str | None = None
) -> VerifiedToken:
    """Verify a WorkOS access token. `audience`, when given, is pinned and required.

    ## What was actually missing

    Less than the review that prompted this said, and the difference is worth
    recording. pyjwt verifies `aud` by default, and its rule for `audience=None`
    is to REFUSE any token that carries one — so this service already rejected
    another purpose's audience-bearing token before a line of this existed
    (`tests/test_auth_jwt.py` pins that). The real gap was the token with no
    `aud` at all, and the absence of any positive statement of who tokens are
    for. That is what `audience` closes.

    The boundary still matters: the issuer and JWKS are per-client, so every
    token reaching here was signed for OUR client, and `aud` is the only claim
    separating token *purposes* signed by it. `sub` and `sid` are on an ID token
    too.

    Pinning it unconditionally is the tempting fix and is not available: WorkOS
    AuthKit access tokens are not documented to carry a fixed `aud`, the value
    depends on the JWT template configured for the environment, and requiring a
    claim that production's tokens do not carry refuses every request including
    sign-in. That is the identical total outage `_validate_workos_client_consistency`
    exists to prevent, and it has the same property of looking perfectly healthy
    while nobody can log in.

    So the mechanism is here and fails closed the moment it is configured, and
    the value is an owner action taken against a real token rather than a guess
    made in this file. `WORKOS_JWT_AUDIENCE` unset is the pre-existing behaviour,
    stated rather than implied.

    ## Answered 2026-08-07: production tokens carry no `aud`

    The owner read a real signed-in token and reported no `aud` claim, so
    `WORKOS_JWT_AUDIENCE` **stays unset** and this is now a settled configuration
    rather than an open question. Recorded here rather than only in the runbook,
    because the next person to read this docstring is the one deciding whether to
    set it.

    What that leaves as the boundary: the issuer, the per-client JWKS, and the
    `exp`/`iat`/`sub`/`sid` requirement below. `aud` separates token *purposes*
    within one client, and with no `aud` on any of them that separation is simply
    not available to us — pyjwt's `audience=None` still refuses a token that
    carries one, which is the half that actually protects this service today.

    **The trap this now sets, which is why it is written down.** The correctness
    of leaving it unset is coupled to a WorkOS *dashboard* setting nobody here
    would think to re-check: configure a JWT template that adds an `aud`, and
    `audience=None` starts refusing **every** request — including sign-in — on a
    service that reports itself perfectly healthy. That is the same total outage
    described three paragraphs up, arrived at from the opposite direction. If a
    JWT template is ever added, this variable must be set in the same change.
    `test_audience_unset_still_refuses_a_token_carrying_one` is the test that
    encodes the refusal; it is passing, and it is the behaviour that would bite.
    """
    required = ["exp", "iat", "sub", "sid"]
    if audience is not None:
        # Both halves matter. `audience=` alone rejects a WRONG aud but accepts a
        # token carrying NO aud at all — pyjwt only compares the claim when it is
        # present — so a stripped-claim token would sail through the check that
        # was added to stop it.
        required.append("aud")
    try:
        key = _jwk_client(jwks_url).get_signing_key_from_jwt(token)
        claims = pyjwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            audience=audience,
            leeway=LEEWAY_S,
            options={"require": required},
        )
    except pyjwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    return VerifiedToken(workos_user_id=claims["sub"], session_id=claims["sid"], claims=claims)


async def verify_bearer_token(
    token: str, *, jwks_url: str, issuer: str, audience: str | None = None
) -> VerifiedToken:
    return await anyio.to_thread.run_sync(
        lambda: _verify(token, jwks_url=jwks_url, issuer=issuer, audience=audience)
    )
