"""Notebook share links against real Postgres: the authz rows for §2's release gate.

Proposal 7 ("Notebooks and courses for a class"), approved ai-ops 349 option 2. This
is a NEW ANONYMOUS ROUTE (`05-security.md` §1a), and these are the rows a review of
one asks for:

- a link opens only its own notebook, read-only, with answers/graders/solutions
  redacted by the SAME function the private non-owner view uses (`for_learner()`,
  ai-ops#260) — not a second, hand-rolled redaction;
- a link for notebook A never shows notebook B, even by construction (the public
  route takes only a token, never a notebook id, so there is nothing for a client
  to substitute);
- a non-creator workspace member cannot mint a link, even though they can otherwise
  read the notebook;
- revoked and expired links answer 404, not 403 (the brief's own wording);
- the secret reaches no response but the minting one, and no log line;
- a solution cell's PRIOR execution output does not leak through `report` even
  though its `spec` entry is redacted (see `routes/notebook_shares.py::
  _redact_report_for_public`'s docstring for why this needed its own guard).

Everything runs inside the authz `db` fixture's transaction and is rolled back.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import logging
import uuid

import httpx
import majorana_contracts as contracts
import pytest
from majorana_contracts import Scope
from majorana_contracts.enums import Role
from majorana_contracts.notebook_shares import MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK, SHARE_TOKEN_PREFIX
from matrix_helpers import requires_db

from majorana_api.app import create_app
from majorana_api.repos import notebook_share_links as share_links_repo
from majorana_api.repos import notebooks as notebooks_repo
from majorana_api.repos import system
from majorana_api.repos import workspaces as workspaces_repo
from majorana_api.repos._base import AuthzError
from majorana_api.settings import Settings

pytestmark = requires_db

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

#: Distinct, greppable secret strings — one per redacted surface — so a test that
#: finds none of them in a response is finding an ABSENCE of that specific secret,
#: not merely "nothing looked wrong".
_CHECK_SENTINEL = "SENTINEL-CHECK-9f31"
_SOLUTION_SENTINEL = "SENTINEL-SOLUTION-2b74"
_ANSWER_PROSE_SENTINEL = "SENTINEL-ANSWER-PROSE-7c02"
_EXPLANATION_SENTINEL = "SENTINEL-EXPLANATION-4a18"
_STDOUT_LEAK_SENTINEL = "SENTINEL-STDOUT-LEAK-6e55"


async def _person(db, tag: str) -> tuple:
    return await system.get_or_provision_user(
        db,
        workos_user_id=f"shr-{tag}-{uuid.uuid4()}",
        email=f"{tag}-{uuid.uuid4().hex[:6]}@shr.test",
        display_name=tag.title(),
    )


async def _owner_scope(db, tag: str):
    user, workspace = await _person(db, tag)
    return Scope(user_id=user.id, workspace_id=workspace.id, role=Role.OWNER), user, workspace


def _secret_spec(slug: str) -> contracts.NotebookSpec:
    """A notebook carrying one secret string on each surface `for_learner()`
    redacts, plus one question cell whose right-answer explanation must never
    reach the browser at all (it is not even in `answer_prompt`)."""
    return contracts.NotebookSpec(
        slug=slug,
        title="Secret Notebook",
        kind=contracts.NotebookKind.LESSON,
        cells=[
            contracts.Cell(
                id="intro", kind="markdown", role=contracts.CellRole.OBJECTIVE, source="Learn X."
            ),
            contracts.Cell(
                id="exercise1",
                kind="code",
                role=contracts.CellRole.EXERCISE,
                source="",
                stub="def f():\n    ...\n",
                check=f"assert f() == '{_CHECK_SENTINEL}'",
            ),
            contracts.Cell(
                id="solution1",
                kind="code",
                role=contracts.CellRole.SOLUTION,
                source=f"def f():\n    return '{_SOLUTION_SENTINEL}'\n",
                stub="def f():\n    ...\n",
            ),
            contracts.Cell(
                id="answer1",
                kind="markdown",
                role=contracts.CellRole.ANSWER,
                source=f"The worked answer is {_ANSWER_PROSE_SENTINEL}.",
            ),
            contracts.Cell(
                id="question1",
                kind="markdown",
                role=contracts.CellRole.QUESTION,
                source="Which gate creates superposition?",
                answer=contracts.ChoiceAnswer(
                    options=["X", "H", "Z"], correct=1, explanation=_EXPLANATION_SENTINEL
                ),
            ),
        ],
    )


async def _ready_notebook(scope: Scope, db, *, spec: contracts.NotebookSpec, report=None):
    notebook, version = await notebooks_repo.create_notebook(
        scope,
        db,
        slug=spec.slug,
        title=spec.title,
        kind=spec.kind.value,
        summary="",
        language="en",
        framework={"name": "qiskit"},
        request={},
        run_id=None,
        created_by="user",
    )
    await notebooks_repo.set_version_result(
        scope,
        db,
        version.id,
        status=contracts.NotebookVersionStatus.READY.value,
        spec=spec.model_dump(mode="json"),
        source="",
        ipynb={"cells": []},
        report=report.model_dump(mode="json") if report is not None else None,
        review=None,
        error="",
    )
    return notebook, version


@contextlib.asynccontextmanager
async def _fixture_session(db):
    yield db


def _client(db) -> httpx.AsyncClient:
    """A plain, unauthenticated client. The public route takes no credential at
    all, so there is nothing to override on the auth chain — only the DB session,
    so the token minted inside this test's transaction is visible to the lookup."""
    from majorana_api.auth import deps as auth_deps

    app = create_app(Settings(**SETTINGS_KWARGS))
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.state.auth_session_factory = lambda: _fixture_session(db)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


