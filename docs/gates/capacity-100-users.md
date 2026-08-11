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
