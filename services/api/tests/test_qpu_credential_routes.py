"""The credential routes' contract, and the one rule that outranks it.

The contract a parallel UI is built against:

    GET    /v1/qpu/credentials              -> 200 status projection
    PUT    /v1/qpu/credentials              -> 200 / 400 / 502 / 503
    DELETE /v1/qpu/credentials?provider=ibm -> 204

The rule: **the plaintext API key never appears in a response body.** Not on
success, not in a refusal, not in a validation error. It is asserted here over
every route and every status code these handlers can produce, rather than on the
happy path only — a leak in a refusal is the one nobody looks at.

The verification transport and the repository are doubles. The real IAM request
was proven against `iam.cloud.ibm.com` once, by hand, with an invalid key; the
real repository is proven in `test_provider_credentials_live.py`, which is the
only place cross-user isolation can honestly be tested.
"""

import uuid as uuid_module
from types import SimpleNamespace

import httpx
import pytest
from majorana_qpu import IbmCredentialRejected, IbmVerificationUnavailable

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.credential_crypto import generate_key
from majorana_api.routes import qpu as qpu_routes
from majorana_api.settings import Settings

#: 44 characters, the length IBM issues. Not a real key, not derived from one,
#: and distinctive enough that a substring search for it is meaningful.
PASTED_KEY = "AAAAAAAAnotarealibmkeyAAAAAAAAAAAAAAAAAAAAAAA"
CRN = "crn:v1:bluemix:public:quantum-computing:us-east:a/0000::"

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


class FakeCredentialStore:
    """One row, in memory, keyed the way the real repository keys it."""

    def __init__(self, row=None):
        self.row = row
        self.deleted = 0

    async def get(self, scope, session, provider):
        return self.row

    async def credential_key_id(self, scope, session, provider):
        # The row's OWN key_id, not a stand-in for "a row exists". The gate
        # compares it against the configured keys, so a double that returned a
        # constant would make every rotation case unreachable from these tests.
        return None if self.row is None else self.row.key_id

    async def upsert(self, scope, session, **kwargs):
        self.row = SimpleNamespace(
            provider=kwargs["provider"],
            ciphertext=kwargs["ciphertext"],
            key_id=kwargs["key_id"],
            instance=kwargs["instance"],
            label=kwargs["label"],
            created_at=None,
            last_verified_at=kwargs["last_verified_at"],
            last_used_at=None,
        )
        return self.row

    async def delete(self, scope, session, provider):
        self.deleted += 1
        existed = self.row is not None
        self.row = None
        return existed

    async def mark_provider_success(self, scope, session, provider):  # pragma: no cover
        return None


@pytest.fixture
def store(monkeypatch):
    fake = FakeCredentialStore()
    monkeypatch.setattr(qpu_routes, "credentials_repo", fake)
    return fake


@pytest.fixture
def keys(monkeypatch):
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", generate_key())


@pytest.fixture
def client():
    """The app over ASGI, with identity stubbed and no database at all.

    Over HTTP rather than by calling handlers: the assertion this file exists
    for is about a RESPONSE BODY, and a handler's return value is not one.
    Serialization is where a field nobody meant to expose becomes exposed.
    """
    app = create_app(Settings(**SETTINGS_KWARGS))
    scope = SimpleNamespace(
        user_id=uuid_module.uuid4(),
        workspace_id=uuid_module.uuid4(),
        role="owner",
    )
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_session] = lambda: object()
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.fixture
def ibm_accepts(monkeypatch):
    monkeypatch.setattr(
        qpu_routes,
        "verify_ibm_api_key",
        lambda key, **kwargs: None,
    )


def _body(**overrides) -> dict:
    return {"provider": "ibm", "api_key": PASTED_KEY, **overrides}


# ------------------------------------------------------------------- the shape


def test_the_three_routes_exist_under_the_v1_prefix():
    paths = {
        (route.path, method)
        for route in qpu_routes.router.routes
        for method in getattr(route, "methods", set())
    }
    assert ("/qpu/credentials", "GET") in paths
    assert ("/qpu/credentials", "PUT") in paths
    assert ("/qpu/credentials", "DELETE") in paths


async def test_status_reports_a_caller_who_has_connected_nothing(client, store, keys):
    async with client as http:
        response = await http.get("/v1/qpu/credentials")
    assert response.status_code == 200
    assert response.json() == {
        "provider": "ibm",
        "connected": False,
        "label": None,
        "instance": None,
        "created_at": None,
        "last_verified_at": None,
        "last_used_at": None,
        "storage_available": True,
    }


