"""Per-IP admission control for anonymous traffic (rate_limit.py, 05-security.md §1).

The policy is tested directly rather than through the app wherever it can be:
`FixedWindowLimiter.check` takes `now`, so the window can be proven to roll
without a test that sleeps for a minute.
"""

import httpx
import pytest

from majorana_api.app import create_app
from majorana_api.rate_limit import (
    CALLER_TRUST_HEADER,
    DEFAULT_ANON_LIMIT,
    DEFAULT_AUTH_FAILURE_LIMIT,
    DEFAULT_TRUSTED_LIMIT,
    MAX_REQUEST_BYTES,
    TRUSTED_CALLER_HEADER,
    AuthFailureThrottle,
    FixedWindowLimiter,
    client_address,
    is_rate_limited_path,
    is_trusted_caller,
)
from majorana_api.settings import Settings

#: Long enough to satisfy the 32-character floor the settings enforce.
TRUSTED_TOKEN = "trusted-caller-token-for-tests-0123456789"

#: Same convention as test_deploy_probe_credential.py's PROBE_TOKEN.
PROBE_TOKEN = "p" * 48

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


def test_cf_connecting_ip_is_not_preferred():
    """Deliberate, not an oversight — see `client_address`'s "Cloudflare
    (ai-ops#141) does not change any of this" section. This service has no
    domain inside any Cloudflare-proxied zone (no Cloud Run domain mapping, no
    DNS record under `leonaqt.com`), so nothing here could ever verify this
    header — honouring it would hand an attacker a second, unaudited way to
    pick their own bucket, on top of the one `X-Forwarded-For` already accepts.
    apps/web's own limiter is where the Cloudflare rollout is actually handled.
    """
    headers = {"x-forwarded-for": "203.0.113.9", "cf-connecting-ip": "198.51.100.1"}
    assert client_address(headers, "10.0.0.1") == "203.0.113.9"


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


