"""Personal access tokens against real Postgres: the authz rows for §2's release gate.

Proposal 7 Phase B, owner ruling **ai-ops 362 option 1**. `test_token_access.py` proves
the POLICY — which templates each scope may reach — without a database. This file proves
the things only a database can, and they are the ones a review of a new credential type
actually asks about:

- a presented token resolves to its OWN owner and its OWN workspace, and to nobody
  else's, through the real auth dependency;
- a token bound to a workspace does not follow its owner when they switch on the
  website, and is refused outright once they leave that workspace, rather than falling
  back to a different tenant;
- revoked and expired tokens stop working, at the boundary, on timestamps Postgres
  wrote;
- one account cannot see, use or revoke another's tokens;
- the secret reaches no response but the minting one, and no log line.

`plans/rebuild/05-security.md` §2 asks for "authz matrix rows for each scope". These are
those rows. Everything runs inside the authz `db` fixture's transaction and is rolled
back.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import logging
import uuid

import httpx
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.tokens import (
    MAX_TOKENS_PER_USER,
    TOKEN_PREFIX,
    CreateTokenRequest,
    TokenScope,
)
from matrix_helpers import requires_db
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError

from majorana_api.app import create_app
from majorana_api.ids import uuid7
from majorana_api.orm import PersonalAccessToken, User, Workspace
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
    personal_access_tokens_enabled=True,
)


async def _person(db, tag: str) -> tuple[User, Workspace]:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"pat-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@pat.test",
        display_name=tag.title(),
    )


async def _owner_scope(db, tag: str) -> tuple[Scope, User, Workspace]:
    user, workspace = await _person(db, tag)
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER), user, workspace


@contextlib.asynccontextmanager
async def _fixture_session(db):
    """Hand the fixture's own session to a caller that expects to open one.

    Yields without closing or committing: the session belongs to the `db` fixture,
    which rolls it back at the end of the test. A real `async with factory()` would
    close it, and the assertions after the request would then fail on a dead session.
    """
    yield db


def _client(db, *, enabled: bool = True) -> httpx.AsyncClient:
    """A client that presents a BEARER token and nothing else.

    Deliberately does NOT override `get_scope` or `get_identity`, unlike most suites
    here: the whole point is to drive the real dependency chain, because the thing
    under test is what that chain does with a credential.

    Two seams are pointed at the fixture's transaction, because the credential lookup
    deliberately does not share the request's session — `auth_session_factory` opens
    its own so that an unauthenticated 401 never touches the database at all. Both go
    to the same session here, so a token minted by the test is visible to the lookup
    without anything being committed.
    """
    from majorana_api.auth import deps as auth_deps

    app = create_app(Settings(**{**SETTINGS_KWARGS, "personal_access_tokens_enabled": enabled}))
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.state.auth_session_factory = lambda: _fixture_session(db)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ------------------------------------------------------------------ resolve and scope


async def test_a_presented_token_acts_as_its_owner_in_the_workspace_it_was_minted_in(db):
    scope, user, workspace = await _owner_scope(db, "ana")
    token, row = await tokens_repo.mint(scope, db, name="editor plugin")

    async with _client(db) as client:
        response = await client.get("/v1/me", headers=_auth(token))

    assert response.status_code == 200
    body = response.json()
    assert body["user_id"] == str(user.id)
    assert body["workspace_id"] == str(workspace.id)
    assert row.workspace_id == workspace.id


async def test_a_token_does_not_follow_its_owner_when_they_switch_workspace(db):
    """The token's tenant is fixed at mint. A browser session would move here; a
    token must not, or an automation's writes land in a workspace nobody pointed it at.
    """
    scope, user, personal = await _owner_scope(db, "ana")
    token, _row = await tokens_repo.mint(scope, db, name="pinned to personal")

    second, _membership = await system.create_team_workspace(
        db, owner=user, name="Team", owned_workspace_limit=None
    )
    await system.set_active_workspace(db, user=user, workspace_id=second.id)

    async with _client(db) as client:
        response = await client.get("/v1/me", headers=_auth(token))

    assert response.status_code == 200
    assert response.json()["workspace_id"] == str(personal.id)


async def test_a_token_is_refused_once_its_owner_leaves_that_workspace(db):
    """Refused, and specifically NOT quietly moved to the personal workspace, which is
    what `resolve_active_workspace` does for a browser session with a stale pointer."""
    host, _host_user, _host_ws = await _owner_scope(db, "host")
    guest_user, _guest_ws = await _person(db, "guest")
    await workspaces_repo.add_member(host, db, user_id=guest_user.id, role=Role.MEMBER)
    guest = Scope(user_id=guest_user.id, workspace_id=host.workspace_id, role=Role.MEMBER)

    token, _row = await tokens_repo.mint(guest, db, name="in someone else's workspace")
    async with _client(db) as client:
        before = await client.get("/v1/me", headers=_auth(token))
        assert before.status_code == 200
        assert before.json()["workspace_id"] == str(host.workspace_id)

        await workspaces_repo.remove_member(host, db, user_id=guest_user.id)
        after = await client.get("/v1/me", headers=_auth(token))

    assert after.status_code == 404


# ------------------------------------------------------------------ lifecycle at the edge


async def test_a_revoked_token_stops_working_on_its_next_request(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, row = await tokens_repo.mint(scope, db, name="short lived")

    async with _client(db) as client:
        assert (await client.get("/v1/me", headers=_auth(token))).status_code == 200
        await tokens_repo.revoke(scope, db, row.id)
        refused = await client.get("/v1/me", headers=_auth(token))

    assert refused.status_code == 401


async def test_an_expired_token_is_refused_and_expiry_is_strict(db):
    """One microsecond either side of the instant, on the timestamp Postgres stored."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, row = await tokens_repo.mint(scope, db, name="a day", expires_in_days=1)
    tick = dt.timedelta(microseconds=1)

    assert await tokens_repo.resolve_presented(db, token, now=row.expires_at - tick) is not None
    assert await tokens_repo.resolve_presented(db, token, now=row.expires_at) is None
    assert await tokens_repo.resolve_presented(db, token, now=row.expires_at + tick) is None


