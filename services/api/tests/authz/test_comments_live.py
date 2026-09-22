"""`/v1/comments` over real HTTP, against real Postgres (proposal 9, migration 0068).

`test_authz_matrix.py` proves the repository functions apply the workspace
predicate. This drives the routes a browser calls, with one client per person,
and pins the rules an owner would want to know about:

- **Every route refuses another workspace's things with the same 404 it gives
  for a thing that does not exist**, byte for byte, so a probe learns nothing.
- **Viewers read and do not write.** Only the author edits. The author, or an
  owner or admin, deletes; a delete by someone else is audited.
- **A mention reaches current members of the same workspace and nobody else**:
  not a person with an account in another workspace, not someone who has left,
  and not after they leave.
- **A deleted comment keeps its place in its thread**, with nothing it said.

Lives in `authz/` so CI's authz step runs it as `majorana_api`, the role
production connects as. It commits (several clients, several sessions), so it
removes what it wrote.
"""

import uuid

import httpx
import pytest
from majorana_contracts import CommentTargetType, Scope
from majorana_contracts.enums import Role, RunMode
from matrix_helpers import requires_db
from repo_test_helpers import delete_committed_tenants
from sqlalchemy import func, select

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.db import engine_from_env, session_factory
from majorana_api.orm import AuditLog, CommentMention, User
from majorana_api.repos import artifacts as artifacts_repo
from majorana_api.repos import comments
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import runs as runs_repo
from majorana_api.repos import system, workspaces
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

COMMENT_KEYS = {
    "id",
    "workspace_id",
    "target_type",
    "target_id",
    "parent_id",
    "author",
    "body",
    "mentions",
    "created_at",
    "edited_at",
    "deleted_at",
    "can_edit",
    "can_delete",
}


