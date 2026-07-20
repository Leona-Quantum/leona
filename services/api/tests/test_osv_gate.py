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
