"""Pure (no-DB) tests for the bootstrap-manifest import source (ADR-0019, Slice B).

Covers the ADR-0019 "20-item proof" and full 283-item hash parity against the
committed manifest, plus adversarial manifests (tampered blob, corrupted
checksum, unsupported schema, duplicate identity) that must fail closed before
any staging. The DB-backed 283-item reconciliation lives in
test_catalog_bootstrap_import_live.py.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
from majorana_contracts.enums import ImportProvider

from majorana_api.catalog_bootstrap_manifest import (
    SOURCE_BLOB_ENCODING,
    BootstrapManifestSource,
    ManifestIntegrityError,
    canonicalize,
    default_manifest_path,
)
from majorana_api.catalog_hashing import hash_source_blob
from majorana_api.catalog_import_sources import ImportSource, SourceItemRejected

COMMITTED = default_manifest_path()


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _build_manifest(blobs: dict[str, str]) -> dict:
    """A self-consistent manifest (correct per-item hashes + whole checksum)
    over {identity: source_blob}, mirroring the generator's shape."""
    items = sorted(
        (
            {
                "upstream_identity": identity,
                "category": "algorithms",
                "title": identity,
                "source_blob_encoding": SOURCE_BLOB_ENCODING,
                "source_blob_sha256": _sha(blob),
                "source_blob": blob,
            }
            for identity, blob in blobs.items()
        ),
        key=lambda it: it["upstream_identity"],
    )
    body = {
        "manifest_schema_version": 1,
        "generator": {"name": "test", "version": "1.0.0"},
        "source_commit": "deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
        "ordering": "slug-asc",
        "item_count": len(items),
        "items": items,
    }
    return {**body, "manifest_checksum": _sha(canonicalize(body))}


def _write(tmp_path: Path, manifest: dict) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return path


# --- committed manifest: real 283-entry corpus --------------------------------


def test_committed_manifest_loads_and_verifies():
    source = BootstrapManifestSource(COMMITTED)
    assert isinstance(source, ImportSource)  # structural conformance
    assert source.provider == ImportProvider.CATALOG_BOOTSTRAP
    identities = source.identities()
    assert len(identities) == 283
    assert len(set(identities)) == 283
    assert identities == sorted(identities)  # slug-asc ordering preserved
    assert source.idempotency_key == f"catalog-bootstrap-{source.manifest_checksum}"
    assert source.descriptor()["manifest_checksum"] == source.manifest_checksum


def test_twenty_item_proof():
    """ADR-0019 20-item proof: the bytes read for the first 20 items hash under
    catalog_hashing.hash_source_blob to exactly the manifest's recorded hash."""
    source = BootstrapManifestSource(COMMITTED)
    manifest = json.loads(COMMITTED.read_text(encoding="utf-8"))
    recorded = {it["upstream_identity"]: it["source_blob_sha256"] for it in manifest["items"]}
    for identity in source.identities()[:20]:
        raw = source.read_bytes(identity)
        assert hash_source_blob(raw) == recorded[identity]


def test_all_283_items_read_bytes_hash_parity():
    source = BootstrapManifestSource(COMMITTED)
    manifest = json.loads(COMMITTED.read_text(encoding="utf-8"))
    recorded = {it["upstream_identity"]: it["source_blob_sha256"] for it in manifest["items"]}
    for identity in source.identities():
        assert hash_source_blob(source.read_bytes(identity)) == recorded[identity]


def test_canonicalize_reproduces_committed_checksum():
    """Guards the Python canonicalize against drift from the JS generator: recompute
    the committed manifest's checksum over its own body and compare."""
    manifest = json.loads(COMMITTED.read_text(encoding="utf-8"))
    body = {k: v for k, v in manifest.items() if k != "manifest_checksum"}
    assert _sha(canonicalize(body)) == manifest["manifest_checksum"]


# --- canonicalize parity units ------------------------------------------------


def test_canonicalize_sorts_keys_and_preserves_array_order():
    assert canonicalize({"b": 1, "a": 2}) == '{"a":2,"b":1}'
    assert canonicalize({"x": {"d": 4, "c": 3}}) == '{"x":{"c":3,"d":4}}'
    assert canonicalize([3, 1, 2]) == "[3,1,2]"
    assert canonicalize("アルゴリズム") == '"アルゴリズム"'  # non-ASCII stays literal, as JS
    assert canonicalize(None) == "null"


# --- adversarial: must fail closed --------------------------------------------


def test_round_trip_valid_small_manifest(tmp_path):
    path = _write(tmp_path, _build_manifest({"a": '{"k":1}', "b": '{"k":2}'}))
    source = BootstrapManifestSource(path)
    assert source.identities() == ["a", "b"]
    assert source.read_bytes("a") == b'{"k":1}'


def test_tampered_blob_rejected(tmp_path):
    """Blob edited but its per-item hash left stale. Recompute the whole
    checksum so the manifest-level check passes and the per-item hash check is
    the one that must catch the tamper."""
    manifest = _build_manifest({"a": '{"k":1}', "b": '{"k":2}'})
    manifest["items"][0]["source_blob"] += "tampered"  # per-item hash no longer matches
    body = {k: v for k, v in manifest.items() if k != "manifest_checksum"}
    manifest["manifest_checksum"] = _sha(canonicalize(body))
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError, match="source hash mismatch"):
        BootstrapManifestSource(path)


