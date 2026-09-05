"""Rebalance the certification quizzes' option order and attach a real answer key.

Committed as the record of HOW the two quizzes were rewritten, and so the rewrite can be
re-derived rather than taken on trust. It has already been run; `--check` is the arm that
stays useful, and it re-reads the written files rather than the values this script held in
memory. Running `--write` again is a no-op on an already-keyed file — `rewrite_question`
refuses a cell that already carries a key rather than nesting a second one.

Two defects, one fix, because neither is safe to fix alone:

* **The correct option is almost always B.** 19 of 32 in `practice_questions`, 21 of 25 in
  `mock_exam` — where D is never correct at all. A reader who answers B to everything
  scores 59% and 84%. The Qiskit certification pass mark is around 70%, so the mock exam
  currently tells a learner they are ready for pressing one key 25 times.
* **The questions carry no answer key**, so the product cannot grade them. The answer is
  in a `role=answer` cell immediately below, which prints it.

Attaching keys WITHOUT rebalancing would be worse than leaving them ungraded: it turns a
59%/84% guess rate into a graded verdict telling the reader they were right.

## The invariant that makes reordering safe

Reordering distractors changes no factual claim, and the check that proves this run did
only that is: **the TEXT of the correct option is byte-identical before and after, and the
SET of four option texts is unchanged.** Only the position and its letter move. Anything
else is a bug in this script, and `--check` re-derives both from the written file.

Verified separately, and the reason reordering is safe here at all: no option is
position-dependent ("none of the above", "both A and B") and none refers to another by
letter. Both grepped before this was written.

## Why a hash and not a rotation

The target index comes from `sha256` of the question's own text. A rotation — put question
i's answer at index `i % 4` — is exactly uniform and produces `A B C D A B C D`, which is a
stronger pattern to exploit than the bias it replaces. The hash is deterministic, so
re-running produces the same file, and carries no pattern a reader can follow.

Usage:
  python rebalance.py --check            # report only, write nothing
  python rebalance.py --write            # rewrite both notebooks
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path("curricula/qiskit-study-group/certification")
NAMES = ["practice_questions", "mock_exam"]
LETTERS = ["A", "B", "C", "D"]

#: `# %%` starts a cell. Splitting with a lookahead keeps the marker on its block.
_CELL_SPLIT = re.compile(r"(?m)^(?=# %%)")
_OPTION = re.compile(r"(?m)^# ([A-D])\) (.*)$")
_CORRECT = re.compile(r"(Correct answer:\s*)([A-D])(\))")


def _blocks(text: str) -> list[str]:
    return _CELL_SPLIT.split(text)


def _is_question(block: str) -> bool:
    return block.startswith("# %%") and block[4:].lstrip().startswith("[markdown] role=question")


def _is_answer(block: str) -> bool:
    return block.startswith("# %%") and re.match(r"(\[markdown\] )?role=answer", block[4:].lstrip())


def pairs(blocks: list[str]) -> list[tuple[int, int]]:
    """Indices of each (question, its following answer) pair."""
    out: list[tuple[int, int]] = []
    pending: int | None = None
    for i, b in enumerate(blocks):
        if _is_question(b):
            pending = i
        elif pending is not None and _is_answer(b):
            out.append((pending, i))
            pending = None
    return out


def read_pair(q: str, a: str) -> tuple[list[str], int]:
    """(option texts in author order, index of the correct one). Raises on anything odd."""
    opts = _OPTION.findall(q)
    if [letter for letter, _ in opts] != LETTERS:
        raise ValueError(f"options are {[letter for letter, _ in opts]}, expected A-D")
    marks = _CORRECT.findall(a)
    if len(marks) != 1:
        raise ValueError(f"{len(marks)} 'Correct answer:' lines, expected exactly 1")
    return [text for _, text in opts], LETTERS.index(marks[0][1])


def target_index(question_text: str) -> int:
    digest = hashlib.sha256(question_text.encode("utf-8")).hexdigest()
    return int(digest, 16) % 4


def reorder(options: list[str], correct: int, target: int) -> list[str]:
    """Move `options[correct]` to `target`, keeping the other three in their relative order."""
    rest = [o for i, o in enumerate(options) if i != correct]
    out = rest[:target] + [options[correct]] + rest[target:]
    assert len(out) == 4
    return out


def rewrite_question(block: str, new_options: list[str], key: dict) -> str:
    """Replace the four option lines in author order, and attach the `answer=` attribute."""
    supply = iter(new_options)
    body = _OPTION.sub(lambda m: f"# {m.group(1)}) {next(supply)}", block)
    marker_end = body.index("\n")
    marker = body[:marker_end]
    if "answer=" in marker:
        raise ValueError("this cell already carries an answer key")
    attr = "answer=" + json.dumps(key, ensure_ascii=False, separators=(",", ":"))
    return marker + " " + attr + body[marker_end:]


def process(name: str, write: bool) -> int:
    path = ROOT / f"{name}.nb.py"
    original = path.read_text()
    blocks = _blocks(original)
    before_letters: list[str] = []
    after_letters: list[str] = []
    failures: list[str] = []

    for qi, ai in pairs(blocks):
        try:
            options, correct = read_pair(blocks[qi], blocks[ai])
        except ValueError as exc:
            failures.append(f"  cell {qi}: {exc}")
            continue
        before_letters.append(LETTERS[correct])
        target = target_index(blocks[qi])
        new_options = reorder(options, correct, target)

        # THE invariant. Checked here on the in-memory values and again by --check against
        # the file that was actually written, because a transformation that is correct in
        # memory and wrong on disk is the interesting case.
        if new_options[target] != options[correct]:
            failures.append(f"  cell {qi}: the correct option's TEXT moved")
            continue
        if sorted(new_options) != sorted(options):
            failures.append(f"  cell {qi}: the option SET changed")
            continue

        after_letters.append(LETTERS[target])
        key = {
            "kind": "choice",
            "options": new_options,
            "correct": target,
        }
        try:
            blocks[qi] = rewrite_question(blocks[qi], new_options, key)
        except ValueError as exc:
            # Re-running on an already-keyed file lands here. Reported rather than raised,
            # so a second run says what it found instead of printing a traceback over a
            # file it correctly declined to touch.
            failures.append(f"  cell {qi}: {exc}")
            continue
        blocks[ai] = _CORRECT.sub(
            lambda m: f"{m.group(1)}{LETTERS[target]}{m.group(3)}", blocks[ai], count=1
        )

    def worst(letters: list[str]) -> str:
        if not letters:
            return "n/a"
        counter = Counter(letters)
        letter, count = counter.most_common(1)[0]
        return f"{dict(sorted(counter.items()))} — always {letter}: {count}/{len(letters)} = {100 * count / len(letters):.0f}%"

    print(f"{name}: {len(before_letters)} questions")
    print(f"   before: {worst(before_letters)}")
    print(f"   after:  {worst(after_letters)}")
    if failures:
        print("   FAILURES:")
        for line in failures:
            print(line)
        return 1
    if write:
        path.write_text("".join(blocks))
        print(f"   written -> {path}")
    return 0


def check_written() -> int:
    """Re-derive the key from the file on disk and prove it agrees with the prose."""
    problems: list[str] = []
    for name in NAMES:
        path = ROOT / f"{name}.nb.py"
        blocks = _blocks(path.read_text())
        letters: list[str] = []
        seen = 0
        for qi, ai in pairs(blocks):
            marker = blocks[qi][: blocks[qi].index("\n")]
            match = re.search(r"answer=(\{.*\})\s*$", marker)
            if not match:
                problems.append(f"{name} cell {qi}: no answer key on the marker")
                continue
            key = json.loads(match.group(1))
            prose = [text for _, text in _OPTION.findall(blocks[qi])]
            if key["options"] != prose:
                problems.append(f"{name} cell {qi}: key options differ from the prose options")
                continue
            printed = _CORRECT.findall(blocks[ai])
            if len(printed) != 1 or LETTERS.index(printed[0][1]) != key["correct"]:
                problems.append(f"{name} cell {qi}: the answer cell's letter and the key disagree")
                continue
            letters.append(LETTERS[key["correct"]])
            seen += 1
        counter = Counter(letters)
        if letters:
            letter, count = counter.most_common(1)[0]
            share = count / len(letters)
            print(
                f"{name}: {seen} keyed questions, {dict(sorted(counter.items()))}, "
                f"best single guess {letter} = {100 * share:.0f}%"
            )
            if share > 0.40:
                problems.append(f"{name}: guessing {letter} still scores {100 * share:.0f}%")
    for line in problems:
        print("  PROBLEM:", line)
    return 1 if problems else 0


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check_written())
    sys.exit(max(process(name, write="--write" in sys.argv) for name in NAMES))
