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
# tags/resources/verification* summaries the list filters and badges by, and
# portableCircuit, which `deriveInterface` reads for the takes/returns facet.
# Everything else in `record` — long-form prose, classical comparisons,
# citations, and other detail-page-only content — is dropped here.
#
# **The old justification for `portableCircuit` named a control that no longer
# exists** and is corrected rather than quietly deleted, because it was quoted
# forward twice: it said `getPublicRepositoryVariant()` reads the field here so
# the browse list's *framework filter* does not under-report export support.
# There is no framework filter. It was removed as "a control that removes a
# third of the rows at its most aggressive setting is not a filter" — its eight
# options produced five distinct result sets — and the browse bar is now
# search · topic · takes-returns. Every surviving caller of
# `getPublicRepositoryVariant` fetches a FULL record.
#
# Note the membership below is not the whole contract: four of these fields are
# projected a level deeper, and the constants that do it carry their own
# measurements.
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
        # Kept, and projected a level down — see LIST_VIEW_RESOURCE_LABELS. The
        # browse card reads exactly one row out of this array.
        "resources",
        # `metadata` is NOT here, and its absence is the deliberate kind.
        #
        # It was 140,334 bytes — 13.1% of the whole list payload — and the browse
        # list renders none of it. Its one consumer is the detail page, which
        # spreads it alongside `resources`
        # (`app/repository/[slug]/repository-entry-view.tsx:533`) and fetches its
        # own full record from `/v1/catalog/entries/{slug}`, so it is unaffected.
        # The export route (`app/api/repository/[slug]/export/route.ts`) likewise
        # reads a full record.
        #
        # Removing a field from this set is only safe because
        # `parseCatalogListRecord` tolerates an absent one; before that landed,
        # dropping any of the four heavy fields took the browse list from 369
        # records to ZERO, and the site went on rendering from the bundled
        # snapshot with one console line.
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


# The `resources` rows the browse list actually renders, matched by label.
#
# `resources` is 92,870 bytes of the list payload (8.7%), of which the one row a
# browse card reads is 5,662. The card's lookup is
# `entry.resources.find((r) => r.label === "Qubits")?.value`
# (`app/repository/repository-browser.tsx:786`) — one label, matched literally,
# and it is the ONLY read of `entry.resources` anywhere on the browse path. The
# other two readers, the detail view and the export route, each fetch a full
# record and are untouched by this.
#
# Filtering by the same literal the client matches on is what makes this a
# projection rather than a behaviour change: a record whose rows do not include
# a "Qubits" label shows no qubit chip today and shows none after, and a record
# that does keeps the same string. Nothing derives a *count* from this array.
#
# **This is deliberately not the swap the earlier plan called for.** That plan
# was to drop `resources` outright and read `profileOf(entry)?.qubits` instead,
# since the page already fetches profiles. It is unsafe: `RepositoryProfile.qubits`
# is null exactly when `present` is false, and `present` is false whenever
# `portableCircuit` is absent (`lib/repository/profile.ts:25-26`,
# `catalog_profile.py:59-61`), while these rows are hand-authored prose that does
# not depend on a circuit at all — `entries-states-operators.ts` carries seven
# `label: "Qubits"` rows and zero `portableCircuit` occurrences, and some of their
# values are not numbers ("1 system + 1 ancilla", "1 per mode") and cannot be
# represented by `qubits: int | None`. The swap would silently blank the chip on
# every literature, operator and state record. Keeping the row costs 5,662 bytes.
LIST_VIEW_RESOURCE_LABELS: frozenset[str] = frozenset({"Qubits"})


def _project_resources(resources: Any) -> Any:
    """Keep the rows the browse card reads, drop the rest of the table.

    Anything that is not a list of objects is returned untouched, for the same
    reason `_project_code_variants` does: the web validator refuses a malformed
    `resources` and a projection must not launder one into a well-formed empty
    list on the way past. A row without a recognisable `label` is dropped, not
    kept — an unlabelled row cannot be the one the card looks up.
    """
    if not isinstance(resources, list):
        return resources
    return [
        row
        for row in resources
        if isinstance(row, dict) and row.get("label") in LIST_VIEW_RESOURCE_LABELS
    ]


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


# What `visualization` keeps on the browse list, and the one category that keeps
# more.
#
# This is the largest remaining item and the only one of the four that needed a
# design decision rather than a measurement. `visualization` is 171,410 bytes of
# the list payload (16.0%), and it splits very unevenly:
#
#     operations  138,156      wires  12,911      outcomes  7,059
#
# Every record needs `wires` and only `wires`: `deriveInterface` takes
# `visualization.wires.length` as the record's stated register width, and
# `repository-browser.tsx:523` passes `entry.visualization?.wires?.length ?? 0`.
# `outcomes` is read by NOTHING in the browse view, including the gate pane —
# only the detail page renders it (`repository-entry-view.tsx:414`), and that
# page fetches a full record.
#
# `operations` is the interesting one. It is needed to DRAW a circuit, and the
# browse list draws exactly one: the gate sidebar's `selectedGateEntry`
# (`repository-browser.tsx:1053`, drawn at `:1562`) — and `gateEntries` is
# `category === "gates" ? ordered : []`, so the sidebar does not exist on any
# other tab.
#
# THE DECISION, and it was made on a measurement rather than on taste: the
# alternative was to fetch the selected gate's circuit on demand. Gates are 29 of
# 369 records and gate circuits are small, so keeping `operations` for that one
# category costs **1,822 bytes** — 685,988 against 684,166 for dropping it
# everywhere, 0.17% of the payload. An on-demand fetch would buy those 1,822
# bytes back in exchange for a round trip on every gate click, a loading state,
# and an error path on a pane that cannot currently fail. That is a bad trade at
# any size, and at 1.8 KB it is not close.
#
# So: `wires` for every record, plus `operations` for gates, and `outcomes` for
# no one. If a second view ever draws a circuit from the LIST payload, this is
# the constant to widen — and widening it is a byte cost, not a redesign.
LIST_VIEW_VISUALIZATION_FIELDS: frozenset[str] = frozenset({"wires"})
LIST_VIEW_GATE_VISUALIZATION_FIELDS: frozenset[str] = frozenset({"wires", "operations"})


