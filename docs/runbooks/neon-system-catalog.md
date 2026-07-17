# Neon system catalog authority — Step 2 operator runbook

Purpose: validate the database connection split and create only the empty,
server-owned catalog boundary. This procedure must not import the 285 bootstrap
records or publish a public endpoint.

## Safety invariants

- Use a temporary Neon branch first. Never test a new migration on the production branch.
- `DATABASE_URL` is the pooled URL and is used by FastAPI, Worker, tests, and the
  provisioning command.
- `DATABASE_URL_DIRECT` is the direct URL and is used only by Alembic/approved admin work.
- Keep both URLs out of shell history, screenshots, chat, logs, Vercel, and client-side variables.
- Keep `SYSTEM_CATALOG_ENABLED=false` until migration, provisioning, zero-data check,
  authz tests, and review all pass.
- Stop on any unexpected row count, identity mismatch, migration error, or scope-test failure.

## Owner operations in Neon

1. In the Neon project `majorana`, create a temporary branch from the current development
   parent. Name it clearly, for example `step2-catalog-authority-YYYYMMDD`, and configure
   automatic expiry if the console offers it.
2. In the branch connection dialog, obtain both connection strings for the same database
   and role:
   - pooled connection (hostname contains `-pooler`) → `DATABASE_URL`;
   - direct connection (hostname does not contain `-pooler`) → `DATABASE_URL_DIRECT`.
3. Store the pooled production value in GCP Secret Manager for API/Worker only after the
   temporary branch passes. Store the direct value only in the approved migration
   environment. Do not add either value to Git or Vercel.
4. Generate three new UUIDs locally. They are stable identifiers, not passwords:

   ```bash
   uuidgen
   uuidgen
   uuidgen
   ```

   Assign them once as `SYSTEM_CATALOG_WORKSPACE_ID`,
   `SYSTEM_CATALOG_IMPORTER_USER_ID`, and
   `SYSTEM_CATALOG_PUBLIC_READER_USER_ID`. Preserve the same values for API and Worker
   configuration. The three values must be different.
5. Set `SYSTEM_CATALOG_ENABLED=false`. The IDs may be configured while the feature stays off.

## Migration and empty authority gate

Drain or stop Worker instances before production migration. On the temporary branch,
from the repository root, load connection strings without placing their values in shell history:

```zsh
read -rs "DATABASE_URL?Pooled Neon URL: " && export DATABASE_URL && echo
read -rs "DATABASE_URL_DIRECT?Direct Neon URL: " && export DATABASE_URL_DIRECT && echo
export SYSTEM_CATALOG_ENABLED=false
export SYSTEM_CATALOG_WORKSPACE_ID="<first UUID>"
export SYSTEM_CATALOG_IMPORTER_USER_ID="<second UUID>"
export SYSTEM_CATALOG_PUBLIC_READER_USER_ID="<third UUID>"
```

Then run:

```bash
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api alembic -c db/alembic.ini downgrade 0012
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api python -m majorana_api.catalog_admin provision
```

The first three commands use `DATABASE_URL_DIRECT`; the provisioning command uses
`DATABASE_URL`. Provisioning is idempotent and must finish with `artifacts=0`. A second
provisioning run should report the same workspace and still show zero artifacts.

Then run the live gates with the pooled URL:

```bash
uv run pytest services/api/tests/authz -q
uv run --all-extras pytest services/api/tests/test_pipeline_e2e.py -q
```

On this workstation, an untracked local `packages/py/baselines/` directory currently
matches the uv workspace glob but has no `pyproject.toml`, so `uv run` stops before
executing. Do not delete or modify that directory as part of Step 2. Until its owner
resolves it, use the existing `.venv` as follows, or run the commands in a clean checkout/CI:

```bash
export PYTHONPATH="services/api/src:services/worker/src:packages/py/contracts/src:packages/py/openqasm/src:packages/py/frameworks/src:packages/py/verification/src:packages/py/sandbox/src:packages/py/agent/src:packages/py/llm/src"
.venv/bin/alembic -c db/alembic.ini upgrade head
.venv/bin/alembic -c db/alembic.ini downgrade 0012
.venv/bin/alembic -c db/alembic.ini upgrade head
.venv/bin/python -m majorana_api.catalog_admin provision
.venv/bin/pytest services/api/tests/authz -q
.venv/bin/pytest services/api/tests/test_pipeline_e2e.py -q
```

This is a local workspace discovery issue, not a Neon failure.

Do not turn the feature flag on merely because provisioning succeeded. Step 2 adds no
catalog data endpoint; leaving it off is the correct steady state until later steps.

## Failure and rollback

- If migration fails: stop, retain the temporary branch for diagnosis, and do not retry
  against production.
- If the authority command reports an identity mismatch or nonzero artifacts: stop. Do
  not delete or alter rows until the conflicting ownership is understood.
- If live tests fail: keep `SYSTEM_CATALOG_ENABLED=false` and do not promote the branch.
- For a clean temporary branch, deletion of the entire branch is the safest rollback.
- Migration 0013 refuses downgrade while a system workspace exists. This prevents an
  operator from silently orphaning or reclassifying catalog data. Deprovisioning must be
  a separate reviewed action after proving the workspace is empty.

Record the branch name, Alembic revision, up→down→up result, test counts, and zero-artifact
result in the PR. Record no connection strings or credentials.
