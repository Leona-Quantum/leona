# 100-user capacity gate

Status: **first result recorded 2026-08-14** (below). The harness had existed since it was
added and had never once been run, so every capacity figure quoted for this product before this
date was an estimate.

This gate is driven by [`bench/k6/capacity.js`](../../bench/k6/capacity.js) and
[`bench/k6/run-capacity.sh`](../../bench/k6/run-capacity.sh). It is intentionally separate from
the admission-control run in [`k6-abuse-2026-08-06.md`](./k6-abuse-2026-08-06.md): this gate
measures a bounded 100-VU burst and does not claim that the local machine represents Cloud Run.

## Recorded result — `read_100`, 2026-08-14

Three runs at `a3c8b43a`, k6 v2.1.0, against `http://127.0.0.1:8000` with the real published
corpus (369 records, `published=369 blocked=0`). Latency is
`http_req_duration{capacity_operation:catalog_read}`, milliseconds.

| run | p50 | p90 | p95 | max | failed | 5xx |
|---|---|---|---|---|---|---|
| 1 | 839.7 | 1347.2 | 1396.0 | 1429.0 | 0 / 101 | 0 |
| 2 | 796.5 | 1321.2 | 1361.0 | 1403.9 | 0 / 101 | 0 |
| 3 | 873.8 | 1424.2 | 1480.8 | 1498.9 | 0 / 101 | 0 |

All three exited 0 with no threshold breached. p95 spread is about ±4%. A supplementary fourth
run with `K6_SUMMARY_TREND_STATS` set gave p99 = 1.33 s — with n=100 that is one sample, and it
is the reason this wrapper now exports p99 by default.

### What the number is evidence for

That the read path serves 100 simultaneous anonymous readers with **zero errors**, that the
published corpus reads end to end, and that at this concurrency **the binding constraint is the
database connection pool**, not CPU and not the query.

That last part was measured rather than inferred: sampling `pg_stat_activity` during a run
showed the API's backends pinned at exactly 10 for the run's whole duration.
`services/api/src/majorana_api/db.py` sets `DEFAULT_POOL_SIZE = 5` and
`DEFAULT_MAX_OVERFLOW = 5`, and the API never overrides either — only the worker does
(`.github/workflows/deploy.yml`, the `deploy worker` step). So ten connections, fully
saturated, against a `containerConcurrency` of 80. An uncontended request is ~27 ms median; a
hundred arriving together inflate the median about thirtyfold. It queued; it did not time out.

### What the number is NOT evidence for

**Not production capacity.** This gate has always said it does not claim the local machine
represents Cloud Run, and that caveat is doing real work here. Production is 1 vCPU, 512Mi,
`containerConcurrency: 80`, `maxScale: 2` — pinned in `infra/fleet.env` (`API_CPU`,
`API_MEMORY_MI`, `API_CONCURRENCY`, `API_MAX_INSTANCES`) as of `infra/pin-api-cloud-run-shape`,
2026-08-14; before that these numbers were live-service state with no declared source, and this
sentence was the closest thing to one. This ran one uvicorn process on ten M1 Pro cores
against loopback Postgres with no network round trip, where Cloud SQL has a real one. The
arithmetic differs in both directions: production gets two instances × ten connections, but one
vCPU each, and a 1-vCPU instance serialising a 400 KB JSON response is the part most likely to
be worse there. No measurement of that exists.

The machine was also a working laptop, not a quiet bench — load average 7.77 on 10 cores
immediately before the first run.

**Not a throughput figure.** `read_100` is 100 VUs × one iteration: a hundred requests inside
about 1.5 seconds. The `iterations/s` k6 prints (~65) is that burst divided by that wall clock,
and must not be quoted as "the product serves 65 requests per second".

**Two ways this file's own artefacts mislead**, both now fixed in the wrapper but true of every
`result.json` written before this date:

- k6's summary export records a threshold's boolean as *breached*, so a **passing** threshold
  appears as `"p(95)<10000": false`. Read it backwards and a clean run looks like a failure.
- `CAPACITY_MIN_CATALOG_ENTRIES` defaulted to **1**, so the profile would print
  `CAPACITY SUITE PASSED` against a catalogue holding a single record. The default is now 300.

## Re-run after the payload cut: the p95 did not move, and that is the finding

