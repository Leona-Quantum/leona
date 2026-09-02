#!/usr/bin/env python3
"""Validate every notebook in this repository.

Standalone: this script has no dependency on the Leona notebook-authoring
tooling that generated the course. It only needs `nbformat` (always) and
`nbclient` (only with `--execute`), both installed by the `notebooks` extra
(`uv sync --locked --extra notebooks`, or `pip install -r requirements.txt
-r requirements-notebooks.txt`).

Usage:

    python scripts/validate_notebooks.py                  # structural check only
    python scripts/validate_notebooks.py --execute         # also run every cell
    python scripts/validate_notebooks.py --only week02      # filter by path substring
    python scripts/validate_notebooks.py --execute --only week02/challenge

Exits 0 if every discovered notebook is valid (and, with --execute, runs
without error); exits 1 if any notebook fails either check.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import nbformat

#: Directory name fragments to skip entirely while walking the tree. A
#: notebook under any of these is not part of the course and should not be
#: graded (a learner's own venv, checkpoint cache, or editor state).
EXCLUDED_DIR_PARTS = {".venv", "venv", ".ipynb_checkpoints", ".git", "node_modules"}

DEFAULT_TIMEOUT_S = 300


def discover_notebooks(root: Path, only: str | None) -> list[Path]:
    """Find every `*.ipynb` under `root`, skipping excluded directories.

    `only` is an optional substring filter applied to the path relative to
    `root` (as a string), so `--only week02` matches any notebook whose
    relative path contains "week02" anywhere.
    """
    found: list[Path] = []
    for path in sorted(root.rglob("*.ipynb")):
        if any(part in EXCLUDED_DIR_PARTS for part in path.parts):
            continue
        if only is not None and only not in str(path.relative_to(root)):
            continue
        found.append(path)
    return found


def validate_structure(path: Path) -> str | None:
    """Read and validate one notebook with `nbformat`.

    Returns `None` on success, or an error message string on failure.
    """
    try:
        notebook = nbformat.read(str(path), as_version=4)
        nbformat.validate(notebook)
    except Exception as exc:  # noqa: BLE001 - report any failure, don't classify it
        return f"{type(exc).__name__}: {exc}"
    return None


def execute_notebook(path: Path, timeout_s: int) -> str | None:
    """Run one notebook end to end with `nbclient`.

    Returns `None` on success, or an error message string on failure.
    Imported lazily so `--execute`-free runs never need `nbclient` installed.
    """
    from nbclient import NotebookClient
    from nbclient.exceptions import CellExecutionError

    try:
        notebook = nbformat.read(str(path), as_version=4)
        client = NotebookClient(
            notebook,
            timeout=timeout_s,
            kernel_name="python3",
            resources={"metadata": {"path": str(path.parent)}},
        )
        client.execute()
    except CellExecutionError as exc:
        return f"CellExecutionError: {str(exc).splitlines()[0]}"
    except Exception as exc:  # noqa: BLE001 - report any failure, don't classify it
        return f"{type(exc).__name__}: {exc}"
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Also run every cell through nbclient (default: structural check only).",
    )
    parser.add_argument(
        "--only",
        default=None,
        help="Only check notebooks whose relative path contains this substring.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=DEFAULT_TIMEOUT_S,
        help=f"Per-notebook execution timeout in seconds (default: {DEFAULT_TIMEOUT_S}).",
    )
    parser.add_argument(
        "--root",
        default=None,
        help="Repository root to search (default: this script's parent directory).",
    )
    args = parser.parse_args(argv)

    root = Path(args.root) if args.root else Path(__file__).resolve().parent.parent
    notebooks = discover_notebooks(root, args.only)

    if not notebooks:
        print(f"No notebooks found under {root} (filter: {args.only!r}).")
        return 1

    failures: list[tuple[Path, str]] = []
    for path in notebooks:
        rel = path.relative_to(root)
        start = time.monotonic()

        error = validate_structure(path)
        if error is not None:
            print(f"✗ {rel}  (structure: {error})")
            failures.append((path, error))
            continue

        if args.execute:
            error = execute_notebook(path, args.timeout)
            if error is not None:
                print(f"✗ {rel}  (execute: {error})")
                failures.append((path, error))
                continue

        elapsed = time.monotonic() - start
        print(f"✓ {rel}  ({elapsed:.1f}s)")

    checked = "structure + execute" if args.execute else "structure only"
    print(f"\n{len(notebooks) - len(failures)}/{len(notebooks)} notebooks passed ({checked}).")
    if failures:
        print(f"{len(failures)} failure(s):")
        for path, error in failures:
            print(f"  - {path.relative_to(root)}: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
