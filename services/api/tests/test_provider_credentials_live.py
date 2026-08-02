"""Per-user provider credentials against real Postgres and real HTTP.

`test_qpu_credential_routes.py` proves the contract and the refusals with
doubles. Three things cannot be proven there, and they are the three that would
matter most if they were wrong:

- **One account cannot reach another's credential.** The repository is where
  that is enforced, and a double cannot enforce anything. Two committed accounts
  drive the real routes against the real table here, and the second account's
  every attempt to read, overwrite or delete the first's row is checked.
- **The plaintext is not in the row.** Asserted by reading the stored bytes back
  out of Postgres, not by inspecting what a fake was handed.
- **The unique constraint and the cascade are real.** `(user_id, provider)` is
  what makes reconnecting a replace rather than a second row, and the FK cascade
  is what stops a deleted account leaving behind a decryptable secret that
  nobody owns and nobody can revoke.

Committing, and therefore responsible for its own teardown.
"""

import datetime as dt
import os
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from repo_test_helpers import delete_committed_tenants

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.credential_crypto import generate_key, load_cipher
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import ProviderCredential, User
from majorana_api.repos import provider_credentials as credentials_repo
from majorana_api.repos import system
from majorana_api.routes import qpu as qpu_routes
from majorana_api.settings import Settings

requires_db = pytest.mark.skipif(
    "DATABASE_URL" not in os.environ,
    reason="per-user credential isolation needs a real database",
)

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

#: 44 characters each, the length IBM issues. Neither is a real key nor derived
#: from one. Distinct so a leak from one account into the other's response is a
#: substring search rather than an argument.
ALICE_KEY = "AAAAAAAAalicenotarealibmkeyAAAAAAAAAAAAAAAAAA"
BOB_KEY = "BBBBBBBBbobnotarealibmkeyBBBBBBBBBBBBBBBBBBBB"
CRN = "crn:v1:bluemix:public:quantum-computing:us-east:a/0000::"


@pytest.fixture(autouse=True)
def encryption_key(monkeypatch):
    monkeypatch.setenv("MAJORANA_CREDENTIAL_KEYS", generate_key())


@pytest.fixture(autouse=True)
def ibm_accepts_every_key(monkeypatch):
    """IBM is not contacted from a test suite.

    The real IAM exchange has its own coverage in `packages/py/qpu`; what this
    file is about starts after verification succeeds, and a suite that reached
    the internet would fail on a train and pass in CI.
    """
    monkeypatch.setattr(qpu_routes, "verify_ibm_api_key", lambda key, **kwargs: None)


def _client(factory, engine, scope, user, workspace, settings) -> httpx.AsyncClient:
    app = create_app(settings)
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _provision(session, tag: str):
    user, workspace = await system.get_or_provision_user(
        session,
        workos_user_id=f"cred-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:8]}@credentials.test",
        display_name=tag.title(),
    )
    await session.flush()
    return user, workspace


@pytest.fixture
async def two_accounts():
    """Two committed accounts, each with its own client. Neither is an admin of
    the other's workspace, and neither is a member of it."""
    engine = engine_from_env()
    factory = session_factory(engine)
    settings = Settings(**SETTINGS_KWARGS)
    async with factory() as session:
        alice, alice_ws = await _provision(session, "alice")
        bob, bob_ws = await _provision(session, "bob")
        alice_scope = Scope(user_id=alice.id, workspace_id=alice_ws.id, role=Role.OWNER)
        bob_scope = Scope(user_id=bob.id, workspace_id=bob_ws.id, role=Role.OWNER)
        await session.commit()
    alice_client = _client(factory, engine, alice_scope, alice, alice_ws, settings)
    bob_client = _client(factory, engine, bob_scope, bob, bob_ws, settings)
    try:
        yield {
            "factory": factory,
            "alice": (alice_client, alice_scope, alice),
            "bob": (bob_client, bob_scope, bob),
        }
    finally:
        await alice_client.aclose()
        await bob_client.aclose()
        await delete_committed_tenants(factory, [alice_ws.id, bob_ws.id], [alice.id, bob.id])
        await engine.dispose()


