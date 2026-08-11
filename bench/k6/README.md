# bench/k6 — admission-control abuse scenarios

`abuse.js` is the demonstration behind `plans/rebuild/05-security.md` §2's "Rate limits +
quota enforcement demonstrated under k6 abuse scenario". The recorded run is
[`docs/gates/k6-abuse-2026-08-06.md`](../../docs/gates/k6-abuse-2026-08-06.md).

```bash
bench/k6/run-abuse.sh
```

Needs Docker, `k6` (`brew install k6`), and `.env.db.local` — see
`docs/runbooks/auth-dev.md § The local database`. About four minutes, every time: it rebuilds its own
database from empty on each run rather than reusing one (see below).

## What each scenario proves, and what controls it

| scenario | claim | control |
|---|---|---|
| `anon_flood` | one address above 1200/min is refused, with `Retry-After` and problem+json | `bystander` |
| `bystander` | a different address is **not** refused while that happens | — it *is* the control |
| `trusted_renderer` | our own renderer is exempt — on the **flooded address**, so only the token can explain it | the flood's own refusals |
| `oversized_body` | > 1 MiB is refused 413 before auth | `ordinary_body` |
| `quota_storm` | 40 concurrent submissions from one free account admit **exactly** the allowance | the exact count itself |
| `sustained_readers` | 120 concurrent readers are not refused by any of the above | — |

Every claim is a k6 threshold, so the run exits non-zero when the demonstration fails, and
every threshold is paired with a `count > 0` on the same scenario so a scenario that never
ran fails loudly instead of passing vacuously.

## Two things this harness learned the hard way

**A flood must be cheap.** The first run flooded with the full 384 KB catalog page. At ~20 ms
of real work per request a single worker absorbed 1188 of them inside the window — the
ceiling is 1200 — so the flood never reached the limit it was trying to prove and
`flood_refused` came back 0, which reads exactly like a broken limiter. The admission
scenarios now use `?limit=1` on the same route (the limiter answers before any handler, so
the payload is irrelevant to what is tested) and `flood_attempts` is itself a threshold, so
this failure can never again be confused with a limiter that did not refuse.

**A latency threshold here would be measuring this machine.** See the gate document's "What
this run does NOT establish". The bound is 10s and it is there to catch collapse.

**A guard whose query errors is a guard that always takes one branch.** The harness first tried to
reuse an already-published catalog, gated on `select count(*) from catalog_entries …`. There is no
`catalog_entries` table — the catalog lives in `artifacts` behind an accepted+public filter — so the
query errored every run, `|| echo 0` swallowed it, and the reuse path was unreachable while this file
advertised it. Deleted rather than corrected: any predicate written here would be a second copy of
`repos/catalog.py`'s filter, and rebuilding is one code path that is always right.

## Adding a scenario

Give it a control. A refusal test alone passes just as well against a service that refuses
everything, and this repository has shipped that class of mistake twice — a limiter whose
first shape exempted any caller sending an `Authorization` header, and a "1 MiB limit" a
chunked body walked straight through.

## Capacity profiles

`capacity.js` is the bounded launch-capacity harness for the approximately 100-user target.
It runs one iteration per VU by default, so 100 VUs create one simultaneous burst rather than
silently generating an unbounded number of requests or runs.

| profile | workload | default result requirement |
|---|---|---|
| `read_100` | 100 public catalog reads | 100 HTTP 200 responses, no unexpected response or 5xx |
| `sse_100` | 100 authenticated SSE connections to one queued/running run | 100 handled streams, no protocol error or unexpected response |
| `submit_100` | 100 authenticated `POST /v1/runs` requests | 100 HTTP 201 responses, no unexpected response or 5xx |
| `mixed_100` | 70 reads, 20 SSE connections, 10 run submissions | every operation meets its corresponding requirement |

Run one profile through the wrapper:

```bash
bench/k6/run-capacity.sh read_100
```

The default target is `http://127.0.0.1:8000`. The wrapper performs a health preflight and
writes `config.json`, the raw k6 summary, `k6.log`, and a combined `result.json` under
`bench/k6/out/capacity/`. The combined report records the commit, target, workload, thresholds,
and k6 exit code without recording the bearer token.

Authenticated profiles need `API_TOKEN`. `sse_100` also needs `CAPACITY_SSE_RUN_ID` pointing to
a queued or running test run; if it is omitted, the profile creates a chat seed run only after
the explicit write approval below. `submit_100` and `mixed_100` always create chat-mode test
runs and therefore require:

```bash
export API_TOKEN='test-token-from-the-isolated-environment'
export CAPACITY_ALLOW_WRITES=1
export CAPACITY_WRITE_APPROVAL=I_UNDERSTAND_THIS_CREATES_TEST_RUNS
bench/k6/run-capacity.sh submit_100
```

`mode=chat` avoids the execute allowance and provider execution path, but a running Worker may
still process the queued jobs. Use an isolated environment and clean up its test data afterward.
The suite does not start a Worker or make external-provider calls itself.

Non-local targets are rejected by both the shell wrapper and `capacity.js`. To use an approved
isolated staging target, set both values explicitly for that invocation:

```bash
CAPACITY_ALLOW_NONLOCAL_TARGET=1 \
CAPACITY_NONLOCAL_TARGET_APPROVAL=I_UNDERSTAND_THIS_IS_NOT_PRODUCTION \
BASE_URL='https://staging.example.invalid' \
bench/k6/run-capacity.sh read_100
```

Production-like hostnames require an additional explicit approval and should not be used for a
capacity run unless the owner has approved the impact. The wrapper has `--validate-only` for
checking scenario, target, credential, and write-scope configuration without contacting the API:

```bash
bench/k6/run-capacity.sh --validate-only read_100
```

The SSE profile uses a bounded client timeout. A timeout is counted as a handled held stream so
the run can exercise long-lived connections without hanging indefinitely; inspect
`capacity_sse_timeouts` in `result.json`. This is a connection-pressure test, not proof that
every stream delivered a terminal event. For replay-only testing, provide a terminal run and set
`CAPACITY_ALLOW_TERMINAL_SSE=1` explicitly.

The default p95 thresholds are 10,000 ms for catalog reads and submissions. They are collapse
guards, not a production SLO. Override them per test with `CAPACITY_READ_P95_MS` and
`CAPACITY_SUBMIT_P95_MS`, and record the resulting JSON report with the workload definition.
