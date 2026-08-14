"""`Cache-Control` on the six public catalog GET routes (routes/catalog.py).

Every route in `routes/catalog.py` is anonymous, unauthenticated, and derives
its scope exclusively from server settings (`PublicCatalogScope` —
auth/catalog_deps.py) rather than from the caller, so nothing in a response
from this router can vary by who is asking. That is what makes all six safe
for a SHARED cache to store and replay: `_set_public_cache_control` marks
them `Cache-Control: public, max-age=..., stale-while-revalidate=...`, with
the max-age mirroring `CATALOG_REVALIDATE_SECONDS` in
`apps/web/lib/catalog-revalidate.ts` (the staleness the site already accepts
for this data).

`X-Majorana-Caller-Trust` (rate_limit.py) describes the CALLER of one
request, not the payload, so a shared cache replaying a stored response would
attach the wrong verdict to whoever it serves next. `app.py`'s rate-limit
middleware strips that header from exactly the responses this file proves are
marked public, and this file checks both directions of that: stripped when
cacheable, left alone when not.

The six routes are exercised two ways:

- Directly, with the repository layer doubled out (`monkeypatch.setattr` on
  `repos.catalog`'s functions) — matching test_catalog_authority.py's and
  test_billing_routes.py's direct-call pattern for this suite, so none of
  this needs a database.
- Once each, at the HTTP layer, to prove the header actually reaches a real
  response and that the middleware's strip/no-strip branching is correct —
  matching test_qpu_credential_routes.py's `get_session` override, so this
  still needs no database.
"""

import datetime as dt
import re
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import httpx
from fastapi import Response
from majorana_contracts import PublicCatalogEntry

from majorana_api.app import create_app
from majorana_api.auth import deps as auth_deps
from majorana_api.catalog_authority import CatalogAuthority
from majorana_api.rate_limit import CALLER_TRUST_HEADER, TRUSTED_CALLER_HEADER
from majorana_api.repos import NotFoundError
from majorana_api.repos import catalog as catalog_repo
from majorana_api.routes import catalog as catalog_routes
from majorana_api.settings import Settings

REPO_ROOT = Path(__file__).resolve().parents[3]

SETTINGS_KWARGS = dict(
    workos_client_id="client_test",
    workos_jwt_issuer="https://test.invalid",
    workos_jwks_url="https://test.invalid/jwks",
    web_origin="http://localhost:3000",
)

# The settings loader refuses a token under 32 characters, deliberately —
# "unset it entirely to meter our own renderer as an anonymous caller".
_TRUSTED_TOKEN = "t" * 32

EXPECTED_CACHE_CONTROL = (
    f"public, max-age={catalog_routes.CATALOG_CACHE_MAX_AGE_SECONDS}, "
    f"stale-while-revalidate={catalog_routes.CATALOG_CACHE_STALE_WHILE_REVALIDATE_SECONDS}"
)


def _authority() -> CatalogAuthority:
    return CatalogAuthority(
        enabled=True,
        workspace_id=uuid.uuid4(),
        importer_user_id=uuid.uuid4(),
        public_reader_user_id=uuid.uuid4(),
    )


def _settings(authority: CatalogAuthority) -> Settings:
    return Settings(**SETTINGS_KWARGS, catalog_authority=authority)


def _entry(slug: str = "demo-entry") -> PublicCatalogEntry:
    """A minimal but valid published entry. It carries no `portableCircuit`,
    which `estimate_for_record` and `profile_for_record` both treat as a typed
    "absent" result rather than an error (catalog_estimate.py,
    catalog_profile.py) — exactly the shape that lets these tests avoid
    constructing a real circuit just to check a header."""
    return PublicCatalogEntry(
        slug=slug,
        execution_state="template_only",
        updated_at=dt.datetime.now(dt.timezone.utc),
    )


# --------------------------------------------------------------------------
# Which routes this file is claiming to cover
# --------------------------------------------------------------------------


def _catalog_route_set() -> set[tuple[str, str]]:
    return {
        (route.path, method)
        for route in catalog_routes.router.routes
        for method in getattr(route, "methods", set())
    }


def test_the_six_public_catalog_routes_are_exactly_these():
    """Pins the set every test below assumes it is covering. A route added to
    or removed from this router should make this fail rather than leave a
    seventh route silently uncovered, or a retired one silently asserted on."""
    assert _catalog_route_set() == {
        ("/catalog/entries", "GET"),
        ("/catalog/estimates", "GET"),
        ("/catalog/profiles", "GET"),
        ("/catalog/entries/{slug}", "GET"),
        ("/catalog/entries/{slug}/estimate", "GET"),
        ("/catalog/entries/{slug}/profile", "GET"),
    }


