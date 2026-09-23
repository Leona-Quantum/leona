# k6 abuse scenario — personal access tokens, the run, 2026-09-23

The evidence PR 973 left owed before `LEONA_PERSONAL_ACCESS_TOKENS` could be switched
on, under `plans/rebuild/05-security.md` §2 and the owner's ruling on ai-ops 362 (option
1: *"Tokens may read and start verified runs, and expire after at most 90 days; hardware
jobs come later under their own permission"*). Three of that gate's items were already
met on PR 973 (authz rows, logs proven token-free, the gitleaks rule); this is the
fourth — the k6 abuse run against the per-token ceiling.

Harness: `bench/k6/pat-abuse.js`, driven by `bench/k6/run-pat-abuse.sh`, with tokens
minted by `bench/k6/mint_pat_fixtures.py`. All three are in the repository and the run is
repeatable. This file records one execution and what it does and does not establish, in
the same shape as `docs/gates/k6-abuse-2026-08-06.md`.

## What was run

| | |
|---|---|
| date | 2026-09-23 |
| k6 | v2.1.0 (darwin/arm64) |
| service | `majorana_api.app:create_app` under uvicorn, **one worker**, 127.0.0.1:8001 |
| database | local PostgreSQL 17 in Docker, database `majorana_k6_pat`, migrations at `0069` (head) |
| feature switch | `LEONA_PERSONAL_ACCESS_TOKENS=true`, confirmed live by probing `GET /v1/tokens` for a non-404 before the run started |
| ceiling | the **real default**, read out of `rate_limit.py` at run time — `DEFAULT_TOKEN_LIMIT` = 600/min per token. `TOKEN_RATE_LIMIT_PER_MINUTE` is never set by the harness, so the service runs at whatever that source constant says, not at a number copied into a script |
| fixtures | six personal access tokens, each on its own freshly-provisioned user, minted through `repos/personal_access_tokens.py` directly — never through WorkOS and never through a browser session |
| duration | 30s (the flood scenario's own window), ~31s wall clock total |

`run-pat-abuse.sh` greps `DEFAULT_TOKEN_LIMIT` out of the source and fails if it cannot
read it, the same guard `run-abuse.sh` puts on `DEFAULT_ANON_LIMIT` — a run that
demonstrated a softened ceiling by accident is not possible without editing the service,
and a mutation below confirms that claim rather than asserting it.

## Result: every threshold held

```
pat_expired_401................: 3      pat_expired_unexpected.........: 0
pat_flood_attempts.............: 1200   pat_flood_served...............: 600
pat_flood_refused..............: 600    pat_flood_unexpected...........: 0
pat_hardware_refused...........: 2      pat_hardware_unexpected........: 0
pat_readonly_refused...........: 2      pat_readonly_unexpected........: 0
pat_revoked_401.................: 3      pat_revoked_unexpected.........: 0
pat_run_admitted................: 1      pat_run_unexpected.............: 0
pat_second_served...............: 84     pat_second_refused.............: 0
server_errors...................: 0
```

`PAT ABUSE SUITE PASSED — every threshold held.`

### The per-token ceiling is exact

`pat_flood_served` is **600**, against the real, unmodified default of **600/min**, and
`600 + 600 = 1200 = pat_flood_attempts`. Every request past the 600th was refused and none
before it was — the threshold asserts `count==600` rather than merely `count>0`, so a
service that quietly admitted more (a ceiling that drifted, or a limiter reading the
wrong setting) would fail this run rather than pass it by accident. Each refusal was a
429 with `application/problem+json`, `reason: token_rate_limited`, and a `Retry-After`
of at least one second — `pat_flood_unexpected` counts anything short of that and is 0.

### And it is per TOKEN, not per account, per address, or global

`pat_second_served` is **84**, `pat_second_refused` is **0** — a second, unrelated token,
on its own account, reading the exact same route (`GET /v1/me`) at a human pace for the
whole 28 seconds the flood ran. `FLOOD_TOKEN` and `SECOND_TOKEN` share no user, no
workspace, and (deliberately, in this harness) no client address either. If the limiter
were keyed on anything but the token's own id — the caller's address, the caller's
account, a single shared bucket — `SECOND_TOKEN` would have been refused too, the same
way `bystander` in `abuse.js` is the control that matters more than the flood's own
refusals.

### Lifecycle: revoked and expired are refused at the boundary, and only that way

`REVOKED_TOKEN` was minted and revoked before this file's harness ever started k6;
`EXPIRED_TOKEN` was minted at the shortest lifetime the API allows and then aged three
seconds past its own `expires_at` with a direct database UPDATE (the same escape
`test_the_ninety_day_ceiling_is_enforced_three_times_over` uses to reach 0069's check
constraint rather than the route) — with the harness sleeping past that instant before
k6 ever presents the token. Three requests each, all three 401, nothing else
(`pat_revoked_unexpected` and `pat_expired_unexpected` both 0).

### Scope: a read-only token cannot start a run; a read+run token can, on the same route

`READONLY_TOKEN` (`scopes: [read]`) posting to `/v1/runs` was refused 403 twice, and both
carried the machine-readable reason `token_scope_insufficient` — checked explicitly,
because a 403 for the wrong reason (a route refusal instead of a scope refusal) would say
nothing about read-only tokens specifically. `RUNSCOPE_TOKEN` (`scopes: [read, run]`)
posting the identical body to the identical route was admitted (`pat_run_admitted = 1`,
201). Same route, same body shape, the only variable is the scope on the token.

### Hardware is refused for the widest token that exists

`RUNSCOPE_TOKEN` — the widest scope a token can hold — was refused 403 twice on
`POST /v1/qpu/submissions`. It is asserted on this token rather than the read-only one on
purpose: a narrower token being refused would say nothing about whether the missing
scope is what refuses it, since a narrower token is refused everywhere already. There is
no `hardware` member of `TokenScope` to mint a wider token with (`auth/token_access.py`'s
own docstring), so this is the widest credential that can exist, and it still cannot
reach the route that spends a person's IBM time.

### Nothing 500'd

`server_errors = 0` across all 1,295 HTTP requests this run made. `http_req_failed` read
47.10% (610 of 1,295) — every one of those is an intended refusal: 600 flood 429s + 3
revoked 401s + 3 expired 401s + 2 read-only 403s + 2 hardware 403s = 610, exactly.

## Mutation-tested: the gate was seen to fail before it was trusted to pass

Two mutations, each confirmed red, then reverted and confirmed green (the final clean
run above is the reverted state):

1. **Softened ceiling.** Ran the harness with `TOKEN_RATE_LIMIT_PER_MINUTE=100000` set on
   the API process (simulating the exact failure this run exists to catch — a ceiling
   that quietly drifted, or a config that silently overrides the intended default).
   Result: `pat_flood_served` read **1199** (not 600) and `pat_flood_refused` read **0**;
   both thresholds crossed and the suite exited non-zero. `pat_flood_attempts` still read
   TOKEN_LIMIT's real value (600) in the k6 script's own accounting — the mutation only
   changes what the *server* enforces, not what the harness expects, which is the point.
2. **Scope check bypassed.** Edited `auth/token_access.py`'s `RUN_WRITES` branch to
   `return None` unconditionally, so a read-only token could start a run. Result:
   `READONLY_TOKEN` was admitted instead of refused; `pat_readonly_refused` read **0** and
   `pat_readonly_unexpected` read **2**; both thresholds crossed. Reverted with a byte-for-
   byte restore from a backup taken before the edit, confirmed by `git diff` reporting no
   change to the file.

Both mutations are exactly the failure modes the corresponding threshold names — a
softened ceiling, and a scope check that stopped checking — and both produced a non-zero
k6 exit, not a passing run with a suspicious number buried in the log.

## What this run does NOT establish

Written down because a green suite invites the wider reading, same as the 08-06 run's
own list.

**It is not a capacity measurement.** One uvicorn worker on a laptop, one Postgres
container, 30 seconds. The absolute throughput (`pat_flood_attempts` reaching 1200 in
30s against a target rate of 40/s) says the harness kept up with the rate it asked for;
it says nothing about how many personal-access-token requests a Cloud Run instance can
sustain in production.

**The per-token limiter is per-process, like the per-IP one.** `rate_limit.py`'s own
module docstring already says this about `FixedWindowLimiter` in general: counters live
in the process, so across N Cloud Run instances the effective ceiling for one token is
`600 x N`, not 600. This run used one worker deliberately — the same reasoning
`run-abuse.sh` gives — so it demonstrates the *policy*, not a fleet-wide exact number.
Making it exact needs shared state (Redis) this deployment does not have and should not
grow for a ceiling set an order of magnitude above legitimate use (`DEFAULT_TOKEN_LIMIT`'s
own docstring: an integration doing tens of requests a minute at its busiest, bounded two
orders of magnitude below a script in a loop).

**It says nothing about the sandbox lane, or about the other two §2 boxes this repo
still owes** (the hostile-payload suite against the real provider, and the canary-URL
exfil attempt) — those are untouched by this run and were already untouched by the
08-06 one.

**Every token here is `read` or `read+run`.** There is no `hardware` scope to test
against, by the ruling this whole feature ships under; "hardware is refused" is
therefore a claim about the *routes and scopes that exist today*, not a claim that will
still describe the system after a `hardware` scope is added. Adding one is a widening
that needs its own review and, per `token_access.py`'s docstring, is visible in exactly
two places when it happens.

**One run, one moment.** This is not a continuous check; nothing re-runs this
automatically today. Re-running before the next time this switch's state is revisited is
on whoever revisits it.

## Reproducing

```bash
bench/k6/run-pat-abuse.sh
```

Needs Docker, `k6`, `.env.db.local` pointed at a local Postgres 17 (see
`docs/runbooks/auth-dev.md` § The local database), and `uv sync --all-packages` already
run. It builds its own throwaway database (`majorana_k6_pat`), starts a throwaway API
with the switch on and the real default ceiling, mints its six fixtures through the
repository layer, runs the scenario, and exits non-zero if any threshold is crossed.

It is local by construction, the same decision `run-abuse.sh` makes and for the same
reason: these scenarios deliberately exceed real admission ceilings, and pointing them at
a shared or production service would be a self-inflicted denial of service on a control
whose whole job is to refuse a caller that looks like this one.
