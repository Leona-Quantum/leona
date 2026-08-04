"""Per-IP admission control for anonymous traffic (rate_limit.py, 05-security.md §1).

The policy is tested directly rather than through the app wherever it can be:
`FixedWindowLimiter.check` takes `now`, so the window can be proven to roll
without a test that sleeps for a minute.
"""

import httpx

from majorana_api.app import create_app
from majorana_api.rate_limit import (
    DEFAULT_ANON_LIMIT,
    MAX_REQUEST_BYTES,
    FixedWindowLimiter,
    client_address,
    is_rate_limited_path,
)
from majorana_api.settings import Settings

ISSUER = "https://api.workos.com/user_management/client_test"
JWKS_URL = "https://api.workos.com/sso/jwks/client_test"


def _settings(**overrides) -> Settings:
    base = dict(
        workos_client_id="client_test",
        workos_jwt_issuer=ISSUER,
        workos_jwks_url=JWKS_URL,
        web_origin="http://localhost:3000",
    )
    base.update(overrides)
    return Settings(**base)


# --------------------------------------------------------------------------
# The policy
# --------------------------------------------------------------------------


def test_requests_up_to_the_limit_are_allowed():
    limiter = FixedWindowLimiter(limit=3, window_s=60.0)
    assert [limiter.check("1.2.3.4", now=0.0).allowed for _ in range(3)] == [True] * 3


def test_the_request_after_the_limit_is_refused():
    limiter = FixedWindowLimiter(limit=3, window_s=60.0)
    for _ in range(3):
        limiter.check("1.2.3.4", now=0.0)
    decision = limiter.check("1.2.3.4", now=0.0)
    assert not decision.allowed
    # Never zero: "retry in 0 seconds" is the instruction that caused the refusal.
    assert decision.retry_after_s >= 1


def test_the_window_rolls():
    limiter = FixedWindowLimiter(limit=2, window_s=60.0)
    limiter.check("1.2.3.4", now=0.0)
    limiter.check("1.2.3.4", now=0.0)
    assert not limiter.check("1.2.3.4", now=30.0).allowed
    assert limiter.check("1.2.3.4", now=61.0).allowed


def test_addresses_are_metered_separately():
    """The whole point: one busy caller must not refuse a different one."""
    limiter = FixedWindowLimiter(limit=1, window_s=60.0)
    assert limiter.check("1.1.1.1", now=0.0).allowed
    assert not limiter.check("1.1.1.1", now=0.0).allowed
    assert limiter.check("2.2.2.2", now=0.0).allowed


def test_a_zero_limit_disables_the_limiter():
    """The documented escape hatch — an unbounded catalog is recoverable, a
    throttled one looks like an outage."""
    limiter = FixedWindowLimiter(limit=0)
    assert all(limiter.check("1.2.3.4", now=0.0).allowed for _ in range(1000))


def test_expired_entries_are_swept_rather_than_accumulating():
    limiter = FixedWindowLimiter(limit=5, window_s=60.0, max_keys=10)
    for i in range(10):
        limiter.check(f"10.0.0.{i}", now=0.0)
    assert len(limiter._windows) == 10
    limiter.check("10.0.1.1", now=120.0)  # forces the sweep
    assert len(limiter._windows) == 1


def test_a_saturated_table_admits_rather_than_refusing():
    """Degrading to OFF, not to REFUSE. A rotating attacker already defeats a
    per-IP limiter; what must not follow is that they take the site down for
    everyone else."""
    limiter = FixedWindowLimiter(limit=1, window_s=60.0, max_keys=2)
    limiter.check("1.1.1.1", now=0.0)
    limiter.check("2.2.2.2", now=0.0)
    # Table full of LIVE entries, so the sweep frees nothing.
    decision = limiter.check("3.3.3.3", now=0.0)
    assert decision.allowed
    assert limiter.saturated_admissions == 1


# --------------------------------------------------------------------------
# Caller identity
# --------------------------------------------------------------------------


def test_the_client_address_is_the_first_forwarded_entry():
    """Cloud Run terminates TLS at the front end, so the socket peer is always
    infrastructure and the leftmost forwarded entry is the originating client."""
    headers = {"x-forwarded-for": "203.0.113.7, 130.211.0.1"}
    assert client_address(headers, "10.0.0.1") == "203.0.113.7"


def test_the_socket_peer_is_used_when_nothing_is_forwarded():
    assert client_address({}, "10.0.0.1") == "10.0.0.1"


def test_a_caller_with_no_address_at_all_still_gets_a_key():
    """Grouping unidentifiable callers together is correct: they are metered as
    one noisy caller rather than escaping the limiter by being anonymous twice."""
    assert client_address({}, None) == "unknown"