async def test_the_ninety_day_ceiling_is_enforced_three_times_over(db):
    """The owner's "at most 90 days", checked at each of the three places it can be.

    Not belt-and-braces for its own sake: the three fail differently and each failure
    is somebody else's. The request model gives a person a 422 naming the field; the
    repository stops any caller that is not the route; and **0069's check constraint
    stops a writer that is neither**, which is the one that still holds after this
    file, `mint` and the route have all been rewritten. A ceiling only the route
    enforces is a ceiling the next writer of an insert does not know about.
    """
    scope, _user, _ws = await _owner_scope(db, "ana")

    # 1. the request model
    with pytest.raises(ValidationError):
        CreateTokenRequest(name="too long", expires_in_days=91)

    # 2. the repository
    with pytest.raises(ValueError):
        await tokens_repo.mint(scope, db, name="too long", expires_in_days=91)

    # 3. the database, reached by going around both. Inside a SAVEPOINT so the
    # IntegrityError does not poison the fixture's transaction for the assertions
    # after it — a failed statement leaves a Postgres transaction unusable, and
    # every other test in this file shares this one.
    created = dt.datetime.now(dt.timezone.utc)
    with pytest.raises(IntegrityError):
        async with db.begin_nested():
            db.add(
                PersonalAccessToken(
                    id=uuid7(),
                    user_id=scope.user_id,
                    workspace_id=scope.workspace_id,
                    name="straight into the table",
                    token_hash=tokens_repo.hash_token(tokens_repo.new_token()),
                    tail="abcd",
                    scopes=["read"],
                    created_at=created,
                    expires_at=created + dt.timedelta(days=91),
                )
            )
            await db.flush()

    # The transaction is still usable, which is what the SAVEPOINT bought.
    assert await tokens_repo.list_tokens(scope, db) == []