def _client(factory, engine, scope, user, workspace, **overrides) -> httpx.AsyncClient:
    app = create_app(Settings(**{**SETTINGS, **overrides}))
    app.state.engine = engine
    app.state.session_factory = factory
    app.dependency_overrides[auth_deps.get_scope] = lambda: scope
    app.dependency_overrides[auth_deps.get_identity] = lambda: (
        User(id=user.id, email=user.email, plan=user.plan),
        workspace,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


async def _targets(scope, session, tag):
    run = await runs_repo.create_run(
        scope, session, task_prompt=f"comments {tag}", mode=RunMode.EXECUTE, framework="qiskit"
    )
    notebook, _version = await notebooks_repo.create_notebook(
        scope,
        session,
        slug=f"comments-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"Notebook {tag}",
        kind="lesson",
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={},
        run_id=None,
    )
    artifact = await artifacts_repo.create_artifact(
        scope,
        session,
        slug=f"comments-{tag}-{uuid.uuid4().hex[:8]}",
        title=f"Circuit {tag}",
        family="Bell",
        framework="qiskit",
        kept=True,
    )
    return {"run": run.id, "notebook": notebook.id, "artifact": artifact.id}


@pytest.fixture
async def stage():
    """Workspace A: owner, admin, member, second member, viewer, and a member who
    will leave. Workspace B: its owner, who has an account and is in A's address
    book of nothing. Each workspace has a run, a notebook and a saved circuit."""
    engine = engine_from_env()
    factory = session_factory(engine)
    tag = uuid.uuid4().hex[:8]
    people = {}
    async with factory() as session:
        for name in ("owner", "admin", "member", "member2", "viewer", "leaver", "bob"):
            user, personal = await system.get_or_provision_user(
                session,
                workos_user_id=f"comments-{name}-{tag}",
                email=f"{name}-{tag}@comments.test",
                display_name=f"{name.title()} {tag}",
            )
            people[name] = (user, personal)
        owner_user, ws_a = people["owner"]
        bob_user, ws_b = people["bob"]
        owner_scope = Scope(user_id=owner_user.id, workspace_id=ws_a.id, role=Role.OWNER)
        roles = {
            "owner": Role.OWNER,
            "admin": Role.ADMIN,
            "member": Role.MEMBER,
            "member2": Role.MEMBER,
            "viewer": Role.VIEWER,
            "leaver": Role.MEMBER,
        }
        for name, role in roles.items():
            if name != "owner":
                await workspaces.add_member(
                    owner_scope, session, user_id=people[name][0].id, role=role
                )
        bob_scope = Scope(user_id=bob_user.id, workspace_id=ws_b.id, role=Role.OWNER)
        targets_a = await _targets(owner_scope, session, f"a-{tag}")
        targets_b = await _targets(bob_scope, session, f"b-{tag}")
        await session.commit()

    scopes = {
        name: Scope(user_id=people[name][0].id, workspace_id=ws_a.id, role=role)
        for name, role in roles.items()
    }
    scopes["bob"] = bob_scope
    clients = {
        name: _client(
            factory,
            engine,
            scopes[name],
            people[name][0],
            ws_b if name == "bob" else ws_a,
        )
        for name in scopes
    }
    try:
        yield {
            "tag": tag,
            "factory": factory,
            "engine": engine,
            "people": people,
            "scopes": scopes,
            "clients": clients,
            "a": targets_a,
            "b": targets_b,
            "ws_a": ws_a.id,
            "ws_b": ws_b.id,
            "owner_scope": owner_scope,
        }
    finally:
        for client in clients.values():
            await client.aclose()
        await delete_committed_tenants(
            factory,
            [personal.id for _user, personal in people.values()],
            [user.id for user, _personal in people.values()],
        )
        await engine.dispose()


def _handle(stage, name: str) -> str:
    return f"{name}-{stage['tag']}"


async def _post(client, target_type, target_id, body, parent_id=None):
    payload = {"target_type": target_type, "target_id": str(target_id), "body": body}
    if parent_id is not None:
        payload["parent_id"] = str(parent_id)
    return await client.post("/v1/comments", json=payload)


async def _thread(client, target_type, target_id, **params):
    return await client.get(
        "/v1/comments",
        params={"target_type": target_type, "target_id": str(target_id), **params},
    )


async def test_a_thread_round_trips_on_all_three_kinds_of_thing(stage):
    member = stage["clients"]["member"]
    for kind in ("run", "notebook", "artifact"):
        created = await _post(
            member,
            kind,
            stage["a"][kind],
            f"  First look at this {kind} @{_handle(stage, 'admin')}  ",
        )
        assert created.status_code == 201, created.text
        comment = created.json()
        assert set(comment) == COMMENT_KEYS, "the resource is the contract"
        assert comment["body"] == f"First look at this {kind} @{_handle(stage, 'admin')}"
        assert comment["author"] == {
            "user_id": str(stage["scopes"]["member"].user_id),
            "display_name": f"Member {stage['tag']}",
            "handle": _handle(stage, "member"),
            "current_member": True,
        }
        assert [m["handle"] for m in comment["mentions"]] == [_handle(stage, "admin")]
        assert (comment["can_edit"], comment["can_delete"]) == (True, True)

        second = await _post(member, kind, stage["a"][kind], "and a second thought")
        assert second.status_code == 201
        listed = await _thread(member, kind, stage["a"][kind])
        assert listed.status_code == 200, listed.text
        ids = [item["id"] for item in listed.json()["items"]]
        assert ids == [comment["id"], second.json()["id"]], "oldest first"
        assert listed.json()["next_cursor"] is None


async def test_every_route_answers_another_workspace_with_the_404_of_nothing(stage):
    """Bob is signed in to his own workspace. Nothing of A's is reachable, and the
    refusal is byte-identical to the one for an id that exists nowhere."""
    member, bob = stage["clients"]["member"], stage["clients"]["bob"]
    posted = {}
    for kind in ("run", "notebook", "artifact"):
        created = await _post(
            member, kind, stage["a"][kind], f"A's {kind} @{_handle(stage, 'bob')}"
        )
        assert created.status_code == 201
        posted[kind] = created.json()
        # Bob mentioned by handle and by full address: neither reaches him.
        assert created.json()["mentions"] == []
    absent = await _thread(bob, "run", uuid.uuid4())
    assert absent.status_code == 404
    nothing = absent.content

    for kind in ("run", "notebook", "artifact"):
        foreign = await _thread(bob, kind, stage["a"][kind])
        assert (foreign.status_code, foreign.content) == (404, nothing)
        write = await _post(bob, kind, stage["a"][kind], "reaching in")
        assert (write.status_code, write.content) == (404, nothing)
        # A's comment as the parent of a reply on Bob's OWN thing: still absent.
        reply = await _post(bob, kind, stage["b"][kind], "reply", parent_id=posted[kind]["id"])
        assert (reply.status_code, reply.content) == (404, nothing)
        edit = await bob.patch(f"/v1/comments/{posted[kind]['id']}", json={"body": "mine now"})
        assert (edit.status_code, edit.content) == (404, nothing)
        removed = await bob.delete(f"/v1/comments/{posted[kind]['id']}")
        assert (removed.status_code, removed.content) == (404, nothing)

    unknown_edit = await bob.patch(f"/v1/comments/{uuid.uuid4()}", json={"body": "x"})
    assert (unknown_edit.status_code, unknown_edit.content) == (404, nothing)

    inbox = await bob.get("/v1/comments/mentions")
    assert inbox.status_code == 200
    assert inbox.json() == {"items": [], "next_cursor": None, "can_comment": True}
    people = await bob.get("/v1/comments/people")
    assert people.json()["items"] == [], "Bob's workspace has nobody else in it to mention"

    # And A's thread is untouched by all of it.
    for kind in ("run", "notebook", "artifact"):
        items = (await _thread(member, kind, stage["a"][kind])).json()["items"]
        assert [(i["id"], i["body"]) for i in items] == [(posted[kind]["id"], posted[kind]["body"])]


async def test_viewer_reads_but_cannot_write(stage):
    member, viewer = stage["clients"]["member"], stage["clients"]["viewer"]
    run = stage["a"]["run"]
    comment = (await _post(member, "run", run, "for everyone to read")).json()

    listed = await _thread(viewer, "run", run)
    assert listed.status_code == 200
    assert listed.json()["can_comment"] is False
    assert (await _thread(member, "run", run)).json()["can_comment"] is True
    [seen] = listed.json()["items"]
    assert seen["body"] == "for everyone to read"
    assert (seen["can_edit"], seen["can_delete"]) == (False, False)

    assert (await _post(viewer, "run", run, "may I?")).status_code == 403
    assert (await _post(viewer, "run", run, "reply?", parent_id=comment["id"])).status_code == 403
    assert (
        await viewer.patch(f"/v1/comments/{comment['id']}", json={"body": "x"})
    ).status_code == 403
    assert (await viewer.delete(f"/v1/comments/{comment['id']}")).status_code == 403
    # Viewers can be mentioned, and can read their inbox.
    mention = await _post(member, "run", run, f"@{_handle(stage, 'viewer')} have a look")
    assert [m["handle"] for m in mention.json()["mentions"]] == [_handle(stage, "viewer")]
    inbox = (await viewer.get("/v1/comments/mentions")).json()["items"]
    assert [i["id"] for i in inbox] == [mention.json()["id"]]


async def test_only_the_author_edits(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    comment = (await _post(clients["member"], "run", run, "draft wording")).json()
    for name in ("member2", "admin", "owner"):
        refused = await clients[name].patch(
            f"/v1/comments/{comment['id']}", json={"body": f"{name} rewrote this"}
        )
        assert refused.status_code == 403, name
    as_seen_by_admin = (await _thread(clients["admin"], "run", run)).json()["items"][0]
    assert as_seen_by_admin["can_edit"] is False and as_seen_by_admin["can_delete"] is True

    edited = await clients["member"].patch(
        f"/v1/comments/{comment['id']}", json={"body": f"final wording @{_handle(stage, 'owner')}"}
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["body"] == f"final wording @{_handle(stage, 'owner')}"
    assert edited.json()["edited_at"] is not None
    assert [m["handle"] for m in edited.json()["mentions"]] == [_handle(stage, "owner")]
    # The edit replaced the mention set: the owner's inbox has it, and a second
    # edit that drops the mention takes it back out.
    assert [
        i["id"] for i in (await clients["owner"].get("/v1/comments/mentions")).json()["items"]
    ] == [comment["id"]]
    await clients["member"].patch(f"/v1/comments/{comment['id']}", json={"body": "no names"})
    assert (await clients["owner"].get("/v1/comments/mentions")).json()["items"] == []

    assert (
        await clients["member"].patch(f"/v1/comments/{comment['id']}", json={"body": "  "})
    ).status_code == 422
    too_long = "x" * 4001
    assert (
        await clients["member"].patch(f"/v1/comments/{comment['id']}", json={"body": too_long})
    ).status_code == 422


async def test_delete_rules_and_the_audit_of_a_moderator(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    by_member = (await _post(clients["member"], "run", run, "one")).json()
    by_member_again = (await _post(clients["member"], "run", run, "two")).json()

    assert (await clients["member2"].delete(f"/v1/comments/{by_member['id']}")).status_code == 403

    own = await clients["member"].delete(f"/v1/comments/{by_member['id']}")
    assert own.status_code == 204 and own.content == b""
    again = await clients["member"].delete(f"/v1/comments/{by_member['id']}")
    assert again.status_code == 204, "a retried delete is not an error"

    moderated = await clients["admin"].delete(f"/v1/comments/{by_member_again['id']}")
    assert moderated.status_code == 204
    async with stage["factory"]() as session:
        actions = (
            await session.execute(
                select(AuditLog.action, AuditLog.actor_user_id).where(
                    AuditLog.target_id.in_(
                        [uuid.UUID(by_member["id"]), uuid.UUID(by_member_again["id"])]
                    )
                )
            )
        ).all()
    assert [(a.action, a.actor_user_id) for a in actions] == [
        ("comment.removed_by_admin", stage["scopes"]["admin"].user_id)
    ], "the author deleting their own words is not moderation; the admin's is"

    edit_after = await clients["member"].patch(
        f"/v1/comments/{by_member['id']}", json={"body": "x"}
    )
    assert edit_after.status_code == 409 and edit_after.json()["reason"] == "comment_deleted"
    reply_after = await _post(clients["member2"], "run", run, "late", parent_id=by_member["id"])
    assert reply_after.status_code == 409 and reply_after.json()["reason"] == "parent_deleted"


async def test_a_deleted_comment_keeps_its_place_in_the_thread(stage):
    clients = stage["clients"]
    notebook = stage["a"]["notebook"]
    parent = (
        await _post(
            clients["member"], "notebook", notebook, f"why this cell? @{_handle(stage, 'admin')}"
        )
    ).json()
    reply = (
        await _post(clients["admin"], "notebook", notebook, "because", parent_id=parent["id"])
    ).json()
    # A reply to a reply is filed under the top of the thread.
    nested = (
        await _post(clients["member2"], "notebook", notebook, "agreed", parent_id=reply["id"])
    ).json()
    assert reply["parent_id"] == parent["id"]
    assert nested["parent_id"] == parent["id"]

    assert (await clients["member"].delete(f"/v1/comments/{parent['id']}")).status_code == 204
    items = (await _thread(clients["viewer"], "notebook", notebook)).json()["items"]
    assert [i["id"] for i in items] == [parent["id"], reply["id"], nested["id"]]
    gone = items[0]
    assert gone["deleted_at"] is not None
    assert (gone["body"], gone["author"], gone["mentions"]) == ("", None, [])
    assert (gone["can_edit"], gone["can_delete"]) == (False, False)
    assert [i["body"] for i in items[1:]] == ["because", "agreed"]
    # The admin was mentioned in the deleted comment; their inbox no longer
    # points at words that are gone.
    assert (await clients["admin"].get("/v1/comments/mentions")).json()["items"] == []

    # A parent from a DIFFERENT thing in the same workspace is not a parent here.
    elsewhere = await _post(clients["member"], "run", stage["a"]["run"], "x", parent_id=reply["id"])
    assert elsewhere.status_code == 404


async def test_mentions_reach_current_members_of_this_workspace_only(stage):
    clients = stage["clients"]
    run = stage["a"]["run"]
    body = (
        f"@{_handle(stage, 'admin')} @{_handle(stage, 'leaver')} @{_handle(stage, 'bob')} "
        f"@bob-{stage['tag']}@comments.test @nobody-{stage['tag']} @{_handle(stage, 'member')}"
    )
    comment = (await _post(clients["member"], "run", run, body)).json()
    # Bob has an account, and is mentioned by handle and by full address: not a
    # member here, so neither resolves. The author is never mentioned.
    assert sorted(m["handle"] for m in comment["mentions"]) == sorted(
        [_handle(stage, "admin"), _handle(stage, "leaver")]
    )
    assert [
        i["id"] for i in (await clients["leaver"].get("/v1/comments/mentions")).json()["items"]
    ] == [comment["id"]]
    leaver_comment = (await _post(clients["leaver"], "run", run, "leaving soon")).json()

    async with stage["factory"]() as session:
        await workspaces.remove_member(
            stage["owner_scope"], session, user_id=stage["scopes"]["leaver"].user_id
        )
        await session.commit()

    items = {i["id"]: i for i in (await _thread(clients["member"], "run", run)).json()["items"]}
    assert [m["handle"] for m in items[comment["id"]]["mentions"]] == [_handle(stage, "admin")], (
        "a person who has left is dropped from the mentions when read"
    )
    assert items[leaver_comment["id"]]["body"] == "leaving soon"
    assert items[leaver_comment["id"]]["author"] == {
        "user_id": str(stage["scopes"]["leaver"].user_id),
        "display_name": None,
        "handle": "",
        "current_member": False,
    }, "a former member is still the author, but is no longer described to the workspace"

    after = (
        await _post(clients["member"], "run", run, f"@{_handle(stage, 'leaver')} still there?")
    ).json()
    assert after["mentions"] == [], "a mention written after they left reaches nobody"
    people = (await clients["member"].get("/v1/comments/people")).json()["items"]
    assert _handle(stage, "leaver") not in {p["handle"] for p in people}
    assert {p["handle"] for p in people} == {
        _handle(stage, n) for n in ("owner", "admin", "member2", "viewer")
    }, "every other current member, and not the caller: a self-mention never resolves"
    assert all(set(p) == {"user_id", "display_name", "handle", "current_member"} for p in people), (
        "no email address leaves in the people list"
    )


async def test_the_inbox_is_newest_first_paged_and_drops_deleted_things(stage):
    clients = stage["clients"]
    admin_handle = _handle(stage, "admin")
    posted = []
    for kind in ("run", "notebook", "artifact", "run"):
        created = await _post(clients["member"], kind, stage["a"][kind], f"@{admin_handle} {kind}")
        posted.append(created.json()["id"])

    first = (await clients["admin"].get("/v1/comments/mentions", params={"limit": 3})).json()
    assert [i["id"] for i in first["items"]] == list(reversed(posted))[:3]
    assert first["next_cursor"] == first["items"][-1]["id"]
    second = (
        await clients["admin"].get(
            "/v1/comments/mentions", params={"limit": 3, "cursor": first["next_cursor"]}
        )
    ).json()
    assert [i["id"] for i in second["items"]] == [posted[0]]
    assert second["next_cursor"] is None

    # The notebook goes; its comment leaves the inbox without being deleted.
    async with stage["factory"]() as session:
        await notebooks_repo.soft_delete_notebook(
            stage["owner_scope"], session, stage["a"]["notebook"]
        )
        await session.commit()
    remaining = (await clients["admin"].get("/v1/comments/mentions")).json()["items"]
    assert [i["id"] for i in remaining] == [posted[3], posted[2], posted[0]]
    assert (await _thread(clients["admin"], "notebook", stage["a"]["notebook"])).status_code == 404


async def test_the_thread_pages_oldest_first_without_gaps(stage):
    member = stage["clients"]["member"]
    run = stage["a"]["run"]
    posted = [(await _post(member, "run", run, f"note {i}")).json()["id"] for i in range(5)]
    seen, cursor, pages = [], None, 0
    while True:
        params = {"limit": 2, **({"cursor": cursor} if cursor else {})}
        page = (await _thread(member, "run", run, **params)).json()
        seen.extend(i["id"] for i in page["items"])
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break
        assert pages < 10
    assert seen == posted and pages == 3


async def test_posting_is_metered_per_person(stage):
    """A second app with a ceiling of two, so the third post in the minute is
    refused, with Retry-After, while a different person is not."""
    scopes, people = stage["scopes"], stage["people"]
    tight = {
        name: _client(
            stage["factory"],
            stage["engine"],
            scopes[name],
            people[name][0],
            people["owner"][1],
            comment_rate_limit_per_minute=2,
        )
        for name in ("member", "member2")
    }
    try:
        run = stage["a"]["run"]
        assert (await _post(tight["member"], "run", run, "1")).status_code == 201
        assert (await _post(tight["member"], "run", run, "2")).status_code == 201
        refused = await _post(tight["member"], "run", run, "3")
        assert refused.status_code == 429
        assert refused.json()["reason"] == "comment_rate_limited"
        assert int(refused.headers["Retry-After"]) >= 1
        assert (await _post(tight["member2"], "run", run, "mine")).status_code == 201
        # Reading is not metered.
        assert (await _thread(tight["member"], "run", run)).status_code == 200
        assert len((await _thread(tight["member"], "run", run)).json()["items"]) == 3
    finally:
        for client in tight.values():
            await client.aclose()


async def test_the_static_paths_are_not_swallowed_by_the_id_route(stage):
    """`/comments/mentions` and `/comments/people` sit beside `/comments/{id}`.
    Checked with real requests, per the router's own quirk: a path match with
    the wrong method is not a short-circuit."""
    member = stage["clients"]["member"]
    assert (await member.get("/v1/comments/mentions")).status_code == 200
    assert (await member.get("/v1/comments/people")).status_code == 200
    # The id route has no GET, and a static word is not an id.
    assert (await member.patch("/v1/comments/mentions", json={"body": "x"})).status_code == 422
    assert (await member.delete("/v1/comments/people")).status_code == 422
    assert (await member.get(f"/v1/comments/{uuid.uuid4()}")).status_code == 405
    assert (
        await member.get(
            "/v1/comments", params={"target_type": "project", "target_id": str(uuid.uuid4())}
        )
    ).status_code == 422


async def _post_keyed(client, target_type, target_id, body, key, parent_id=None):
    payload = {"target_type": target_type, "target_id": str(target_id), "body": body}
    if parent_id is not None:
        payload["parent_id"] = str(parent_id)
    return await client.post("/v1/comments", json=payload, headers={"Idempotency-Key": key})


async def test_a_retry_with_the_same_key_returns_the_original_and_creates_nothing(stage):
    """The lost-response retry (Greptile, PR 968): same key, same request, twice."""
    clients = stage["clients"]
    run = stage["a"]["run"]
    key = f"retry-{uuid.uuid4()}"
    body = f"did the seed change? @{_handle(stage, 'admin')}"

    first = await _post_keyed(clients["member"], "run", run, body, key)
    assert first.status_code == 201, first.text
    # Whitespace around the body is trimmed before hashing, so this is the same request.
    again = await _post_keyed(clients["member"], "run", run, f"  {body}\n", key)
    assert again.status_code == 201, again.text
    assert again.json() == first.json(), "the retry gets the original comment back, unchanged"

    items = (await _thread(clients["member"], "run", run)).json()["items"]
    assert [i["id"] for i in items] == [first.json()["id"]], "nothing new was written"
    inbox = (await clients["admin"].get("/v1/comments/mentions")).json()["items"]
    assert [i["id"] for i in inbox] == [first.json()["id"]], "the mention was not sent twice"
    async with stage["factory"]() as session:
        mention_rows = (
            await session.execute(
                select(func.count())
                .select_from(CommentMention)
                .where(CommentMention.comment_id == uuid.UUID(first.json()["id"]))
            )
        ).scalar_one()
    assert mention_rows == 1


async def test_a_reused_key_with_a_different_request_is_refused_and_writes_nothing(stage):
    clients = stage["clients"]
    run, notebook = stage["a"]["run"], stage["a"]["notebook"]
    key = f"reuse-{uuid.uuid4()}"
    original = await _post_keyed(clients["member"], "run", run, "first words", key)
    assert original.status_code == 201

    for target_type, target_id, body in (
        ("run", run, "different words"),
        ("notebook", notebook, "first words"),
    ):
        refused = await _post_keyed(clients["member"], target_type, target_id, body, key)
        assert refused.status_code == 409, refused.text
        assert refused.json()["reason"] == "idempotency_key_reused"
    assert [i["body"] for i in (await _thread(clients["member"], "run", run)).json()["items"]] == [
        "first words"
    ]
    assert (await _thread(clients["member"], "notebook", notebook)).json()["items"] == []

    # A key is the author's own: someone else using the same string gets their
    # own comment, never the first author's back.
    theirs = await _post_keyed(clients["member2"], "run", run, "first words", key)
    assert theirs.status_code == 201
    assert theirs.json()["id"] != original.json()["id"]
    assert theirs.json()["author"]["user_id"] == str(stage["scopes"]["member2"].user_id)

    too_long = await _post_keyed(clients["member"], "run", run, "x", "k" * 256)
    assert too_long.status_code == 422


async def test_a_retry_is_not_charged_against_the_posting_limit(stage):
    scopes, people = stage["scopes"], stage["people"]
    tight = _client(
        stage["factory"],
        stage["engine"],
        scopes["member"],
        people["member"][0],
        people["owner"][1],
        comment_rate_limit_per_minute=1,
    )
    try:
        run = stage["a"]["run"]
        key = f"metered-{uuid.uuid4()}"
        assert (await _post_keyed(tight, "run", run, "only one", key)).status_code == 201
        retry = await _post_keyed(tight, "run", run, "only one", key)
        assert retry.status_code == 201, "the comment exists; returning it costs no allowance"
        assert (await _post(tight, "run", run, "a second one")).status_code == 429
    finally:
        await tight.aclose()


async def test_two_inserts_racing_on_one_key_become_in_flight_not_a_500(stage):
    """The window the route's lookup cannot close: both requests passed it. Driven
    at the repository, where the unique index is what decides."""
    scope = stage["scopes"]["member"]
    key = f"race-{uuid.uuid4()}"
    async with stage["factory"]() as session:
        await comments.create_comment(
            scope,
            session,
            target_type=CommentTargetType.RUN,
            target_id=stage["a"]["run"],
            body="winner",
            idempotency_key=key,
            idempotency_request_hash="a" * 64,
        )
        with pytest.raises(comments.CommentIdempotencyKeyInFlight):
            await comments.create_comment(
                scope,
                session,
                target_type=CommentTargetType.RUN,
                target_id=stage["a"]["run"],
                body="loser",
                idempotency_key=key,
                idempotency_request_hash="a" * 64,
            )
        await session.rollback()


async def test_a_member_whose_address_is_not_ascii_can_be_mentioned_by_the_handle_served(stage):
    """End to end for the handle invariant (Greptile, PR 968): whatever handle
    `GET /v1/comments/people` serves for a member is one `POST /v1/comments`
    resolves back to that member, including an address the parser cannot read."""
    tag = stage["tag"]
    async with stage["factory"]() as session:
        for name, email in (("yamada", f"山田@例え{tag}.jp"), ("jose", f"José{tag}@comments.test")):
            user, personal = await system.get_or_provision_user(
                session, workos_user_id=f"comments-{name}-{tag}", email=email
            )
            # Registered for teardown before anything can fail.
            stage["people"][name] = (user, personal)
            await workspaces.add_member(
                stage["owner_scope"], session, user_id=user.id, role=Role.MEMBER
            )
        await session.commit()

    member = stage["clients"]["member"]
    people = (await member.get("/v1/comments/people")).json()["items"]
    served = {p["user_id"]: p["handle"] for p in people}
    yamada = str(stage["people"]["yamada"][0].id)
    jose = str(stage["people"]["jose"][0].id)
    assert served[jose] == f"jose{tag}", "accents fold to the ASCII short form"
    assert served[yamada].startswith("member-"), "no ASCII to build a handle from"

    for user_id in (yamada, jose):
        posted = await _post(member, "run", stage["a"]["run"], f"cc @{served[user_id]} please")
        assert posted.status_code == 201
        assert [p["user_id"] for p in posted.json()["mentions"]] == [user_id]
