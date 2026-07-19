# Repository Step 5a — Neon gate result

Date: 2026-07-18
Branch: `feature/repository` (commit `71398b4`)
Temporary Neon branch: `step5a-catalog-import-20260718`, created by the owner from
`main` per `docs/runbooks/neon-system-catalog.md`. Not reused from Steps 3/4's gate
branch — each gate slice gets its own disposable branch.

## Purpose

Local throwaway-Postgres-14 validation (recorded in
`docs/repository-step5a-import-skeleton.md`) proved migration `0016` and the Step 5a
import-pipeline logic on standard Postgres semantics, including the two rollback/state
bugs found and fixed during that pass. This gate re-runs the same checks against real
Neon (Postgres 17, pooled/direct endpoints, actual network latency) before requesting
CODEOWNER review.

## Result

- starting Alembic revision on the fresh branch: `0011` (matches `main`'s state — `main`
  itself has none of the catalog migrations yet, confirmed separately this session);
- `alembic upgrade head`: `0011 → 0016`, exit 0, ~11s;
- full `downgrade base → upgrade head` round trip: exit 0 both directions (downgrade
  19s, upgrade 17s — well inside the CI B-D3 60s budget);
- `db/seeds/seed.py`: exit 0 (2 users, 2 workspaces, 20 artifacts, 36 artifact_versions,
  200 runs, 1000 run_events — identical counts to the Step 3/4 gate run);
- full suite (`services/api/tests services/worker packages/py/contracts`): 209 passed /
  1 skipped (live-LLM test correctly not run — no `MAJORANA_RUN_LIVE_LLM`, no paid
  provider call made) — same counts as the local run;
- the three catalog live suites (Step 3's `test_catalog_staging_live.py`, Step 4's
  `test_catalog_provenance_live.py`, Step 5a's `test_catalog_import_live.py`) re-run
  together a second time **without truncating**: 16 passed again, proving
  `create_import_job`/`process_import_batch` are safe to re-run against durable state
  they didn't create in this pass, not just against a suite-local database;
- downgrade fail-closed guard verified against real staged data (26 `import_items`
  rows from the suite runs above): `alembic downgrade 0015` raised
  `cannot downgrade 0016 while import job/item rows exist`, branch left at `0016`;
- `SYSTEM_CATALOG_ENABLED` was kept `false` throughout; no `SYSTEM_CATALOG_ENABLED=true`
  code path was exercised; no data was staged to `main` or any other production branch.

## Notes for future gate runs

- Confirmed distinct from `main` before running anything: read-only inspection of
  `main` earlier this session found it at Alembic revision `0011` with none of the
  catalog migrations or tables — the branch used here started at the same `0011` (as
  expected for a fresh branch cut from `main`) and only this branch was ever migrated
  or written to.
- Same deterministic system-catalog-authority UUID convention as Steps 2-4
  (`uuid5` of the fixed namespace constant, labels `"workspace"`/`"importer"`/
  `"public-reader"`) — `test_catalog_import_live.py` reuses it, so all three live
  suites resolve to the same singleton authority row instead of colliding on
  `users.workos_user_id`.
- No secret connection strings were printed, logged, or committed at any point;
  `.env.local` stayed untracked (permission 600, gitignored) and was only `source`d in
  bash, never `cat`.

## Required next step

Step 5b scoping and ordinary implementation may begin without a separate CODEOWNER
approval (real network fetcher and SSRF hardening — see
`docs/quantum-repository-platform-plan.md` §14). Existing CODEOWNERS rules remain in
force for blast-radius files. Delete the temporary Neon branch
`step5a-catalog-import-20260718` only as an explicit owner action.
