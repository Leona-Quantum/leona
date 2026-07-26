#!/usr/bin/env python3
"""Severity gate over an osv-scanner JSON report (security.yml `osv` job).

Replaces `snyk test --all-projects --severity-threshold=high`, which stopped
being usable when the Snyk account ran out of quota permanently (2026-07-20).
osv-scanner covers the same ground for free with no account — it reads both of
our lockfiles, `uv.lock` and `pnpm-lock.yaml` — but its `scan` command has no
severity threshold: it fails on *any* advisory at all. That distinction is not
academic. On the day this landed the repo's only finding was postcss 8.4.31
(GHSA-qx2v-qp2m-jg93, CVSS 6.1 MODERATE), which Snyk's threshold passed. An
unfiltered gate would have been red from its first run, and a permanently red
required check is how the Snyk one ended up bypassed in the first place.

So the threshold lives here instead. Two things fail the build:

  * CVSS base score >= 7.0 (HIGH or CRITICAL), read from the `max_severity`
    osv-scanner computes per vulnerability group.
  * Any OSV malicious-package advisory (`MAL-...`). These carry no CVSS score
    at all, so a score-only rule would wave through the single worst thing
    that can appear in a lockfile.

Anything else is printed and does not fail. Unscored non-MAL advisories are the
deliberate soft spot: they are usually reserved/disputed CVEs, and blocking on
them reproduces the noise problem. They are listed under NOT BLOCKING so a
reviewer can still see them.

To accept a specific finding, add its OSV id to ALLOWLIST below with a reason
and a review date. Prefer upgrading.

Usage: python scripts/check_osv_report.py osv.json   (exit 1 on blocking finds)
"""

import json
import sys
from pathlib import Path

BLOCKING_CVSS = 7.0

# OSV id -> why it is accepted. Keep short, dated, and revisit on expiry.
ALLOWLIST: dict[str, str] = {
    # brace-expansion DoS (unbounded expansion -> OOM). The 5.x line is patched
    # via a pnpm override; this covers the 2.x copy that only
    # @redocly/openapi-core pulls, through openapi-typescript, for the contracts
    # codegen. Accepted rather than upgraded because there is no fix available:
    # 2.1.2 is the last 2.x and upstream patched only 5.0.8, and the override
    # that would reach it (minimatch@^5 -> 10) breaks @redocly, which calls
    # minimatch's removed callable default export. Verified against the
    # installed file. Build-time only, never on a request path, and the pattern
    # it globs is our own OpenAPI spec, not user input — an attacker has no way
    # to supply the pathological brace expression. Revisit 2026-10-26, or
    # sooner if openapi-typescript moves to @redocly 2.x.
    "GHSA-mh99-v99m-4gvg": "brace-expansion 2.1.2 via @redocly codegen; no fix in 2.x; build-time only; review 2026-10-26",
}


def _score(group: dict) -> float | None:
    """osv-scanner reports max_severity as a string, and "" when unscored."""
    try:
        return float(group.get("max_severity") or "")
    except (TypeError, ValueError):
        return None


def findings(report: dict) -> tuple[list[str], list[str]]:
    """Returns (blocking, informational), each a list of printable lines."""
    blocking: list[str] = []
    informational: list[str] = []
    for result in report.get("results", []):
        source = result.get("source", {}).get("path", "?")
        for package in result.get("packages", []):
            meta = package.get("package", {})
            name = (
                f"{meta.get('ecosystem', '?')}/{meta.get('name', '?')}@{meta.get('version', '?')}"
            )
            for group in package.get("groups", []):
                ids = group.get("ids", [])
                score = _score(group)
                # A group's ids are the same advisory across databases; the OSV
                # id is what ALLOWLIST and the MAL- rule key off.
                malicious = any(str(i).startswith("MAL-") for i in ids)
                allowed = [i for i in ids if i in ALLOWLIST]
                label = f"{source}: {name} {','.join(map(str, ids))} " + (
                    f"CVSS {score}" if score is not None else "unscored"
                )
                if allowed:
                    informational.append(f"{label} — allowlisted: {ALLOWLIST[allowed[0]]}")
                elif malicious or (score is not None and score >= BLOCKING_CVSS):
                    blocking.append(f"{label}{' MALICIOUS PACKAGE' if malicious else ''}")
                else:
                    informational.append(label)
    return blocking, informational


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    report = json.loads(Path(sys.argv[1]).read_text())
    blocking, informational = findings(report)
    if informational:
        print(f"NOT BLOCKING (below CVSS {BLOCKING_CVSS}, or allowlisted):")
        print("\n".join(f"  {line}" for line in informational))
    if blocking:
        print(f"\nBLOCKING — CVSS >= {BLOCKING_CVSS} or a malicious package:")
        print("\n".join(f"  {line}" for line in blocking))
        print("\nUpgrade the dependency, or allowlist the id in scripts/check_osv_report.py")
        return 1
    print(f"check_osv_report: clean ({len(informational)} finding(s) below threshold)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
