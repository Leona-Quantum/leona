"""A refusal that carries structure has to reach the person as words.

The control plane answers several refusals with a typed body — `{"error": <a
sentence>, "reason": <a token>, ...}` — so the client can both show something
truthful and branch on the reason. The HTTPException handler used to `str()`
that dict into `title`, which is a Python repr, and the web client renders
`title` straight to the user. So the free tier's workspace limit has been
telling people `{'error': 'Your plan includes 3 workspaces and all 3 are in
use...', 'reason': 'workspace_allowance_exhausted', 'used': 3, 'limit': 3}`
since it shipped, on the one path a free account is guaranteed to reach.

Found while adding two more refusals shaped exactly like it. Asserted against
the app's REAL registered handler — a probe route is mounted on a real
`create_app`, rather than the handler's logic being restated here, because a
test that restates the code it checks passes when the code is deleted.
"""

import httpx
import pytest
from fastapi import HTTPException

from majorana_api.app import _problem, create_app
from majorana_api.settings import Settings

pytestmark = pytest.mark.anyio


def _settings() -> Settings:
    return Settings(
        workos_client_id="client_x",
        workos_jwt_issuer="https://api.workos.com/user_management/client_x",
        workos_jwks_url="https://api.workos.com/sso/jwks/client_x",
        web_origin="https://web.invalid",
        environment="production",
    )


def _client() -> httpx.AsyncClient:
    """The real app, plus two routes that do nothing but raise.

    The refusals under test live behind authentication and a database, so
    reaching the genuine ones would prove the fixtures rather than the handler.
    What has to be exercised is the `@app.exception_handler(HTTPException)`
    that `create_app` registers, and mounting a route on that same app is what
    exercises it.
    """
    app = create_app(_settings())

    @app.get("/probe/typed")
    async def _typed():
        raise HTTPException(
            409,
            detail={
                "error": "Your plan includes 3 workspaces and all 3 are in use.",
                "reason": "workspace_allowance_exhausted",
                "used": 3,
                "limit": 3,
            },
        )

    @app.get("/probe/plain")
    async def _plain():
        raise HTTPException(404, "workspace not found")

    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_a_typed_refusal_puts_the_sentence_in_title():
    """`title` is what the web client shows. It must be the sentence, never the
    dict that carries it."""
    async with _client() as client:
        body = (await client.get("/probe/typed")).json()
    assert body["title"] == "Your plan includes 3 workspaces and all 3 are in use."
    assert "{'" not in body["title"]


async def test_a_typed_refusal_keeps_its_reason_and_numbers():
    """The client branches on `reason`, so flattening to a sentence alone would
    lose the machine-readable half. RFC 7807 extensions are siblings of `title`."""
    async with _client() as client:
        response = await client.get("/probe/typed")
    body = response.json()
    assert response.status_code == 409
    assert body["reason"] == "workspace_allowance_exhausted"
    assert body["used"] == 3 and body["limit"] == 3


async def test_a_plain_string_detail_is_untouched():
    """Most refusals are a bare string and were always rendered correctly. This
    is the half that must not regress while fixing the other one."""
    async with _client() as client:
        response = await client.get("/probe/plain")
    assert response.status_code == 404
    assert response.json()["title"] == "workspace not found"


def test_extensions_cannot_overwrite_the_problem_document():
    """A detail key colliding with `status` or `title` must not rewrite either —
    the envelope is the server's, not the refusal's."""
    import json

    response = _problem(
        409,
        "the real title",
        "http_error",
        extra={"status": 200, "title": "spoofed", "reason": "kept"},
    )
    body = json.loads(bytes(response.body))
    assert body["status"] == 409
    assert body["title"] == "the real title"
    assert body["reason"] == "kept"
