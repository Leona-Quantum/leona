"""Notebook contracts — the lesson a reader asked Nala for, as a versioned resource.

Three layers, all here because all three cross the API boundary and the TS client
renders them:

1. The notebook itself: `NotebookSpec` and its `Cell`s (with a pedagogical *role*).
2. What a run of it produced: `ExecutionReport` and its per-cell `CellResult`s.
3. The resources and requests of `/v1/notebooks`: `Notebook`, `NotebookVersion`,
   `NotebookTurn`, and the create/turn/import bodies.

`leona_notebooks` (packages/py/notebooks) owns every operation on these — parsing the
`.nb.py` authoring form, compiling `.ipynb`, composing the sandbox program, applying a
revision — and re-exports the types from here so there is one definition.
"""

from __future__ import annotations

import builtins
import math
import re
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from .enums import Visibility

NOTEBOOK_SCHEMA_VERSION = 1

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_CELL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --------------------------------------------------------------------------- the notebook


class NotebookKind(StrEnum):
    """What shape a notebook takes. Each kind is a checkable structure contract."""

    LESSON = "lesson"
    LAB = "lab"
    CHALLENGE = "challenge"
    SOLUTION = "solution"
    WALKTHROUGH = "walkthrough"
    DEMO = "demo"
    QUIZ = "quiz"
    HARDWARE = "hardware"
    BENCHMARK = "benchmark"
    PROJECT = "project"
    SCRATCH = "scratch"


class CellRole(StrEnum):
    SETUP = "setup"
    OBJECTIVE = "objective"
    CONCEPT = "concept"
    PREDICT = "predict"
    RUN = "run"
    OBSERVE = "observe"
    EXPLAIN = "explain"
    MODIFY = "modify"
    CHECKPOINT = "checkpoint"
    FIGURE = "figure"
    EXERCISE = "exercise"
    HINT = "hint"
    SOLUTION = "solution"
    QUESTION = "question"
    ANSWER = "answer"
    SUMMARY = "summary"
    REFERENCES = "references"
    NOTE = "note"
    #: A structured property of an earlier result (`Cell.property`), judged by trusted
    #: code on the worker, never by the cell's own source. Not the same thing as
    #: `Cell.check`, the hidden grader of an exercise — see `CheckProperty`.
    CHECK = "check"
    #: An Atlas method placed in the notebook (`Cell.block`), whose cost the page works
    #: out from the planner's inputs at any problem size, beside the notebook's own
    #: checks as evidence up to the size they ran at. A markdown cell whose `source` is
    #: only prose rendered from the `BlockRef` — see that model.
    BLOCK = "block"


#: Roles whose whole content is the thing a learner must not see before they try.
#: A `solution` code cell is redacted by swapping in its stub; an `answer` cell has no
#: such half — its secret is its own prose — so it is removed outright.
#:
#: Defined here rather than in `leona_notebooks.spec` (which re-exports it) because BOTH
#: redactions have to read one list. They did not: `NotebookSpec.for_learner()`, on the
#: browser path, did not know this set existed, while the `.ipynb` compiler's challenge
#: build did — so the same notebook was redacted two different ways depending on which
#: door it left by, and the workspace door left `role=answer` in place.
SOLUTION_ONLY_ROLES: frozenset[CellRole] = frozenset({CellRole.SOLUTION, CellRole.ANSWER})


class Audience(_Model):
    level: Literal["newcomer", "engineer", "student", "researcher"] = "engineer"
    assumes: list[str] = Field(default_factory=list)
    not_assumed: list[str] = Field(default_factory=list)


class Style(_Model):
    analogies: bool = True
    analogy_domains: list[str] = Field(default_factory=list)
    tone: Literal["plain", "friendly", "formal"] = "plain"
    math_level: Literal["none", "minimal", "full"] = "minimal"
    visualizations: bool = True
    code_comments: Literal["light", "heavy"] = "light"
    language: Literal["en", "ja"] = "en"


class NotebookFramework(_Model):
    name: Literal["qiskit", "pennylane", "cirq", "braket", "cudaq"] = "qiskit"
    version: str = ">=2.5,<2.6"
    execution: Literal["local-statevector", "aer", "ibm-runtime"] = "local-statevector"


class Reference(_Model):
    title: str
    authors: str = ""
    year: int | None = None
    url: str = ""
    note: str = ""


class Seed(_Model):
    """Where content came from — provenance a reader can follow.

    `content` is only meaningful for `kind="circuit"`: the reader's own pasted
    Qiskit Python or OpenQASM 3 text, validated and described by
    `leona_notebooks.circuits` before it reaches a prompt. `kind="notebook"`
    (`ref=<notebook id>`) is another notebook in the same workspace, resolved to
    its current version by the worker's `_seed_material_for` — the
    quiz-from-notebook flow."""

    kind: Literal[
        "atlas-record", "paper", "artifact", "upload", "brief", "curriculum", "circuit", "notebook"
    ]
    ref: str = ""
    note: str = ""
    content: str = Field(default="", max_length=20_000)


class AnswerPrompt(_Model):
    """What a reader is shown of a question — everything the key holds EXCEPT the answer.

    Grading is server-side for exactly this reason. If the correct option travelled
    to the browser so the page could mark its own quiz, the quiz would be an honour
    system with a scoreboard: anyone can read the payload. So `for_learner()` drops
    `Cell.answer` entirely and leaves this in its place, and
    `NotebookSpec.leaks_answer_key()` is the assertion that it did.
    """

    kind: Literal["choice", "numeric", "text", "rubric"]
    #: `choice` only — the options in author order, with no marker on the right one.
    options: list[str] = Field(default_factory=list)
    #: `numeric` only — shown beside the input so the reader knows what to answer in.
    unit: str = ""


class ChoiceAnswer(_Model):
    """One right option among several. `correct` indexes `options`."""

    kind: Literal["choice"] = "choice"
    options: list[str] = Field(min_length=2, max_length=8)
    correct: int = Field(ge=0)
    explanation: str = ""

    @model_validator(mode="after")
    def _correct_in_range(self) -> ChoiceAnswer:
        if self.correct >= len(self.options):
            raise ValueError(f"correct index {self.correct} is outside {len(self.options)} options")
        return self


class NumericAnswer(_Model):
    """A number, compared with an ABSOLUTE tolerance.

    `tolerance` defaults to 0.0, which means exact equality — deliberate, so an
    author who omits it gets a grader that is strict rather than one that is
    silently generous. A physical answer almost always wants a tolerance set.
    """

    kind: Literal["numeric"] = "numeric"
    value: float
    tolerance: float = Field(default=0.0, ge=0.0)
    unit: str = ""
    explanation: str = ""


class TextAnswer(_Model):
    """Accepts any of `accept`, compared case-insensitively on collapsed whitespace.

    This is for answers with a small closed set of right spellings ("Hadamard",
    "the Hadamard gate"). Anything open-ended belongs in `RubricAnswer`, which is
    graded by the model — putting it here would silently mark a correct answer
    wrong for being phrased differently.
    """

    kind: Literal["text"] = "text"
    accept: list[str] = Field(min_length=1, max_length=16)
    explanation: str = ""


class RubricAnswer(_Model):
    """Open-ended: graded by the model against `rubric`, never deterministically.

    The rubric is what the grader is told to look for, so it must be specific
    enough that two readers agree on the verdict. Carried separately from the
    other three so that a grade's provenance is legible: anything graded here
    reports `graded_by="model"` and is reproducible only to the extent the model is.
    """

    kind: Literal["rubric"] = "rubric"
    rubric: str = Field(min_length=1)
    explanation: str = ""


AnswerKey = Annotated[
    ChoiceAnswer | NumericAnswer | TextAnswer | RubricAnswer, Field(discriminator="kind")
]


# --------------------------------------------------------------------------- check cells

CheckKind = Literal["state", "unitary", "distribution", "energy", "value"]
#: Who wrote a check. `source` means it was transcribed from somewhere outside the model
#: (a paper, an Atlas record) and so needs a `citation`. The default is the LEAST trusted
#: label on purpose: a property that arrives without an author never gains trust by the
#: omission. `leona_notebooks.checks.enforce_check_authorship` is what actually sets it.
CheckAuthor = Literal["nala", "user", "source"]
CheckStatus = Literal["pass", "fail", "inconclusive"]

