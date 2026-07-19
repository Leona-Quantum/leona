"""Bootstrap-manifest import source (ADR-0019, Slice B).

Reads the pinned, content-hashed bootstrap manifest produced by Slice A
(scripts/catalog-bootstrap/, committed at services/api/catalog_bootstrap/
manifest.json) and submits each item's *embedded* source bytes through the
existing durable importer. Because the canonical source bytes are embedded per
item and hashed at generation time, this adapter performs no network fetch and
follows no externally-controlled path — the SSRF/quarantine surface that a live
network adapter would need (repository Step 5 plan §7.1) is simply absent here.

Integrity is enforced fail-closed at construction: the whole-manifest checksum
and every per-item sha256 are re-verified before any item can be staged, so a
corrupt or tampered manifest raises rather than importing bad content. The
verification mirrors the JS generator's `canonicalize` (manifest-core.mjs) so
the checksum computed here is byte-identical to the one recorded at generation.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from majorana_contracts.enums import ImportProvider

from .catalog_hashing import hash_source_blob
from .catalog_import_sources import SourceItemRejected

SUPPORTED_SCHEMA_VERSION = 1
SOURCE_BLOB_ENCODING = "canonical-json-utf8"
# The manifest is codebase-pinned, but keep hard bounds so a future regenerated
# manifest can never silently balloon what one bootstrap batch stages.
MAX_MANIFEST_ITEMS = 5000
MAX_ITEM_BYTES = 256 * 1024


class ManifestIntegrityError(ValueError):
    """The manifest is structurally invalid, unsupported, or fails a hash/checksum
    check. Raised at load time so corrupt content never reaches staging."""


def canonicalize(value: object) -> str:
    """Deterministic canonical JSON, byte-for-byte matching the JS generator's
    canonicalize (scripts/catalog-bootstrap/manifest-core.mjs): object keys
    sorted lexicographically at every depth, array order preserved, primitives
    serialized like JSON.stringify. Only the JSON value types the manifest
    actually contains (dict/list/str/int/bool/None) are handled.
    """
    if value is None or not isinstance(value, (dict, list)):
        # separators keep spacing out of primitives (JSON.stringify emits none);
        # ensure_ascii=False leaves non-ASCII literal, exactly as JS does.
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(canonicalize(v) for v in value) + "]"
    keys = sorted(value.keys())
    return (
        "{"
        + ",".join(json.dumps(k, ensure_ascii=False) + ":" + canonicalize(value[k]) for k in keys)
        + "}"
    )


def _sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def default_manifest_path() -> Path:
    """Locate the committed bootstrap manifest in both layouts.

    Prefer the copy force-included into a built wheel (majorana_api/
    catalog_bootstrap/manifest.json); fall back to the source-tree location
    (services/api/catalog_bootstrap/manifest.json), which is what runs under an
    editable install in dev/CI and in the tests.
    """
    here = Path(__file__).resolve()
    packaged = here.parent / "catalog_bootstrap" / "manifest.json"
    if packaged.is_file():
        return packaged
    # here == services/api/src/majorana_api/catalog_bootstrap_manifest.py
    return here.parents[2] / "catalog_bootstrap" / "manifest.json"


def _verify(manifest: dict) -> None:
    """Fail-closed structural + cryptographic validation of a loaded manifest."""
    version = manifest.get("manifest_schema_version")
    if version != SUPPORTED_SCHEMA_VERSION:
        raise ManifestIntegrityError(
            f"unsupported manifest_schema_version {version!r} (expected {SUPPORTED_SCHEMA_VERSION})"
        )

    items = manifest.get("items")
    if not isinstance(items, list) or not items:
        raise ManifestIntegrityError("manifest has no items")
    if len(items) > MAX_MANIFEST_ITEMS:
        raise ManifestIntegrityError(
            f"manifest has {len(items)} items, exceeds {MAX_MANIFEST_ITEMS}"
        )
    if manifest.get("item_count") != len(items):
        raise ManifestIntegrityError(
            f"item_count {manifest.get('item_count')!r} disagrees with {len(items)} items"
        )

    recorded_checksum = manifest.get("manifest_checksum")
    if not isinstance(recorded_checksum, str) or not recorded_checksum:
        raise ManifestIntegrityError("manifest_checksum is missing")
    body = {k: v for k, v in manifest.items() if k != "manifest_checksum"}
    computed = _sha256_hex(canonicalize(body))
    if computed != recorded_checksum:
        raise ManifestIntegrityError(
            f"manifest checksum mismatch: computed {computed}, recorded {recorded_checksum}"
        )

    seen: set[str] = set()
    for item in items:
        identity = item.get("upstream_identity")
        if not isinstance(identity, str) or not identity:
            raise ManifestIntegrityError("an item is missing upstream_identity")
        if identity in seen:
            raise ManifestIntegrityError(f"duplicate upstream_identity {identity!r}")
        seen.add(identity)
        if item.get("source_blob_encoding") != SOURCE_BLOB_ENCODING:
            raise ManifestIntegrityError(
                f"item {identity!r} has unexpected source_blob_encoding "
                f"{item.get('source_blob_encoding')!r}"
            )
        blob = item.get("source_blob")
        recorded_hash = item.get("source_blob_sha256")
        if not isinstance(blob, str) or not isinstance(recorded_hash, str):
            raise ManifestIntegrityError(f"item {identity!r} is missing source_blob or hash")
        # hash_source_blob is the exact function the importer uses at staging;
        # verifying against it here guarantees the item will pass the same check
        # again downstream (per-item parity with catalog_hashing).
        if hash_source_blob(blob.encode("utf-8")) != recorded_hash:
            raise ManifestIntegrityError(f"item {identity!r} source hash mismatch")


class BootstrapManifestSource:
    """ImportSource over the pinned bootstrap manifest.

    Construction loads and fully verifies the manifest (checksum + every
    per-item hash); an invalid manifest raises ManifestIntegrityError before any
    batch is created. read_bytes returns the embedded, already-verified bytes.
    """

    provider = ImportProvider.CATALOG_BOOTSTRAP

    def __init__(self, manifest_path: Path | None = None):
        self._path = manifest_path or default_manifest_path()
        try:
            raw = self._path.read_text(encoding="utf-8")
        except OSError as exc:
            raise ManifestIntegrityError(f"cannot read manifest at {self._path}: {exc}") from exc
        try:
            manifest = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ManifestIntegrityError(
                f"manifest at {self._path} is not valid JSON: {exc}"
            ) from exc
        if not isinstance(manifest, dict):
            raise ManifestIntegrityError("manifest root is not an object")
        _verify(manifest)
        self._checksum: str = manifest["manifest_checksum"]
        self._source_commit: str = str(manifest.get("source_commit", ""))
        # Preserve manifest order (slug-asc, per the generator) and index blobs
        # by identity for O(1) read_bytes.
        self._identities: list[str] = [it["upstream_identity"] for it in manifest["items"]]
        self._blobs: dict[str, str] = {
            it["upstream_identity"]: it["source_blob"] for it in manifest["items"]
        }

    @property
    def upstream_ref(self) -> str:
        return self._source_commit

    @property
    def manifest_checksum(self) -> str:
        return self._checksum

    @property
    def idempotency_key(self) -> str:
        """Stable key derived from the manifest checksum: re-running the same
        pinned manifest resumes the same batch (crash-safe) instead of creating
        a duplicate one; regenerating the manifest yields a new key."""
        return f"catalog-bootstrap-{self._checksum}"

    def identities(self) -> list[str]:
        return list(self._identities)

    def read_bytes(self, upstream_identity: str) -> bytes:
        blob = self._blobs.get(upstream_identity)
        if blob is None:
            raise SourceItemRejected("unknown_identity")
        raw = blob.encode("utf-8")
        if len(raw) > MAX_ITEM_BYTES:
            raise SourceItemRejected("oversized")
        return raw

    def descriptor(self) -> dict[str, str]:
        return {"manifest_checksum": self._checksum, "source_commit": self._source_commit}
