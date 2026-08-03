# Runbook: the system catalog (provision, import, attest, publish)

The public `/repository` corpus is not a fixture and not a migration. It is 283 records
staged, reviewed and published through the durable importer by four CLI commands, and
this file is the only written record of how to run them.

Supersedes `neon-system-catalog.md`, archived at
`docs/archive/repository-migration-2026-07/`. That file's temporary-Neon-branch procedure
is dead — the database has been **Cloud SQL for PostgreSQL 17** since 2026-07-27
(ADR-0024) and has no branching. Everything below is the half that is still live,
checked against the code on 2026-08-04.

Decisions this implements: **ADR-0016** (system catalog authority), **ADR-0019** (pinned
bootstrap manifest), **ADR-0020** (append-only license history).

## Safety invariants

- `DATABASE_URL` is what the API, the worker, the tests and every command here read.
  `DATABASE_URL_DIRECT` is Alembic's, and only Alembic's.
- Migrate against a local `postgres:17` before you migrate production. `runbooks/auth-dev.md`
  has the one-container setup; CI's `db` job runs the same image.
- Keep both URLs out of shell history, screenshots, chat, logs, Vercel, and any
  client-side variable.
- Stop on any unexpected row count, identity mismatch, migration error, or scope-test
  failure. The counts below are assertions, not estimates.
- Drain or stop worker instances before a production migration.

## The three identity UUIDs

Generated once, then never changed. They are stable identifiers, not passwords, and
they are plain configuration on both Cloud Run services — a client never supplies them.

```bash
uuidgen   # SYSTEM_CATALOG_WORKSPACE_ID
uuidgen   # SYSTEM_CATALOG_IMPORTER_USER_ID
uuidgen   # SYSTEM_CATALOG_PUBLIC_READER_USER_ID
```

All three must differ, and API and worker must carry identical values —
`catalog_authority.py` refuses to construct an authority with any of them missing when
`SYSTEM_CATALOG_ENABLED` is on. The worker needs them too: it reads `CatalogAuthority`
config for `catalog.import` jobs (`runbooks/deploys.md § Deploy the worker`).

## Migrate and provision

```bash
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api alembic -c db/alembic.ini downgrade 0012
uv run --package majorana-api alembic -c db/alembic.ini upgrade head
uv run --package majorana-api python -m majorana_api.catalog_admin provision
```

The three Alembic commands read `DATABASE_URL_DIRECT`; `provision` reads `DATABASE_URL`.
Run the up→down→up against local Postgres, not production — it is the reversibility
check, not a deploy step.

**Provisioning is idempotent and must finish with `artifacts=0`.** A second run reports
the same workspace and still zero artifacts. It is the only command here that works with
the feature flag off: it calls `require_configured()` — which asks whether the three IDs
are set, not whether the feature is on — and never enters a scoped repository call.

Do not turn `SYSTEM_CATALOG_ENABLED` on merely because provisioning succeeded.

## The `SYSTEM_CATALOG_ENABLED` trap

**The other three commands need `SYSTEM_CATALOG_ENABLED=true` in their own shell.**

`bootstrap-import`, `attest-bootstrap` and `publish-bootstrap` all go through the catalog
scope checks, and `get_importer_workspace` (`repos/catalog.py`) opens with
`if not authority.enabled or not authority.is_importer_scope(scope)`. With the flag off
they fail immediately on the first clause with `AuthzError: invalid catalog importer
scope` — which reads like a permissions problem and is not one.

```bash
export SYSTEM_CATALOG_ENABLED=true    # this shell only
```

Setting it for a local admin command exposes nothing: no server reads this process's
environment. It is a separate decision from what the deployed services carry.

## Import, attest, publish

Only after `provision` reports `artifacts=0` and the live gates pass. All three read
`DATABASE_URL` and are idempotent — a partial run is resumed by re-running it.

```bash
uv run --package majorana-api python -m majorana_api.catalog_admin bootstrap-import
uv run --package majorana-api python -m majorana_api.catalog_admin attest-bootstrap  --attested-by "<your user id>"
uv run --package majorana-api python -m majorana_api.catalog_admin publish-bootstrap --attested-by "<your user id>"
```