#: Library references a `state` check may name. Built by trusted worker code
#: (`leona_notebooks.checks`), never written by the model or the reader. The widths stop
#: at `CHECK_STATE_MAX_QUBITS`.
CHECK_STATE_REFERENCE_RE = re.compile(
    r"^(?:bell(?::(?:phi|psi)[+-])?|(?:ghz|w|uniform)\((?:[1-9]|1[0-8])\))$"
)
#: Library references a `unitary` check may name, up to `CHECK_UNITARY_MAX_QUBITS`.
CHECK_UNITARY_REFERENCE_RE = re.compile(r"^i?qft\([1-8]\)$")
#: The widest circuit a check of each kind judges, sized so one check fits in the judging
#: process's 64 MiB of headroom (`leona_notebooks.checks.CHECK_MEMORY_HEADROOM_BYTES`). The
#: worker is a 512 MiB container whose own process peaks near 292 MiB (Cloud Monitoring,
#: `run.googleapis.com/container/memory/utilizations`, hourly p99 over 3 days to
#: 2026-09-25: max 57.0%, median 54%, read by the coordinator), and the judge's footprint
#: is about 120 MiB, so about 100 MiB is left for a check. Peaks above the footprint, one
#: child per check, M1 Pro: a 9-qubit unitary check measured +43 to +63 MiB and was once
#: killed over 64, so unitary stops at 8 (measured +5 to +36 MiB, 32 broken copies
#: included); a 10-qubit energy check with 256 terms measured +48 to +50 MiB, so energy
#: stays at 10. Fitted from traced
#: allocations at 6 to 10 qubits (ESTIMATES): a failing state check costs about 156 bytes
#: per amplitude (18 qubits about 39 MiB, 19 about 78), and a failing distribution check
#: about 2.6 KB per measured outcome (14 qubits about 41 MiB, 15 about 82). A 1 GiB worker
#: would allow 19 / 15 / 10. Restated here because this package imports nothing internal;
#: `leona_notebooks.checks` reads these.
CHECK_STATE_MAX_QUBITS = 18
CHECK_DISTRIBUTION_MAX_QUBITS = 14
CHECK_UNITARY_MAX_QUBITS = 8
#: The names an amplitude or probability expression may use. The evaluator
#: (`leona_notebooks.checks.evaluate_expression`) walks an `ast` against this allowlist and
#: never calls `eval`; the validator below walks the same allowlist without evaluating, so a
#: property that would be refused at run time is refused when it is written instead.
CHECK_EXPRESSION_CONSTANTS: frozenset[str] = frozenset({"i", "j", "pi", "e"})
CHECK_EXPRESSION_FUNCTIONS: frozenset[str] = frozenset({"sqrt", "exp", "cos", "sin"})
MAX_CHECK_EXPRESSION_CHARS = 200
#: The widest Pauli string an `energy` check may carry: `EXACT_DIAG_MAX_QUBITS` in
#: `majorana_verification.hamiltonian`, restated.
MAX_CHECK_HAMILTONIAN_QUBITS = 10
MAX_CHECK_HAMILTONIAN_TERMS = 256
MAX_CHECK_BASIS_ENTRIES = 4096
MAX_CHECK_VALUE_ENTRIES = 4096
MAX_CHECK_REFERENCE_QASM_CHARS = 20_000
#: How much of the subject's OpenQASM a verdict carries back to the page. A longer
#: subject is still judged; the verdict simply does not repeat it.
MAX_CHECK_VERDICT_QASM_CHARS = 8_000

#: The tolerance a property gets when it names none, per kind. What each one bounds:
#: `state` — 1 - fidelity; `unitary` — the largest entry of the difference of the two
#: unitaries after removing global phase; `distribution` — total variation distance;
#: `energy` and `value` — absolute difference. `energy` is looser than the rest because a
#: variational optimum is rarely within 1e-6 of the exact ground energy; 1e-3 is about
#: chemical accuracy in hartree. A check that needs something else sets it.
CHECK_DEFAULT_TOLERANCE: dict[str, float] = {
    "state": 1e-6,
    "unitary": 1e-6,
    "distribution": 1e-6,
    "energy": 1e-3,
    "value": 1e-6,
}
#: Upper bounds that keep a tolerance from making the check impossible to fail: a
#: fidelity is at most 1, a total variation distance at most 1, and the entries of the
#: difference of two unitaries at most 2.
_CHECK_TOLERANCE_CEILING: dict[str, float] = {"state": 1.0, "distribution": 1.0, "unitary": 2.0}

#: Which expectation fields each kind takes. Exactly one of the first set for state and
#: unitary; all of the listed fields for the other three.
_CHECK_EXPECTATION_FIELDS = (
    "amplitudes",
    "probabilities",
    "reference",
    "reference_qasm",
    "hamiltonian",
    "target",
    "value",
)
_CHECK_ONE_OF: dict[str, tuple[str, ...]] = {
    "state": ("amplitudes", "reference", "reference_qasm"),
    "unitary": ("reference", "reference_qasm"),
}
_CHECK_ALL_OF: dict[str, tuple[str, ...]] = {
    "distribution": ("probabilities",),
    "energy": ("hamiltonian", "target"),
    "value": ("value",),
}

_BITSTRING_RE = re.compile(r"^[01]+$")
_QASM_COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
_QASM_QUBIT_ARRAY = re.compile(r"\bqubit\s*\[\s*(\d+)\s*\]")
_QASM_QUBIT_SINGLE = re.compile(r"\bqubit\s+[^\W\d]\w*\s*;")
_QASM_QREG = re.compile(r"\bqreg\s+[^\W\d]\w*\s*\[\s*(\d+)\s*\]")
_QASM_PHYSICAL = re.compile(r"\$(\d+)\b")


def declared_qubits(qasm: str) -> int:
    """How many qubits an OpenQASM program declares, read from its text without parsing it.

    Registers (`qubit[n] q;`, `qubit q;`, `qreg q[n];`) plus physical qubits (`$k`, which
    Qiskit's importer turns into a circuit `k + 1` qubits wide). An upper bound for the
    shapes Qiskit writes, used to refuse a too-wide reference BEFORE anything is built;
    `leona_notebooks.checks` measures the parsed program again before simulating it.
    """
    text = _QASM_COMMENTS.sub(" ", qasm)
    count = sum(int(n) for n in _QASM_QUBIT_ARRAY.findall(text))
    count += len(_QASM_QUBIT_SINGLE.findall(text))
    count += sum(int(n) for n in _QASM_QREG.findall(text))
    physical = [int(n) for n in _QASM_PHYSICAL.findall(text)]
    return count + (max(physical) + 1 if physical else 0)


_PAULI_RE = re.compile(r"^[IXYZ]+$")


def _validate_check_expression(text: str) -> None:
    """Refuse an amplitude/probability expression the evaluator would refuse.

    Parsing only — `ast.parse` builds a tree and runs nothing. The walk accepts numbers,
    the names in `CHECK_EXPRESSION_CONSTANTS`, one-argument calls of the names in
    `CHECK_EXPRESSION_FUNCTIONS`, `+ - * / **`, unary `+ -`, and parentheses. Everything
    else (attributes, subscripts, other names, keywords, comparisons) is refused here.
    """
    import ast

    if not text.strip():
        raise ValueError("an expression must not be blank")
    if len(text) > MAX_CHECK_EXPRESSION_CHARS:
        raise ValueError(f"an expression may be at most {MAX_CHECK_EXPRESSION_CHARS} characters")
    try:
        tree = ast.parse(text.strip(), mode="eval")
    except SyntaxError as exc:
        raise ValueError(f"expression {text!r} does not parse: {exc.msg}") from None
    allowed_ops = (ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.UAdd, ast.USub)

    def walk(node: ast.AST) -> None:
        if isinstance(node, ast.Expression):
            walk(node.body)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, allowed_ops):
            walk(node.left)
            walk(node.right)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, allowed_ops):
            walk(node.operand)
        elif isinstance(node, ast.Constant) and type(node.value) in (int, float, complex):
            return
        elif isinstance(node, ast.Name) and node.id in CHECK_EXPRESSION_CONSTANTS:
            return
        elif (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in CHECK_EXPRESSION_FUNCTIONS
            and len(node.args) == 1
            and not node.keywords
        ):
            walk(node.args[0])
        else:
            raise ValueError(
                f"expression {text!r} uses {type(node).__name__}, which a check expression "
                "may not: use numbers, i, pi, e, sqrt(), exp(), cos(), sin() and + - * / **"
            )

    walk(tree)


def _a(kind: str) -> str:
    """ "a state", "an energy" — for messages a reader sees."""
    return ("an " if kind[:1] in "aeio" else "a ") + kind  # "a unitary": a "you" sound


def _validate_bitstring_keys(name: str, keys: list[str], *, max_width: int) -> int:
    if not keys:
        raise ValueError(f"{name} must name at least one basis state")
    widths = {len(key) for key in keys}
    for key in keys:
        if not _BITSTRING_RE.match(key):
            raise ValueError(f"{name} key {key!r} is not a string of 0s and 1s")
    if len(widths) != 1:
        raise ValueError(f"{name} keys must all have the same length, got {sorted(widths)}")
    width = widths.pop()
    if width > max_width:
        raise ValueError(f"{name} keys are {width} bits; a check simulates at most {max_width}")
    return width


