"""Pure public-catalog read mapping (repository Step 6 / Neon cutover Slice C).

Maps database-authoritative values plus the pinned source bytes into the
`PublicCatalogEntry` response contract. Kept pure (no sqlalchemy, no ORM rows)
like catalog_publication.py: repos/catalog.py loads the rows and calls this.

`record` is the rich presentation payload. For the ADR-0019 bootstrap corpus
the stored source bytes ARE the canonical-JSON of the original catalog entry
(the importer persisted the manifest blob verbatim as the version source), so
the entry's algorithm family, category, comparisons, verification prose, code
variants, and localized copy are recovered here at read time — the importer
itself stays content-agnostic. The blob is a *source claim* from the pinned
manifest, never execution evidence (ADR-0019); the typed envelope fields are the
only database-authoritative facts.
"""

from __future__ import annotations

import datetime as dt
import json

from majorana_contracts import CatalogProvenance, PublicCatalogEntry

# The stored bytes were integrity-checked at import (per-item sha256 == manifest
# hash), but read-time parsing still fails closed: a record that does not
# deserialize to a JSON object yields record=None rather than raising, so one
# malformed row can never 500 the whole public listing.
MAX_RECORD_BYTES = 512 * 1024


def parse_source_record(source_code: str | None) -> dict | None:
    """Best-effort decode of the pinned source blob into the presentation record.

    Returns None (not an error) when the source is absent, oversized, or not a
    JSON object — e.g. a future non-manifest provider whose source is real code
    rather than a catalog entry.
    """
    if not source_code:
        return None
    if len(source_code.encode("utf-8")) > MAX_RECORD_BYTES:
        return None
    try:
        value = json.loads(source_code)
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def build_public_catalog_entry(
    *,
    upstream_identity: str,
    execution_state: str | None,
    updated_at: dt.datetime | None,
    source_code: str | None,
    source_blob_sha256: str | None,
    import_provider: str | None,
    upstream_ref: str | None,
) -> PublicCatalogEntry:
    provenance = CatalogProvenance(
        import_provider=import_provider,
        upstream_ref=upstream_ref,
        upstream_identity=upstream_identity,
        source_blob_sha256=source_blob_sha256,
    )
    return PublicCatalogEntry(
        slug=upstream_identity,
        execution_state=execution_state or "unsupported",
        updated_at=updated_at or dt.datetime.now(dt.timezone.utc),
        provenance=provenance,
        record=parse_source_record(source_code),
    )
