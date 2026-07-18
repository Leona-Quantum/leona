"""SSRF-hardened fetcher tests (Step 5b core).

Unit coverage of the address classifier plus adversarial fixtures run against a
local, self-signed-cert mock HTTPS server -- these tests never make a real external
network call. The loopback-rejection test proves the actual connect_tcp override
fires (not a mocked check): a real server is listening on 127.0.0.1 and the fetch
is still refused under the default (production) policy.
"""

import ipaddress
import ssl

import pytest
from fetch_test_helpers import run_mock_https_server

from majorana_api.catalog_fetch import (
    BlockedAddressError,
    FetchConnectionError,
    FetchPolicy,
    FetchTimeoutError,
    HostNotAllowedError,
    PortNotAllowedError,
    RedirectRejectedError,
    ResponseTooLargeError,
    SchemeNotAllowedError,
    _is_disallowed_address,
    fetch_bounded,
)


@pytest.mark.parametrize(
    "ip",
    [
        "127.0.0.1",
        "127.255.255.255",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        "169.254.169.254",  # cloud metadata service range
        "224.0.0.1",
        "0.0.0.0",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:169.254.169.254",  # IPv4-mapped IPv6 metadata-service bypass attempt
    ],
)
def test_disallowed_addresses_are_rejected(ip):
    assert _is_disallowed_address(ipaddress.ip_address(ip)) is True


@pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses_are_allowed(ip):
    assert _is_disallowed_address(ipaddress.ip_address(ip)) is False


@pytest.fixture(scope="module")
def mock_https_server(tmp_path_factory):
    tmpdir = tmp_path_factory.mktemp("catalog_fetch_cert")
    with run_mock_https_server(tmpdir) as (port, cert):
        yield port, ssl.create_default_context(cafile=str(cert))


def _policy(port: int, client_ctx: ssl.SSLContext, **overrides) -> FetchPolicy:
    kwargs = dict(
        allowed_hosts=frozenset({"127.0.0.1"}),
        allowed_port=port,
        allow_private_addresses=True,
        ssl_context=client_ctx,
        timeout_s=2.0,
    )
    kwargs.update(overrides)
    return FetchPolicy(**kwargs)


async def test_fetch_bounded_happy_path(mock_https_server):
    port, ctx = mock_https_server
    result = await fetch_bounded(f"https://127.0.0.1:{port}/ok", policy=_policy(port, ctx))
    assert result.status_code == 200
    assert result.content == b"hello from mock server"
    assert result.content_type == "text/plain"


async def test_fetch_bounded_rejects_redirect(mock_https_server):
    port, ctx = mock_https_server
    with pytest.raises(RedirectRejectedError):
        await fetch_bounded(f"https://127.0.0.1:{port}/redirect", policy=_policy(port, ctx))


async def test_fetch_bounded_rejects_oversized_response(mock_https_server):
    port, ctx = mock_https_server
    with pytest.raises(ResponseTooLargeError):
        await fetch_bounded(
            f"https://127.0.0.1:{port}/big", policy=_policy(port, ctx, max_bytes=1024)
        )


async def test_fetch_bounded_enforces_timeout(mock_https_server):
    port, ctx = mock_https_server
    with pytest.raises(FetchTimeoutError):
        await fetch_bounded(
            f"https://127.0.0.1:{port}/slow", policy=_policy(port, ctx, timeout_s=0.3)
        )


async def test_fetch_bounded_rejects_unlisted_host(mock_https_server):
    port, ctx = mock_https_server
    policy = _policy(port, ctx, allowed_hosts=frozenset({"not-this-host.example"}))
    with pytest.raises(HostNotAllowedError):
        await fetch_bounded(f"https://127.0.0.1:{port}/ok", policy=policy)


async def test_fetch_bounded_rejects_wrong_port(mock_https_server):
    port, ctx = mock_https_server
    policy = _policy(port + 1, ctx)
    with pytest.raises(PortNotAllowedError):
        await fetch_bounded(f"https://127.0.0.1:{port}/ok", policy=policy)


async def test_fetch_bounded_rejects_non_https_scheme():
    policy = FetchPolicy(allowed_hosts=frozenset({"127.0.0.1"}))
    with pytest.raises(SchemeNotAllowedError):
        await fetch_bounded("http://127.0.0.1/ok", policy=policy)


async def test_fetch_bounded_rejects_loopback_target_by_default(mock_https_server):
    """The real, production-mode SSRF gate: even though a server is genuinely
    listening on 127.0.0.1, the default policy (allow_private_addresses=False)
    must still refuse to connect -- this exercises the actual connect_tcp
    override, not a mocked check."""
    port, ctx = mock_https_server
    policy = FetchPolicy(allowed_hosts=frozenset({"127.0.0.1"}), allowed_port=port, ssl_context=ctx)
    with pytest.raises(BlockedAddressError):
        await fetch_bounded(f"https://127.0.0.1:{port}/ok", policy=policy)


async def test_fetch_bounded_wraps_connection_refused(mock_https_server):
    port, ctx = mock_https_server
    dead_port = port + 1  # nothing listens here
    policy = _policy(dead_port, ctx)
    with pytest.raises(FetchConnectionError):
        await fetch_bounded(f"https://127.0.0.1:{dead_port}/ok", policy=policy)