class CheckProperty(_Model):
    """What a `role=check` cell asserts about an object an earlier cell built.

    **Not `Cell.check`.** That field is the hidden grader of a reader's exercise: Python
    that runs in the sandbox after the reader's own cell. This is data. The sandbox never
    executes it; it only records the subject (`__leona_capture_check__`), and trusted code
    on the worker (`leona_notebooks.checks.evaluate_check`) judges the subject against the
    expectation here. So nothing a notebook cell does can move the goalposts.

    Five kinds, each with its own expectation fields and no others:

    - `state`: the circuit's output state from |0…0⟩ equals `amplitudes` (bitstring to a
      number or an expression), a library `reference`, or `reference_qasm`, up to global
      phase. Bitstrings follow Qiskit's convention: q0 is the RIGHTMOST character.
    - `unitary`: the circuit's unitary equals `reference` or `reference_qasm` up to
      global phase.
    - `distribution`: the circuit's ideal measured distribution matches `probabilities`.
    - `energy`: ⟨ψ|H|ψ⟩ for `hamiltonian` (Pauli string to coefficient, q0 rightmost as
      in Qiskit's `SparsePauliOp`) against the exact ground energy (`target="ground"`)
      or a number.
    - `value`: a number, or a list of numbers, the subject variable holds.
    """

    kind: CheckKind
    #: The name, in the notebook's namespace, of the object the check is about.
    subject: str = Field(min_length=1, max_length=64)
    amplitudes: dict[str, float | str] | None = Field(
        default=None, max_length=MAX_CHECK_BASIS_ENTRIES
    )
    probabilities: dict[str, float | str] | None = Field(
        default=None, max_length=MAX_CHECK_BASIS_ENTRIES
    )
    reference: str | None = None
    reference_qasm: str | None = Field(
        default=None, min_length=1, max_length=MAX_CHECK_REFERENCE_QASM_CHARS
    )
    hamiltonian: dict[str, float] | None = Field(
        default=None, max_length=MAX_CHECK_HAMILTONIAN_TERMS
    )
    target: Literal["ground"] | float | None = None
    value: float | list[float] | None = None
    #: `None` in a submission means "the default for this kind"; validation fills it in,
    #: so a stored property always states the tolerance it was judged with.
    tolerance: float | None = Field(default=None, ge=0.0)
    #: One human line saying what is being checked. Rendered as the cell's comment.
    statement: str = Field(default="", max_length=300)
    author: CheckAuthor = "nala"
    #: Where the property came from: a paper, an Atlas record id. Required for `source`.
    citation: str = Field(default="", max_length=500)
    #: Whether a person has accepted this check. A Nala check stays unaccepted until then.
    accepted: bool = False
    #: The id of the `role=block` cell this check is evidence for, if any. The block's
    #: card lists the check's verdict and the size it ran at. It links the check to a
    #: claim; it does not change what the check judges, so it is outside
    #: `expectation_key` and outside the dependency cache key. `NotebookSpec` refuses one
    #: that names a cell that is not a block, and drops one that names no cell at all
    #: (the block was deleted).
    block: str | None = None

    @field_validator("block")
    @classmethod
    def _block_is_a_cell_id(cls, value: str | None) -> str | None:
        if value is not None and not _CELL_ID_RE.match(value):
            raise ValueError(f"block {value!r} must be a cell id matching {_CELL_ID_RE.pattern}")
        return value

    @field_validator("subject")
    @classmethod
    def _subject_is_identifier(cls, value: str) -> str:
        import keyword

        if not value.isidentifier() or keyword.iskeyword(value):
            raise ValueError(f"subject {value!r} must be a Python variable name")
        return value

    @field_validator("statement")
    @classmethod
    def _statement_one_line(cls, value: str) -> str:
        if "\n" in value or "\r" in value:
            raise ValueError("statement must be one line")
        return value.strip()

    @model_validator(mode="after")
    def _expectations_fit_the_kind(self) -> CheckProperty:
        given = {name for name in _CHECK_EXPECTATION_FIELDS if getattr(self, name) is not None}
        if self.kind in _CHECK_ONE_OF:
            allowed = set(_CHECK_ONE_OF[self.kind])
            chosen = given & allowed
            if len(chosen) != 1:
                raise ValueError(
                    f"{_a(self.kind)} check needs exactly one of {sorted(allowed)}, "
                    f"got {sorted(chosen) or 'none'}"
                )
        else:
            allowed = set(_CHECK_ALL_OF[self.kind])
            missing = allowed - given
            if missing:
                raise ValueError(f"{_a(self.kind)} check needs {sorted(missing)}")
        extra = given - allowed
        if extra:
            raise ValueError(f"{_a(self.kind)} check does not take {sorted(extra)}")
        return self

    @model_validator(mode="after")
    def _expectations_are_well_formed(self) -> CheckProperty:
        if self.reference is not None:
            grammar = (
                CHECK_STATE_REFERENCE_RE if self.kind == "state" else CHECK_UNITARY_REFERENCE_RE
            )
            if not grammar.match(self.reference):
                names = (
                    "bell, bell:phi-, bell:psi+, bell:psi-, ghz(n), w(n), uniform(n)"
                    if self.kind == "state"
                    else "qft(n), iqft(n)"
                )
                raise ValueError(
                    f"reference {self.reference!r} is not a library reference "
                    f"{_a(self.kind)} check can use; one of: {names}"
                )
        for name in ("amplitudes", "probabilities"):
            mapping = getattr(self, name)
            if mapping is None:
                continue
            _validate_bitstring_keys(
                name,
                list(mapping),
                max_width=CHECK_STATE_MAX_QUBITS
                if name == "amplitudes"
                else CHECK_DISTRIBUTION_MAX_QUBITS,
            )
            for key, entry in mapping.items():
                if isinstance(entry, str):
                    _validate_check_expression(entry)
                elif not math.isfinite(entry):
                    raise ValueError(f"{name}[{key}] is not a finite number")
                elif name == "probabilities" and entry < 0:
                    raise ValueError(f"probabilities[{key}] is negative")
        if self.hamiltonian is not None:
            if not self.hamiltonian:
                raise ValueError("hamiltonian must have at least one term")
            widths = {len(term) for term in self.hamiltonian}
            for term, coefficient in self.hamiltonian.items():
                if not _PAULI_RE.match(term):
                    raise ValueError(f"hamiltonian term {term!r} is not a string of I, X, Y, Z")
                if not math.isfinite(coefficient):
                    raise ValueError(f"hamiltonian[{term}] is not a finite number")
            if len(widths) != 1:
                raise ValueError("hamiltonian terms must all act on the same number of qubits")
            if widths.pop() > MAX_CHECK_HAMILTONIAN_QUBITS:
                raise ValueError(
                    f"an energy check diagonalises at most {MAX_CHECK_HAMILTONIAN_QUBITS} qubits"
                )
        if self.reference_qasm is not None:
            ceiling = CHECK_UNITARY_MAX_QUBITS if self.kind == "unitary" else CHECK_STATE_MAX_QUBITS
            width = declared_qubits(self.reference_qasm)
            if width > ceiling:
                raise ValueError(
                    f"the reference circuit declares {width} qubits; {_a(self.kind)} check "
                    f"judges at most {ceiling}"
                )
        if isinstance(self.target, float) and not math.isfinite(self.target):
            raise ValueError("target must be a finite number or 'ground'")
        if self.value is not None:
            values = self.value if isinstance(self.value, list) else [self.value]
            if not values:
                raise ValueError("value must not be an empty list")
            if len(values) > MAX_CHECK_VALUE_ENTRIES:
                raise ValueError(f"value may have at most {MAX_CHECK_VALUE_ENTRIES} entries")
            if not all(math.isfinite(entry) for entry in values):
                raise ValueError("value must hold finite numbers only")
        return self

    @model_validator(mode="after")
    def _tolerance_and_provenance(self) -> CheckProperty:
        if self.tolerance is None:
            self.tolerance = CHECK_DEFAULT_TOLERANCE[self.kind]
        if not math.isfinite(self.tolerance):
            raise ValueError("tolerance must be a finite number")
        ceiling = _CHECK_TOLERANCE_CEILING.get(self.kind)
        if ceiling is not None and self.tolerance >= ceiling:
            raise ValueError(
                f"{_a(self.kind)} check with tolerance {self.tolerance} cannot fail; "
                f"it must be below {ceiling}"
            )
        if self.author == "source" and not self.citation.strip():
            raise ValueError("a check with author 'source' needs a citation")
        return self

    def expectation_key(self) -> dict[str, Any]:
        """Everything that decides the verdict, and nothing about who wrote it, whether
        it was accepted, or which block it is evidence for. Two properties with the same
        key are the same check."""
        return self.model_dump(mode="json", exclude={"author", "accepted", "block"})


# --------------------------------------------------------------------------- block cells

