# Load tests for the website's Google Cloud front door

Written for the 2026-09-24 incident (`ai-ops/desk/leona/plans/incidents/2026-09-24-gcp-web-429.md`)
and kept so the next cutover can repeat them. **Point them only at
`gcp-preview.leonaqt.com`**, the rehearsal hostname, which goes through the same
Cloudflare → load balancer → Cloud Run path as production and serves no visitors.

Extended 2026-09-24 for the Cloudflare collaborator's follow-up ask (§4-§6 of the
incident note): report the crawler and legitimate users separately (successes, 429s
by who answered, latency), at the full 60 requests/s distributed crawler and 30
users sharing one address, over a longer observation window than the five-minute
runs in the incident's own table.

| File | What it is |
|---|---|
| `lib.js` | Shared by both scripts: `who(r)` (who answered — Cloudflare / Cloud Armor / Cloud Run / app), `record(scenario, cls, r)` (one `resp` count + one `resp_duration` latency point, same tags), `startDelay(startAt)` |
| `atlas-flood.js` | Two scenarios: `crawler` replays the crawler's real URLs (`crawler-urls-20260924.json`) with cache-busters at `CRAWL_RPS`; `visitor` is a light single-page-at-a-time visitor, for quick one-address checks. `SCENARIO=crawler\|visitor\|both` | below |
| `browse.js` | A person browsing the Atlas: index → map → several clicks (each a full document load — the map never uses client-side nav) → back/forward through states already seen this session → a record page, plus the home page, its RSC prefetches, the session probe, and an occasional static chunk. `VUS` virtual users all share this process's one address, so `VUS=30` **is** the shared-IP test (a classroom, an office, a NAT) | `k6 run -e VUS=30 -e MINUTES=10 --out json=b.json browse.js` |
| `summarise.py` | Three blocks — (a) the crawler, (b) legitimate users' Atlas requests, (c) legitimate users' non-Atlas requests — each broken down by class, with successes, 429s **by who answered**, 5xx, and **latency (p50/p95/p99/max) for that class alone, successful and refused reported separately**. Time-bucketed (default 5 min) so a long run shows the start transient vs steady state. Accepts several input files (plain or `.gz`) so a distributed run needs no separate `cat` step | `python3 summarise.py run*.json --json out.json` |
| `test_summarise.py` | Self-test against a synthetic k6 JSON fixture: proves the crawler/Atlas/non-Atlas split never leaks classes into each other, and that latency is computed per class rather than pooled. `python3 test_summarise.py` |

## The two shapes of flood, and why both are needed

**One address** (`k6 run -e CRAWL_RPS=50 atlas-flood.js`): Cloudflare's per-IP
"Atlas crawl limit" refuses most of it at the edge. Measured 2026-09-24: 92% refused
by Cloudflare, and the ~7 requests/s that got through were still enough to make
Cloud Run refuse 15% of home-page requests on the old single-service setup. It is
also the shared-address test: the visitor stream runs from the same address, and
Cloudflare refused 88% of its `/repository*` requests too.

**Many addresses**: the real crawler kept ~58 requests/s on the origin for four
hours, which a single address cannot do past that limit. `.github/workflows/loadtest-atlas.yml`
(lives only on `loadtest/*` branches — see the file's own header for why it is safe
even once merged to `dev`) runs this distributed: a matrix of crawler runners (15 ×
4 requests/s by default, each under the per-IP limit) **plus one more runner
running `browse.js` as the shared-IP group of legitimate users** (30 VUs by
default), all starting at the same unix time so the flood and ordinary traffic
actually overlap. Nothing needs to run on this Mac, or any other machine outside
CI — the earlier version of this test needed a second machine for the visitor
stream; folding it into the matrix removed that.

Launch the full run (defaults: 15 shards × 4 req/s = 60 req/s crawler, 30 shared-IP
users, 30 minutes):

```
git checkout -b loadtest/atlas-<date> add/loadtest-per-class   # or dev, once merged
git commit --allow-empty -m "loadtest: full distributed run (throwaway)" && git push -u origin HEAD
```

The push alone starts it (`on: push: branches: ["loadtest/**"]`), using the
workflow's built-in defaults. To change a parameter without editing the file, use
`workflow_dispatch` instead (same branch, must already be pushed once):

```
gh workflow run loadtest-atlas.yml --ref loadtest/atlas-<date> \
  -f shards=15 -f rps=4 -f duration_minutes=30 -f users_vus=30
```

When it finishes, download every shard's artifact plus the users artifact, and
summarise directly off the downloaded files — no manual merge step:

```
RUN=$(gh run list --workflow loadtest-atlas.yml --branch loadtest/atlas-<date> --limit 1 --json databaseId -q '.[0].databaseId')
gh run download "$RUN" -D runs && gunzip -f runs/run-*/*.json.gz
python3 infra/web-lb/load/summarise.py runs/run-*/*.json --json out.json
```

