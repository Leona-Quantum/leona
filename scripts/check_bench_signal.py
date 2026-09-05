#!/usr/bin/env python3
"""Refuse a nightly benchmark report that measured nothing.

`bench.yml` runs the corpus through the real pipeline and records the honest pass
rate. It deliberately does **not** gate on that rate — the >=60% figure in
`08-phases.md` is a calibration goal, and a workflow that goes red because the model
had a bad night teaches people to ignore it. This script does not change that.

What it does is separate the two things a zero can mean.

**Found 2026-09-04:** the nightly had reported `success` on every run since
2026-07-27 — at least 40 consecutive nights — while passing **0 of 31 cases every
single time**. `bench-01` is Bell/GHZ state preparation; it does not fail forty
nights running for quality reasons. Every case died at `final_execute` with
`terminal_reason: sandbox_provider_failed`, because the `VERCEL_TOKEN` repository
secret is rejected with HTTP 403. Nothing was ever measured, the job was green
throughout, and `ci-health` reported `bench green` off the same conclusion. Six
weeks of "the model scores X" rested on hand-run local benchmarks instead, and
nobody could tell, because a broken instrument and a passing one produce the same
green check.

So: fail when the report contains **no quality signal at all**, on two conditions
that a bad model cannot trigger and a broken harness always does.

* **Nothing executed.** No case reached `run_status: succeeded`. A weak model still
  gets circuits to run — they just come out wrong. Zero completed executions across
  the whole corpus is the sandbox, the provider or the database, never the answer
  quality. (Reference: the 2026-08-02 v9 run had 21 of 30.)
* **Nothing was judged.** No case carries a `verifier_decision`. A case that ran and
  was assessed has one whatever the verdict; if not one case in the corpus was ever
  assessed, there is no measurement to read.

Neither condition looks at the pass rate, so a genuinely bad night stays green and
stays visible in the report, exactly as before.

Usage:
  python scripts/check_bench_signal.py evals/report.json
  python scripts/check_bench_signal.py --self-test
"""

from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path


def signal(report: dict) -> list[str]:
    """Reasons this report is not a measurement. Empty means it is one."""
    cases = report.get("cases") or []
    problems: list[str] = []
    if not cases:
        problems.append("the report contains no cases at all — the corpus never ran")
        return problems

    executed = sum(1 for c in cases if c.get("run_status") == "succeeded")
    judged = sum(1 for c in cases if c.get("verifier_decision") is not None)
    reasons = Counter(c.get("terminal_reason") for c in cases)
    top = ", ".join(f"{name}={count}" for name, count in reasons.most_common(3))

    if executed == 0:
        problems.append(
            f"0 of {len(cases)} cases reached run_status='succeeded' — no circuit ran to "
            f"completion, so this measures the harness and not the model. "
            f"Terminal reasons: {top}"
        )
    if judged == 0:
        problems.append(
            f"0 of {len(cases)} cases carry a verifier_decision — nothing was assessed, "
            f"so the pass rate of {report.get('pass_rate')} describes nothing. "
            f"Terminal reasons: {top}"
        )
    return problems


def _self_test() -> int:
    """A guard nobody has seen go red is not evidence."""

    def case(**kw):
        base = {"run_status": "failed", "verifier_decision": None, "terminal_reason": "x"}
        base.update(kw)
        return base

    healthy = {
        "pass_rate": 0.1,
        "cases": [
            case(run_status="succeeded", verifier_decision="inconclusive"),
            case(terminal_reason="candidate_not_converging"),
        ],
    }
    dead_sandbox = {
        "pass_rate": 0.0,
        "cases": [case(terminal_reason="sandbox_provider_failed") for _ in range(3)],
    }
    ran_but_unjudged = {
        "pass_rate": 0.0,
        "cases": [case(run_status="succeeded") for _ in range(3)],
    }
    empty = {"pass_rate": 0.0, "cases": []}

    failures: list[str] = []
    # A BAD but real night must stay green: one execution, one verdict, 10% pass rate.
    if signal(healthy):
        failures.append("a real run with a low pass rate was refused — this is not a quality gate")
    if not any("no circuit ran" in p for p in signal(dead_sandbox)):
        failures.append("a corpus where nothing executed was NOT caught")
    if not any("nothing was assessed" in p for p in signal(ran_but_unjudged)):
        failures.append("a corpus where nothing was judged was NOT caught")
    if not signal(empty):
        failures.append("an empty report was NOT caught")

    if failures:
        print("check_bench_signal self-test FAILED:")
        for line in failures:
            print(f"  {line}")
        return 1
    print(
        "check_bench_signal self-test passed "
        "(a bad-but-real night accepted; dead sandbox, unjudged corpus and empty report all caught)"
    )
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()
    paths = [a for a in argv if not a.startswith("-")]
    if not paths:
        print("usage: check_bench_signal.py REPORT.json | --self-test")
        return 2
    status = 0
    for raw in paths:
        path = Path(raw)
        try:
            report = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"check_bench_signal: cannot read {path} — {exc}")
            status = 1
            continue
        problems = signal(report)
        if problems:
            print(f"check_bench_signal: {path} IS NOT A MEASUREMENT")
            for line in problems:
                print(f"  {line}")
            print(
                "  This is an instrument failure, not a bad score. Fix the harness "
                "(most likely a provider credential) before reading any number from it."
            )
            status = 1
        else:
            executed = sum(1 for c in report["cases"] if c.get("run_status") == "succeeded")
            judged = sum(1 for c in report["cases"] if c.get("verifier_decision") is not None)
            print(
                f"check_bench_signal: {path} is a measurement "
                f"({executed} executed, {judged} judged, pass_rate={report.get('pass_rate')})"
            )
    return status


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