#: The planner problems a block's `plan` may name, and the parameters each one takes: the
#: `id` and `params[].key` of every entry of `PROBLEMS` in
#: `apps/web/lib/workflow-planner/problems.ts`, restated because this package imports
#: nothing internal. `apps/web/lib/notebook-blocks.test.ts` reads this table back from
#: this file and fails if the two drift.
PLANNER_PROBLEM_PARAMS: dict[str, tuple[str, ...]] = {
    "search": ("domainSize", "markedCount", "oracleToffolis"),
    "factoring": ("bits",),
    "ecdlp": ("bits",),
    "ground-state": ("lambda", "deltaE", "orbitals"),
    "hamiltonian-simulation": ("lambda", "time", "epsilon"),
    "linear-system": ("kappa", "epsilon", "dimension", "stepToffolis"),
    "maxcut": ("nodes", "edges", "layers"),
    "amplitude-estimation": ("epsilon",),
    "phase-estimation": ("precisionBits", "failureProbability"),
    "linear-ode": (),
    "nonlinear-ode": (),
}
PlannerProblemId = Literal[
    "search",
    "factoring",
    "ecdlp",
    "ground-state",
    "hamiltonian-simulation",
    "linear-system",
    "maxcut",
    "amplitude-estimation",
    "phase-estimation",
    "linear-ode",
    "nonlinear-ode",
]
#: `STUDIO_PLAN_LINK_MAX_CHOICES` in `apps/web/lib/workflow-planner/studio-link.ts`.
BLOCK_PLAN_MAX_CHOICES = 32
#: A choice's key is a stage path in the planner's tree (`quantum-linear-solve/
#: state-preparation`): capability ids joined by `/`. Its value is a method id.
_STAGE_PATH_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}(?:/[a-z0-9][a-z0-9-]{0,79}){0,7}$")
#: Atlas layer-graph ids (`grover-fixed-iteration-search`). The shape is checked here;
#: whether the id names a method is the page's to say, because this package does not
#: carry the Atlas.
_ATLAS_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,99}$")


class BlockPlan(_Model):
    """The planner's INPUTS for the problem a block is a stage of: never its numbers.

    The shape `StudioPlanLink` already carries into Studio
    (`apps/web/lib/workflow-planner/studio-link.ts`), without the reader's sentence: the
    problem, the parameter values the author set, and the method chosen at each stage
    path that differs from the planner's default. The page re-runs the planner over these
    every time it renders the block, so a cost is always today's formula at the size on
    screen, and nothing a stored spec says can put a number in front of a reader. A value
    left out takes the planner's own stated assumption, which the page labels as one.
    """

    problem: PlannerProblemId
    #: Parameter key to value. `None` clears a value the planner would otherwise assume.
    params: dict[str, float | None] = Field(default_factory=dict)
    #: Stage path to the method chosen there.
    choices: dict[str, str] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _inputs_fit_the_problem(self) -> BlockPlan:
        declared = PLANNER_PROBLEM_PARAMS[self.problem]
        for key, value in self.params.items():
            if key not in declared:
                names = ", ".join(declared) or "none"
                raise ValueError(
                    f"the {self.problem} problem has no parameter {key!r}; it takes: {names}"
                )
            if value is not None and not math.isfinite(value):
                raise ValueError(f"params[{key}] is not a finite number")
        if len(self.choices) > BLOCK_PLAN_MAX_CHOICES:
            raise ValueError(f"a plan may carry at most {BLOCK_PLAN_MAX_CHOICES} choices")
        for path, method in self.choices.items():
            if not _STAGE_PATH_RE.match(path):
                raise ValueError(f"choice key {path!r} is not a stage path")
            if not _ATLAS_ID_RE.match(method):
                raise ValueError(f"choice {path!r} names {method!r}, which is not a method id")
        return self


class BlockRef(_Model):
    """What a `role=block` cell places in a notebook: one Atlas method.

    The cell is `kind="markdown"`, and its `source` is prose rendered from this model
    (`leona_notebooks.blocks.block_comment`), so the cell reads as a paragraph in
    Jupyter. The page renders the block as a card instead: the method's cost at a
    problem size the reader moves, and the notebook's own checks (`CheckProperty.block`)
    as evidence up to the size they ran at. No number is stored here.

    - `method`: the Atlas layer-graph method id.
    - `plan`: the planner's inputs when the method is a stage of a planner problem, or
      `None` when the page should show the method's own cost as its source states it.
    - `size_param`: which of the plan's parameters is the problem size the control moves.
      `None` with a plan means the page picks one; it must be `None` without a plan.
    - `author`, `citation`, `accepted`: exactly as on `CheckProperty`. Nala may propose a
      block, only a person accepts one, and a repair may not touch one
      (`leona_notebooks.blocks.enforce_block_authorship`).
    """

    method: str
    plan: BlockPlan | None = None
    size_param: str | None = None
    author: CheckAuthor = "nala"
    citation: str = Field(default="", max_length=500)
    accepted: bool = False

    @field_validator("method")
    @classmethod
    def _method_is_an_atlas_id(cls, value: str) -> str:
        if not _ATLAS_ID_RE.match(value):
            raise ValueError(f"method {value!r} is not an Atlas method id")
        return value

    @model_validator(mode="after")
    def _size_param_and_provenance(self) -> BlockRef:
        if self.size_param is not None:
            if self.plan is None:
                raise ValueError("size_param names a planner parameter, so it needs a plan")
            declared = PLANNER_PROBLEM_PARAMS[self.plan.problem]
            if self.size_param not in declared:
                names = ", ".join(declared) or "none"
                raise ValueError(
                    f"size_param {self.size_param!r} is not a parameter of the "
                    f"{self.plan.problem} problem; it takes: {names}"
                )
        if self.author == "source" and not self.citation.strip():
            raise ValueError("a block with author 'source' needs a citation")
        return self

    def claim_key(self) -> dict[str, Any]:
        """Everything the block claims, and nothing about who wrote it or whether it was
        accepted. Two blocks with the same key are the same block."""
        return self.model_dump(mode="json", exclude={"author", "accepted"})


