# ADR-0019: The pinned 285-record snapshot bootstraps Neon through the importer

**Date:** 2026-07-18 · **Status:** implemented (executed 2026-07-19; live in production)

> **Status corrected 2026-08-04.** Fully executed. The pinned manifest is committed at
> `services/api/catalog_bootstrap/manifest.json` (2.0 MB, 283 items) and the corpus was
> imported, attested and published through `catalog_admin bootstrap-import` →
> `attest-bootstrap` → `publish-bootstrap` (`ImportProvider.CATALOG_BOOTSTRAP`,
> migration `0019_catalog_bootstrap_provider`). The operator procedure lives in
> `docs/runbooks/system-catalog.md`. "Neon" throughout the text below means the
> catalog database, which has been **Cloud SQL for PostgreSQL 17** since 2026-07-27
> (ADR-0024); nothing about the mechanism changed with the move.
>
> **How to read the body below.** It is the decision as written on 2026-07-18 plus the
> Slice A/B build log, and the mechanism it describes is exactly what shipped. Two
> classes of statement in it are no longer current facts and are marked inline as
> *[As of …]*: the **285**-record figures (the corpus is **283** — see the amendment
> below) and the **inert/feature-disabled** state (`SYSTEM_CATALOG_ENABLED` is now
> **true**, and the corpus is imported, attested and published). What has *not* changed:
> bootstrap is still never automatic — Alembic and application startup still insert and
> publish nothing, and production publication is still an owner-run, approval-gated CLI
> action.

> **Amendment, 2026-07-19.** The corpus is now **283 records**, not 285. The owner removed
> `grover-4bit-search` and `simon-query-circuit` — the two community submissions the
> first-party license grant of ADR-0016 could not reach — from the source corpus outright,
> rather than carrying them as permanently-private records. Nothing about the mechanism below
> changes: the manifest is still generated from the assembled TypeScript entries at a pinned
> commit, and the count is derived, never asserted. The category breakdown becomes 29 gates,
> 60 operators, 13 states, and **181** algorithms — both removed records were `algorithms`.
> The figures in the body are the numbers as of the original decision; they are left as
> written and each is marked inline with the current count.

**Context:** The latest integrated `dev` baseline validates 285 TypeScript Atlas
records: 29 gates, 60 operators, 13 states, and 183 algorithms *[figures as of
2026-07-18; the corpus is 283 records — 29/60/13/181 — since the 2026-07-19 amendment
above, and the committed manifest holds 283 items]*. Neon must become the
default catalog authority without losing this work, but copying rows in a migration,
reading TypeScript at runtime, or trusting legacy verification/license strings would
create dual sources of truth and bypass the new acceptance contract.
**Decision:** Generate a deterministic, schema-versioned bootstrap manifest from the
285 *[read: 283]* records at one pinned source commit. The manifest stores source commit, generator
version, deterministic ordering, per-item source hashes, and a whole-manifest checksum.
A dedicated local bootstrap connector submits it through the normal durable importer;
every item receives provenance, rights, classification, deduplication, review, and
evidence states. Automatic bootstrap is deferred and is not enabled by this PR:
*[as of 2026-07-18: "`SYSTEM_CATALOG_ENABLED` remains false" — it is **true** on both
live Cloud Run services since the 2026-07-19 cutover]*, and no bootstrap command or
startup hook runs implicitly *(still true)*. A later reviewed step may let fresh
development and preview Neon branches
run an explicit idempotent post-migration bootstrap command behind a separate operator
flag. Alembic and application startup never insert or publish catalog data. Production
bootstrap/publication remains approval
gated. All 285 *[read: 283]* items remain auditable even when an item is quarantined or rejected;
only accepted/public records appear in anonymous reads. Existing `verified` labels,
tiers, prose, and license descriptions are source claims, not passing run evidence or
legal approval. After import, Neon is authoritative; later TypeScript changes require
a new pinned manifest release and explicit import job rather than automatic sync.
**Consequences:** Existing catalog work can populate new Neon environments
reproducibly while the runtime and public API remain single-source. The cost is a
manifest generator, schema/version policy, per-item import outcomes, checksum and
idempotency tests, a 20-item proof, full 285-item *[read: 283-item]* reconciliation, and a deliberate UI
cutover. The TypeScript source files remain untouched by backend importer PRs. A failed
bootstrap cannot partially publish: accepted state is per reviewed item, and the job
report accounts for every manifest item. Reversal trigger: once the TypeScript surface
is retired, future bootstrap releases may be exported from Neon itself, but the pinned
manifest and its import evidence remain immutable historical provenance.

**Implementation status.** *Slice A and Slice B below are the build log as written at the
time each slice landed; both are superseded by the executed state in the status
correction at the top of this file.*
- *Slice A (landed, PR #73):* deterministic manifest generator + committed
  `services/api/catalog_bootstrap/manifest.json` (285 items at the time, per-item +
  whole-manifest hashes; **283 items** since the 2026-07-19 amendment).
- *Slice B (this change):* the local bootstrap connector. The importer is now provider-agnostic
  (`catalog_import_sources.ImportSource`); `catalog_bootstrap_manifest.BootstrapManifestSource`
  loads the pinned manifest, re-verifies the whole-manifest checksum and every per-item sha256
  fail-closed at construction, and submits the embedded bytes through the unchanged durable
  importer. `ImportProvider.CATALOG_BOOTSTRAP` (DB CHECK extended in migration 0019) records the
  distinct provenance. `catalog_admin bootstrap-import` runs it in-process (idempotent via a
  checksum-derived key); a full manifest reconciliation test asserts DB-stored hashes equal the
  manifest's. *[As of Slice B: "still inert to users: records stage `private`/`draft`, nothing
  publishes, and `SYSTEM_CATALOG_ENABLED` stays false." That describes the end of Slice B only.
  The corpus was imported, attested and published on 2026-07-19 —
  `catalog_admin bootstrap-import` → `attest-bootstrap` → `publish-bootstrap` — and
  `SYSTEM_CATALOG_ENABLED` is true in production; the records are accepted/public and serve
  `/repository`.]* Bootstrap records stage with `execution_state=template_only`
  / framework version `unknown` (honest — the manifest is catalog metadata, not executed circuits);
  mapping the manifest's richer fields into the read model is Slice C's concern.