async def _rows_for(factory, user_id) -> list[ProviderCredential]:
    async with factory() as session:
        result = await session.execute(
            ProviderCredential.__table__.select().where(ProviderCredential.user_id == user_id)
        )
        return list(result.all())


# ----------------------------------------------------------------- isolation


async def test_one_account_cannot_read_anothers_credential(two_accounts):
    """The test the design owes. A credential is the highest-value row in this
    schema: it authorizes spending on a third party under somebody's name."""
    alice_client, _alice_scope, _alice = two_accounts["alice"]
    bob_client, _bob_scope, _bob = two_accounts["bob"]

    stored = await alice_client.put(
        "/v1/qpu/credentials",
        json={"provider": "ibm", "api_key": ALICE_KEY, "instance": CRN, "label": "Alice IBM"},
    )
    assert stored.status_code == 200, stored.text

    seen_by_bob = await bob_client.get("/v1/qpu/credentials")
    assert seen_by_bob.status_code == 200
    assert seen_by_bob.json()["connected"] is False
    assert seen_by_bob.json()["label"] is None
    assert seen_by_bob.json()["instance"] is None
    assert ALICE_KEY not in seen_by_bob.text
    assert "Alice IBM" not in seen_by_bob.text


async def test_one_account_cannot_delete_anothers_credential(two_accounts):
    """A 204 that removed somebody else's row would look identical to a 204 that
    removed nothing, which is why this checks the table rather than the status."""
    alice_client, _alice_scope, alice = two_accounts["alice"]
    bob_client, _bob_scope, _bob = two_accounts["bob"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})
    response = await bob_client.delete("/v1/qpu/credentials", params={"provider": "ibm"})

    assert response.status_code == 204
    assert len(await _rows_for(factory, alice.id)) == 1, "Bob's disconnect removed Alice's key"
    assert (await alice_client.get("/v1/qpu/credentials")).json()["connected"] is True


async def test_one_account_cannot_overwrite_anothers_credential(two_accounts):
    """Connecting is an upsert on `(user_id, provider)`. If the predicate were
    the provider alone, Bob's connect would silently replace Alice's key and
    every one of Alice's hardware jobs would run on Bob's IBM account."""
    alice_client, _a_scope, alice = two_accounts["alice"]
    bob_client, _b_scope, bob = two_accounts["bob"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})
    await bob_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": BOB_KEY})

    alice_rows = await _rows_for(factory, alice.id)
    bob_rows = await _rows_for(factory, bob.id)
    assert len(alice_rows) == 1 and len(bob_rows) == 1
    cipher = load_cipher()
    assert cipher.decrypt(alice_rows[0].ciphertext) == ALICE_KEY
    assert cipher.decrypt(bob_rows[0].ciphertext) == BOB_KEY


async def test_the_repository_has_no_expression_for_another_users_row(two_accounts):
    """Belt and braces at the layer below the route.

    Called directly with Bob's scope, every function in the repository answers
    about Bob — there is no parameter through which Alice's id could be passed.
    """
    alice_client, _a_scope, alice = two_accounts["alice"]
    _bob_client, bob_scope, _bob = two_accounts["bob"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})

    async with factory() as session:
        assert await credentials_repo.get(bob_scope, session, "ibm") is None
        assert await credentials_repo.has_credential(bob_scope, session, "ibm") is False
        assert await credentials_repo.delete(bob_scope, session, "ibm") is False
        await session.commit()
    assert len(await _rows_for(factory, alice.id)) == 1


# ------------------------------------------------------------ what is stored


async def test_the_stored_row_does_not_contain_the_plaintext_anywhere(two_accounts):
    """Read back out of Postgres, column by column.

    Not "the ciphertext column differs from the key": the assertion is over every
    value in the row, because the leak worth catching is a `label` defaulted to
    the key, or a debugging column somebody added.
    """
    alice_client, _scope, alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    await alice_client.put(
        "/v1/qpu/credentials",
        json={"provider": "ibm", "api_key": ALICE_KEY, "instance": CRN, "label": "Home"},
    )
    rows = await _rows_for(factory, alice.id)
    assert len(rows) == 1
    for value in rows[0]:
        assert ALICE_KEY not in str(value), f"the stored row carries the plaintext: {value!r}"


