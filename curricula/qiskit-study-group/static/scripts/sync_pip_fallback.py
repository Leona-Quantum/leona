#!/usr/bin/env python3
"""Generate the pip fallback files from uv.lock, so their floors can never lag it.

    uv run python scripts/sync_pip_fallback.py            # rewrite both files
    uv run python scripts/sync_pip_fallback.py --check    # CI: exit 1 if either is stale
    uv run python scripts/sync_pip_fallback.py --self-test

## Why this exists

`requirements.txt` and `requirements-notebooks.txt` are resolved fresh on a learner's
machine, so any version they permit is an environment the course supports, and
osv-scanner reads them that way: a dependency the file does not name is resolved to an
old release, and a floor below the lock is read at the floor. Both files were
hand-maintained, and the same failure reached the repository-wide `osv` gate four times
in three weeks, each time failing every open PR whatever it changed:

  pillow      unnamed, resolved to 9.5.0          (seven advisories up to CVSS 9.3)
  nbconvert   unnamed, resolved to 7.9.2          (CVSS 8.5 and two more)
  jupyterlab  floor >=4.6, lock at 4.6.3          (two XSS advisories, 2026-09-17, PR 922)
  anyio       unnamed, resolved to 4.9.0          (CVSS 9.3, 2026-09-18, PR 924)

Each was fixed by hand-adding one floor, and nothing stopped the next. Here every
package uv.lock resolves for a file's scope is named, at a floor equal to the locked
version. osv then reads exactly the environment `uv sync --locked` installs, and it goes
red only when the lock itself is vulnerable, which is the true positive: fix it with
`uv lock --upgrade-package <name>` and re-run this.

## What is kept from pyproject.toml

Floors only move up, so a plain floor would drop an upper bound the course depends on
(`qiskit>=2.5,<2.6` pins the Qiskit series the material is written against). For each
package pyproject.toml names directly, its non-floor clauses (`<`, `<=`, `!=`) are kept
beside the lock's floor. `~=` and `==` are refused rather than guessed at.

Everything above the marker line in each file is hand-written prose and is preserved;
everything below it is generated.
"""

from __future__ import annotations

import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER = (
    "# ---- Generated from uv.lock by scripts/sync_pip_fallback.py. Do not edit below this"
    " line: change pyproject.toml or uv.lock, then run"
    " `uv run python scripts/sync_pip_fallback.py`. ----"
)
# (file, extra or None). The notebooks file is installed ALONGSIDE requirements.txt
# (README: `pip install -r requirements.txt -r requirements-notebooks.txt`), so it names
# only what the extra adds.
FILES = [("requirements.txt", None), ("requirements-notebooks.txt", "notebooks")]

_LINE = re.compile(
    r"^(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)==(?P<version>[^\s;]+)\s*(?:;\s*(?P<marker>.+))?$"
)
_NAME = re.compile(r"^\s*(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*(?P<spec>[^;]*)")


def normalise(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_export(text: str) -> list[tuple[str, str, str]]:
    """`uv export` requirements text -> [(name, version, marker)]. Refuses what it cannot read."""
    out = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        m = _LINE.match(line)
        if not m:
            raise SystemExit(f"sync_pip_fallback: cannot read this `uv export` line: {line!r}")
        # Canonical name, and markers in one quote style with single spaces: CI installs the
        # latest uv, which need not print either the way the uv that generated the file did,
        # and a check that fails on formatting teaches its reader to regenerate blindly.
        marker = re.sub(r"\s+", " ", (m["marker"] or "").replace('"', "'")).strip()
        out.append((normalise(m["name"]), m["version"], marker))
    if not out:
        raise SystemExit(
            "sync_pip_fallback: `uv export` produced no packages; refusing to write an empty file"
        )
    return out


def upper_clauses(pyproject: dict, extra: str | None) -> dict[str, list[str]]:
    """Normalised name -> the non-floor specifier clauses pyproject.toml states for it."""
    reqs = list(pyproject["project"].get("dependencies", []))
    if extra:
        reqs += pyproject["project"].get("optional-dependencies", {}).get(extra, [])
    kept: dict[str, list[str]] = {}
    for req in reqs:
        m = _NAME.match(req)
        if not m:
            raise SystemExit(
                f"sync_pip_fallback: cannot read requirement {req!r} in pyproject.toml"
            )
        clauses = [c.strip() for c in m["spec"].split(",") if c.strip()]
        for c in clauses:
            if c.startswith(("~=", "==", "===")):
                raise SystemExit(
                    f"sync_pip_fallback: {req!r} uses {c[:3]!r}, which this script does not translate "
                    "into a floor plus bounds. Write it as explicit >= and < clauses, or extend this script."
                )
        kept[normalise(m["name"])] = [c for c in clauses if c.startswith(("<", "!="))]
    return kept


def render(entries: list[tuple[str, str, str]], bounds: dict[str, list[str]]) -> list[str]:
    lines = []
    for name, version, marker in sorted(entries, key=lambda e: (normalise(e[0]), e[2])):
        spec = ",".join([f">={version}"] + bounds.get(normalise(name), []))
        lines.append(f"{name}{spec}" + (f" ; {marker}" if marker else ""))
    return lines


def export(extra: str | None) -> str:
    cmd = [
        "uv",
        "export",
        "--frozen",
        "--no-hashes",
        "--no-header",
        "--no-annotate",
        "--no-emit-project",
        "--no-dev",
        "--format",
        "requirements.txt",
    ]
    if extra:
        cmd += ["--extra", extra]
    r = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"sync_pip_fallback: {' '.join(cmd)} failed:\n{r.stderr}")
    return r.stdout


