# k6 abuse scenario — `POST /v1/tour-signals` (ai-ops 326), two attempts, both inconclusive on this host

The evidence, or the honest lack of it, for `plans/rebuild/05-security.md` §1a/§2 on the
new route added by ai-ops 326. Harness: `bench/k6/abuse.js` (extended with `tour_signal_*`
scenarios), driven by `bench/k6/run-abuse.sh`. **Both attempts below FAILED (k6 exit 99).**
This route ships with `Settings.tour_signals_enabled` defaulting to `False` as a direct
consequence — see that setting's docstring and `routes/tour_signals.py`'s module docstring.

## What was run, twice

| | attempt 1 | attempt 2 |
|---|---|---|
| date | 2026-09-23 12:46–12:49 PDT | 2026-09-23 13:05–13:08 PDT |
| k6 | v2.1.0 (darwin/arm64) | v2.1.0 (darwin/arm64) |
| service | `majorana_api.app:create_app` under uvicorn, one worker, 127.0.0.1:8000 | same |
| database | local PostgreSQL 17 in Docker, database `majorana_k6` | same |
| host `uptime` immediately before | load averages **189.95 257.43 184.60** on a 10-core Mac | load averages **126.79 210.24 184.95** |
| `tour_signal_flood`/`tour_signal_bystander` scheduling | concurrent with `quota_storm` (both start inside 22–90s) | fully serialised after every other scenario (145s, once `sustained_readers` has finished at 140s) |
| result | **FAILED**, k6 exit 99 | **FAILED**, k6 exit 99 |

The second attempt fixed the one thing under this PR's own control — scheduling the new
scenarios so they cannot contend with `quota_storm` for the same database connection pool
— and still failed, on the SAME threshold family the unmodified, pre-existing scenario
also failed. That is the finding: this is host contention, not a defect in the new route.

## The control that says so: the pre-existing, unmodified scenario failed too

Neither attempt touched `anon_flood`, `bystander`, `trusted_renderer`, `oversized_body`,
`ordinary_body`, `quota_storm` or `sustained_readers` — they are byte-for-byte the same
code `docs/gates/k6-abuse-2026-08-06.md` recorded passing on 2026-08-06. On this host, on
this date, they did not:

```
attempt 1: flood_attempts ....... 875   (threshold: count>900 — FAILED)
           flood_refused ......... 0    (threshold: count>0   — FAILED)
           server_errors ........ 60    (threshold: count==0  — FAILED)

attempt 2: flood_attempts ....... (same threshold family — FAILED)
           flood_refused ......... 0    — FAILED
           http_req_duration{scenario:sustained_readers} p(95)=36.65s
                                        (threshold: p95<10000 — FAILED, a COLLAPSE bound)
```

