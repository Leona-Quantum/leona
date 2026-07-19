"""Pinned, bounded HTTPS retrieval for catalog connectors.

The fetcher deliberately supports less than a general HTTP client: connectors
construct the host and path, DNS results must all be globally routable, the TLS
connection is made to one validated address while retaining the original SNI,
and redirects, compression, chunked bodies, archives, and oversized responses
are rejected. Retrieved bytes are data only; parsing/execution belongs in a
later deny-all sandbox stage.
"""

from __future__ import annotations

import asyncio
import dataclasses
import hashlib
import ipaddress
import socket
import ssl
from collections.abc import Awaitable, Callable, Sequence
from pathlib import PurePosixPath
from urllib.parse import quote

MAX_FETCH_BYTES = 64 * 1024
MAX_HEADER_BYTES = 16 * 1024
FETCH_TIMEOUT_SECONDS = 10.0
QASMBENCH_COMMIT = "357b942396d5c2b7cbc1c229c585a6ef5ccaebac"


class FetchRejectedError(ValueError):
    """A deterministic policy rejection safe to expose as a stable failure code."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclasses.dataclass(frozen=True)
class FetchRequest:
    connector_id: str
    host: str
    path: str
    immutable_ref: str
    upstream_identity: str

    @property
    def url(self) -> str:
        return f"https://{self.host}{self.path}"


@dataclasses.dataclass(frozen=True)
class FetchResult:
    request: FetchRequest
    content: bytes
    source_blob_sha256: str
    resolved_ip: str


Resolver = Callable[[str, int], Awaitable[Sequence[str]]]
OpenConnection = Callable[..., Awaitable[tuple[asyncio.StreamReader, asyncio.StreamWriter]]]


def qasmbench_request(relative_path: str) -> FetchRequest:
    """Build one immutable QASMBench raw-file request from a constrained path."""
    candidate = PurePosixPath(relative_path)
    if (
        candidate.is_absolute()
        or not candidate.parts
        or any(part in {"", ".", ".."} for part in candidate.parts)
        or candidate.suffix.lower() != ".qasm"
        or candidate.parts[0] not in {"small", "medium", "large"}
    ):
        raise FetchRejectedError("invalid_source_path", "QASMBench path is not allowed")
    encoded_path = "/".join(quote(part, safe="-._~") for part in candidate.parts)
    return FetchRequest(
        connector_id="qasmbench",
        host="raw.githubusercontent.com",
        path=f"/pnnl/QASMBench/{QASMBENCH_COMMIT}/{encoded_path}",
        immutable_ref=QASMBENCH_COMMIT,
        upstream_identity=relative_path,
    )


async def _resolve_global_addresses(host: str, port: int) -> Sequence[str]:
    loop = asyncio.get_running_loop()
    records = await loop.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return tuple(dict.fromkeys(record[4][0] for record in records))


def _validated_addresses(addresses: Sequence[str]) -> tuple[str, ...]:
    if not addresses:
        raise FetchRejectedError("dns_no_results", "connector host resolved to no addresses")
    validated: list[str] = []
    for raw in addresses:
        try:
            address = ipaddress.ip_address(raw)
        except ValueError as exc:
            raise FetchRejectedError(
                "dns_invalid_address", "DNS returned an invalid address"
            ) from exc
        if not address.is_global:
            raise FetchRejectedError(
                "blocked_destination", "connector host resolved to a non-global address"
            )
        validated.append(address.compressed)
    return tuple(validated)


def _parse_headers(raw: bytes) -> tuple[int, dict[str, str]]:
    try:
        text = raw.decode("iso-8859-1")
        status_line, *header_lines = text.split("\r\n")
        _version, status_text, _reason = status_line.split(" ", 2)
        status = int(status_text)
    except (UnicodeDecodeError, ValueError) as exc:
        raise FetchRejectedError("invalid_http_response", "invalid HTTPS response headers") from exc
    headers: dict[str, str] = {}
    for line in header_lines:
        if not line:
            continue
        if ":" not in line:
            raise FetchRejectedError("invalid_http_response", "malformed HTTPS header")
        name, value = line.split(":", 1)
        key = name.strip().lower()
        if key in headers:
            raise FetchRejectedError("invalid_http_response", "duplicate HTTPS header")
        headers[key] = value.strip()
    return status, headers


def _validate_connector_request(request: FetchRequest) -> None:
    qasmbench_prefix = f"/pnnl/QASMBench/{QASMBENCH_COMMIT}/"
    if (
        request.connector_id != "qasmbench"
        or request.host != "raw.githubusercontent.com"
        or request.immutable_ref != QASMBENCH_COMMIT
        or not request.path.startswith(qasmbench_prefix)
        or not request.path.endswith(".qasm")
        or "?" in request.path
        or "#" in request.path
    ):
        raise FetchRejectedError("connector_policy", "connector request is not allowed")


async def _read_bounded_body(reader: asyncio.StreamReader, declared_size: int | None) -> bytes:
    if declared_size is not None:
        try:
            content = await reader.readexactly(declared_size)
        except asyncio.IncompleteReadError as exc:
            raise FetchRejectedError(
                "truncated", "response size differs from Content-Length"
            ) from exc
        return content

    chunks: list[bytes] = []
    received = 0
    while True:
        chunk = await reader.read(min(16 * 1024, MAX_FETCH_BYTES + 1 - received))
        if not chunk:
            return b"".join(chunks)
        chunks.append(chunk)
        received += len(chunk)
        if received > MAX_FETCH_BYTES:
            raise FetchRejectedError("oversized", "response exceeds the byte limit")


def _reject_archive_content(content: bytes) -> None:
    archive_magic = (b"PK\x03\x04", b"\x1f\x8b", b"BZh", b"\xfd7zXZ\x00")
    if content.startswith(archive_magic):
        raise FetchRejectedError("archive_rejected", "archive content is not allowed")
    if not content.lstrip().startswith((b"OPENQASM 2.0;", b"OPENQASM 3")):
        raise FetchRejectedError("unexpected_content", "response is not OpenQASM source")


async def fetch_https(
    request: FetchRequest,
    *,
    resolver: Resolver = _resolve_global_addresses,
    open_connection: OpenConnection = asyncio.open_connection,
) -> FetchResult:
    """Fetch one connector-built HTTPS URL through a DNS-pinned connection."""
    _validate_connector_request(request)

    try:
        async with asyncio.timeout(FETCH_TIMEOUT_SECONDS):
            addresses = _validated_addresses(await resolver(request.host, 443))
            context = ssl.create_default_context()
            context.set_alpn_protocols(["http/1.1"])
            last_error: OSError | None = None
            reader: asyncio.StreamReader | None = None
            writer: asyncio.StreamWriter | None = None
            connected_ip = ""
            for address in addresses:
                try:
                    reader, writer = await open_connection(
                        address,
                        443,
                        ssl=context,
                        server_hostname=request.host,
                        limit=MAX_HEADER_BYTES,
                    )
                    connected_ip = address
                    break
                except OSError as exc:
                    last_error = exc
            if reader is None or writer is None:
                raise FetchRejectedError(
                    "connection_failed", "all validated addresses failed"
                ) from last_error

            try:
                wire_request = (
                    f"GET {request.path} HTTP/1.1\r\n"
                    f"Host: {request.host}\r\n"
                    "User-Agent: MajoranaCatalogFetcher/1\r\n"
                    "Accept: application/octet-stream,text/plain\r\n"
                    "Accept-Encoding: identity\r\n"
                    "Connection: close\r\n\r\n"
                ).encode("ascii")
                writer.write(wire_request)
                await writer.drain()
                try:
                    header_block = await reader.readuntil(b"\r\n\r\n")
                except (asyncio.LimitOverrunError, asyncio.IncompleteReadError) as exc:
                    raise FetchRejectedError(
                        "invalid_http_response",
                        "HTTPS headers exceeded the limit or were incomplete",
                    ) from exc
                if len(header_block) > MAX_HEADER_BYTES:
                    raise FetchRejectedError("headers_too_large", "HTTPS headers exceed the limit")
                status, headers = _parse_headers(header_block[:-4])
                if 300 <= status < 400:
                    raise FetchRejectedError("redirect_rejected", "redirects are not allowed")
                if status != 200:
                    raise FetchRejectedError("upstream_status", f"upstream returned HTTP {status}")
                if headers.get("content-encoding", "identity").lower() != "identity":
                    raise FetchRejectedError(
                        "encoded_body_rejected", "encoded responses are not allowed"
                    )
                if "transfer-encoding" in headers:
                    raise FetchRejectedError(
                        "stream_encoding_rejected", "transfer encoding is not allowed"
                    )
                content_length = headers.get("content-length")
                declared_size: int | None = None
                if content_length is not None:
                    try:
                        declared_size = int(content_length)
                    except ValueError as exc:
                        raise FetchRejectedError(
                            "invalid_http_response", "invalid Content-Length"
                        ) from exc
                    if declared_size < 0 or declared_size > MAX_FETCH_BYTES:
                        raise FetchRejectedError("oversized", "response exceeds the byte limit")
                content = await _read_bounded_body(reader, declared_size)
                _reject_archive_content(content)
            finally:
                writer.close()
                await writer.wait_closed()
    except TimeoutError as exc:
        raise FetchRejectedError("timeout", "HTTPS fetch exceeded its deadline") from exc

    return FetchResult(
        request=request,
        content=content,
        source_blob_sha256=hashlib.sha256(content).hexdigest(),
        resolved_ip=connected_ip,
    )