async def test_status_takes_the_same_provider_parameter_delete_does(client, store, keys):
    """The asymmetry removed while there is one provider rather than after there
    are two. A GET with no parameter answering `"provider": "ibm"` presumes one
    provider per account forever, and every caller changes on the day that stops
    being true."""
    async with client as http:
        explicit = await http.get("/v1/qpu/credentials", params={"provider": "ibm"})
        implicit = await http.get("/v1/qpu/credentials")
    assert explicit.status_code == 200
    assert explicit.json() == implicit.json()
    assert explicit.json()["provider"] == "ibm"


async def test_an_unknown_provider_is_refused_rather_than_answered_emptily(client, store, keys):
    """A `Literal` keeps the one valid value enforced. Answering
    `connected: false` for `provider=braket` would be a confident statement about
    something that does not exist."""
    async with client as http:
        response = await http.get("/v1/qpu/credentials", params={"provider": "braket"})
    assert response.status_code == 422


async def test_status_reports_storage_unavailable_without_failing(client, store, monkeypatch):
    """A user staring at a refusing form needs to know it is not their key.

    The status route deliberately still answers 200 with an unusable store: the
    row's metadata is not encrypted, and an account that cannot see whether it is
    connected has no way to understand why submission refuses.
    """
    monkeypatch.delenv("MAJORANA_CREDENTIAL_KEYS", raising=False)
    async with client as http:
        response = await http.get("/v1/qpu/credentials")
    assert response.status_code == 200
    assert response.json()["storage_available"] is False


async def test_connect_stores_the_key_and_reports_it_connected(client, store, keys, ibm_accepts):
    async with client as http:
        response = await http.put("/v1/qpu/credentials", json=_body(instance=CRN, label="Home"))
    assert response.status_code == 200
    payload = response.json()
    assert payload["connected"] is True
    assert payload["instance"] == CRN
    assert payload["label"] == "Home"
    assert payload["last_verified_at"] is not None
    assert store.row is not None


async def test_disconnect_is_204_and_idempotent(client, store, keys, ibm_accepts):
    async with client as http:
        await http.put("/v1/qpu/credentials", json=_body())
        first = await http.delete("/v1/qpu/credentials", params={"provider": "ibm"})
        second = await http.delete("/v1/qpu/credentials", params={"provider": "ibm"})
    assert first.status_code == 204
    assert second.status_code == 204
    assert first.content == b""
    assert store.row is None


# ------------------------------------------------------------------ refusals


async def test_a_key_ibm_refuses_is_a_400_and_is_not_stored(client, store, keys, monkeypatch):
    """Storing an unusable key moves the failure into a job hours later, where
    it appears as a hardware run that failed for reasons nobody can attribute."""

    def refuse(key, **kwargs):
        raise IbmCredentialRejected("IBM did not accept this API key. Check you copied all 44.")

    monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", refuse)
    async with client as http:
        response = await http.put("/v1/qpu/credentials", json=_body())
    assert response.status_code == 400
    assert response.json()["reason"] == "credential_rejected"
    assert "44" in response.json()["title"]
    assert store.row is None


async def test_an_unreachable_ibm_is_a_502_and_is_not_stored(client, store, keys, monkeypatch):
    """Distinct from 400 because the user acts differently: this one means try
    again, not go and regenerate a credential that was fine."""

    def unreachable(key, **kwargs):
        raise IbmVerificationUnavailable("IBM's credential service could not be reached")

    monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", unreachable)
    async with client as http:
        response = await http.put("/v1/qpu/credentials", json=_body())
    assert response.status_code == 502
    body = response.json()
    assert body["reason"] == "credential_verification_unavailable"
    # No operator-facing string: the web client renders whatever `error` it
    # finds, so a diagnostic here is a diagnostic on an end user's screen.
    assert "error" not in body
    assert body["title"] == "request refused"
    assert store.row is None