**`bootstrap-import`** must report `accepted=283 rejected=0 dead=0`. Anything else means
the pinned manifest and the database disagree — stop rather than re-running. It submits
`services/api/catalog_bootstrap/manifest.json` through the unchanged durable importer as
`ImportProvider.CATALOG_BOOTSTRAP`, re-verifying the whole-manifest checksum and every
per-item sha256 fail-closed at construction. Records stage with
`execution_state=template_only` and framework version `unknown` — honest, because the
manifest is catalog metadata, not executed circuits.

**`--attested-by` is the owner's own user id** — a real, already-provisioned human
account. It cannot be a service identity: `attest-bootstrap` grants that account ADMIN on
the catalog workspace and then uses it as the reviewer, and both the CLI and the
repository layer refuse the importer and public-reader identities. That separation is the
point of ADR-0016 — the importer stages content, a named person approves it. Look the id
up (`select id from users where email = '<you>'`); it is not a secret.

**`attest-bootstrap`** applies the committed attestation policy
(`services/api/catalog_bootstrap/attestation-policy.json`) to the staged corpus, writing a
provenance row, a declared license carrying the policy's SPDX id, an approved reviewer
decision, and review acceptance for each covered record. The policy's statement and
checksum are recorded on every audited row, so a published record traces back to the exact
sentence that was signed. **It publishes nothing.** Expect `attested=283 excluded=0`.

**The policy is fail-closed, in both directions.** A record it neither includes nor
explicitly excludes aborts the run — if you regenerate the manifest and a record appears
whose `source.kind` the policy never considered, that abort is correct. Extend the policy
deliberately; do not loosen it. An `excluded_identities` entry naming a record the
manifest no longer contains also aborts. The corpus once carried two community submissions
the first-party CC-BY-4.0 grant could not reach; they were removed from the source corpus
outright (owner decision, 2026-07-19), so the policy now carries no exclusions and the
grant covers every record that exists.

**`publish-bootstrap`** re-evaluates readiness per record and refuses any that is missing
a binding, so an unattested record cannot ride along — it is reported as blocked and left
private. Expect `published=283 blocked=0`.

Changing the license, or attesting records the current policy excludes, is a policy-file
edit plus a normal review. Never a flag and never a command-line override.

## Live gates

```bash
uv run pytest services/api/tests/authz -q
uv run --all-extras pytest services/api/tests/test_pipeline_e2e.py -q
```

If `uv run` stops before executing because an untracked directory under `packages/py/`
matches the uv workspace glob without a `pyproject.toml`, that is a local workspace
discovery problem, not a database failure. Run in a clean checkout or CI, or fall back to
the existing `.venv` with `PYTHONPATH` set across the `packages/py/*/src` and
`services/*/src` trees.

## Updating the published corpus

The catalog is authoritative once published. **A change to
`apps/web/lib/repository/entries-*.ts` does not reach the public site** while
`MAJORANA_PUBLIC_CATALOG_API` is on — see `deploys.md § The public catalog flag`. The
loop is: edit the entries → regenerate the manifest
(`node scripts/generate-catalog-bootstrap-manifest.mjs`) → `bootstrap-import` →
`attest-bootstrap` → `publish-bootstrap`. There is no automatic sync, by design
(ADR-0019); a new pinned manifest release plus an explicit import job is the only path.

## Failure and rollback

- Migration fails → stop. Do not retry against production. Diagnose against local
  Postgres.
- `provision` reports an identity mismatch or nonzero artifacts → stop. Do not delete or
  alter rows until the conflicting ownership is understood.
- Live tests fail → keep `SYSTEM_CATALOG_ENABLED=false` on the deployed services.
- **Migration 0013 refuses downgrade while a system workspace exists.** This prevents an
  operator from silently orphaning or reclassifying catalog data. Deprovisioning is a
  separate reviewed action after proving the workspace is empty.
- **License history cannot be repaired in place.** Migration 0018 installs a
  `BEFORE UPDATE OR DELETE` trigger on `license_assertions` (ADR-0020); a correction is a
  new row linked through `supersedes_assertion_id`. Emergency alteration requires an
  explicit privileged database action and an audit, not an application transaction.

Record the Alembic revision, the up→down→up result, test counts and the four command
counts in the PR. Record no connection strings or credentials.