class Cell(_Model):
    id: str
    kind: Literal["markdown", "code"]
    role: CellRole | None = None
    source: str = ""
    tags: list[str] = Field(default_factory=list)
    #: `False` marks a cell the product never runs on the reader's behalf — a hardware
    #: submission, anything that needs a credential or the network.
    execute: bool = True
    #: For `role=solution` code cells: the learner-facing placeholder in the challenge build.
    stub: str | None = None
    #: Hidden grader for a code cell the reader fills in. Runs in the sandbox
    #: immediately after the reader's own cell, in the SAME namespace, so it can
    #: assert on whatever that cell defined. Never sent to the browser and never
    #: written into an exported `.ipynb` — see `NotebookSpec.for_learner()`.
    #:
    #: A grader that cannot fail is not a grader, and both routes a check can arrive
    #: by are held to that. `scripts/check_graders.py` gates the ones committed to this
    #: repository; `leona_notebooks.grader_audit` gates the ones the model writes at
    #: request time, from two runs of the whole notebook — one with every exercise
    #: blank, where each check must FAIL, one with the author's own source in place,
    #: where each must PASS. A generated check that fails either arm has its `check`
    #: stripped before the notebook reaches a reader (owner ruling ai-ops#258), so a
    #: cell arriving from the pipeline with `check` set has been proved, not assumed.
    check: str | None = None
    #: Structured answer key for a `role=question` cell. `choice`, `numeric` and
    #: `text` grade deterministically; `rubric` is graded by the model.
    answer: AnswerKey | None = None
    #: The redacted half of `answer`, and the ONLY half a reader's browser receives.
    #: Set by `for_learner()`; an authored spec leaves it `None`.
    answer_prompt: AnswerPrompt | None = None
    #: Advisory per-cell budget for a kernel-based validator; the sandbox has one budget.
    timeout_s: int | None = Field(default=None, ge=1, le=600)
    #: For `role=check` cells only, and required on them: the structured property the
    #: worker judges (`CheckProperty`). UNRELATED to `check` above, despite the name —
    #: `check` is the hidden grader of a reader's exercise and runs in the sandbox; this
    #: is data the sandbox never runs, judged by trusted code after the run. The cell's
    #: `source` is only a comment rendered from it.
    property: CheckProperty | None = None
    #: For `role=block` cells only, and required on them: the Atlas method the cell
    #: places, with the planner's inputs for its cost (`BlockRef`). The cell's `source`
    #: is only prose rendered from it.
    block: BlockRef | None = None
    # The `property` field above shadows the builtin `property` for the rest of this class
    # body, so the computed attributes below are declared with `builtins.property`. A bare
    # `@property` after this line decorates with `None` and fails at import.

    @field_validator("id")
    @classmethod
    def _id_shape(cls, value: str) -> str:
        if not _CELL_ID_RE.match(value):
            raise ValueError(f"cell id {value!r} must match {_CELL_ID_RE.pattern}")
        return value

    @model_validator(mode="after")
    def _stub_only_on_code(self) -> Cell:
        if self.stub is not None and self.kind != "code":
            raise ValueError(f"cell {self.id}: only code cells carry a stub")
        return self

    @model_validator(mode="after")
    def _check_only_on_code(self) -> Cell:
        if self.check is not None and self.kind != "code":
            raise ValueError(f"cell {self.id}: only code cells carry a check")
        return self

    @model_validator(mode="after")
    def _check_needs_a_stub(self) -> Cell:
        """A grader with nothing to grade is an authoring mistake, not a strict build.

        The check runs against what the reader wrote in place of `stub`. Without a
        stub there is no reader-authored cell for it to grade, so it would only ever
        run against the model's own solution and pass every time — a green tick that
        measures nothing.
        """
        if self.check is not None and not (self.stub or "").strip():
            raise ValueError(f"cell {self.id}: a check needs a stub for the reader to fill in")
        return self

    @model_validator(mode="after")
    def _answer_only_on_question(self) -> Cell:
        if self.answer is not None and self.role != CellRole.QUESTION:
            raise ValueError(f"cell {self.id}: only role=question cells carry an answer key")
        return self

    @model_validator(mode="after")
    def _property_exactly_on_check_cells(self) -> Cell:
        """A `role=check` cell is its property; any other cell has none.

        Both directions, because each half fails silently alone: a property on a `run`
        cell would never be judged (the composer only captures `role=check` cells), and a
        `role=check` cell with no property would render as a check on the page and judge
        nothing. A check cell is code (the sandbox captures at its position) and carries
        neither a stub nor a hidden grader, which belong to exercises.
        """
        if self.role == CellRole.CHECK:
            if self.property is None:
                raise ValueError(f"cell {self.id}: a role=check cell needs a property")
            if self.kind != "code":
                raise ValueError(f"cell {self.id}: a role=check cell must be a code cell")
            if self.stub is not None or self.check is not None:
                raise ValueError(f"cell {self.id}: a role=check cell carries no stub or grader")
        elif self.property is not None:
            raise ValueError(f"cell {self.id}: only role=check cells carry a property")
        return self

    @model_validator(mode="after")
    def _block_exactly_on_block_cells(self) -> Cell:
        """A `role=block` cell is its `BlockRef`; any other cell has none.

        Both directions, for the reason a check cell's property is held both ways: a
        `block` on another cell would never be drawn as a block, and a `role=block` cell
        without one would draw a card with nothing on it. A block cell is markdown (the
        sandbox never sees it, and in Jupyter it reads as prose) and carries nothing that
        belongs to an exercise or a check.
        """
        if self.role == CellRole.BLOCK:
            if self.block is None:
                raise ValueError(f"cell {self.id}: a role=block cell needs a block")
            if self.kind != "markdown":
                raise ValueError(f"cell {self.id}: a role=block cell must be a markdown cell")
            if self.check is not None or self.answer is not None:
                raise ValueError(f"cell {self.id}: a role=block cell carries no grader or answer")
        elif self.block is not None:
            raise ValueError(f"cell {self.id}: only role=block cells carry a block")
        return self

    @builtins.property
    def is_graded(self) -> bool:
        """Whether this cell can produce a grade at all — the two ways differ.

        A code cell is graded by running `check`; a question cell by comparing the
        reader's response to `answer`. A cell with neither is content, and counting
        it as an ungraded exercise is what makes a progress figure honest.
        """
        return self.check is not None or self.answer is not None

    @builtins.property
    def is_code(self) -> bool:
        return self.kind == "code"

    @builtins.property
    def runs_in_sandbox(self) -> bool:
        return self.kind == "code" and self.execute and "skip-execution" not in self.tags

    @builtins.property
    def may_raise(self) -> bool:
        return "raises-exception" in self.tags


class NotebookSpec(_Model):
    schema_version: Literal[1] = NOTEBOOK_SCHEMA_VERSION
    slug: str
    title: str
    kind: NotebookKind = NotebookKind.LESSON
    summary: str = ""
    audience: Audience = Field(default_factory=Audience)
    style: Style = Field(default_factory=Style)
    framework: NotebookFramework = Field(default_factory=NotebookFramework)
    objectives: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)
    duration_minutes: int | None = Field(default=None, ge=1, le=600)
    cells: list[Cell] = Field(default_factory=list)
    references: list[Reference] = Field(default_factory=list)
    seeds: list[Seed] = Field(default_factory=list)
    #: The reader's original ask, kept verbatim as provenance.
    brief: str = ""
    #: Free-form placement data (curriculum unit, order). Never interpreted here.
    extra: dict[str, Any] = Field(default_factory=dict)

    @field_validator("slug")
    @classmethod
    def _slug_shape(cls, value: str) -> str:
        if not _SLUG_RE.match(value):
            raise ValueError(f"slug {value!r} must match {_SLUG_RE.pattern}")
        return value

    @field_validator("title")
    @classmethod
    def _title_nonempty(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("title must not be blank")
        return value.strip()

    @model_validator(mode="after")
    def _unique_cell_ids(self) -> NotebookSpec:
        seen: set[str] = set()
        for cell in self.cells:
            if cell.id in seen:
                raise ValueError(f"duplicate cell id {cell.id!r}")
            seen.add(cell.id)
        return self

    @model_validator(mode="after")
    def _check_block_links(self) -> NotebookSpec:
        """A check's `property.block` names a block cell of THIS notebook.

        Naming a cell that exists and is not a block is a mistake and is refused. Naming
        a cell that is not there at all is what deleting a block leaves behind, whoever
        deleted it, so the link is dropped here rather than failing the save: the check
        itself is unchanged and simply stops being listed as evidence.
        """
        roles = {cell.id: cell.role for cell in self.cells}
        dangling = False
        for cell in self.cells:
            link = cell.property.block if cell.property is not None else None
            if link is None:
                continue
            if link not in roles:
                dangling = True
            elif roles[link] != CellRole.BLOCK:
                raise ValueError(
                    f"cell {cell.id}: its check is evidence for {link!r}, which is not a "
                    "role=block cell"
                )
        if dangling:
            self.cells = [
                cell.model_copy(
                    update={"property": cell.property.model_copy(update={"block": None})}
                )
                if cell.property is not None
                and cell.property.block is not None
                and cell.property.block not in roles
                else cell
                for cell in self.cells
            ]
        return self

    def cell_by_id(self, cell_id: str) -> Cell:
        for cell in self.cells:
            if cell.id == cell_id:
                return cell
        raise KeyError(cell_id)

    def index_of(self, cell_id: str) -> int:
        for index, cell in enumerate(self.cells):
            if cell.id == cell_id:
                return index
        raise KeyError(cell_id)

    def code_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.is_code]

    def executable_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.runs_in_sandbox]

    def with_cells(self, cells: list[Cell]) -> NotebookSpec:
        return self.model_copy(update={"cells": list(cells)})

    def roles_present(self) -> set[CellRole]:
        return {cell.role for cell in self.cells if cell.role is not None}

    def next_cell_id(self, prefix: str = "c") -> str:
        used = {cell.id for cell in self.cells}
        index = len(self.cells) + 1
        while True:
            candidate = f"{prefix}{index:02d}"
            if candidate not in used:
                return candidate
            index += 1

    def for_learner(self) -> NotebookSpec:
        """The build a reader receives: no graders, no answer keys, no answers, stubs in place.

        Four redactions, and each one is the difference between a graded notebook and a
        notebook that merely looks graded:

        * `check` is dropped — it holds the assertions, and often the answer with them.
        * `answer` is replaced by `answer_prompt`, which carries the options but not
          which one is right.
        * a `solution` cell's `source` is replaced by its `stub`, so the reader gets
          the placeholder to fill in rather than the finished code, and its role becomes
          `exercise` — what the cell now IS.
        * a cell whose role is in `SOLUTION_ONLY_ROLES` and which carries no stub to put
          in its place is **removed**. `role=answer` is the case that matters: its secret
          is not in a field but in its own prose, so nulling fields does nothing to it.

        That last one was absent for as long as this method existed, and
        `leaks_answer_key()` could not see it either — see that method's note. Both were
        written by reading the *fields* `for_learner` writes rather than by asking how a
        secret can be represented, and a `role=answer` markdown cell represents it as
        text.

        A fifth, since check cells (review of PR 1011): in a notebook that
        `carries_secrets()`, every `role=check` cell is **removed**. Its property is a
        structured expectation of the very object the exercise asks the reader to build
        (`reference="ghz(3)"`, `value=0.4375`), so it states the answer as plainly as an
        answer key does. A notebook with nothing secret keeps its checks: there they are the
        evidence a reader is meant to see.

        A sixth, since block cells: in a notebook that `carries_secrets()`, every
        `role=block` cell is **removed** too. Its card works out the method's cost at the
        size the plan names, and a cost line can be the answer: a Grover block's iteration
        count is exactly what an exercise on the same search asks for.

        Returns a copy; the authored spec is never mutated.
        """
        drop_checks = self.carries_secrets()
        cells: list[Cell] = []
        for cell in self.cells:
            if cell.role in SOLUTION_ONLY_ROLES and not (cell.is_code and cell.stub is not None):
                continue
            if drop_checks and cell.role in (CellRole.CHECK, CellRole.BLOCK):
                continue
            data = cell.model_dump()
            data["check"] = None
            if cell.answer is not None:
                data["answer"] = None
                data["answer_prompt"] = AnswerPrompt(
                    kind=cell.answer.kind,
                    options=list(getattr(cell.answer, "options", []) or []),
                    unit=getattr(cell.answer, "unit", "") or "",
                ).model_dump()
            if cell.role in SOLUTION_ONLY_ROLES and cell.stub is not None:
                # `in SOLUTION_ONLY_ROLES`, not `== SOLUTION`. The guard above keeps any
                # cell of these roles that has a stub, and this branch replaced the source
                # of only one of them — so a quiz whose answer is a CODE cell with a stub
                # (which `NotebookKind.QUIZ` explicitly permits: "a role=answer cell,
                # markdown or code") was kept AND left unredacted. Greptile, PR 836.
                #
                # Two conditions for one set is the same defect this method was rewritten
                # to remove, reintroduced four lines below the docstring that says so.
                data["source"] = cell.stub
                data["stub"] = None
                data["role"] = CellRole.EXERCISE.value
            cells.append(Cell.model_validate(data))
        return self.model_copy(update={"cells": cells})

    def leaks_answer_key(self) -> list[str]:
        """Cell ids in this spec that still carry something a reader must not see.

        Written to be called ON a learner build, as the assertion that `for_learner()`
        did its job — a redaction nothing checks is a redaction that silently stops
        happening the first time a field is added to `Cell`.

        **Its arms are enumerated from how a secret can be REPRESENTED, not from the
        fields `for_learner()` happens to write**, because those are the same list only
        by luck and were not: until 2026-09-05 this returned `[]` for a spec whose
        `role=answer` cell said "the answer is H" in plain markdown. The guard had been
        derived from the implementation, so it inherited exactly the implementation's
        blind spot and mutation-tested green. Four representations:

        1. a hidden grader (`check`) — assertions, usually with the answer in them;
        2. a structured key (`answer`);
        3. an unredacted solution — a `solution` cell whose source is not its stub;
        4. **prose** — any surviving cell in `SOLUTION_ONLY_ROLES`, whose secret is the
           cell itself.
        5. **a structured expectation** — a check cell's `property`, in a notebook that
           `carries_secrets()`. A learner build still shows that it came from one (its
           exercises, its answer prompts), so a surviving check there is named.
        6. **a cost the page works out** — a block cell's `block`, in a notebook that
           `carries_secrets()`. Its plan is the input to a number (an iteration count, a
           register width) that can be the exercise's answer.
        """
        secrets = self.carries_secrets()
        leaked: list[str] = []
        for cell in self.cells:
            if cell.check is not None or cell.answer is not None:
                leaked.append(cell.id)
            elif (cell.property is not None or cell.block is not None) and secrets:
                leaked.append(cell.id)
            elif cell.role in SOLUTION_ONLY_ROLES:
                # A surviving solution/answer cell. For a code solution the stub swap is
                # the redaction, so it leaks only if the source is still the real thing;
                # `for_learner` relabels those to `exercise`, so reaching here at all
                # means the cell was not redacted.
                if not (cell.is_code and cell.stub is not None and cell.source == cell.stub):
                    leaked.append(cell.id)
        return leaked

    def carries_secrets(self) -> bool:
        """Whether this notebook holds anything a learner must not see before they try.

        True for an authored notebook with a solution, an answer, an exercise, a hidden
        grader or an answer key, and for the learner build of one, which still has its
        exercises and answer prompts. Deliberately wider than `SOLUTION_ONLY_ROLES`: an
        exercise the reader fills in has an answer even when no solution cell is written
        down, and a check on the object it builds would state it.
        """
        return any(
            cell.role in SOLUTION_ONLY_ROLES
            or cell.role == CellRole.EXERCISE
            or cell.check is not None
            or cell.answer is not None
            or cell.answer_prompt is not None
            for cell in self.cells
        )

    def learner_report(self, report: ExecutionReport | None) -> ExecutionReport | None:
        """The run report a learner reads beside `for_learner()`.

        Without the result of every check cell `for_learner()` removed. A verdict carries
        the subject's OpenQASM, which is the solution's circuit, and `checked_against`,
        `measure` and `detail` repeat the expected values, so a hidden check's verdict gives
        away exactly what hiding the check was for. Every learner door (the public share,
        a workspace member's view) passes the report through this.
        """
        if report is None:
            return None
        kept = {cell.id for cell in self.for_learner().cells}
        # Block cells are markdown and have no result of their own; they are in the set
        # so that a report which somehow carries one for them loses it with the cell.
        hidden = {
            cell.id for cell in self.cells if cell.role in (CellRole.CHECK, CellRole.BLOCK)
        } - kept
        if not hidden:
            return report
        return report.model_copy(
            update={"cells": [result for result in report.cells if result.id not in hidden]}
        )

    def graded_cells(self) -> list[Cell]:
        return [cell for cell in self.cells if cell.is_graded]