Delete the branch when done. It triggers nothing else: every other workflow
listens to `dev` only, and `loadtest-atlas.yml`'s own jobs additionally guard on
`github.ref` being a `loadtest/*` branch, so it does nothing even if dispatched
against `dev` by mistake.

## What "passing" means

The bullets below are what the *previous* (five-minute, single-address-visitor)
tests were judged against, kept for reference. **For the next test — 60 req/s
distributed crawler + 30 shared-IP users, 30-minute window — see "Proposed
acceptance criteria" below.**

- Visitor stream: **0** Cloud Run 429s on the home page, other pages and static
  chunks, whatever the crawler is doing. A Cloud Run 429 on `/repository*` under a
  flood is the bulkhead doing its job; one anywhere else is the incident.
- `browse.js` from one address at the agreed load: **0** 429s from anyone.
- Cloud Armor, from the load balancer's log: preview decisions name the tester's
  own address as the key (`rateLimitAction.key`), which is the proof the limit is
  counting visitors and not Cloudflare's data centres.

## Proposed acceptance criteria for the next test (60 req/s crawler + 30 shared-IP users, 30 min)

**PROPOSED — for the owner and the Cloudflare collaborator to agree, not yet a
ruling.** Sourced from the incident note's own measurements (§5) where marked
"measured"; where no direct measurement exists at this exact load, the number is
a stated extrapolation, flagged as such, so it can be argued with rather than
mistaken for another data point.

1. **Observation window: 30 minutes, first 5 minutes reported separately.**
   `summarise.py`'s default `--bucket-minutes 5` produces this split directly, so
   "first 5 min" and "steady state" are two lines in the same report rather than
   two separate runs.

2. **Legitimate users' non-Atlas requests (home, pages, static, RSC prefetches,
   session): 0 Cloud Run/Cloud Armor 429s across the FULL window, not just after
   a grace period.** Measured (test 6, §5): 0 refused out of 2,478 home/page/
   prefetch/session requests, crawler and users running together, Armor enforced.
   The one prior refusal of non-Atlas traffic (test 4: 7 refused, all in the first
   5 **seconds**, before Armor was enforced and while the service was cold at 1
   instance) is smaller than any reasonable grace period, which is why this
   criterion carries no grace window at all — unlike criterion 4.

3. **Atlas success-rate floor and p95 latency ceiling during the flood.**
   Under 60 req/s crawler + 30 shared-IP users after the fix, the Atlas service is
   *supposed* to shed load — that is what the bulkhead is for — so "0 refused" is
   the wrong bar for Atlas. Measured (test 6): map 68.9% shed (31.1% success),
   record 81.9% shed (18.1% success). Proposed floor: **≥15% Atlas request
   success rate, sustained** (i.e. minutes 25–30 not meaningfully worse than
   minutes 10–15 — no progressive collapse), a few points under the measured
   31.1%/18.1% to allow for run-to-run variance rather than re-using the exact
   measured value as a hard line. Proposed p95 latency ceiling for Atlas requests
   that **do** succeed: **≤5 s**. This one is an extrapolation, not a direct
   measurement — §5 gives the pre-fix queueing math (concurrency 8; a busy
   instance is "full" and Cloud Run starts another one) but no post-fix p95 under
   the full 60 req/s load, since the incident's own tests recorded success/shed
   counts, not latency, for the Atlas service specifically. 5 s is generous
   against that queueing math on purpose, pending an actual measurement from the
   first real run at this load — **treat this number as the one most likely to
   need revising once real data exists**.

4. **0 5xx after the first N minutes; propose N = 2.** Measured: 41 × 500 (test
   3) and 51 × 500 (test 6) "while scaling from 1 to [6/8] instances" — i.e. cold
   starts at the beginning of a flood, not a sustained failure mode. The incident
   note does not give the exact duration of that scale-up window, so 2 minutes is
   an inference from Cloud Run's typical cold-start time (tens of seconds per new
   instance, a handful of instances to add), not a quoted figure — flagged for the
   same reason as the latency ceiling above. If ai-ops#379 (owner decision A: warm
   minimum instances) lands before the next test, this grace window should
   shrink or disappear, since warm minimums are specifically what removes these
   scale-up 500s.

## For the collaborator's specific ask

> "report legitimate Atlas users separately from the crawler: successful requests,
> 429s, and latency. Include the 60 requests/second distributed crawler and 30
> users sharing one IP, and propose explicit acceptance criteria and a longer
> observation period than the final five-minute run."

`summarise.py`'s three blocks are exactly this split (crawler / legitimate users'
Atlas requests / legitimate users' non-Atlas requests), each with per-class
successes, 429s by who answered, 5xx, and latency for successful vs refused
responses separately. `loadtest-atlas.yml` runs the 60 req/s crawler and the
30-shared-IP-user stream together by default, for 30 minutes by default (up from
the incident's longest single test, ~10-12 minutes). The acceptance criteria above
are the proposal; §4 of this file is not a ruling until the owner and the
collaborator both say so.
