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

## Connecting as `app_rw` (the privilege split)

**Status: ACTIVE since 2026-08-17 JST.** (Dates in this file are JST, which is the
owner's day. The commits and Cloud Run revisions behind this read 2026-08-16 in
UTC — the same evening, not a claim dated into the future.) Both `majorana-api`
and `majorana-worker`
connect as `majorana_api`, a LOGIN role whose only membership is `app_rw`.
`majorana_app` remains the migration credential and nothing else. "Restrict
database permissions" (ai-ops 127) is satisfied on production, and the evidence
is in *The flip, as performed* below rather than in this sentence — a provisioned
role reads exactly like an active one from the outside, which is the failure mode
that issue was about in the first place.

The check that distinguishes the two, and the one to re-run before believing this
heading, reads the server rather than the config:

```sql
-- as majorana_app, through the proxy
select usename, application_name, count(*)
from pg_stat_activity where datname='majorana'
group by usename, application_name order by usename;
```

`majorana_api / majorana-api` and `majorana_api / majorana-worker` are both
required for this to be passing — one without the other is the half-flipped state. Any `majorana_app` row whose `application_name` is one of the two
services means that service is back on the owner credential. A `majorana_app`
row with an *empty* application_name is somebody's psql or probe session, which
is expected and is not a regression.

### What `app_rw` is

A **NOLOGIN privilege bundle**, not an account. It holds `SELECT, INSERT, UPDATE,
DELETE` on the tables, `USAGE, SELECT` on the sequences, `USAGE` (never `CREATE`)
on the schema, and default privileges so tables added by later migrations are
covered automatically. `UPDATE`/`DELETE` are revoked again on `run_events`,
`audit_log` and `usage_events`, which 0050 also protects with triggers.

Verified against PostgreSQL 17 on the full migration chain, as the role: DDL is
refused (`permission denied for schema public`), `DROP TABLE` is refused, writes
to the three append-only tables are refused, ordinary reads and writes succeed, a
table created *after* the migration is usable without further grants, and a role
*without* `app_rw` is refused outright — the last one being the control that
shows the grant is doing the work.

### The flip, as performed

Done 2026-08-17. Ordering held: 0052 was already on production (`schema before:
0051` → `schema after: 0052 (head)` in the deploy of leona 688, run
31958007448), which is what made the role real enough to join.

Two steps below differ from the plan this section used to carry, and both
differences matter more than the commands do.

**1. Create the login role in SQL, not through `gcloud sql users create`.** The
Admin API grants every user it creates membership in `cloudsqlsuperuser`, which
carries CREATEROLE and CREATEDB — it would have handed the application most of
what this exercise exists to take away. Checked on this instance rather than
assumed: `majorana_app` is a member of `cloudsqlsuperuser`, and `majorana_api`,
created with plain `CREATE ROLE`, is a member of `app_rw` and nothing else. A
SQL-created role still shows up in `gcloud sql users list` as `BUILT_IN`, so
nothing is lost administratively.

`CREATE ROLE` also sidesteps the trap leona 688 landed on: NOSUPERUSER,
NOCREATEDB, NOCREATEROLE and NOBYPASSRLS are the *defaults*, so the safe values
need no `ALTER ROLE` — and setting those attributes at all requires a privilege
`majorana_app` does not have.

**Create the role without a password, then set it with `\password`.** There is no
way to pass a password to `CREATE ROLE` that keeps it out of both the process list
and the statement text — the statement *is* the password — so do not try. Two
approaches that look safe and are not, both rejected here after being written down
and corrected (Aikido, PR 689):

- `psql -v pw="$PW"` — the shell expands `$PW` **before `psql` starts**, so the
  full `-v pw=<password>` argument sits in `ps` for anyone with local access for
  the life of the command. Same for `--set`, `--password=`, and
  `gcloud sql users create --password=`.