async def test_a_chunked_body_cannot_evade_the_limit():
    """The bypass a Content-Length check cannot see.

    `Transfer-Encoding: chunked` declares no length, so the header check has
    nothing to compare — a probe confirmed a 2 MiB chunked body reaching the
    handler under a 1 MiB "limit". The comment above that check claimed a
    total-size bound the code did not deliver, which is worse than no bound
    because it stops anyone looking. Counting arriving chunks is what makes it
    true.
    """

    async def oversized():
        for _ in range(MAX_REQUEST_BYTES // 65536 + 2):
            yield b"x" * 65536

    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.post("/v1/runs", content=oversized())

    assert response.status_code == 413
    assert response.json()["reason"] == "request_too_large"


async def test_a_chunked_body_under_the_limit_still_reaches_the_handler():
    """The control. A limit that refused every chunked request would pass the
    test above while breaking the API."""

    async def small():
        yield b'{"task_prompt":"'
        yield b"hello"
        yield b'"}'

    app = create_app(_settings())
    async with _client(app) as client:
        response = await client.post("/v1/runs", content=small())

    # 401 — it got past the size gate and reached auth, which is the point.
    assert response.status_code != 413


def test_the_body_limit_clears_the_largest_legitimate_document():
    """`source_code` is capped at 100 KB and an import carries code plus QASM."""
    assert MAX_REQUEST_BYTES > 256 * 1024


def test_the_default_limit_has_headroom_over_our_own_renderer():
    """The limit is sized for Vercel's SSR egress, not for a browser.

    Nothing in the browser calls `/v1/catalog/*` — `repository-source.ts` is
    server-side — so this endpoint sees a handful of shared Vercel addresses
    carrying every visitor. Tripping the limiter there returns no error to
    anyone: the web catches it and serves the stale static corpus. A control
    that fails silently to stale data needs enormous headroom, which is why
    this floor is high and why lowering it needs the trusted-caller exemption
    first.
    """
    assert DEFAULT_ANON_LIMIT >= 1200


# --------------------------------------------------------------------------
# The trusted-caller exemption
#
# Its subject is our own server-side renderer, which is the only traffic
# `/v1/catalog/*` actually sees. The tests below are written around the one
# thing that would make the whole feature a liability: a caller who does NOT
# hold the secret must not reach the trusted bucket. Every positive case here
# has a negative control next to it, because a test that only proves the token
# WORKS would pass just as well against an exemption that trusted everybody.
# --------------------------------------------------------------------------


def test_the_matching_token_is_trusted():
    assert is_trusted_caller({TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}, TRUSTED_TOKEN)


def test_a_wrong_token_is_not_trusted():
    assert not is_trusted_caller({TRUSTED_CALLER_HEADER: "not-the-token"}, TRUSTED_TOKEN)


def test_a_token_that_is_a_prefix_of_the_secret_is_not_trusted():
    """Guards the comparison itself. A membership or `startswith` check would
    pass the test above and hand the exemption to anyone who guessed one byte."""
    assert not is_trusted_caller({TRUSTED_CALLER_HEADER: TRUSTED_TOKEN[:10]}, TRUSTED_TOKEN)
    assert not is_trusted_caller({TRUSTED_CALLER_HEADER: TRUSTED_TOKEN + "x"}, TRUSTED_TOKEN)


def test_no_header_is_not_trusted():
    assert not is_trusted_caller({}, TRUSTED_TOKEN)


def test_an_unconfigured_service_trusts_nobody():
    """The direction that fails safe.

    A deployment that has not set the secret must meter its own renderer as
    anonymous — which is what it did before the exemption existed. The opposite
    default, where an empty expectation matches an empty header, would hand the
    exemption to every anonymous caller in the world the moment the variable
    went missing from the API's environment.
    """
    assert not is_trusted_caller({TRUSTED_CALLER_HEADER: ""}, "")
    assert not is_trusted_caller({TRUSTED_CALLER_HEADER: "anything"}, "")
    assert not is_trusted_caller({}, "")


async def test_the_trusted_caller_is_metered_in_its_own_bucket():
    app = create_app(
        _settings(
            anon_rate_limit_per_minute=2,
            trusted_caller_token=TRUSTED_TOKEN,
            trusted_rate_limit_per_minute=100,
        )
    )
    headers = {"x-forwarded-for": "203.0.113.60", TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}
    async with _client(app) as client:
        statuses = [
            (await client.get("/v1/catalog/entries", headers=headers)).status_code for _ in range(6)
        ]

    assert 429 not in statuses


async def test_a_wrong_token_is_metered_as_anonymous():
    """The control for the test above, and the one that matters.

    Same settings, same address, same number of requests — only the secret is
    wrong. Without this, an exemption that trusted every caller presenting any
    header at all would pass the positive case perfectly. That is not a
    hypothetical failure mode in this file: the middleware's first shape
    exempted every caller who sent an `Authorization` header, and the test that
    caught it is thirty lines up.
    """
    app = create_app(
        _settings(
            anon_rate_limit_per_minute=2,
            trusted_caller_token=TRUSTED_TOKEN,
            trusted_rate_limit_per_minute=100,
        )
    )
    headers = {"x-forwarded-for": "203.0.113.61", TRUSTED_CALLER_HEADER: "wrong-token"}
    async with _client(app) as client:
        statuses = [
            (await client.get("/v1/catalog/entries", headers=headers)).status_code for _ in range(6)
        ]

    assert 429 in statuses, "a wrong trusted-caller token bought an exemption"


async def test_the_token_does_not_exempt_an_unconfigured_service():
    """A secret set in the renderer but not on the API buys nothing.

    This is the half-configured state a rotation passes through, and it must
    degrade to today's behaviour rather than to an open door.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=2, trusted_caller_token=""))
    headers = {"x-forwarded-for": "203.0.113.62", TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}
    async with _client(app) as client:
        statuses = [
            (await client.get("/v1/catalog/entries", headers=headers)).status_code for _ in range(6)
        ]

    assert 429 in statuses


async def test_the_trusted_bucket_is_bounded():
    """Exempt from the anonymous ceiling, not from metering.

    The bound is a backstop against our own renderer looping, which is a failure
    this service has had. An exemption that skipped the limiter entirely would
    let one runaway render path saturate the API with nothing reporting it.
    """
    app = create_app(
        _settings(
            anon_rate_limit_per_minute=1000,
            trusted_caller_token=TRUSTED_TOKEN,
            trusted_rate_limit_per_minute=3,
        )
    )
    headers = {"x-forwarded-for": "203.0.113.63", TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}
    async with _client(app) as client:
        statuses = [
            (await client.get("/v1/catalog/entries", headers=headers)).status_code for _ in range(5)
        ]

    assert 429 in statuses


async def test_the_trust_verdict_is_readable_off_a_healthy_response():
    """The read-back, and the reason the exemption is verifiable at all.

    A token that is missing, misspelled or stale in the renderer's environment
    presents exactly like a working one: the catalog renders, from the static
    corpus, until somebody notices the data is old. One header on a 200 turns
    that into a question anybody can answer with a single request against the
    live service.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=100, trusted_caller_token=TRUSTED_TOKEN))
    async with _client(app) as client:
        trusted = await client.get(
            "/v1/catalog/entries", headers={TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}
        )
        anonymous = await client.get("/v1/catalog/entries")

    assert trusted.headers[CALLER_TRUST_HEADER] == "trusted"
    assert anonymous.headers[CALLER_TRUST_HEADER] == "anonymous"


