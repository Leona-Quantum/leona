# Runbook: public pageviews

**This runbook describes the Vercel-era retrieval procedure and has NOT been
re-verified against Cloud Run.** The website moved to Cloud Run
(`majorana-web`) and Vercel was retired as a host on 2026-09-21 (ADR-0033).
The `console.log` call itself (`countPageview()`) is unchanged and still runs
on every request; what changed is where the line lands. On Cloud Run, stdout
from a container goes to Cloud Logging, and Cloud Run auto-parses a
valid-JSON stdout line into `jsonPayload` rather than `textPayload` — so the
`vercel logs`-based commands below are replaced with a `gcloud logging read`
equivalent, adapted from the same pattern `docs/runbooks/deploys.md` and
`docs/runbooks/incident.md` use for the api/worker logs. **Nobody has run the
replacement commands against a real pageview yet; verify the query actually
matches before relying on it during an incident.**

## What exists

One line in the Cloud Logging output for `majorana-web` per public pageview,
written by `countPageview()` in `apps/web/middleware.ts`. The decision of what
counts and what is recorded is `apps/web/lib/pageview-signal.ts`; its tests
are `apps/web/lib/pageview-signal.test.ts`.

That is the whole implementation. There is no dashboard, no database table, no
client script, and no third-party account.

A line looks like this, and contains nothing else:

```json
{"evt":"leona.pageview","route":"/repository/[slug]","day":"2026-08-14","ref":"news.ycombinator.com"}
```

| Field | Meaning |
|---|---|
| `evt` | Always `leona.pageview`. The grep target. |
| `route` | One of `/`, `/repository`, `/repository/layers`, `/repository/[slug]`. A pattern, never the URL visited. |
| `day` | **UTC** calendar day. Not the owner's timezone — a "Monday" here starts at 09:00 Monday in Tokyo and 17:00 Sunday in California. |
| `ref` | Referring host, only when it is somebody else's. `null` for direct arrivals and internal navigation. |

## What it does not measure, and why

- **Not visitors. Pageviews.** No cookie, no localStorage, no IP, no
  user-agent, and no hash of any of those is recorded, so one reader who
  refreshes four times is four. De-duplicating requires a client identifier,
  which was outside what was approved. Never report these numbers as "readers"
  or "uniques".
- **404s on well-formed slugs are counted.** Middleware runs before the render
  and never learns the status code. `/repository/does-not-exist` counts as a
  `/repository/[slug]` view.
- **Bot filtering is a user-agent heuristic**, so it is leaky in both
  directions. Treat the numbers as an upper bound on human reading.
- **Prefetches are excluded** (`next-router-prefetch`, `sec-purpose`, and
  friends). Without that exclusion the repository index — which links to every
  entry — would report the whole corpus as read whenever one person scrolled
  the list. **Client-side navigations are included**, because they are real
  reads.

## Turning it off

Set `LEONA_PAGEVIEW_LOG=off` on the `majorana-web` Cloud Run service and
redeploy (`gcloud run services update majorana-web --project majorana-core
--region us-west1 --update-env-vars LEONA_PAGEVIEW_LOG=off` — reverted by the
next `deploy-web.yml` run, since its `--set-env-vars` replaces the whole set;
add it there instead for anything longer-lived). It is default-on: a counter
nobody remembers to arm reports zero reads, which looks exactly like the
finding it was built to test for.

## Reading the counts back

The lines go to Cloud Logging, under `resource.type="cloud_run_revision"`,
`resource.labels.service_name="majorana-web"`. There is no per-service
retention add-on the way Vercel sold one — see the ceiling below for what
governs it instead.

**From the console.**
`console.cloud.google.com/logs/query?project=majorana-core`, query:

```
resource.type="cloud_run_revision"
resource.labels.service_name="majorana-web"
jsonPayload.evt="leona.pageview"
```

**From the CLI:**

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="majorana-web" AND jsonPayload.evt="leona.pageview"' \
  --project majorana-core --freshness=24h --limit 1000 --format=json
```

Counts per route for a day:

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="majorana-web" AND jsonPayload.evt="leona.pageview"' \
  --project majorana-core --freshness=24h --limit 1000 --format=json \
  | jq -r '.[] | select(.jsonPayload.day == "2026-08-14") | .jsonPayload.route' \
  | sort | uniq -c | sort -rn
```

