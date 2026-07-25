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