async def test_the_trust_verdict_is_readable_off_a_refusal():
    """Emitted on the 429 too. A refused renderer is the exact case where the
    verdict is the thing you want to know, and returning it only on success
    would withhold it precisely then."""
    app = create_app(_settings(anon_rate_limit_per_minute=1, trusted_caller_token=TRUSTED_TOKEN))
    headers = {"x-forwarded-for": "203.0.113.64"}
    async with _client(app) as client:
        await client.get("/v1/catalog/entries", headers=headers)
        refused = await client.get("/v1/catalog/entries", headers=headers)

    assert refused.status_code == 429
    assert refused.headers[CALLER_TRUST_HEADER] == "anonymous"


async def test_a_non_ascii_token_header_does_not_500_the_public_catalog():
    """One header byte was an unauthenticated 500. Pinned.

    `hmac.compare_digest` raises TypeError on a non-ASCII `str`, and header bytes
    arrive here latin-1 decoded — so `X-Majorana-Trusted-Caller: \\x80` reached
    the comparison, raised, and came back 500 from `/v1/catalog/*`, the one route
    that takes no credential at all. Anybody could produce it, in a loop, for
    free.

    Sent as raw BYTES rather than a `str` because that is what a client actually
    puts on the wire; httpx refuses to ascii-encode the str, which is precisely
    why an ordinary client-side test would never have found this.
    """
    app = create_app(_settings(anon_rate_limit_per_minute=100, trusted_caller_token=TRUSTED_TOKEN))
    async with _client(app) as client:
        response = await client.get(
            "/v1/catalog/entries",
            headers={b"x-majorana-trusted-caller": bytes([0x80])},
        )

    assert response.status_code != 500, "a non-ASCII trusted-caller header 500s the API"
    # And it is metered as anonymous, which is the only correct reading: the
    # token is ASCII by construction, so a non-ASCII header cannot be ours.
    assert response.headers[CALLER_TRUST_HEADER] == "anonymous"


def test_a_non_ascii_token_is_refused_at_startup():
    """The other half. A non-ASCII secret matches no header this service will
    ever accept, so the exemption would silently never apply while the service
    started perfectly healthy."""
    with pytest.raises(RuntimeError, match="must be ASCII"):
        _settings(trusted_caller_token="trusted-caller-token-for-tests-0123456789-ü")