- `create role … password '<literal>'` — keeps it out of argv but puts the
  cleartext in the statement text, which is visible in `pg_stat_activity` while it
  runs and lands in the server log the moment anyone sets `log_statement` to `ddl`
  or `all`. (Verified 2026-08-17: this instance is `log_statement = none`,
  `log_min_duration_statement = -1`, pgaudit off — so nothing was logged. That is
  a *setting*, not a guarantee, and it is one flag away from being false.)

`\password` avoids both: psql prompts, hashes the input **client-side** into a
SCRAM-SHA-256 verifier, and sends only the verifier. The cleartext never reaches
the server, so it cannot reach a log or `pg_stat_activity` at all.

```bash
psql "$DATABASE_URL_DIRECT"
```

```sql
-- as majorana_app, through the proxy.
create role majorana_api login;   -- no password yet, so nothing can log one
grant app_rw to majorana_api;
\password majorana_api            -- prompts twice; sends a SCRAM verifier, not the password
```

Generate the value first and paste it at the prompt — it also has to survive being
placed in a URI, so keep it alphanumeric:

```bash
LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 40; echo
```

Keep it on the clipboard or in the shell as `$PW` for the secret below; there is no
way to read it back out of PostgreSQL once it is a SCRAM verifier.

Then assert, rather than trust, that the role is what was asked for: `login` is
true, `super`/`bypassrls`/`createdb`/`createrole`/`replication` are all false,
and its membership list is exactly `['app_rw']`. Anything else, stop and strip it.

**2. The secret needs its own IAM binding, which the old plan omitted.** Both
services run as `639400385957-compute@developer.gserviceaccount.com`, and
`secretAccessor` is granted per secret. Attach a secret that service account
cannot read and the revision does not start.

```bash
# The password goes to the secret from a file, never through argv — and the file
# is created private BEFORE anything is written to it. `> url.tmp` with a default
# umask makes it world-readable for the moments it exists, which on a shared or
# backed-up machine is long enough to matter.
( umask 077
  printf 'postgresql+psycopg://majorana_api:%s@/majorana?host=/cloudsql/majorana-core:us-west1:majorana-pg' "$PW" > url.tmp )
test "$(stat -f '%Lp' url.tmp)" = "600" || { echo "url.tmp is not 0600 — stop"; exit 1; }
gcloud secrets create DATABASE_URL_APP_SECRET --data-file=url.tmp --project=majorana-core
shred -u url.tmp 2>/dev/null || rm -f url.tmp

gcloud secrets add-iam-policy-binding DATABASE_URL_APP_SECRET --project=majorana-core \
  --member=serviceAccount:639400385957-compute@developer.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor

gcloud run services update majorana-api --region=us-west1 --project=majorana-core \
  --update-secrets=DATABASE_URL=DATABASE_URL_APP_SECRET:latest
gcloud run services update majorana-worker --region=us-west1 --project=majorana-core \
  --update-secrets=DATABASE_URL=DATABASE_URL_APP_SECRET:latest
```

`DATABASE_URL_SECRET` is untouched and stays the migration credential — alembic
needs an owner to issue DDL.

**The "literal env var" warning that used to be here was stale, and it made the
flip read as more dangerous than it was.** `DATABASE_URL` was already a
`secretKeyRef` on both services (pointing at the secret named `DATABASE_URL`), so
`--update-secrets` swapped one reference for another in a single command. The
remove-then-attach dance — and the window it opens where a service has no
credential at all — was not needed and was not performed. The underlying trap is
real and still worth knowing (Cloud Run genuinely cannot convert a literal into a
reference, and a failed attach poisons every later deploy), it simply did not
apply. **Check which one you are looking at before believing either:**

**Check BOTH services, every time.** The procedure updates two and it is the
second one that gets forgotten — a worker left on the owner credential is the
silent half of this operation, because the site keeps working and the status
heading above becomes false without anything failing.