Set `--freshness` and `--limit` deliberately, the same trap the old Vercel
procedure warned about applies here too in spirit: a default or too-small
`--limit` truncates silently, and a truncated result reads exactly like "nobody
visited" — which is precisely the failure this counter exists to catch.
**Neither query above has been run against a real pageview yet** — confirm
`gcloud logging read` actually surfaces `jsonPayload.evt`/`jsonPayload.day`/
`jsonPayload.route` as named here (Cloud Run's JSON-stdout auto-parsing is
documented behaviour, but this specific field mapping was not checked live)
before trusting a total pulled this way.

## The ceiling — read this before trusting a total

**Retention is governed by the project's Cloud Logging bucket configuration,
not re-verified here.** GCP's own default for the `_Default` log bucket is 30
days, which would already be longer than Vercel's base-Pro 1-day / paid
Observability-Plus 30-day setup this section used to describe — but whether
`majorana-core` still uses the default bucket and retention, or has a custom
one, was not checked as part of this sweep. Confirm at
`console.cloud.google.com/logs/storage?project=majorana-core` before quoting a
retention window to anyone.

So this counter answers "is anyone reading the map **this week**". It does not
build a history. Any question of the form "how did traffic change over the
quarter" needs a durable sink, and **no free durable sink exists on this
account** — see the options table in the analytics plan at
`plans/analytics/00-PRODUCT-METRICS.md`. That is an owner decision, not an
implementation gap to quietly fill.

## Observability Events cost — what's actually driving it, and what isn't

**ai-ops#97/#92, 2026-08-15.** Vercel's "Observability Events" line
(7.9M / $9.47 in the current billing cycle at the time of this measurement —
the second-largest line on the bill after Build CPU Minutes) was suspected of
being driven by this counter's own `console.log` calls. Measured, not
assumed: two live samples pulled via `vercel logs --json` against real
production deployments (40 + 500 rows, ~13 seconds combined) contained **zero**
`leona.pageview` lines — including 111 rows that were edge-middleware
invocations on the canonical host with a 200 response, exactly the population
`countPageview()` runs against unconditionally. `LEONA_PAGEVIEW_LOG` is not
set in Production, so the counter is at its default-on state; the zero is the
bot filter doing its job (or a crawler evading its crude UA-substring check),
not the counter being off.

What the samples show instead, and neither is this counter's doing:

1. **A crawler (or several) sweeping the whole Atlas.** ~40 requests/second
   sustained, hitting distinct `/repository/layers/<slug>` pages across all
   **three** domain aliases (`leonaqt.com`, `www.leonaqt.com`,
   `leonaquantum.com`). Two of every three hits are the canonical-host
   redirect (`canonicalHost()` in `middleware.ts`, which — correctly — runs
   and returns before `countPageview()` on line 235-243) and each one is its
   own logged edge-middleware invocation. One (probably automated) reader
   costs three log rows.
2. **Duplicate warning-level log lines per single render.** Some individual
   page renders logged the *same* `"LaTeX-incompatible input... Unrecognized
   Unicode character..."` warning from `components/math-text.tsx` two or
   three times in one request — a real, separate inefficiency (looks like a
   re-render without memoization) that's a more direct and certain
   contributor to log-line volume than anything analytics-related.

Neither is this doc's or this counter's problem to fix, and neither has been
fixed — recorded here so the next person investigating this bill starts from
measurement instead of re-deriving the same suspicion this section closes
out.

## Why it is not written to Postgres

The obvious design — a `pageviews` table with an upsert per request — was
rejected, and should stay rejected unless the constraints below change.

`apps/web` holds no database connection at all; it reaches Postgres only
through `majorana-api`. So a per-pageview write would mean a Cloud Run request
per pageview on a service capped at **maxScale 4 / 1 vCPU / concurrency 16**,
and a Cloud SQL connection per write from a pool of **5 + 5 overflow**. Adding a
vanity metric to the request path of the tightest resource in the system, in
exchange for a number nobody reads hourly, is a bad trade at the launch target
of 50 concurrent readers — 64 admission slots site-wide, and a pageview write
would compete for them with the reads a visitor is actually waiting on.

> **Two premises of this rejection have since changed, and one of them was the
> one this paragraph called decisive.** It used to read "a shared-core
> `db-g1-small` with **no `pool_timeout` configured**", and argued that a burst
> would queue on the pool indefinitely and stall the API for signed-in users.
> Both halves are now false: the instance is `db-custom-1-3840` with
> `max_connections=200` (2026-08-15), and `db.py` sets
> `pool_timeout=DEFAULT_POOL_TIMEOUT_S = 15.0` (landed in #569), so a burst fails
> fast instead of stalling. **The rejection still stands on the paragraph above**
> — request amplification on the narrowest service — but it no longer stands on
> a database-stall argument, and nobody should quote one from this file.

Logging costs a `console.log` on an invocation that was already happening.
