"""The API's security response headers, and the placement that makes them apply.

The header values are the boring half. The half worth testing is **which
responses carry them**, because the reason this middleware is registered last —
and therefore runs outermost — is that the responses most worth covering never
reach a route handler at all: the limiter's own 429, the 413 for an oversized
body, and every problem+json an exception handler produces. A middleware
registered one line earlier would sit inside the limiter and cover none of them,
and every test that only checked a happy-path 200 would still pass.

So each test below picks a response produced by a *different* layer of the
stack.
"""

import httpx
import pytest
from starlette.datastructures import MutableHeaders

from majorana_api.app import create_app
from majorana_api.security_headers import SECURITY_RESPONSE_HEADERS, apply_security_headers
from majorana_api.settings import Settings


def _settings(**overrides) -> Settings:
    base = dict(
        workos_client_id="local-dev",
        workos_jwt_issuer="https://local.invalid",
        workos_jwks_url="https://local.invalid/jwks",
        web_origin="http://localhost:3000",
        environment="development",
        local_dev_auth=True,
    )
    base.update(overrides)
    return Settings(**base)


def _client(app, **kwargs) -> httpx.AsyncClient:
    # `raise_app_exceptions=False` so a handler that fails for want of a database
    # comes back as a 500 response instead of propagating. These tests are about
    # headers on responses, and a response is what we need — including the ones
    # produced by failures.
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://api.test",
        **kwargs,
    )


def _assert_all_present(response: httpx.Response, where: str) -> None:
    for name, value in SECURITY_RESPONSE_HEADERS.items():
        assert response.headers.get(name) == value, f"{name} missing or wrong on {where}"


# --- the policy, tested without a response ------------------------------------


def test_the_header_set_says_load_nothing():
    headers = MutableHeaders()
    apply_security_headers(headers)

    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "no-referrer"
    csp = headers["Content-Security-Policy"]
    # `default-src 'none'` does not imply either of these two, so a policy that
    # only had the first would still permit a `<base>` tag and a form post.
    for directive in (
        "default-src 'none'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'none'",
    ):
        assert directive in csp, f"CSP is missing {directive!r}"


def test_a_deliberate_value_set_by_a_route_wins():
    # `setdefault`, not assignment. This middleware runs outermost, so a blind
    # assignment would silently overwrite every route that had a reason of its
    # own. Nothing does that today — this pins which way the collision resolves
    # when something eventually does.
    headers = MutableHeaders({"X-Frame-Options": "SAMEORIGIN"})
    apply_security_headers(headers)

    assert headers["X-Frame-Options"] == "SAMEORIGIN"
    assert headers["X-Content-Type-Options"] == "nosniff", "the rest must still be applied"


def test_no_hsts_is_sent():
    # Deliberate, and documented at length in the module: `run.app` is in the
    # browser preload list, so HSTS is already enforced before a response of
    # ours is read. A header here would look like this service's policy while
    # the real guarantee lives with the domain. Pinned so that "add HSTS"
    # arrives as a decision rather than as a reflex.
    headers = MutableHeaders()
    apply_security_headers(headers)

    assert "Strict-Transport-Security" not in headers


# --- the placement, tested on responses from four different layers ------------


@pytest.mark.anyio
async def test_the_health_check_carries_them():
    # The one path that is exempt from the limiter entirely, so it proves the
    # headers do not ride on the limiter having run.
    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.get("/health")

    assert response.status_code == 200
    _assert_all_present(response, "/health")


@pytest.mark.anyio
async def test_a_rate_limit_refusal_carries_them():
    # The limiter answers 429 itself, before any route, dependency or database
    # session exists. This is the response a middleware registered one line
    # earlier would NOT have covered.
    app = create_app(_settings(anon_rate_limit_per_minute=1))
    async with _client(app) as client:
        await client.get("/v1/catalog/entries")
        refused = await client.get("/v1/catalog/entries")

    assert refused.status_code == 429, "the limiter did not refuse, so this proves nothing"
    _assert_all_present(refused, "a 429 from the limiter")