The section below said to re-run before tuning admission, because the list payload had just been
cut and tuning against a stale measurement would be tuning against a system that no longer
exists. **The re-run happened. The payload change makes no difference to this number.**

Three `read_100` runs at `26b5d849` — current `dev`, carrying all four list projections — against
a local stack with the real 369-record published corpus (`observed_catalog_entries: 369` in every
`config.json`, floor set to 369):

| run | p50 | p95 | p99 | max | requests | server errors | exit |
|---|---|---|---|---|---|---|---|
| 1 | 858 ms | **1484 ms** | 1518 ms | 1527 ms | 101 | 0 | 0 |
| 2 | 807 ms | **1401 ms** | 1426 ms | 1427 ms | 101 | 0 | 0 |
| 3 | 790 ms | **1394 ms** | 1416 ms | 1418 ms | 101 | 0 | 0 |

Against the three runs at `a3c8b43a`, before any of it: p50 796–874 ms, p95 **1361 / 1396 /
1481 ms**. The two sets are the same numbers. Every threshold passed in all six runs (and
remember k6 records a *passing* threshold as `false` — the boolean means breached).

**This is a confirmation by intervention, which is stronger than the two the diagnosis already
had.** The pool-bound reading was reached twice by observation — sampling `pg_stat_activity`
during a run, and reading `DEFAULT_POOL_SIZE = 5` + `DEFAULT_MAX_OVERFLOW = 5` against a
`containerConcurrency` of 80. Now something was *changed*: the response body shrank by roughly
60% (1,539,091 → 609,581 by `JSON.stringify` length) and the latency did not move. If bytes were
the constraint, that had to show. It did not, so they are not.

Note what this run does and does not include. `read_100` hits the API directly, so the
`Cache-Control` work has no effect on it at all — k6 is not a caching client, and the only
variable that changed between the two sets of runs is the size of the response. That is what
makes the comparison clean.

**So the deferral below is discharged and the concurrency question is unblocked.** Lowering
`--concurrency` toward what ten connections can serve is the remaining lever, it is free, and it
is no longer waiting on anything. The payload work was worth doing for bytes on the wire, the
CDN, and the Vercel data-cache ceiling — it was never going to move this number.

**Still not production capacity.** One uvicorn process on ten M1 Pro cores against loopback
Postgres, on a working laptop at load average 6.21 (10 cores). Production is 1 vCPU on Cloud Run
with a real Cloud SQL round trip. And `read_100` is 100 VUs × one iteration — about a hundred
requests in a second and a half — so the `iterations/s` k6 prints is a burst divided by a wall
clock, not a throughput figure.

**One more inversion in the artefacts, for whoever reads a `result.json` next.** In
`http_req_failed`, k6's `passes` counts the requests that FAILED and `fails` counts those that
did not. These runs record `{"fails": 101, "passes": 0, "value": 0}` — that is **zero failures**,
and `value` is the only field of the three that reads the way it sounds.

## What the fix is (the reasoning below is superseded by the re-run above, and kept for it)

The finding above — pool-bound, ten connections against a `containerConcurrency` of 80 — has
two candidate fixes, and the obvious one is currently the wrong one.

**Raising the API pool costs budget that a deploy already spends.** `db.py`'s
`fleet_peak_connections()` computes `API_MAX_INSTANCES × (POOL + OVERFLOW)` for the API and
doubles only the worker term. The budget is 45 (a `db-g1-small`'s 50, less 3 superuser and 2
operational), and the API is `2 × 10 = 20` of it. Doubling the pool to `8 + 8` would take the
API term to 32 and the resting total to 40 — inside 45, but with the API's own rollout
behaviour unaccounted for (below), and with nothing left for the worker count to grow into.

**Lowering `containerConcurrency` toward the pool is free**, and it is the change this file
would otherwise recommend. But it should not be made against this measurement, because two
changes shipped the same day attack the same bottleneck from in front of it:

- the list payload is **35.9% smaller** (`metadata` dropped, `resources` projected to the one
  row a card renders, `visualization` reduced to the register except on gates), and
- the six public catalog GETs now carry `Cache-Control: public`, so a shared cache absorbs
  repeat reads that previously each re-ran the query plus the Python cost/profile computation.

