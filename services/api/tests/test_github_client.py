import asyncio
import json

import httpx
import pytest

from majorana_api.github_client import (
    GITHUB_API_ORIGIN,
    MAX_GITHUB_JSON_BYTES,
    GitHubClientError,
    GitHubRestClient,
)
from majorana_api.github_coordinates import (
    GITHUB_API_VERSION,
    parse_public_github_repository,
)


def _coordinate():
    return parse_public_github_repository(
        "https://github.com/mafaldaramoa/ceo-adapt-vqe",
        requested_ref="paper/revision 1",
    )


@pytest.mark.asyncio
async def test_repository_request_uses_only_pinned_origin_headers_and_path() -> None:
    observed: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        return httpx.Response(
            200,
            headers={
                "etag": '"repository-etag"',
                "x-ratelimit-remaining": "57",
                "x-ratelimit-reset": "1785159999",
            },
            json={"id": 123, "private": False},
        )

    async with GitHubRestClient(transport=httpx.MockTransport(handler)) as client:
        result = await client.get_repository(_coordinate())

    assert len(observed) == 1
    request = observed[0]
    assert str(request.url) == (f"{GITHUB_API_ORIGIN}/repos/mafaldaramoa/ceo-adapt-vqe")
    assert request.headers["x-github-api-version"] == GITHUB_API_VERSION
    assert request.headers["accept-encoding"] == "identity"
    assert "authorization" not in request.headers
    assert result.body == {"id": 123, "private": False}
    assert result.etag == '"repository-etag"'
    assert result.rate_limit.remaining == 57


@pytest.mark.asyncio
async def test_ref_and_tree_digest_are_encoded_or_validated() -> None:
    observed: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed.append(request.url.raw_path.decode())
        return httpx.Response(200, json={"ok": True})

    async with GitHubRestClient(transport=httpx.MockTransport(handler)) as client:
        await client.get_commit(_coordinate())
        await client.get_tree(_coordinate(), "a" * 40)
        with pytest.raises(GitHubClientError, match="invalid_object_digest"):
            await client.get_blob(_coordinate(), "../../secret")

    assert observed == [
        "/repos/mafaldaramoa/ceo-adapt-vqe/commits/paper%2Frevision%201",
        "/repos/mafaldaramoa/ceo-adapt-vqe/git/trees/" + "a" * 40 + "?recursive=1",
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "headers", "failure_code", "retryable"),
    [
        (301, {"location": "https://example.invalid"}, "redirect_rejected", False),
        (403, {}, "forbidden", False),
        (403, {"x-ratelimit-remaining": "0"}, "rate_limited", True),
        (404, {}, "not_found", False),
        (409, {}, "repository_conflict", True),
        (422, {}, "invalid_upstream_coordinate", False),
        (429, {"retry-after": "60"}, "rate_limited", True),
        (503, {}, "upstream_unavailable", True),
    ],
)
async def test_statuses_map_to_stable_failures(
    status: int,
    headers: dict[str, str],
    failure_code: str,
    retryable: bool,
) -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(status, headers=headers))
    async with GitHubRestClient(transport=transport) as client:
        with pytest.raises(GitHubClientError) as exc:
            await client.get_repository(_coordinate())

    assert exc.value.failure_code == failure_code
    assert exc.value.retryable is retryable
    assert exc.value.status_code == status


@pytest.mark.asyncio
async def test_content_length_and_streamed_bytes_are_bounded() -> None:
    oversized = str(MAX_GITHUB_JSON_BYTES + 1)
    transports = [
        httpx.MockTransport(
            lambda _: httpx.Response(200, headers={"content-length": oversized}, content=b"{}")
        ),
        httpx.MockTransport(
            lambda _: httpx.Response(200, content=b"x" * (MAX_GITHUB_JSON_BYTES + 1))
        ),
    ]

    for transport in transports:
        async with GitHubRestClient(transport=transport) as client:
            with pytest.raises(GitHubClientError, match="response_too_large"):
                await client.get_repository(_coordinate())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("content", "failure_code"),
    [
        (b"not-json", "malformed_json"),
        (b"[]", "unexpected_json_shape"),
        (b'{"id": 1, "id": 2}', "duplicate_json_key"),
    ],
)
async def test_malformed_or_ambiguous_json_is_rejected(
    content: bytes,
    failure_code: str,
) -> None:
    transport = httpx.MockTransport(lambda _: httpx.Response(200, content=content))
    async with GitHubRestClient(transport=transport) as client:
        with pytest.raises(GitHubClientError) as exc:
            await client.get_repository(_coordinate())
    assert exc.value.failure_code == failure_code


@pytest.mark.asyncio
async def test_requests_are_serialized() -> None:
    active = 0
    max_active = 0

    async def handler(_: httpx.Request) -> httpx.Response:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0)
        active -= 1
        return httpx.Response(200, content=json.dumps({"ok": True}).encode())

    async with GitHubRestClient(transport=httpx.MockTransport(handler)) as client:
        await asyncio.gather(
            client.get_repository(_coordinate()),
            client.get_commit(_coordinate()),
        )

    assert max_active == 1
