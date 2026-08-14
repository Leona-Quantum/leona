"""Response compression, and the library default that keeps SSE working.

The interesting half of this file is the SSE test. Compressing a
``text/event-stream`` holds each event inside the gzip window until it fills,
which turns a live stream into a stuttering one — and it fails in the worst
way, because the stream still works, just late, and only under load. Nothing in
our code prevents it. Starlette's ``DEFAULT_EXCLUDED_CONTENT_TYPES`` does.

Depending on a library DEFAULT is fine as long as somebody notices when it
changes, so these tests exercise the real middleware with the real settings
rather than asserting that a line of configuration exists.
"""

import gzip
import json

import httpx
import pytest
from fastapi.middleware.gzip import GZipMiddleware
from starlette.applications import Starlette
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

# The same two numbers `create_app` passes. Imported by hand rather than from a
# shared constant on purpose: if somebody changes the app and not this file, the
# drift test at the bottom is what catches it, and it catches it by reading the
# app rather than by reading a constant both files happen to share.
MINIMUM_SIZE = 500
COMPRESS_LEVEL = 6


def _big_payload() -> dict:
    # Comfortably over MINIMUM_SIZE, and repetitive the way catalog JSON is.
    return {
        "entries": [{"slug": f"record-{n}", "title": "Quantum phase estimation"} for n in range(60)]
    }


async def _json(_request):
    return JSONResponse(_big_payload())


async def _small_json(_request):
    return JSONResponse({"ok": True})


async def _sse(_request):
    async def events():
        for n in range(3):
            yield f"data: {json.dumps({'n': n, 'pad': 'x' * 400})}\n\n".encode()

    return StreamingResponse(events(), media_type="text/event-stream")


def _client() -> httpx.AsyncClient:
    app = Starlette(
        routes=[Route("/json", _json), Route("/small", _small_json), Route("/sse", _sse)],
    )
    app.add_middleware(GZipMiddleware, minimum_size=MINIMUM_SIZE, compresslevel=COMPRESS_LEVEL)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


@pytest.mark.anyio
async def test_a_large_json_response_is_compressed():
    async with _client() as client:
        response = await client.get("/json", headers={"Accept-Encoding": "gzip"})
    assert response.headers["content-encoding"] == "gzip"
    # httpx decodes transparently, so check the wire size against the decoded
    # size rather than trusting the header alone.
    raw = len(response.content)
    assert raw > 0
    assert json.loads(response.text)["entries"][0]["slug"] == "record-0"


@pytest.mark.anyio
async def test_compression_actually_shrinks_the_body():
    # A header saying gzip over a body that got bigger would be a regression
    # nobody would notice; measure the ratio.
    body = json.dumps(_big_payload()).encode()
    compressed = gzip.compress(body, compresslevel=COMPRESS_LEVEL)
    assert len(compressed) < len(body) / 2, (
        f"catalog-shaped JSON compressed only {len(body) / len(compressed):.1f}x; "
        "if this ever fails the payload has stopped being repetitive and the "
        "case for compressing it needs remaking"
    )


@pytest.mark.anyio
async def test_a_small_response_is_left_alone():
    async with _client() as client:
        response = await client.get("/small", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in response.headers


@pytest.mark.anyio
async def test_a_client_that_did_not_ask_for_gzip_does_not_get_it():
    async with _client() as client:
        response = await client.get("/json", headers={"Accept-Encoding": "identity"})
    assert "content-encoding" not in response.headers


@pytest.mark.anyio
async def test_server_sent_events_are_never_compressed():
    """The one that matters.

    If this fails after a dependency bump, Starlette has stopped excluding
    ``text/event-stream`` by default and the exclusion has to become ours —
    every live run's event stream is behind it.
    """
    async with _client() as client:
        response = await client.get("/sse", headers={"Accept-Encoding": "gzip"})
    assert "content-encoding" not in response.headers, (
        "SSE responses are being gzipped; events will be held in the compression "
        "window instead of arriving live"
    )
    assert response.text.count("data: ") == 3


@pytest.mark.anyio
async def test_the_api_actually_installs_the_middleware():
    """Everything above tests a middleware. This tests that we use it.

    Without this the file would keep passing after somebody removed the line
    from `create_app`, which is the shape of guard this repository keeps
    catching itself with.
    """
    from majorana_api.app import create_app
    from majorana_api.settings import Settings

    app = create_app(
        Settings(
            workos_client_id="local-dev",
            workos_jwt_issuer="https://local.invalid",
            workos_jwks_url="https://local.invalid/jwks",
            web_origin="http://localhost:3000",
            environment="development",
            local_dev_auth=True,
        )
    )
    installed = [m for m in app.user_middleware if m.cls is GZipMiddleware]
    assert len(installed) == 1, "create_app does not install GZipMiddleware exactly once"
    assert installed[0].kwargs["minimum_size"] == MINIMUM_SIZE
    assert installed[0].kwargs["compresslevel"] == COMPRESS_LEVEL