async def test_no_encryption_key_is_a_503_and_ibm_is_never_contacted(client, store, monkeypatch):
    """Fail closed BEFORE the key is sent anywhere.

    A deployment that cannot store the credential has no business exchanging it
    with IBM: the round trip would prove a key it is about to throw away, and
    the only way to be certain plaintext is never persisted is to refuse first.
    """
    monkeypatch.delenv("MAJORANA_CREDENTIAL_KEYS", raising=False)

    def must_not_run(key, **kwargs):
        raise AssertionError("the key must not be sent anywhere when storage is unavailable")

    monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", must_not_run)
    async with client as http:
        response = await http.put("/v1/qpu/credentials", json=_body())
    assert response.status_code == 503
    body = response.json()
    assert body["reason"] == "credential_storage_unavailable"
    assert "error" not in body
    assert "MAJORANA_CREDENTIAL_KEYS" not in response.text, (
        "the operator diagnostic belongs in the log, not on a user's screen"
    )
    assert store.row is None


async def test_a_short_paste_is_refused_before_anything_is_stored(client, store, keys):
    """The real verifier, not a double: the commonest user error is a truncated
    paste, and it is answered locally without a round trip."""
    async with client as http:
        response = await http.put("/v1/qpu/credentials", json=_body(api_key="abc"))
    assert response.status_code == 400
    assert response.json()["reason"] == "credential_rejected"
    assert store.row is None


# ------------------------------------------------- the rule that outranks all


async def test_no_response_body_on_any_route_contains_the_pasted_key(
    client, store, keys, monkeypatch
):
    """One sweep over every status code these handlers can produce.

    Written as a sweep rather than an assertion per test so that a new branch —
    a new refusal, a new field on the projection — is covered by existing code
    rather than by somebody remembering. The failures matter more than the
    success here: a 400 that quotes what the user sent is the natural way to
    write an "actionable" error message, and it is the leak.
    """
    outcomes: list[tuple[str, httpx.Response]] = []

    async with client as http:
        # 400 — IBM refuses, with a provider message that tries to quote the key
        monkeypatch.setattr(
            qpu_routes,
            "verify_ibm_api_key",
            lambda key, **kw: (_ for _ in ()).throw(
                IbmCredentialRejected("IBM did not accept this API key.")
            ),
        )
        outcomes.append(("put-400", await http.put("/v1/qpu/credentials", json=_body())))

        # 502 — IBM unreachable
        monkeypatch.setattr(
            qpu_routes,
            "verify_ibm_api_key",
            lambda key, **kw: (_ for _ in ()).throw(IbmVerificationUnavailable("no route")),
        )
        outcomes.append(("put-502", await http.put("/v1/qpu/credentials", json=_body())))

        # 422 — malformed bodies. FastAPI's default validation response embeds
        # the offending `input`; this app replaces it with a fixed body, which is
        # the only reason a validation error is not a credential disclosure.
        #
        # The shape matters, and the first version of this case had the wrong
        # one. `{"api_key": KEY, "nope": 1}` raises `extra_forbidden`, whose
        # `input` is the EXTRA value (`1`) — the key never enters the error
        # object at all, so that case passed with the protection deleted.
        # Measured: KEY_IN_ERRORS=False for `extra_forbidden`, and True for all
        # three shapes below, which are the ones that embed the whole body.
        for label, body in (
            # RequestModel's NUL validator raises after the model is built, so
            # `input` is the entire dict — key included.
            ("nul-in-label", {"api_key": PASTED_KEY, "provider": "ibm", "label": "a\x00b"}),
            # A non-string api_key: `input` is the whole body again.
            ("api-key-wrong-type", {"api_key": [PASTED_KEY], "provider": "ibm"}),
            # A body that is not an object at all.
            ("body-not-an-object", [{"api_key": PASTED_KEY}]),
        ):
            outcomes.append((f"put-422-{label}", await http.put("/v1/qpu/credentials", json=body)))
        # Kept as well, because `extra_forbidden` is still a real 422 and the
        # sweep should cover it — it is simply not the case that proves anything.
        outcomes.append(
            (
                "put-422-extra-forbidden",
                await http.put("/v1/qpu/credentials", json={"api_key": PASTED_KEY, "nope": 1}),
            )
        )

        # 200 — stored successfully
        monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", lambda key, **kw: None)
        outcomes.append(("put-200", await http.put("/v1/qpu/credentials", json=_body())))
        outcomes.append(("get-200", await http.get("/v1/qpu/credentials")))
        outcomes.append(
            ("delete-204", await http.delete("/v1/qpu/credentials", params={"provider": "ibm"}))
        )

    assert {name for name, _ in outcomes} == {
        "put-400",
        "put-502",
        "put-422-nul-in-label",
        "put-422-api-key-wrong-type",
        "put-422-body-not-an-object",
        "put-422-extra-forbidden",
        "put-200",
        "get-200",
        "delete-204",
    }
    # Every 422 above really is one — a shape that 400s or 500s instead would
    # leave the disclosure path this test exists for unexercised while the
    # "key not in body" assertion below still passed.
    for name, response in outcomes:
        if name.startswith("put-422"):
            assert response.status_code == 422, f"{name} returned {response.status_code}"
    for name, response in outcomes:
        assert PASTED_KEY not in response.text, f"{name} ({response.status_code}) echoed the key"


