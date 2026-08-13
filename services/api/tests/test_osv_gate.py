"""Test-the-test for scripts/check_osv_report.py.

The gate replaced Snyk's `--severity-threshold=high` (security.yml). Its whole
job is to fail on some findings and not others, so both halves are probed here:
a threshold that never fires is the "check that cannot fail" failure mode this
repo has already paid for once.
"""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

spec = importlib.util.spec_from_file_location(
    "check_osv_report", REPO_ROOT / "scripts" / "check_osv_report.py"
)
check_osv_report = importlib.util.module_from_spec(spec)
sys.modules["check_osv_report"] = check_osv_report
spec.loader.exec_module(check_osv_report)


def _report(ids, max_severity):
    """Shaped like real osv-scanner output — see its `scan source --format json`."""
    return {
        "results": [
            {
                "source": {"path": "pnpm-lock.yaml"},
                "packages": [
                    {
                        "package": {"name": "widget", "version": "1.0.0", "ecosystem": "npm"},
                        "groups": [{"ids": ids, "max_severity": max_severity}],
                    }
                ],
            }
        ]
    }


def test_high_and_critical_block():
    for score in ("7.0", "9.8"):
        blocking, _ = check_osv_report.findings(_report(["GHSA-aaaa-bbbb-cccc"], score))
        assert blocking, f"CVSS {score} must block"


def test_below_high_does_not_block():
    # The real case that motivated the threshold: postcss 8.4.31 at CVSS 6.1,
    # which Snyk passed and an unfiltered osv-scanner run fails.
    blocking, informational = check_osv_report.findings(_report(["GHSA-qx2v-qp2m-jg93"], "6.1"))
    assert blocking == []
    assert informational and "6.1" in informational[0]


def test_malicious_package_blocks_without_a_score():
    """OSV malicious-package advisories carry no CVSS, so a score-only rule
    would wave through the worst thing that can land in a lockfile."""
    blocking, _ = check_osv_report.findings(_report(["MAL-2026-1234"], ""))
    assert blocking and "MALICIOUS" in blocking[0]


def test_unscored_advisory_is_reported_but_does_not_block():
    blocking, informational = check_osv_report.findings(_report(["GHSA-dddd-eeee-ffff"], ""))
    assert blocking == []
    assert informational and "unscored" in informational[0]


def test_allowlisted_id_does_not_block(monkeypatch):
    monkeypatch.setitem(check_osv_report.ALLOWLIST, "GHSA-aaaa-bbbb-cccc", "probe")
    blocking, informational = check_osv_report.findings(_report(["GHSA-aaaa-bbbb-cccc"], "9.8"))
    assert blocking == []
    assert "allowlisted" in informational[0]


def test_empty_report_is_clean():
    assert check_osv_report.findings({"results": []}) == ([], [])


# The other half of the gate: findings() answers "is anything wrong with what was
# scanned", coverage_failures() answers "was anything scanned". A report of no
# findings and a report of no scan are the same object to the first function, and
# `|| true` on the scan step used to let the second one through as "clean".


ROOT = "/home/runner/work/majorana/majorana"


def _covered(prefix="", **counts):
    """A report shaped like `osv-scanner --all-packages`, which lists every
    lockfile it read rather than only the ones carrying advisories."""
    return {
        "results": [
            {
                # osv-scanner reports absolute runner paths, not basenames.
                "source": {"path": f"{ROOT}/{prefix}{name}"},
                "packages": [{"package": {"name": f"p{i}"}} for i in range(n)],
            }
            for name, n in counts.items()
        ]
    }


def _full(prefix=""):
    return _covered(prefix, **{n: f + 1 for n, f in check_osv_report.REQUIRED_SOURCES.items()})


def _failures(report):
    return check_osv_report.coverage_failures(report, root=ROOT)


def test_a_report_covering_every_lockfile_passes():
    assert _failures(_full()) == []


def test_a_scan_that_read_nothing_is_refused():
    """The failure this exists for: osv-scanner emits `{"results": []}` when it
    finds no lockfiles, which is byte-identical to a clean scan by severity."""
    for empty in ({"results": []}, {}):
        assert _failures(empty), f"{empty} must be refused"


def test_a_missing_lockfile_is_refused():
    problems = _failures(_covered(**{"uv.lock": 500}))
    assert any("pnpm-lock.yaml" in p and "not scanned" in p for p in problems)


def test_a_lockfile_under_its_floor_is_refused():
    """A truncated or half-parsed lockfile still produces a source entry."""
    problems = _failures(_covered(**{"uv.lock": 1, "pnpm-lock.yaml": 1}))
    assert len(problems) == 2
    assert all("floor is" in p for p in problems)


def test_a_nested_lockfile_does_not_answer_for_the_root_one():
    """Matching a bare basename let any lockfile in the tree satisfy the floor —
    a `fixtures/uv.lock` would stand in for the real one, which is the same
    vacuous pass this check exists to prevent, only harder to see."""
    problems = _failures(_full("fixtures/"))
    assert len(problems) == 2
    assert all("not scanned" in p for p in problems)


def test_a_lockfile_outside_the_scan_root_does_not_count():
    report = {
        "results": [
            {"source": {"path": f"/elsewhere/{n}"}, "packages": [{}] * 999}
            for n in check_osv_report.REQUIRED_SOURCES
        ]
    }
    assert len(_failures(report)) == 2


def test_a_relative_report_path_is_read_as_repo_relative():
    """Some osv-scanner outputs are already relative to the scan root."""
    report = {
        "results": [
            {"source": {"path": n}, "packages": [{}] * (f + 1)}
            for n, f in check_osv_report.REQUIRED_SOURCES.items()
        ]
    }
    assert _failures(report) == []


def test_coverage_is_independent_of_findings():
    """A report can carry a blocking advisory and still be fully covered — the
    two checks must not stand in for each other."""
    report = _full()
    report["results"][0]["packages"][0]["groups"] = [
        {"ids": ["GHSA-aaaa-bbbb-cccc"], "max_severity": "9.8"}
    ]
    assert _failures(report) == []
    assert check_osv_report.findings(report)[0]


def test_the_self_test_passes():
    """The gate's own CI self-test, so a break shows up in pytest too."""
    assert check_osv_report._self_test() == 0
