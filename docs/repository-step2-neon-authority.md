# Repository Step 2 — Neon connection and catalog authority

Date: 2026-07-18  
Branch: `feature/repository`  
State: implementation and temporary Neon validation complete; CODEOWNER review pending

## User outcome

This step creates a safe empty boundary for the future quantum catalog. Researchers do
not see a new catalog yet, and their personal circuits cannot be substituted into public
catalog reads. No bootstrap data was inserted.

## Implemented

- Alembic now requires `DATABASE_URL_DIRECT`; API and Worker retain pooled `DATABASE_URL`.
- CI uses Neon's direct output for migrations and pooled output for application tests.
- `system` is an additive workspace kind with a reversible, fail-safe migration.
- Three stable server-side IDs represent the catalog workspace, importer, and read-only
  public reader. Configuration is complete-or-fail and disabled by default.
- An explicit idempotent operator command provisions the two service users, system
  workspace, owner/viewer memberships, and verifies that it contains zero artifacts.
- Human authentication rejects reserved `system:` identities.
- The catalog repository checks the exact configured reader scope, system workspace,
  non-deleted state, and persisted viewer membership before any future data query.
- Low-cardinality connection, checkout, query-duration, and catalog-scope telemetry was added.

## Deferred deliberately

- catalog metadata schema and staging API (Step 3);
- 285-record bootstrap importer and data insertion (later steps);
- public catalog routes and UI;
- GitHub/Hugging Face exports;
- QPU execution or performance claims.

## Temporary Neon gate result

Branch: `step2-catalog-authority-20260718` (`br-tiny-water-a6u6minr`)

- pooled and direct connection shapes matched the same Postgres 17 database;
- starting Alembic revision: `0011`;
- migration sequence: `0011 → 0013 → 0012 → 0013` passed;
- authority provisioning ran twice against the pooled endpoint with the same result;
- system workspace: 1, with exactly importer/owner and public-reader/viewer memberships;
- reserved service identities matched configuration;
- system catalog artifacts: 0;
- Step 1 lease columns were present;
- live authz matrix: 7 collected, exit 0;
- pipeline DB behavior: 1 passed, 1 live-provider test skipped;
- `SYSTEM_CATALOG_ENABLED=false` throughout.

The live-provider pipeline test requires external LLM credentials and
`MAJORANA_RUN_LIVE_LLM=1`; it was deliberately not enabled because Step 2 does not
authorize paid/provider calls. Deployment remains blocked on CODEOWNER review.

## Required gate

CODEOWNER review remains required for the migration, shared contract, auth boundary,
and workflow changes. Keep the feature disabled and do not import catalog data.

## Local validation

- API, Worker, and contracts: 122 passed, 9 live-DB tests skipped;
- Ruff check/format: passed;
- import boundaries: 3 contracts kept, 0 broken;
- raw-query gate: clean;
- workflow YAML parsed successfully;
- existing TypeScript bootstrap validator: 285 records unchanged.

The normal `uv run` entry point is blocked only in this working copy because an
untracked `packages/py/baselines/` directory matches `packages/py/*` without a
`pyproject.toml`. Validation used the existing `.venv` and explicit package source
paths. A clean CI checkout does not contain that untracked directory. Live Neon
up→down→up was not run because connection credentials are an owner operation.
