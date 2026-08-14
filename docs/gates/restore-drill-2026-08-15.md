# Cloud SQL restore drill — the run, 2026-08-15

The evidence for `plans/rebuild/05-security.md` §2:

> - [ ] Incident runbook + restore drill completed once — owner item. **Correction:** this
>       said "Neon restore drill"; production moved to Cloud SQL on 2026-07-27

Both halves are now done. This file records one execution of each restore path Cloud SQL
offers, against real production data, with the verification methodology `docs/runbooks/
database.md` already established for the Neon→Cloud SQL cutover: table list, row counts,
and an order-independent content digest (`md5` per row, sorted, hashed) for every table,
plus the `alembic_version` row — not row counts alone, which a restore that silently
dropped a column would still pass.

**Note on timestamps:** the executing environment's system clock read UTC dates one day
behind the session's calendar date throughout this run (confirmed via `date -u` at every
step, cross-checked against `gcloud`'s own returned timestamps, which agree with the
system clock). All times below are as captured, self-consistent for the elapsed-time and
delta arithmetic that matters for RTO/RPO; do not read the `2026-08-14` timestamps as a
different day from this file's `2026-08-15` filename.

## What was run

| | |
|---|---|
| production instance | `majorana-pg`, `db-custom-1-3840`, REGIONAL, POSTGRES_17, us-west1 |
| production baseline captured | 2026-08-14T17:29Z (Cloud SQL Auth Proxy, read-only transaction, then torn down) |
| drill instances | `majorana-pg-drill-restore-20260814` (backup restore), `majorana-pg-drill-pitr-20260814` (point-in-time clone) |
| networking | zero authorized networks on both — same posture as production; reached only through the Cloud SQL Auth Proxy's IAM/mTLS tunnel, never by raw IP |
| verification | `verify_db.py` — per-table row count + order-independent content digest + `alembic_version`, compared against the production baseline |

## Path 1: backup restore

```
BACKUP_ID=1786718925464   # the automated backup from 2026-08-14T14:48:45Z
gcloud sql instances create majorana-pg-drill-restore-20260814 \
  --database-version POSTGRES_17 --tier db-g1-small --edition ENTERPRISE \
  --region us-west1 --availability-type ZONAL --storage-size 10 --storage-type SSD --no-backup
gcloud sql backups restore $BACKUP_ID \
  --restore-instance majorana-pg-drill-restore-20260814 --backup-instance majorana-pg
```

**`db-g1-small` needed `--edition ENTERPRISE` explicitly** — the project's default edition
for new Cloud SQL instances is `ENTERPRISE_PLUS`, which rejects the legacy shared-core
tier name outright (`Invalid Tier (db-g1-small) for (ENTERPRISE_PLUS) Edition`). Production
itself is `ENTERPRISE` edition; matching it, not the project default, is what worked.

Timings below are from `gcloud sql operations list`, not wall-clock around the CLI call
— the operations API's own start/end timestamps, which exclude `gcloud`'s polling
overhead:

| | |
|---|---|
| `CREATE` operation | 17:37:58.325 → 17:40:49.253 (171s) |
| `RESTORE_VOLUME` operation | 17:40:57.724 → 17:45:18.741 (261s) |
| **Total: create through restore DONE** | **440s (7m20s)** |

(The driving script's own wall-clock reading was 460s, create-issued to
first-successful-verification-query; the 20s gap is `gcloud`'s CLI-side polling
interval on top of the operations themselves, not a second real delay.)

### Verification

Table list: **identical**, 33/33, both directions. `alembic_version`: production **0051**,
restored **0050** — production ran migration `0051_runs_workspace_id_order` sometime
between the backup (2026-08-14T14:48:45Z) and the baseline read (17:29Z), so the backup
predates it. That is expected: a daily backup is up to ~24h old by construction, and this
one was ~2h40m old.

