# Runbook: public pageviews

## What exists

One line in the Vercel runtime log per public pageview, written by
`countPageview()` in `apps/web/middleware.ts`. The decision of what counts and
what is recorded is `apps/web/lib/pageview-signal.ts`; its tests are
`apps/web/lib/pageview-signal.test.ts`.

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

Set `LEONA_PAGEVIEW_LOG=off` in the Vercel project environment and redeploy.
It is default-on: a counter nobody remembers to arm reports zero reads, which
looks exactly like the finding it was built to test for.

## Reading the counts back

The lines go to Vercel's runtime logs for the `web` project. Retention is
Vercel's, not ours — see the ceiling below.

**From the dashboard.** Project `web` → Observability → Logs, filter on
`leona.pageview`, group by the `route` value.

**From the CLI**, against the current production deployment. `vercel logs` needs
a deployment URL or id — it has no "whatever is in production right now" mode, and
`vercel inspect` needs the same argument, so there is no one-liner that discovers
it for you. Take the URL from the dashboard, or list them:

```bash
vercel ls web --scope majoranaq          # the top row is the current production deployment
vercel logs --deployment <deployment-url> --scope majoranaq \
  --query "leona.pageview" --since 24h --limit 1000
```

**Use `--query`, not a pipe into `grep`.** This is the one part of this procedure
that fails silently rather than loudly. `vercel logs` returns the most recent 100
entries by default and this site takes enough crawler traffic to fill that window
in **seconds** — so `vercel logs ... | grep leona.pageview` prints nothing, which
is indistinguishable from "nobody visited". That is exactly the reading this
counter exists to prevent, and it happened on the first attempt to verify the
counter after it shipped: the counter was working perfectly and the grep said
zero. `--query` filters server-side, before the limit is applied. Set `--since`
and `--limit` deliberately; both silently truncate.

Counts per route for a day:

```bash
vercel logs --deployment <deployment-url> --scope majoranaq \
  --query "leona.pageview" --since 24h --limit 1000 --json \
  | grep -o '{"evt":"leona.pageview"[^}]*}' \
  | jq -r 'select(.day == "2026-08-14") | .route' \
  | sort | uniq -c | sort -rn
```

## The ceiling — read this before trusting a total

**Retention is not under our control and is not durable.** Vercel's base Pro
runtime-log retention is **1 day**. The team currently has the paid
**Observability Plus** add-on enabled, which extends retention to 30 days and
unlocks querying — but that is a metered add-on ($1.20/1M events), not a
guarantee, and if it is ever switched off the window silently collapses back to
a day. Nothing in this repo would notice.

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