async def test_a_refused_trusted_caller_is_not_told_it_is_anonymous():
    """The refusal names the bucket that refused it.

    Reporting the renderer's own ceiling as an anonymous one points whoever is
    reading at scrapers, when the only thing that ceiling catches is our own
    render path looping. It also told our own server to "sign in".
    """
    app = create_app(
        _settings(
            anon_rate_limit_per_minute=100,
            trusted_caller_token=TRUSTED_TOKEN,
            trusted_rate_limit_per_minute=1,
        )
    )
    headers = {"x-forwarded-for": "203.0.113.70", TRUSTED_CALLER_HEADER: TRUSTED_TOKEN}
    async with _client(app) as client:
        await client.get("/v1/catalog/entries", headers=headers)
        refused = await client.get("/v1/catalog/entries", headers=headers)

    assert refused.status_code == 429
    assert refused.json()["reason"] == "trusted_rate_limited"
    assert refused.headers[CALLER_TRUST_HEADER] == "trusted"
    assert "sign in" not in refused.json()["title"]


def test_the_trusted_ceiling_clears_a_launch_by_a_wide_margin():
    """283 records at a 300-second revalidate window is single-digit requests a
    minute from the renderer, whatever the visitor count. The headroom is for
    cache misses and rolling deploys, not for the traffic itself."""
    assert DEFAULT_TRUSTED_LIMIT >= 20_000


# --------------------------------------------------------------------------
# Provisioning the secret
# --------------------------------------------------------------------------


def test_a_short_trusted_token_is_refused_at_startup():
    """It is compared on a route that takes no credential, so an attacker may
    probe it without limit. Weak here is weak against an unbounded oracle."""
    with pytest.raises(RuntimeError, match="at least 32 characters"):
        _settings(trusted_caller_token="short")


def test_a_public_placeholder_is_refused_as_a_trusted_token():
    with pytest.raises(RuntimeError, match="public placeholder"):
        _settings(trusted_caller_token="changeme")


def test_the_trusted_token_may_not_be_the_deploy_probe_token():
    """Different blast radii: the probe can create a run, this can only pick a
    rate-limit bucket. Sharing one value silently promotes the weaker one, and
    the obvious way to provision the second is to copy the first."""
    with pytest.raises(RuntimeError, match="must be different secrets"):
        _settings(trusted_caller_token=TRUSTED_TOKEN, deploy_probe_token=TRUSTED_TOKEN)


# --------------------------------------------------------------------------
# The auth-failure throttle (AuthFailureThrottle, ai-ops#145)
#
# Its whole design point is metering the RESPONSE rather than the request, so
# the load-bearing test in this section is
# `test_successful_requests_never_count_toward_the_ceiling` — the negative
# control for the one failure mode this control cannot repeat: the anonymous
# limiter's first shape counted a request that *looked* like the thing being
# policed, and a CI authz suite that overrides the identity dependency and
# rejects nothing showed the gap. Metering the outcome instead means there is
# nothing for a passing request to accidentally resemble.
# --------------------------------------------------------------------------


def test_fewer_failures_than_the_limit_are_not_blocked():
    throttle = AuthFailureThrottle(limit=3, window_s=300.0)
    for _ in range(2):
        throttle.record_failure("1.2.3.4", now=0.0)
    assert throttle.should_block("1.2.3.4", now=0.0).allowed


def test_reaching_the_limit_blocks_the_next_attempt():
    """`limit` failures are allowed to happen — each one already reached the
    route and was refused there — and only the attempt that would become the
    NEXT failure is refused pre-emptively. See `should_block`'s `>=` comment
    for why this is off by one from `FixedWindowLimiter.check`'s `>`."""
    throttle = AuthFailureThrottle(limit=3, window_s=300.0)
    for _ in range(3):
        throttle.record_failure("1.2.3.4", now=0.0)
    decision = throttle.should_block("1.2.3.4", now=0.0)
    assert not decision.allowed
    # Never zero, same reasoning as FixedWindowLimiter: "retry in 0 seconds" is
    # the instruction that caused the block.
    assert decision.retry_after_s >= 1


def test_a_caller_who_has_never_failed_is_never_blocked():
    throttle = AuthFailureThrottle(limit=1, window_s=300.0)
    assert throttle.should_block("9.9.9.9", now=0.0).allowed


