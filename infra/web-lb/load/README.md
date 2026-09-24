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

**Corrected 2026-09-24, 21:29-21:40 UTC** (a real-browser re-measurement and a
Cloudflare rule change, both after the extension above was first written):

- A lane/card click on an already-open map is an **RSC request** (`RSC: 1` header,
  `_rsc=` param), not a document load — the incident's own document-load,
  ~1 s-server-render shape is what a **deep-link arrival** (a shared link, a
  bookmark, or a crawler with no browser session hitting a specific `?open=` URL
  directly) looks like, not an ordinary click. `browse.js` models both: most map
  navigation is RSC, `DEEP_LINK_RATE` (10%) of sessions arrive at a specific state
  from outside the app instead.
- Cloudflare added a **Managed Challenge** on `/repository/layers*` (any locale)
  for a non-RSC GET with a query string from an unverified client — exactly the
  crawler's shape, and the minority deep-link arrival's. `who()` in `lib.js` already
  told this apart from a plain Cloudflare 429/403 (`cf-challenge`, from the
  `cf-mitigated: challenge` header); `summarise.py` now reports it as its own
  **challenged** count, separate from both successes and refusals, because it is
  the intended outcome for that traffic, not a failure.
- Cloudflare's "Atlas crawl limit" was also raised 60 → 240 requests/10 s per IP,
  and now also covers `/en/repository*` and `/ja/repository*`.
- `WEB_MIN_INSTANCES` is now 2 and `WEB_ATLAS_MIN_INSTANCES` 1 (PR 1006) — relevant
  to acceptance criterion 4 below, since warm minimums are what remove the
  scale-up 500s that criterion's grace window was sized from.

| File | What it is |
|---|---|
| `lib.js` | Shared by both scripts: `who(r)` (who answered — Cloudflare / Cloud Armor / Cloud Run / app / **cf-challenge**), `record(scenario, cls, r)` (one `resp` count + one `resp_duration` latency point, same tags), `startDelay(startAt)` |
| `atlas-flood.js` | Two scenarios: `crawler` replays the crawler's real URLs (`crawler-urls-20260924.json`) with cache-busters at `CRAWL_RPS` — raw document GETs, exactly what a scraper sends, so most of them now meet Cloudflare's Managed Challenge rather than reaching Cloud Run at all (see above; that is the intended outcome, reported as `challenged`); `visitor` is a light single-page-at-a-time visitor, for quick one-address checks. `SCENARIO=crawler\|visitor\|both` | below |
| `browse.js` | A person browsing the Atlas: index (document load) → map clicks (**RSC requests**, or a document load for the minority `DEEP_LINK_RATE` of sessions arriving from outside the app) → back/forward through states already seen this session (same RSC cost) → a record page, plus the home page, its RSC prefetches, the session probe, and an occasional static chunk. `VUS` virtual users all share this process's one address, so `VUS=30` **is** the shared-IP test (a classroom, an office, a NAT) | `k6 run -e VUS=30 -e MINUTES=10 --out json=b.json browse.js` |
| `summarise.py` | Three blocks — (a) the crawler, (b) legitimate users' Atlas requests, (c) legitimate users' non-Atlas requests — each broken down by class, with successes, 429s **by who answered**, **challenged** (Cloudflare's Managed Challenge, reported separately from refusals), 5xx, and **latency (p50/p95/p99/max) for that class alone, successful/refused/challenged reported separately**. Time-bucketed (default 5 min) so a long run shows the start transient vs steady state. Accepts several input files (plain or `.gz`) so a distributed run needs no separate `cat` step. Classifies by the page class BEFORE any `:rsc`/`:prefetch` suffix, so an RSC map click still counts as an Atlas request (see `test_summarise.py`) | `python3 summarise.py run*.json --json out.json` |
| `test_summarise.py` | Self-test against a synthetic k6 JSON fixture: proves the crawler/Atlas/non-Atlas split never leaks classes into each other (including a suffixed class like `map:rsc`), that latency is computed per class rather than pooled, and that a challenged response is never folded into "refused". `python3 test_summarise.py` |

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

3. **Atlas success-rate floor and p95 latency ceiling during the flood, measured
   against RSC clicks specifically.** Under 60 req/s crawler + 30 shared-IP users
   after the fix, the Atlas service is *supposed* to shed load — that is what the
   bulkhead is for — so "0 refused" is the wrong bar for Atlas. It is now also the
   wrong SHAPE of bar: most legitimate map traffic is an RSC click, which
   Cloudflare's Managed Challenge rule does not touch (it excludes any request
   carrying the `RSC` header), so an RSC click's only two outcomes are success or
   a Cloud Run/Armor refusal — never `challenged`. Measured pre-challenge-rule
   (test 6, document-load map clicks): map 68.9% shed (31.1% success), record
   81.9% shed (18.1% success) — kept here as the closest prior data point, but
   flagged as **likely stale**: it measured a different request shape (document
   loads) against a different Atlas capacity (`WEB_ATLAS_MIN_INSTANCES` was 0,
   now 1) than the next test will see. Proposed floor: **≥15% Atlas RSC-click
   success rate, sustained** (minutes 25–30 not meaningfully worse than minutes
   10–15), pending a real measurement at the corrected shape. Proposed p95
   latency ceiling for Atlas RSC clicks that **do** succeed: **≤5 s** — an
   extrapolation from the pre-fix queueing math (concurrency 8; a busy instance
   is "full" and Cloud Run starts another one), not a direct measurement.
   **Separately: the minority of deep-link arrivals (document loads, no RSC
   header) ARE subject to the Managed Challenge** — propose reporting, not gating,
   how many of them see a challenge instead of a rendered page (the collaborator's
   own framing: "would see one interstitial"), plus a hard **0** for any deep-link
   arrival that gets a 429 or 5xx instead of a challenge or a successful render —
   a challenge is an acceptable outcome for that traffic, an unhandled refusal is
   not. **Both numbers in this criterion are the ones most likely to need
   revising once real data exists.**

