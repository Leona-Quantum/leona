"""Print guided-tour signal counts by track/step/kind over a date range (ai-ops 326).

    DATABASE_URL=... uv run python services/api/scripts/tour_signal_counts.py
    ... tour_signal_counts.py --since 2026-09-01 --until 2026-09-23
    ... tour_signal_counts.py --track build --kind step_done

The owner's read path for this table is this script, not an HTTP route. The
codebase's own precedent for "read an operational metric that is not tied to
any one customer workspace" is a standalone script with a direct database
connection — `catalog_admin.py` (run as `python -m majorana_api.catalog_admin`,
env prepared by `scripts/catalog-admin-env.sh`) and this directory's own
`reattach_workos_identities.py` — never a web admin route. The one HTTP
"admin" gate this codebase has (`routes/news.py`'s `editorial_scope`, via
`require_admin`) is scoped to ONE specific workspace, the newsroom authority;
there is no notion of a single "site admin" workspace to hang an analogous
gate on for a metric that is not any customer's data, and inventing one here
would be new policy this ai-ops issue never asked for, on a route that would
itself need its own share of the security review this feature already went
through once for the anonymous write side. A script that only someone holding
`DATABASE_URL` can run needs no new gate at all.

The actual query is `repos/tour_signals.py::list_counts`, not raw SQL in this
file: `scripts/check_raw_queries.py` (AGENTS.md rule 2) forbids a `sqlalchemy`
import outside the repository layer, and this script is not in it — the same
reason `reattach_workos_identities.py` calls into `identity_migration`'s own
functions rather than querying directly.
"""

import argparse
import asyncio
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from majorana_api.db import engine_from_env, session_factory  # noqa: E402
from majorana_api.repos import tour_signals as tour_signals_repo  # noqa: E402


def _parse_date(value: str) -> dt.date:
    return dt.date.fromisoformat(value)


async def _run(args: argparse.Namespace) -> None:
    engine = engine_from_env()
    try:
        async with session_factory(engine)() as session:
            rows = await tour_signals_repo.list_counts(
                session,
                since=args.since,
                until=args.until,
                track=args.track,
                step=args.step,
                kind=args.kind,
            )
    finally:
        await engine.dispose()

    if not rows:
        print("no rows match")
        return

    width_track = max(len(row.track) for row in rows)
    width_step = max(len(row.step) for row in rows)
    width_kind = max(len(row.kind) for row in rows)
    print(
        f"{'day':<10}  {'track'.ljust(width_track)}  {'step'.ljust(width_step)}  "
        f"{'kind'.ljust(width_kind)}  count"
    )
    total = 0
    for row in rows:
        print(
            f"{row.day.isoformat():<10}  {row.track.ljust(width_track)}  "
            f"{row.step.ljust(width_step)}  {row.kind.ljust(width_kind)}  {row.count:>5}"
        )
        total += row.count
    print(f"\n{len(rows)} rows, {total} signals total")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--since", type=_parse_date, default=None, help="UTC day, inclusive")
    parser.add_argument("--until", type=_parse_date, default=None, help="UTC day, inclusive")
    parser.add_argument("--track", default=None)
    parser.add_argument("--step", default=None)
    parser.add_argument("--kind", default=None)
    args = parser.parse_args()
    asyncio.run(_run(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
