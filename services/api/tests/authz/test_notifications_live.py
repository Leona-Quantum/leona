"""Notifications against real Postgres (ai-ops 349, option 2, migration 0073).

Two producers write here — `qpu_runs.transition` and `comments._replace_mentions`
— and neither is this module's own repository, so what only a database can
prove is the same "absent or not yours" shape every other per-recipient table in
this repository gives:

- a hardware run reaching a terminal state notifies its OWN owner, and only on
  the transition INTO a terminal state, never on the way through RUNNING;
- a comment newly mentioning someone notifies THEM, once — re-saving an
  unchanged comment does not notify again, and a mention removed and re-added
  does;
- one account cannot read, count or mark another's notifications, at the
  repository layer and over real HTTP;
- retention actually deletes an old row rather than merely hiding it;
- a personal access token can read this inbox and cannot mark anything in it,
  the default-shut rule with nothing added to open it.

Uses the `db` fixture (one session, rolled back after the test), matching
`test_personal_access_tokens_live.py`: single-session tests do not need the
commit-and-clean-up shape `test_comments_live.py` uses for multiple clients on
multiple connections.
"""

from __future__ import annotations

import datetime as dt
import uuid

import httpx
import pytest
from majorana_contracts import CommentTargetType, Scope
from majorana_contracts.enums import QpuRunStatus, Role, RunMode
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.mentions import Member, handles_for
from majorana_api.orm import Notification as NotificationRow
from majorana_api.orm import User, Workspace
from majorana_api.repos import comments as comments_repo
from majorana_api.repos import notifications as notifications_repo
from majorana_api.repos import personal_access_tokens as tokens_repo
from majorana_api.repos import qpu_runs as qpu_runs_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.repos._base import NotFoundError
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
        workos_user_id=f"notif-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@notif.test",
        display_name=tag.title(),
    )


async def _owner_scope(db, tag: str) -> tuple[Scope, User, Workspace]:
    user, workspace = await _person(db, tag)
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER), user, workspace


async def _submit_record(scope, db, *, fingerprint: str):
    return await qpu_runs_repo.create_record(
        scope,
        db,
        device_id="ibm.open_plan",
        provider="ibm",
        shots=128,
        qasm=f"OPENQASM 3.0; // {fingerprint}",
        source_fingerprint=fingerprint,
        estimate_basis="free_tier_allowance",
        estimated_total_usd=None,
        rate_source="https://example.invalid/rates",
        rate_confirmed_on="2026-09-22",
    )


async def _finish(scope, db, record, status: QpuRunStatus, **kwargs):
    """QUEUED -> RUNNING -> `status`: `_ALLOWED_TRANSITIONS` has no direct
    QUEUED -> DONE/ERROR/CANCELLED edge from a record that reached the provider,
    and every terminal-with-a-result test here means "it ran and then closed"."""
    await qpu_runs_repo.transition(scope, db, record.id, QpuRunStatus.RUNNING)
    return await qpu_runs_repo.transition(scope, db, record.id, status, **kwargs)


@pytest.fixture
async def db():
    from majorana_api.db import engine_from_env, session_factory

    engine = engine_from_env()
    async with session_factory(engine)() as session:
        yield session
        await session.rollback()
    await engine.dispose()


async def _inbox(scope, db) -> list[NotificationRow]:
    rows, _unread = await notifications_repo.list_notifications(scope, db)
    return rows


# ------------------------------------------------------------------ hardware runs


