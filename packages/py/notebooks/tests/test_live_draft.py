"""`LiveDraftGuard` — the redaction a streaming draft/repair gets before a chunk ever
reaches the (workspace-scoped) run event stream. See `live_draft.py`'s module docstring
for why this exists; these tests are the proof that it actually withholds what it
claims to, under adversarial chunking (a provider can split a stream anywhere,
including mid `role=` token) and at end-of-stream.
"""

from __future__ import annotations

import random

import pytest

from leona_notebooks.live_draft import LiveDraftGuard

SAFE_LESSON = """\
# ---
# title: Quantum coin
# kind: lesson
# ---

# %% [markdown] role=objective
# ## What you will build

# %% role=run
from qiskit import QuantumCircuit
qc = QuantumCircuit(1)
qc.h(0)

# %% [markdown] role=summary
# You built a quantum coin.
"""

GRADED_QUIZ = """\
# ---
# title: Quiz
# kind: quiz
# ---

# %% [markdown] role=objective
# ## Answer the question

# %% role=question
# What gate makes a superposition?

# %% [markdown] role=question answer={"kind": "choice", "options": ["H", "X"], "correct": 0}
# Pick one.

# %% role=exercise stub="# your code here"
def double(x):
    ...

# %% role=solution check="assert double(3) == 6"
def double(x):
    return x * 2

# %% [markdown] role=answer
# The answer is the Hadamard gate, because it maps |0> to an equal superposition.

# %% [markdown] role=summary
# Nice work.
"""


def _feed_whole(guard: LiveDraftGuard, text: str) -> str:
    return guard.feed(text) + guard.flush()


def _feed_random_chunks(text: str, *, seed: int) -> str:
    """The adversarial case: a provider can hand back a fragment of any size,
    including one that splits `# %% role=sol` down the middle of `sol`."""
    rng = random.Random(seed)
    guard = LiveDraftGuard()
    out: list[str] = []
    i = 0
    while i < len(text):
        n = rng.randint(1, 5)
        out.append(guard.feed(text[i : i + n]))
        i += n
    out.append(guard.flush())
    return "".join(out)


def test_a_notebook_with_no_graded_or_solution_cells_passes_through_whole() -> None:
    guard = LiveDraftGuard()
    assert _feed_whole(guard, SAFE_LESSON) == SAFE_LESSON


@pytest.mark.parametrize("seed", range(8))
def test_safe_text_survives_arbitrary_chunking(seed: int) -> None:
    assert _feed_random_chunks(SAFE_LESSON, seed=seed) == SAFE_LESSON


@pytest.mark.parametrize("seed", range(8))
def test_a_quiz_answer_key_never_appears_in_the_released_text(seed: int) -> None:
    out = _feed_random_chunks(GRADED_QUIZ, seed=seed)
    # The three things a reader must never see live: the hidden grader's assertion,
    # the structured answer key, and the unredacted solution body.
    assert "assert double(3) == 6" not in out
    assert '"correct": 0' not in out
    assert "return x * 2" not in out
    # The prose answer cell (role=answer) is withheld outright — its secret has no
    # field to redact, only the cell itself.
    assert "Hadamard gate" not in out
    # What IS safe still gets through: the objective, the question prompt, the stub.
    assert "## Answer the question" in out
    assert "What gate makes a superposition?" in out
    assert "your code here" in out
    assert "Nice work." in out


def test_a_role_solution_markdown_cell_is_withheld_header_and_all() -> None:
    text = (
        "# %% role=run\nprint(1)\n\n"
        "# %% [markdown] role=solution\n# the answer is 42\n\n"
        "# %% role=run\nprint(2)\n"
    )
    guard = LiveDraftGuard()
    out = _feed_whole(guard, text)
    assert "42" not in out
    assert "role=solution" not in out
    assert "print(1)" in out and "print(2)" in out


def test_a_check_attribute_withholds_the_cell_even_without_role_solution() -> None:
    # `check=` can land on any code cell, not only `role=solution` ones (a repair can
    # fix a graded `role=exercise` cell's hidden grader).
    text = '# %% role=exercise check="assert x == 1"\nx = 1\n'
    guard = LiveDraftGuard()
    out = _feed_whole(guard, text)
    assert out == ""


def test_an_answer_attribute_withholds_the_cell() -> None:
    text = '# %% [markdown] role=question answer={"kind": "numeric", "value": 7}\n# How many?\n'
    guard = LiveDraftGuard()
    out = _feed_whole(guard, text)
    assert out == ""


def test_flush_drops_an_unterminated_header_rather_than_guessing() -> None:
    # The stream ends one character before `role=solution` would have been complete;
    # nothing proves this cell safe, so nothing is released.
    guard = LiveDraftGuard()
    out = guard.feed("# %% role=run\nprint(1)\n\n# %% role=sol")
    out += guard.flush()
    assert out == "# %% role=run\nprint(1)\n\n"
    assert "role=sol" not in out


def test_flush_releases_a_safe_cells_unterminated_trailing_body() -> None:
    # No trailing newline at all (the stream just stopped): a cell already proven
    # safe by its header is still safe mid-body.
    guard = LiveDraftGuard()
    out = guard.feed("# %% role=run\nprint(1)")
    out += guard.flush()
    assert out == "# %% role=run\nprint(1)"


def test_flush_drops_a_sensitive_cells_unterminated_trailing_body() -> None:
    guard = LiveDraftGuard()
    out = guard.feed('# %% role=solution check="assert True"\nx = 1')
    out += guard.flush()
    assert out == ""


def test_preamble_before_the_first_cell_marker_is_always_safe() -> None:
    text = "# ---\n# title: X\n# kind: lesson\n# ---\n\n"
    guard = LiveDraftGuard()
    assert _feed_whole(guard, text) == text


def test_empty_feed_is_a_no_op() -> None:
    guard = LiveDraftGuard()
    assert guard.feed("") == ""
    assert guard.feed("# %% role=run\nprint(1)\n") == "# %% role=run\nprint(1)\n"
