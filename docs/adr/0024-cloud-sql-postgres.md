# ADR-0024: Cloud SQL for PostgreSQL 17 (supersedes Neon)

**Date:** 2026-07-27 · **Status:** implemented (in production since 2026-07-27)
**Context:** ADR-0003 chose Neon for $0-idle serverless Postgres. On 2026-07-27,
seventeen days into the billing period, the free plan's 5 GB transfer allowance was
exhausted (5.03 GB) and about 90 of 100 compute-hours were spent — against a 47 MB
database with almost no user traffic. `pg_stat_database` showed 2,334,042 committed
transactions, which is the worker's 2-second poll loop opening three transactions per
cycle against an idle queue. Neon suspends the compute when either allowance runs out,
dropping live connections. The poll loop was fixed independently (sweeps are now
wall-clock gated), but no poll interval makes a scale-to-zero database scale to zero
while an always-on worker holds a connection. Neon also has no GCP region, so every
query crossed from AWS us-west-2 to the Cloud Run services in us-west1.
**Decision:** Move the production database to **Cloud SQL for PostgreSQL 17**,
instance `majorana-core:us-west1:majorana-pg` (`db-g1-small`, database `majorana`,
role `majorana_app`). Cloud Run reaches it over the Cloud SQL connector's Unix socket
— `--set-cloudsql-instances` is stated on both `gcloud run deploy` commands in
`.github/workflows/deploy.yml`, and `DATABASE_URL` is a hostless socket URL. The
`deploy.yml` migration step reaches it through the Cloud SQL Auth Proxy, pinned by
version and SHA-256, on 127.0.0.1:5432. The instance keeps a public IP with **zero
authorized networks**; a human authorizes their own address, works, and clears it.
CI and bench run a `postgres:17` service container rather than a hosted database, so
the major version now matches production (it was 16). Alembic keeps the single
migration history unchanged — this is a move between Postgres deployments, not a
schema decision. Neon (`twilight-wildflower-01313590`) is retained, not deleted, as
the rollback path.
**Consequences:** Buys a fixed ~$27/month bill instead of an allowance that can
suspend the database, a database in the same region as its callers, and a connection
ceiling that can be reasoned about — `max_connections` 50, with every fleet term
except the API's own pool stated once in `infra/fleet.env` and asserted by
`services/api/tests/test_database_configuration.py`. Costs: no scale-to-zero, no
branch-per-PR (CI uses a container instead), and a hard connection budget that makes
worker count a deploy-arithmetic question rather than a free dial — a fourth worker
does not fit, and CI fails rather than production. `db.py` refuses a Neon URL in a
deployed environment on purpose, so a real rollback has to remove that guard.
Decommissioning Neon and deleting `NEON_API_KEY` is a later, deliberate action.
Reversal trigger: a workload whose idle cost dominates again, or a managed-Postgres
need Cloud SQL cannot serve; the migration procedure is recorded in
`docs/runbooks/database.md § Migrating the data` and is the same either direction.

Operational detail — connection budget, the three routes in, the dump/restore
procedure and the rollback checklist — lives in `docs/runbooks/database.md`. The
deploy wiring lives in `.github/workflows/deploy.yml` and `docs/runbooks/deploys.md`.
This ADR records only the decision; neither document is a substitute for it, and
ADR-0003 remains readable as the choice this one reverses.
