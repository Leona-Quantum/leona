"""Bounded GitHub REST client for Phase 7 recorded-response qualification.

The only authority is the hardcoded GitHub API origin plus validated
``GitHubRepositoryCoordinate`` values.  The client never reads proxy, token or
base-URL configuration from the process environment, never follows redirects,
and never accepts a caller-supplied URL.

Live-network enablement remains a separate security gate.  The initial purpose
of this module is deterministic qualification with ``httpx.MockTransport``.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

import httpx

from .github_coordinates import (
    GITHUB_API_HOST,
    GITHUB_API_VERSION,
    GitHubRepositoryCoordinate,
)

GITHUB_API_ORIGIN = f"https://{GITHUB_API_HOST}"
MAX_GITHUB_JSON_BYTES = 8 * 1024 * 1024
CONNECT_TIMEOUT_SECONDS = 5.0
READ_TIMEOUT_SECONDS = 20.0
WRITE_TIMEOUT_SECONDS = 5.0
POOL_TIMEOUT_SECONDS = 5.0


class GitHubClientError(RuntimeError):
    """Stable connector failure safe to persist without response bodies."""

    def __init__(self, failure_code: str, *, retryable: bool, status_code: int | None = None):
        super().__init__(failure_code)
        self.failure_code = failure_code
        self.retryable = retryable
        self.status_code = status_code


@dataclass(frozen=True)
class GitHubRateLimit:
    remaining: int | None
    reset_epoch_seconds: int | None
    retry_after_seconds: int | None


@dataclass(frozen=True)
class GitHubJsonResponse:
    body: dict[str, Any]
    etag: str | None
    rate_limit: GitHubRateLimit


class GitHubRestClient:
    """Serial, read-only client for a small allowlist of GitHub endpoints."""

    def __init__(
        self,
        *,
        token: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        headers = {
            "Accept": "application/vnd.github+json",
            "Accept-Encoding": "identity",
            "User-Agent": "majorana-atlas-vqe-metadata-import/phase7",
            "X-GitHub-Api-Version": GITHUB_API_VERSION,
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"
        self._client = httpx.AsyncClient(
            base_url=GITHUB_API_ORIGIN,
            headers=headers,
            follow_redirects=False,
            trust_env=False,
            timeout=httpx.Timeout(
                connect=CONNECT_TIMEOUT_SECONDS,
                read=READ_TIMEOUT_SECONDS,
                write=WRITE_TIMEOUT_SECONDS,
                pool=POOL_TIMEOUT_SECONDS,
            ),
            transport=transport,
        )
        self._request_lock = asyncio.Lock()

    async def __aenter__(self) -> GitHubRestClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        await self._client.aclose()

    async def get_repository(
        self,
        coordinate: GitHubRepositoryCoordinate,
    ) -> GitHubJsonResponse:
        return await self._get_json(coordinate.api_repository_path)

    async def get_commit(
        self,
        coordinate: GitHubRepositoryCoordinate,
    ) -> GitHubJsonResponse:
        return await self._get_json(coordinate.api_commit_path)

    async def get_tree(
        self,
        coordinate: GitHubRepositoryCoordinate,
        tree_sha: str,
    ) -> GitHubJsonResponse:
        _require_object_digest(tree_sha)
        path = f"{coordinate.api_repository_path}/git/trees/{tree_sha}"
        return await self._get_json(path, params={"recursive": "1"})

    async def get_blob(
        self,
        coordinate: GitHubRepositoryCoordinate,
        blob_sha: str,
    ) -> GitHubJsonResponse:
        _require_object_digest(blob_sha)
        path = f"{coordinate.api_repository_path}/git/blobs/{blob_sha}"
        return await self._get_json(path)

    async def _get_json(
        self,
        path: str,
        *,
        params: dict[str, str] | None = None,
    ) -> GitHubJsonResponse:
        # Serial requests respect GitHub's secondary-rate-limit guidance and
        # keep one import from creating an unbounded request fan-out.
        async with self._request_lock:
            request = self._client.build_request("GET", path, params=params)
            try:
                response = await self._client.send(request, stream=True)
            except httpx.TimeoutException as exc:
                raise GitHubClientError("timeout", retryable=True) from exc
            except httpx.TransportError as exc:
                raise GitHubClientError("transport_error", retryable=True) from exc

            try:
                rate_limit = _rate_limit(response.headers)
                _raise_for_status(response, rate_limit)
                content_length = _optional_nonnegative_int(response.headers.get("content-length"))
                if content_length is not None and content_length > MAX_GITHUB_JSON_BYTES:
                    raise GitHubClientError(
                        "response_too_large",
                        retryable=False,
                        status_code=response.status_code,
                    )
                raw = bytearray()
                async for chunk in response.aiter_bytes():
                    raw.extend(chunk)
                    if len(raw) > MAX_GITHUB_JSON_BYTES:
                        raise GitHubClientError(
                            "response_too_large",
                            retryable=False,
                            status_code=response.status_code,
                        )
                body = _strict_json_object(bytes(raw))
                return GitHubJsonResponse(
                    body=body,
                    etag=response.headers.get("etag"),
                    rate_limit=rate_limit,
                )
            finally:
                await response.aclose()


def _raise_for_status(response: httpx.Response, rate_limit: GitHubRateLimit) -> None:
    status = response.status_code
    if status == 200:
        return
    if 300 <= status < 400:
        raise GitHubClientError("redirect_rejected", retryable=False, status_code=status)
    if status == 404:
        raise GitHubClientError("not_found", retryable=False, status_code=status)
    if status == 409:
        raise GitHubClientError("repository_conflict", retryable=True, status_code=status)
    if status == 422:
        raise GitHubClientError("invalid_upstream_coordinate", retryable=False, status_code=status)
    if status == 429 or (status == 403 and rate_limit.remaining == 0):
        raise GitHubClientError("rate_limited", retryable=True, status_code=status)
    if status == 403:
        raise GitHubClientError("forbidden", retryable=False, status_code=status)
    if 500 <= status < 600:
        raise GitHubClientError("upstream_unavailable", retryable=True, status_code=status)
    raise GitHubClientError("upstream_error", retryable=False, status_code=status)


def _strict_json_object(raw: bytes) -> dict[str, Any]:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise GitHubClientError("duplicate_json_key", retryable=False)
            result[key] = value
        return result

    try:
        parsed = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except GitHubClientError:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GitHubClientError("malformed_json", retryable=False) from exc
    if not isinstance(parsed, dict):
        raise GitHubClientError("unexpected_json_shape", retryable=False)
    return parsed


def _rate_limit(headers: httpx.Headers) -> GitHubRateLimit:
    return GitHubRateLimit(
        remaining=_optional_nonnegative_int(headers.get("x-ratelimit-remaining")),
        reset_epoch_seconds=_optional_nonnegative_int(headers.get("x-ratelimit-reset")),
        retry_after_seconds=_optional_nonnegative_int(headers.get("retry-after")),
    )


def _optional_nonnegative_int(value: str | None) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except ValueError:
        return None
    return parsed if parsed >= 0 else None


def _require_object_digest(value: str) -> None:
    if len(value) not in {40, 64} or any(char not in "0123456789abcdef" for char in value):
        raise GitHubClientError("invalid_object_digest", retryable=False)