async def test_a_run_reaching_a_terminal_state_notifies_its_own_owner(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    record = await _submit_record(scope, db, fingerprint="fnv1a-done")

    await qpu_runs_repo.transition(scope, db, record.id, QpuRunStatus.RUNNING)
    assert await _inbox(scope, db) == []  # not terminal yet: no notification

    await qpu_runs_repo.transition(scope, db, record.id, QpuRunStatus.DONE, raw_counts={"00": 128})

    inbox = await _inbox(scope, db)
    assert len(inbox) == 1
    assert inbox[0].kind == "qpu_run_terminal"
    assert inbox[0].data["qpu_run_id"] == str(record.id)
    assert inbox[0].data["status"] == "done"
    assert "ibm.open_plan" in inbox[0].data["device_id"] or inbox[0].data["device_id"]
    assert inbox[0].read_at is None


@pytest.mark.parametrize(
    ("status", "kwargs"),
    [
        (QpuRunStatus.ERROR, {"error": "provider reported ERROR"}),
        (QpuRunStatus.CANCELLED, {"error": "cancelled by provider"}),
    ],
)
async def test_error_and_cancelled_also_notify(db, status, kwargs):
    scope, _user, _ws = await _owner_scope(db, "ana")
    record = await _submit_record(scope, db, fingerprint=f"fnv1a-{status.value}")

    await qpu_runs_repo.transition(scope, db, record.id, status, **kwargs)

    inbox = await _inbox(scope, db)
    assert len(inbox) == 1
    assert inbox[0].data["status"] == status.value


async def test_a_run_closed_before_it_was_ever_submitted_still_notifies(db):
    """The API's own "gate closed after enqueue" / "already attempted" paths
    transition straight from QUEUED to ERROR without ever reaching RUNNING —
    the same `transition` call, so the same notification."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    record = await _submit_record(scope, db, fingerprint="fnv1a-neverran")

    await qpu_runs_repo.transition(
        scope, db, record.id, QpuRunStatus.ERROR, error="submission gate closed after enqueue"
    )

    inbox = await _inbox(scope, db)
    assert len(inbox) == 1
    assert inbox[0].data["status"] == "error"


# ------------------------------------------------------------------ mentions


async def _mentionable(host_scope, guest_user, db) -> str:
    """Add `guest_user` to the host's workspace and return the handle a
    comment there mentions them with."""
    await workspaces_repo.add_member(host_scope, db, user_id=guest_user.id, role=Role.MEMBER)
    people = await comments_repo.list_people(host_scope, db)
    handle = next(p.handle for p in people if p.user_id == guest_user.id)
    return handle


async def test_a_new_mention_notifies_the_person_mentioned_once(db):
    host, host_user, host_ws = await _owner_scope(db, "host")
    guest_user, _guest_ws = await _person(db, "guest")
    handle = await _mentionable(host, guest_user, db)
    guest_scope = Scope(user_id=guest_user.id, workspace_id=host_ws.id, role=Role.MEMBER)

    run = await runs_repo.create_run(
        host, db, task_prompt="notif target", mode=RunMode.EXECUTE, framework="qiskit"
    )
    read = await comments_repo.create_comment(
        host,
        db,
        target_type=CommentTargetType.RUN,
        target_id=run.id,
        body=f"hey @{handle} look at this",
    )
    comment = read.comments[0]

    inbox = await _inbox(guest_scope, db)
    assert len(inbox) == 1
    assert inbox[0].kind == "mention"
    assert inbox[0].data == {
        "comment_id": str(comment.id),
        "target_type": "run",
        "target_id": str(run.id),
    }
    assert host_user.display_name in inbox[0].summary

    # Re-saving the SAME mentions must not notify a second time.
    await comments_repo.update_comment(host, db, comment.id, body=f"hey @{handle} look at this!!")
    assert len(await _inbox(guest_scope, db)) == 1

    # Editing the mention OUT and back IN notifies again: from this comment's
    # point of view it is a new mention each time, and the person really was
    # told, dropped, and told again.
    await comments_repo.update_comment(host, db, comment.id, body="never mind")
    assert len(await _inbox(guest_scope, db)) == 1  # unchanged: no new mention was added
    await comments_repo.update_comment(host, db, comment.id, body=f"actually @{handle} yes")
    assert len(await _inbox(guest_scope, db)) == 2


async def test_mentioning_yourself_notifies_nobody(db):
    """`resolve_mentions` already drops the author; this is the notification
    side of the same rule, checked so it stays true if that ever changes."""
    scope, user, _ws = await _owner_scope(db, "ana")
    own_handle = handles_for(
        [Member(user_id=user.id, email=user.email, display_name=user.display_name)]
    )[user.id]
    run = await runs_repo.create_run(
        scope, db, task_prompt="self mention", mode=RunMode.EXECUTE, framework="qiskit"
    )
    await comments_repo.create_comment(
        scope,
        db,
        target_type=CommentTargetType.RUN,
        target_id=run.id,
        body=f"talking to @{own_handle} myself",
    )
    assert await _inbox(scope, db) == []


# ------------------------------------------------------------------ one account, one inbox


async def test_one_account_cannot_read_count_or_mark_anothers_notifications(db):
    ana, _ana_user, _ana_ws = await _owner_scope(db, "ana")
    bo, _bo_user, _bo_ws = await _owner_scope(db, "bo")
    ana_record = await _submit_record(ana, db, fingerprint="fnv1a-ana")
    await _finish(ana, db, ana_record, QpuRunStatus.DONE, raw_counts={})

    ana_inbox = await _inbox(ana, db)
    assert len(ana_inbox) == 1
    assert await _inbox(bo, db) == []
    assert await notifications_repo.unread_count(bo, db) == 0

    with pytest.raises(NotFoundError):
        await notifications_repo.mark_read(bo, db, ana_inbox[0].id)

    # Bo's refusal changed nothing of Ana's.
    assert (await _inbox(ana, db))[0].read_at is None


async def test_mark_read_is_idempotent_and_scoped_to_the_caller(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    record = await _submit_record(scope, db, fingerprint="fnv1a-markread")
    await _finish(scope, db, record, QpuRunStatus.DONE, raw_counts={})
    notification = (await _inbox(scope, db))[0]
    assert await notifications_repo.unread_count(scope, db) == 1

    first = await notifications_repo.mark_read(scope, db, notification.id)
    second = await notifications_repo.mark_read(scope, db, notification.id)

    assert first.read_at is not None
    assert first.read_at == second.read_at  # the second call did not move it
    assert await notifications_repo.unread_count(scope, db) == 0


async def test_mark_all_read_clears_every_unread_row_for_the_caller_only(db):
    ana, _ana_user, _ana_ws = await _owner_scope(db, "ana")
    bo, _bo_user, _bo_ws = await _owner_scope(db, "bo")
    for tag in ("a", "b", "c"):
        record = await _submit_record(ana, db, fingerprint=f"fnv1a-all-{tag}")
        await _finish(ana, db, record, QpuRunStatus.DONE, raw_counts={})
    bo_record = await _submit_record(bo, db, fingerprint="fnv1a-bo")
    await _finish(bo, db, bo_record, QpuRunStatus.DONE, raw_counts={})

    await notifications_repo.mark_all_read(ana, db)

    assert await notifications_repo.unread_count(ana, db) == 0
    assert await notifications_repo.unread_count(bo, db) == 1  # untouched


# ------------------------------------------------------------------ retention


async def test_retention_deletes_an_old_row_of_the_same_recipient_on_the_next_write(db):
    scope, _user, _ws = await _owner_scope(db, "ana")
    old_cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(
        days=notifications_repo.RETENTION_DAYS + 1
    )
    old_record = await _submit_record(scope, db, fingerprint="fnv1a-old")
    old = await notifications_repo.create_qpu_run_terminal(
        scope,
        db,
        user_id=scope.user_id,
        workspace_id=scope.workspace_id,
        qpu_run_id=old_record.id,
        device_id="ibm.open_plan",
        status=QpuRunStatus.DONE,
        now=old_cutoff,
    )
    await db.flush()

    fresh_record = await _submit_record(scope, db, fingerprint="fnv1a-fresh")
    await _finish(scope, db, fresh_record, QpuRunStatus.DONE, raw_counts={})

    inbox = await _inbox(scope, db)
    assert old.id not in {row.id for row in inbox}
    assert len(inbox) == 1


# ------------------------------------------------------------------ over real HTTP


def _http_client(db) -> httpx.AsyncClient:
    """Bearer-token client, matching `test_personal_access_tokens_live.py`:
    the real auth dependency chain resolves the token, so this proves what a
    caller actually gets, not what an overridden scope would."""
    import contextlib

    from majorana_api.auth import deps as auth_deps

    @contextlib.asynccontextmanager
    async def _fixture_session(db):
        yield db

    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.state.auth_session_factory = lambda: _fixture_session(db)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _session_client(db, scope: Scope, user: User, workspace: Workspace) -> httpx.AsyncClient:
    """A signed-in-style client (`dependency_overrides`, matching
    `test_comments_live.py`), for a route-level test that is about the
    NOTIFICATION's owner, not about a token's own restrictions — those have
    their own test below with a real bearer token."""
    from majorana_api.auth import deps as auth_deps

    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def test_someone_elses_notification_is_404_over_http(db):
    ana, _ana_user, _ana_ws = await _owner_scope(db, "ana")
    bo, bo_user, bo_ws = await _owner_scope(db, "bo")
    record = await _submit_record(ana, db, fingerprint="fnv1a-http")
    await _finish(ana, db, record, QpuRunStatus.DONE, raw_counts={})
    ana_notification = (await _inbox(ana, db))[0]

    async with _session_client(db, bo, bo_user, bo_ws) as client:
        response = await client.post(f"/v1/notifications/{ana_notification.id}/read")

    assert response.status_code == 404
    # Bo's refused request changed nothing of Ana's.
    assert (await _inbox(ana, db))[0].read_at is None


async def test_a_token_can_read_the_inbox_but_cannot_mark_anything_read(db):
    """Reads default open, writes default shut, and nothing was added to
    `token_access.py`'s allowlists for this feature — see that module."""
    scope, _user, _ws = await _owner_scope(db, "ana")
    record = await _submit_record(scope, db, fingerprint="fnv1a-token")
    await _finish(scope, db, record, QpuRunStatus.DONE, raw_counts={})
    notification = (await _inbox(scope, db))[0]

    token, _row = await tokens_repo.mint(scope, db, name="read only inbox")

    async with _http_client(db) as client:
        listing = await client.get("/v1/notifications", headers=_auth(token))
        marking = await client.post(
            f"/v1/notifications/{notification.id}/read", headers=_auth(token)
        )
        marking_all = await client.post("/v1/notifications/read-all", headers=_auth(token))

    assert listing.status_code == 200
    body = listing.json()
    assert body["unread_count"] == 1
    assert [item["id"] for item in body["items"]] == [str(notification.id)]
    assert marking.status_code == 403
    assert marking_all.status_code == 403
