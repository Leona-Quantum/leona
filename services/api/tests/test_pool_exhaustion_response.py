"""What a caller is told when the connection pool is full.

Saturation and a fault are different events and must not look the same. Before
the handler under test, a request that waited out the pool timeout raised
`sqlalchemy.exc.TimeoutError`, fell through `create_app`'s catch-all
`Exception` handler, and left as `500 internal error`.

That is wrong three times over, and the tests below pin each one. A launch is
watched by its 5xx rate, and overload counted as `internal_error` hides the
real faults inside it. A 500 tells a client the request will never succeed,
where the truth is that the very same request would succeed a moment later —
only a 503 says that. And with no `Retry-After`, every refused caller is free
to return immediately, which is the one behaviour a full pool cannot survive.

`db.DEFAULT_POOL_TIMEOUT_S` is read here rather than restated, because the
header's whole purpose is to keep a retry from landing while the connections
that refused it are still held.
"""

import uuid

import httpx
import pytest
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError

from majorana_api import db
from majorana_api.app import create_app
from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.settings import Settings

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)


def _settings() -> Settings:
    return Settings(
        **SETTINGS_KWARGS,
        catalog_authority=CatalogAuthority(
            enabled=True,
            workspace_id=uuid.uuid4(),
            importer_user_id=uuid.uuid4(),
            public_reader_user_id=uuid.uuid4(),
        ),
    )


def _app_raising(exc: Exception):
    """The real app, plus one route that fails the way a full pool fails.

    The failure is injected at a route rather than by exhausting a real pool:
    what is under test is the mapping from exception to response, and standing
    up a database only to fill it would test SQLAlchemy instead.
    """
    app = create_app(_settings())

    @app.get("/v1/_test/boom")
    async def _boom():
        raise exc

    return app


def _client(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_a_full_pool_is_refused_as_503_not_reported_as_a_fault():
    async with _client(_app_raising(SQLAlchemyTimeoutError("pool exhausted"))) as client:
        response = await client.get("/v1/_test/boom")

    assert response.status_code == 503
    assert response.headers["content-type"].startswith("application/problem+json")
    body = response.json()
    assert body["code"] == "capacity_exhausted"
    assert body["status"] == 503
    # The catch-all's code, specifically: a regression here would most likely
    # take the form of this handler being removed or shadowed, and the symptom
    # would be the old code coming back rather than an obviously broken body.
    assert body["code"] != "internal_error"


async def test_the_refusal_tells_the_caller_when_to_come_back():
    async with _client(_app_raising(SQLAlchemyTimeoutError("pool exhausted"))) as client:
        response = await client.get("/v1/_test/boom")

    assert response.headers["Retry-After"] == str(int(db.DEFAULT_POOL_TIMEOUT_S))


async def test_an_ordinary_fault_is_still_a_500():
    """The narrow handler must not have widened the definition of overload."""
    async with _client(_app_raising(RuntimeError("something genuinely broke"))) as client:
        response = await client.get("/v1/_test/boom")

    assert response.status_code == 500
    assert response.json()["code"] == "internal_error"


def test_the_engine_bounds_the_wait_rather_than_taking_sqlalchemys_default():
    """30s of waiting holds a Cloud Run request slot that serves nobody.

    Asserted against the engine's live pool rather than against the constant,
    so that deleting the `pool_timeout=` argument fails this test even though
    the constant it named still exists.
    """
    engine = db.engine_from_env()
    try:
        assert engine.sync_engine.pool.timeout() == pytest.approx(db.DEFAULT_POOL_TIMEOUT_S)
        assert db.DEFAULT_POOL_TIMEOUT_S < 30.0
    finally:
        engine.sync_engine.dispose()