@pytest.mark.anyio
async def test_an_oversized_body_refusal_carries_them():
    # A 413 produced by the body guard, which runs on every path before the
    # limiter's own prefix check.
    app = create_app(_settings())
    too_big = b"x" * (1024 * 1024 + 1)
    async with _client(app) as client:
        response = await client.post("/v1/runs", content=too_big)

    assert response.status_code == 413, "the body guard did not refuse, so this proves nothing"
    _assert_all_present(response, "a 413 from the body guard")


@pytest.mark.anyio
async def test_an_unauthenticated_refusal_carries_them():
    # problem+json from the exception handler path rather than from a
    # middleware — a third distinct producer of responses.
    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.get("/v1/me")

    assert response.status_code in (401, 403), f"expected a refusal, got {response.status_code}"
    _assert_all_present(response, "an unauthenticated refusal")


# --- the documentation routes -------------------------------------------------


@pytest.mark.anyio
async def test_production_does_not_serve_the_api_documentation():
    """The disclosure surface behind the CSP exemption.

    Checked on the live service on 2026-08-17: `/docs`, `/redoc` and
    `/openapi.json` all answered 200 to an unauthenticated caller — the full
    interactive documentation and machine-readable schema for every endpoint,
    including the ones behind auth. That was FastAPI's default rather than a
    decision, and this pins the decision.
    """
    app = create_app(_settings(environment="production", local_dev_auth=False))
    async with _client(app) as client:
        for path in ("/docs", "/redoc", "/openapi.json"):
            response = await client.get(path)
            assert response.status_code == 404, f"{path} is still served in production"


@pytest.mark.anyio
async def test_development_still_serves_them():
    # The other arm. Without this the test above passes just as well against an
    # app that never had documentation routes at all, and would keep passing if
    # a typo in the environment check disabled them everywhere.
    app = create_app(_settings(environment="development"))
    async with _client(app) as client:
        assert (await client.get("/docs")).status_code == 200
        assert (await client.get("/openapi.json")).status_code == 200


def test_the_documentation_routes_are_exempt_from_the_csp_and_nothing_else():
    # `default-src 'none'` would render Swagger UI and ReDoc blank — they are
    # HTML documents that load their assets from a CDN. Every other header still
    # applies, because none of them is what those pages need.
    headers = MutableHeaders()
    apply_security_headers(headers, "/docs")

    assert "Content-Security-Policy" not in headers
    assert headers["X-Content-Type-Options"] == "nosniff"
    assert headers["X-Frame-Options"] == "DENY"
    assert headers["Referrer-Policy"] == "no-referrer"


def test_a_missing_path_gets_the_strict_policy():
    # The argument defaults to "", so a caller that forgets it must land on the
    # STRICT side. A default that silently relaxed the policy is the shape of
    # bug that ships quietly.
    headers = MutableHeaders()
    apply_security_headers(headers)

    assert "Content-Security-Policy" in headers


def test_the_exemption_does_not_match_a_lookalike_path():
    # Exact membership, not a prefix test — otherwise a future `/docs-internal`
    # or `/openapi.json.bak` would inherit the exemption by accident.
    for path in ("/docsomething", "/v1/docs", "/redocx", "/openapi.json.bak"):
        headers = MutableHeaders()
        apply_security_headers(headers, path)
        assert "Content-Security-Policy" in headers, f"{path} wrongly exempted"


# --- the wiring itself --------------------------------------------------------


@pytest.mark.anyio
async def test_the_app_installs_it_outermost():
    """Everything above tests a policy. This tests where it sits in the stack.

    Starlette's `add_middleware` inserts at the FRONT of `user_middleware`, and
    the front of that list is the OUTSIDE of the stack — so the last thing
    registered is the first thing a response passes through on the way out.
    Asserting on the position rather than on a comment means that moving the
    registration up a few lines, which is exactly the change that would silently
    stop covering the 429 and the 413 above, fails here too and says why.
    """
    app = create_app(_settings())
    dispatches = [getattr(m.kwargs.get("dispatch"), "__name__", None) for m in app.user_middleware]

    assert "_security_headers" in dispatches, "create_app does not install the middleware"
    assert dispatches.count("_security_headers") == 1, "installed more than once"
    assert dispatches[0] == "_security_headers", (
        "the security-headers middleware must be registered LAST so that it runs "
        f"OUTERMOST and covers the limiter's own refusals; stack front is {dispatches[0]!r}"
    )