```bash
for svc in majorana-api majorana-worker; do
  printf '%-18s ' "$svc"
  rtk proxy gcloud run services describe "$svc" --region=us-west1 --project=majorana-core \
    --format='json(spec.template.spec.containers[0].env)' \
    | jq -r '[.spec.template.spec.containers[0].env[] | select(.name=="DATABASE_URL")]
             | .[0] // {} | .valueFrom.secretKeyRef.name // "LITERAL (not a secret ref)"'
done
# Both must print DATABASE_URL_APP_SECRET.
```

Read the revision back afterwards rather than trusting the exit code — **and run
the read through `rtk proxy` if `rtk` is on the path.** That is not a style
preference. `rtk` is the local token-reducing command proxy, and it *truncates*
long `gcloud` output: measured on this exact command, `describe --format=yaml(…env)`
returned **11** env keys through `rtk` and **17** raw. A "before" snapshot taken
through it made a clean single-key change look like six keys had appeared from
nowhere, and cost half an hour chasing a production anomaly that did not exist.
It mangles `--format=json` too — long annotation values come back with unescaped
newlines inside strings, so `jq` refuses to parse the document at all.

```bash
rtk proxy gcloud run services describe majorana-api --region=us-west1 \
  --project=majorana-core --format='json(spec.template.spec.containers[0].env)' | jq .
```

The general rule, because this will not be the last time: **when a `gcloud` read
is going to be compared against another read, or piped into a parser, take `rtk`
out of the path first.** A truncated snapshot and a real configuration change are
indistinguishable after the fact.

**Verify before trusting it.** 21 checks were run as `majorana_api` against
production, and the script is worth keeping the shape of: refusals are proved by
*attempting* the statement and reading the error class. `InsufficientPrivilege`
means the grant refused it; any other error — a `NotNullViolation`, a foreign key
— means the privilege check *passed* and a constraint stopped it, which is how a
write privilege gets proved without leaving a row in a production table.

**One limit of that method, worth knowing before it misleads someone
(CodeRabbit, PR 689).** `InsufficientPrivilege` is SQLSTATE **42501**, and 42501
is not specific to a missing `GRANT` — a row-level-security policy denial raises
the same code. So "refused" here means "refused for one of two reasons", and the
message text is what separates them: `permission denied for table …` is the grant,
`new row violates row-level security policy …` is RLS. It does not matter today —
this schema defines no policies and no table has RLS enabled, which is why the
checks were left reading the class alone. It would matter the moment RLS is
introduced for tenancy, and at that point a probe asserting only 42501 would
report a *policy* working as though the *grant* were working. Assert on the
message, not just the class, if that day comes.

| group | result |
|---|---|
| `SELECT` on `runs`, `workspaces` | allowed |
| `INSERT`/`UPDATE`/`DELETE` on `workspace_folders` | allowed |
| `INSERT` on `run_events` | allowed |
| `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`, `CREATE SEQUENCE` | refused |
| `UPDATE`/`DELETE` on `run_events`, `audit_log`, `usage_events` | refused |
| `DELETE qpu_runs`, `UPDATE`/`DELETE run_plans`, `UPDATE` on both candidate tables | refused |
| **`UPDATE qpu_runs` (the control)** | **allowed** |
| `SELECT alembic_version` | refused |

The control is the row that makes the table mean anything: it shows the revokes
are targeted rather than a blanket denial that would pass every negative check
for the wrong reason. A flip checked only by "the site still loads" proves
nothing — most pages read a handful of tables, and the endpoint that needs the
missing privilege may not be one a smoke test opens.

Finally, prove it end to end from the outside: `/v1/catalog/entries` returned 279
entries and 3.0 MB from the database, and `pg_stat_activity` showed the
connections behind it owned by `majorana_api`. Config proves intent; the server's
own view of who is connected proves the flip.

### Rollback

Point both services back at the secret named `DATABASE_URL` (not
`DATABASE_URL_SECRET`, which is the proxy-form migration credential and will not
resolve from inside a Cloud Run container):