Both reduce work per request and requests per reader. Tuning admission against a p95 measured
before either would be tuning against a system that no longer exists. **Re-run `read_100`
first**, then decide — and the re-run is cheap, which is the whole reason the harness exists.

### The asymmetry in the connection budget, stated because it looks like an omission

`fleet_peak_connections(during_worker_rollout=True)` doubles the **worker** term and not the
**API** term, and the reason is not that the API cannot have two revisions at once — it can.
It is that the two revisions hold connections for different reasons:

- `--min-instances` is a revision-level setting. While a worker deploy is in flight the
  outgoing revision is still in the traffic split and still holding its **floor**, so 2N worker
  instances is guaranteed, not merely possible.
- The API has **no** `--min-instances`. Its outgoing revision holds whatever traffic demanded
  and then drains, so its instance count during a rollout is a function of load, not a floor.

The pessimistic figure is worth writing down anyway, because it is close: two revisions × 2
instances × 10 connections is **40**, plus a worker at rest (4) is **44 of 45**. That is
reached only if a deploy's traffic shift lands inside a burst big enough to have scaled both
revisions out, and it is one connection from the ceiling. It is not gated on, because a gate on
a load-dependent worst case would fail on a quiet week for reasons nobody could reproduce — but
anyone raising `API_MAX_INSTANCES`, the API pool, or the worker count should compute this
number first rather than the resting one.

## Workload definition

The default run uses 100 VUs and one iteration per VU.

| profile | operation mix |
|---|---|
| `read_100` | 100 public `GET /v1/catalog/entries` requests |
| `sse_100` | 100 authenticated `GET /v1/runs/{run_id}/events/stream` requests |
| `submit_100` | 100 authenticated `POST /v1/runs` requests in `chat` mode |
| `mixed_100` | 70 catalog reads, 20 SSE connections, 10 chat submissions |

The default p95 collapse guards are 10 seconds for the read and submit operations. The test
does not treat those values as a production SLO; the owner must set a target SLO separately.

## Required evidence

Each run must preserve the generated `result.json` and record:

- commit SHA and k6 version;
- target URL and whether it was local or isolated staging;
- VU count, timeout, catalog page size, and all thresholds;
- k6 exit code and raw summary;
- HTTP status counters and 5xx counters;
- SSE accepted, timeout, protocol-error, and unexpected counters;
- database pool, Cloud Run, and Worker queue observations from the test environment.

The first five fields are emitted by the wrapper. The database, Cloud Run, and Worker values must
come from the environment's monitoring tools; this k6-only change does not add observability.

## Safe execution

The wrapper and k6 script reject non-local targets unless the operator supplies the exact
non-local-target approval variables. Production-like hostnames need a second explicit approval.
Write profiles also require a separate write approval. No profile starts a Worker, performs a
migration, drops a database, or calls a provider directly.

Example local read validation:

```bash
bench/k6/run-capacity.sh --validate-only read_100
bench/k6/run-capacity.sh read_100
```

For `sse_100`, use a queued/running test run from the isolated target through
`CAPACITY_SSE_RUN_ID`. If the profile creates the seed run, it uses `mode=chat`; a Worker may
still process that run, so the target must be isolated. A client timeout is expected for a held
stream and is recorded as `capacity_sse_timeouts`; it is not evidence that the stream completed.

## Where the environment evidence actually comes from

The "Required evidence" list above asks for database pool, Cloud Run, and Worker queue
observations and says they "must come from the environment's monitoring tools". As of #373 two of
those three have named instruments in this repository — only Cloud Run does not — so the
operator does not have to invent them. SSE activity is instrumented too, which the list above
does not ask for but which a `sse_100` or `mixed_100` run needs to interpret its own numbers. Read them from the same OpenTelemetry export as the existing
`majorana.db.query.duration`:

| evidence the gate asks for | instrument | shipped by |
|---|---|---|
| database pool saturation | `majorana.db.pool.checkout.wait` (histogram, seconds) | #373 |
| pool exhaustion | `majorana.db.pool.checkout.timeouts` (counter) | #373 |
| Worker queue backlog | `majorana.jobs.queue_depth` (histogram, ready-to-claim jobs) | #373 |
| Worker concurrency | `majorana.jobs.in_flight` (up-down counter, per process) | #373 |
| SSE load during `sse_100` / `mixed_100` | `majorana.sse.active_streams`, `majorana.sse.polls`, `majorana.sse.disconnects` | #373 |
| Cloud Run scheduling and autoscaling | *no in-repo instrument* — still the platform's own metrics | — |