`flood_attempts` failing to exceed 900 in a 20-second `constant-arrival-rate` scenario at
135 iterations/s means the k6 load generator itself — not the service under test — could
not sustain the target rate. `dropped_iterations` was 4557 (attempt 1) and 5323 (attempt
2) against roughly 4000 and 1700 completed iterations respectively: k6 gave up scheduling
more than it ran. The `sustained_readers` p95 of 36.65s against a 10-second COLLAPSE bound
(not a capacity claim — see the 2026-08-06 gate's own caveat) is the same signal from the
service side: a request that answers in 19ms unloaded took up to 37.7 seconds. Both are
what an oversubscribed host looks like from inside a load-generating test, not what a
broken rate limiter or a broken service looks like.

This diagnosis is not a guess. `uptime` was read immediately before each attempt and shows
sustained (not momentary — three windows, all elevated) load averages of 126–257 on a
10-core machine — 12 to 25× nominal capacity — consistent with several other agent
sessions running heavy Python/Postgres/TypeScript work in parallel worktrees on the same
host throughout this work (confirmed via `ps aux` at the time: multiple `pytest`,
`uvicorn`-adjacent, and `tsc` processes from `majorana-wt-s0923-*` sibling worktrees other
than this one).

## What the new route's OWN scenarios showed, despite the host

Every `tour_signal_*` claim that does NOT depend on the generator reaching a numeric
ceiling **passed, in both attempts**:

```
attempt 1: tour_flood_served .......... 126   (some requests served before/without refusal)
           tour_bystander_served ......... 8   tour_bystander_refused ......... 0
           tour_oversize_refused ........ 12   tour_oversize_accepted ......... 0
           tour_ordinary_not_refused .... 12

attempt 2: tour_flood_served .......... 304   tour_flood_unexpected .......... 0
           tour_bystander_served ........ 12   tour_bystander_refused ......... 0
           tour_oversize_refused ........ 12   tour_oversize_accepted ......... 0
           tour_ordinary_not_refused .... 12
```

- **The route's own 1 KiB body cap (`MAX_TOUR_SIGNAL_BODY_BYTES`) held, both times**: 12
  oversized bodies refused 413, 0 accepted, 12 ordinary signals not refused. This is
  independent of the flood's rate problem — it is `per-vu-iterations` (12 requests total),
  not a sustained-rate scenario, so host contention could slow it but not stop it from
  completing.
- **The bystander was never refused while the (undersized) flood ran**, in either attempt
  — `tour_bystander_refused == 0` both times, on 8 and then 12 reads.
- **`tour_flood_unexpected` was 0 in attempt 2** (it was 60 in attempt 1, matching that
  attempt's `server_errors` exactly — see "What attempt 1 also found" below): every
  response the flood received in attempt 2 was cleanly 204 or (had the ceiling been
  reached) would have been 429; nothing came back malformed or 5xx.
- **What did NOT get demonstrated in either attempt**: the flood actually crossing
  `DEFAULT_ANON_LIMIT` and being refused with `anonymous_rate_limited`. `tour_flood_refused
  == 0` both times, because `tour_flood_attempts` (186, then 304) never reached the
  ceiling (900) the generator was asked to exceed.

## What attempt 1 also found, and fixed before attempt 2

Attempt 1 scheduled `tour_signal_flood`/`tour_signal_bystander` at 22–42s, which overlaps
`quota_storm` (30–90s in the schedule, though it finished faster in practice). Attempt 1's
`server_errors` (60) and `tour_flood_unexpected` (60) were EXACTLY equal — every 5xx in
that whole run happened during the tour-signal flood, while it shared the database
connection pool with 40 concurrent `quota_storm` submissions. No traceback appears in
`bench/k6/out/api.log` for any of them, which is consistent with `app.py`'s
`_pool_exhausted` handler: a deliberate, unlogged 503 `capacity_exhausted` response —
correct behaviour under real overload, not a bug — that `abuse.js`'s generic
`noteStatus()` (`status >= 500`) cannot distinguish from one. `bench/k6/abuse.js` was
changed to run the `tour_signal_*` scenarios fully serialised after `sustained_readers`
(starting at 145s) specifically to remove this confound, and attempt 2's `server_errors
== 0` confirms it worked: the pool-contention artefact is gone, and only the
generator-throughput problem (shared with the pre-existing scenario) remains.

## What this means for shipping

`05-security.md` §2's "k6 abuse scenario" item is not met, and this file says so rather
than rounding up. `personal_access_tokens_enabled` (ai-ops 362) is the standing precedent
for exactly this situation — a security-reviewed feature whose k6 run has not landed ships
behind a flag defaulting off, rather than either blocking the PR indefinitely or merging
unreviewed. `Settings.tour_signals_enabled` defaults to `False`; `POST /v1/tour-signals`
answers 404 until the owner flips it on, which should happen after a k6 run completes
cleanly — on this host once it is quieter, or in CI, where `bench.yml` already runs
`postgres:17` in isolation.

Everything else the gate asks of a new anonymous route (05-security.md §1a) is met and
evidenced elsewhere in this PR: input validation and the size cap, both mutation-tested;
`services/api/tests/test_rate_limit.py`'s two new tests proving the shared anonymous
ceiling covers this path (with a lowered test ceiling, so they do not depend on reaching
900); and `test_tour_signals_live.py::TestNothingIdentifying` proving nothing identifying
reaches the table or a log line.

## Reproducing

```bash
bench/k6/run-abuse.sh
```

Same requirements as the 2026-08-06 run (Docker, `k6`, `.env.db.local`). Check `uptime`
first — this file's own finding is that the result depends on it.