async def test_last_used_is_stamped_and_then_left_alone_for_five_minutes(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, row = await tokens_repo.mint(scope, db, name="busy")
    assert row.last_used_at is None

    first = row.created_at + dt.timedelta(seconds=1)
    await tokens_repo.resolve_presented(db, token, now=first)
    assert row.last_used_at == first

    # Inside the resolution: not rewritten, so a token in a loop is not a write storm.
    await tokens_repo.resolve_presented(db, token, now=first + dt.timedelta(minutes=1))
    assert row.last_used_at == first

    later = first + tokens_repo.LAST_USED_RESOLUTION
    await tokens_repo.resolve_presented(db, token, now=later)
    assert row.last_used_at == later


# ------------------------------------------------------------------ one account, one set


async def test_one_account_cannot_see_use_or_revoke_anothers_tokens(db):
    ana, _ana_user, _ana_ws = await _owner_scope(db, "ana")
    bo, _bo_user, _bo_ws = await _owner_scope(db, "bo")
    ana_token, ana_row = await tokens_repo.mint(ana, db, name="ana's")
    await tokens_repo.mint(bo, db, name="bo's")

    # Listing is the caller's own set and nothing else.
    assert [row.id for row in await tokens_repo.list_tokens(ana, db)] == [ana_row.id]
    assert ana_row.id not in {row.id for row in await tokens_repo.list_tokens(bo, db)}

    # Bo cannot revoke Ana's, and gets "absent", not "forbidden" — a distinguishable
    # 403 would confirm that a guessed id names a real token.
    from majorana_api.repos._base import NotFoundError

    with pytest.raises(NotFoundError):
        await tokens_repo.revoke(bo, db, ana_row.id)

    # And Ana's token still works, so the refusal above changed nothing.
    assert await tokens_repo.resolve_presented(db, ana_token) is not None


async def test_the_token_routes_are_not_reachable_by_a_token(db):
    """A credential that could mint another, or revoke the one used to stop it, is a
    privilege escalation with extra steps. Asserted end to end rather than only in the
    policy table, because this is the one that matters if the wiring is wrong."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, row = await tokens_repo.mint(scope, db, name="ambitious", scopes=[TokenScope.RUN])

    async with _client(db) as client:
        listing = await client.get("/v1/tokens", headers=_auth(token))
        minting = await client.post(
            "/v1/tokens", headers=_auth(token), json={"name": "a second one"}
        )
        revoking = await client.delete(f"/v1/tokens/{row.id}", headers=_auth(token))

    assert [listing.status_code, minting.status_code, revoking.status_code] == [403, 403, 403]


async def test_a_run_token_cannot_reach_the_ibm_key_or_billing(db):
    """The owner's exclusion, end to end and on the widest token that can be minted."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, _row = await tokens_repo.mint(scope, db, name="wide", scopes=[TokenScope.RUN])

    async with _client(db) as client:
        for path in ("/v1/qpu/credentials", "/v1/billing/status"):
            assert (await client.get(path, headers=_auth(token))).status_code == 403
        # And the hardware submission route, which no scope can grant.
        submitted = await client.post("/v1/qpu/submissions", headers=_auth(token), json={})
    assert submitted.status_code == 403


async def test_a_read_only_token_cannot_start_a_run_and_says_why(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, _row = await tokens_repo.mint(scope, db, name="read only")

    async with _client(db) as client:
        response = await client.post("/v1/runs", headers=_auth(token), json={})

    assert response.status_code == 403
    # The machine-readable reason is what lets a client say "mint one with more scope"
    # rather than "this will never work", which are different instructions.
    assert "token_scope_insufficient" in response.text


# ------------------------------------------------------------------ the switch, and the secret


async def test_nothing_works_while_the_feature_is_switched_off(db):
    """`personal_access_tokens_enabled` is a kill switch, not a hidden button: a token
    minted while it was on stops working the moment it is off, and the routes answer
    404 rather than advertising a feature that is merely disabled here."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    token, _row = await tokens_repo.mint(scope, db, name="minted while on")

    async with _client(db, enabled=False) as client:
        assert (await client.get("/v1/me", headers=_auth(token))).status_code == 401
        assert (await client.get("/v1/tokens", headers=_auth(token))).status_code in (401, 404)


async def test_the_secret_is_in_the_minting_response_and_nowhere_else(db, caplog):
    """§2's "logs proven token-free", plus the responses.

    The check is on the SECRET itself, searched for in whatever was emitted — not on a
    field name, which would pass just as happily if the value were being logged under a
    different key.
    """
    scope, _user, _ws = await _owner_scope(db, "ana")

    # Minted through the repository rather than through `POST /v1/tokens`: that route
    # needs a browser session, and this suite deliberately drives the auth chain with a
    # bearer token and nothing else. What is under test is where the secret GOES, which
    # is the same either way.
    with caplog.at_level(logging.DEBUG):
        async with _client(db) as client:
            token, row = await tokens_repo.mint(scope, db, name="probe")
            listing = await client.get("/v1/me", headers=_auth(token))
            assert listing.status_code == 200
            rows = await tokens_repo.list_tokens(scope, db)

    secret = token.removeprefix(TOKEN_PREFIX)
    # Not in any response body this request produced.
    assert secret not in listing.text
    # Not in the stored row, under any column.
    stored = " ".join(str(getattr(row, name)) for name in ("token_hash", "tail", "name"))
    assert secret not in stored
    assert row.tail == secret[-4:]
    # Not in anything that was logged, at any level.
    emitted = " ".join(record.getMessage() for record in caplog.records)
    assert secret not in emitted
    assert token not in emitted
    # And the listing projection cannot carry one: no field of it holds a secret.
    assert all(secret not in str(tokens_repo.to_resource(r)) for r in rows)


async def test_an_account_cannot_hold_more_than_the_ceiling(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    for index in range(MAX_TOKENS_PER_USER):
        await tokens_repo.mint(scope, db, name=f"token {index}")

    with pytest.raises(tokens_repo.TokenLimitReached):
        await tokens_repo.mint(scope, db, name="one too many")

    # Revoking one makes room again: the ceiling counts LIVE tokens, not rows ever made.
    live = [row for row in await tokens_repo.list_tokens(scope, db) if row.revoked_at is None]
    await tokens_repo.revoke(scope, db, live[0].id)
    _token, row = await tokens_repo.mint(scope, db, name="room again")
    assert row.id is not None


# ------------------------------------------------------------------ idempotency, on Postgres


async def test_a_replayed_idempotency_key_refuses_rather_than_minting_a_second_token(db):
    """The harm this exists to prevent: a caller whose response was lost retries, gets a
    SECOND credential, and the first stays live and unknown to them forever.

    So a replay is 409 carrying the first token's id and tail — what somebody needs in
    order to revoke it — and the account still holds exactly one token afterwards.
    """
    scope, _user, _ws = await _owner_scope(db, "ana")
    key = f"retry-{uuid.uuid4().hex[:8]}"
    first_secret, first = await tokens_repo.mint(
        scope, db, name="editor plugin", idempotency_key=key
    )

    with pytest.raises(tokens_repo.IdempotencyKeyAlreadyMinted) as replayed:
        await tokens_repo.mint(scope, db, name="editor plugin", idempotency_key=key)

    assert replayed.value.row.id == first.id
    assert replayed.value.row.tail == first.tail
    assert [row.id for row in await tokens_repo.list_tokens(scope, db)] == [first.id]
    # The first token is untouched and still works — the refusal changed nothing.
    assert await tokens_repo.resolve_presented(db, first_secret) is not None


async def test_the_same_key_with_a_different_request_is_refused_as_reused(db):
    """`POST /v1/comments`'s contract, applied here: a key is a promise about one
    request. Answering a different ask with it would hand somebody a token whose
    scopes or lifetime are not the ones they just asked for."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    key = f"reused-{uuid.uuid4().hex[:8]}"
    await tokens_repo.mint(scope, db, name="editor plugin", idempotency_key=key)

    with pytest.raises(tokens_repo.IdempotencyKeyReused):
        await tokens_repo.mint(
            scope, db, name="editor plugin", scopes=[TokenScope.RUN], idempotency_key=key
        )
    assert len(await tokens_repo.list_tokens(scope, db)) == 1


async def test_one_persons_key_never_reaches_anothers_token(db):
    """The idempotency index is per USER, not per workspace. Two people who happen to
    choose the same string must each get their own token, and neither lookup may ever
    return the other's — which here would be handing somebody another account's
    credential id."""
    ana, _au, _aw = await _owner_scope(db, "ana")
    bo, _bu, _bw = await _owner_scope(db, "bo")
    key = "deploy"

    _ana_secret, ana_row = await tokens_repo.mint(ana, db, name="ci", idempotency_key=key)
    _bo_secret, bo_row = await tokens_repo.mint(bo, db, name="ci", idempotency_key=key)

    assert ana_row.id != bo_row.id
    assert [row.id for row in await tokens_repo.list_tokens(ana, db)] == [ana_row.id]
    assert [row.id for row in await tokens_repo.list_tokens(bo, db)] == [bo_row.id]


async def test_the_mint_takes_the_callers_user_row_lock_before_counting(db):
    """The check-then-insert that bounds an account at `MAX_TOKENS_PER_USER` is only
    a bound if it is serialised (Greptile, PR 973).

    Asserted structurally rather than by racing two transactions: a real race needs two
    connections and a barrier, and a test that merely *usually* interleaves them is a
    test that passes for the wrong reason most days. What makes the bound hold is that
    the statement is issued at all and before the count, so that is what is read — off
    the compiled SQL, which is the artefact Postgres actually receives.
    """
    statements: list[str] = []

    class _Recorder:
        def __init__(self, inner):
            self._inner = inner

        async def execute(self, statement, *args, **kwargs):
            statements.append(str(statement.compile(compile_kwargs={"literal_binds": False})))
            return await self._inner.execute(statement, *args, **kwargs)

        def __getattr__(self, name):
            return getattr(self._inner, name)

    scope, _user, _ws = await _owner_scope(db, "ana")
    await tokens_repo.mint(scope, _Recorder(db), name="probe")

    locking = [sql for sql in statements if "FOR UPDATE" in sql.upper()]
    assert locking, f"no row lock was taken; statements were: {statements}"
    assert "users" in locking[0].lower()
    # And it is the FIRST thing, before the count it protects.
    assert statements.index(locking[0]) < next(
        index
        for index, sql in enumerate(statements)
        if "personal_access_tokens" in sql.lower() and "select" in sql.lower()
    )
    # Guard on the probe itself: an empty capture would make the `index` comparison
    # above unreachable rather than false, and a recorder that silently stopped
    # recording must not read as "no lock was needed".
    assert len(statements) >= 2