The worker's own contention budget, which a capacity run is really testing, is stated in
[`services/worker/AGENTS.md`](../../services/worker/AGENTS.md): *claim latency <100ms p95 @20
workers (bench B-Q3) — breach = queue ADR*. `bench/worker/queue_throughput.py` does not measure
it (no database), so a breach can only come from a real run against a database.

Two cautions, both load-bearing when reading a capacity run:

- `majorana.db.pool.checkout.wait` measures **acquisition**, not queue wait alone: it wraps
  `Pool.connect`, so it includes physical connection creation. A cold pool inflates it for
  reasons that are not saturation. Its own docstring says so; do not quote it as queue wait.
- `majorana.jobs.queue_depth` is **sampled on a wall clock**, not measured per poll: a `Sweep`
  gated by `WORKER_QUEUE_METRICS_INTERVAL_S` (default 15 s), with the first sample always due at
  worker start. So a 100-VU burst that arrives and drains inside one interval can pass through
  leaving no trace in this histogram, and the sample you do see may predate the burst. Lower the
  interval for the run, or read `majorana.jobs.claimed` / `majorana.jobs.queue_age_seconds`
  instead — those are per-job, not sampled.

## Worker control-flow benchmark (this one WAS run)

Recorded here because it is the only measured number this gate currently has — and it is
deliberately *not* a capacity result. It exercises `majorana_worker.run_forever()` with the
repository and handler boundaries replaced by an in-memory queue: no database, no provider, no
network, no Cloud Run.

```text
Date/time (UTC): 2026-08-11
Commit:          dev at 62a16167
Command:         uv run python bench/worker/queue_throughput.py
Result:          100/100 jobs, status "passed", ~8.0k-10.0k jobs/s, 1 worker
Command:         uv run python bench/worker/queue_throughput.py --jobs 100 --workers 4 --handler-delay-ms 1
Result:          100/100 jobs, status "passed", ~2.7k jobs/s, max_handler_concurrency 4
Invariants:      all_jobs_finished_once, all_attempts_are_one, external_database_called=false,
                 provider_preflight_called=false — true on both runs
Interpretation:  NO capacity claim. Worker claim/heartbeat/finish control flow is not the
                 bottleneck at this scale; every real constraint (Postgres FOR UPDATE SKIP
                 LOCKED contention, pool behaviour, Cloud Run scheduling, provider latency)
                 is excluded by construction.
```

Two orders of magnitude of headroom in a harness that talks to no database says nothing about
the gate this document exists to hold.

## The three write/stream profiles, run for the first time (2026-08-14)

`submit_100`, `sse_100` and `mixed_100` had been defined, documented and never executed. They
have now been executed. **All four profiles exit 0 with zero 5xx and zero unexpected
responses.**

```text
Date/time (UTC): 2026-08-14
Target:          http://127.0.0.1:8000  (local; no non-local approval variable was set)
Commit:          86e657c7 — NOTE: a worktree carrying three unmerged fixes (pool_timeout+503,
                 the conversation N+1 batch, and the runs(workspace_id, id DESC) index),
                 not plain dev. Stated because it is the tree that was measured.
k6 version:      v2.1.0
Stack:           local postgres:17, alembic head 0051, system catalog published=369 blocked=0
Result JSON:     bench/k6/out/capacity/{read_100,submit_100,sse_100,mixed_100}-20260814T12*/result.json
```

| profile | counters | p95 | exit |
|---|---|---|---|
| `read_100` | 100 read_success, 0 unexpected, 0 5xx | 1.38 s (see the load caveat) | 0 |
| `submit_100` | **100 attempts, 100 created (201)**, 0 unexpected, 0 5xx | **632.6 ms** | 0 |
| `sse_100` | **100 attempts, 100 handled**, 0 protocol errors, 0 unexpected, 0 5xx | held to the client bound | 0 |
| `mixed_100` | 70 reads + 20 SSE + 10 submits, 0 unexpected, 0 5xx | read 1.07 s, submit 655 ms | 0 |

