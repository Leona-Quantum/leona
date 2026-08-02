"""Fail unless the live-provider e2e actually executed and passed.

`pytest` exits 0 for "1 skipped" exactly as it does for "1 passed". So in the one
workflow whose entire purpose is to prove a real provider still drives the whole
pipeline, the exit code cannot tell success from "the test did not run" — which
is the failure this check exists to end. On 2026-08-02 an outage reached
production behind 1,709 green tests for precisely that reason.

Reads the JUnit XML pytest wrote and asserts on what ran.

    python scripts/assert_live_test_ran.py live-e2e.xml [--expect 1]
"""

from __future__ import annotations

import argparse
import sys
import xml.etree.ElementTree as ET
from pathlib import Path


def _counts(report: Path) -> tuple[int, int, int]:
    """(tests, skipped, failures+errors) summed across every suite in the file.

    Summed rather than read off the first `<testsuite>`: pytest nests suites
    inside `<testsuites>`, and reading only the first would silently ignore
    anything after it.
    """
    root = ET.parse(report).getroot()
    suites = root.findall(".//testsuite")
    if not suites and root.tag == "testsuite":
        suites = [root]
    tests = sum(int(s.get("tests", 0)) for s in suites)
    skipped = sum(int(s.get("skipped", 0)) for s in suites)
    bad = sum(int(s.get("failures", 0)) + int(s.get("errors", 0)) for s in suites)
    return tests, skipped, bad


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument(
        "--expect",
        type=int,
        default=1,
        help="how many tests must have run (default 1)",
    )
    args = parser.parse_args(argv)

    if not args.report.exists():
        print(f"::error::{args.report} does not exist — the pytest step produced no report")
        return 1

    try:
        tests, skipped, bad = _counts(args.report)
    except ET.ParseError as exc:
        print(f"::error::{args.report} is not parseable JUnit XML: {exc}")
        return 1

    print(f"tests={tests} skipped={skipped} failures+errors={bad}")

    if tests == 0:
        print("::error::collected 0 tests — the live e2e was renamed, moved or deselected")
        return 1
    if skipped:
        print(
            "::error::the live e2e was SKIPPED, which is not a pass. Check that "
            "MAJORANA_RUN_LIVE_LLM=1 and that the provider secrets are set on this repository."
        )
        return 1
    if bad:
        print("::error::the live e2e ran against a real provider and failed")
        return 1
    if tests != args.expect:
        print(f"::error::expected exactly {args.expect} test(s) to run, {tests} did")
        return 1

    print("the live e2e ran against a real provider and passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