# --------------------------------------------------------------------------- what a run produced

OutputMime = Literal[
    "text/plain",
    "text/html",
    "text/latex",
    "text/markdown",
    "image/png",
    "image/svg+xml",
]


class CellOutput(_Model):
    mime: OutputMime
    #: Text for text mimes; base64 for `image/png`.
    data: str
    truncated: bool = False
    original_bytes: int | None = None


class CellError(_Model):
    ename: str
    evalue: str
    traceback: list[str] = Field(default_factory=list)


CellStatus = Literal["ok", "error", "skipped", "not_run"]

#: Ceilings on what a notebook cell may ask to run on a real QPU (`leona_submit`).
#:
#: The first two are the SUBMISSION route's own bounds (`MAX_ESTIMATE_SHOTS` and
#: `MAX_SUBMISSION_QASM_CHARS` in `majorana_api.routes.qpu`), restated here because
#: this package imports nothing internal. They are the same numbers on purpose: a
#: request the sandbox accepts and the route then refuses would reach the reader as
#: a failure after they had already been shown a price and pressed confirm.
#: `services/api/tests/test_notebook_hardware_caps.py` fails if the two drift.
MAX_HARDWARE_REQUEST_SHOTS = 1_000_000
MAX_HARDWARE_REQUEST_QASM_CHARS = 200_000
#: Per notebook run, not per cell. Each request is a card with its own device picker
#: and price under the cell, and a notebook that asks for more than a handful of QPU
#: jobs is almost certainly a loop calling `leona_submit` by mistake.
MAX_HARDWARE_REQUESTS_PER_NOTEBOOK = 8
MAX_HARDWARE_REQUEST_LABEL_CHARS = 120


class HardwareRequest(_Model):
    """A circuit a cell asked to run on hardware, recorded by `leona_submit`.

    A REQUEST, not a submission: nothing leaves the sandbox. The reader sees it as a
    card under the cell, picks a device, is shown the price, confirms, and only then
    does the web send it through `POST /v1/qpu/submissions` with their own IBM
    credential — the same priced path Studio uses (plan rule 4, 2026-09-23).

    `qasm` is OpenQASM 3, because that is what the worker parses
    (`qiskit.qasm3.loads` in `majorana_qpu.ibm`).
    """

    qasm: str = Field(min_length=1, max_length=MAX_HARDWARE_REQUEST_QASM_CHARS)
    shots: int = Field(ge=1, le=MAX_HARDWARE_REQUEST_SHOTS)
    num_qubits: int = Field(ge=1)
    label: str | None = Field(default=None, max_length=MAX_HARDWARE_REQUEST_LABEL_CHARS)


class CheckTeeth(_Model):
    """Whether a passing check could have failed: the worker's mutation test of it.

    For a check that passes on a circuit, the worker makes deliberately broken copies of
    the subject (drop a gate, swap a two-qubit gate's control and target, negate an angle,
    swap a gate for its adjoint, reverse the qubit order) and judges each the same way.
    A copy that behaves exactly like the original is `equivalent` and is left out, because
    no check could catch it. `caught` of `mutants` is the score; `survivors` names the
    broken copies the check passed, at most 8, in words.

    `not_measured` is never a pass: it means the test did not happen (too large, over the
    time budget, a `value` check with no circuit to break), and `reason` says which.
    """

    status: Literal["measured", "not_measured"]
    reason: str = Field(default="", max_length=500)
    mutants: int = Field(default=0, ge=0)
    equivalent: int = Field(default=0, ge=0)
    caught: int = Field(default=0, ge=0)
    survivors: list[str] = Field(default_factory=list, max_length=8)
    #: Broken copies the simulator refused to run. Counted, never silently dropped, and
    #: counted in neither `mutants` nor `equivalent`.
    could_not_run: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def _caught_within_mutants(self) -> CheckTeeth:
        if self.caught > self.mutants:
            raise ValueError("caught cannot exceed mutants")
        return self