async def test_the_status_projection_has_no_field_for_a_key(client, store, keys, ibm_accepts):
    """Not "the value is absent" — the SHAPE has nowhere to put it.

    Also no fingerprint, prefix or masked form: a "last four" is a real
    reduction of the search space for a 44-character secret and buys the user
    nothing `last_verified_at` does not.
    """
    async with client as http:
        await http.put("/v1/qpu/credentials", json=_body())
        payload = (await http.get("/v1/qpu/credentials")).json()
    for field in payload:
        assert "key" not in field.lower() or field == "api_key_absent"
    assert set(payload) == {
        "provider",
        "connected",
        "label",
        "instance",
        "created_at",
        "last_verified_at",
        "last_used_at",
        "storage_available",
    }


async def test_the_stored_ciphertext_is_not_the_plaintext(client, store, keys, ibm_accepts):
    """What reaches the repository is encrypted, checked at the boundary the
    repository sees rather than after a round trip through Postgres."""
    async with client as http:
        await http.put("/v1/qpu/credentials", json=_body())
    assert store.row.ciphertext != PASTED_KEY
    assert PASTED_KEY not in store.row.ciphertext
    assert store.row.key_id


async def test_only_the_rejection_carries_a_user_facing_sentence(client, store, monkeypatch):
    """One sweep over the three refusals.

    The web client renders the user-facing sentence verbatim. `app._problem`
    promotes `detail["error"]` into the problem document's `title` and passes
    every other key through as an extension, so "carries a sentence" means
    `title` is that sentence rather than the generic "request refused" — which
    is exactly what a refusal with no `error` produces.

    Only the 400 is about something the user did and can fix; a sentence on the
    other two would put "MAJORANA_CREDENTIAL_KEYS is not set" — or a hostname, or
    an internal reason — on an end user's screen. Written as a sweep so a fourth
    refusal has to opt into carrying one.
    """
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", generate_key())
    async with client as http:
        monkeypatch.setattr(
            qpu_routes,
            "verify_ibm_api_key",
            lambda key, **kw: (_ for _ in ()).throw(
                IbmCredentialRejected("copy all 44 characters")
            ),
        )
        rejected = await http.put("/v1/qpu/credentials", json=_body())

        monkeypatch.setattr(
            qpu_routes,
            "verify_ibm_api_key",
            lambda key, **kw: (_ for _ in ()).throw(
                IbmVerificationUnavailable("connect to iam.cloud.ibm.com timed out")
            ),
        )
        unreachable = await http.put("/v1/qpu/credentials", json=_body())

        monkeypatch.delenv("MAJORANA_CREDENTIAL_KEYS", raising=False)
        no_storage = await http.put("/v1/qpu/credentials", json=_body())

    assert rejected.status_code == 400
    assert "44" in rejected.json()["title"]

    assert unreachable.status_code == 502
    assert unreachable.json()["title"] == "request refused"
    assert "error" not in unreachable.json()
    assert "iam.cloud.ibm.com" not in unreachable.text

    assert no_storage.status_code == 503
    assert no_storage.json()["title"] == "request refused"
    assert "error" not in no_storage.json()
    assert "MAJORANA_CREDENTIAL_KEYS" not in no_storage.text


async def test_the_key_is_verified_before_it_is_stored(client, store, keys, monkeypatch):
    """Ordering, not just presence. A verifier called after the write would pass
    every test that only checked the status code."""
    order: list[str] = []

    def verify(key, **kwargs):
        order.append("verify")

    original_upsert = store.upsert

    async def watched_upsert(*args, **kwargs):
        order.append("store")
        return await original_upsert(*args, **kwargs)

    monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", verify)
    store.upsert = watched_upsert
    async with client as http:
        await http.put("/v1/qpu/credentials", json=_body())
    assert order == ["verify", "store"]
