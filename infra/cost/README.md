# What this project spends, and the two things that grow on their own

Run `./00-report.sh`. It measures the live project and applies list prices to
what it measures. It is not the bill: Google exposes actual charges only through
a BigQuery billing export, and this billing account has none (checked
2026-09-16). **Setting one up is free and would make most of this unnecessary** —
until then every figure here is arithmetic over a measurement, never an invoice.

## The reading on 2026-09-16

| | measured | ~$/month |
|---|---|---|
| Cloud SQL `majorana-pg` | `db-custom-1-3840`, **REGIONAL**, 10 GB | 102.02 |
| Cloud Run `majorana-worker` | 23.97 instance-hours/day, CPU always allocated | 49.84 |
| Cloud Run `majorana-api` | 5.40 instance-hours/day | 14.93 |
| Artifact Registry | 88.2 GB, no cleanup policy | 8.77 |
| Static IP `majorana-web-ip` | RESERVED, attached to nothing | 7.30 |
| Cloud Run `majorana-web` | 0.00 instance-hours/day | 0.01 |
| | | **≈ 183** |

The last written figure before this was "**~$76–80/mo** at zero users",
2026-08-15. It was right when written and wrong two days later, when ai-ops 91's
`db-g1-small`/ZONAL → `db-custom-1-3840`/REGIONAL upgrade landed and doubled the
largest line. Nothing about the sentence changed to show that. Re-run the script
rather than quoting this table.

## The two that grow whether or not anyone is looking

**Artifact Registry.** 732 images, 47 of them added in the seven days to
2026-09-16 (~8 GB/week), no cleanup policy, nothing ever pulls the old ones.
`10-artifact-cleanup.sh` sets one; it is in **dry run** as of 2026-09-16, so
Artifact Registry logs what it would delete and deletes nothing. Read that log
before `--enforce`. `05-in-use-images.sh` is the gate on that: it reads which
images the live Cloud Run services still need and refuses the enforce if one of
them falls outside the keep window. Three do today, all of them older than 30
days, and one is the revision serving 100% of `majorana-api-vqe-test`'s traffic
on a service that scales to zero.

**Cloud Run revisions.** 1455 active against a quota of **4000**
(`ActiveRevisionsPerProject`, read from the Cloud Quotas API — `gcloud services
quota list` does not exist in gcloud 575. The ceiling is per project and
dimensioned by region, which for this project, deploying only to `us-west1`,
comes to the same thing). Two services gain one per deploy. `20-revision-reaper.sh`
removes the ones no traffic can reach, keeping the newest 50 of each service plus
anything serving or latest-ready: 1340 removable, about 115 kept. An idle
revision bills nothing, so the bill will never warn you and **deploys fail when
the quota arrives**.

*When* it arrives depends entirely on which growth rate you believe, and the
honest answer is a spread rather than a date. Counted from the revisions' own
`createTime`, the last 7 days ran at 12.6/day, the last 30 at 10.5/day, and the
all-time average since 2026-07-10 at 21.1/day. Against 2545 of headroom those
give roughly April 2027, May 2027 and January 2027. An earlier version of this
file said "roughly three months", which corresponds to about 28.6/day — faster
than any of the three measured windows. Treat the recent rate as the planning
number and re-measure rather than trusting this paragraph: what actually moves it
is how often `dev` is pushed.

## What is not in here, because it is the owner's call

Two lines are large, deliberate, and already ruled on. Neither is touched by any
script here.

**Cloud SQL high availability — $51/month of the $102.** `REGIONAL` runs a
standby in a second zone and doubles the price. It was chosen in ai-ops 91.
Worth re-asking rather than re-deciding, because of what the utilisation says:
over the seven days to 2026-09-16 the database's CPU had a median of **11.6%**
and sat at or above 80% for **2.6 of 168 hours** — and those 2.6 hours are one
contiguous burst on 15 September, the outage. A standby in another zone would
not have helped that: it is not serving reads, and the primary was not
unavailable, it was saturated. So the money is buying protection against a zone
failure, which has not happened, and not against the one bad day this database
has actually had.

**The worker's always-on instance — $49.84/month.** `cpu-throttling: false` plus
`minScale: 1` is instance-based billing, and the worker polls the job queue
every 2 seconds, so it genuinely cannot be throttled or scaled to zero as
written. Changing that is an architecture change (wake on Cloud Tasks or Pub/Sub
push), not a setting. `minScale: 1` is itself his ai-ops 101 ruling.

## Vercel

The Vercel bill is **builds**, not traffic — measured from the console on
2026-08-14 and unchanged in shape since: Build CPU Minutes were 57% of it while
ISR, Fast Data Transfer and Edge Requests were all $0 inside their allowances.
`scripts/vercel-ignore-build.sh` is where that is dealt with, and
`scripts/check-vercel-ignore-build.mjs` is what keeps it honest.

Measured from Vercel's deployment API over the seven days to 2026-09-16: **190
deployments, 142 of them previews**, 130 of the 184 wall-clock build minutes.
Nothing consumes a preview — `verify-web-cache.yml` is the only workflow that
reacts to a Vercel deployment and it gates on `environment == 'Production'`.
Previews are now skipped by default; `LEONA_VERCEL_PREVIEWS=1` on the project, or
`[preview]` in a commit message, still builds one.