class CheckVerdict(_Model):
    """The worker's judgement of one `role=check` cell, on `CellResult.check`.

    Written only by trusted code after the run (`leona_notebooks.checks`), never by the
    sandbox. `pass` / `fail` / `inconclusive` and nothing else — never "verified"
    (ADR-0023). `inconclusive` is the check's own incapacity (the subject is missing, is
    not a circuit, measures mid-circuit, is too wide, did not parse) and is never counted
    as a fail. A failing check does not fail the notebook.
    """

    status: CheckStatus
    #: What was judged: the circuit the code built, or a plain value it produced. The page
    #: says "checked from the circuit" or "checked from the value your code produced".
    basis: Literal["circuit", "value"]
    #: What the subject was compared with, in words ("Qiskit's QFT on 3 qubits, exact
    #: unitary").
    checked_against: str = Field(default="", max_length=500)
    #: The number, with the bar it had to clear ("fidelity 0.999999 (needs ≥ 0.999999)").
    measure: str = Field(default="", max_length=500)
    #: On a fail, the diagnosis (reversed qubit order, one wrong phase, the adjoint); on an
    #: inconclusive, why the check could not judge.
    detail: str = Field(default="", max_length=2_000)
    qubits: int | None = Field(default=None, ge=0)
    #: sha256 of the subject's OpenQASM as the worker normalised it.
    subject_fingerprint: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    #: The subject's OpenQASM, when it is short enough to repeat.
    subject_qasm: str | None = Field(default=None, max_length=MAX_CHECK_VERDICT_QASM_CHARS)
    teeth: CheckTeeth | None = None


class CellResult(_Model):
    id: str
    status: CellStatus
    stdout: str = ""
    stderr: str = ""
    outputs: list[CellOutput] = Field(default_factory=list)
    error: CellError | None = None
    duration_ms: int = Field(default=0, ge=0)
    execution_count: int | None = None
    note: str = ""
    #: Circuits this cell asked to run on a QPU, in call order. Empty for every cell
    #: that never called `leona_submit`, which includes every report stored before the
    #: field existed — so those still parse unchanged.
    hardware_requests: list[HardwareRequest] = Field(
        default_factory=list, max_length=MAX_HARDWARE_REQUESTS_PER_NOTEBOOK
    )
    #: The worker's verdict on a `role=check` cell; `None` for every other cell and in
    #: every report stored before check cells existed, so those still parse unchanged.
    check: CheckVerdict | None = None
    #: This cell's Merkle cache key (`leona_notebooks.dependencies.cache_keys`) at the
    #: moment it actually ran. `None` for every report stored before dependency-graph
    #: replay shipped, and for any cell the sandbox never dispatched (`skipped`,
    #: `not_run`) — a cell replay never executed has no key to be reused BY, and a
    #: `None` here is exactly what makes such a report "uncached" rather than a false
    #: match on an absent key (`leona_notebooks.dependencies.plan_run`).
    cache_key: str | None = None
    #: Set when this cell's result was NOT re-run: it is the PARENT version's own
    #: `CellResult`, copied forward because its cache key still matched. The value is
    #: the parent version's `seq`, so the page can say "unchanged since version N, not
    #: re-run". `None` for a cell that actually executed this run (whether or not it
    #: also happens to carry a `cache_key` — the two fields are independent: an
    #: executed cell's `cache_key` is ITS OWN fresh key, not a claim about reuse).
    cached_from_seq: int | None = None


class ExecutionReport(_Model):
    notebook_slug: str
    ok: bool
    runner: Literal["sandbox", "nbclient", "inprocess"]
    cells: list[CellResult] = Field(default_factory=list)
    duration_ms: int = Field(default=0, ge=0)
    environment: dict[str, str] = Field(default_factory=dict)
    dropped_bytes: int = Field(default=0, ge=0)
    note: str = ""

    def by_id(self) -> dict[str, CellResult]:
        return {cell.id: cell for cell in self.cells}

    def first_error(self) -> CellResult | None:
        for cell in self.cells:
            if cell.status == "error":
                return cell
        return None

    def failing_cells(self) -> list[CellResult]:
        return [cell for cell in self.cells if cell.status == "error"]

    def executed_count(self) -> int:
        return sum(1 for cell in self.cells if cell.status in {"ok", "error"})


class CellGrade(_Model):
    """The verdict on ONE graded cell.

    `unattempted` is a first-class status rather than a failure: a reader who has
    not reached a cell has not got it wrong, and collapsing the two would make a
    progress bar drop as a notebook grows. `ungradable` is the honest outcome when
    the grader itself could not run — a sandbox timeout, a malformed key — and it
    is never counted as either a pass or a fail.
    """

    id: str
    status: Literal["passed", "failed", "unattempted", "ungradable"]
    graded_by: Literal["deterministic", "model"]
    #: Reader-facing, and written to be read after a wrong answer: what was expected,
    #: not merely that it was wrong.
    message: str = ""
    #: One step toward the answer, never the answer itself.
    hint: str = ""
    #: For a code cell: the assertion text that failed, so the reader sees the
    #: actual condition rather than a generic "incorrect".
    detail: str = ""


class GradeReport(_Model):
    """Grades for one attempt at one notebook version."""

    notebook_slug: str
    cells: list[CellGrade] = Field(default_factory=list)

    def by_id(self) -> dict[str, CellGrade]:
        return {grade.id: grade for grade in self.cells}

    @property
    def passed(self) -> int:
        return sum(1 for grade in self.cells if grade.status == "passed")

    @property
    def failed(self) -> int:
        return sum(1 for grade in self.cells if grade.status == "failed")

    @property
    def attempted(self) -> int:
        return sum(1 for grade in self.cells if grade.status in {"passed", "failed"})

    @property
    def gradable(self) -> int:
        """Cells that could be graded at all — the denominator a score must use.

        Deliberately excludes `ungradable`: scoring 8/10 when two graders crashed
        reports a worse result than the reader earned, and scoring 8/8 hides that
        two never ran. Callers show `attempted`/`gradable` and surface the rest.
        """
        return sum(1 for grade in self.cells if grade.status != "ungradable")


class ReviewFinding(_Model):
    cell_id: str | None = None
    severity: Literal["blocker", "should-fix", "nit"]
    category: Literal["accuracy", "pedagogy", "code", "structure", "safety", "style"]
    finding: str
    suggestion: str = ""


class NotebookReview(_Model):
    """Advisory, like the execute pipeline's alignment review: never blocks a save."""

    verdict: Literal["ready", "needs-attention"]
    findings: list[ReviewFinding] = Field(default_factory=list)
    what_this_notebook_does_not_establish: list[str] = Field(default_factory=list)
    #: Structure requirements the spec does not satisfy (`templates.check_structure`),
    #: recorded so a reader's own edit is *reported on* rather than refused. Nala's
    #: own builds run the same check as a prompt constraint; a user-authored version
    #: runs it here and keeps going. Carried in this model rather than on a column of
    #: its own because `notebook_versions.review` is already the JSONB the advisory
    #: layer is stored in — see `NotebookVersion.warnings`, which mirrors this out.
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------- resources


class NotebookVersionStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    READY = "ready"
    FAILED = "failed"


class NotebookVersionAuthor(StrEnum):
    USER = "user"
    NALA = "nala"


class NotebookTurnRole(StrEnum):
    USER = "user"
    NALA = "nala"


#: Imported rather than redeclared. `test_every_public_resource_model_reaches_the_export`
#: finds unexported models by testing `issubclass(value, models._ResourceBase)` — so a
#: module with its own identically-configured base is INVISIBLE to it, and this module's
#: entire family of request/response models was. Two of them slipped past the guard the
#: day it was checked. One base, one guard that can see everything under it.
from .models import _ResourceBase  # noqa: E402


class Notebook(_ResourceBase):
    """Owner-facing notebook resource. Content lives in versions."""

    id: UUID
    workspace_id: UUID
    owner_user_id: UUID
    slug: str
    title: str
    kind: NotebookKind
    summary: str = ""
    visibility: Visibility = Visibility.PRIVATE
    language: Literal["en", "ja"] = "en"
    framework: NotebookFramework = Field(default_factory=NotebookFramework)
    #: The version readers see; `None` until the first generation finishes.
    current_version_id: UUID | None = None
    current_version_seq: int | None = None
    #: Status of the newest version, so a list can show "generating" without a join.
    latest_status: NotebookVersionStatus
    latest_run_id: UUID | None = None
    version_count: int = Field(default=0, ge=0)
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class NotebookVersionSummary(_ResourceBase):
    id: UUID
    notebook_id: UUID
    seq: int = Field(ge=1)
    status: NotebookVersionStatus
    created_by: NotebookVersionAuthor
    message: str = ""
    ok: bool | None = None
    cell_count: int = Field(default=0, ge=0)
    run_id: UUID | None = None
    created_at: datetime