def test_addresses_are_throttled_separately():
    """The whole point, same as the anonymous limiter's version of this test:
    one address's failures must not refuse a different one."""
    throttle = AuthFailureThrottle(limit=1, window_s=300.0)
    throttle.record_failure("1.1.1.1", now=0.0)
    throttle.record_failure("1.1.1.1", now=0.0)
    assert not throttle.should_block("1.1.1.1", now=0.0).allowed
    assert throttle.should_block("2.2.2.2", now=0.0).allowed


def test_the_window_rolls_and_clears_the_block():
    throttle = AuthFailureThrottle(limit=1, window_s=300.0)
    throttle.record_failure("1.2.3.4", now=0.0)
    throttle.record_failure("1.2.3.4", now=0.0)
    assert not throttle.should_block("1.2.3.4", now=100.0).allowed
    assert throttle.should_block("1.2.3.4", now=301.0).allowed


def test_a_zero_limit_disables_the_throttle():
    """The documented escape hatch — a caller wrongly refused for their
    address's failures is worse than an unmetered one."""
    throttle = AuthFailureThrottle(limit=0)
    for _ in range(1000):
        throttle.record_failure("1.2.3.4", now=0.0)
    assert throttle.should_block("1.2.3.4", now=0.0).allowed


def test_should_block_never_creates_a_table_entry():
    """Read-only, on purpose: a caller who never fails must never occupy a
    table slot. This is what lets a full table degrade to OFF for a caller it
    has genuinely never recorded a failure for — see the saturation test
    below."""
    throttle = AuthFailureThrottle(limit=1, window_s=300.0)
    throttle.should_block("1.2.3.4", now=0.0)
    assert len(throttle._windows) == 0


def test_a_saturated_table_stops_tracking_rather_than_blocking():
    """Same direction as FixedWindowLimiter's saturation test: an attacker
    rotating source addresses to fill the table must not end up blocking
    everyone else — degrading to OFF, not to REFUSE."""
    throttle = AuthFailureThrottle(limit=1, window_s=300.0, max_keys=2)
    throttle.record_failure("1.1.1.1", now=0.0)
    throttle.record_failure("1.1.1.1", now=0.0)
    throttle.record_failure("2.2.2.2", now=0.0)
    throttle.record_failure("2.2.2.2", now=0.0)
    # Table full of LIVE entries, so a third address's failure cannot be
    # recorded at all.
    throttle.record_failure("3.3.3.3", now=0.0)
    assert throttle.should_block("3.3.3.3", now=0.0).allowed
    assert throttle.saturated_admissions == 1


def test_the_default_ceiling_has_headroom_over_a_shared_address():
    """A floor, not a target. Sized against the population described in
    `AuthFailureThrottle`'s docstring — Vercel's shared BFF egress carrying
    every signed-in user's proxied requests, not one browser — so this has to
    clear several stale-session clusters (~10 failures each, one dashboard
    load's several panels all firing on one dead token at once) landing on the
    same address inside one window, not just one."""
    assert DEFAULT_AUTH_FAILURE_LIMIT >= 100


# --------------------------------------------------------------------------
# Wired into the app
# --------------------------------------------------------------------------


async def test_a_caller_under_the_ceiling_is_still_served():
    app = create_app(_settings(auth_failure_limit=5))
    async with _client(app) as client:
        statuses = [(await client.get("/v1/runs")).status_code for _ in range(5)]
    # Every one reached the route and was refused THERE (missing bearer
    # token) — none of them was refused by the throttle.
    assert statuses == [401] * 5


async def test_a_caller_over_the_ceiling_is_throttled():
    app = create_app(_settings(auth_failure_limit=3))
    async with _client(app) as client:
        for _ in range(3):
            await client.get("/v1/runs")
        response = await client.get("/v1/runs")

    assert response.status_code == 429
    assert response.json()["reason"] == "auth_failure_throttled"
    assert response.headers["Retry-After"]


