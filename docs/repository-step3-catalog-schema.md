# Repository Step 3 — catalog classification and private staging

Date: 2026-07-18
Branch: `feature/repository`
State: implementation and local up→down→up validation complete; CODEOWNER review pending

## User outcome

This step gives the future catalog a typed classification/review/publication schema
and a private staging path an authorized importer service can call. No researcher-facing
surface changes: nothing is public, nothing is queryable by normal users, and no route
was added.

## Implemented

- Migration `0014`: nullable classification columns (`artifact_kind`, `execution_state`,
  `review_state`, `publication_state`) on `artifacts`; nullable hash/provenance columns
  (`metadata_schema_version`, `authoritative_framework(_version)`, `source_language`,
  `source_blob_sha256`, `normalized_source_hash`, `semantic_fingerprint(_algorithm)`,
  `toolchain_digest`) on `artifact_versions`. All additive; existing rows stay NULL.
- CHECK constraints enforce the closed enum values from
  `docs/quantum-repository-platform-plan.md` §5.1 (NULL remains valid).
- A global `UNIQUE` constraint on `artifact_versions.normalized_source_hash` rejects
  exact duplicates across the whole table. Postgres excludes NULL from uniqueness, so
  every non-catalog version (which never populates this column) is unaffected.
- `catalog_hashing.py`: `hash_source_blob` (exact bytes) and `hash_normalized_source`
  (caller-normalized text) — plain sha256 hex, kept distinct per the plan's "hash
  meanings must never be overloaded" rule.
- `CatalogAuthority.is_importer_scope`: exact-identity check mirroring
  `is_public_scope`, so staging is gated to the one configured importer principal.
- `repos/catalog.py`: `stage_artifact` and `stage_artifact_version`. Both require the
  importer scope and the persisted owner membership on the system workspace (same
  binding pattern as the Step 2 reader path). `review_state`/`publication_state` are
  **not** caller parameters — every staged artifact is hard-coded
  `draft`/`private`, so a compromised or buggy importer cannot publish directly.
  Hashes are computed from the raw bytes/normalized text the function is given, never
  trusted as a caller-supplied digest, so a stored hash always matches stored content.
- Duplicate rejection is atomic: a `normalized_source_hash` collision raises
  `DuplicateSourceError` from the real `UNIQUE` constraint violation, so two concurrent
  importers racing the same source cannot both win.

## Deferred deliberately (later steps)

- provenance/rights/citation tables, append-only license decisions (Step 4);
- durable importer jobs, external fetcher, SSRF/quarantine hardening (Step 5);
- any public route, review/publish transition, or web surface (Step 6+);
- 285-record bootstrap import.

## Local validation (no Neon touched)

A throwaway local Postgres 14 cluster (UTF8, `initdb` in the session scratch directory,
stopped and deleted after) was used instead of a new Neon branch:

- `alembic upgrade head` reached `0014` cleanly from `0013`;
- full `downgrade base` → `upgrade head` round trip passed;
- downgrade fail-closed guard verified directly: inserting a `review_state='draft'` row
  and running `alembic downgrade 0013` raised
  `cannot downgrade 0014 while staged catalog artifacts exist` (row removed afterward);
- live-DB suite (`test_catalog_staging_live.py`, gated by `requires_db` like the
  existing authz/pipeline suites) passed twice in a row against the same database,
  proving `stage_artifact`/`stage_artifact_version` are safe to re-run:
  - non-public defaults persisted (`review_state=draft`, `publication_state=private`);
  - a second version with the same `normalized_source_hash` on a **different** artifact
    and **different** raw bytes was rejected — proves the constraint is global, not
    per-artifact;
  - a normal authenticated user's scope was rejected from staging with no query issued.
- full local suite: 149 passed / 1 skipped (DB present, live-LLM test skipped); 138
  passed / 12 skipped (no `DATABASE_URL`, matching a PR without a Neon branch);
- Ruff check/format: passed; import-linter: 3 kept, 0 broken; raw-query gate: clean;
- `python -m majorana_contracts.export --check`: `openapi.json` unchanged — Step 3 adds
  no route or response-model field, so no TypeScript regeneration was needed.

## Neon gate

A real Neon branch (`step3-4-catalog-provenance-20260718`) confirmed the same results
against Postgres 17 — see `docs/repository-step3-4-neon-gate.md`.

## Required gate

CODEOWNER review remains required before Step 4 for the migration, contracts, and
repository-layer changes. `SYSTEM_CATALOG_ENABLED` stays `false`; no public catalog data
exists.
