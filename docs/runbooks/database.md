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
| Connections | `max_connections` 50; fleet worst case 44 during a deploy (see § Connection budget) |

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

`db-g1-small` allows 50 and reserves 3 for superusers.

| Term | Value | Where it is stated |
|---|---|---|
| API instances | 2 | `--max-instances 2` on the api deploy; `API_MAX_INSTANCES` |
| API pool, per instance | 5 + 5 | `DEFAULT_POOL_SIZE` / `DEFAULT_MAX_OVERFLOW` in `db.py` |
| Worker instances | **3** | `--min-instances 3 --max-instances 3`; `WORKER_INSTANCES` |
| Worker pool, per instance | 2 + 2 | `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` on the worker deploy; `WORKER_POOL_SIZE` |
| Fleet at rest | 32 | `fleet_peak_connections(during_worker_rollout=False)` |
| **Fleet during a deploy** | **44** | `fleet_peak_connections()` — both worker revisions hold their minimum |
| Superuser reserved | 3 | Postgres |
| Alembic + one operator | 2 | `OPERATIONAL_HEADROOM` |
| **Budget** | **45** | |

`services/api/tests/test_database_configuration.py` asserts the sum, asserts that
`deploy.yml` still deploys the number `db.py` computed against, and pins the
boundary: **three workers fit, four do not.** Do not re-derive this by hand —
change a constant and run that file.

**The binding constraint is the deploy, not the workload.** `--min-instances` is
a *revision-level* setting, so while a `gcloud run deploy` is in flight the
outgoing revision is still in the traffic split and still holding its minimum:
both revisions run their full complement at once and the worker term doubles.
Four workers is 36 connections at rest and **52 for the length of every deploy**,
against a budget of 45 — and a deploy is precisely when a spare connection has to
exist, because that is when Alembic wants one. Buying a fourth worker means
shrinking the API's pool, raising the tier, or draining the old worker revision
before the new one starts. It does not mean changing this number alone.

**These are ceilings, not reservations.** SQLAlchemy opens connections on demand
and keeps them up to `pool_size`; overflow connections are opened and closed per
use. Measured against production on 2026-08-01 with the queue idle: **four
backends on `majorana` for the entire fleet.** The budget is sized for the worst
case because a burst that exhausts the ceiling takes the *next deploy's migration
step* down with it, not because 36 connections are ever expected.

**The worker holds at most two sessions at once** — the job handler and the
concurrent heartbeat that fences its lease (`_execute_with_heartbeat`).
Everything else in the loop opens one session and closes it before the next: the
claim commits and exits its `async with` before dispatch, and the recover,
dead-letter and reap sweeps run sequentially between cycles. That is why 2 + 2
is enough where the API needs 5 + 5.

**Measure before changing any of this:**

```sql
select coalesce(nullif(application_name, ''), '(unset)') as app, state, count(*)
from pg_stat_activity where datname = 'majorana' group by 1, 2 order by 3 desc;
```

Every backend answered `(unset)` before 2026-08-01, which made that instruction
impossible to follow. `MAJORANA_SERVICE` is now set on both Cloud Run services
and `db.py` turns it into `application_name`, so an API backend and a worker
backend are finally distinguishable. A backend reading `majorana-unset` is a
process that did not get the env var — investigate rather than assume.

### Why the worker count is `--min-instances`, and why it costs money

Raising the worker's `--max-instances` alone changes nothing. Cloud Run scales on
request concurrency and the worker serves only a static liveness responder on
`$PORT`, so it receives no request traffic and the autoscaler never has a reason
to add an instance. Parallel workers must be always-on, which bills continuously
whether or not anything is queued — roughly **$15–25/month each**.

Three workers is an owner decision (2026-08-01, from a stated range of three to
four), taken because runs were processed strictly serially product-wide and the
queue — not page latency — was what a class or a launch would have felt. Three
rather than four is the deploy-overlap arithmetic above, not a preference.
Changing the count is one line in `deploy.yml` and one constant in `db.py`; the
test will tell you if you change only one of them.

### Why N workers are safe

The queue was built for this and no code changed to enable it. Each path has its
own reason:

- `claim_job` and `claim_pending_dead_letter` — `FOR UPDATE SKIP LOCKED` with
  lease tokens, heartbeats and a recovery sweep.
- `recover_stale_jobs` — repeats its predicates on both `UPDATE`s, so a row
  another worker already moved no longer matches.
- the orphan reaper — `close_orphaned_run` writes deterministic `uuid5` event ids
  and `fail_run_from_dead_letter` no-ops on an already-terminal run, so two
  workers reaping the same orphan complete one event sequence rather than two.
- `worker_id` is `"$hostname:$pid"`, so instances never collide on a lease.

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

   Measured afterwards, A/B on a scratch database on this instance: **2.175
   transactions/s ungated → 1.408 gated, a 1.55× reduction.** Counting *sessions*
   predicted 3×; the difference is `pool_pre_ping`, which spends a transaction of
   its own on every checkout. It is kept deliberately — see the comment above
   `RECOVER_INTERVAL_S`.
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

**First: list the Cloud Run tags.** Every revision holds its own `DATABASE_URL`
reference, and they all point at the secret's `:latest` version — so a rollback
does not only change what the *current* revision reads. Any tagged revision is
publicly addressable at its own URL (`deploys.md § A tag is a public URL`), and a
tagged revision old enough to predate a cutover trusts whatever it trusted then.

The specific trap, found 2026-07-31: revision 00017 was tagged `catalog` and
reachable, trusted the **staging** WorkOS issuer, and could not reach the database
only because it predates the Cloud SQL move and has no socket mounted. A Neon URL
is a plain TCP host and needs no socket. Performing this rollback would have given
that public, staging-authenticated, 2026-07-19 build full access to production
data on its next cold start. The tags have been removed; check again before
relying on that.

```bash
gcloud run services describe majorana-api --project majorana-core \
  --region us-west1 --format=json | jq '.status.traffic[] | select(.tag) | {tag, revisionName, url}'
# expect exactly one: verify -> the current revision
```

Then: add a Secret Manager version to `DATABASE_URL` with the Neon **pooled** URL
and to `DATABASE_URL_SECRET` with the Neon **direct** URL, then redeploy both
services.
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
