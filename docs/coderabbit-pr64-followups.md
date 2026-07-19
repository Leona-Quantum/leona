# PR #64 CodeRabbit review disposition

Date: 2026-07-18  
Branch: `feature/repository`  
Scope: PR #64 review fixes only; no Step 5b network importer or public catalog

## Fixed in this branch

| Finding | Resolution | Commit |
|---|---|---|
| New content could retain `pending_review` | Reset to `draft`; quarantine remains a legal hold | `117e878` |
| Unknown license could be approved without SPDX ID | Require a concrete resolved ID | `117e878` |
| An idempotency key could name a different request or race | Compare request fields; recover the unique race | `cc334dc` |
| Hanging heartbeat I/O could outlive the lease | Bound I/O by the remaining lease budget | `f38c0c4` |
| CI seed used a direct application URL and bypass | Use pooled seed URL and enforce pooling in CI | `a3681f4` |
| Artifact review omitted the human actor | Append an audit row in the review transaction | `bf60cd2` |
| Concurrent version allocation could choose one sequence | Lock the artifact row before allocation | `8bc2a59` |
| Dead-letter callback could retry forever | Abandon terminally after five failed deliveries | `2dfe5d8` |
| Dead-letter batch could delay normal claims | Run a normal job first, then one callback | `2dfe5d8` |
| DB boundary docs named only FastAPI | State API + Worker processes, one repository layer | `fb1e154` |

## Intentional scoped exceptions

- `repos/system.py` is the single no-`Scope` repository surface. It contains only
  identity bootstrap that must run before a Scope exists and workspace-neutral durable
  job control. It is not a tenant-data request path.
- `ImportJob` has no `workspace_id` because one server-configured system catalog exists
  per database. Human/importer entry points validate that fixed catalog Scope first;
  the unscoped idempotency lookup is Worker-internal. Multiple catalogs would require a
  new workspace FK, scoped queries, migration, and leakage matrix before support.

## Formerly deferred reviewed slices

The three transaction/schema proposals were implemented in Phase 3 after ADR-0020 and
ADR-0021 fixed their safety and availability trade-offs. They remain CODEOWNER-gated
and feature-disabled until the live CI database checks pass.

## Validation performed

- Python tests without a database: `196 passed, 27 skipped`
- Ruff lint and format checks: passed (`159 files already formatted`)
- Import boundaries: `3 kept, 0 broken`
- Raw-query policy, generated OpenAPI, workflow YAML, and whitespace checks: passed
- TypeScript lint, typecheck, and tests: passed (`5` Turbo tasks; `15` web tests)
- Atlas dataset validation: passed (`285` entries)

Live Postgres/Neon integration tests were not run in this review-fix session. No branch
was pushed and no database, credential, or public-service state was changed.

## Second review — Phase 1 disposition

| Finding | Resolution | Commit |
|---|---|---|
| Bootstrap wording implied automatic import | State that bootstrap is deferred, disabled, and operator-gated | `2ee903a` |
| Direct database URL was described as non-secret | Apply the same storage, redaction, and rotation policy as the pooled credential | `2ee903a` |
| DNS rebinding defense allowed an ambiguous second lookup | Require connection through the validated A/AAAA address or equivalent pinning | `2ee903a` |
| ADR/conflict maps and phase gates were stale | Include ADR-0019 and distinguish historical fallback validation | `2ee903a` |
| API-only database wording excluded the Worker | Name API + Worker as the only DB processes using one repository layer | `2ee903a` |
| Failed SQL could leave a pooled query timer behind | Clear one timer from SQLAlchemy's `handle_error` event | `2db5ad2` |
| Repeating an advertised-idempotent tag raised a conflict | Use atomic PostgreSQL `ON CONFLICT DO NOTHING` | `8e7105e` |
| Tests duplicated or locally imported contract constants | Reuse the exported terminal-state/count constants | `3a6a432` |

Phase 1 validation used the existing `.venv` because `uv run` remains blocked by the
pre-existing `packages/py/baselines` workspace member without a `pyproject.toml`:

- all DB-free Python tests: `310 passed, 29 skipped`;
- Ruff check/format: passed (`159 files already formatted`);
- import boundaries: `3 kept, 0 broken`;
- raw-query and generated OpenAPI checks: passed.

The repeated-tag live Postgres test was added but not run locally; it remains part of
the CI database job. Phase 1 did not connect to Neon or modify migrations, credentials,
or public-service state.

## Second review — Phase 2 disposition

| Finding | Resolution | Commit |
|---|---|---|
| Multiple Workers could invoke one Dead Letter callback | Reserve one terminal row with `FOR UPDATE SKIP LOCKED` and a dedicated fenced delivery token before callback I/O | `e73ac1c`, `10c6173` |

The reservation is committed before callback execution, expires after a bounded lease,
and is required by the success/retry/abandon update. A crashed Worker therefore cannot
hold delivery forever, and an old token cannot mark a replacement Worker's delivery.
Migration `0017` is additive and reversible; it does not edit frozen migration `0012`
or overload the running-job lease columns.

Phase 2 DB-free validation: `313 passed, 31 skipped`; Ruff check/format passed
over `162` files; Alembic reports a single `0017` head. The two new Postgres
contention/reclaim tests were collected and skipped without `DATABASE_URL`; no local
or Neon database was changed in this session.

## Second review — Phase 3 disposition

| Finding | Resolution | Commit |
|---|---|---|
| License history was append-only only by convention | Migration `0018` rejects UPDATE/DELETE with a PostgreSQL trigger; corrections insert a superseding row | `ddf6856` |
| Matching tokens could finish or retry after expiry | Require `lease_expires_at > now()` in every terminal/retry predicate and check rowcount | `05d7e38` |
| Dead Letter events and FAILED status committed separately | Lock the scoped Run and commit both deterministic events plus status once | `ccbfe30` |
| New live integrity tests were not in the DB job | Run trigger, lease, reservation, and terminal-race tests on the temporary Neon CI branch | `92f6832` |

ADR-0020 and ADR-0021 record the database-history and fencing/atomicity decisions in
`c74bd31`. Phase 3 DB-free validation: `318 passed, 35 skipped`; Ruff check/format
passed over `166` files; import boundaries are `3 kept, 0 broken`; raw-query and
generated OpenAPI checks passed; Alembic reports one `0018` head; workflow YAML parsed.
The live trigger/contention/rollback tests were added to CI but were not run locally.
No local or Neon database, credential, or public-service state was changed.

## Phase 4 — full gates and review closure

The complete local gate set passed before push: `318 passed, 35 skipped`; Ruff lint and
format; all three import contracts; raw-query policy; generated OpenAPI; one Alembic
`0018` head; workflow YAML; the 285-entry Atlas dataset; and all TypeScript lint,
typecheck, and test tasks (`15` web tests).

The first remote run (`29655265612`) passed migrations, authz, and pipeline E2E but
exposed test-state coupling in the new shared temporary-Neon integrity step. Commit
`ed26254` isolates Dead Letter fixtures without weakening production claim or database
constraints. The replacement run (`29655425180`) passed every job, including migration
up→down→up, repository concurrency/integrity tests, and temporary branch cleanup.

CodeRabbit then identified one remaining representational risk: a caller could supply a
`run.finished` payload inconsistent with the FAILED row transition. Commit `5cd27cc`
removes that input and constructs `{"status": "failed"}` inside the repository's atomic
terminal operation. Targeted API/Worker tests pass (`13 passed, 2 skipped` without a
database), including an assertion on the repository-generated terminal payload. The
final pushed head must pass the same required CI and review gates before merge.
