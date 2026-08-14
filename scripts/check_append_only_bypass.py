#!/usr/bin/env python3
"""CI gate for the append-only bypass migration 0050 gives run_events,
audit_log and usage_events: `majorana.append_only_bypass` must never be set
from product code.

The trigger those three tables carry (0050_append_only_triggers.py) steps
aside for the rest of a transaction that has issued `SET LOCAL
majorana.append_only_bypass = 'on'` — see that migration's docstring for the
full reasoning. In short: `repo_test_helpers.py::delete_committed_tenants` has
to delete committed rows that a couple of two-connection race tests leave
behind, and a transaction-scoped GUC does that without weakening the trigger
for anything else, and without the ACCESS EXCLUSIVE lock `ALTER TABLE ...
DISABLE TRIGGER` would need (which risks blocking or deadlocking the very
race tests that bypass exists to serve).

A bypass only one file can reach is a real control. A bypass any file can
reach is no control at all — this is what keeps it the first kind: it scans
every Python file in the repository and fails if the GUC name shows up
anywhere except the one test helper that is allowed to use it and the
migrations directory that defines it.

Scoped to `*.py` rather than every file: the GUC can only ever take effect
through a `SET`/`SET LOCAL` statement issued by a Python process, since the
API and the worker are the only two processes that connect to this database
(AGENTS.md, "What this repo is"). A mention in a doc or a workflow comment
cannot set it, so scanning those would only add noise, not safety — the same
call `check_raw_queries.py` makes for the same reason.

Usage: python scripts/check_append_only_bypass.py [ROOT]   (exit 1 on violations)
"""

import sys
from pathlib import Path

GUC = "majorana.append_only_bypass"
ALLOWED_PREFIXES = (
    "services/api/tests/",
    "db/migrations/",
    # This file has to name its own subject, in the constant above and in this
    # docstring — it is the check, not a thing being checked.
    "scripts/check_append_only_bypass.py",
)
SKIP_PARTS = {"__pycache__", ".venv", ".venv.nosync", "node_modules", ".git"}


def violations(root: Path) -> list[str]:
    found = []
    for path in sorted(root.rglob("*.py")):
        if SKIP_PARTS & set(path.parts):
            continue
        rel = path.relative_to(root).as_posix()
        if rel.startswith(ALLOWED_PREFIXES):
            continue
        for lineno, line in enumerate(path.read_text().splitlines(), 1):
            if GUC in line:
                found.append(f"{rel}:{lineno}: {line.strip()}")
    return found


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    found = violations(root)
    if found:
        print(
            f"{GUC} referenced outside its two allowed locations "
            f"(services/api/tests/, db/migrations/):"
        )
        print("\n".join(found))
        return 1
    print("check_append_only_bypass: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