async def test_successful_requests_never_count_toward_the_ceiling():
    """The negative control for the one failure mode this control cannot
    repeat — see this section's header comment. A limiter that (wrongly)
    counted every request, or every request without a header, would fail this
    exactly the way the anonymous limiter's first shape failed in CI."""
    app = create_app(_settings(auth_failure_limit=3))
    async with _client(app) as client:
        statuses = {(await client.get("/v1/catalog/entries")).status_code for _ in range(10)}

    assert 429 not in statuses


async def test_403_does_not_count_toward_the_ceiling():
    """The redesign this section's constants document: 403 was cut after
    review because most of it is a correctly-authenticated caller being told
    no by business logic, not a credential problem. The deploy probe hitting a
    route it may not reach is a real, DB-free 403 that goes through the exact
    same code path a route's own tier/ownership check would — a wrong probe
    route rather than a wrong plan is used here only because it needs no
    database to reach, not because the two are different for this control's
    purposes. See `test_the_deploy_probe_is_never_counted_toward_the_ceiling`
    for the same request sequence checked from the probe's own point of view.
    """
    app = create_app(_settings(auth_failure_limit=1, deploy_probe_token=PROBE_TOKEN))
    headers = {"Authorization": f"Bearer {PROBE_TOKEN}"}
    async with _client(app) as client:
        # /v1/me is not in DEPLOY_PROBE_ROUTES, so every one of these is a
        # clean 403 from `_probe_may_reach` — never a 401, never DB-backed.
        statuses = [(await client.get("/v1/me", headers=headers)).status_code for _ in range(5)]

    assert statuses == [403] * 5, "a limit of 1 would 429 the second call if 403 still counted"


async def test_a_404_does_not_count_toward_the_ceiling():
    """Negative control for the status-code check itself: only a broadening of
    `response.status_code == 401` to something like `>= 400` would make an
    ordinary unknown-path 404 start counting."""
    app = create_app(_settings(auth_failure_limit=3))
    async with _client(app) as client:
        statuses = {
            (await client.get("/v1/this-route-does-not-exist")).status_code for _ in range(10)
        }

    assert statuses == {404}


async def test_a_500_does_not_count_toward_the_ceiling():
    """Same negative control, for the other direction a broadened check could
    take — `>= 400` would also sweep in 5xx. Registers a route that always
    raises; nothing else in this app can be made to 500 without a database."""
    app = create_app(_settings(auth_failure_limit=3))

    @app.get("/__test_always_500")
    async def _boom():
        raise RuntimeError("deliberately unhandled, for this test only")

    async with _client(app) as client:
        statuses = {(await client.get("/__test_always_500")).status_code for _ in range(10)}

    assert statuses == {500}


async def test_the_throttle_is_scoped_to_the_address_not_one_route():
    """Once an address is over the ceiling, a route it has never even called
    is refused too — the block is keyed by who is asking, not by which
    endpoint produced the failures."""
    app = create_app(_settings(auth_failure_limit=2))
    headers = {"x-forwarded-for": "203.0.113.80"}
    async with _client(app) as client:
        for _ in range(2):
            await client.get("/v1/runs", headers=headers)
        response = await client.get("/v1/me", headers=headers)

    assert response.status_code == 429
    assert response.json()["reason"] == "auth_failure_throttled"


async def test_the_health_check_is_exempt_even_once_the_address_is_blocked():
    """The one path this control must never be able to take down, the same
    property `EXEMPT_PATHS` already guarantees against the anonymous limiter
    and the body-size guard. Checked here for a caller already OVER the
    ceiling, not merely an untested one — a throttled liveness probe takes the
    revision down, which is the one outcome worse than the abuse."""
    app = create_app(_settings(auth_failure_limit=1))
    headers = {"x-forwarded-for": "203.0.113.81"}
    async with _client(app) as client:
        await client.get("/v1/runs", headers=headers)
        await client.get("/v1/runs", headers=headers)  # now over the ceiling
        health = await client.get("/health", headers=headers)

    assert health.status_code == 200


