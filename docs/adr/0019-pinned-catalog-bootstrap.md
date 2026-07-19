# ADR-0019: The pinned 285-record snapshot bootstraps Neon through the importer

**Date:** 2026-07-18 · **Status:** accepted (user-requested)

> **Amendment, 2026-07-19.** The corpus is now **283 records**, not 285. The owner removed
> `grover-4bit-search` and `simon-query-circuit` — the two community submissions the
> first-party license grant of ADR-0016 could not reach — from the source corpus outright,
> rather than carrying them as permanently-private records. Nothing about the mechanism below
> changes: the manifest is still generated from the assembled TypeScript entries at a pinned
> commit, and the count is derived, never asserted. The category breakdown becomes 29 gates,
> 60 operators, 13 states, and **181** algorithms — both removed records were `algorithms`.
> The figures in the body are the numbers as of the original decision and are left as written.
**Context:** The latest integrated `dev` baseline validates 285 TypeScript repository
records: 29 gates, 60 operators, 13 states, and 183 algorithms. Neon must become the
default catalog authority without losing this work, but copying rows in a migration,
reading TypeScript at runtime, or trusting legacy verification/license strings would
create dual sources of truth and bypass the new acceptance contract.
**Decision:** Generate a deterministic, schema-versioned bootstrap manifest from the
285 records at one pinned source commit. The manifest stores source commit, generator
version, deterministic ordering, per-item source hashes, and a whole-manifest checksum.
A dedicated local bootstrap connector submits it through the normal durable importer;
every item receives provenance, rights, classification, deduplication, review, and
evidence states. Automatic bootstrap is deferred and is not enabled by this PR:
`SYSTEM_CATALOG_ENABLED` remains false, and no bootstrap command or startup hook runs
implicitly. A later reviewed step may let fresh development and preview Neon branches
run an explicit idempotent post-migration bootstrap command behind a separate operator
flag. Alembic and application startup never insert or publish catalog data. Production
bootstrap/publication remains approval
gated. All 285 items remain auditable even when an item is quarantined or rejected;
only accepted/public records appear in anonymous reads. Existing `verified` labels,
tiers, prose, and license descriptions are source claims, not passing run evidence or
legal approval. After import, Neon is authoritative; later TypeScript changes require
a new pinned manifest release and explicit import job rather than automatic sync.
**Consequences:** Existing catalog work can populate new Neon environments
reproducibly while the runtime and public API remain single-source. The cost is a
manifest generator, schema/version policy, per-item import outcomes, checksum and
idempotency tests, a 20-item proof, full 285-item reconciliation, and a deliberate UI
cutover. The TypeScript source files remain untouched by backend importer PRs. A failed
bootstrap cannot partially publish: accepted state is per reviewed item, and the job
report accounts for every manifest item. Reversal trigger: once the TypeScript surface
is retired, future bootstrap releases may be exported from Neon itself, but the pinned
285-record manifest and its import evidence remain immutable historical provenance.

**Implementation status.**
- *Slice A (landed, PR #73):* deterministic manifest generator + committed
  `services/api/catalog_bootstrap/manifest.json` (285 items, per-item + whole-manifest hashes).
- *Slice B (this change):* the local bootstrap connector. The importer is now provider-agnostic
  (`catalog_import_sources.ImportSource`); `catalog_bootstrap_manifest.BootstrapManifestSource`
  loads the pinned manifest, re-verifies the whole-manifest checksum and every per-item sha256
  fail-closed at construction, and submits the embedded bytes through the unchanged durable
  importer. `ImportProvider.CATALOG_BOOTSTRAP` (DB CHECK extended in migration 0019) records the
  distinct provenance. `catalog_admin bootstrap-import` runs it in-process (idempotent via a
  checksum-derived key); a full 285-item reconciliation test asserts DB-stored hashes equal the
  manifest's. Still inert to users: records stage `private`/`draft`, nothing publishes, and
  `SYSTEM_CATALOG_ENABLED` stays false. Bootstrap records stage with `execution_state=template_only`
  / framework version `unknown` (honest — the manifest is catalog metadata, not executed circuits);
  mapping the manifest's richer fields into the read model is Slice C's concern.