12 tables matched **exactly** — same row count and same content digest: `users`,
`memberships`, `workspaces`, `workspace_folders`, `verification_records`,
`project_shares`, `provider_credentials`, `qpu_runs`, `artifact_tags`,
`artifact_citations`, `candidate_verifications`, `candidate_verification_attempts`. Every
one of those is a table with no write traffic in the ~2h40m gap.

The other 21 tables differ, and every difference is production **ahead** of the restore by
a small amount, consistent with ~2h40m of ordinary activity — never behind, never a
table the backup has that production doesn't:

| table | prod | restored | delta |
|---|---:|---:|---:|
| import_items | 5877 | 5508 | 369 |
| run_events | 16238 | 15931 | 307 |
| agent_llm_calls | 2572 | 2506 | 66 |
| usage_events | 2592 | 2526 | 66 |
| agent_steps | 3136 | 3071 | 65 |
| agent_runs | 541 | 525 | 16 |
| run_candidates | 767 | 751 | 16 |
| run_plans | 556 | 540 | 16 |
| runs | 662 | 646 | 16 |
| jobs | 680 | 663 | 17 |
| audit_log | 3624 | 3609 | 15 |
| candidate_executions | 744 | 729 | 15 |
| artifact_versions | 2050 | 2038 | 12 |
| artifacts | 829 | 820 | 9 |
| candidate_conversions | 422 | 413 | 9 |
| candidate_semantic_reviews | 442 | 433 | 9 |
| license_assertions | 3174 | 3168 | 6 |
| artifact_sources | 1587 | 1584 | 3 |
| import_jobs | 18 | 17 | 1 |
| **total** | **46748** | **45715** | **1033 (2.2%)** |

Schema fidelity, same standard as the Neon cutover: **99 indexes, 452 constraints, 33
tables** on the restored instance (queried directly; not diffed against a saved production
figure, since none was captured before this drill — worth capturing next time).

**Conclusion: the backup restore path works.** Every table with no write activity in the
gap matched byte-for-byte; every table that differed differed in the direction and rough
magnitude ~2h40m of production traffic predicts, not randomly. Nothing indicates a partial
or corrupted restore.

## Path 2: point-in-time clone

```
gcloud sql instances clone majorana-pg majorana-pg-drill-pitr-20260814 \
  --point-in-time 2026-08-14T17:40:35Z   # ~5 minutes before the clone was issued
```

`clone` inherits the source instance's tier and networking rather than accepting an
override — confirmed via `--help` before running, so this instance came up as
`db-custom-1-3840` REGIONAL, matching production exactly, at a proportionally higher
hourly rate than the backup-restore path. Still well under $1 for the drill's total
runtime.

**RTO to correct, queryable data: 429s (7m9s)** — clone issued 17:45:35, first
successful verification query returned correct point-in-time data at 17:52:44.

### The operation object lags data availability — do not trust it

`gcloud sql instances clone`'s own client-side wait gave up after ~3 minutes
("Operation ... is taking longer than expected"). The server-side operation
(`fcc2b0a6-c44e-440c-a76e-773100000033`) ran 17:45:38.579Z → 17:55:59.278Z —
**621s (10m21s) to formal `DONE`**, almost certainly standing up the HA standby
replica, which a ZONAL restore has no equivalent step for. The instance was
`RUNNABLE` and returned fully correct, verified data **192s earlier**, at 429s.

**If this runbook is ever followed under `gcloud`'s default behavior, do not wait for
the CLI or the operation object to say done — verify the data directly**, the way
this drill did, or you will believe a clone is still in progress for over three
minutes after it is actually usable. That gap is exactly the window in which a
stressed operator, watching a CLI that already said "taking longer than expected,"
concludes the restore has failed and starts doing something worse.

### Verification — point-in-time correctness, not just data integrity

The backup-restore check (above) proves the mechanism doesn't corrupt data. This
check proves something stronger for PITR specifically: that the **recovery point
itself** landed where requested, not at "whatever the current state happened to be."

Three readings, bracketing the clone's target timestamp (2026-08-14T17:40:35Z):