# The register, not the circuit.
#
# `portableCircuit` is 80,159 bytes of the list payload (11.7% of what is left
# after the other three projections), and `steps` is **75,329** of them. Nothing
# on the browse path reads a step: `deriveInterface`
# (`apps/web/lib/repository/interface.ts`) reads `qubitCount` and `measure` and
# there is no third read in its body, and `repository-browser.tsx:524` passes the
# field straight into it.
#
# **Two comments used to say otherwise and both were stale**, which is why this
# needed checking rather than assuming. The old note on this allowlist said
# `getPublicRepositoryVariant()` reads `portableCircuit` on the list "to
# synthesise a converted framework variant when no native one exists (without it
# the framework filter silently under-reports support)", and
# `public-repository.ts` said the same. **There is no framework filter.** It was
# removed as "a control that removes a third of the rows at its most aggressive
# setting is not a filter" (repository-browser.tsx, the FacetRail comment), and
# the browse bar is search · topic · takes-returns. Every remaining caller of
# `getPublicRepositoryVariant` — the detail view and the export route — fetches a
# FULL record.
#
# Confirmed independently by something that already shipped: the list's
# `codeVariants` lost its `code` in an earlier projection, and
# `getPublicRepositoryVariant` reads `nativeVariant?.code` first. Had the browse
# list still called it, that would already be broken. It is not.
LIST_VIEW_PORTABLE_CIRCUIT_FIELDS: frozenset[str] = frozenset({"qubitCount", "measure"})


def _project_portable_circuit(circuit: Any) -> Any:
    """Keep the width and the terminal-measurement flag, drop the gate list.

    Passed through untouched when it is not a mapping, for the same reason as
    the other three inner projections: a projection must not launder a schema
    disagreement into a well-formed object.
    """
    if not isinstance(circuit, dict):
        return circuit
    return {
        key: value for key, value in circuit.items() if key in LIST_VIEW_PORTABLE_CIRCUIT_FIELDS
    }


def _project_visualization(visualization: Any, category: Any) -> Any:
    """Keep the register, and the circuit only where one is drawn.

    Not returned untouched when malformed, but not repaired either: a
    non-mapping is passed through exactly as `_project_code_variants` passes
    through a non-list, so the web validator still sees the schema disagreement
    instead of a well-formed empty object.
    """
    if not isinstance(visualization, dict):
        return visualization
    keep = (
        LIST_VIEW_GATE_VISUALIZATION_FIELDS
        if category == "gates"
        else LIST_VIEW_VISUALIZATION_FIELDS
    )
    return {key: value for key, value in visualization.items() if key in keep}


def project_record_for_list_view(record: dict[str, Any] | None) -> dict[str, Any] | None:
    """Project a rich `record` down to the browse-list allowlist (Slice E).

    Projects by intersection, never by filling in defaults: a key absent from
    the source record (e.g. `decomposition`, present in only a minority of
    records) must stay absent from the output rather than appearing as
    `None`. `record=None` (a non-manifest source, see `parse_source_record`)
    survives unchanged.

    Four fields are projected a level deeper than the allowlist reaches, because
    that is where their cost is rather than in the field itself:

    * `codeVariants` keeps its shape and loses the code inside it
      (LIST_VIEW_CODE_VARIANT_FIELDS).
    * `resources` keeps the rows the browse card reads and loses the rest of the
      table (LIST_VIEW_RESOURCE_LABELS).
    * `visualization` keeps the register for every record and the circuit only
      for the one category that draws one (LIST_VIEW_VISUALIZATION_FIELDS).
    * `portableCircuit` keeps the width and the measurement flag and drops the
      gate list (LIST_VIEW_PORTABLE_CIRCUIT_FIELDS).
      This is the only projection here that reads a SECOND field of the record —
      `category` — so it is applied against the source record rather than the
      projected one, and it is unaffected if `category` is ever dropped from the
      allowlist.

    Both keep the field present and its type unchanged, which is what makes them
    behaviour-preserving: `families.ts:148` folds `codeVariants` into the
    width-family signature with no `?? []`, and `repository-browser.tsx:786`
    searches `resources`. Removing a field is not the same as slimming it, and
    the difference is silent.
    """
    if record is None:
        return None
    projected = {key: value for key, value in record.items() if key in LIST_VIEW_RECORD_FIELDS}
    if "codeVariants" in projected:
        projected["codeVariants"] = _project_code_variants(projected["codeVariants"])
    if "resources" in projected:
        projected["resources"] = _project_resources(projected["resources"])
    if "visualization" in projected:
        projected["visualization"] = _project_visualization(
            projected["visualization"], record.get("category")
        )
    if "portableCircuit" in projected:
        projected["portableCircuit"] = _project_portable_circuit(projected["portableCircuit"])
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
