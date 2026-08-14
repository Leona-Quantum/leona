# Runbook: the production database

## Where the database lives

**Cloud SQL for PostgreSQL 17, `majorana-core:us-west1:majorana-pg`**, since
2026-07-27. Before that it was Neon (`twilight-wildflower-01313590`,
aws-us-west-2), on the free plan.

| | |
|---|---|
| Instance | `majorana-pg`, us-west1, Enterprise edition, `db-custom-1-3840` (1 vCPU, 3.75 GB), **REGIONAL** (HA) — raised from `db-g1-small`/ZONAL on 2026-08-15 |
| Database / role | `majorana` / `majorana_app` (owns every object, so Alembic can issue DDL) |
| Storage | 10 GB SSD, auto-increase on. The data is ~50 MB |
| Backups | daily 10:00 UTC, 7 retained, REGIONAL, **PITR on** — see § Backups and the restore drill |
| Public IP | assigned, but **zero authorized networks** — nothing reaches it by IP |
| Connections | `max_connections` **200** as of 2026-08-15 (explicit flag, no longer the shared-core default); fleet terms live in `infra/fleet.env` — the § Connection budget prose below still states the pre-2026-08-15 figures (50/44/45) and needs its own pass, out of scope here |

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

**What this posture actually protects, and what it does not — written down because
nobody has consciously decided it, it happened by default.** Verified 2026-08-15:
`compute.googleapis.com` and `servicenetworking.googleapis.com` are both disabled on
this project, so there is no VPC, no Private Services Access peering, and no path to
a genuinely private-IP-only instance without standing that up first.

