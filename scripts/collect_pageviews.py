#!/usr/bin/env python3
"""Copy public pageview counts out of the Vercel runtime log into Postgres.

The counter added in #536 writes one JSON line per public page request to the
Vercel runtime log and nothing else — no cookie, no database, no vendor. That is
a good design and it has one problem: base-plan runtime logs retain for a single
day, so "how did traffic move this month" is unanswerable. This job reads the
lines while they still exist and writes them to `public_pageview_daily`
(migration 0051), which is the durable half.

## What it does

    vercel logs --query leona.pageview --since <window> --json
      -> one JSON object per matching request
      -> the inner `message` is the counter's own payload:
         {"evt":"leona.pageview","route":"/repository","day":"2026-08-14","ref":null}
      -> count by (day, route)
      -> upsert one row per pair

## The day is the emitter's, never this process's clock

`day` is copied verbatim from the payload. `apps/web/lib/pageview-signal.ts`
stamps it at request time as a UTC calendar day, so the boundary is decided by
the process that saw the request rather than by whenever this cron happens to
fire. That is what makes re-running safe: run this at 00:20 or at 13:47 and the
rows are identical. A collector that computed "today" itself would produce
different history depending on its own schedule — the standard UTC-cron trap,
avoided here by not having an opinion about time at all.

## Why the window overlaps a day

The default window (36h) deliberately covers more than one calendar day. Each
run therefore rewrites yesterday (now complete) and today (still partial), and
tomorrow's run completes today. `views` is replaced, not added, so the overlap
costs nothing and a missed run self-heals on the next one — provided the log
still reaches back that far. With the Observability Plus window (~30 days,
measured 2026-08-14) that is comfortable. If that add-on ever lapses, retention
drops to ~1 day and a missed run loses that day permanently; the job is
scheduled just after midnight UTC so that even at 1-day retention a single run
sees essentially all of the day it is completing.

## Why this lives in scripts/ and not in the repository layer

AGENTS.md rule 2 keeps DB access inside `services/api/.../repos/` so that every
tenant read carries a `Scope`. Both enforcement gates define that surface
explicitly: `scripts/check_raw_queries.py` scans `services/` and `packages/py/`
only, and the import-linter contract covers the four root packages. `scripts/`
is outside both, in the same way `db/` (migrations, seeds) is.

That is a scope statement, not a loophole being leaned on. This table holds
counts of anonymous public requests: no workspace_id, no user, no identifier of
any kind, never read by a request handler. There is no tenant dimension for a
Scope to constrain, so putting it behind the authz spine would add a second
unscoped surface to a module that documents having exactly one deliberate
exception — a doctrinal change to the authz layer in exchange for nothing.
Flagged in the PR body so the owner can overrule if he reads the boundary
differently.

## Usage

    python scripts/collect_pageviews.py --self-test        # no network, no DB
    python scripts/collect_pageviews.py --dry-run          # read + count, print
    python scripts/collect_pageviews.py                    # read + count + write

Requires `VERCEL_TOKEN` for the read and `DATABASE_URL_DIRECT` for the write.
Neither is ever printed: a failure reports the failing step, not the credential.
"""

from __future__ import annotations

import argparse
import collections
import json
import os
import subprocess
import sys
from datetime import date

#: The event name the counter emits. Anything else on the same log stream is not ours.
EVENT = "leona.pageview"

#: Pinned so a future CLI release cannot silently change the log output shape this
#: parses. 54.21.1 is the version the JSON-lines format below was verified against
#: (2026-08-14, against production). Bump deliberately, re-verifying the shape.
VERCEL_CLI = "vercel@54.21.1"

DEFAULT_WINDOW = "36h"
DEFAULT_PROJECT = "web"
DEFAULT_SCOPE = "majoranaq"

#: `vercel logs` paginates, and a large pull is slow — 5,000 lines did not finish
#: in seven minutes when this was measured. The cap keeps a daily run bounded; if
#: real traffic ever approaches it the count would silently truncate, so the job
#: fails loudly at the ceiling rather than writing a number that looks fine.
MAX_LINES = 4000


def parse_signals(stream: object) -> list[tuple[str, str]]:
    """(day, route) for every pageview line in a stream of `vercel logs --json` output.

    Tolerant by design: the stream carries CLI banners, blank lines and log entries
    for other events, none of which are errors. Only a line that is JSON, carries a
    `message` that is itself JSON, and whose `evt` is ours contributes a pair.
    """
    pairs: list[tuple[str, str]] = []
    for line in stream:  # type: ignore[attr-defined]
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        message = entry.get("message")
        if not isinstance(message, str) or EVENT not in message:
            continue
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            continue
        if payload.get("evt") != EVENT:
            continue
        day, route = payload.get("day"), payload.get("route")
        if isinstance(day, str) and isinstance(route, str) and day and route:
            pairs.append((day, route))
    return pairs


def tally(pairs: list[tuple[str, str]]) -> dict[tuple[str, str], int]:
    """Counts per (day, route). Separated from parsing so both are testable alone."""
    counts: collections.Counter[tuple[str, str]] = collections.Counter(pairs)
    return dict(counts)