**Both services, or the rollback is half done** — and a half-rolled-back pair is
worse than either end state, because the two services then disagree about which
credential they hold while the site keeps serving:

```bash
for svc in majorana-api majorana-worker; do
  gcloud run services update "$svc" --region=us-west1 --project=majorana-core \
    --update-secrets=DATABASE_URL=DATABASE_URL:latest
done
```

Then re-run the two-service readback above and confirm both print `DATABASE_URL`.

Nothing about the schema changed, so there is no data to undo, and `app_rw` can
stay — an unused role grants nothing. `majorana_api` can stay too; a LOGIN role
nothing connects as is inert, and dropping it means recreating the password on the
way back in. One trap still lives here: a `--set-env-vars` that omits an existing
key **removes** it. Use `--update-secrets`, and read the revision back afterwards
rather than trusting the command's exit code.

## Connection budget

The instance allows **200** and reserves 3 for superusers. 200 is `max_connections`
as an explicit database flag on `majorana-pg`, set 2026-08-15 alongside the move to
`db-custom-1-3840` — see `INSTANCE_CONNECTION_CEILING` in `infra/fleet.env` for why
it is set rather than inherited. Before that date this line read `db-g1-small`
allows 50, which is where every superseded figure below came from.

**Every term below except the API's own pool lives in `infra/fleet.env`, and that
file is the only place it lives.** `deploy.yml` loads it into the job environment
and passes the values straight to `gcloud run deploy`; `db.py`'s `fleet_sizing()`
parses the same file for this arithmetic. There is no second copy to keep in step
— that is the point of the file, and `test_the_deploy_reads_the_sizing_from_the_same_file_the_budget_does`
fails if a literal reappears on a deploy line.

| Term | Value | Where it is stated |
|---|---|---|
| API instances | 4 | `API_MAX_INSTANCES` in `infra/fleet.env` |
| API pool, per instance | 5 + 5 | `DEFAULT_POOL_SIZE` / `DEFAULT_MAX_OVERFLOW` in `db.py` — the only sizing read on a request path |
| Worker instances | **1** | `WORKER_INSTANCES` in `infra/fleet.env` |
| Worker pool, per instance | 2 + 2 | `WORKER_POOL_SIZE` / `WORKER_MAX_OVERFLOW` in `infra/fleet.env`, deployed as `DB_POOL_SIZE`/`DB_MAX_OVERFLOW` |
| Fleet at rest | 44 | `fleet_peak_connections(during_worker_rollout=False)` |
| **Fleet during a deploy** | **48** | `fleet_peak_connections()` — both worker revisions hold their minimum |
| Instance ceiling | 200 | `INSTANCE_CONNECTION_CEILING` in `infra/fleet.env` (`max_connections` flag) |
| Superuser reserved | 3 | Postgres |
| Alembic + one operator | 2 | `OPERATIONAL_HEADROOM` |
| **Budget** | **195** | |

`services/api/tests/test_database_configuration.py` asserts the sum, asserts that
`deploy.yml` takes its numbers from `infra/fleet.env` rather than from a literal,
asserts that the shell's export regex actually matches every key the deploy
needs, and pins the boundary — which it now DERIVES from the budget rather than
hard-coding. At the current tier that boundary is **19 workers fit, 20 do not**
(a rollout peak of 192 against 195). Do not re-derive any of this by hand — edit
`infra/fleet.env`, then run `services/api/tests/test_database_configuration.py`,
which is the file that checks it.

