# Runbook: the production database

## Where the database lives

**Cloud SQL for PostgreSQL 17, `majorana-core:us-west1:majorana-pg`**, since
2026-07-27. Before that it was Neon (`twilight-wildflower-01313590`,
aws-us-west-2), on the free plan.

| | |
|---|---|
| Instance | `majorana-pg`, us-west1, Enterprise edition, `db-g1-small` (shared core, 1.7 GB) |
| Database / role | `majorana` / `majorana_app` (owns every object, so Alembic can issue DDL) |
| Storage | 10 GB SSD, auto-increase on. The data is ~50 MB |
| Backups | daily 10:00 UTC, 7 retained. No HA replica |
| Public IP | assigned, but **zero authorized networks** — nothing reaches it by IP |
| Connections | `max_connections` 50 (see § Connection budget) |

## How each caller connects

There are exactly three routes in, and none of them is "the public IP".

**Cloud Run (api + worker)** — the Cloud SQL connector mounts a Unix socket into
the container. `--set-cloudsql-instances` is stated on both `gcloud run deploy`
commands in `deploy.yml`; a revision without it cannot reach the database at all,
so this is not a setting that degrades quietly. The runtime service account
(`639400385957-compute@`) holds `roles/cloudsql.client`.

```
DATABASE_URL = postgresql+psycopg://majorana_app:PASS@/majorana?host=/cloudsql/majorana-core:us-west1:majorana-pg
```

The empty host with the socket path in the query string is deliberate and is
what SQLAlchemy's psycopg dialect forwards as a `host=` connect argument.
`services/api/tests/test_database_configuration.py` pins that shape.

**GitHub Actions (`deploy.yml`'s migration step)** — the Cloud SQL Auth Proxy,
pinned by version and SHA-256, started before the migration and reachable on
127.0.0.1:5432. The deploy service account holds `roles/cloudsql.client`.
`DATABASE_URL_SECRET` holds that loopback URL.

**A human with `gcloud`** — authorize your address, do the work, remove it:

```bash
gcloud sql instances patch majorana-pg --project=majorana-core \
  --authorized-networks="$(curl -s https://checkip.amazonaws.com)/32"
# ... psql ...
gcloud sql instances patch majorana-pg --project=majorana-core --clear-authorized-networks
```

**Leave it cleared.** The instance holds every user's data and the only reason it
has a public IP at all is that private IP needs VPC peering that was not set up.

## Connection budget

`db-g1-small` allows 50. `db.py` sets `pool_size=5, max_overflow=5` explicitly —
10 per process, so two API instances plus one worker reach 30 and leave room for
a deploy's Alembic step, Postgres's superuser reservation and one operator.

SQLAlchemy's defaults (5 + 10) would let those same three processes reach 45 on
their own. If you raise `maxScale` on either service, do this arithmetic again;
`DB_POOL_SIZE` / `DB_MAX_OVERFLOW` are the knobs and both are read at startup.

## Why the move happened

Neon's free plan allows 5 GB of data transfer and 100 compute-hours a month. On
2026-07-27, seventeen days into the period, the project had used **5.03 GB** and
about 90 compute-hours, against a **47 MB** database. Neon suspends the compute
when either runs out — existing connections drop and new ones are refused.

Almost none of it was user traffic. `pg_stat_database` showed **2,334,042
committed transactions**, which is 1.5/second, which is exactly the three the
worker's 2-second poll loop opened on every cycle while the queue was idle. The
worker keeping a connection alive around the clock is also what stopped the
compute ever suspending, so the compute-hour allowance went the same way.

Two things follow, and both were done:

1. **The poll loop was the bug.** Two of those three transactions were sweeps
   that found nothing on essentially every cycle; they are now wall-clock gated
   (`Sweep` in the worker). This is a fix on any provider.
2. **An always-on worker and a per-second-billed serverless database are the
   wrong shape for each other.** No poll interval makes a scale-to-zero database
   scale to zero. A fixed-price always-on instance matches the workload, and
   Cloud SQL in us-west1 also puts the database in the same region as the
   services that read it — Neon has no GCP region, so every query had been
   crossing from AWS us-west-2.

Cloud SQL costs about **$27/month** (compute ~$25.55 + 10 GB SSD ~$1.70), fixed.
`db-f1-micro` would be about $11 but has ~25 connections and 0.6 GB of RAM.

## Migrating the data (what was actually done)

Kept here because the next move — a bigger tier, a different provider, a restore
into a scratch instance — is the same procedure.

```bash
# 1. Dump from the source over its DIRECT (unpooled) endpoint.
pg_dump "$SOURCE_URL" --no-owner --no-acl --format=plain --quote-all-identifiers -f dump.sql

# 2. Restore as the superuser: CREATE EXTENSION needs it.
psql "host=$IP dbname=majorana user=postgres sslmode=require" -v ON_ERROR_STOP=1 -f dump.sql

# 3. Hand every object to the application role, or Alembic cannot ALTER them.
psql ... -c 'GRANT "majorana_app" TO "postgres";' \
         -c 'REASSIGN OWNED BY "postgres" TO "majorana_app";' \
         -c 'ALTER SCHEMA "public" OWNER TO "majorana_app";' \
         -c 'ALTER DATABASE "majorana" OWNER TO "majorana_app";'
```

**Verify with more than row counts.** A restore that silently dropped a column
passes a row count. The check that was run compares, for all 30 tables: the
table list, every column name and type, the row count, and a digest of the
content (`md5` per row, sorted, hashed — order-independent). All 30 matched, as
did 84 indexes and 192 constraints.

Then confirm no writes landed on the old database during the cutover window
before you decommission it: the source's `max(runs.created_at)` must still
predate the dump.

## Rollback

Neon is untouched and still holds the pre-cutover data. To go back: add a
Secret Manager version to `DATABASE_URL` with the Neon **pooled** URL and to
`DATABASE_URL_SECRET` with the Neon **direct** URL, then redeploy both services.
Note the guard in `db.py` refuses a Neon URL in a deployed environment — that is
deliberate (a stale secret that still connects means two live databases), so a
genuine rollback has to remove it, which is exactly the amount of friction it
should have.

Anything written to Cloud SQL after the cutover would need copying across.

## CI and bench

Neither uses a hosted database any more. `ci.yml`'s `db` job and `bench.yml` run
a `postgres:17` service container — the same major version as production, which
it was not before (it was 16). CI used to cut a throwaway Neon branch for the
authz and pipeline-e2e suites "where a real pooled endpoint is the point"; there
is no pooled endpoint in production now, and both suites were checked against a
plain migrated Postgres 17 before that was removed.

`NEON_API_KEY` is no longer read by any workflow.

## Decommissioning Neon

Not done yet, deliberately — it is the rollback. When production has run on Cloud
SQL long enough to trust it, delete the Neon project
(`twilight-wildflower-01313590`) and the `NEON_API_KEY` repository secret, and
remove the Neon row from `docs/runbooks/secrets.md`.