def generate(base_text: str, extra_texts: dict[str, str], pyproject: dict) -> dict[str, list[str]]:
    base = parse_export(base_text)
    base_keys = {(normalise(n), m) for n, _, m in base}
    out = {}
    for fname, extra in FILES:
        if extra is None:
            out[fname] = render(base, upper_clauses(pyproject, None))
        else:
            added = [
                e
                for e in parse_export(extra_texts[extra])
                if (normalise(e[0]), e[2]) not in base_keys
            ]
            out[fname] = render(added, upper_clauses(pyproject, extra))
    return out


def assemble(existing: str, generated: list[str]) -> str:
    head = existing.split(MARKER, 1)[0] if MARKER in existing else ""
    if not head:
        # First run on a hand-written file: keep its comment block, drop its requirement lines.
        head = "".join(
            ln for ln in existing.splitlines(keepends=True) if ln.startswith("#") or not ln.strip()
        )
    return head.rstrip("\n") + "\n\n" + MARKER + "\n" + "\n".join(generated) + "\n"


def self_test() -> int:
    pyproject = {
        "project": {
            "dependencies": [
                "qiskit>=2.5,<2.6",
                "numpy",
                "extra-thing[x]>=1 ; python_version>='3.12'",
            ],
            "optional-dependencies": {"notebooks": ["jupyterlab>=4.6.3", "shielded!=1.2.0"]},
        }
    }
    base = 'qiskit==2.5.3\nnumpy==2.3.1\nappnope==1.0.0 ; sys_platform  ==  "darwin"\n# a comment\n'
    nb = base + "jupyterlab==4.6.3\nanyio==4.14.2\nshielded==1.3.0\n"
    got = generate(base, {"notebooks": nb}, pyproject)
    bad = 0

    def expect(cond: bool, what: str) -> None:
        nonlocal bad
        print(f"  {'PASS' if cond else 'FAIL'}  {what}")
        bad += not cond

    b, n = got["requirements.txt"], got["requirements-notebooks.txt"]
    expect(
        "qiskit>=2.5.3,<2.6" in b, "an upper bound in pyproject.toml survives beside the lock floor"
    )
    expect("numpy>=2.3.1" in b, "a floor equals the locked version")
    expect(
        "appnope>=1.0.0 ; sys_platform == 'darwin'" in b,
        "a platform marker is kept, in one quote style and spacing",
    )
    expect("anyio>=4.14.2" in n, "an UNNAMED transitive dependency is named (the anyio case)")
    expect(
        not any(ln.startswith(("qiskit", "numpy")) for ln in n),
        "the notebooks file names only what the extra adds",
    )
    expect("shielded>=1.3.0,!=1.2.0" in n, "an exclusion clause is kept")
    for bad_req in ("pkg~=1.2", "pkg==1.2"):
        try:
            upper_clauses({"project": {"dependencies": [bad_req]}}, None)
            expect(False, f"{bad_req!r} is refused")
        except SystemExit:
            expect(True, f"{bad_req!r} is refused rather than guessed at")
    try:
        parse_export("this is not a requirement\n")
        expect(False, "an unreadable export line is refused")
    except SystemExit:
        expect(True, "an unreadable export line is refused")
    try:
        parse_export("# only comments\n")
        expect(False, "an empty export is refused")
    except SystemExit:
        expect(True, "an empty export is refused, never written as an empty file")
    doc = "# why\n# more why\nold>=1\n"
    first = assemble(doc, ["new>=2"])
    expect(
        first.startswith("# why\n# more why\n")
        and "old>=1" not in first
        and first.endswith("new>=2\n"),
        "first run keeps the prose and replaces the hand-written lines",
    )
    expect(
        assemble(first, ["newer>=3"]) == first.replace("new>=2", "newer>=3"),
        "re-running replaces only the generated block",
    )
    print("sync_pip_fallback: self-test " + ("ok" if not bad else f"FAILED ({bad})"))
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return self_test()
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text())
    extras = {extra: export(extra) for _, extra in FILES if extra}
    generated = generate(export(None), extras, pyproject)
    stale = []
    for fname, lines in generated.items():
        path = ROOT / fname
        current = path.read_text()
        wanted = assemble(current, lines)
        if current == wanted:
            continue
        if "--check" in argv:
            stale.append(fname)
        else:
            path.write_text(wanted)
            print(f"sync_pip_fallback: wrote {fname} ({len(lines)} packages)")
    if stale:
        print(
            f"sync_pip_fallback: STALE {', '.join(stale)} — the pip fallback no longer names what uv.lock "
            "resolves, so osv-scanner would read an older environment than the one `uv sync --locked` "
            "installs.\nFix: cd curricula/qiskit-study-group/static && uv run python scripts/sync_pip_fallback.py",
            file=sys.stderr,
        )
        return 1
    if "--check" in argv:
        print("sync_pip_fallback: both fallback files match uv.lock")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
