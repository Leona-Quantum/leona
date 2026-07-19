# Repository Steps 3-4 — Neon gate result

Date: 2026-07-18
Branch: `feature/repository` (commits `66a40ec`, `39c80c9`)
Temporary Neon branch: `step3-4-catalog-provenance-20260718` (project `twilight-wildflower-01313590`,
same project as Step 2), created by the owner from the current development branch per
`docs/runbooks/neon-system-catalog.md`.

## Purpose

Local throwaway-Postgres-14 validation (recorded in
`docs/repository-step3-catalog-schema.md` and `docs/repository-step4-provenance-rights.md`)
proved migrations `0014`-`0015` and the Step 3/4 repository-layer logic on standard
Postgres semantics. This gate re-runs the same checks against real Neon (Postgres 17,
pooled/direct endpoints, actual network latency) before requesting CODEOWNER review.

## Result

- starting Alembic revision on the fresh branch: `0011` (matches the parent's state);
- `alembic upgrade head`: `0011 → 0015`, exit 0;
- full `downgrade base → upgrade head` round trip: exit 0 both directions
  (downgrade 31s, upgrade 36s — well inside the CI B-D3 60s budget);
- `db/seeds/seed.py`: exit 0 (2 users, 2 workspaces, 20 artifacts, 36 artifact_versions,
  200 runs, 1000 run_events);
- catalog authority provisioning (`majorana_api.catalog_admin provision`) ran twice
  against the pooled endpoint with the deterministic UUIDs the live pytest suites use;
  both runs reported the same workspace with 0 artifacts — idempotent;
- live authz matrix (`services/api/tests/authz`): 7 passed;
- Step 3 live suite (`test_catalog_staging_live.py`): 3 passed — non-public defaults,
  global duplicate rejection, normal-user rejection;
- Step 4 live suite (`test_catalog_provenance_live.py`): 7 passed — provenance/rights
  hash round-trip, automatic quarantine → reviewer decision → accepted, stale-evidence
  reset on a new version, importer-cannot-review and reviewer-cannot-stage separation,
  duplicate rejection still holds with provenance data present, citation/tag persistence;
- pipeline e2e (`test_pipeline_e2e.py`): 1 passed (DB-only behavior), 1 skipped (live-LLM
  test correctly not run — no `MAJORANA_RUN_LIVE_LLM`, no paid provider call made);
- `SYSTEM_CATALOG_ENABLED` was kept `false` throughout; no `SYSTEM_CATALOG_ENABLED=true`
  code path was exercised.

## Notes for future gate runs

- The system catalog authority's service-identity `workos_user_id` values
  (`system:catalog-importer`, `system:catalog-public-reader`) are global fixed constants
  (`repos/system.py`). Only one such identity pair can exist per database. The
  provisioning idempotency check above intentionally used the exact deterministic UUIDs
  the live pytest fixtures also use (`uuid5` of a fixed namespace constant defined in
  `test_catalog_staging_live.py`/`test_catalog_provenance_live.py`), so the manual CLI
  check and the pytest suites resolved to the same rows instead of colliding.
- No secret connection strings were printed, logged, or committed at any point;
  `.env.local` stayed untracked (permission 600, gitignored) and was only `source`d in
  bash, never `cat`.

## Required next step

CODEOWNER review remains required before Step 5. After review evidence is captured,
delete the temporary Neon branch `step3-4-catalog-provenance-20260718` (owner action).
