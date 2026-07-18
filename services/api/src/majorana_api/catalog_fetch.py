"""SSRF-hardened bounded HTTPS fetcher for catalog ingestion (Step 5b core).

Per docs/adr/0017-catalog-ingestion-threat-boundary.md: every connector builds its own
URL from an allowlisted HTTPS host, port, and path; every connection revalidates the
resolved address and rejects loopback, private, link-local, multicast,
metadata-service, and non-routable ranges; redirects are rejected in the initial
release; egress is bounded by byte count and timeout. This module never holds a Neon,
cloud-provider, QPU, signing, or publication credential.

DNS-rebinding defense: the hostname is resolved and validated here, in
_SSRFSafeBackend.connect_tcp, then the TCP connection is opened directly to that one
validated IP address -- httpcore/anyio never re-resolve the hostname themselves, so
nothing can swap the answer between our check and the actual connection. TLS SNI and
certificate-hostname verification still use the original hostname: httpcore's
connection layer passes `server_hostname` to start_tls from the request's origin, not
from whatever connect_tcp returned, so pinning the TCP target to a specific IP does
not weaken certificate validation.
"""

from __future__ import annotations

import dataclasses
import ipaddress
import logging
import socket
import ssl
from urllib.parse import urlsplit

import anyio
import httpcore
import httpx

# Blocked destinations must be observable (ADR-0017) without leaking secrets:
# log the rejection kind and host only -- never the full URL, whose path/query
# could carry tokens.
log = logging.getLogger("majorana_api.catalog_fetch")

DEFAULT_ALLOWED_PORT = 443
DEFAULT_TIMEOUT_S = 15.0
DEFAULT_MAX_BYTES = 8 * 1024 * 1024  # 8 MiB; a connector's own policy may tighten this


class FetchError(Exception):
    """Base for all deterministic, non-retryable fetch rejections."""


class SchemeNotAllowedError(FetchError):
    pass


class HostNotAllowedError(FetchError):
    pass


class PortNotAllowedError(FetchError):
    pass


class BlockedAddressError(FetchError):
    """DNS resolved to a loopback/private/link-local/multicast/reserved address."""


class RedirectRejectedError(FetchError):
    pass


class ResponseTooLargeError(FetchError):
    pass


class FetchTimeoutError(FetchError):
    pass


class FetchConnectionError(FetchError):
    """A genuine connectivity failure (refused/unreachable), not an SSRF rejection."""


@dataclasses.dataclass(frozen=True)
class FetchPolicy:
    """What one connector is allowed to reach. allowed_hosts is always a small,
    explicit set -- never a wildcard, never taken from caller input."""

    allowed_hosts: frozenset[str]
    allowed_port: int = DEFAULT_ALLOWED_PORT
    max_bytes: int = DEFAULT_MAX_BYTES
    timeout_s: float = DEFAULT_TIMEOUT_S
    # Test-only escape hatch so the adversarial suite can point at a local mock
    # server without weakening the default (production) posture, which always
    # rejects loopback/private/link-local/multicast/reserved/unspecified targets.
    allow_private_addresses: bool = False
    # None means the real system CA trust store (production default). Tests set
    # this to a context that trusts a local mock server's self-signed cert.
    ssl_context: ssl.SSLContext | None = None


@dataclasses.dataclass(frozen=True)
class FetchResult:
    content: bytes
    status_code: int
    content_type: str | None


def _is_disallowed_address(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(addr, ipaddress.IPv6Address):
        mapped = addr.ipv4_mapped
        if mapped is not None:
            addr = mapped
    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


async def _resolve_validated(host: str, port: int, *, allow_private_addresses: bool) -> str:
    """Resolve host to exactly one address, failing closed if any candidate address
    (not just the one ultimately picked) falls in a disallowed range."""
    try:
        infos = await anyio.to_thread.run_sync(
            lambda: socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        )
    except OSError as exc:
        raise BlockedAddressError(f"DNS resolution failed for {host!r}") from exc
    if not infos:
        raise BlockedAddressError(f"DNS resolution returned no addresses for {host!r}")

    candidates: list[str] = []
    for _family, _type, _proto, _canon, sockaddr in infos:
        ip_str = sockaddr[0]
        addr = ipaddress.ip_address(ip_str)
        if not allow_private_addresses and _is_disallowed_address(addr):
            log.warning("catalog_fetch blocked: disallowed_address host=%s", host)
            raise BlockedAddressError(f"{host!r} resolved to disallowed address {ip_str}")
        candidates.append(ip_str)
    return candidates[0]


class _SSRFSafeBackend(httpcore.AnyIOBackend):
    """Overrides connect_tcp to resolve+validate the hostname itself and connect
    directly to the validated IP, closing the DNS-rebinding check-then-connect race."""

    def __init__(self, *, allow_private_addresses: bool) -> None:
        self._allow_private_addresses = allow_private_addresses

    async def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options=None,
    ) -> httpcore.AsyncNetworkStream:
        validated_ip = await _resolve_validated(
            host, port, allow_private_addresses=self._allow_private_addresses
        )
        return await super().connect_tcp(
            validated_ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )


def _build_transport(
    *, allow_private_addresses: bool, ssl_context: ssl.SSLContext | None
) -> httpx.AsyncHTTPTransport:
    transport = httpx.AsyncHTTPTransport()
    # httpx.AsyncHTTPTransport's public constructor has no network_backend
    # parameter; the underlying httpcore.AsyncConnectionPool does. Swapping the
    # pool after construction is the extension point this relies on -- see
    # docs/repository-step5b-fetcher.md for the httpcore source this was verified
    # against. If a future httpx upgrade changes this shape, every fetch (including
    # the adversarial suite's happy-path case) fails loudly rather than silently
    # falling back to an unvalidated connection.
    transport._pool = httpcore.AsyncConnectionPool(
        ssl_context=ssl_context or ssl.create_default_context(),
        network_backend=_SSRFSafeBackend(allow_private_addresses=allow_private_addresses),
        retries=0,
    )
    return transport


async def fetch_bounded(url: str, *, policy: FetchPolicy) -> FetchResult:
    """Fetch one URL under an explicit allowlist policy. Never follows a redirect;
    never reads more than policy.max_bytes; never exceeds policy.timeout_s."""
    parts = urlsplit(url)
    if parts.scheme != "https":
        log.warning("catalog_fetch blocked: scheme host=%s", parts.hostname)
        raise SchemeNotAllowedError(f"scheme {parts.scheme!r} is not https")
    if parts.hostname not in policy.allowed_hosts:
        log.warning("catalog_fetch blocked: host_not_allowlisted host=%s", parts.hostname)
        raise HostNotAllowedError(f"host {parts.hostname!r} is not allowlisted")
    port = parts.port or DEFAULT_ALLOWED_PORT
    if port != policy.allowed_port:
        log.warning("catalog_fetch blocked: port host=%s port=%s", parts.hostname, port)
        raise PortNotAllowedError(f"port {port} is not allowlisted")

    transport = _build_transport(
        allow_private_addresses=policy.allow_private_addresses, ssl_context=policy.ssl_context
    )
    try:
        async with httpx.AsyncClient(
            transport=transport,
            follow_redirects=False,
            timeout=policy.timeout_s,
        ) as client:
            try:
                async with client.stream("GET", url) as response:
                    if 300 <= response.status_code < 400:
                        log.warning("catalog_fetch blocked: redirect host=%s", parts.hostname)
                        raise RedirectRejectedError(
                            f"refusing to follow redirect (status {response.status_code})"
                        )
                    chunks: list[bytes] = []
                    total = 0
                    async for chunk in response.aiter_bytes():
                        total += len(chunk)
                        if total > policy.max_bytes:
                            log.warning("catalog_fetch blocked: oversized host=%s", parts.hostname)
                            raise ResponseTooLargeError(
                                f"response exceeded {policy.max_bytes} bytes"
                            )
                        chunks.append(chunk)
                    return FetchResult(
                        content=b"".join(chunks),
                        status_code=response.status_code,
                        content_type=response.headers.get("content-type"),
                    )
            except httpx.TimeoutException as exc:
                raise FetchTimeoutError(str(exc)) from exc
            except FetchError:
                raise
            except httpx.HTTPError as exc:
                cause = exc.__cause__
                if isinstance(cause, FetchError):
                    raise cause from exc
                raise FetchConnectionError(str(exc)) from exc
    finally:
        pass  # AsyncClient's __aexit__ already closes the transport it owns.
