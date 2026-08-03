from __future__ import annotations

import copy
import hashlib
import json
import uuid

import pytest

from majorana_api.phase10_quarantine_contract import (
    QUARANTINE_KEY_PREFIX,
    QUARANTINE_LOCATOR_PREFIX,
    Phase10QuarantinePlan,
    QuarantineObjectPlan,
)
from majorana_api.phase10_source_normalizer import (
    NORMALIZED_SOURCE_CLASS,
    NORMALIZED_TEXT_ENCODING,
    Phase10NormalizedSourceManifest,
    Phase10SourceNormalizerError,
    build_phase10_normalized_source_manifest,
)

WORKSPACE_ID = uuid.UUID("019fa990-657d-7c92-a548-5cc1dda7e894")
OTHER_WORKSPACE_ID = uuid.UUID("019fa990-657d-7c92-a548-5cc1dda7e895")
CONTENT = b"print('safe')\n"


def _quarantine_plan(
    *,
    selected_path: str = "src/example.py",
    content: bytes = CONTENT,
) -> Phase10QuarantinePlan:
    digest = hashlib.sha256(content).hexdigest()
    return Phase10QuarantinePlan(
        workspace_id=str(WORKSPACE_ID),
        acquisition_result_sha256="a" * 64,
        objects=(
            QuarantineObjectPlan(
                selected_path=selected_path,
                media_type="text/x-python",
                length=len(content),
                sha256=digest,
                opaque_locator=f"{QUARANTINE_LOCATOR_PREFIX}{digest}",
                internal_object_key=f"{QUARANTINE_KEY_PREFIX}/{digest[:2]}/{digest[2:]}",
            ),
        ),
    )


def _manifest(
    *,
    selected_path: str = "src/example.py",
    content: bytes = CONTENT,
) -> Phase10NormalizedSourceManifest:
    return build_phase10_normalized_source_manifest(
        workspace_id=WORKSPACE_ID,
        quarantine_plan=_quarantine_plan(
            selected_path=selected_path,
            content=content,
        ),
        source_bytes={selected_path: content},
    )


def _rehash(payload: dict) -> None:
    body = {key: value for key, value in payload.items() if key != "manifest_sha256"}
    payload["manifest_sha256"] = hashlib.sha256(
        json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def test_exact_quarantine_bytes_become_read_only_digest_only_manifest():
    manifest = _manifest()
    payload = manifest.to_manifest()
    serialized = json.dumps(payload)
    item = manifest.files[0]

    assert manifest.source_class == NORMALIZED_SOURCE_CLASS
    assert item.text_encoding == NORMALIZED_TEXT_ENCODING
    assert item.sha256 == hashlib.sha256(CONTENT).hexdigest()
    assert item.opaque_locator == f"{QUARANTINE_LOCATOR_PREFIX}{item.sha256}"
    assert "print('safe')" not in serialized
    assert "internal_object_key" not in serialized
    assert Phase10NormalizedSourceManifest.from_manifest(payload).to_manifest() == payload


def test_workspace_and_exact_selected_path_set_are_mandatory():
    plan = _quarantine_plan()
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="quarantine_cross_workspace_denied",
    ):
        build_phase10_normalized_source_manifest(
            workspace_id=OTHER_WORKSPACE_ID,
            quarantine_plan=plan,
            source_bytes={"src/example.py": CONTENT},
        )

    for source_bytes in ({}, {"src/example.py": CONTENT, "extra.py": b"pass\n"}):
        with pytest.raises(
            Phase10SourceNormalizerError,
            match="normalized_source_path_set_mismatch",
        ):
            build_phase10_normalized_source_manifest(
                workspace_id=WORKSPACE_ID,
                quarantine_plan=plan,
                source_bytes=source_bytes,
            )


def test_quarantine_readback_digest_and_length_are_reverified():
    plan = _quarantine_plan()
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="quarantine_readback_length_mismatch",
    ):
        build_phase10_normalized_source_manifest(
            workspace_id=WORKSPACE_ID,
            quarantine_plan=plan,
            source_bytes={"src/example.py": CONTENT + b"x"},
        )
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="quarantine_readback_digest_mismatch",
    ):
        build_phase10_normalized_source_manifest(
            workspace_id=WORKSPACE_ID,
            quarantine_plan=plan,
            source_bytes={"src/example.py": b"x" * len(CONTENT)},
        )


@pytest.mark.parametrize(
    "selected_path",
    [
        "source.zip",
        "source.tar.gz",
        "wheel.whl",
        "package.jar",
        "disk.iso",
        ".env",
        ".env.production",
        ".npmrc",
        "home/.netrc",
        "keys/id_rsa",
        "config/credentials",
    ],
)
def test_archives_and_common_credential_file_shapes_are_rejected(selected_path):
    with pytest.raises(Phase10SourceNormalizerError, match="source_shape_rejected"):
        _manifest(selected_path=selected_path)


@pytest.mark.parametrize(
    ("content", "failure"),
    [
        (b"\xef\xbb\xbfprint('safe')\n", "utf8_bom_rejected"),
        (
            b"version https://git-lfs.github.com/spec/v1\noid sha256:" + b"a" * 64 + b"\n",
            "git_lfs_pointer_rejected",
        ),
        (
            b"version https://git-lfs.github.com/spec/v1\r\noid sha256:" + b"a" * 64 + b"\r\n",
            "git_lfs_pointer_rejected",
        ),
        (b"print('safe')\x1b\n", "source_control_character_rejected"),
        ("print('safe')\u009b\n".encode(), "source_control_character_rejected"),
        (b"PK\x03\x04not-really-source", "source_shape_rejected"),
    ],
)
def test_bom_lfs_pointer_and_terminal_control_bytes_are_rejected(content, failure):
    with pytest.raises(Phase10SourceNormalizerError, match=failure):
        _manifest(content=content)


def test_crlf_is_preserved_by_digest_instead_of_semantically_rewritten():
    content = b"print('safe')\r\n"
    manifest = _manifest(content=content)

    assert manifest.files[0].length == len(content)
    assert manifest.files[0].sha256 == hashlib.sha256(content).hexdigest()


def test_unknown_fields_versions_and_outer_digest_tampering_fail_closed():
    payload = _manifest().to_manifest()
    with_unknown = copy.deepcopy(payload)
    with_unknown["materialized_path"] = "/tmp/source"
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="invalid_normalized_source_manifest",
    ):
        Phase10NormalizedSourceManifest.from_manifest(with_unknown)

    payload["normalizer_version"] = "phase10-s5-selected-text-normalizer/2"
    _rehash(payload)
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="unsupported_source_normalizer",
    ):
        Phase10NormalizedSourceManifest.from_manifest(payload)

    payload = _manifest().to_manifest()
    payload["quarantine_plan_sha256"] = "f" * 64
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="normalized_source_manifest_digest_mismatch",
    ):
        Phase10NormalizedSourceManifest.from_manifest(payload)


def test_self_consistent_locator_or_archive_path_substitution_is_rejected():
    payload = _manifest().to_manifest()
    payload["files"][0]["opaque_locator"] = f"{QUARANTINE_LOCATOR_PREFIX}{'f' * 64}"
    _rehash(payload)
    with pytest.raises(
        Phase10SourceNormalizerError,
        match="invalid_normalized_source_file",
    ):
        Phase10NormalizedSourceManifest.from_manifest(payload)

    payload = _manifest().to_manifest()
    payload["files"][0]["selected_path"] = "source.zip"
    _rehash(payload)
    with pytest.raises(Phase10SourceNormalizerError, match="source_shape_rejected"):
        Phase10NormalizedSourceManifest.from_manifest(payload)
