# ADR-0019: The pinned 285-record snapshot bootstraps Neon through the importer

**Date:** 2026-07-18 · **Status:** accepted (user-requested)
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
evidence states. Fresh development and preview Neon branches run an explicit idempotent
post-migration bootstrap command by default. Alembic and application startup never
insert or publish catalog data. Production bootstrap/publication remains approval
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