class NotebookVersion(NotebookVersionSummary):
    """One immutable revision: the spec, its source, the executed `.ipynb`, the run
    report and the advisory review. `ipynb` is present once a run has finished."""

    spec: NotebookSpec | None = None
    source: str = ""
    ipynb: dict[str, Any] | None = None
    report: ExecutionReport | None = None
    review: NotebookReview | None = None
    error: str = ""
    #: Advisory structure notes for THIS version, mirrored out of `review.warnings` so
    #: a client that renders the notes never has to know they are stored inside the
    #: review blob. Never a reason a version was refused: a user-authored version with
    #: warnings is `ready`, and the warnings render beside it.
    warnings: list[str] = Field(default_factory=list)


class NotebookTurn(_ResourceBase):
    id: UUID
    notebook_id: UUID
    seq: int = Field(ge=1)
    role: NotebookTurnRole
    content: str
    #: The version this turn produced (Nala) or asked for (user), when there is one.
    version_seq: int | None = None
    run_id: UUID | None = None
    created_at: datetime


class NotebookList(_ResourceBase):
    items: list[Notebook]
    next_cursor: UUID | None = None


class NotebookVersionList(_ResourceBase):
    items: list[NotebookVersionSummary]


class NotebookTurnList(_ResourceBase):
    items: list[NotebookTurn]


class NotebookTemplateKind(_ResourceBase):
    id: NotebookKind
    description: str
    structure: list[str]


class NotebookStarter(_ResourceBase):
    id: str
    kind: NotebookKind
    title: str
    brief: str
    #: The audience this starter is written for. Defaults to `engineer` — the default of
    #: `Audience.level` — so a client built before this field keeps working and every
    #: existing starter keeps its meaning. It exists because the starters the product
    #: offered were all newcomer-to-intermediate, which made the far end of the range
    #: (a research-grade notebook) something a reader had to know to ask for.
    level: Literal["newcomer", "engineer", "student", "researcher"] = "engineer"


class NotebookTemplates(_ResourceBase):
    kinds: list[NotebookTemplateKind]
    starters: list[NotebookStarter]
    #: Starter briefs for a whole COURSE (`majorana_contracts.courses`) rather than
    #: one notebook — the composer offers both from this single endpoint. Defaults
    #: to empty so a client built against contracts 2.18.0, which has never heard of
    #: courses, keeps parsing this response unchanged. A course starter's `kind` is
    #: the notebook kind its modules mostly are, a hint for the card, not a promise:
    #: the planner picks each module's kind for itself.
    course_starters: list[NotebookStarter] = Field(default_factory=list)


# --------------------------------------------------------------------------- requests


class CreateNotebookRequest(_ResourceBase):
    brief: str = Field(min_length=1, max_length=8_000)
    kind: NotebookKind | None = None
    title: str | None = Field(default=None, max_length=200)
    audience: Audience | None = None
    style: Style | None = None
    framework: NotebookFramework | None = None
    seeds: list[Seed] = Field(default_factory=list, max_length=8)
    response_locale: Literal["en", "ja"] = "en"


class CreateNotebookResponse(_ResourceBase):
    notebook: Notebook
    version: NotebookVersionSummary
    run_id: UUID


class CreateNotebookTurnRequest(_ResourceBase):
    message: str = Field(min_length=1, max_length=8_000)


class CreateNotebookTurnResponse(_ResourceBase):
    turn: NotebookTurn
    version: NotebookVersionSummary
    run_id: UUID


class GradeAttemptRequest(_ResourceBase):
    """One reader's attempt at the graded cells of a notebook version.

    Only the reader's own work travels: `code` is what they wrote in each exercise
    cell, `answers` what they typed for each question. The assertions and the answer
    key stay on the server and are joined to this on arrival, which is the whole
    reason grading is a request rather than something the browser can do — a grader
    the client holds is a grader the client can read.

    Bounded on both axes because it is an unauthenticated-shaped payload from the
    reader's keyboard: 64 cells, 32 KB per cell. A notebook with more graded cells
    than that is not a lesson.
    """

    code: dict[str, str] = Field(default_factory=dict, max_length=64)
    answers: dict[str, str] = Field(default_factory=dict, max_length=64)

    @model_validator(mode="after")
    def _bounded(self) -> GradeAttemptRequest:
        for name, mapping in (("code", self.code), ("answers", self.answers)):
            for cell_id, value in mapping.items():
                if len(value) > 32_000:
                    raise ValueError(f"{name}[{cell_id}] is over 32000 characters")
        return self


class GradeAttemptResponse(_ResourceBase):
    """The grading run. Verdicts arrive on the run's event stream as
    `notebook.grades`, the same channel every other notebook result uses — grading
    executes the reader's code in the sandbox, so it takes as long as a run takes and
    cannot be answered inline."""

    run_id: UUID
    #: How many cells this attempt will be graded on, so a client can render the
    #: right number of pending rows instead of guessing from its own copy of the spec.
    graded_cells: int


class NotebookGradesSnapshot(_ResourceBase):
    """The score a reader last got on this notebook, restored when they come back.

    Owner ruling ai-ops 260, option 1: a learner's score is kept. Before this it lived
    only in the browser tab that watched the grading run's event stream and was gone the
    moment the tab closed — so a reader who returned to a notebook they had already
    worked through saw an ungraded one, and re-running every exercise was the only way to
    see where they had got to.

    `version_seq` is here rather than left implicit because a score belongs to the
    version it was earned on. A notebook revised since means the reader's verdicts are
    about cells that may no longer exist, and a client that renders them against the
    current version without saying so is showing a stale pass as a current one.
    """

    #: The version the attempt was graded against, which need not be the current one.
    version_seq: int
    stale: bool = False
    grades: GradeReport
    passed: int = Field(ge=0)
    failed: int = Field(ge=0)
    attempted: int = Field(ge=0)
    #: Why nothing could be graded, when that is the answer — a guard refusal, a sandbox
    #: note. Empty on an ordinary wrong answer.
    note: str = ""


class ImportNotebookRequest(_ResourceBase):
    """An existing `.ipynb` becomes a notebook the reader can then edit with Nala."""

    ipynb: dict[str, Any]
    title: str | None = Field(default=None, max_length=200)
    execute: bool = True


class ImportNotebookResponse(_ResourceBase):
    """Import creates a NEW notebook whose first version is the upload; `run_id` is set
    only when `execute` asked for a re-run (queued as version 2)."""

    notebook: Notebook
    version: NotebookVersionSummary
    run_id: UUID | None = None


class RerunNotebookResponse(_ResourceBase):
    version: NotebookVersionSummary
    run_id: UUID


class AuthorNotebookVersionRequest(_ResourceBase):
    """A version the reader wrote themselves.

    Three equivalent ways in, because the same notebook is edited from three places
    and all three must land as one kind of row: `spec` from the in-browser editor,
    `source` from a text editor (the `.nb.py` percent form), `ipynb` from Jupyter
    (`%nala push`). Exactly one of the three — two inputs is a 400, not a silent
    precedence rule, because a client sending both has a bug the server cannot
    resolve in the reader's favour.

    A user-authored version is executed by the same sandbox path Nala's builds use,
    so the version history stays the single truth about what this notebook is.
    """

    spec: NotebookSpec | None = None
    #: The `.nb.py` percent-format authoring text (`leona_notebooks.source`).
    source: str | None = Field(default=None, max_length=400_000)
    ipynb: dict[str, Any] | None = None
    #: The line this edit gets in the version history.
    message: str = Field(default="", max_length=500)
    #: `False` saves the version as `ready` with no report and no run — a draft the
    #: reader has not asked to execute yet.
    execute: bool = True
    #: A cell id: execute cells up to and including it ("Run to here"), reporting the
    #: rest as `not_run`. `None` runs the whole notebook.
    run_until: str | None = None
    #: Whether the worker may reuse a cell's result from the parent version instead of
    #: re-running it, when the dependency graph says nothing that cell reads has
    #: changed (`leona_notebooks.dependencies.plan_run`). Defaults `True` — replay is
    #: the normal path, so an existing client that has never heard of this field keeps
    #: getting the FASTER behaviour rather than silently falling back to a full run.
    #: `False` forces a full fresh run of every cell up to `run_until`, ignoring any
    #: cached result — the escape hatch for "I don't trust the cache" or a deliberate
    #: full re-run through this same route.
    reuse_results: bool = True

    # The exactly-one rule and the `run_until` shape are deliberately NOT enforced by
    # validators here, though both are properties of the request: `services/api` maps a
    # pydantic failure to a bare `422 validation failed` with no message (`app.py`'s
    # RequestValidationError handler), and every way this request can be wrong — two
    # inputs, source that will not parse, a `run_until` naming no cell — is one the
    # reader has to be told about in words before they can fix it. The route enforces
    # all three and answers 400 problem+json carrying the real message;
    # `leona_notebooks.authoring.spec_from_author_request` is the single implementation
    # the route and the worker both call.


class AuthorNotebookVersionResponse(_ResourceBase):
    version: NotebookVersionSummary
    #: `None` when `execute=false` — the version is saved `ready` with no report and
    #: there is no run to follow.
    run_id: UUID | None = None


class UpdateNotebookRequest(_ResourceBase):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    summary: str | None = Field(default=None, max_length=2_000)