- **What it protects against:** an unauthenticated network client. With zero
  authorized networks, nothing reaches port 5432 by raw TCP no matter what
  credentials it holds — the allowlist admits nothing, full stop. Every real
  connection (Cloud Run's socket, the Auth Proxy above) goes through the Cloud SQL
  connector's own IAM/mTLS handshake instead, which is a second, independent gate on
  top of the database password.
- **What it does not protect against:** anything holding valid IAM credentials for
  `roles/cloudsql.client` plus the database password, from *anywhere on the
  internet*. The connector's whole point is that it does not care about network
  origin — that is what let this drill run from a laptop with no special network
  position, and it is exactly as true of a leaked service-account key or a stolen
  `DATABASE_URL_SECRET` value. A public IP with zero authorized networks is not
  "closed"; it is "open to anyone who authenticates correctly, from anywhere." Private
  IP would add a genuine second perimeter — reachable only from inside the VPC — that
  today does not exist for any actor, legitimate or not.
- **What enabling it would cost:** `compute.googleapis.com` +
  `servicenetworking.googleapis.com` enabled project-wide, a VPC, an allocated
  Service Networking peering range, and (for Cloud Run to keep reaching the
  instance) a Serverless VPC Access connector — a small ongoing cost (roughly
  $8–10/month for the smallest connector) plus a real migration: cut over
  `--set-cloudsql-instances` on both Cloud Run services and confirm nothing else
  depends on the current public-IP path. Not a flag flip, and not something to do to
  satisfy a one-hour drill (see below).

## Connection budget

`db-g1-small` allows 50 and reserves 3 for superusers.

**Every term below except the API's own pool lives in `infra/fleet.env`, and that
file is the only place it lives.** `deploy.yml` loads it into the job environment
and passes the values straight to `gcloud run deploy`; `db.py`'s `fleet_sizing()`
parses the same file for this arithmetic. There is no second copy to keep in step
— that is the point of the file, and `test_the_deploy_reads_the_sizing_from_the_same_file_the_budget_does`
fails if a literal reappears on a deploy line.

| Term | Value | Where it is stated |
|---|---|---|
| API instances | 2 | `API_MAX_INSTANCES` in `infra/fleet.env` |
| API pool, per instance | 5 + 5 | `DEFAULT_POOL_SIZE` / `DEFAULT_MAX_OVERFLOW` in `db.py` — the only sizing read on a request path |
| Worker instances | **1** | `WORKER_INSTANCES` in `infra/fleet.env` |
| Worker pool, per instance | 2 + 2 | `WORKER_POOL_SIZE` / `WORKER_MAX_OVERFLOW` in `infra/fleet.env`, deployed as `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` |
| Fleet at rest | 24 | `fleet_peak_connections(during_worker_rollout=False)` |
| **Fleet during a deploy** | **28** | `fleet_peak_connections()` — both worker revisions hold their minimum |
| Superuser reserved | 3 | Postgres |
| Alembic + one operator | 2 | `OPERATIONAL_HEADROOM` |
| **Budget** | **45** | |

At three workers — the stress-test setting — those two rows read 32 and **44**,
against the same budget of 45.

`services/api/tests/test_database_configuration.py` asserts the sum, asserts that
`deploy.yml` takes its numbers from `infra/fleet.env` rather than from a literal,
asserts that the shell's export regex actually matches every key the deploy
needs, and pins the boundary: **three workers fit, four do not.** Do not re-derive
this by hand — edit `infra/fleet.env` and run that file.

### Changing the worker count

One edit:

```bash
# infra/fleet.env
WORKER_INSTANCES=3    # 1 = serial (default), 3 = stress test, 4 does not fit
```

Commit, push to `dev`, and the next deploy runs that many. Nothing else changes:
the deploy reads the file, the budget test reads the file, and raising it past
what the budget allows fails CI rather than production. Turning it back down is
the same edit — no revision surgery, because `--min-instances` is set on every
deploy rather than being live-service state.

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

The count has been an owner decision twice on 2026-08-01. First three, from a
stated range of three to four, because runs were processed strictly serially
product-wide and the queue — not page latency — was what a class or a launch
would have felt. Then **back to one**, on the same day, because the queue is
empty at today's usage and two extra always-on pollers are $30–50/month of
capacity nobody is waiting on. Three rather than four was never a preference; it
is the deploy-overlap arithmetic above.

Because it moved twice in a day, the number stopped being a constant and became
`WORKER_INSTANCES` in `infra/fleet.env` — one edit, no revision surgery, and the
budget test refuses a value that does not fit.

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

## Backups, and the restore drill

Verified against live GCP on 2026-08-15 (`gcloud sql instances describe majorana-pg`,
`gcloud sql backups list`), because every figure below had only ever been prose or was
stale from before the previous day's tier change:

| | |
|---|---|
| Automated backups | **on** — daily, `startTime: 10:00` UTC, `retainedBackups: 7` (COUNT retention), `backupTier: STANDARD` |
| Last 8 runs | **all `SUCCESSFUL`**, 2026-08-09 through 2026-08-14, plus one `ON_DEMAND` at 2026-08-14T14:13 |
| Backup location | `us` (multi-region) |
| **Point-in-time recovery** | **ON.** `pointInTimeRecoveryEnabled: true`, `replicationLogArchivingEnabled: true`, `transactionLogRetentionDays: 7`, storage `CLOUD_STORAGE` |
| Availability | **REGIONAL** — HA replica, raised from ZONAL on 2026-08-15 alongside the `db-custom-1-3840` tier change |

REGIONAL/HA and PITR protect against different failures and neither substitutes for
the other. HA fails over to the standby on a zone or instance outage — it does not
help if the *data* itself is wrong (a bad migration, a bug that deletes rows), because
the standby has the same bad data. PITR is what recovers from that: any point inside
the 7-day transaction-log window, not only the daily snapshot.

### What the restore drill proved — run 2026-08-15

Both restore paths were run against real production data, into throwaway instances
(`majorana-pg-drill-restore-20260814`, `majorana-pg-drill-pitr-20260814`) with **zero
authorized networks** — same posture as production, reachable only through the Cloud
SQL Auth Proxy's IAM/mTLS tunnel. Full write-up, per-table numbers, and what this run
does and does not establish: `docs/gates/restore-drill-2026-08-15.md`.

**Backup restore — RTO 440s (7m20s)**, create-to-restore-DONE (operations-API
timestamps; the driving script's own wall-clock reading was 460s, the gap being
`gcloud`'s CLI polling interval). 12 of 33 tables (every
one with no write traffic in the gap) matched production **exactly**, row count and
content digest both; the other 21 differed only in the direction and rough magnitude
~2h40m of ordinary traffic predicts (the backup used was ~2h40m old at the moment of
comparison) — 1,033 rows out of 46,748 (2.2%), never a table where the backup had rows
production didn't. `alembic_version` was one migration behind (`0050` vs. `0051`),
consistent with a migration landing in that same gap.

**PITR clone — RTO 429s (7m9s)** to verified, correct data at the requested
timestamp (~5 minutes back). Verified as *point-in-time correct*, not just intact:
three readings bracketing the clone's target (production before, the clone, production
after) show the clone's row counts landing strictly between the two, matching linear
interpolation to within 1 row on the highest-traffic table — proof `--point-in-time`
honored the requested moment rather than cloning current state. One caveat worth
carrying forward: `gcloud`'s own client-side wait, and the Cloud SQL operation object
itself, both ran far longer than the data took to become correct and queryable
(20+ minutes and still `RUNNING` when this was written, almost certainly standing up
the HA standby) — **verify the data directly; do not trust the CLI or the operation
status to say when a clone is actually usable.**

