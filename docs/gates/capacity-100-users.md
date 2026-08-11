# 100-user capacity gate

Status: **harness added; no capacity result recorded by this change**.

This gate is driven by [`bench/k6/capacity.js`](../../bench/k6/capacity.js) and
[`bench/k6/run-capacity.sh`](../../bench/k6/run-capacity.sh). It is intentionally separate from
the admission-control run in [`k6-abuse-2026-08-06.md`](./k6-abuse-2026-08-06.md): this gate
measures a bounded 100-VU burst and does not claim that the local machine represents Cloud Run.

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

The k6 result template below remains **not run**. Two orders of magnitude of headroom in a
harness that talks to no database says nothing about the gate this document exists to hold.

## Result template

When a real run is performed, replace this section with the actual command, environment, result
path, and interpretation. A run that was not performed must remain explicitly marked as not run.

```text
Date/time (UTC): not run
Target: not run
Commit: not run
k6 version: not run
Scenario: not run
Result JSON: not run
Interpretation: no capacity claim
```
