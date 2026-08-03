from __future__ import annotations

import copy
import dataclasses
import hashlib
import json
from datetime import UTC, datetime, timedelta, timezone

import pytest

from majorana_api.phase10_retrieval_manifest import (
    MAX_SELECTED_FILES,
    MAX_SELECTED_FILE_BYTES,
    MAX_SELECTED_TOTAL_BYTES,
    Phase10RetrievalManifest,
    Phase10RetrievalManifestError,
    RetrievedFileEvidence,
    build_phase10_retrieval_manifest,
)

COMMIT = "a" * 40
FETCHED_AT = datetime(2026, 8, 3, 12, 34, 56, 999999, tzinfo=UTC)


def _file(path: str, content: bytes = b"print('safe')\n") -> RetrievedFileEvidence:
    return RetrievedFileEvidence.from_bytes(
        selected_path=path,
        media_type="text/x-python",
        content=content,
    )


def _manifest(*files: RetrievedFileEvidence) -> Phase10RetrievalManifest:
    return build_phase10_retrieval_manifest(
        repository_id=123,
        full_name="quantumlib/OpenFermion",
        immutable_ref=COMMIT,
        fetched_at=FETCHED_AT,
        files=tuple(files) or (_file("src/example.py"),),
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "manifest_sha256"}
    payload["manifest_sha256"] = hashlib.sha256(
        json.dumps(
            body,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def test_manifest_round_trip_is_canonical_and_contains_no_source_bytes():
    manifest = _manifest(
        _file("src/z.py", b"z = 1\n"),
        _file("src/a.py", b"a = 1\n"),
    )

    payload = manifest.to_manifest()
    restored = Phase10RetrievalManifest.from_manifest(payload)

    assert [item.selected_path for item in restored.files] == ["src/a.py", "src/z.py"]
    assert restored.fetched_at == "2026-08-03T12:34:56Z"
    assert restored.selected_total_bytes == 12
    assert "content" not in json.dumps(payload)
    assert restored.to_manifest() == payload


def test_outer_manifest_digest_detects_tampering():
    payload = _manifest().to_manifest()
    payload["immutable_ref"] = "b" * 40

    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_manifest_digest_mismatch",
    ):
        Phase10RetrievalManifest.from_manifest(payload)


def test_derived_counts_reject_self_consistent_outer_digest_lie():
    payload = _manifest().to_manifest()
    payload["selected_total_bytes"] += 1
    _rehash(payload)

    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_total_bytes_mismatch",
    ):
        Phase10RetrievalManifest.from_manifest(payload)


@pytest.mark.parametrize(
    "path",
    ["../secret", "src/../secret", "/absolute", "src\\file.py", "src//file.py"],
)
def test_unsafe_selected_paths_are_rejected(path: str):
    with pytest.raises(Phase10RetrievalManifestError, match="invalid_retrieval_path"):
        _file(path)


def test_mutable_branch_name_is_not_an_immutable_ref():
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="mutable_or_invalid_retrieval_ref",
    ):
        build_phase10_retrieval_manifest(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref="main",
            fetched_at=FETCHED_AT,
            files=(_file("src/example.py"),),
        )


def test_duplicate_paths_are_rejected():
    with pytest.raises(Phase10RetrievalManifestError, match="duplicate_retrieval_path"):
        _manifest(_file("src/a.py"), _file("src/a.py"))


def test_file_count_and_total_byte_limits_are_enforced():
    empty_sha = hashlib.sha256(b"").hexdigest()
    too_many = tuple(
        RetrievedFileEvidence(
            selected_path=f"src/{index}.py",
            media_type="text/x-python",
            length=0,
            sha256=empty_sha,
        )
        for index in range(MAX_SELECTED_FILES + 1)
    )
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_file_count_exceeded",
    ):
        _manifest(*too_many)

    full_file = RetrievedFileEvidence(
        selected_path="placeholder",
        media_type="text/plain",
        length=MAX_SELECTED_FILE_BYTES,
        sha256=empty_sha,
    )
    too_large = tuple(
        dataclasses.replace(full_file, selected_path=f"src/{index}.txt")
        for index in range((MAX_SELECTED_TOTAL_BYTES // MAX_SELECTED_FILE_BYTES) + 1)
    )
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_total_bytes_exceeded",
    ):
        _manifest(*too_large)


def test_noncanonical_unicode_path_is_rejected():
    with pytest.raises(Phase10RetrievalManifestError, match="invalid_retrieval_path"):
        _file("src/e\u0301.py")


def test_non_utf8_and_nul_content_are_rejected():
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="non_utf8_retrieval_content_rejected",
    ):
        _file("src/a.py", b"\xff")
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="binary_retrieval_content_rejected",
    ):
        _file("src/a.py", b"a\x00b")


def test_unapproved_media_type_and_oversized_file_are_rejected():
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="unsupported_retrieval_media_type",
    ):
        RetrievedFileEvidence.from_bytes(
            selected_path="image.png",
            media_type="image/png",
            content=b"not an image",
        )
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_file_bytes_exceeded",
    ):
        _file("src/large.py", b"a" * (MAX_SELECTED_FILE_BYTES + 1))


def test_later_bytes_are_verified_by_length_and_sha256():
    evidence = _file("src/a.py", b"a = 1\n")
    evidence.verify_bytes(b"a = 1\n")

    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_length_mismatch",
    ):
        evidence.verify_bytes(b"a = 10\n")
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_digest_mismatch",
    ):
        evidence.verify_bytes(b"b = 1\n")


def test_naive_timestamp_is_rejected_and_aware_timestamp_is_normalized():
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="invalid_retrieval_timestamp",
    ):
        build_phase10_retrieval_manifest(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref=COMMIT,
            fetched_at=datetime(2026, 8, 3, 12, 34, 56),
            files=(_file("src/example.py"),),
        )

    offset_time = FETCHED_AT.astimezone(timezone(timedelta(hours=9)))
    assert (
        _manifest().fetched_at
        == build_phase10_retrieval_manifest(
            repository_id=123,
            full_name="quantumlib/OpenFermion",
            immutable_ref=COMMIT,
            fetched_at=offset_time,
            files=(_file("src/example.py"),),
        ).fetched_at
    )


def test_unknown_fields_and_versions_fail_closed():
    payload = _manifest().to_manifest()
    with_unknown = copy.deepcopy(payload)
    with_unknown["unexpected"] = True
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="invalid_retrieval_manifest",
    ):
        Phase10RetrievalManifest.from_manifest(with_unknown)

    payload["policy_version"] = "phase10-s2-selected-text/2"
    _rehash(payload)
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="unsupported_retrieval_policy_version",
    ):
        Phase10RetrievalManifest.from_manifest(payload)


def test_lookup_rejects_paths_not_selected_by_manifest():
    manifest = _manifest()
    with pytest.raises(
        Phase10RetrievalManifestError,
        match="retrieval_path_not_in_manifest",
    ):
        manifest.file("src/not-selected.py")