4. **0 5xx after the first N minutes; propose N = 1, down from the number this
   criterion would have carried before PR 1006.** Measured: 41 × 500 (test 3) and
   51 × 500 (test 6) "while scaling from 1 to [6/8] instances" — cold starts at
   the beginning of a flood, not a sustained failure mode, but with
   `WEB_MIN_INSTANCES`/`WEB_ATLAS_MIN_INSTANCES` both 0 or 1 at measurement time.
   Both are now warm (2 and 1 respectively, PR 1006, deploying as of this test),
   which is specifically what removes a cold-start scale-up 500 — so this
   criterion should mostly be exercised by NEW instances added under sustained
   load past the warm minimum, not by the first arrival. N=1 minute is a smaller,
   deliberately tighter grace window than the pre-1006 proposal, reflecting that
   expectation; **if the first real run at this load still shows 5xx past minute
   1, that is itself a finding** (PR 1006 not fully deployed, or the warm minimum
   undersized for 60 req/s), not just a criterion to loosen.

## For the collaborator's specific ask

> "report legitimate Atlas users separately from the crawler: successful requests,
> 429s, and latency. Include the 60 requests/second distributed crawler and 30
> users sharing one IP, and propose explicit acceptance criteria and a longer
> observation period than the final five-minute run."

`summarise.py`'s three blocks are exactly this split (crawler / legitimate users'
Atlas requests / legitimate users' non-Atlas requests), each with per-class
successes, 429s by who answered, Cloudflare's Managed Challenge reported as its
own outcome rather than folded into either success or refusal, 5xx, and latency
for successful/refused/challenged responses separately. `loadtest-atlas.yml` runs
the 60 req/s crawler and the 30-shared-IP-user stream together by default, for 30
minutes by default (up from the incident's longest single test, ~10-12 minutes).
The acceptance criteria above are the proposal; §4 of this file is not a ruling
until the owner and the collaborator both say so.