def test_corrupted_whole_checksum_rejected(tmp_path):
    manifest = _build_manifest({"a": '{"k":1}'})
    manifest["manifest_checksum"] = "0" * 64
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError, match="checksum mismatch"):
        BootstrapManifestSource(path)


def test_silent_body_edit_breaks_checksum(tmp_path):
    """Editing a body field without recomputing the checksum is caught."""
    manifest = _build_manifest({"a": '{"k":1}'})
    manifest["source_commit"] = "0000000000000000000000000000000000000000"
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError, match="checksum mismatch"):
        BootstrapManifestSource(path)


def test_item_count_disagreement_rejected(tmp_path):
    manifest = _build_manifest({"a": '{"k":1}', "b": '{"k":2}'})
    manifest["item_count"] = 99
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError):
        BootstrapManifestSource(path)


def test_unsupported_schema_version_rejected(tmp_path):
    manifest = _build_manifest({"a": '{"k":1}'})
    manifest["manifest_schema_version"] = 2
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError, match="schema_version"):
        BootstrapManifestSource(path)


def test_duplicate_identity_rejected(tmp_path):
    manifest = _build_manifest({"a": '{"k":1}'})
    manifest["items"].append(dict(manifest["items"][0]))
    manifest["item_count"] = 2
    # recompute checksum so we exercise the duplicate check, not the checksum one
    body = {k: v for k, v in manifest.items() if k != "manifest_checksum"}
    manifest["manifest_checksum"] = _sha(canonicalize(body))
    path = _write(tmp_path, manifest)
    with pytest.raises(ManifestIntegrityError, match="duplicate upstream_identity"):
        BootstrapManifestSource(path)


def test_missing_manifest_file_rejected(tmp_path):
    with pytest.raises(ManifestIntegrityError, match="cannot read manifest"):
        BootstrapManifestSource(tmp_path / "nope.json")


def test_unknown_identity_read_bytes_rejected():
    source = BootstrapManifestSource(COMMITTED)
    with pytest.raises(SourceItemRejected) as excinfo:
        source.read_bytes("does-not-exist")
    assert excinfo.value.failure_code == "unknown_identity"


# --- What the repository publishes, as source ---------------------------------


def _executable_variants() -> list[tuple[str, str, str]]:
    """(identity, framework, code) for every variant this product can execute.

    The export-only frameworks are excluded: a CUDA-Q or OpenQASM blob is a
    download, not something the sandbox runs, so `FINAL_CIRCUIT` means nothing
    there.
    """
    manifest = json.loads(COMMITTED.read_text())
    rows = []
    for item in manifest["items"]:
        blob = json.loads(item["source_blob"])
        for variant in blob.get("codeVariants", []):
            framework = (variant.get("framework") or "").lower()
            if framework in {"qiskit", "cirq", "pennylane"}:
                rows.append((item["upstream_identity"], framework, variant.get("code") or ""))
    return rows


def test_a_published_circuit_that_binds_nothing_is_counted_not_ignored():
    """The open repository publishes circuits, and `roles.classify_source` is
    what decides whether a blob IS one.

    A variant binding neither FINAL_CIRCUIT nor RESULT is UNKNOWN — "something
    this product cannot execute" — so it fails its execution contract and takes
    the repair path, which hands a published circuit to a language model to be
    rewritten. That is the failure `roles.py` was written to stop, and it is
    live for every entry below the count pinned here.

    The number is pinned rather than asserted to be zero because most of the
    catalog is hand-authored and fixing it is per-entry work (OWNER_TODO).
    Pinned, so it can only go down: a new entry that binds nothing raises it and
    fails, and a batch that gets fixed lowers it and fails until the number is
    updated with the fix.
    """
    from majorana_frameworks.roles import ProgramRole, classify_source

    variants = _executable_variants()
    unknown = [
        (identity, framework)
        for identity, framework, code in variants
        if classify_source(code) is ProgramRole.UNKNOWN
    ]

    assert len(variants) == 311, "executable variants in the published catalog"
    assert len(unknown) == 191, (
        f"{len(unknown)} published variants bind neither FINAL_CIRCUIT nor RESULT. "
        "If this went DOWN, lower the number with the fix. If it went UP, an entry "
        "was added that this product cannot execute — bind FINAL_CIRCUIT in it."
    )


def test_builder_generated_entries_all_name_what_they_built():
    """The 120 the canvas generates are the ones `generateBuilderCode` owns, and
    it binds FINAL_CIRCUIT now. They are identifiable by shape: the builder's
    output ends with the binding and nothing else."""
    from majorana_frameworks.roles import ProgramRole, classify_source

    generated = [
        (identity, framework, code)
        for identity, framework, code in _executable_variants()
        if code.rstrip().endswith(("FINAL_CIRCUIT = qc", "FINAL_CIRCUIT = circuit"))
    ]

    assert len(generated) == 120
    assert all(
        classify_source(code) is ProgramRole.CIRCUIT for _identity, _framework, code in generated
    ), "a binding the builder emits must classify as a circuit"