# --------------------------------------------------------------------------
# Wired into the app
# --------------------------------------------------------------------------


def _client(app):
    """No lifespan: the limiter answers before a handler, a dependency or a
    database session exists, which is the property being tested. Same transport
    the deploy-probe enumeration uses."""
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_anonymous_traffic_is_refused_with_a_problem_document():
    app = create_app(_settings(anon_rate_limit_per_minute=2))
    headers = {"x-forwarded-for": "203.0.113.9"}
    async with _client(app) as client:
        for _ in range(2):
            await client.get("/v1/catalog/entries", headers=headers)
        response = await client.get("/v1/catalog/entries", headers=headers)

    assert response.status_code == 429
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.headers["Retry-After"]
    assert response.json()["reason"] == "anonymous_rate_limited"


async def test_a_credentialless_write_route_is_not_metered_by_address():
    """The failure CI caught, pinned.

    An authz suite overriding the identity dependency sends no `Authorization`
    header, so 250 imports by ONE authenticated user read as 250 anonymous
    requests from one address and the 241st was refused. In production the
    header is always present, so no real user would have seen it — which is why
    this is pinned rather than tuned around. The signal was wrong, and it was
    wrong in the one direction nothing outside CI would surface.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=2))
    async with _client(app) as client:
        statuses = {
            (await client.post("/v1/artifacts/import-public", json={})).status_code
            for _ in range(6)
        }

    assert 429 not in statuses


async def test_a_forged_authorization_header_cannot_skip_the_limiter():
    """`Authorization: Bearer x` is free to send, so it must not exempt anyone.

    The first version of this middleware skipped every header-bearing caller,
    which meant a scraper defeated the whole control by sending one junk header.
    Asserted on the FORGED requests themselves — an earlier version of this test
    sent the forged request and then measured plain ones, which would have
    passed with the bypass wide open.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=2))
    forged = {"x-forwarded-for": "203.0.113.44", "authorization": "Bearer not-a-real-token"}
    async with _client(app) as client:
        statuses = [
            (await client.get("/v1/catalog/entries", headers=forged)).status_code for _ in range(4)
        ]

    assert 429 in statuses, "a junk Authorization header bought an exemption"


def test_only_the_anonymous_serving_surface_is_metered():
    assert is_rate_limited_path("/v1/catalog/entries")
    assert is_rate_limited_path("/v1/catalog/entries/some-slug/estimate")
    for path in ("/v1/runs", "/v1/artifacts/import-public", "/v1/workspace", "/health"):
        assert not is_rate_limited_path(path), path


async def test_an_authenticated_caller_is_not_metered_off_the_public_surface():
    """The NAT concern, honoured where it actually applies.

    A lab or an office is many paying users behind one address, and refusing
    them because a neighbour was busy is worse than the abuse the limiter
    prevents. They are bounded by their tier allowance, which knows who they
    are. On the public catalog they are metered like anyone else — see the
    forged-header test for why no exemption can be made there.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=1))
    headers = {"x-forwarded-for": "203.0.113.10", "authorization": "Bearer whatever"}
    async with _client(app) as client:
        statuses = {(await client.get("/v1/runs", headers=headers)).status_code for _ in range(5)}

    assert 429 not in statuses


async def test_the_health_check_is_never_refused():
    """A throttled liveness probe takes the revision down — the one outcome
    worse than the abuse being throttled."""
    app = create_app(_settings(anon_rate_limit_per_minute=1))
    async with _client(app) as client:
        statuses = {(await client.get("/health")).status_code for _ in range(10)}

    assert statuses == {200}


async def test_an_oversized_body_is_refused_before_it_is_read():
    """Pydantic bounds each FIELD, but only after the whole document has been
    received and parsed. Nothing before this bounded the request itself."""
    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.post(
            "/v1/runs",
            headers={"content-length": str(MAX_REQUEST_BYTES + 1)},
            content=b"{}",
        )

    assert response.status_code == 413
    assert response.json()["reason"] == "request_too_large"


async def test_an_ordinary_body_is_not_refused():
    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.post("/v1/runs", json={"task_prompt": "hello"})

    assert response.status_code != 413


def test_the_body_limit_clears_the_largest_legitimate_document():
    """`source_code` is capped at 100 KB and an import carries code plus QASM."""
    assert MAX_REQUEST_BYTES > 256 * 1024


def test_the_default_limit_is_far_above_a_reader():
    """Sized to refuse a scraper in a loop, not to shape human traffic: the
    browse list is one request and a detail page two."""
    assert DEFAULT_ANON_LIMIT >= 120
