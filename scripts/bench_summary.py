#!/usr/bin/env python3
"""One paragraph for the nightly job summary: the number, and which lane produced it.

The nightly has two lanes since ai-ops#257 — the Vercel microVM the product actually
uses, and a local-subprocess fallback that needs no Vercel credential and runs only when
the first measured nothing. They are not interchangeable, and the failure this exists to
prevent is a figure being quoted later without its boundary attached: "the model scores
67%" is a different claim on a Firecracker microVM and on a subprocess double.

So every number printed here carries its lane, and a lane with no measurement is printed
as "measured nothing" rather than as 0% — a broken instrument and a bad night are the
distinction the whole of `check_bench_signal.py` exists to draw, and it would be undone
by a summary that rendered both as a zero.

Usage:
  python scripts/bench_summary.py evals/report.json [evals/report-local.json]
  python scripts/bench_summary.py --self-test
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from check_bench_signal import signal  # noqa: E402

LANES = {
    "report.json": ("Vercel microVM", "the isolation boundary a user gets"),
    "report-local.json": ("local subprocess", "NOT the isolation boundary a user gets"),
}


def _lane(path: Path) -> tuple[str, str]:
    return LANES.get(path.name, ("unknown lane", "boundary unstated"))


def describe(path: Path) -> str:
    """One markdown line for one report file."""
    name, caveat = _lane(path)
    if not path.exists():
        return f"- **{name}** — did not run."
    try:
        report = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return f"- **{name}** — unreadable report ({exc})."
    cases = report.get("cases") or []
    problems = signal(report)
    if problems:
        return (
            f"- **{name}** — **measured nothing** over {len(cases)} case(s): "
            + "; ".join(problems)
            + ". This is an instrument failure, not a score."
        )
    passed = sum(1 for c in cases if c.get("verifier_decision") == "pass")
    judged = sum(1 for c in cases if c.get("verifier_decision") is not None)
    rate = f"{100 * passed / judged:.0f}%" if judged else "n/a"
    return f"- **{name}** — {passed}/{judged} judged cases pass ({rate}) — {caveat}."


def render(paths: list[Path]) -> str:
    lines = ["## Nightly quality", ""]
    lines.extend(describe(p) for p in paths)
    lines += [
        "",
        "The job's verdict follows the Vercel lane alone. A fallback number is a "
        "measurement of the model, not of the product's sandbox.",
    ]
    return "\n".join(lines) + "\n"


def _self_test() -> int:
    """Both arms: a real measurement must not read as dead, and a dead one must not
    read as a score. A summary that printed 0% for both would be the defect."""
    import tempfile

    def case(**kw):
        base = {"run_status": "succeeded", "verifier_decision": "pass"}
        base.update(kw)
        return base

    failures: list[str] = []
    with tempfile.TemporaryDirectory() as tmp:
        good = Path(tmp) / "report.json"
        good.write_text(
            json.dumps({"cases": [case(), case(verifier_decision="fail"), case()]}),
            encoding="utf-8",
        )
        dead = Path(tmp) / "report-local.json"
        dead.write_text(
            json.dumps(
                {"cases": [{"run_status": "failed", "verifier_decision": None}] * 3}
            ),
            encoding="utf-8",
        )
        good_line, dead_line = describe(good), describe(dead)
        if "2/3" not in good_line or "67%" not in good_line:
            failures.append(f"a real measurement did not render its rate: {good_line}")
        if "measured nothing" not in dead_line:
            failures.append(f"a dead lane did not say so: {dead_line}")
        if "0%" in dead_line:
            failures.append("a dead lane rendered as a score of 0%, the exact conflation")
        missing = describe(Path(tmp) / "report-local.json.absent")
        if "did not run" not in missing:
            failures.append(f"an absent report did not say so: {missing}")
    if failures:
        print("bench_summary self-test FAILED:")
        for line in failures:
            print(f"  {line}")
        return 1
    print("bench_summary self-test passed (a score reads as a score, a dead lane does not)")
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()
    paths = [Path(a) for a in argv if not a.startswith("-")]
    if not paths:
        print("usage: bench_summary.py REPORT.json [REPORT-local.json] | --self-test")
        return 2
    sys.stdout.write(render(paths))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