### The restore drill — commands, for next time

Cloud SQL restores into an instance; it cannot restore "to a scratch copy" in place,
so a drill creates a second one, proves the data, and deletes it. This is the
procedure the run above followed.

**Backup restore:**
```bash
BACKUP_ID=$(gcloud sql backups list --instance majorana-pg --project majorana-core \
  --limit 1 --format='value(id)')

gcloud sql instances create majorana-pg-restoretest --project majorana-core \
  --database-version POSTGRES_17 --tier db-g1-small --edition ENTERPRISE \
  --region us-west1 --no-backup --availability-type ZONAL
gcloud sql backups restore "$BACKUP_ID" --project majorana-core \
  --restore-instance majorana-pg-restoretest --backup-instance majorana-pg
```
**`--edition ENTERPRISE` is required**, not optional flourish — this project's default
edition for new instances is `ENTERPRISE_PLUS`, which rejects `db-g1-small` outright
(production itself is `ENTERPRISE`; match that, not the project default).

**Point-in-time clone**, to any timestamp inside the 7-day log window:
```bash
gcloud sql instances clone majorana-pg majorana-pg-pitrtest --project majorana-core \
  --point-in-time '2026-08-15T00:00:00Z'
```
(`clone` provisions the target itself — do not `create` one first for this path.)

**Verify — more than row counts**, same standard as the Neon cutover above: for every
table in `information_schema.tables`, compare the row count and an order-independent
content digest (`md5` per row, sorted, hashed) against production, plus the
`alembic_version` row. A restore that silently dropped a column, or a clone that
landed a transaction behind, passes a row count and fails the digest.

**Time it.** The clock from `create`/`clone` issued to the verify query passing is the
RTO, and it is the only version of that number worth writing down — not a vendor SLA,
not an estimate.

**Delete the clone. Always, even on a failed drill:**
```bash
gcloud sql instances delete majorana-pg-restoretest --project majorana-core --quiet
gcloud sql instances delete majorana-pg-pitrtest --project majorana-core --quiet
gcloud sql instances list --project majorana-core   # confirm only majorana-pg remains
```
Cloud SQL instances do not expire on their own; an interrupted drill bills until
someone notices and deletes it by hand.

> `docs/runbooks/incident.md` § The database is lost or corrupted links here rather
> than restating these commands — a second copy would drift, and the drifted copy
> would read as current.

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
