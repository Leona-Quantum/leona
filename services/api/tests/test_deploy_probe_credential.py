"""The post-deploy probe credential: what it is allowed to do, and nothing else.

The deploy workflow submits one real run against production after traffic shifts,
because a green deploy is not a working product — the two most expensive defects
of the last month (a crash-looping worker, and #164's allowance check raising on
the worker's own environment) were both invisible to every check that existed and
would both have been caught by one live AUTO run.

That gate needs a credential. This file pins what that credential can reach. The
load-bearing test is `test_every_other_route_refuses_the_probe`: it enumerates
the *real* application's routes rather than a list written by hand, so a route
added next month is refused by default and a widening is a deliberate edit to
DEPLOY_PROBE_ROUTES rather than an oversight.
"""

import re
from types import SimpleNamespace

import httpx
import pytest
from fastapi import HTTPException, Request

from majorana_api.app import create_app
from majorana_api.auth.deps import (
    DEPLOY_PROBE_ROUTES,
    get_session,
    get_verified_token,
)
from majorana_api.settings import Settings

#: Any `{name}` segment in an OpenAPI path template.
_PARAM = re.compile(r"\{[^/}]+\}")

PROBE_TOKEN = "p" * 48


def _settings(**overrides) -> Settings:
    base = dict(
        workos_client_id="client_x",
        workos_jwt_issuer="https://api.workos.com/user_management/client_x",
        workos_jwks_url="https://api.workos.com/sso/jwks/client_x",
        web_origin="https://web.invalid",
        environment="production",
        deploy_probe_token=PROBE_TOKEN,
    )
    base.update(overrides)
    return Settings(**base)


def _request(method: str, route_path: str | None) -> Request:
    """A request as the router hands it to a dependency.

    `route` is what the router resolved — the unprefixed template, which is the
    thing the allowlist is matched against. `None` models the case where nothing
    resolved it. The raw `path` carries the `/v1` mount point the app adds,
    because `_probe_may_reach` checks that too.
    """
    raw = "/v1" + route_path if route_path is not None else "/"
    scope: dict = {"type": "http", "method": method, "path": raw, "headers": []}
    if route_path is not None:
        scope["route"] = SimpleNamespace(path=route_path)
    return Request(scope)


def _unmounted_request(method: str, route_path: str) -> Request:
    """The same route template reached outside the `/v1` mount point."""
    scope: dict = {
        "type": "http",
        "method": method,
        "path": route_path,
        "headers": [],
        "route": SimpleNamespace(path=route_path),
    }
    return Request(scope)


async def test_the_probe_token_authenticates_on_the_routes_it_needs():
    for method, path in sorted(DEPLOY_PROBE_ROUTES):
        token = await get_verified_token(
            _request(method, path), _settings(), f"Bearer {PROBE_TOKEN}"
        )
        assert token.workos_user_id == "deploy-probe"
        # get_identity 403s without an email claim, so a probe that authenticated
        # but could not provision would fail the deploy for the wrong reason.
        assert token.claims["email"] == "deploy-probe@leonaquantum.com"


async def test_the_probe_is_refused_on_a_route_it_does_not_need():
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(
            _request("GET", "/artifacts"), _settings(), f"Bearer {PROBE_TOKEN}"
        )
    assert exc.value.status_code == 403


async def test_an_unrouted_request_is_refused_rather_than_allowed():
    """Fail closed when there is no route template to compare against."""
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(_request("POST", None), _settings(), f"Bearer {PROBE_TOKEN}")
    assert exc.value.status_code == 403


async def test_the_allowlisted_template_is_refused_outside_the_v1_mount():
    """The templates are unprefixed, so the mount point has to be checked too.

    `/runs` reached anywhere other than under `/v1` is not the route this
    credential was scoped to, whatever the router called it.
    """
    with pytest.raises(HTTPException) as exc:
        await get_verified_token(
            _unmounted_request("POST", "/runs"), _settings(), f"Bearer {PROBE_TOKEN}"
        )
    assert exc.value.status_code == 403