| reading | when | total rows | `run_events` rows |
|---|---|---:|---:|
| production baseline | 17:29Z | 46,748 | 16,238 |
| **PITR clone (target 17:40:35Z)** | verified 17:52Z | **46,795** | **16,259** |
| production, second read | 17:53:09Z | 46,842 | 16,280 |

The clone's row counts sit **strictly between** the two production readings that
bracket its target time — not equal to the earlier one (which would mean the clone
silently used an older point) and not equal to the later one (which would mean
`--point-in-time` was ignored and it cloned current state). For `run_events`, linear
interpolation between the two production readings predicts 16,258 rows at the
target timestamp; the clone shows 16,259 — a 1-row difference against a ~22-minute
window. `alembic_version` is `0051` at the clone, matching production at both
bracketing reads (unlike the backup restore, which landed one migration behind) —
consistent with the target timestamp being safely after `0051` shipped.

**Conclusion: the PITR clone honored the requested recovery point precisely**, not
approximately and not just "some point in the past."

## Cleanup

```
$ gcloud sql instances delete majorana-pg-drill-restore-20260814 --project majorana-core --quiet
Deleted [.../instances/majorana-pg-drill-restore-20260814].
$ gcloud sql instances delete majorana-pg-drill-pitr-20260814 --project majorana-core --quiet
Deleted [.../instances/majorana-pg-drill-pitr-20260814].

$ gcloud sql instances list --project majorana-core --format="table(name,state,tier,region)"
NAME         STATUS    TIER              REGION
majorana-pg  RUNNABLE  db-custom-1-3840  us-west1
```

**Confirmed gone, not just "delete issued":** the list above, read back after both
deletes returned, shows exactly one instance — `majorana-pg` — and nothing else.
Querying `gcloud sql operations list` against either drill instance name afterward
returns "does not have permission to access ... or it may not exist", which is the
expected error for a genuinely deleted instance (not a permissions problem — the
same principal successfully queried both instances minutes earlier). Docker
containers running the Cloud SQL Auth Proxy (`csql-proxy-prod`, `csql-proxy-restore`,
`csql-proxy-pitr`, `csql-proxy-prod2`) were stopped and removed as each was finished
with; `docker ps -a --filter name=csql-proxy` shows none remaining.

**Cost:** both instances existed for well under 25 minutes combined
(`majorana-pg-drill-restore-20260814`: 17:37–17:59 UTC, ~22 min; `majorana-pg-drill-pitr-20260814`:
17:45–17:59 UTC, ~14 min, at the REGIONAL `db-custom-1-3840` rate since `clone`
inherited it). One-time, well under $1, nothing recurring — no backups, no snapshots,
no other resources left behind.

## What this drill does and does not establish

- **Establishes:** both Cloud SQL restore paths work against real production data and
  produce byte-identical rows for anything not written during the gap; the backup-restore
  RTO is 440s and the PITR-clone RTO is 429s to correct data (both recorded above); the
  daily-backup RPO is bounded by ~24h and the PITR RPO is bounded by the point chosen
  (here, ~5 minutes, but anywhere in the 7-day transaction-log retention window).
- **Does not establish:** performance at a larger data size. Production is ~50MB; RTO here
  is dominated by fixed Cloud SQL provisioning overhead (creating an instance, attaching
  storage), not data volume, and that fixed cost will not scale linearly if the database
  grows by orders of magnitude — a future drill at a larger size is the only way to know
  that number.
- **Does not establish:** a restore performed under incident conditions (a stressed
  operator, possibly at 3am, possibly during an ongoing outage) takes the same time as one
  performed deliberately on a quiet afternoon with the commands already written. The RTO
  above is a **floor**, not a promise.
- **Does not re-verify:** every column name and type across all 33 tables (the Neon cutover
  check did this; this drill relied on the content digest, which would catch a dropped or
  corrupted column but is a weaker statement than an explicit schema diff). Worth adding if
  this drill is repeated.
