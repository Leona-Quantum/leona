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


def _all_variants() -> list[tuple[str, dict]]:
    """(identity, variant) for every code variant in the published catalog."""
    manifest = json.loads(COMMITTED.read_text())
    return [
        (item["upstream_identity"], variant)
        for item in manifest["items"]
        for variant in json.loads(item["source_blob"]).get("codeVariants", [])
    ]


def _executable_variants() -> list[tuple[str, str, str]]:
    """(identity, framework, code) for every variant this product would execute.

    Three filters, each of which was wrong somewhere before this shape existed:

    * **framework** — a CUDA-Q or OpenQASM blob is a download, not something the
      sandbox runs, so `FINAL_CIRCUIT` means nothing there.
    * **language** — 87 records are prose (`language: "text"`), and counting them
      as circuits is how the earlier version of this test reported 191 broken
      circuits when 104 were broken circuits and 87 were not circuits at all.
    * **status** — only `native`/`conversion` variants reach a Library or a run;
      `getPublicRepositoryLibraryVariant` uses the same two.
    """
    return [
        (identity, (variant.get("framework") or "").lower(), variant.get("code") or "")
        for identity, variant in _all_variants()
        if (variant.get("framework") or "").lower() in {"qiskit", "cirq", "pennylane"}
        and variant.get("language") == "python"
        and variant.get("status") in {"native", "conversion"}
    ]


def test_every_published_circuit_says_what_it_built():
    """The open repository publishes circuits, and `roles.classify_source` is
    what decides whether a blob IS one.

    A variant binding neither FINAL_CIRCUIT nor RESULT is UNKNOWN — "something
    this product cannot execute" — so it fails its execution contract and takes
    the repair path, which hands a published circuit to a language model to be
    rewritten. That is the failure `roles.py` was written to stop, and it ran
    against 104 published circuits until this assertion replaced a pinned count.

    Zero rather than a pinned number, deliberately: a pinned count is satisfied
    by a new broken entry displacing a fixed one, and it needs a human to notice
    the direction. There is no longer any published Python this product cannot
    classify, so the honest gate is that adding one fails.
    """
    from majorana_frameworks.roles import ProgramRole, classify_source

    variants = _executable_variants()
    unknown = [
        (identity, framework)
        for identity, framework, code in variants
        if classify_source(code) is ProgramRole.UNKNOWN
    ]

    assert len(variants) == 224, "executable variants in the published catalog"
    assert unknown == [], (
        f"{len(unknown)} published variants bind neither FINAL_CIRCUIT nor RESULT, so "
        "Leona reads them as something it cannot execute and sends them to a model to "
        f"be rewritten: {unknown[:5]}. Bind FINAL_CIRCUIT to the circuit the source "
        "builds, or RESULT to what the program computed."
    )


def test_a_final_circuit_binding_names_something_that_survives_the_module():
    """`FINAL_CIRCUIT = qc` where `qc` only exists inside a factory function is a
    NameError at the end of the module, and `classify_source` cannot see the
    difference — it walks the whole tree, so a binding inside a `def` counts.

    Four entries were written that way while fixing this catalog (a circuit
    built and returned by a helper). They classify as CIRCUIT and fail at run
    time, which is a worse failure than the one being fixed.
    """
    import ast

    from majorana_frameworks.roles import CIRCUIT_NAME

    def module_scope_names(tree: ast.Module) -> set[str]:
        names: set[str] = set()
        for node in tree.body:
            if isinstance(node, ast.Assign):
                names.update(t.id for t in node.targets if isinstance(t, ast.Name))
            elif isinstance(node, (ast.AnnAssign, ast.AugAssign)) and isinstance(node.target, ast.Name):
                names.add(node.target.id)
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                names.update(a.asname or a.name.split(".")[0] for a in node.names)
            elif isinstance(node, ast.For) and isinstance(node.target, ast.Name):
                names.add(node.target.id)
        return names

    dangling = []
    for identity, framework, code in _executable_variants():
        tree = ast.parse(code)
        at_module_scope = module_scope_names(tree)
        for node in tree.body:
            if not isinstance(node, ast.Assign):
                continue
            if not any(isinstance(t, ast.Name) and t.id == CIRCUIT_NAME for t in node.targets):
                continue
            if isinstance(node.value, ast.Name) and node.value.id not in at_module_scope:
                dangling.append((identity, framework, node.value.id))

    assert dangling == [], (
        f"FINAL_CIRCUIT is bound to a name that does not exist when the module ends: "
        f"{dangling}. Call the builder at module scope instead."
    )


def test_a_prose_record_never_claims_to_be_framework_source():
    """`status: "native"` is a claim that a variant is genuine source for its
    framework. 87 records are prose — an operator's representative form, a
    literature method's ingredient list — and `makeReferenceEntry` stamped
    `native` on them regardless of language.

    Nothing downstream re-checked, so `getPublicRepositoryLibraryVariant`
    selected them and Save-to-Library filed a paragraph of English as an
    artifact's executable code, with `code_lang: "text"`.
    """
    mislabelled = [
        (identity, variant.get("framework"), variant.get("language"), variant.get("status"))
        for identity, variant in _all_variants()
        if variant.get("language") == "text" and variant.get("status") in {"native", "conversion"}
    ]
    assert mislabelled == [], (
        f"{len(mislabelled)} prose records claim to be executable framework source: "
        f"{mislabelled[:5]}"
    )


def test_builder_generated_entries_all_name_what_they_built():
    """The 120 entries `generateBuilderCode` owns must classify as circuits.

    They are identified by carrying a `portableCircuit` — the framework-neutral
    gate graph the generator renders from — and NOT by the shape of the code.
    The shape test this replaced looked for a trailing `FINAL_CIRCUIT = qc`,
    which stopped discriminating the moment the hand-authored entries were fixed
    to end the same way: it matched 201 variants and would have gone on matching
    whatever the count happened to be. A discriminator that stops discriminating
    is worse than a missing test, because it keeps reporting a pass.
    """
    from majorana_frameworks.roles import ProgramRole, classify_source

    manifest = json.loads(COMMITTED.read_text())
    generated = [
        (item["upstream_identity"], variant.get("framework"), variant.get("code") or "")
        for item in manifest["items"]
        for blob in [json.loads(item["source_blob"])]
        if blob.get("portableCircuit")
        for variant in blob.get("codeVariants", [])
        if (variant.get("framework") or "").lower() in {"qiskit", "cirq", "pennylane"}
        and variant.get("language") == "python"
    ]

    assert len(generated) == 120
    not_circuits = [
        (identity, framework)
        for identity, framework, code in generated
        if classify_source(code) is not ProgramRole.CIRCUIT
    ]
    assert not_circuits == [], "a binding the builder emits must classify as a circuit"