# --------------------------------------------------------------------------
# Each route sets the same Cache-Control, called directly. No app, no
# database — the repository layer is doubled out.
# --------------------------------------------------------------------------


async def test_list_entries_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "count_public_catalog_entries", AsyncMock(return_value=0))
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    authority = _authority()
    response = Response()

    await catalog_routes.list_catalog_entries(
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


async def test_estimates_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    authority = _authority()
    response = Response()

    await catalog_routes.list_catalog_estimates(
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


async def test_profiles_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    authority = _authority()
    response = Response()

    await catalog_routes.list_catalog_profiles(
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


async def test_entry_detail_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "get_public_catalog_entry", AsyncMock(return_value=_entry()))
    authority = _authority()
    response = Response()

    await catalog_routes.get_catalog_entry(
        slug="demo-entry",
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


async def test_entry_estimate_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "get_public_catalog_entry", AsyncMock(return_value=_entry()))
    authority = _authority()
    response = Response()

    await catalog_routes.get_catalog_entry_estimate(
        slug="demo-entry",
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


async def test_entry_profile_is_publicly_cacheable(monkeypatch):
    monkeypatch.setattr(catalog_repo, "get_public_catalog_entry", AsyncMock(return_value=_entry()))
    authority = _authority()
    response = Response()

    await catalog_routes.get_catalog_entry_profile(
        slug="demo-entry",
        scope=authority.public_scope(),
        session=None,
        settings=_settings(authority),
        response=response,
    )

    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL


# --------------------------------------------------------------------------
# Wired into the app: the rate-limit middleware strips X-Majorana-Caller-Trust
# from exactly the responses proven above to carry `Cache-Control: public`,
# and touches nothing else. `get_session` is overridden rather than run
# through `_lifespan`, matching test_qpu_credential_routes.py's `client`
# fixture — nothing here needs a database either.
# --------------------------------------------------------------------------


def _http_client(app):
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_a_cacheable_catalog_response_does_not_carry_the_caller_trust_header(monkeypatch):
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    app = create_app(_settings(_authority()))
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    async with _http_client(app) as client:
        response = await client.get("/v1/catalog/profiles")

    assert response.status_code == 200
    assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL
    assert CALLER_TRUST_HEADER not in response.headers
    # And the cache is keyed on the credential, so a stored anonymous variant
    # cannot be served to the renderer and hide its diagnostic (see the trusted
    # test below).
    assert TRUSTED_CALLER_HEADER.lower() in response.headers["vary"].lower()


async def test_a_non_cacheable_catalog_response_still_carries_the_caller_trust_header(monkeypatch):
    """The control for the test above.

    A 404 for an unknown slug never sets Cache-Control: the route's injected
    `Response` is discarded in favour of a fresh one the `NotFoundError`
    handler builds (app.py's `_not_found`), so nothing here is publicly
    cacheable. The middleware must leave the trust header alone in this case —
    proving the strip above is conditional on the response actually being
    marked public, not a blanket removal applied to every catalog path.
    """
    monkeypatch.setattr(
        catalog_repo, "get_public_catalog_entry", AsyncMock(side_effect=NotFoundError())
    )
    app = create_app(_settings(_authority()))
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    async with _http_client(app) as client:
        response = await client.get("/v1/catalog/entries/no-such-slug")

    assert response.status_code == 404
    assert "cache-control" not in response.headers
    assert response.headers[CALLER_TRUST_HEADER] == "anonymous"


async def test_an_unrelated_authenticated_route_is_never_marked_publicly_cacheable():
    """The other control: proves `_set_public_cache_control` is something the
    six catalog routes opt into, not a default the app applies broadly.

    `/v1/me` refuses a request with no bearer token before touching the
    database (auth/deps.py's `get_verified_token`), so this needs no
    dependency override at all.
    """
    app = create_app(_settings(_authority()))

    async with _http_client(app) as client:
        response = await client.get("/v1/me")

    assert response.status_code == 401
    assert "cache-control" not in response.headers


# --------------------------------------------------------------------------
# The cross-language coupling, read rather than remembered
# --------------------------------------------------------------------------


def test_the_api_never_caches_longer_than_the_site_agreed_to() -> None:
    """The one direction of drift that is not harmless.

    `CATALOG_CACHE_MAX_AGE_SECONDS` and the web's `CATALOG_REVALIDATE_SECONDS`
    are the same staleness budget written twice, in two languages, in two
    services, with no shared module between them. A TIGHTER value here costs
    extra cache misses and nothing else. A LOOSER one means a shared cache may
    hold a catalog response older than the window the site accepted — the API
    becomes the stale side, silently, in production only.

    So this reads the TypeScript source rather than restating its number, the
    same way `scripts/catalog-bootstrap/from-catalog-validator.test.mjs` reads
    the Python allowlist rather than keeping a third copy of it. A copy typed in
    here would agree with whichever side it was typed from, forever.
    """
    source = (REPO_ROOT / "apps" / "web" / "lib" / "catalog-revalidate.ts").read_text(
        encoding="utf-8"
    )
    match = re.search(r"export const CATALOG_REVALIDATE_SECONDS\s*=\s*(\d+)", source)
    assert match, (
        "CATALOG_REVALIDATE_SECONDS was not found in apps/web/lib/catalog-revalidate.ts — "
        "it moved or was renamed, and this guard is reading nothing"
    )
    web_seconds = int(match.group(1))
    assert web_seconds > 0, "the web revalidate window parsed as zero; the extraction is broken"
    assert catalog_routes.CATALOG_CACHE_MAX_AGE_SECONDS <= web_seconds, (
        f"the API caches for {catalog_routes.CATALOG_CACHE_MAX_AGE_SECONDS}s while the site "
        f"revalidates every {web_seconds}s. A shared cache can now serve a catalog response "
        "older than the staleness the site accepted, and nothing downstream will say so."
    )


def test_the_grace_window_does_not_double_the_staleness_budget() -> None:
    """`stale-while-revalidate` extends how long a stale copy may be served.

    It is a grace window for the revalidation itself, not a second max-age. Left
    unbounded it would quietly turn the budget asserted above into
    `max-age + swr`, which is the thing that assertion exists to prevent.
    """
    assert (
        0
        < catalog_routes.CATALOG_CACHE_STALE_WHILE_REVALIDATE_SECONDS
        <= (catalog_routes.CATALOG_CACHE_MAX_AGE_SECONDS // 2)
    )


async def test_the_renderer_keeps_its_trust_verdict_on_a_privately_cached_response(monkeypatch):
    """The regression this split exists to prevent.

    The first version of the strip removed CALLER_TRUST_HEADER from every
    `public` response, reasoning that nothing downstream reads it. Something
    does: `apps/web/lib/trusted-caller.ts`'s `reportCallerTrust` runs on every
    catalog fetch the renderer makes, and its module comment says a mismatch is
    **the only symptom** the failure it detects has — the renderer's token
    misconfigured or rejected, so our own server-side renders are metered
    against the anonymous ceiling, hit it under load, and fall back to the
    bundled static corpus with nothing saying why.

    Stripping the header from exactly the six routes the renderer fetches turned
    that detector off. So the split is by CALLER: a trusted caller keeps the
    verdict and the response becomes `private`, which no shared cache may store.
    """
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    settings = Settings(
        **SETTINGS_KWARGS, catalog_authority=_authority(), trusted_caller_token=_TRUSTED_TOKEN
    )
    app = create_app(settings)
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    async with _http_client(app) as client:
        response = await client.get(
            "/v1/catalog/profiles", headers={TRUSTED_CALLER_HEADER: _TRUSTED_TOKEN}
        )

    assert response.status_code == 200
    cache_control = response.headers["cache-control"]
    # Private, not public: the payload is identical either way, but this variant
    # carries a header describing its caller and must not be shared.
    assert cache_control.startswith("private,")
    assert "public" not in cache_control
    # The max-age is unchanged — this is a scope change, not a freshness change.
    assert cache_control == EXPECTED_CACHE_CONTROL.replace("public", "private", 1)
    assert response.headers[CALLER_TRUST_HEADER] == "trusted"


async def test_an_anonymous_caller_still_gets_the_shared_cacheable_variant(monkeypatch):
    """The control. The split must key off the credential, not off the route —
    otherwise `private` would leak onto every catalog response and the CDN
    caching this whole change exists for would never happen."""
    monkeypatch.setattr(catalog_repo, "list_public_catalog_entries", AsyncMock(return_value=[]))
    settings = Settings(
        **SETTINGS_KWARGS, catalog_authority=_authority(), trusted_caller_token=_TRUSTED_TOKEN
    )
    app = create_app(settings)
    app.dependency_overrides[auth_deps.get_session] = lambda: object()

    async with _http_client(app) as client:
        anonymous = await client.get("/v1/catalog/profiles")
        wrong_token = await client.get(
            "/v1/catalog/profiles", headers={TRUSTED_CALLER_HEADER: "not-the-secret"}
        )

    for response in (anonymous, wrong_token):
        assert response.headers["cache-control"] == EXPECTED_CACHE_CONTROL
        assert CALLER_TRUST_HEADER not in response.headers
