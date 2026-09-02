#!/usr/bin/env python3
"""Check a BUILT Qiskit study group against the promises in the collaborator's brief.

`leona-notebooks validate` checks that the sources are well formed and run.
This checks the thing the collaborator actually receives: that every promise their
README makes is met by the tree, and — the one that matters most — that a challenge
notebook is genuinely answer-free rather than merely labelled that way.

    python curricula/qiskit-study-group/check_build.py ~/Developer/qiskit-study-group
    python curricula/qiskit-study-group/check_build.py <dir> --self-test

Exit status is 1 on any failure, so it can run bare in a build step.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

WEEKS = [
    "week00_setup",
    "week01_qubits_circuits",
    "week02_entanglement",
    "week03_quantum_gates",
    "week04_transpilation",
    "week05_primitives",
    "week06_grover",
    "week07_variational",
    "week08_project",
]

#: Named in the brief's "Repository map" and "Quick start" sections.
REQUIRED_PATHS = [
    "solutions",
    "certification",
    "certification/ANSWER_KEY.md",
    "bonus_ibm_quantum_hardware",
    "bonus_ibm_quantum_hardware/guide.ipynb",
    "shared",
    "scripts",
    "scripts/validate_notebooks.py",
    "tests",
    ".python-version",
    "uv.lock",
    "pyproject.toml",
    "requirements.txt",
    "INSTRUCTOR_GUIDE.md",
    "VISUALIZATION_GUIDE.md",
    "CONTRIBUTING.md",
    "LICENSE",
    "README.md",
]

#: Removed in Qiskit 2.x. The brief promises modern V2 APIs, so any of these in a
#: shipped cell is a defect even inside prose a reader might copy.
REMOVED_APIS = [
    r"\bqiskit\.execute\b",
    r"\bfrom qiskit import execute\b",
    r"\bBasicAer\b",
    r"from qiskit import [^\n]*\bAer\b",
    r"\.qasm\(\)",
    r"\bbind_parameters\b",
    r"\bqiskit\.opflow\b",
    r"\bqiskit\.algorithms\b",
    r"from qiskit\.primitives import (Sampler|Estimator)\b",
]

#: Files that describe how the curriculum is authored, not part of it.
SOURCE_ONLY = {"AUTHORING.md", "BRIEF-from-quanmatic.md"}


def _cells(path: Path) -> list[tuple[str, str | None]]:
    document = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for cell in document["cells"]:
        source = cell["source"]
        text = "".join(source) if isinstance(source, list) else source
        out.append((text, (cell.get("metadata", {}).get("leona") or {}).get("role")))
    return out


def _notebooks(root: Path) -> list[Path]:
    return [p for p in sorted(root.rglob("*.ipynb")) if ".venv" not in p.parts]


def check(root: Path) -> list[str]:
    fail: list[str] = []

    for week in WEEKS:
        directory = root / week
        if not (directory / "README.md").exists():
            fail.append(f"{week}: no README.md — the brief promises a concise guide per week")
        if week == "week08_project":
            continue
        for name in ("lab.ipynb", "challenge.ipynb"):
            if not (directory / name).exists():
                fail.append(f"{week}: no {name}")
        solutions = root / "solutions" / week
        if not (solutions / "challenge_solution.ipynb").exists():
            fail.append(f"{week}: no reference solution under solutions/")
        if not (solutions / "SELF_EVALUATION.md").exists():
            fail.append(f"{week}: no self-evaluation checklist under solutions/")

    templates = sorted(p.stem for p in (root / "week08_project" / "templates").glob("*.ipynb"))
    references = sorted(p.stem for p in (root / "week08_project" / "reference").glob("*.ipynb"))
    if templates != references:
        fail.append(
            "week08: the brief promises a complete reference project for every template; "
            f"templates={templates} references={references}"
        )

    for relative in REQUIRED_PATHS:
        if not (root / relative).exists():
            fail.append(f"repository map: missing {relative}")

    for name in SOURCE_ONLY:
        if (root / name).exists():
            fail.append(f"authoring metadata shipped to the reader: {name}")

    # The core promise: an "answer-free challenge.ipynb".
    answer_bearing = {"solution", "answer"}
    challenges = [p for p in _notebooks(root) if p.name in {"challenge.ipynb"}]
    challenges += [
        root / "certification/practice_questions.ipynb",
        root / "certification/mock_exam.ipynb",
    ]
    for challenge in challenges:
        if not challenge.exists():
            continue
        cells = _cells(challenge)
        leaked_roles = sorted({role for _, role in cells if role in answer_bearing})
        if leaked_roles:
            fail.append(f"{challenge.relative_to(root)}: answer-bearing cells survived: {leaked_roles}")
        solution = root / "solutions" / challenge.parent.name / f"{challenge.stem}_solution.ipynb"
        if solution.exists():
            answers = {text for text, role in _cells(solution) if role in answer_bearing}
            shown = {text for text, _ in cells}
            leaked = sorted(text[:60] for text in answers & shown)
            if leaked:
                fail.append(f"{challenge.relative_to(root)}: solution text appears verbatim: {leaked}")

    for notebook in _notebooks(root):
        cells = _cells(notebook)
        document = json.loads(notebook.read_text(encoding="utf-8"))
        if any(cell.get("outputs") for cell in document["cells"]):
            fail.append(f"{notebook.relative_to(root)}: ships with stored outputs")
        text = "\n".join(source for source, _ in cells)
        for pattern in REMOVED_APIS:
            if re.search(pattern, text):
                fail.append(f"{notebook.relative_to(root)}: removed Qiskit API {pattern}")
        for source, _ in cells:
            if re.search(r"/Users/|/home/[a-z]", source):
                fail.append(f"{notebook.relative_to(root)}: an absolute path in a cell")
            if re.search(r"(token|api_key)\s*=\s*[\"'][A-Za-z0-9_-]{12,}[\"']", source):
                fail.append(f"{notebook.relative_to(root)}: a literal credential in a cell")

    return fail


def self_test(root: Path) -> int:
    """Prove each family of check can fail, by mutating a copy of the built tree.

    A check nobody has seen go red is a claim, not a check — every rule below is
    exercised against a deliberately broken copy before the real run is believed.
    """
    import shutil
    import tempfile

    scenarios: list[tuple[str, callable]] = []

    def scenario(name):
        def register(fn):
            scenarios.append((name, fn))
            return fn

        return register

    @scenario("a missing weekly guide")
    def _(tree: Path) -> None:
        (tree / "week01_qubits_circuits" / "README.md").unlink()

    @scenario("a missing reference solution")
    def _(tree: Path) -> None:
        (tree / "solutions" / "week02_entanglement" / "challenge_solution.ipynb").unlink()

    @scenario("a template with no reference project")
    def _(tree: Path) -> None:
        next((tree / "week08_project" / "reference").glob("*.ipynb")).unlink()

    @scenario("a missing repository-map entry")
    def _(tree: Path) -> None:
        (tree / "scripts" / "validate_notebooks.py").unlink()

    @scenario("authoring metadata shipped to the reader")
    def _(tree: Path) -> None:
        (tree / "AUTHORING.md").write_text("internal\n", encoding="utf-8")

    @scenario("a solution cell left in a challenge")
    def _(tree: Path) -> None:
        path = tree / "week01_qubits_circuits" / "challenge.ipynb"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["cells"][0]["metadata"].setdefault("leona", {})["role"] = "solution"
        path.write_text(json.dumps(document), encoding="utf-8")

    @scenario("a notebook shipping stored outputs")
    def _(tree: Path) -> None:
        path = tree / "week03_quantum_gates" / "lab.ipynb"
        document = json.loads(path.read_text(encoding="utf-8"))
        for cell in document["cells"]:
            if cell["cell_type"] == "code":
                cell["outputs"] = [{"output_type": "stream", "name": "stdout", "text": "x"}]
                break
        path.write_text(json.dumps(document), encoding="utf-8")

    @scenario("a removed Qiskit API in a cell")
    def _(tree: Path) -> None:
        path = tree / "week05_primitives" / "lab.ipynb"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["cells"][0]["source"] = "from qiskit import execute\n"
        path.write_text(json.dumps(document), encoding="utf-8")

    @scenario("a credential in a cell")
    def _(tree: Path) -> None:
        path = tree / "week06_grover" / "lab.ipynb"
        document = json.loads(path.read_text(encoding="utf-8"))
        document["cells"][0]["source"] = 'token = "abcdef0123456789abcdef"\n'
        path.write_text(json.dumps(document), encoding="utf-8")

    unbroken = check(root)
    if unbroken:
        print("SELF-TEST INVALID: the tree already fails, so a mutation proves nothing:")
        print("\n".join(f"  - {line}" for line in unbroken))
        return 1

    failures = 0
    for name, mutate in scenarios:
        with tempfile.TemporaryDirectory() as tmp:
            tree = Path(tmp) / "tree"
            shutil.copytree(root, tree, ignore=shutil.ignore_patterns(".venv", ".git"))
            mutate(tree)
            caught = check(tree)
            status = "caught" if caught else "MISSED"
            if not caught:
                failures += 1
            print(f"  {status}: {name}")
    print(
        f"self-test: {len(scenarios) - failures} of {len(scenarios)} mutations caught"
        + ("" if not failures else " — a rule below is unenforced")
    )
    return 1 if failures else 0


def main(argv: list[str]) -> int:
    if not argv:
        print(__doc__)
        return 1
    root = Path(argv[0]).expanduser()
    if not root.is_dir():
        print(f"not a directory: {root}", file=sys.stderr)
        return 1
    if "--self-test" in argv:
        return self_test(root)
    fail = check(root)
    if fail:
        print(f"{len(fail)} promise(s) in the brief are not met by {root}:")
        print("\n".join(f"  - {line}" for line in fail))
        return 1
    notebooks = len(_notebooks(root))
    print(f"every promise in the brief is met by {root} ({notebooks} notebooks)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
