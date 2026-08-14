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
from typing import Any

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


# The exact `record` keys the /repository browse list renders and filters on:
# title/category/framework/status for the cards and filter chips, the
# tags/resources/metadata/verification* summaries the list filters and badges
# by, and portableCircuit, which getPublicRepositoryVariant() reads to
# synthesise a converted framework variant when no native one exists (without
# it the framework filter silently under-reports support). Everything else in
# `record` — long-form prose, classical comparisons, citations, and other
# detail-page-only content — is dropped here.
#
# This allowlist is Slice E's whole fix for the /v1/catalog/entries list
# response exceeding Vercel's 2 MB Next.js data-cache ceiling (measured at
# 2,367,578 bytes full vs 910,960 bytes projected against the real production
# corpus). Adding a heavy field back to this set re-breaks that ceiling —
# re-measure the real payload before adding anything here.
LIST_VIEW_RECORD_FIELDS: frozenset[str] = frozenset(
    {
        "slug",
        "title",
        "titleJa",
        "category",
        "categoryLabel",
        "categoryLabelJa",
        "status",
        "framework",
        "algorithmFamily",
        "description",
        "descriptionJa",
        "provenance",
        "updatedAt",
        "exportStatus",
        "verification",
        "tags",
        # R2's closed vocabulary. Omitting it does not degrade the browse list —
        # it removes the topic filter entirely and every card's role chip, with
        # nothing in the payload to say a field was dropped. `tags` is one line
        # up and would have looked like coverage.
        "topics",
        "resources",
        "metadata",
        "verificationMethods",
        "codeVariants",
        "visualization",
        "decomposition",
        "portableCircuit",
        # Roadmap §3.6. Three enum values per record — small and fixed-size, so
        # it does not move the ceiling above meaningfully.
        #
        # This set and apps/web/lib/repository/types.ts's
        # PUBLIC_REPOSITORY_LIST_FIELDS are the same list in two languages.
        # scripts/catalog-bootstrap/from-catalog-validator.test.mjs asserts they
        # are set-equal — the two assertions in this service's own tests are
        # `issubset` and `<=`, which cannot see a field missing from here.
        "sourceCoverage",
        # Also §3.6, and added later than `sourceCoverage` on purpose: the web's
        # `deriveInterface` reads `knownGaps[].role` to decide whether a record's
        # interface stance is `declared-hole` or `undeclared`, and the browse
        # list's interface filter is built from those stances. Dropping it here
        # would not blank a chip — it would silently reclassify every declared
        # hole as "no declared interface" in the one view a reader uses to find
        # them, and only in production against a healthy API.
        #
        # It is prose-bearing and unbounded per record, which is why the byte
        # cost is measured rather than argued: +1,037 bytes across the real
        # 283-record corpus, ~290 KB if every record carried a gap of that size,
        # against 770,397 projected and the 2 MB Next.js data-cache ceiling.
        # The web-side test named above asserts that ceiling over the pinned
        # manifest, so growth fails a test rather than a page.
        "knownGaps",
    }
)


# The keys of a code variant the browse list actually reads.
#
# A variant is `{code, filename, framework, language, note, status}`, and `code`
# alone is 82.8% of the whole `codeVariants` field — 362,564 of 437,825 bytes
# across the published corpus, measured against the live listing rather than a
# fixture. Nothing in the browse list reads it: `getPublicRepositoryVariant()`
# and `getPublicRepositoryLibraryVariant()` both take a full
# `PublicRepositoryEntry` and are reached only from the detail view and the
# export route, each of which fetches one record on its own.
#
# What the list DOES read is two keys, in one place —
# `apps/web/lib/repository/families.ts:148` folds
# `codeVariants.map((v) => f"{v.framework}:{v.status}")` into the signature that
# decides which records belong to the same width family, and
# `repository-browser.tsx:44` imports that. So the field cannot be dropped: doing
# so would give every record an identical signature component and silently change
# which records fold together, with nothing failing. Keeping the field and
# dropping the code is the version with no behaviour change at all.
LIST_VIEW_CODE_VARIANT_FIELDS: frozenset[str] = frozenset({"framework", "status"})


def _project_code_variants(variants: Any) -> Any:
    """Keep each variant's identity, drop the source it carries.

    Anything that is not a list of objects is returned untouched rather than
    coerced. A projection is not the place to discover a schema disagreement —
    the web validator refuses a malformed `codeVariants` and this must not turn
    a malformed one into a well-formed empty one on the way past.
    """
    if not isinstance(variants, list):
        return variants
    return [
        {key: value for key, value in variant.items() if key in LIST_VIEW_CODE_VARIANT_FIELDS}
        if isinstance(variant, dict)
        else variant
        for variant in variants
    ]


def project_record_for_list_view(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """Project a rich `record` down to the browse-list allowlist (Slice E).

    Projects by intersection, never by filling in defaults: a key absent from
    the source record (e.g. `decomposition`, present in only a minority of
    records) must stay absent from the output rather than appearing as
    `None`. `record=None` (a non-manifest source, see `parse_source_record`)
    survives unchanged.

    One field is projected a level deeper than the allowlist reaches:
    `codeVariants` keeps its shape and loses the code inside it. See
    LIST_VIEW_CODE_VARIANT_FIELDS for why that is the whole field's cost and
    none of its use.
    """
    if record is None:
        return None
    projected = {key: value for key, value in record.items() if key in LIST_VIEW_RECORD_FIELDS}
    if "codeVariants" in projected:
        projected["codeVariants"] = _project_code_variants(projected["codeVariants"])
    return projected


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