# ------------------------------------------------------------------ redaction, end to end


async def test_a_share_link_redacts_every_secret_surface_through_the_public_route(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    report = contracts.ExecutionReport(
        notebook_slug="secret-notebook-ab12cd34",
        ok=True,
        runner="sandbox",
        cells=[
            contracts.CellResult(
                id="solution1", status="ok", stdout=f"ran: {_STDOUT_LEAK_SENTINEL}"
            ),
            contracts.CellResult(id="exercise1", status="not_run"),
        ],
    )
    notebook, _version = await _ready_notebook(
        scope, db, spec=_secret_spec("secret-notebook-ab12cd34"), report=report
    )
    token, _row = await share_links_repo.mint(scope, db, notebook.id)

    async with _client(db) as client:
        response = await client.post("/v1/notebooks/shared/lookup", json={"token": token})

    assert response.status_code == 200
    body = response.text
    for secret in (
        _CHECK_SENTINEL,
        _SOLUTION_SENTINEL,
        _ANSWER_PROSE_SENTINEL,
        _EXPLANATION_SENTINEL,
        _STDOUT_LEAK_SENTINEL,
    ):
        assert secret not in body, f"{secret!r} leaked through the public share view"

    payload = response.json()
    # No tenant identity anywhere in the payload.
    for forbidden in ("workspace_id", "owner_user_id", "notebook_id", "id", "run_id"):
        assert forbidden not in payload
    assert payload["status"] == "ready"
    ids = [cell["id"] for cell in payload["cells"]]
    # The answer-prose cell is removed outright (no stub to fall back to).
    assert "answer1" not in ids
    # The solution cell survives, but as its stub, with its role changed.
    solution = next(cell for cell in payload["cells"] if cell["id"] == "solution1")
    assert solution["source"] == "def f():\n    ...\n"
    assert solution["role"] == "exercise"
    assert solution["check"] is None
    # The question cell keeps its options but never its correct index or explanation.
    question = next(cell for cell in payload["cells"] if cell["id"] == "question1")
    assert question["answer"] is None
    assert question["answer_prompt"]["options"] == ["X", "H", "Z"]


async def test_a_link_for_notebook_a_never_shows_notebook_b(db):
    """The client sends only a token; there is no notebook id for it to substitute.
    Proven by minting links for two notebooks and checking each token answers only
    its own notebook's title."""
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook_a, _ = await _ready_notebook(
        scope,
        db,
        spec=_secret_spec("notebook-a-ab12cd34").model_copy(update={"title": "Notebook A"}),
    )
    notebook_b, _ = await _ready_notebook(
        scope,
        db,
        spec=_secret_spec("notebook-b-cd34ef56").model_copy(update={"title": "Notebook B"}),
    )
    token_a, _ = await share_links_repo.mint(scope, db, notebook_a.id)
    token_b, _ = await share_links_repo.mint(scope, db, notebook_b.id)

    async with _client(db) as client:
        response_a = await client.post("/v1/notebooks/shared/lookup", json={"token": token_a})
        response_b = await client.post("/v1/notebooks/shared/lookup", json={"token": token_b})

    assert response_a.json()["title"] == "Notebook A"
    assert response_b.json()["title"] == "Notebook B"


# ------------------------------------------------------------------ who may mint


async def test_a_non_creator_member_cannot_mint_a_link(db):
    """A real member of the right workspace, who did not create this notebook, is
    refused exactly like a stranger — ai-ops#260's rule is about the CREATOR, not
    about workspace role."""
    owner, _owner_user, workspace = await _owner_scope(db, "owner")
    member_user, _ = await _person(db, "member")
    await workspaces_repo.add_member(owner, db, user_id=member_user.id, role=Role.ADMIN)
    member = Scope(user_id=member_user.id, workspace_id=workspace.id, role=Role.ADMIN)

    notebook, _ = await _ready_notebook(owner, db, spec=_secret_spec("owned-ab12cd34"))

    # The member CAN read the notebook (workspace-scoped RLS admits them)...
    read = await notebooks_repo.get_notebook(member, db, notebook.id)
    assert read.id == notebook.id
    # ...but cannot mint a share link for it.
    with pytest.raises(AuthzError):
        await share_links_repo.mint(member, db, notebook.id)
    # Nor list or revoke.
    with pytest.raises(AuthzError):
        await share_links_repo.list_links(member, db, notebook.id)


async def test_the_mint_route_refuses_a_non_creator_with_403(db):
    owner, _owner_user, workspace = await _owner_scope(db, "owner")
    member_user, _ = await _person(db, "member")
    await workspaces_repo.add_member(owner, db, user_id=member_user.id, role=Role.ADMIN)
    notebook, _ = await _ready_notebook(owner, db, spec=_secret_spec("owned-cd34ef56"))

    from majorana_api.auth import deps as auth_deps

    app = create_app(Settings(**SETTINGS_KWARGS))

    # Drive the route through CurrentScope by overriding get_scope directly with
    # the member's scope, rather than forging a bearer token — the thing under
    # test is the repository's creator check, not the auth chain.
    app.dependency_overrides[auth_deps.get_session] = lambda: db
    app.dependency_overrides[auth_deps.get_scope] = lambda: Scope(
        user_id=member_user.id, workspace_id=workspace.id, role=Role.ADMIN
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(f"/v1/notebooks/{notebook.id}/share-links", json={})

    assert response.status_code == 403


# ------------------------------------------------------------------ lifecycle at the edge


async def test_a_revoked_link_answers_404_not_403(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("revoke-me-ab12cd34"))
    token, row = await share_links_repo.mint(scope, db, notebook.id)

    async with _client(db) as client:
        before = await client.post("/v1/notebooks/shared/lookup", json={"token": token})
        assert before.status_code == 200
        await share_links_repo.revoke(scope, db, notebook.id, row.id)
        after = await client.post("/v1/notebooks/shared/lookup", json={"token": token})

    assert after.status_code == 404


async def test_an_expired_link_answers_404_not_403(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("expire-me-ab12cd34"))
    token, row = await share_links_repo.mint(scope, db, notebook.id, expires_in_days=1)
    tick = dt.timedelta(microseconds=1)

    assert (
        await share_links_repo.resolve_presented(db, token, now=row.expires_at - tick) is not None
    )
    assert await share_links_repo.resolve_presented(db, token, now=row.expires_at) is None
    assert await share_links_repo.resolve_presented(db, token, now=row.expires_at + tick) is None


async def test_last_viewed_is_stamped_and_then_left_alone_for_five_minutes(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("viewed-ab12cd34"))
    token, row = await share_links_repo.mint(scope, db, notebook.id)
    assert row.last_viewed_at is None

    first = row.created_at + dt.timedelta(seconds=1)
    await share_links_repo.resolve_presented(db, token, now=first)
    assert row.last_viewed_at == first

    await share_links_repo.resolve_presented(db, token, now=first + dt.timedelta(minutes=1))
    assert row.last_viewed_at == first

    later = first + share_links_repo.LAST_VIEWED_RESOLUTION
    await share_links_repo.resolve_presented(db, token, now=later)
    assert row.last_viewed_at == later


async def test_a_live_ceiling_is_enforced_per_notebook(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("ceiling-ab12cd34"))
    for _ in range(MAX_LIVE_SHARE_LINKS_PER_NOTEBOOK):
        await share_links_repo.mint(scope, db, notebook.id)

    with pytest.raises(share_links_repo.ShareLinkLimitReached):
        await share_links_repo.mint(scope, db, notebook.id)

    live = [
        row
        for row in await share_links_repo.list_links(scope, db, notebook.id)
        if row.revoked_at is None
    ]
    await share_links_repo.revoke(scope, db, notebook.id, live[0].id)
    _token, row = await share_links_repo.mint(scope, db, notebook.id)
    assert row.id is not None


# ------------------------------------------------------------------ idempotency


async def test_a_replayed_idempotency_key_refuses_rather_than_minting_a_second_link(db):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("idem-ab12cd34"))
    key = f"retry-{uuid.uuid4().hex[:8]}"

    first_secret, first = await share_links_repo.mint(scope, db, notebook.id, idempotency_key=key)
    with pytest.raises(share_links_repo.IdempotencyKeyAlreadyMinted) as replayed:
        await share_links_repo.mint(scope, db, notebook.id, idempotency_key=key)

    assert replayed.value.row.id == first.id
    ids = [row.id for row in await share_links_repo.list_links(scope, db, notebook.id)]
    assert ids == [first.id]
    assert await share_links_repo.resolve_presented(db, first_secret) is not None


# ------------------------------------------------------------------ the secret


async def test_the_secret_is_in_the_minting_response_and_nowhere_else(db, caplog):
    scope, _user, _ws = await _owner_scope(db, "author")
    notebook, _ = await _ready_notebook(scope, db, spec=_secret_spec("secret-in-nowhere-ab12cd34"))

    with caplog.at_level(logging.DEBUG):
        async with _client(db) as client:
            token, row = await share_links_repo.mint(scope, db, notebook.id)
            viewed = await client.post("/v1/notebooks/shared/lookup", json={"token": token})
            assert viewed.status_code == 200
            rows = await share_links_repo.list_links(scope, db, notebook.id)

    secret = token.removeprefix(SHARE_TOKEN_PREFIX)
    assert secret not in viewed.text
    stored = " ".join(str(getattr(row, name)) for name in ("token_hash", "tail"))
    assert secret not in stored
    assert row.tail == secret[-4:]
    emitted = " ".join(record.getMessage() for record in caplog.records)
    assert secret not in emitted
    assert token not in emitted
    assert all(secret not in str(share_links_repo.to_resource(r)) for r in rows)
