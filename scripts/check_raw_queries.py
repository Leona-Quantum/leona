#!/usr/bin/env python3
"""CI gate for the authz invariant (AGENTS.md rule 2, 02-architecture.md §4):
no raw DB access outside the repository layer.

Scans production Python under services/ and packages/py/ for query-shaped
calls; only the repository layer + engine/ORM modules may contain them.
db/ (migrations, seeds) and tests are out of scope — migrations are frozen
history and the authz suite exercises the repo API, not SQL.

Usage: python scripts/check_raw_queries.py [ROOT]   (exit 1 on violations)
"""

import re
import sys
from pathlib import Path

FORBIDDEN = [
    re.compile(r"\.query\("),
    re.compile(r"\.execute\("),
    re.compile(r"\.executemany\("),
    re.compile(r"\btext\("),
    re.compile(r"^\s*(import psycopg|from psycopg)\b"),
    re.compile(r"^\s*(import sqlalchemy|from sqlalchemy)\b"),
]
SCAN_DIRS = ("services", "packages/py")
ALLOWED_PREFIXES = (
    "services/api/src/majorana_api/repos/",
    "services/api/src/majorana_api/db.py",
    "services/api/src/majorana_api/orm.py",
)
SKIP_PARTS = {"tests", "__pycache__", ".venv", ".venv.nosync"}


def violations(root: Path) -> list[str]:
    found = []
    for scan_dir in SCAN_DIRS:
        base = root / scan_dir
        if not base.is_dir():
            continue
        for path in sorted(base.rglob("*.py")):
            if SKIP_PARTS & set(path.parts):
                continue
            rel = path.relative_to(root).as_posix()
            if rel.startswith(ALLOWED_PREFIXES):
                continue
            for lineno, line in enumerate(path.read_text().splitlines(), 1):
                if any(pat.search(line) for pat in FORBIDDEN):
                    found.append(f"{rel}:{lineno}: {line.strip()}")
    return found


def main() -> int:
    root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent
    found = violations(root)
    if found:
        print("Raw DB access outside the repository layer (AGENTS.md rule 2):")
        print("\n".join(found))
        return 1
    print("check_raw_queries: clean")
    return 0


if __name__ == "__main__":
    sys.exit(main())