async def test_an_unset_probe_token_accepts_nothing():
    """Every environment except production leaves DEPLOY_PROBE_TOKEN unset.

    An empty configured token must not mean "an empty bearer token works", and
    must not mean "any token works" — it must mean the branch does not exist.
    """
    settings = _settings(deploy_probe_token="")
    for presented in ("", PROBE_TOKEN):
        with pytest.raises(HTTPException) as exc:
            await get_verified_token(_request("POST", "/runs"), settings, f"Bearer {presented}")
        # 401 from the WorkOS path, never a 403 route refusal: an unset probe is
        # not a probe that exists but is out of scope.
        assert exc.value.status_code == 401


def test_a_weak_probe_token_fails_startup_instead_of_quietly_working():
    for weak in ("majorana-deploy-probe", "changeme", "short"):
        with pytest.raises(RuntimeError):
            _settings(deploy_probe_token=weak)


def test_the_probe_is_not_metered():
    """A deploy gate that stops working on the sixth deploy of a week is not a gate."""
    from majorana_api.tiers import limits_for, resolve_tier

    tier = resolve_tier("deploy-probe@leonaquantum.com")  # no plan, no allowlist
    assert tier == "developer"
    assert limits_for(tier).agent_runs_per_week is None


# --- the enumeration test -------------------------------------------------


def _v1_routes(app):
    """Every `/v1` operation, as (method, full path, unprefixed template).

    Read from the OpenAPI document rather than by walking `app.routes`: this
    FastAPI keeps included routers as opaque `_IncludedRouter` objects whose
    routes are not in `app.routes` at all, so a naive walk finds five docs
    endpoints and reports success having checked nothing. The schema is the
    supported way to ask what the application actually serves.
    """
    for path, operations in app.openapi()["paths"].items():
        if not path.startswith("/v1/"):
            continue
        for method, operation in operations.items():
            if method.upper() in {"HEAD", "OPTIONS", "PARAMETERS"}:
                continue
            yield method.upper(), path, path.removeprefix("/v1")


@pytest.mark.anyio
async def test_every_other_route_refuses_the_probe():
    """The credential's narrowness, proved against the real router.

    Two things are asserted at once, and both matter:

    * every /v1 route outside the allowlist answers 403 to the probe token, and
    * the allowlisted ones do not — which is also what proves the route template
      is actually available to the dependency. If `request.scope["route"]` were
      ever empty, `_probe_may_reach` would fail closed and this half would fail
      loudly rather than the gate silently refusing its own deploy.
    """
    app = create_app(_settings())

    async def _no_db():  # the probe check runs before any handler touches Postgres
        yield None

    app.dependency_overrides[get_session] = _no_db

    checked, allowed = 0, 0
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://probe.invalid") as client:
        for method, full_path, template in _v1_routes(app):
            # A concrete value for every templated segment, substituted by shape
            # rather than by name so a new parameter cannot slip through as a
            # literal "{foo}" and 404 while proving nothing. The allowlist is
            # matched on the template, so the value itself is irrelevant.
            url = _PARAM.sub("00000000-0000-0000-0000-000000000000", full_path)
            assert "{" not in url, f"unsubstituted path parameter in {full_path}"
            response = await client.request(
                method,
                url,
                headers={"Authorization": f"Bearer {PROBE_TOKEN}"},
                json={},
            )
            checked += 1
            if (method, template) in DEPLOY_PROBE_ROUTES:
                allowed += 1
                assert response.status_code != 403, (
                    f"{method} {full_path} answered 403 — the probe cannot reach the "
                    "routes its own deploy gate needs"
                )
                continue

            # Everywhere else the credential must buy nothing. Two shapes count:
            # an authenticated route refuses it outright, and a public route
            # (the anonymous catalog) ignores it — which is only a real check if
            # the same request without any credential answers identically.
            anonymous = await client.request(method, url, json={})
            assert response.status_code in (401, 403) or (
                response.status_code == anonymous.status_code
            ), (
                f"{method} {full_path} answered {response.status_code} with the probe "
                f"credential and {anonymous.status_code} without it — the probe got "
                "something an anonymous caller does not"
            )

    # A sweep that sweeps nothing passes. Pin that the schema walk found the real
    # surface, and that every allowlisted pair is a route that actually exists.
    assert checked > 15, f"only {checked} operations enumerated; the walk found nothing"
    assert allowed == len(DEPLOY_PROBE_ROUTES), (
        f"{allowed} of {len(DEPLOY_PROBE_ROUTES)} allowlisted routes were reached; "
        "DEPLOY_PROBE_ROUTES names something the app does not serve"
    )
