"""JWT verification unit tests — local RSA keypair stands in for WorkOS JWKS."""

import datetime as dt
import uuid

import jwt as pyjwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from majorana_api.auth import jwt as auth_jwt

ISSUER = "https://api.workos.com"
JWKS_URL = "https://api.workos.com/sso/jwks/client_test"
CLIENT_ID = "client_test"


class _FakeKey:
    def __init__(self, key):
        self.key = key


class _FakeJWKClient:
    def __init__(self, public_key):
        self._public = public_key

    def get_signing_key_from_jwt(self, token):
        return _FakeKey(self._public)


@pytest.fixture(scope="module")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture(autouse=True)
def fake_jwks(keypair, monkeypatch):
    monkeypatch.setattr(auth_jwt, "_jwk_client", lambda url: _FakeJWKClient(keypair[1]))


def mint(private, **overrides):
    now = dt.datetime.now(dt.timezone.utc)
    claims = {
        "iss": ISSUER,
        "sub": f"user_{uuid.uuid4().hex[:8]}",
        "sid": f"session_{uuid.uuid4().hex[:8]}",
        "client_id": CLIENT_ID,
        "iat": now,
        "exp": now + dt.timedelta(minutes=5),
        "email": "e@example.test",
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return pyjwt.encode(claims, private, algorithm="RS256")


async def test_valid_token_verifies(keypair):
    token = mint(keypair[0], sub="user_abc")
    verified = await auth_jwt.verify_bearer_token(
        token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
    )
    assert verified.workos_user_id == "user_abc"
    assert verified.session_id.startswith("session_")
    assert verified.claims["email"] == "e@example.test"


async def test_wrong_issuer_rejected(keypair):
    token = mint(keypair[0], iss="https://evil.example.com")
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )


async def test_expired_beyond_leeway_rejected(keypair):
    past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=auth_jwt.LEEWAY_S + 60)
    token = mint(keypair[0], exp=past)
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )


async def test_expired_within_leeway_accepted(keypair):
    """±60 s clock skew tolerance (05-security.md §1)."""
    just_past = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=auth_jwt.LEEWAY_S - 30)
    token = mint(keypair[0], exp=just_past)
    verified = await auth_jwt.verify_bearer_token(
        token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
    )
    assert verified.session_id


async def test_missing_sid_rejected(keypair):
    token = mint(keypair[0], sid=None)
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )


async def test_wrong_client_id_rejected(keypair):
    token = mint(keypair[0], client_id="client_other")
    with pytest.raises(auth_jwt.TokenError, match="client_id"):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )


# --------------------------------------------------------------------------
# Audience pinning (05-security.md §1 "audience/issuer pinned")
#
# The issuer and JWKS are per-client, so every token reaching this code was
# signed for our client. `aud` is what separates token PURPOSES signed by that
# same client — an ID token carries `sub` and `sid` too, so nothing else here
# tells them apart. Unset is the pre-existing behaviour and stays supported,
# because requiring a claim production's tokens do not carry refuses sign-in.
# --------------------------------------------------------------------------

AUDIENCE = "majorana-api"


async def test_audience_unset_still_refuses_a_token_carrying_one(keypair):
    """Measured, not assumed — and it narrows the finding that prompted this.

    pyjwt's `verify_aud` defaults on, and its rule for `audience=None` is to
    refuse any token that HAS an `aud`. So the unconfigured service was never
    open to another service's audience-bearing token; the actual gap was only
    the token with no `aud` at all, and the absence of a positive pin.
    """
    token = mint(keypair[0], aud="something-else")
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )


async def test_audience_unset_accepts_a_token_without_one(keypair):
    """The other half of the default, and the reason the pin has to be optional:
    this is the shape production's tokens are believed to have."""
    token = mint(keypair[0])
    verified = await auth_jwt.verify_bearer_token(
        token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
    )
    assert verified.session_id


async def test_matching_audience_accepted(keypair):
    token = mint(keypair[0], aud=AUDIENCE)
    verified = await auth_jwt.verify_bearer_token(
        token,
        jwks_url=JWKS_URL,
        issuer=ISSUER,
        client_id=CLIENT_ID,
        audience=AUDIENCE,
    )
    assert verified.session_id


async def test_wrong_audience_rejected(keypair):
    """A token signed by our own client for a different purpose."""
    token = mint(keypair[0], aud="some-other-service")
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token,
            jwks_url=JWKS_URL,
            issuer=ISSUER,
            client_id=CLIENT_ID,
            audience=AUDIENCE,
        )


async def test_missing_audience_rejected_when_pinned(keypair):
    """The half that `audience=` alone does not buy: pyjwt only compares the
    claim when it is present, so without `aud` in the required set a token with
    the claim stripped would pass the very check added to stop it."""
    token = mint(keypair[0])
    assert "aud" not in pyjwt.decode(token, options={"verify_signature": False})
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token,
            jwks_url=JWKS_URL,
            issuer=ISSUER,
            client_id=CLIENT_ID,
            audience=AUDIENCE,
        )


async def test_unsigned_alg_rejected(keypair):
    now = dt.datetime.now(dt.timezone.utc)
    claims = {
        "iss": ISSUER,
        "sub": "u",
        "sid": "s",
        "client_id": CLIENT_ID,
        "iat": now,
        "exp": now + dt.timedelta(minutes=5),
    }
    token = pyjwt.encode(claims, key=None, algorithm="none")
    with pytest.raises(auth_jwt.TokenError):
        await auth_jwt.verify_bearer_token(
            token, jwks_url=JWKS_URL, issuer=ISSUER, client_id=CLIENT_ID
        )