async def test_the_stored_ciphertext_decrypts_back_to_what_was_pasted(two_accounts):
    """The other direction. A row that hid the key by mangling it would pass the
    test above and produce a hardware job that fails at IBM."""
    alice_client, _scope, alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})
    rows = await _rows_for(factory, alice.id)
    assert load_cipher().decrypt(rows[0].ciphertext) == ALICE_KEY


async def test_reconnecting_replaces_the_row_rather_than_adding_one(two_accounts):
    """What a user does after rotating their key on IBM's dashboard.

    A second row would be a credential the product could pick either of, and the
    unique constraint is what makes that impossible rather than unlikely.
    """
    alice_client, _scope, alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    await alice_client.put(
        "/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY, "label": "first"}
    )
    await alice_client.put(
        "/v1/qpu/credentials", json={"provider": "ibm", "api_key": BOB_KEY, "label": "second"}
    )

    rows = await _rows_for(factory, alice.id)
    assert len(rows) == 1
    assert rows[0].label == "second"
    assert load_cipher().decrypt(rows[0].ciphertext) == BOB_KEY


async def test_disconnect_really_removes_the_ciphertext(two_accounts):
    """ "Disconnect" has to mean the secret is gone. A soft delete would leave a
    decryptable key in the database after the user was told it was removed."""
    alice_client, _scope, alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})
    assert (await alice_client.delete("/v1/qpu/credentials")).status_code == 204
    assert await _rows_for(factory, alice.id) == []


async def test_deleting_the_account_takes_its_credentials_with_it(two_accounts):
    """The FK cascade, proven rather than assumed.

    An orphaned ciphertext is a secret with no owner: nobody can revoke it,
    nobody is told it exists, and it decrypts under the same key as everything
    else.

    The deleted account is a bare `users` row created here rather than one of
    the fixture's, because those own workspaces and `workspaces.owner_user_id`
    has no cascade — deleting one raises a ForeignKeyViolation from a constraint
    that has nothing to do with credentials, which would make this test about
    the teardown order instead of about the cascade. Bob's row is present
    throughout so that "the cascade fired" is distinguishable from "the table
    was emptied".
    """
    bob_client, _bob_scope, bob = two_accounts["bob"]
    factory = two_accounts["factory"]
    await bob_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": BOB_KEY})

    from majorana_api.ids import uuid7

    doomed_id = uuid7()
    async with factory() as session:
        session.add(
            User(
                id=doomed_id,
                workos_user_id=f"cred-cascade-{uuid.uuid4()}",
                email=f"cascade-{uuid.uuid4().hex[:8]}@credentials.test",
            )
        )
        await session.flush()
        await credentials_repo.upsert(
            Scope(user_id=doomed_id, workspace_id=uuid.uuid4(), role=Role.OWNER),
            session,
            provider="ibm",
            ciphertext=load_cipher().encrypt(ALICE_KEY)[0],
            key_id=load_cipher().key_id,
            instance=None,
            label=None,
            last_verified_at=dt.datetime.now(dt.UTC),
        )
        await session.commit()
    assert len(await _rows_for(factory, doomed_id)) == 1

    async with factory() as session:
        await session.execute(User.__table__.delete().where(User.id == doomed_id))
        await session.commit()

    assert await _rows_for(factory, doomed_id) == []
    assert len(await _rows_for(factory, bob.id)) == 1, "the cascade took an unrelated account's row"


# ------------------------------------------------------------------ the gate


async def test_the_submission_gate_follows_the_caller_across_the_two_accounts(two_accounts):
    """The gate is per-person, which is the whole point of the change.

    One account connecting must not open hardware submission for everybody, and
    that is exactly what the shared `MAJORANA_QPU_IBM_TOKEN` did.
    """
    alice_client, _a, _alice = two_accounts["alice"]
    bob_client, _b, _bob = two_accounts["bob"]

    os.environ["MAJORANA_QPU_SUBMIT_ENABLED"] = "true"
    try:
        await alice_client.put(
            "/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY}
        )
        alice_gate = (await alice_client.get("/v1/qpu/submission-gate")).json()
        bob_gate = (await bob_client.get("/v1/qpu/submission-gate")).json()
    finally:
        os.environ.pop("MAJORANA_QPU_SUBMIT_ENABLED", None)

    # Alice's remaining blocker, if any, is the provider dependency — never her
    # credential. Bob has connected nothing and must be told so by name.
    assert alice_gate["blocked_reason"] != "credentials_unconfigured"
    assert bob_gate["submission_available"] is False
    assert bob_gate["blocked_reason"] == "credentials_unconfigured"