**`sse_100` reports 100 timeouts, and that is the profile working rather than failing.** No
Worker runs during a capacity profile, so a queued run emits no events and every stream is held
until the client's own bound. What the run establishes is that **100 concurrent SSE connections
were accepted and held simultaneously with no protocol error and no 5xx** — connection
pressure, which is what it claims. It is not evidence that a stream delivers a terminal event.
`http_req_failed: 98%` is the same artefact: a deliberately-timed-out held stream is counted as
a failed HTTP request.

**Submission is cheaper than reading**: 632 ms p95 against 1.38 s for a catalog read, on the
same stack. A submission is a few small INSERTs; a browse read materialises a hundred rows.

### What these runs do NOT establish, stated as plainly as the numbers

**They do not produce T, the wall-clock duration of a real run.** `submit_100` measures
admission — `POST /v1/runs` returns 201 once the row and the job are written, before anything
executes. The harness starts no Worker and makes no provider call **by design**, so no profile
here can say how long a queued user waits. T needs either a real pipeline execution (real
provider tokens, real sandbox minutes) or, better and free, a read of production's own history:

```sql
SELECT count(*),
       percentile_cont(0.50) WITHIN GROUP (ORDER BY finished_at - started_at) AS p50,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY finished_at - started_at) AS p95
FROM runs WHERE status = 'succeeded'
  AND started_at IS NOT NULL AND finished_at IS NOT NULL;
```

**The latency figures are this machine's, and this machine was loaded.** The runs above were
taken at a 1-minute load average between **30 and 43 on 10 cores** — several unrelated agent
sessions were building and testing concurrently. The earlier `read_100` record in this document
was taken at load 6.21 and reported 1.36–1.48 s; three consecutive `read_100` runs at load ~37
reported **2.81 / 2.46 / 3.09 s**. Same commit, same stack, same profile. **The spread is the
machine, not the service** — which is the caveat this document already raised, now with a
number attached to it.

## The bottleneck is the API process's CPU, not the connection pool

This is a correction to the finding recorded earlier in this document, and it is a correction
about *inference* rather than about the earlier measurement, which reproduces.

`pg_stat_activity` pinned at exactly 10 backends showed the pool **fully utilised**. That is
not the same as the pool being the constraint, and three measurements say it is not:

| experiment | result | reading |
|---|---|---|
| `/health` (no DB, no rows) at 100 concurrent | p95 **17.3 ms** | 100 concurrent connections are not a problem in themselves |
| catalog read at the same 100 concurrent | p95 **1.26 s** | **73× the no-DB endpoint** on the same process |
| API process CPU during that burst | **92–99% of one core** | the Python process is saturated |
| Postgres container CPU during the same burst | **23%** | the database is not |
| response 770 KB → 182 KB (`view=list`), warmed, 3 rounds | 1.43–1.49 s → 1.38–1.39 s | payload is a ~4% term |

The API saturates a core while Postgres idles. **Production matches this shape**: the image's
`CMD` runs `uvicorn` with no `--workers`, so one Python process per instance, at `API_CPU=1` —
one vCPU. Read capacity is therefore about two cores of Python across the fleet.

The remedies differ completely from the pool reading, which is why the distinction is worth
the correction: more connections and a larger database tier do not address a saturated
interpreter. Reducing per-request Python work does, and so does CPU — and **`API_CPU` is not a
term in the connection budget** (`infra/fleet.env` says so), which makes it the one scaling
knob not blocked by the 50-connection ceiling.

**One caveat, honestly: raising `--workers` is NOT free of the budget.** The pool is per
process (`db.py`: "Per process"), so two uvicorn workers at today's sizes would double
connections per instance. Holding the budget means splitting it — e.g. two workers at 2+3 each
rather than one at 5+5. **That A/B was attempted and could not be measured here**: variance
within a single configuration ran 1.34 s to 5.27 s at this machine's load, swamping the effect.
It needs a quiet machine, or Cloud Run itself.

## Result template

For a run not yet performed. A run that was not performed must remain explicitly marked as not
run.

```text
Date/time (UTC): not run
Target: not run
Commit: not run
k6 version: not run
Scenario: not run
Result JSON: not run
Interpretation: no capacity claim
```
