"""`leona-notebooks` — compile, execute, validate and build from the command line.

    leona-notebooks compile lesson.nb.py -o lesson.ipynb [--build challenge|solution]
    leona-notebooks execute lesson.nb.py [--runner nbclient|local-sandbox] [--pngs DIR]
    leona-notebooks validate DIR [--execute]         # every .nb.py under DIR
    leona-notebooks build-curriculum SRC OUT [--execute] [--clean]
    leona-notebooks import notebook.ipynb -o notebook.nb.py
    leona-notebooks structure lesson.nb.py           # the kind's requirements this source fails

Exit status is 1 on any failure, so a CI step can run it bare.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from leona_notebooks.execution import ExecutionReport
from leona_notebooks.ipynb import from_ipynb, to_ipynb
from leona_notebooks.source import parse_source, render_source
from leona_notebooks.spec import NotebookSpec
from leona_notebooks.templates import check_structure


def _load(path: str) -> NotebookSpec:
    text = Path(path).read_text(encoding="utf-8")
    if path.endswith(".ipynb"):
        return from_ipynb(json.loads(text))
    return parse_source(text)


def _print_report(report: ExecutionReport) -> None:
    status = "OK" if report.ok else "FAILED"
    print(
        f"{status} {report.notebook_slug} via {report.runner}: {report.executed_count()} cells, {report.duration_ms} ms"
    )
    if report.environment:
        print("  env: " + ", ".join(f"{k}={v}" for k, v in report.environment.items()))
    if report.note:
        print(f"  note: {report.note}")
    for cell in report.cells:
        if cell.status == "ok":
            figures = sum(1 for out in cell.outputs if out.mime == "image/png" and out.data)
            extra = f" +{figures} fig" if figures else ""
            print(f"  ✓ {cell.id} {cell.duration_ms} ms{extra}")
        elif cell.status == "error" and cell.error:
            print(f"  ✗ {cell.id}: {cell.error.ename}: {cell.error.evalue[:200]}")
        else:
            print(f"  · {cell.id} {cell.status} {cell.note}")


def cmd_compile(args: argparse.Namespace) -> int:
    spec = _load(args.source)
    notebook = to_ipynb(spec, build=args.build)
    out = args.output or args.source.replace(".nb.py", ".ipynb")
    Path(out).write_text(
        json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    print(f"wrote {out} ({len(notebook['cells'])} cells, build={args.build})")
    return 0


def cmd_execute(args: argparse.Namespace) -> int:
    spec = _load(args.source)
    if args.runner == "nbclient":
        from leona_notebooks.local_runner import execute_with_nbclient

        executed, report = execute_with_nbclient(spec, build=args.build, timeout_s=args.timeout)
        if args.output:
            Path(args.output).write_text(
                json.dumps(executed, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
            )
    else:
        from leona_notebooks.local_runner import execute_in_local_sandbox

        report = execute_in_local_sandbox(spec, timeout_s=min(args.timeout, 120))
        if args.output:
            Path(args.output).write_text(
                json.dumps(
                    to_ipynb(spec, build=args.build, report=report), ensure_ascii=False, indent=1
                )
                + "\n",
                encoding="utf-8",
            )
    if args.pngs:
        from leona_notebooks.local_runner import write_pngs

        written = write_pngs(report, args.pngs)
        print(f"wrote {len(written)} png(s) to {args.pngs}")
    if args.report:
        Path(args.report).write_text(report.model_dump_json(indent=2), encoding="utf-8")
    _print_report(report)
    return 0 if report.ok else 1


def cmd_validate(args: argparse.Namespace) -> int:
    root = Path(args.directory)
    sources = sorted(p for p in root.rglob("*.nb.py") if "static" not in p.parts)
    if not sources:
        print(f"no .nb.py files under {root}", file=sys.stderr)
        return 1
    failures = 0
    for source in sources:
        try:
            spec = parse_source(source.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            print(f"✗ {source}: parse: {exc}")
            failures += 1
            continue
        problems = check_structure(spec)
        for problem in problems:
            print(f"✗ {source}: structure: {problem}")
        failures += len(problems)
        to_ipynb(spec, build="challenge" if spec.kind.value == "challenge" else "full")
        if args.execute:
            from leona_notebooks.local_runner import execute_with_nbclient

            builds = ["challenge", "solution"] if spec.kind.value == "challenge" else ["full"]
            for build in builds:
                _, report = execute_with_nbclient(
                    spec, build=build, timeout_s=args.timeout, cwd=source.parent
                )  # type: ignore[arg-type]
                if report.ok:
                    print(
                        f"✓ {source} [{build}] {report.executed_count()} cells, {report.duration_ms} ms"
                    )
                else:
                    failures += 1
                    _print_report(report)
        elif not problems:
            print(f"✓ {source} ({len(spec.cells)} cells, kind={spec.kind.value})")
    print(f"{len(sources)} notebook(s), {failures} failure(s)")
    return 0 if failures == 0 else 1


def cmd_build(args: argparse.Namespace) -> int:
    from leona_notebooks.curriculum import build_curriculum

    manifest = build_curriculum(
        args.source_dir,
        args.out_dir,
        execute=args.execute,
        timeout_s=args.timeout,
        clean=args.clean,
    )
    for nb in manifest.notebooks:
        print(
            f"{nb.source.name} -> "
            + ", ".join(str(p.relative_to(manifest.out_dir)) for p in nb.outputs)
        )
    print(f"copied {len(manifest.copied)} file(s); {len(manifest.notebooks)} notebook source(s)")
    for line in manifest.failures():
        print(f"✗ {line}")
    return 0 if manifest.ok else 1


def cmd_import(args: argparse.Namespace) -> int:
    spec = from_ipynb(json.loads(Path(args.notebook).read_text(encoding="utf-8")))
    out = args.output or args.notebook.replace(".ipynb", ".nb.py")
    Path(out).write_text(render_source(spec), encoding="utf-8")
    print(f"wrote {out} ({len(spec.cells)} cells)")
    return 0


def cmd_structure(args: argparse.Namespace) -> int:
    spec = _load(args.source)
    problems = check_structure(spec)
    for problem in problems:
        print(f"✗ {problem}")
    if not problems:
        print(f"✓ {spec.slug} satisfies every {spec.kind.value} requirement")
    return 0 if not problems else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="leona-notebooks",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("compile")
    p.add_argument("source")
    p.add_argument("-o", "--output")
    p.add_argument("--build", choices=["full", "challenge", "solution"], default="full")
    p.set_defaults(func=cmd_compile)

    p = sub.add_parser("execute")
    p.add_argument("source")
    p.add_argument("--runner", choices=["nbclient", "local-sandbox"], default="nbclient")
    p.add_argument("--build", choices=["full", "challenge", "solution"], default="full")
    p.add_argument("--timeout", type=int, default=120)
    p.add_argument("-o", "--output", help="write the executed .ipynb (with outputs) here")
    p.add_argument("--report", help="write the ExecutionReport JSON here")
    p.add_argument("--pngs", help="write captured figures to this directory")
    p.set_defaults(func=cmd_execute)

    p = sub.add_parser("validate")
    p.add_argument("directory")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--timeout", type=int, default=300)
    p.set_defaults(func=cmd_validate)

    p = sub.add_parser("build-curriculum")
    p.add_argument("source_dir")
    p.add_argument("out_dir")
    p.add_argument("--execute", action="store_true")
    p.add_argument("--timeout", type=int, default=300)
    p.add_argument("--clean", action="store_true")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("import")
    p.add_argument("notebook")
    p.add_argument("-o", "--output")
    p.set_defaults(func=cmd_import)

    p = sub.add_parser("structure")
    p.add_argument("source")
    p.set_defaults(func=cmd_structure)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