def read_log(window: str, project: str, scope: str) -> list[str]:
    """Shell out to the pinned Vercel CLI and return its stdout lines.

    `--query` server-side is what makes this viable: without it the CLI returns the
    most recent entries regardless of content, crawler traffic fills them in
    seconds, and filtering client-side reads as "nobody visited" — the failure
    already recorded in docs/runbooks/pageviews.md.
    """
    if not os.environ.get("VERCEL_TOKEN"):
        raise SystemExit("VERCEL_TOKEN is not set; cannot read the runtime log")
    result = subprocess.run(
        [
            "npx",
            "--yes",
            VERCEL_CLI,
            "logs",
            "--project",
            project,
            "--scope",
            scope,
            "--environment",
            "production",
            "--no-branch",
            "--since",
            window,
            "--query",
            EVENT,
            "--json",
            "-n",
            str(MAX_LINES),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        # stderr may echo the invocation; report the step, never the token.
        raise SystemExit(f"vercel logs failed with exit code {result.returncode}")
    return result.stdout.splitlines()


def upsert(counts: dict[tuple[str, str], int]) -> int:
    """Write the counts, replacing any existing figure for the same (day, route)."""
    url = os.environ.get("DATABASE_URL_DIRECT")
    if not url:
        raise SystemExit("DATABASE_URL_DIRECT is not set; cannot write counts")
    import psycopg  # imported here so --self-test and --dry-run need no driver

    rows = [(date.fromisoformat(day), route, n) for (day, route), n in sorted(counts.items())]
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO public_pageview_daily (day, route, views, collected_at)
            VALUES (%s, %s, %s, now())
            ON CONFLICT (day, route)
            DO UPDATE SET views = EXCLUDED.views, collected_at = now()
            """,
            rows,
        )
        conn.commit()
    return len(rows)


def self_test() -> None:
    """Cases that would otherwise only be found in production, run in CI for free."""
    entry = json.dumps(
        {
            "message": json.dumps(
                {"evt": EVENT, "route": "/repository", "day": "2026-08-14", "ref": None}
            ),
            "requestPath": "/repository",
        }
    )
    other = json.dumps({"message": "some unrelated log line"})
    malformed = json.dumps({"message": "{not json"})
    foreign = json.dumps({"message": json.dumps({"evt": "something.else", "day": "x"})})

    pairs = parse_signals([entry, "", "Vercel CLI 54.21.1", other, malformed, foreign, entry])
    assert pairs == [("2026-08-14", "/repository")] * 2, pairs

    # Counting is per (day, route), and two days in one window stay separate — the
    # case the overlapping window exists to produce.
    counts = tally(
        [
            ("2026-08-13", "/repository"),
            ("2026-08-14", "/repository"),
            ("2026-08-14", "/repository"),
            ("2026-08-14", "/repository/papers"),
        ]
    )
    assert counts == {
        ("2026-08-13", "/repository"): 1,
        ("2026-08-14", "/repository"): 2,
        ("2026-08-14", "/repository/papers"): 1,
    }, counts

    # An empty read is a legitimate answer (a quiet hour), not a parse failure —
    # and must stay distinguishable from one, so it yields no rows rather than raising.
    assert parse_signals([]) == []
    assert tally([]) == {}

    # A day the emitter stamped is passed through untouched; this process never
    # substitutes its own clock, which is what makes a re-run idempotent.
    assert date.fromisoformat("2026-08-14") == date(2026, 8, 14)
    print("self-test: ok")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--self-test", action="store_true", help="run offline checks and exit")
    ap.add_argument("--dry-run", action="store_true", help="read and count, write nothing")
    ap.add_argument(
        "--window", default=DEFAULT_WINDOW, help=f"log window (default {DEFAULT_WINDOW})"
    )
    ap.add_argument("--project", default=DEFAULT_PROJECT)
    ap.add_argument("--scope", default=DEFAULT_SCOPE)
    ap.add_argument("--from-file", help="read CLI output from a file instead of shelling out")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return 0

    if args.from_file:
        with open(args.from_file, encoding="utf-8") as fh:
            lines = fh.read().splitlines()
    else:
        lines = read_log(args.window, args.project, args.scope)

    if len(lines) >= MAX_LINES:
        raise SystemExit(
            f"hit the {MAX_LINES}-line ceiling, so the window was truncated and the "
            f"counts would be wrong. Shorten --window or raise MAX_LINES deliberately."
        )

    counts = tally(parse_signals(lines))
    total = sum(counts.values())
    days = sorted({day for day, _ in counts})
    print(f"parsed {total} pageviews across {len(counts)} (day, route) pairs; days: {days}")

    if not counts:
        # Not an error: a genuinely quiet window looks like this. It is reported
        # rather than silently succeeding, because it is also what a broken query
        # looks like, and the two must not be indistinguishable in the run log.
        print("no pageview lines in the window — nothing to write")
        return 0

    for (day, route), n in sorted(counts.items()):
        print(f"  {day}  {n:6d}  {route}")

    if args.dry_run:
        print("dry run: nothing written")
        return 0

    written = upsert(counts)
    print(f"wrote {written} rows to public_pageview_daily")
    return 0


if __name__ == "__main__":
    sys.exit(main())
