#!/usr/bin/env python3
"""CI gate: `ANSWER_KEY.md` says the same thing the quiz notebooks say.

`curricula/qiskit-study-group/certification/ANSWER_KEY.md` is what a reader self-scores
against — its README tells them to. It lists 57 answers as bare letters, and the same 57
answers live in the notebooks as `Correct answer: X)` lines and, since the quizzes were
keyed, as `answer={...,"correct":i}` on the question cell. Three copies of one fact.

The file opens by asserting they cannot diverge: *"this file and the notebooks are kept in
sync by construction, generated from one shared source of questions."* **No such generator
is in this repository, and nothing checked the claim.** It went from true to false the
moment the options were reordered to fix the answer-position bias, and the only reason it
was caught is that someone happened to `ls` the directory. A sentence asserting an
invariant is not the invariant.

So this compares all three, per question, and fails on any disagreement:

    ANSWER_KEY.md's letter  ==  the notebook's "Correct answer: X)"  ==  the answer key's index

Usage:
  python scripts/check_answer_key.py [ROOT]     # default: the certification directory
  python scripts/check_answer_key.py --self-test
"""

from __future__ import annotations

import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages/py/notebooks/src"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages/py/contracts/src"))

from leona_notebooks.source import parse_source  # noqa: E402

DEFAULT_ROOT = Path("curricula/qiskit-study-group/certification")
LETTERS = "ABCD"

_DOC_SECTION = re.compile(r"^## (\S+)\.ipynb", re.MULTILINE)
_DOC_ANSWER = re.compile(r"^(\d+)\.\s+\*\*([A-D])\*\*", re.MULTILINE)
_NB_ANSWER = re.compile(r"Correct answer:\s*([A-D])\)")


def doc_letters(markdown: str) -> dict[str, list[str]]:
    """`{notebook stem: [letter per question, in order]}` as the readable key states them."""
    out: dict[str, list[str]] = {}
    current: str | None = None
    for line in markdown.splitlines():
        section = _DOC_SECTION.match(line)
        if section:
            current = section.group(1)
            out[current] = []
            continue
        answer = _DOC_ANSWER.match(line)
        if answer and current is not None:
            out[current].append(answer.group(2))
    return out


def notebook_letters(source: str) -> tuple[list[str], list[str]]:
    """`(letters printed in the answer cells, letters implied by the answer keys)`.

    Two lists rather than one, because they are two independent records of the same fact
    and the point of this gate is that they are compared rather than assumed equal. A
    question with no `answer=` key contributes `-` to the second list, so a notebook that
    is only half keyed shows up as a length or content mismatch rather than silently
    lining up.
    """
    printed = _NB_ANSWER.findall(source)
    spec = parse_source(source)
    keyed = [
        LETTERS[cell.answer.correct]
        if cell.answer is not None and cell.answer.kind == "choice"
        else "-"
        for cell in spec.cells
        if cell.role is not None and cell.role.value == "question"
    ]
    return printed, keyed


def check(root: Path) -> list[str]:
    problems: list[str] = []
    key_path = root / "ANSWER_KEY.md"
    if not key_path.is_file():
        return [f"{key_path}: missing"]
    stated = doc_letters(key_path.read_text(encoding="utf-8"))
    if not stated:
        # An empty parse over a file that exists is the failure this whole family of
        # checkers keeps making: it reads as "nothing to disagree with".
        return [f"{key_path}: no answers parsed out of it — the gate cannot see the key"]
    for stem, letters in sorted(stated.items()):
        nb_path = root / f"{stem}.nb.py"
        if not nb_path.is_file():
            problems.append(f"{key_path}: names {stem}.ipynb, but {nb_path} does not exist")
            continue
        printed, keyed = notebook_letters(nb_path.read_text(encoding="utf-8"))
        if len(letters) != len(printed):
            problems.append(
                f"{stem}: ANSWER_KEY.md lists {len(letters)} answers, "
                f"the notebook prints {len(printed)}"
            )
            continue
        for i, (doc, nb) in enumerate(zip(letters, printed, strict=True), start=1):
            if doc != nb:
                problems.append(f"{stem} Q{i}: ANSWER_KEY.md says {doc}, the notebook says {nb}")
        if len(keyed) == len(printed):
            for i, (nb, key) in enumerate(zip(printed, keyed, strict=True), start=1):
                if key != "-" and key != nb:
                    problems.append(
                        f"{stem} Q{i}: the notebook prints {nb} but its answer key "
                        f"grades {key} as correct"
                    )
        else:
            problems.append(
                f"{stem}: {len(printed)} printed answers against {len(keyed)} question "
                "cells — they cannot be compared"
            )
    return problems


def _self_test() -> int:
    """Each disagreement must be caught, and agreement must survive. Built from a real
    two-question notebook rather than asserted, so the parsers are exercised too."""
    source = (
        "# ---\n# slug: q\n# title: Q\n# kind: quiz\n# ---\n\n"
        '# %% [markdown] role=question answer={"kind":"choice","options":["w","x"],"correct":0}\n'
        "# Q one?\n\n"
        "# %% role=answer\n"
        'print("Correct answer: A) w")\n\n'
        '# %% [markdown] role=question answer={"kind":"choice","options":["w","x"],"correct":1}\n'
        "# Q two?\n\n"
        "# %% role=answer\n"
        'print("Correct answer: B) x")\n'
    )
    good_doc = "## quiz.ipynb (2 questions)\n\n1. **A** — because.\n2. **B** — because.\n"
    failures: list[str] = []

    def run(doc: str, nb: str) -> list[str]:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "ANSWER_KEY.md").write_text(doc, encoding="utf-8")
            (root / "quiz.nb.py").write_text(nb, encoding="utf-8")
            return check(root)

    if run(good_doc, source):
        failures.append(f"an agreeing key was reported as a problem: {run(good_doc, source)}")
    if not any("ANSWER_KEY.md says" in p for p in run(good_doc.replace("**A**", "**C**"), source)):
        failures.append("a doc letter that disagrees with the notebook was NOT caught")
    # The arm that matters most, and the one the reorder would have tripped: the doc and
    # the printed line agree, and the machine-readable key grades something else.
    rekeyed = source.replace('"correct":0', '"correct":1', 1)
    if not any("grades" in p for p in run(good_doc, rekeyed)):
        failures.append("an answer key that grades a different option was NOT caught")
    if not any("lists 3 answers" in p for p in run(good_doc + "3. **A** — extra.\n", source)):
        failures.append("a key with more answers than the notebook was NOT caught")
    with tempfile.TemporaryDirectory() as tmp:
        if not check(Path(tmp)):
            failures.append("a missing ANSWER_KEY.md was NOT caught")

    if failures:
        print("check_answer_key self-test FAILED:")
        for line in failures:
            print(f"  {line}")
        return 1
    print(
        "check_answer_key self-test passed (agreement accepted; wrong letter, wrong key, "
        "wrong count and a missing file all caught)"
    )
    return 0


def main(argv: list[str]) -> int:
    if "--self-test" in argv:
        return _self_test()
    root = Path(next((a for a in argv if not a.startswith("-")), DEFAULT_ROOT))
    problems = check(root)
    if problems:
        print("ANSWER_KEY.md and the quiz notebooks disagree:")
        for line in problems:
            print(f"  {line}")
        return 1
    stated = doc_letters((root / "ANSWER_KEY.md").read_text(encoding="utf-8"))
    total = sum(len(v) for v in stated.values())
    print(
        f"check_answer_key: clean ({total} answers across {len(stated)} quiz(zes); "
        "the readable key, the printed line and the machine key all agree)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
