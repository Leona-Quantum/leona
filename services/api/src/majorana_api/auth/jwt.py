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


def _verify(token: str, *, jwks_url: str, issuer: str) -> VerifiedToken:
    try:
        key = _jwk_client(jwks_url).get_signing_key_from_jwt(token)
        claims = pyjwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            leeway=LEEWAY_S,
            options={"require": ["exp", "iat", "sub", "sid"]},
        )
    except pyjwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    return VerifiedToken(workos_user_id=claims["sub"], session_id=claims["sid"], claims=claims)


async def verify_bearer_token(token: str, *, jwks_url: str, issuer: str) -> VerifiedToken:
    return await anyio.to_thread.run_sync(lambda: _verify(token, jwks_url=jwks_url, issuer=issuer))
