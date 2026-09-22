"""Bridges to the REAL production ranking function via a Node subprocess
(`evals/jev-trial/scripts/finder-rank.mts`) — see that script's own docstring for why
this is a bridge to the real `findMethods` rather than a Python reimplementation of
it.

This module never touches the network or a database; it shells out to `node` against
files already on disk in this worktree."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

from majorana_evals.jev_trial.schema import CuratedCase, FinderCandidate, FinderRanking

#: `evals/jev-trial/` relative to this file (`evals/harness/src/majorana_evals/jev_trial/`).
_JEV_TRIAL_DIR = Path(__file__).resolve().parents[4] / "jev-trial"
_REPO_ROOT = _JEV_TRIAL_DIR.parent
_SCRIPT = _JEV_TRIAL_DIR / "scripts" / "finder-rank.mts"
_LOADER = _JEV_TRIAL_DIR / "scripts" / "ts-extensionless-loader.mjs"


class FinderBridgeError(RuntimeError):
    """The Node subprocess failed, produced no output, or produced output this
    module could not parse as the documented {"corpus_size", "results": [...]} shape.
    Never silently treated as an empty ranking."""


def rank_via_finder(cases: list[CuratedCase]) -> tuple[int, dict[str, FinderRanking]]:
    """Runs every case through the real `findMethods` in one Node subprocess call
    (cheaper than one process per case — the corpus is ~2.4 MB and is loaded once).

    Returns (corpus_size, {case_id: FinderRanking}). Raises `FinderBridgeError` on
    any failure — including `node` not being on PATH, which this repo's own
    `evals/harness/AGENTS.md`-adjacent tooling always assumes is present (the monorepo
    is a pnpm/Node workspace at its root)."""

    payload = json.dumps({"cases": [{"id": c.id, "domain": c.domain} for c in cases]})
    try:
        completed = subprocess.run(
            [
                "node",
                "--experimental-strip-types",
                f"--experimental-loader={_LOADER}",
                str(_SCRIPT),
            ],
            input=payload,
            capture_output=True,
            text=True,
            cwd=_REPO_ROOT,
            timeout=120,
        )
    except FileNotFoundError as exc:
        raise FinderBridgeError(
            "`node` was not found on PATH — the finder bridge needs the repo's own "
            "Node toolchain (see apps/web/package.json's engines.node)."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise FinderBridgeError(f"finder-rank.mts did not finish within 120s: {exc}") from exc

    if completed.returncode != 0:
        raise FinderBridgeError(
            f"finder-rank.mts exited {completed.returncode}. stderr:\n{completed.stderr}"
        )
    if not completed.stdout.strip():
        raise FinderBridgeError(f"finder-rank.mts produced no stdout. stderr:\n{completed.stderr}")

    try:
        parsed = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise FinderBridgeError(
            f"finder-rank.mts stdout was not valid JSON: {exc}\nstdout:\n{completed.stdout}"
        ) from exc

    if "corpus_size" not in parsed or "results" not in parsed:
        raise FinderBridgeError(f"finder-rank.mts stdout missing expected keys: {parsed.keys()}")

    rankings: dict[str, FinderRanking] = {}
    for row in parsed["results"]:
        rankings[row["id"]] = FinderRanking(
            case_id=row["id"],
            domain=row["domain"],
            pool_size=row["pool_size"],
            ranked=[
                FinderCandidate(
                    slug=r["slug"],
                    title=r["title"],
                    algorithm_family=r["algorithm_family"],
                    description=r["description"],
                    satisfied_count=r["satisfied_count"],
                )
                for r in row["ranked"]
            ],
        )

    missing = {c.id for c in cases} - rankings.keys()
    if missing:
        raise FinderBridgeError(
            f"finder-rank.mts did not return a result for cases: {sorted(missing)}"
        )

    return parsed["corpus_size"], rankings
