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

The gate also refuses a report that scanned nothing. `osv-scanner` emits
`{"results": []}` when it finds no lockfiles at all, and an empty finding list
is indistinguishable from a clean one by severity alone — so a scanner that
silently stopped reading our lockfiles would report the repo as clean forever.
REQUIRED_SOURCES makes the report carry its own denominator: each lockfile must
appear with a plausible package count, which needs `--all-packages` on the scan
(without it, osv-scanner lists only sources that HAVE advisories, so a clean
lockfile is absent from the report and cannot be told apart from an unread one).

Usage: python scripts/check_osv_report.py osv.json   (exit 1 on blocking finds)
       python scripts/check_osv_report.py --self-test
"""

import json
import sys
from pathlib import Path

BLOCKING_CVSS = 7.0

# lockfile -> the fewest packages a real scan of it can plausibly report.
#
# These are floors against a scan that read nothing or read a truncated file,
# not an inventory: measured on origin/dev at 45395f9e, `pnpm-lock.yaml` held
# 484 packages and `uv.lock` held 161, so the floors sit near a quarter of each
# and survive ordinary dependency churn. If a real removal ever takes a lockfile
# below its floor, lower the floor in the same commit that removes the deps —
# do not delete the entry, which is what turns this back into a vacuous gate.
REQUIRED_SOURCES: dict[str, int] = {
    "uv.lock": 40,
    "pnpm-lock.yaml": 100,
}

# OSV id -> why it is accepted. Keep short, dated, and revisit on expiry.
#
# Empty on purpose. The one entry that lived here — GHSA-mh99-v99m-4gvg on the
# 2.x brace-expansion copy — was accepted because 2.1.2 was the last 2.x release
# and upstream had patched only the 5.x line. Upstream shipped 2.1.3 and 2.1.4
# afterwards, so the finding became upgradable and both copies are now pinned
# forward in pnpm-workspace.yaml instead. That is the general lesson: an
# acceptance whose stated reason is "no fix exists" is a claim about a moment in
# time, and it does not re-check itself. Re-read the advisory before renewing one.
ALLOWLIST: dict[str, str] = {}


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


def coverage_failures(report: dict) -> list[str]:
    """Returns a line per required lockfile the report does not show as scanned.

    Separate from findings() on purpose: findings() answers "is anything wrong
    with what was scanned", this answers "was anything scanned at all". The two
    fail for opposite reasons and a report can pass one while failing the other.
    """
    scanned: dict[str, int] = {}
    for result in report.get("results", []):
        path = str(result.get("source", {}).get("path", ""))
        count = len(result.get("packages", []))
        # osv-scanner reports absolute runner paths; match the lockfile itself.
        name = path.rsplit("/", 1)[-1]
        if name in REQUIRED_SOURCES:
            scanned[name] = max(scanned.get(name, 0), count)
    problems = []
    for name, floor in sorted(REQUIRED_SOURCES.items()):
        if name not in scanned:
            problems.append(f"{name}: not scanned — absent from the report")
        elif scanned[name] < floor:
            problems.append(f"{name}: only {scanned[name]} packages, floor is {floor}")
    return problems


def _self_test() -> int:
    """Prove both halves still fail before their verdicts are believed.

    A clean scan from a broken gate is indistinguishable from a clean scan,
    which is how the Snyk check stayed meaningless for months.
    """
    full = {
        "results": [
            {
                "source": {"path": f"/home/runner/work/majorana/majorana/{name}"},
                "packages": [{"package": {"name": f"p{i}"}} for i in range(floor + 1)],
            }
            for name, floor in REQUIRED_SOURCES.items()
        ]
    }
    cases: list[tuple[str, bool, dict]] = [
        ("a report covering every lockfile passes", False, full),
        ("an empty report is refused", True, {"results": []}),
        ("a report with no results key is refused", True, {}),
        (
            "one missing lockfile is refused",
            True,
            {"results": full["results"][:1]},
        ),
        (
            "a lockfile under its floor is refused",
            True,
            {"results": [{"source": {"path": n}, "packages": []} for n in REQUIRED_SOURCES]},
        ),
    ]
    failed = 0
    for label, want_problems, report in cases:
        got = bool(coverage_failures(report))
        ok = got == want_problems
        print(f"  {'ok  ' if ok else 'FAIL'} {label}")
        failed += not ok
    # The severity half, mutated the same way: a threshold that never fires is
    # the failure mode this file exists to prevent.
    high = {
        "results": [
            {
                "source": {"path": "uv.lock"},
                "packages": [
                    {
                        "package": {"name": "w", "version": "1", "ecosystem": "PyPI"},
                        "groups": [{"ids": ["GHSA-x"], "max_severity": "9.8"}],
                    }
                ],
            }
        ]
    }
    if not findings(high)[0]:
        print("  FAIL a CVSS 9.8 finding must block")
        failed += 1
    else:
        print("  ok   a CVSS 9.8 finding blocks")
    print(f"check_osv_report --self-test: {'FAILED' if failed else 'passed'}")
    return 1 if failed else 0


def main() -> int:
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        return _self_test()
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    path = Path(sys.argv[1])
    try:
        report = json.loads(path.read_text())
    except FileNotFoundError:
        print(f"check_osv_report: no report at {path} — the scan did not run")
        return 1
    except json.JSONDecodeError as exc:
        # An unreadable report is a scanner that died mid-write, not a clean repo.
        print(f"check_osv_report: {path} is not valid JSON ({exc}) — the scan did not run")
        return 1
    if not isinstance(report, dict):
        print(f"check_osv_report: {path} is not an osv-scanner report")
        return 1

    uncovered = coverage_failures(report)
    if uncovered:
        print("SCAN DID NOT COVER THE LOCKFILES IT GATES:")
        print("\n".join(f"  {line}" for line in uncovered))
        print(
            "\nA report that scanned nothing looks exactly like a clean one. Check that"
            "\nosv-scanner ran with --all-packages and that the lockfiles are present."
        )
        return 1

    blocking, informational = findings(report)
    if informational:
        print(f"NOT BLOCKING (below CVSS {BLOCKING_CVSS}, or allowlisted):")
        print("\n".join(f"  {line}" for line in informational))
    if blocking:
        print(f"\nBLOCKING — CVSS >= {BLOCKING_CVSS} or a malicious package:")
        print("\n".join(f"  {line}" for line in blocking))
        print("\nUpgrade the dependency, or allowlist the id in scripts/check_osv_report.py")
        return 1
    # Print what was scanned, not just the verdict: "clean" is only meaningful
    # next to the number of packages it is a statement about.
    scanned = ", ".join(
        f"{str(r.get('source', {}).get('path', '?')).rsplit('/', 1)[-1]}"
        f" {len(r.get('packages', []))}"
        for r in report.get("results", [])
    )
    print(
        f"check_osv_report: clean ({len(informational)} finding(s) below threshold; "
        f"scanned {scanned})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
