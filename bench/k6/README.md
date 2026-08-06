# bench/k6 — admission-control abuse scenarios

`abuse.js` is the demonstration behind `plans/rebuild/05-security.md` §2's "Rate limits +
quota enforcement demonstrated under k6 abuse scenario". The recorded run is
[`docs/gates/k6-abuse-2026-08-06.md`](../../docs/gates/k6-abuse-2026-08-06.md).

```bash
bench/k6/run-abuse.sh
```

Needs Docker, `k6` (`brew install k6`), and `.env.db.local` — see
`docs/runbooks/auth-dev.md § The local database`. Takes about four minutes the first time
(the catalog import) and about two and a half after.

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

## Adding a scenario

Give it a control. A refusal test alone passes just as well against a service that refuses
everything, and this repository has shipped that class of mistake twice — a limiter whose
first shape exempted any caller sending an `Authorization` header, and a "1 MiB limit" a
chunked body walked straight through.