> **Every number in the table above moved, in two separate changes on the same
> day.** They are listed apart because they have different causes and either
> could be reverted without the other:
>
> 1. **The tier and the ceiling (2026-08-15).** `majorana-pg` moved to
>    `db-custom-1-3840` / REGIONAL, and `max_connections` was set explicitly to
>    **200**, replacing `db-g1-small`'s inherited 50. This is what took the budget
>    from 45 to **195**.
> 2. **The fleet size (#600, also 2026-08-15, after the tier change and because
>    of it).** `API_MAX_INSTANCES` went 2 → 4, which is what took the API term
>    from 20 to **40** and the resting fleet from 24 to **44**.
>
> Before both, this table read 2 API instances, 24 at rest, 28 during a deploy, a
> budget of 45, and "three workers fit, four do not". Those figures were correct
> under `db-g1-small` and are named here only so a reader who remembers them can
> see they were replaced rather than mistyped. The worker count is no longer
> anywhere near a database limit; `WORKER_INSTANCES` is now bounded by cost (an
> always-on instance is billed continuously), not by connections.

### Changing the worker count

One edit:

```bash
# infra/fleet.env
WORKER_INSTANCES=3    # 1 = serial (default), 3 = stress test; 19 is the budget ceiling
```

Commit, push to `dev`, and the next deploy runs that many. Nothing else changes:
the deploy reads the file, the budget test reads the file, and raising it past
what the budget allows fails CI rather than production. Turning it back down is
the same edit — no revision surgery, because `--min-instances` is set on every
deploy rather than being live-service state.

**The binding constraint is the deploy, not the workload.** `--min-instances` is
a *revision-level* setting, so while a `gcloud run deploy` is in flight the
outgoing revision is still in the traffic split and still holding its minimum:
both revisions run their full complement at once and the worker term doubles. So
N workers is `40 + 4N` connections at rest and **`40 + 8N` for the length of every
deploy** — and a deploy is precisely when a spare connection has to exist, because
that is when Alembic wants one. Against the budget of 195 that puts the ceiling at
**19 workers** (192 during a deploy); 20 asks for 200 and fails CI.

> **This paragraph used to end "four workers is 36 at rest and 52 during a deploy,
> against a budget of 45 — buying a fourth worker means shrinking the API's pool or
> raising the tier."** The tier WAS raised, on 2026-08-15, and the doubling rule is
> the only part of that argument that survives it. Four workers now costs 56 at rest
> and 72 during a deploy against 195, which fits with room to spare. **What stops the
> worker count today is cost, not connections** — an always-on instance is billed
> continuously whether or not the queue has work — so raising it is a spend decision
> for the owner rather than a database one. The doubling itself has not changed and
> is still the thing to compute before raising the number.

**These are ceilings, not reservations.** SQLAlchemy opens connections on demand
and keeps them up to `pool_size`; overflow connections are opened and closed per
use. Measured against production on 2026-08-01 with the queue idle: **four
backends on `majorana` for the entire fleet.** The budget is sized for the worst
case because a burst that exhausts the ceiling takes the *next deploy's migration
step* down with it, not because the fleet's peak is ever expected.

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
honored the requested moment rather than cloning current state.

### Which path to reach for

**PITR is the path you want; the daily backup is the fallback.** The backup path can
lose up to ~24h of data (daily at 10:00 UTC) and only restores to that snapshot. PITR
loses seconds — whatever hadn't hit the transaction log at the moment of failure — and
can target any point in the last 7 days, not just "now." Reach for PITR first; the
daily backup exists for when PITR's 7-day window doesn't reach far enough back.

### Do not trust the CLI or the operation status — verify the data

**A finding worth its own heading, because it is the one someone needs to hit at
speed:** for a REGIONAL clone, `gcloud sql instances clone`'s own client-side wait gave
up after ~3 minutes ("Operation ... is taking longer than expected"), and the Cloud
SQL operation object itself did not reach formal `DONE` until **621s** — a full **192
seconds after** the data was already correct and queryable at **429s**. Almost
certainly the HA standby replica finishing setup after the primary is already usable.

**The failure mode this causes:** an operator at 3am, watching a CLI that has already
said "taking longer than expected," concludes the restore has failed and starts doing
something worse. It has not failed — it is done, and has been for over three minutes.
**Verify the data directly** (query it, run the same table/row-count/digest check this
drill used) rather than waiting for the CLI or the operation object to say done.

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
