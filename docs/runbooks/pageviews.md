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

**From the CLI**, against the current production deployment:

```bash
vercel logs "$(vercel inspect --scope majoranaq 2>&1 | grep -o 'https://[^ ]*vercel.app' | head -1)" \
  | grep leona.pageview
```

Pipe that through `jq` to get counts per route for a day:

```bash
... | grep -o '{"evt":"leona.pageview".*}' \
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

## Why it is not written to Postgres

The obvious design — a `pageviews` table with an upsert per request — was
rejected, and should stay rejected unless the constraints below change.

`apps/web` holds no database connection at all; it reaches Postgres only
through `majorana-api`. So a per-pageview write would mean a Cloud Run request
per pageview on a service capped at **maxScale 2 / 1 vCPU**, and a Cloud SQL
connection per write from a pool of **5 + 5 overflow** on a shared-core
`db-g1-small` with **no `pool_timeout` configured**. That last detail is the
decisive one: with no pool timeout, a burst of public traffic does not fail
fast — it queues on the pool indefinitely and stalls the API for signed-in
users. Adding a vanity metric to the request path of the tightest resource in
the system, in exchange for a number nobody reads hourly, is a bad trade at the
launch target of 50 concurrent readers.

Logging costs a `console.log` on an invocation that was already happening.