async def test_a_submission_from_an_account_with_no_credential_writes_nothing(two_accounts):
    """A 409 before the durable row and the job, over real HTTP against the real
    table — the ordering `test_qpu_routes.py` pins with doubles, confirmed where
    a write would actually be visible."""
    from majorana_api.orm import QpuRun

    _alice_client, _a, _alice = two_accounts["alice"]
    bob_client, bob_scope, _bob = two_accounts["bob"]
    factory = two_accounts["factory"]

    os.environ["MAJORANA_QPU_SUBMIT_ENABLED"] = "true"
    try:
        response = await bob_client.post(
            "/v1/qpu/submissions",
            json={
                "device_id": "ibm.open_plan",
                "shots": 128,
                "qasm": 'OPENQASM 3.0; include "stdgates.inc"; qubit[1] q; bit[1] c; h q[0];',
                "source_fingerprint": "fnv1a-nocred",
            },
        )
    finally:
        os.environ.pop("MAJORANA_QPU_SUBMIT_ENABLED", None)

    assert response.status_code == 409, response.text
    assert response.json()["blocked_reason"] == "credentials_unconfigured"
    async with factory() as session:
        rows = (
            await session.execute(
                QpuRun.__table__.select().where(QpuRun.workspace_id == bob_scope.workspace_id)
            )
        ).all()
    assert rows == [], "a refused submission wrote a durable attestation row"


# ---------------------------------------------------------------- timestamps


async def test_a_credential_connected_and_never_used_shows_only_a_verification(two_accounts):
    """The one moment the two stamps genuinely differ: verified, not yet used."""
    alice_client, _scope, _alice = two_accounts["alice"]
    connected = (
        await alice_client.put(
            "/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY}
        )
    ).json()
    assert connected["last_verified_at"] is not None
    assert connected["last_used_at"] is None


async def test_a_successful_provider_call_refreshes_the_verification_stamp(two_accounts):
    """`last_verified_at` means LAST ACCEPTED, not first saved.

    A field only the store path ever wrote would be a creation timestamp wearing
    a verification label: it would keep reporting "verified" as of the day the
    key was pasted, for a credential the user revoked on IBM's dashboard last
    week, under a UI that renders "Last verified <date>" beside it. A provider
    call that succeeds is the same fact the connect-time IAM exchange
    establishes, arriving later, so it moves the stamp.
    """
    alice_client, alice_scope, alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    connected = (
        await alice_client.put(
            "/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY}
        )
    ).json()
    stored_at = dt.datetime.fromisoformat(connected["last_verified_at"])

    async with factory() as session:
        await credentials_repo.mark_provider_success(alice_scope, session, "ibm")
        await session.commit()

    after_use = (await alice_client.get("/v1/qpu/credentials")).json()
    assert after_use["last_used_at"] is not None
    assert dt.datetime.fromisoformat(after_use["last_verified_at"]) > stored_at
    assert len(await _rows_for(factory, alice.id)) == 1


async def test_reconnecting_moves_verification_without_moving_use(two_accounts):
    """Which is what keeps the two fields from being one field.

    After a reconnection the key has been freshly accepted and has not yet been
    used again, so `last_verified_at` moves and `last_used_at` stands still.
    """
    alice_client, alice_scope, _alice = two_accounts["alice"]
    factory = two_accounts["factory"]

    await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": ALICE_KEY})
    async with factory() as session:
        await credentials_repo.mark_provider_success(alice_scope, session, "ibm")
        await session.commit()
    after_use = (await alice_client.get("/v1/qpu/credentials")).json()

    reconnected = (
        await alice_client.put("/v1/qpu/credentials", json={"provider": "ibm", "api_key": BOB_KEY})
    ).json()
    assert reconnected["last_used_at"] == after_use["last_used_at"]
    assert dt.datetime.fromisoformat(reconnected["last_verified_at"]) > dt.datetime.fromisoformat(
        after_use["last_verified_at"]
    )