async def test_the_deploy_probe_is_never_counted_toward_the_ceiling():
    """Not reasoned about — run, at a ceiling low enough that a single miss
    would show immediately.

    The deploy workflow's actual sequence: create a run, poll it, read its
    events, all with the probe's own bearer token. No live database is wired
    up here (`_client` runs with no lifespan, same as every other app-level
    test in this file), so every call 500s downstream of auth — the point
    isn't that these succeed, it's that NONE of them is ever a 401, because
    `auth/deps.py`'s probe branch authenticates before anything here could
    reach a database at all. Grepped as the exhaustive claim: 401 is raised
    from exactly one place in this whole service, `get_verified_token`, and
    the probe token satisfies it on every one of its allowed routes
    (`test_the_probe_token_authenticates_on_the_routes_it_needs`,
    test_deploy_probe_credential.py).
    """
    app = create_app(_settings(auth_failure_limit=1, deploy_probe_token=PROBE_TOKEN))
    headers = {"Authorization": f"Bearer {PROBE_TOKEN}"}
    async with _client(app) as client:
        statuses = [
            (await client.post("/v1/runs", headers=headers, json={})).status_code,
            (await client.get("/v1/runs/some-run-id", headers=headers)).status_code,
            (await client.get("/v1/runs/some-run-id/events", headers=headers)).status_code,
            # Repeated: a real deploy polls GET .../{run_id} many times.
            (await client.get("/v1/runs/some-run-id", headers=headers)).status_code,
            (await client.get("/v1/runs/some-run-id", headers=headers)).status_code,
        ]

    assert 401 not in statuses, statuses
    assert 429 not in statuses, statuses


async def test_the_trusted_caller_surface_can_never_produce_a_401():
    """The exemption claim, checked structurally rather than assumed: every
    route `apps/web/lib/repository-source.ts` actually fetches — the six under
    `/v1/catalog` — takes only `Depends(get_settings)` (grepped
    `routes/catalog.py`, 2026-08-17; none imports `CurrentScope` or
    `CurrentIdentity`). `get_verified_token` is the sole source of a 401 in
    this service, and none of these handlers ever calls it, trusted-caller
    header or not — so there is no branch here to exempt, only an absence to
    confirm. Run at a ceiling of 1 so a single miss would 429 the second call.
    """
    app = create_app(_settings(auth_failure_limit=1, trusted_caller_token=TRUSTED_TOKEN))
    for headers in (
        {TRUSTED_CALLER_HEADER: TRUSTED_TOKEN},  # our own renderer
        {},  # any other anonymous reader
    ):
        async with _client(app) as client:
            statuses = [
                (await client.get("/v1/catalog/entries", headers=headers)).status_code,
                (await client.get("/v1/catalog/estimates", headers=headers)).status_code,
                (await client.get("/v1/catalog/profiles", headers=headers)).status_code,
                # Unknown slug — a 404, per the route's own `expected404`
                # contract, never a 401.
                (await client.get("/v1/catalog/entries/no-such-slug", headers=headers)).status_code,
                (
                    await client.get("/v1/catalog/entries/no-such-slug/estimate", headers=headers)
                ).status_code,
                (
                    await client.get("/v1/catalog/entries/no-such-slug/profile", headers=headers)
                ).status_code,
            ]
        assert 401 not in statuses, (headers, statuses)
        assert 429 not in statuses, (headers, statuses)


async def test_auth_failure_limit_zero_disables_the_middleware():
    """The unit test on `AuthFailureThrottle(limit=0)` proves the class is a
    no-op; this proves the SETTING actually reaches the wired-up middleware —
    a wiring bug (the wrong field read, the throttle constructed before
    `Settings.auth_failure_limit` is applied) would pass the unit test and
    fail silently here."""
    app = create_app(_settings(auth_failure_limit=0))
    async with _client(app) as client:
        statuses = {(await client.get("/v1/runs")).status_code for _ in range(50)}

    assert statuses == {401}
