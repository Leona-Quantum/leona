import base64
import hashlib

import httpx
import pytest

from majorana_api.github_client import GitHubRestClient
from majorana_api.github_coordinates import parse_public_github_repository
from majorana_api.github_snapshot import (
    GitHubSnapshotError,
    build_github_metadata_snapshot,
)

REPOSITORY_URL = "https://github.com/mafaldaramoa/ceo-adapt-vqe"
COMMIT_SHA = "c" * 40
TREE_SHA = "d" * 40
CONTENT = b"cff-version: 1.2.0\n"


def _git_blob_sha(content: bytes) -> str:
    payload = f"blob {len(content)}\0".encode() + content
    return hashlib.sha1(payload).hexdigest()


BLOB_SHA = _git_blob_sha(CONTENT)


def _responses(
    *,
    private: bool = False,
    truncated: bool = False,
    blob_sha: str = BLOB_SHA,
    blob_content: bytes = CONTENT,
    mode: str = "100644",
) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        raw_path = request.url.raw_path.decode().split("?", 1)[0]
        if path == "/repos/mafaldaramoa/ceo-adapt-vqe":
            return httpx.Response(
                200,
                json={
                    "id": 147689884712761019,
                    "node_id": "R_repository",
                    "full_name": "mafaldaramoa/ceo-adapt-vqe",
                    "html_url": REPOSITORY_URL,
                    "private": private,
                    "default_branch": "main",
                    "archived": False,
                    "disabled": False,
                },
            )
        if raw_path.endswith("/commits/paper%2Frevision"):
            return httpx.Response(
                200,
                json={"sha": COMMIT_SHA, "commit": {"tree": {"sha": TREE_SHA}}},
            )
        if path.endswith(f"/git/trees/{TREE_SHA}"):
            return httpx.Response(
                200,
                json={
                    "sha": TREE_SHA,
                    "truncated": truncated,
                    "tree": [
                        {
                            "path": "CITATION.cff",
                            "mode": mode,
                            "type": "blob",
                            "size": len(CONTENT),
                            "sha": BLOB_SHA,
                        },
                        {
                            "path": "src/main.py",
                            "mode": "100644",
                            "type": "blob",
                            "size": 100,
                            "sha": "e" * 40,
                        },
                    ],
                },
            )
        if path.endswith(f"/git/blobs/{BLOB_SHA}"):
            return httpx.Response(
                200,
                json={
                    "sha": blob_sha,
                    "size": len(blob_content),
                    "encoding": "base64",
                    "content": base64.b64encode(blob_content).decode(),
                },
            )
        return httpx.Response(404)

    return httpx.MockTransport(handler)


def _coordinate():
    return parse_public_github_repository(REPOSITORY_URL, requested_ref="paper/revision")


@pytest.mark.asyncio
async def test_builds_immutable_bounded_metadata_snapshot() -> None:
    async with GitHubRestClient(transport=_responses()) as client:
        snapshot = await build_github_metadata_snapshot(client, _coordinate())

    assert snapshot.repository_id == 147689884712761019
    assert snapshot.full_name == "mafaldaramoa/ceo-adapt-vqe"
    assert snapshot.commit_sha == COMMIT_SHA
    assert snapshot.tree_sha == TREE_SHA
    assert snapshot.tree_entry_count == 2
    assert snapshot.selected_metadata_bytes == len(CONTENT)
    assert len(snapshot.metadata_files) == 1
    assert snapshot.metadata_files[0].path == "CITATION.cff"
    assert snapshot.metadata_files[0].content == CONTENT
    assert snapshot.metadata_files[0].content_sha256 == hashlib.sha256(CONTENT).hexdigest()

    manifest = snapshot.audit_manifest()
    assert "content" not in manifest["metadata_files"][0]
    assert manifest["metadata_manifest_sha256"] == snapshot.metadata_manifest_sha256


@pytest.mark.asyncio
async def test_private_repository_fails_before_content_retrieval() -> None:
    requested_paths: list[str] = []
    base_transport = _responses(private=True)

    async def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return await base_transport.handle_async_request(request)

    async with GitHubRestClient(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(GitHubSnapshotError, match="private_repository"):
            await build_github_metadata_snapshot(client, _coordinate())

    assert requested_paths == ["/repos/mafaldaramoa/ceo-adapt-vqe"]


@pytest.mark.asyncio
async def test_truncated_tree_is_not_claimed_as_complete() -> None:
    async with GitHubRestClient(transport=_responses(truncated=True)) as client:
        with pytest.raises(GitHubSnapshotError, match="invalid_or_unbounded_tree"):
            await build_github_metadata_snapshot(client, _coordinate())


@pytest.mark.asyncio
async def test_blob_identity_and_content_digest_are_verified() -> None:
    async with GitHubRestClient(transport=_responses(blob_sha="f" * 40)) as client:
        with pytest.raises(GitHubSnapshotError, match="blob_identity_mismatch"):
            await build_github_metadata_snapshot(client, _coordinate())

    changed = b"cff-version: 9.9.9\n"
    async with GitHubRestClient(transport=_responses(blob_content=changed)) as client:
        with pytest.raises(GitHubSnapshotError, match="blob_content_digest_mismatch"):
            await build_github_metadata_snapshot(client, _coordinate())


@pytest.mark.asyncio
async def test_symlink_named_like_metadata_is_not_fetched() -> None:
    requested_paths: list[str] = []
    base_transport = _responses(mode="120000")

    async def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return await base_transport.handle_async_request(request)

    async with GitHubRestClient(transport=httpx.MockTransport(handler)) as client:
        snapshot = await build_github_metadata_snapshot(client, _coordinate())

    assert snapshot.metadata_files == ()
    assert not any("/git/blobs/" in path for path in requested_paths)
