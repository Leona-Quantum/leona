"""Check cells: a structured property of a notebook's result, judged by trusted code.

A `role=check` cell carries a `CheckProperty` (`majorana_contracts.notebooks`). The sandbox
never runs anything the check says. Where the check sits, the composed program calls
`__leona_capture_check__`, which records the SUBJECT as plain data — a circuit as OpenQASM 3,
or a number — and nothing else (`sandbox_program`). After the run, this module judges that
data on the worker, against an expectation that came from the spec and never entered the
untrusted process (plan: ai-ops/desk/leona/plans/platform-vision-20260924/phase-a/DESIGN.md
§1-§2). So no cell can redefine `sqrt` or the reference and move the goalposts.

Five parts:

1. **Expressions** — `evaluate_expression`, an `ast` walk over an allowlist. Never `eval`.
2. **Library references** — `bell`, `ghz(n)`, `qft(n)` …, built here from
   `qiskit.circuit.library`, written by neither the model nor the reader.
3. **Authorship** — `enforce_check_authorship` and `restore_checks` (VISION §5.1): Nala may
   propose a check, only a person accepts one, and a repair may never touch one.
4. **Judgement** — `evaluate_check` and `apply_check_verdicts`: pass / fail / inconclusive,
   with a diagnosis that names the usual mistakes (reversed qubit order, one wrong phase,
   the adjoint). Never "verified" (ADR-0023).
5. **Teeth** — `mutants`: deliberately broken copies of the subject, judged the same way,
   so a check that cannot tell a broken circuit from a correct one says so (VISION §5.2).

Simulation is `majorana_verification`'s and `qiskit.quantum_info`'s; nothing here is a
simulator. Those imports are made inside the functions that need them, so importing this
module for its authorship or text helpers (the API, `source.py`, `ipynb.py`) stays light.
"""

from __future__ import annotations

import ast
import cmath
import hashlib
import json
import math
import re
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from majorana_contracts.notebooks import (
    CHECK_EXPRESSION_CONSTANTS,
    CHECK_EXPRESSION_FUNCTIONS,
    CHECK_STATE_REFERENCE_RE,
    CHECK_UNITARY_REFERENCE_RE,
    MAX_CHECK_EXPRESSION_CHARS,
    MAX_CHECK_VALUE_ENTRIES,
    MAX_CHECK_VERDICT_QASM_CHARS,
    CheckProperty,
    CheckTeeth,
    CheckVerdict,
)

from leona_notebooks.execution import CellResult, ExecutionReport
from leona_notebooks.spec import Cell, CellRole, NotebookSpec

if TYPE_CHECKING:
    import numpy as np
    from qiskit import QuantumCircuit

__all__ = [
    "CHECK_BUDGET_S",
    "MAX_CAPTURE_QASM_CHARS",
    "MAX_CAPTURE_TOTAL_CHARS",
    "MAX_MUTANTS",
    "MUTATION_MAX_QUBITS_STATE",
    "MUTATION_MAX_QUBITS_UNITARY",
    "CheckCapture",
    "ExpressionError",
    "Mutant",
    "apply_check_verdicts",
    "captures_from_observation",
    "captures_from_sandbox_result",
    "check_comment",
    "describe_expectation",
    "describe_property",
    "enforce_check_authorship",
    "evaluate_check",
    "evaluate_expression",
    "mutants",
    "reference_description",
    "restore_checks",
]

# --------------------------------------------------------------------------- limits
#
# The worker is ONE instance running every user's jobs (DESIGN §2.1), and the verification
# ceilings in `majorana_verification.statevector` are sized for one simulation each. A
# mutation batch multiplies that by up to MAX_MUTANTS, hence mutation's own lower caps and
# one wall-clock budget per run. Above a cap the teeth are `not_measured` with the reason;
# nothing is queued for later and nothing cut by a limit is reported as a pass.
#
# Measured 2026-09-25 on an Apple M1 Pro (one Python process, numpy threading at its
# default), each figure the
# verdict plus a full batch of mutants, median of 5 runs (state) or 3 runs (unitary):
#   state check, GHZ-10 + one rz per qubit (20 gates), 31 mutants + 1 equivalent: 0.029 s
#   state check, same shape on 12 qubits (24 gates), 31 mutants + 1 equivalent:    0.050 s
#   unitary check, QFTGate(6) flattened (40 candidates), 32 mutants:                0.089 s
#   unitary check, QFTGate(8) flattened (69 candidates), 32 mutants:                1.197 s
# One `Operator` of a flattened QFT(10) alone took 0.81 s (a single measurement), so a
# 10-qubit unitary batch would be about 26 s — ESTIMATED from that one figure, not run —
# which is over the whole run's budget: hence the 8-qubit unitary cap. The worker's
# Cloud Run CPU was NOT measured and may well be slower; 20 s leaves about 16x headroom
# over the largest batch measured here. Re-measure with
# `pytest packages/py/notebooks/tests/test_checks.py -k timings -s`.

#: One wall-clock budget for judging every check in a run, mutation included.
CHECK_BUDGET_S = 20.0
#: Broken copies tried per check, chosen deterministically (round-robin over operators,
#: evenly spaced within each).
MAX_MUTANTS = 32
#: Widest subject mutation-tested for `state`, `distribution` and `energy` checks.
MUTATION_MAX_QUBITS_STATE = 12
#: Widest subject mutation-tested for `unitary` checks (a unitary is 16 * 4**n bytes).
MUTATION_MAX_QUBITS_UNITARY = 8
#: Largest single captured circuit, in characters of OpenQASM 3. The capture shares the
#: 1 MiB evidence sidecar with figures and hardware requests (`sandbox_program`).
MAX_CAPTURE_QASM_CHARS = 64_000
#: All of one notebook's captured circuits together.
MAX_CAPTURE_TOTAL_CHARS = 128_000
#: Widest circuit the sandbox bothers exporting: `STATEVECTOR_MAX_QUBITS`, restated so the
#: sandbox half of this feature needs no import from the verification package.
MAX_CAPTURE_QUBITS = 24
#: A flattened subject with more gates than this is judged but not mutation-tested.
MUTATION_MAX_GATES = 4_000

_EQUIVALENT_TOLERANCE = 1e-9

# --------------------------------------------------------------------------- expressions


class ExpressionError(ValueError):
    """An amplitude or probability expression the evaluator refuses or cannot compute."""


_BINARY: dict[type, Callable[[complex, complex], complex]] = {
    ast.Add: lambda a, b: a + b,
    ast.Sub: lambda a, b: a - b,
    ast.Mult: lambda a, b: a * b,
    ast.Div: lambda a, b: a / b,
    ast.Pow: lambda a, b: a**b,
}
_UNARY: dict[type, Callable[[complex], complex]] = {
    ast.UAdd: lambda a: a,
    ast.USub: lambda a: -a,
}
_CONSTANTS: dict[str, complex] = {"i": 1j, "j": 1j, "pi": complex(math.pi), "e": complex(math.e)}
_FUNCTIONS: dict[str, Callable[[complex], complex]] = {
    "sqrt": cmath.sqrt,
    "exp": cmath.exp,
    "cos": cmath.cos,
    "sin": cmath.sin,
}
assert set(_CONSTANTS) == CHECK_EXPRESSION_CONSTANTS, "evaluator and contract disagree"
assert set(_FUNCTIONS) == CHECK_EXPRESSION_FUNCTIONS, "evaluator and contract disagree"


def evaluate_expression(text: str | float | int) -> complex:
    """The value of an amplitude/probability expression, as a complex number.

    `ast.parse` in `eval` mode, then a walk that accepts only numbers, `i`/`j`, `pi`, `e`,
    one-argument `sqrt`/`exp`/`cos`/`sin`, `+ - * / **`, unary `+ -` and parentheses.
    Every other node is refused before anything is computed, and nothing is ever passed
    to `eval`. Arithmetic is done on complex numbers from the first constant, so `10**10**10`
    overflows at once instead of building an integer with ten billion digits.
    """
    if isinstance(text, bool):
        raise ExpressionError("a check expression cannot be a boolean")
    if isinstance(text, int | float):
        value = complex(text)
        if not cmath.isfinite(value):
            raise ExpressionError(f"{text!r} is not a finite number")
        return value
    if not isinstance(text, str) or not text.strip():
        raise ExpressionError("an expression must be non-empty text")
    if len(text) > MAX_CHECK_EXPRESSION_CHARS:
        raise ExpressionError(
            f"an expression may be at most {MAX_CHECK_EXPRESSION_CHARS} characters"
        )
    try:
        tree = ast.parse(text.strip(), mode="eval")
    except SyntaxError as exc:
        raise ExpressionError(f"{text!r} does not parse: {exc.msg}") from None

    def walk(node: ast.AST) -> complex:
        if isinstance(node, ast.Expression):
            return walk(node.body)
        if isinstance(node, ast.BinOp) and type(node.op) in _BINARY:
            return _BINARY[type(node.op)](walk(node.left), walk(node.right))
        if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY:
            return _UNARY[type(node.op)](walk(node.operand))
        if isinstance(node, ast.Constant) and type(node.value) in (int, float, complex):
            return complex(node.value)
        if isinstance(node, ast.Name) and node.id in _CONSTANTS:
            return _CONSTANTS[node.id]
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id in _FUNCTIONS
            and len(node.args) == 1
            and not node.keywords
        ):
            return _FUNCTIONS[node.func.id](walk(node.args[0]))
        raise ExpressionError(
            f"{text!r} uses {type(node).__name__}, which a check expression may not; "
            "use numbers, i, pi, e, sqrt(), exp(), cos(), sin() and + - * / **"
        )

    try:
        value = walk(tree)
    except ExpressionError:
        raise
    except (ArithmeticError, ValueError, RecursionError) as exc:
        raise ExpressionError(f"{text!r} cannot be computed: {exc}") from None
    if not cmath.isfinite(value):
        raise ExpressionError(f"{text!r} is not a finite number")
    return value


# --------------------------------------------------------------------------- words


def _ket(bits: str) -> str:
    return f"|{bits}⟩"


def reference_description(reference: str) -> str:
    """A library reference in words, for the page and the verdict."""
    match = re.fullmatch(r"(\w+)\((\d+)\)", reference)
    if reference in {"bell", "bell:phi+"}:
        return "the Bell state (|00⟩ + |11⟩)/√2"
    if reference == "bell:phi-":
        return "the Bell state (|00⟩ − |11⟩)/√2"
    if reference == "bell:psi+":
        return "the Bell state (|01⟩ + |10⟩)/√2"
    if reference == "bell:psi-":
        return "the Bell state (|01⟩ − |10⟩)/√2"
    if match is None:
        return reference
    name, n = match.group(1), int(match.group(2))
    if name == "ghz":
        return f"the {n}-qubit GHZ state ({_ket('0' * n)} + {_ket('1' * n)})/√2"
    if name == "w":
        return f"the {n}-qubit W state (equal weight on each basis state with exactly one 1)"
    if name == "uniform":
        return f"the uniform superposition over {n} qubits"
    if name == "qft":
        return f"Qiskit's QFT on {n} qubits, exact unitary"
    if name == "iqft":
        return f"Qiskit's inverse QFT on {n} qubits, exact unitary"
    return reference


def _mapping_words(mapping: Mapping[str, float | str], label: Callable[[str], str]) -> str:
    items = list(mapping.items())
    shown = [f"{label(key)} = {value}" for key, value in items[:4]]
    more = f", and {len(items) - 4} more" if len(items) > 4 else ""
    return ", ".join(shown) + more


def describe_expectation(prop: CheckProperty) -> str:
    """What the subject is compared with, in words that need no computation."""
    if prop.reference is not None:
        return reference_description(prop.reference)
    if prop.reference_qasm is not None:
        return "the reference circuit written in the check (OpenQASM 3), its " + (
            "output state" if prop.kind == "state" else "unitary"
        )
    if prop.amplitudes is not None:
        return "the amplitudes written in the check: " + _mapping_words(
            prop.amplitudes, lambda key: f"amplitude of {_ket(key)}"
        )
    if prop.probabilities is not None:
        return "the probabilities written in the check: " + _mapping_words(
            prop.probabilities, lambda key: f"P({key})"
        )
    if prop.kind == "energy":
        width = len(next(iter(prop.hamiltonian or {"": 0})))
        if prop.target == "ground":
            return f"the exact ground energy of the check's {width}-qubit Hamiltonian"
        return f"the energy {prop.target} written in the check"
    if isinstance(prop.value, list):
        return f"the {len(prop.value)} numbers written in the check"
    return f"the value {prop.value} written in the check"


def describe_property(prop: CheckProperty) -> str:
    """The check in one line: its own `statement`, or one made from the property."""
    if prop.statement:
        return prop.statement
    if prop.kind == "value":
        shown = (
            ", ".join(f"{v:g}" for v in prop.value[:6]) + (", …" if len(prop.value) > 6 else "")
            if isinstance(prop.value, list)
            else f"{prop.value:g}"
        )
        return (
            f"{prop.subject} equals {'[' + shown + ']' if isinstance(prop.value, list) else shown}"
        )
    what = describe_expectation(prop)
    verbs = {
        "state": "prepares",
        "unitary": "implements",
        "distribution": "measures to",
        "energy": "reaches",
        "value": "equals",
    }
    return f"{prop.subject} {verbs[prop.kind]} {what}"


def check_comment(prop: CheckProperty) -> str:
    """The source of a `role=check` cell: one comment line, rendered from the property.

    The source is never executed, so it is only ever this. Authorship is deliberately NOT
    in it: accepting a check must not change the cell's source, or every save that only
    presses Accept would look like a code change and throw away the run's outputs.
    """
    return f"# check: {describe_property(prop)}\n"


def authorship_words(prop: CheckProperty) -> str:
    """Who wrote the check, for the page and the exported notebook."""
    cited = f", citing {prop.citation}" if prop.citation else ""
    if prop.author == "source":
        return f"from {prop.citation}" + ("" if prop.accepted else ", not yet accepted")
    if prop.author == "user":
        return "written by you" + cited
    return "proposed by Nala" + cited + (", accepted" if prop.accepted else ", not yet accepted")


# --------------------------------------------------------------------------- authorship

Actor = Literal["nala", "user"]


def enforce_check_authorship(
    new: NotebookSpec, parent: NotebookSpec | None, actor: Actor
) -> NotebookSpec:
    """Stamp every check in `new` with who wrote it, compared by cell id with `parent`.

    DESIGN §1.4, one pure function for every path a spec is written by:

    - **actor = nala** (generate, revise, repair): a check Nala emits or changes becomes
      `author="nala"`, `accepted=False`, keeping any citation. Nala cannot promote its own
      check to `source` or to accepted. An unchanged check keeps the parent's author and
      acceptance exactly.
    - **actor = user** (a version the reader authored): a new or changed check becomes
      `author="user"` — or `"source"` when the reader marks it so, which the contract only
      allows with a citation — and `accepted=True`. An unchanged check keeps its author,
      and the reader may set `accepted` (the Accept button). So a Nala check cannot be
      relabelled `source` without changing it.

    "Changed" ignores `author` and `accepted` (`CheckProperty.expectation_key`). Every check
    cell's source is re-rendered from its property, so the comment always says what is
    actually judged.
    """
    before: dict[str, CheckProperty] = {}
    if parent is not None:
        before = {cell.id: cell.property for cell in parent.cells if cell.property is not None}
    cells: list[Cell] = []
    for cell in new.cells:
        prop = cell.property
        if prop is None:
            cells.append(cell)
            continue
        prior = before.get(cell.id)
        unchanged = prior is not None and prior.expectation_key() == prop.expectation_key()
        if actor == "nala":
            if unchanged and prior is not None:
                stamp = {"author": prior.author, "accepted": prior.accepted}
            else:
                stamp = {"author": "nala", "accepted": False}
        elif unchanged and prior is not None:
            stamp = {"author": prior.author, "accepted": prop.accepted}
        else:
            stamp = {"author": "source" if prop.author == "source" else "user", "accepted": True}
        stamped = prop.model_copy(update=stamp)
        cells.append(
            cell.model_copy(update={"property": stamped, "source": check_comment(stamped)})
        )
    return new.with_cells(cells)


def restore_checks(before: NotebookSpec, after: NotebookSpec) -> tuple[NotebookSpec, list[str]]:
    """Undo whatever a repair did to a check: every check cell that existed before comes
    back exactly as it was, by id — edited, relabelled, turned into another kind of cell or
    deleted. Returns the restored spec and the ids that had to be restored.

    A model that wrote both the code and the check would otherwise "fix" a failing check by
    weakening it — the failure VISION §5.1 names. The pipeline also refuses a repair that
    changes a cell's role and prompts the model not to touch checks, but those are the
    model's side of the bargain; this is the side that does not depend on it. A check a
    repair somehow introduced is stamped as Nala's, unaccepted.
    """
    original = {cell.id: cell for cell in before.cells if cell.role == CellRole.CHECK}
    restored: list[str] = []
    cells: list[Cell] = []
    present: set[str] = set()
    for cell in after.cells:
        kept = original.get(cell.id)
        if kept is not None:
            if cell != kept:
                restored.append(cell.id)
            cells.append(kept)
            present.add(cell.id)
        else:
            cells.append(cell)
    order = [cell.id for cell in before.cells]
    for cell_id, cell in original.items():
        if cell_id in present:
            continue
        restored.append(cell_id)
        # Put it back after the nearest cell that preceded it before and still exists.
        position = 0
        for earlier in reversed(order[: order.index(cell_id)]):
            ids = [c.id for c in cells]
            if earlier in ids:
                position = ids.index(earlier) + 1
                break
        cells.insert(position, cell)
    spec = after.with_cells(cells)
    return enforce_check_authorship(spec, before, "nala"), restored


# --------------------------------------------------------------------------- captures

CaptureKind = Literal["circuit", "value", "problem"]


@dataclass(frozen=True)
class CheckCapture:
    """What the sandbox recorded where a check cell sits: plain data, re-validated here.

    The record was filled in while untrusted cell code shared the process, so nothing in
    it is taken on faith: `from_record` bounds every field and turns anything malformed
    into a `problem`. The worker re-parses the OpenQASM and trusts the parse, never the
    qubit count the sandbox wrote down.
    """

    kind: CaptureKind
    qasm: str = ""
    value: float | tuple[float, ...] | None = None
    problem: str = ""
    detail: str = ""

    @classmethod
    def from_circuit(cls, circuit: Any) -> CheckCapture:
        """A capture made outside the sandbox (tests, a local run)."""
        from qiskit import qasm3

        return cls(kind="circuit", qasm=qasm3.dumps(circuit))

    @classmethod
    def from_value(cls, value: float | list[float]) -> CheckCapture:
        if isinstance(value, list):
            return cls(kind="value", value=tuple(float(item) for item in value))
        return cls(kind="value", value=float(value))

    @classmethod
    def from_record(cls, raw: Any) -> CheckCapture:
        if not isinstance(raw, dict):
            return cls(kind="problem", problem="unreadable", detail="no capture was recorded")
        kind = raw.get("kind")
        if kind == "circuit":
            qasm = raw.get("qasm")
            if not isinstance(qasm, str) or not qasm:
                return cls(
                    kind="problem", problem="unreadable", detail="the circuit text is missing"
                )
            qasm = "".join([qasm])  # a plain str, whatever subclass arrived
            if len(qasm) > MAX_CAPTURE_QASM_CHARS:
                return cls(kind="problem", problem="too_large", detail=str(len(qasm)))
            return cls(kind="circuit", qasm=qasm)
        if kind == "value":
            value = raw.get("value")
            if _finite_number(value):
                return cls(kind="value", value=float(value))
            if (
                isinstance(value, list)
                and 0 < len(value) <= MAX_CHECK_VALUE_ENTRIES
                and all(_finite_number(item) for item in value)
            ):
                return cls(kind="value", value=tuple(float(item) for item in value))
            return cls(kind="problem", problem="unreadable", detail="the value is not a number")
        if kind == "problem":
            return cls(
                kind="problem",
                problem=str(raw.get("problem") or "unreadable")[:40],
                detail=str(raw.get("detail") or "")[:300],
            )
        return cls(kind="problem", problem="unreadable", detail="the capture has no kind")


def _finite_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def captures_from_observation(
    observation: dict[str, Any] | None, spec: NotebookSpec
) -> dict[str, CheckCapture]:
    """Every check cell's capture from the protected observation, by cell id.

    The per-notebook ceiling is applied again here across the whole report, as
    `_HardwareReadLedger` does for hardware requests: a capture past it is recorded as a
    problem rather than dropped, so the verdict can say why.
    """
    block = (observation or {}).get("notebook") if isinstance(observation, dict) else None
    if not isinstance(block, dict):
        return {}
    wanted = {cell.id for cell in spec.cells if cell.role == CellRole.CHECK}
    captures: dict[str, CheckCapture] = {}
    total = 0
    for raw in block.get("cells", []) or []:
        if not isinstance(raw, dict) or raw.get("id") not in wanted or "capture" not in raw:
            continue
        if raw.get("capture") is None:
            continue
        capture = CheckCapture.from_record(raw.get("capture"))
        if capture.kind == "circuit":
            if total + len(capture.qasm) > MAX_CAPTURE_TOTAL_CHARS:
                capture = CheckCapture(kind="problem", problem="over_budget")
            else:
                total += len(capture.qasm)
        captures[str(raw["id"])] = capture
    return captures


def captures_from_sandbox_result(result: Any, spec: NotebookSpec) -> dict[str, CheckCapture]:
    """`captures_from_observation` for a `majorana_sandbox.SandboxResult` (duck-typed)."""
    return captures_from_observation(getattr(result, "protected_result", None), spec)


_PROBLEM_WORDS: dict[str, str] = {
    "missing": "There is no variable named `{subject}` when this check runs. Define it in a "
    "cell above the check.",
    "not_a_circuit": "`{subject}` is {detail}, not a Qiskit QuantumCircuit, so {a_kind} check "
    "cannot judge it.",
    "too_wide": "`{subject}` has {detail} qubits; checks simulate at most "
    f"{MAX_CAPTURE_QUBITS}.",
    "unbound_parameters": "`{subject}` still has unbound parameters ({detail}). Bind them "
    "with assign_parameters before the check.",
    "not_exportable": "`{subject}` could not be written as OpenQASM 3 ({detail}), so the "
    "worker had nothing to read.",
    "too_large": "`{subject}` is too long to judge: its OpenQASM is over "
    f"{MAX_CAPTURE_QASM_CHARS:,} characters.",
    "over_budget": "This notebook's checks together captured more than "
    f"{MAX_CAPTURE_TOTAL_CHARS:,} characters of OpenQASM, so this one was left out.",
    "no_qiskit": "Qiskit is not available where the notebook ran, so no circuit could be read.",
    "not_a_number": "`{subject}` is {detail}, not a number or a list of numbers.",
    "not_finite": "`{subject}` holds a value that is not a finite number (NaN or infinity).",
    "too_long": f"`{{subject}}` has more than {MAX_CHECK_VALUE_ENTRIES:,} numbers.",
    "empty": "`{subject}` is an empty list.",
}


def _problem_sentence(prop: CheckProperty, capture: CheckCapture) -> str:
    template = _PROBLEM_WORDS.get(capture.problem)
    if template is None:
        return (
            f"The sandbox could not record `{prop.subject}` ({capture.detail or capture.problem})."
        )
    a_kind = ("an " if prop.kind[0] in "aeiou" else "a ") + prop.kind
    return template.format(subject=prop.subject, detail=capture.detail or "?", a_kind=a_kind)


# --------------------------------------------------------------------------- judgement


class _Inconclusive(Exception):
    """The check cannot judge this subject. Its message is shown to the reader."""


def _basis(prop: CheckProperty) -> Literal["circuit", "value"]:
    return "value" if prop.kind == "value" else "circuit"


def _digits(tolerance: float) -> int:
    return min(12, max(6, math.ceil(-math.log10(tolerance)) + 1 if tolerance > 0 else 12))


def _fidelity(a: np.ndarray, b: np.ndarray) -> float:
    import numpy as np

    return float(abs(np.vdot(a, b)) ** 2)


def _reverse_bits_vector(vector: np.ndarray, n: int) -> np.ndarray:
    return vector.reshape([2] * n).transpose(list(range(n))[::-1]).reshape(-1) if n > 1 else vector


def _reverse_permutation(n: int) -> np.ndarray:
    import numpy as np

    return (
        np.array([int(format(k, f"0{n}b")[::-1], 2) for k in range(2**n)])
        if n
        else np.zeros(1, int)
    )


def _vector_from_mapping(mapping: Mapping[str, float | str], width: int) -> np.ndarray:
    import numpy as np

    vector = np.zeros(2**width, dtype=np.complex128)
    for key, entry in mapping.items():
        vector[int(key, 2)] = evaluate_expression(entry)
    return vector


def _phase_words(angle: float) -> str:
    for denominator in (1, 2, 4, 8):
        for numerator in range(-2 * denominator, 2 * denominator + 1):
            if numerator and math.isclose(angle, math.pi * numerator / denominator, abs_tol=1e-6):
                sign = "−" if numerator < 0 else ""
                top = abs(numerator)
                top_text = "π" if top == 1 else f"{top}π"
                return f"{sign}{top_text}" + ("" if denominator == 1 else f"/{denominator}")
    return f"{angle:.4f} rad"


def _complex_words(value: complex) -> str:
    if abs(value.imag) < 1e-9:
        return f"{value.real:+.4f}"
    if abs(value.real) < 1e-9:
        return f"{value.imag:+.4f}i"
    return f"{value.real:+.4f}{value.imag:+.4f}i"


_REVERSED_WORDS = (
    "It matches with the qubit order reversed. Qiskit writes q0 as the RIGHTMOST character "
    "of a bitstring, so '01' means q0 = 1 and q1 = 0."
)


@dataclass
class _Subject:
    """The parsed subject circuit and what every judgement of it shares."""

    circuit: QuantumCircuit  # as parsed, measurements included
    stripped: QuantumCircuit  # final measurements removed
    qasm: str
    fingerprint: str


@dataclass
class _Judge:
    """One property's expectation, precomputed once, applied to the subject and to every
    mutant alike — so the teeth are measured with exactly the judgement the verdict used."""

    prop: CheckProperty
    checked_against: str
    #: circuit (measurement-stripped) -> behaviour (statevector data or unitary matrix).
    behaviour: Callable[[QuantumCircuit], np.ndarray]
    #: behaviour -> (passed, measure text, score).
    judge: Callable[[np.ndarray], tuple[bool, str]]
    #: behaviour -> diagnosis on a fail.
    diagnose: Callable[[np.ndarray], str]
    unitary: bool = False


def _statevector(circuit: QuantumCircuit) -> np.ndarray:
    import numpy as np
    from qiskit.quantum_info import Statevector

    return np.asarray(Statevector.from_instruction(circuit).data)


def _unitary(circuit: QuantumCircuit) -> np.ndarray:
    import numpy as np
    from qiskit.quantum_info import Operator

    return np.asarray(Operator(circuit).data)


def _parse_subject(qasm: str) -> _Subject:
    from majorana_verification.statevector import (
        StatevectorIncapable,
        _reject_statevector_incapable,
    )
    from qiskit import qasm3

    try:
        circuit = qasm3.loads(qasm)
    except Exception as exc:  # noqa: BLE001 - any parser failure is the check's incapacity
        raise _Inconclusive(f"The worker could not read the circuit's OpenQASM ({exc}).") from None
    if circuit.parameters:
        names = ", ".join(sorted(p.name for p in circuit.parameters)[:5])
        raise _Inconclusive(
            f"The circuit still has unbound parameters ({names}). Bind them with "
            "assign_parameters before the check."
        )
    stripped = circuit.remove_final_measurements(inplace=False)
    try:
        _reject_statevector_incapable(stripped)
    except StatevectorIncapable:
        raise _Inconclusive(
            "This circuit measures or resets a qubit before its end, or uses classical "
            "control flow, so it has no single output state to check."
        ) from None
    normalised = qasm3.dumps(circuit)
    return _Subject(
        circuit=circuit,
        stripped=stripped,
        qasm=qasm,
        fingerprint=hashlib.sha256(normalised.encode("utf-8")).hexdigest(),
    )


def _reference_circuit(reference: str) -> QuantumCircuit:
    """Trusted: built here from `qiskit.circuit.library`, never from user text."""
    if not (
        CHECK_STATE_REFERENCE_RE.match(reference) or CHECK_UNITARY_REFERENCE_RE.match(reference)
    ):
        # The contract refuses these; a property built with `model_copy` skips validation.
        raise _Inconclusive(f"{reference!r} is not a library reference.")
    from qiskit import QuantumCircuit
    from qiskit.circuit.library import QFTGate

    if reference.startswith("bell"):
        variant = reference.split(":", 1)[1] if ":" in reference else "phi+"
        qc = QuantumCircuit(2)
        qc.h(0)
        if variant.endswith("-"):
            qc.z(0)
        qc.cx(0, 1)
        if variant.startswith("psi"):
            qc.x(0)
        return qc
    match = re.fullmatch(r"(\w+)\((\d+)\)", reference)
    if match is None:  # pragma: no cover - the contract's grammar forbids it
        raise _Inconclusive(f"unknown reference {reference!r}")
    name, n = match.group(1), int(match.group(2))
    qc = QuantumCircuit(n)
    if name == "ghz":
        qc.h(0)
        for target in range(1, n):
            qc.cx(0, target)
    elif name == "uniform":
        qc.h(range(n))
    elif name in {"qft", "iqft"}:
        gate = QFTGate(n)
        qc.append(gate.inverse() if name == "iqft" else gate, range(n))
    else:  # pragma: no cover - `w` is built as a vector, not a circuit
        raise _Inconclusive(f"unknown reference {reference!r}")
    return qc


def _reference_state(reference: str) -> np.ndarray:
    import numpy as np

    match = re.fullmatch(r"w\((\d+)\)", reference)
    if match is not None:
        n = int(match.group(1))
        vector = np.zeros(2**n, dtype=np.complex128)
        for qubit in range(n):
            vector[1 << qubit] = 1 / math.sqrt(n)
        return vector
    return _statevector(_reference_circuit(reference))


def _reference_qasm_circuit(qasm: str) -> QuantumCircuit:
    from majorana_verification.statevector import (
        StatevectorIncapable,
        _reject_statevector_incapable,
    )
    from qiskit import qasm3

    try:
        circuit = qasm3.loads(qasm).remove_final_measurements(inplace=False)
    except Exception as exc:  # noqa: BLE001
        raise _Inconclusive(f"The check's reference circuit does not parse ({exc}).") from None
    if circuit.parameters:
        raise _Inconclusive("The check's reference circuit has unbound parameters.")
    try:
        _reject_statevector_incapable(circuit)
    except StatevectorIncapable:
        raise _Inconclusive(
            "The check's reference circuit measures mid-circuit or uses control flow."
        ) from None
    return circuit


def _width_ceiling(prop: CheckProperty) -> tuple[int, str]:
    from majorana_verification.hamiltonian import EXACT_DIAG_MAX_QUBITS
    from majorana_verification.statevector import (
        IDEAL_DISTRIBUTION_MAX_QUBITS,
        STATEVECTOR_MAX_QUBITS,
        UNITARY_MAX_QUBITS,
    )

    return {
        "state": (STATEVECTOR_MAX_QUBITS, "a state check"),
        "unitary": (UNITARY_MAX_QUBITS, "a unitary check"),
        "distribution": (IDEAL_DISTRIBUTION_MAX_QUBITS, "a distribution check"),
        "energy": (EXACT_DIAG_MAX_QUBITS, "an energy check"),
    }[prop.kind]


class _WidthMismatch(Exception):
    """The subject and the expectation are on different numbers of qubits: a real
    disagreement about the program, so a FAIL, never an inconclusive."""


def _state_judge(prop: CheckProperty, subject: _Subject) -> _Judge:
    import numpy as np

    n = subject.stripped.num_qubits
    if prop.amplitudes is not None:
        width = len(next(iter(prop.amplitudes)))
        if width != n:
            raise _WidthMismatch(f"The circuit has {n} qubits; the expected state is on {width}.")
        try:
            expected = _vector_from_mapping(prop.amplitudes, width)
        except ExpressionError as exc:
            raise _Inconclusive(f"The check's amplitudes cannot be read: {exc}") from None
    elif prop.reference is not None:
        expected = _reference_state(prop.reference)
    else:
        expected = _statevector(_reference_qasm_circuit(prop.reference_qasm or ""))
    norm = float(np.vdot(expected, expected).real)
    if not math.isclose(norm, 1.0, abs_tol=1e-6):
        raise _Inconclusive(
            f"The expected amplitudes are not a unit vector (their squared norm is "
            f"{norm:.6g}); write them with the normalisation, for example 1/sqrt(2)."
        )
    width = int(round(math.log2(len(expected))))
    if width != n:
        raise _WidthMismatch(f"The circuit has {n} qubits; the expected state is on {width}.")
    tolerance = float(prop.tolerance or 0.0)
    digits = _digits(tolerance)

    def judge(actual: np.ndarray) -> tuple[bool, str]:
        fidelity = _fidelity(expected, actual)
        passed = fidelity >= 1.0 - tolerance
        return passed, f"fidelity {fidelity:.{digits}f} (needs ≥ {1.0 - tolerance:.{digits}f})"

    def diagnose(actual: np.ndarray) -> str:
        if n > 1 and _fidelity(expected, _reverse_bits_vector(actual, n)) >= 1.0 - tolerance:
            return _REVERSED_WORDS
        return _phase_diagnosis(expected, actual, n)

    return _Judge(
        prop=prop,
        checked_against=describe_expectation(prop) + ", up to global phase",
        behaviour=_statevector,
        judge=judge,
        diagnose=diagnose,
    )


def _phase_diagnosis(expected: np.ndarray, actual: np.ndarray, n: int) -> str:
    """Name the one basis state whose phase is wrong, when the sizes all match."""
    import numpy as np

    sizes_match = bool(np.max(np.abs(np.abs(expected) - np.abs(actual))) <= 1e-6)
    support = [int(k) for k in np.nonzero(np.abs(expected) > 1e-9)[0]]
    if sizes_match and support:
        ratios = {k: actual[k] / expected[k] for k in support}
        ratios = {k: r / abs(r) for k, r in ratios.items() if abs(r) > 1e-12}
        best_anchor, best_wrong = None, None
        for anchor in support:
            if anchor not in ratios:
                continue
            wrong = [k for k, r in ratios.items() if abs(r - ratios[anchor]) > 1e-6]
            if best_wrong is None or len(wrong) < len(best_wrong):
                best_anchor, best_wrong = anchor, wrong
        if best_anchor is not None and best_wrong:
            phase = ratios[best_anchor]
            if len(best_wrong) == 1:
                k = best_wrong[0]
                bits = format(k, f"0{n}b")
                relative = cmath.phase(ratios[k] / phase)
                return (
                    f"Every amplitude has the right size, but {_ket(bits)} has the wrong "
                    f"phase: expected {_complex_words(expected[k] * phase)}, got "
                    f"{_complex_words(actual[k])} (a relative phase of "
                    f"{_phase_words(relative)} on that basis state). Check the sign of a Z, "
                    "S, T or phase gate on the way to it."
                )
            shown = ", ".join(_ket(format(k, f"0{n}b")) for k in best_wrong[:4])
            return (
                "Every amplitude has the right size, but the relative phases differ on "
                f"{len(best_wrong)} basis states ({shown}"
                + (", …" if len(best_wrong) > 4 else "")
                + ")."
            )
    inner = np.vdot(actual, expected)
    phase = inner / abs(inner) if abs(inner) > 1e-12 else 1
    difference = np.abs(expected - phase * actual)
    k = int(np.argmax(difference))
    bits = format(k, f"0{n}b")
    return (
        f"The largest difference is on {_ket(bits)}: expected "
        f"{_complex_words(expected[k])}, got {_complex_words(phase * actual[k])} "
        "(after removing global phase)."
    )


def _unitary_judge(prop: CheckProperty, subject: _Subject) -> _Judge:
    import numpy as np
    from majorana_verification.statevector import _phase_align_distance

    n = subject.stripped.num_qubits
    if prop.reference is not None:
        reference = _unitary(_reference_circuit(prop.reference))
    else:
        reference = _unitary(_reference_qasm_circuit(prop.reference_qasm or ""))
    width = int(round(math.log2(reference.shape[0])))
    if width != n:
        raise _WidthMismatch(f"The circuit has {n} qubits; the reference acts on {width}.")
    tolerance = float(prop.tolerance or 0.0)

    def judge(actual: np.ndarray) -> tuple[bool, str]:
        distance = _phase_align_distance(reference, actual)
        passed = distance <= tolerance
        return passed, (
            f"largest entry of the difference, after removing global phase, "
            f"{distance:.2e} (needs ≤ {tolerance:.2e})"
        )

    def diagnose(actual: np.ndarray) -> str:
        close = lambda candidate: _phase_align_distance(reference, candidate) <= tolerance  # noqa: E731
        if close(actual.conj().T):
            return (
                "It matches the inverse (the adjoint) of the reference. A QFT and an "
                "inverse QFT are easy to swap: check which one this circuit should be, "
                "and the sign of every controlled-phase angle."
            )
        if n > 1:
            perm = _reverse_permutation(n)
            flipped = np.eye(2**n)[perm]
            if close(flipped @ actual) or close(actual @ flipped):
                return (
                    "It matches up to a reversal of the qubit order on one side. A QFT "
                    "written without its final swaps does exactly this."
                )
            if close(flipped @ actual @ flipped):
                return (
                    "It matches with the whole circuit's qubit order reversed. Qiskit "
                    "counts q0 as the least significant qubit."
                )
            if (
                close(flipped @ actual.conj().T @ flipped)
                or close(flipped @ actual.conj().T)
                or close(actual.conj().T @ flipped)
            ):
                return "It matches the inverse of the reference with the qubit order reversed."
        distance = _phase_align_distance(reference, actual)
        return (
            f"It differs from the reference: the largest entry of the difference is {distance:.3g}."
        )

    return _Judge(
        prop=prop,
        checked_against=describe_expectation(prop)
        + ("" if prop.reference is not None else ", exact unitary")
        + " up to global phase",
        behaviour=_unitary,
        judge=judge,
        diagnose=diagnose,
        unitary=True,
    )


def _distribution_judge(prop: CheckProperty, subject: _Subject) -> _Judge:
    import numpy as np
    from majorana_verification.statevector import _keyed_marginal_distribution, measurement_map
    from qiskit.quantum_info import Statevector

    assert prop.probabilities is not None
    width = len(next(iter(prop.probabilities)))
    try:
        expected = {key: evaluate_expression(entry) for key, entry in prop.probabilities.items()}
    except ExpressionError as exc:
        raise _Inconclusive(f"The check's probabilities cannot be read: {exc}") from None
    if any(abs(value.imag) > 1e-12 or value.real < -1e-12 for value in expected.values()):
        raise _Inconclusive("The check's probabilities must be real and not negative.")
    expected_real = {key: value.real for key, value in expected.items()}
    total = sum(expected_real.values())
    if not math.isclose(total, 1.0, abs_tol=1e-6):
        raise _Inconclusive(
            f"The check's probabilities add up to {total:.6g}, not 1. Write them so they sum to 1."
        )
    circuit = subject.circuit
    mapping = measurement_map(circuit)
    if mapping:
        measured = sorted(mapping)
        key_width = width if width == len(measured) else circuit.num_clbits
        if width not in {len(measured), circuit.num_clbits}:
            raise _WidthMismatch(
                f"The circuit reports {circuit.num_clbits} classical bits "
                f"({len(measured)} measured); the check's probabilities have {width}."
            )
    else:
        key_width = circuit.num_qubits
        if width != key_width:
            raise _WidthMismatch(
                f"The circuit has {key_width} qubits and measures none; the check's "
                f"probabilities have {width} bits."
            )
    tolerance = float(prop.tolerance or 0.0)

    def distribution(actual: np.ndarray) -> dict[str, float]:
        state = Statevector(actual)
        if not mapping:
            probabilities = np.abs(actual) ** 2
            return {
                format(k, f"0{key_width}b"): float(p)
                for k, p in enumerate(probabilities)
                if p > 1e-15
            }
        keyed, _ = _keyed_marginal_distribution(
            state,
            mapping,
            num_qubits=circuit.num_qubits,
            num_clbits=circuit.num_clbits,
            width=width,
        )
        return keyed

    def tvd(left: Mapping[str, float], right: Mapping[str, float]) -> float:
        keys = set(left) | set(right)
        return 0.5 * sum(abs(left.get(key, 0.0) - right.get(key, 0.0)) for key in keys)

    def judge(actual: np.ndarray) -> tuple[bool, str]:
        distance = tvd(expected_real, distribution(actual))
        passed = distance <= tolerance
        return passed, f"total variation distance {distance:.2e} (needs ≤ {tolerance:.2e})"

    def diagnose(actual: np.ndarray) -> str:
        observed = distribution(actual)
        flipped = {key[::-1]: value for key, value in observed.items()}
        if width > 1 and tvd(expected_real, flipped) <= tolerance:
            return _REVERSED_WORDS
        keys = sorted(
            set(expected_real) | set(observed),
            key=lambda key: -abs(expected_real.get(key, 0.0) - observed.get(key, 0.0)),
        )
        shown = "; ".join(
            f"P({key}): expected {expected_real.get(key, 0.0):.4f}, got {observed.get(key, 0.0):.4f}"
            for key in keys[:2]
        )
        return f"The largest differences are {shown}."

    return _Judge(
        prop=prop,
        checked_against=describe_expectation(prop) + " (ideal, exact; no sampling)",
        behaviour=_statevector,
        judge=judge,
        diagnose=diagnose,
    )


def _energy_judge(prop: CheckProperty, subject: _Subject) -> _Judge:
    import numpy as np
    from majorana_verification.hamiltonian import hamiltonian_matrix

    assert prop.hamiltonian is not None
    n = subject.stripped.num_qubits
    width = len(next(iter(prop.hamiltonian)))
    if width != n:
        raise _WidthMismatch(f"The circuit has {n} qubits; the Hamiltonian acts on {width}.")
    # Qiskit's convention (q0 is the RIGHTMOST character, as in SparsePauliOp). Passing the
    # strings to `hamiltonian_matrix` unchanged is right for a Qiskit statevector: that
    # module's leftmost character is its most significant Kronecker factor, which is
    # q_{n-1} in Qiskit's indexing. Pinned by `test_energy_uses_qiskit_pauli_order`.
    matrix = hamiltonian_matrix(
        [(coefficient, term) for term, coefficient in prop.hamiltonian.items()]
    )
    spectrum = np.linalg.eigvalsh(matrix)
    ground = float(spectrum[0])
    target = ground if prop.target == "ground" else float(prop.target or 0.0)
    tolerance = float(prop.tolerance or 0.0)

    def energy(actual: np.ndarray) -> float:
        return float(np.vdot(actual, matrix @ actual).real)

    def judge(actual: np.ndarray) -> tuple[bool, str]:
        value = energy(actual)
        passed = abs(value - target) <= tolerance
        return passed, (
            f"energy {value:.6f} against {target:.6f}: difference {abs(value - target):.2e} "
            f"(needs ≤ {tolerance:.2e})"
        )

    def diagnose(actual: np.ndarray) -> str:
        value = energy(actual)
        nearest = float(min(spectrum, key=lambda level: abs(level - value)))
        if prop.target == "ground":
            if abs(nearest - value) <= tolerance and not math.isclose(
                nearest, ground, abs_tol=tolerance
            ):
                return (
                    f"The circuit's energy {value:.6f} matches an EXCITED level, {nearest:.6f}, "
                    f"not the ground energy {ground:.6f}: it prepares an excited state. Widen "
                    "the ansatz or restart the optimiser from other parameters."
                )
            return (
                f"The circuit's energy {value:.6f} is {value - ground:.6f} above the ground "
                f"energy {ground:.6f} and matches no single energy level of this Hamiltonian, "
                "so the state is a superposition of several levels. Check that the circuit "
                "uses the optimised parameters."
            )
        return f"The circuit's energy is {value:.6f}; the check expects {target:.6f}."

    words = (
        f"the exact ground energy of the check's {width}-qubit Hamiltonian, {ground:.6f} "
        "(from diagonalising it)"
        if prop.target == "ground"
        else describe_expectation(prop)
    )
    return _Judge(
        prop=prop,
        checked_against=words,
        behaviour=_statevector,
        judge=judge,
        diagnose=diagnose,
    )


_JUDGES = {
    "state": _state_judge,
    "unitary": _unitary_judge,
    "distribution": _distribution_judge,
    "energy": _energy_judge,
}


@dataclass
class _Judged:
    """A verdict plus what mutation testing needs to reuse, kept off the contract."""

    verdict: CheckVerdict
    judge: _Judge | None = None
    subject: _Subject | None = None
    behaviour: Any = None


def _judge_value(prop: CheckProperty, capture: CheckCapture) -> CheckVerdict:
    expected = prop.value
    actual = capture.value
    tolerance = float(prop.tolerance or 0.0)
    against = describe_expectation(prop) + f", within {tolerance:g}"
    teeth = CheckTeeth(
        status="not_measured",
        reason="A value check has no circuit to break; Leona does not mutate code yet.",
    )
    if isinstance(expected, list) != isinstance(actual, tuple):
        shape = lambda v: (  # noqa: E731
            f"a list of {len(v)} numbers" if isinstance(v, list | tuple) else "one number"
        )
        return CheckVerdict(
            status="fail",
            basis="value",
            checked_against=against,
            detail=f"The code produced {shape(actual)}; the check expects {shape(expected)}.",
            teeth=teeth,
        )
    if isinstance(expected, list):
        assert isinstance(actual, tuple)
        if len(expected) != len(actual):
            return CheckVerdict(
                status="fail",
                basis="value",
                checked_against=against,
                detail=f"The code produced {len(actual)} numbers; the check expects {len(expected)}.",
                teeth=teeth,
            )
        differences = [abs(a - e) for a, e in zip(actual, expected, strict=True)]
        worst = max(differences)
        passed = worst <= tolerance
        detail = ""
        if not passed:
            index = differences.index(worst)
            reversed_ok = all(
                abs(a - e) <= tolerance for a, e in zip(actual[::-1], expected, strict=True)
            )
            detail = (
                "It matches with the list in reverse order."
                if reversed_ok
                else f"Entry {index} is {actual[index]:.6g}; the check expects {expected[index]:.6g}."
            )
    else:
        assert isinstance(actual, float) and expected is not None
        worst = abs(actual - float(expected))
        passed = worst <= tolerance
        detail = (
            "" if passed else f"The code produced {actual:.10g}; the check expects {expected:.10g}."
        )
    return CheckVerdict(
        status="pass" if passed else "fail",
        basis="value",
        checked_against=against,
        measure=f"largest difference {worst:.2e} (needs ≤ {tolerance:.2e})",
        detail=detail,
        teeth=teeth,
    )


def _judge(prop: CheckProperty, capture: CheckCapture) -> _Judged:
    """The verdict without teeth. Never raises: anything unexpected is `inconclusive`."""
    basis = _basis(prop)
    if capture.kind == "problem":
        return _Judged(
            CheckVerdict(
                status="inconclusive",
                basis=basis,
                checked_against=describe_expectation(prop),
                detail=_problem_sentence(prop, capture),
            )
        )
    if prop.kind == "value":
        if capture.kind != "value":
            return _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis="value",
                    detail=f"`{prop.subject}` is not a number or a list of numbers.",
                )
            )
        return _Judged(_judge_value(prop, capture))
    if capture.kind != "circuit":
        return _Judged(
            CheckVerdict(
                status="inconclusive",
                basis="circuit",
                detail=f"`{prop.subject}` is not a Qiskit QuantumCircuit.",
            )
        )
    qasm_shown = capture.qasm if len(capture.qasm) <= MAX_CHECK_VERDICT_QASM_CHARS else None
    subject: _Subject | None = None
    try:
        subject = _parse_subject(capture.qasm)
        ceiling, label = _width_ceiling(prop)
        width = subject.stripped.num_qubits
        if width > ceiling:
            raise _Inconclusive(
                f"The circuit has {width} qubits; {label} simulates at most {ceiling}."
            )
        judge = _JUDGES[prop.kind](prop, subject)
        behaviour = judge.behaviour(subject.stripped)
        passed, measure = judge.judge(behaviour)
        verdict = CheckVerdict(
            status="pass" if passed else "fail",
            basis="circuit",
            checked_against=judge.checked_against,
            measure=measure,
            detail="" if passed else judge.diagnose(behaviour),
            qubits=width,
            subject_fingerprint=subject.fingerprint,
            subject_qasm=qasm_shown,
        )
        return _Judged(verdict, judge=judge, subject=subject, behaviour=behaviour)
    except _WidthMismatch as exc:
        return _Judged(
            CheckVerdict(
                status="fail",
                basis="circuit",
                checked_against=describe_expectation(prop),
                detail=str(exc),
                qubits=subject.stripped.num_qubits if subject else None,
                subject_fingerprint=subject.fingerprint if subject else None,
                subject_qasm=qasm_shown,
            )
        )
    except _Inconclusive as exc:
        return _Judged(
            CheckVerdict(
                status="inconclusive",
                basis="circuit",
                checked_against=describe_expectation(prop),
                detail=str(exc),
                qubits=subject.stripped.num_qubits if subject else None,
                subject_fingerprint=subject.fingerprint if subject else None,
                subject_qasm=qasm_shown,
            )
        )


def evaluate_check(
    prop: CheckProperty,
    capture: CheckCapture,
    *,
    deadline: float | None = None,
    teeth_cache: dict[str, CheckTeeth] | None = None,
) -> CheckVerdict:
    """Judge one check against what the sandbox captured, and, if it passes on a circuit,
    measure its teeth. `deadline` is a `time.monotonic()` value shared by every check in a
    run; `teeth_cache` lets repeated runs of an unchanged subject skip re-mutating it."""
    try:
        judged = _judge(prop, capture)
    except Exception as exc:  # noqa: BLE001 - a bug here must not read as a verdict
        return CheckVerdict(
            status="inconclusive",
            basis=_basis(prop),
            detail=f"The worker could not judge this check ({type(exc).__name__}).",
        )
    return _with_teeth(judged, deadline=deadline, teeth_cache=teeth_cache)


# --------------------------------------------------------------------------- teeth

#: Two-qubit gates whose control and target are not interchangeable. The symmetric ones
#: (cz, cp, swap, rzz, rxx, ryy, iswap) are skipped: swapping their qubits changes nothing.
_ASYMMETRIC_TWO_QUBIT = frozenset(
    {
        "cx",
        "cy",
        "ch",
        "crx",
        "cry",
        "crz",
        "cu",
        "cu1",
        "cu3",
        "cs",
        "csdg",
        "csx",
        "ecr",
        "rzx",
        "dcx",
    }
)
_ADJOINT_PAIRS = {
    "s": "sdg",
    "sdg": "s",
    "t": "tdg",
    "tdg": "t",
    "sx": "sxdg",
    "sxdg": "sx",
    "cs": "csdg",
    "csdg": "cs",
}
_NOT_GATES = frozenset({"barrier", "measure", "reset", "delay", "global_phase"})
MutationOperator = Literal[
    "reverse_qubits", "drop_gate", "swap_control_target", "negate_angle", "adjoint_swap"
]
_OPERATOR_ORDER: tuple[MutationOperator, ...] = (
    "reverse_qubits",
    "drop_gate",
    "swap_control_target",
    "negate_angle",
    "adjoint_swap",
)


@dataclass(frozen=True)
class Mutant:
    """A deliberately broken copy of a subject circuit, and what was broken, in words."""

    operator: MutationOperator
    description: str
    circuit: Any = field(repr=False)


@dataclass(frozen=True)
class _Candidate:
    """A mutant not built yet. Building every possible mutant of a long circuit would copy
    the circuit once per gate; only the chosen few are ever built."""

    operator: MutationOperator
    description: str
    build: Callable[[], Any] = field(repr=False)

    def mutant(self) -> Mutant:
        return Mutant(self.operator, self.description, self.build())


def _flatten(circuit: QuantumCircuit) -> QuantumCircuit:
    """The circuit with every non-standard gate replaced by its definition, recursively, so
    a mutation can break one gate of a `qft` block rather than only drop the whole block.
    Behaviour is unchanged: a definition is exact."""
    from qiskit.circuit import ControlFlowOp
    from qiskit.circuit.library import get_standard_gate_name_mapping

    standard = set(get_standard_gate_name_mapping()) | _NOT_GATES
    out = circuit.copy_empty_like()

    def emit(operation: Any, qubits: list[Any], clbits: list[Any], level: int) -> None:
        definition = getattr(operation, "definition", None)
        if (
            operation.name in standard
            or definition is None
            or isinstance(operation, ControlFlowOp)
            or level > 16
        ):
            out.append(operation, qubits, clbits)
            return
        qmap = dict(zip(definition.qubits, qubits, strict=True))
        cmap = dict(zip(definition.clbits, clbits, strict=True))
        for inner in definition.data:
            emit(
                inner.operation,
                [qmap[q] for q in inner.qubits],
                [cmap[c] for c in inner.clbits],
                level + 1,
            )
        out.global_phase += definition.global_phase

    for instruction in circuit.data:
        emit(instruction.operation, list(instruction.qubits), list(instruction.clbits), 0)
    return out


def _rebuild(
    circuit: QuantumCircuit, replace: Callable[[int, Any], tuple[Any, list[Any]] | None]
) -> QuantumCircuit:
    out = circuit.copy_empty_like()
    for index, instruction in enumerate(circuit.data):
        swapped = replace(index, instruction)
        if swapped is None:
            continue
        operation, qubits = swapped
        out.append(operation, qubits, list(instruction.clbits))
    return out


def _replace_at(
    circuit: QuantumCircuit, target: int, operation: Any | None, *, reverse: bool = False
) -> Callable[[], QuantumCircuit]:
    """A builder for `circuit` with instruction `target` dropped (`operation=None`), given a
    new operation, or given its qubits in reverse order."""

    def build() -> QuantumCircuit:
        def replace(index: int, instruction: Any) -> tuple[Any, list[Any]] | None:
            if index != target:
                return instruction.operation, list(instruction.qubits)
            if reverse:
                return instruction.operation, list(instruction.qubits)[::-1]
            if operation is None:
                return None
            return operation, list(instruction.qubits)

        return _rebuild(circuit, replace)

    return build


def _numeric(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _all_candidates(circuit: QuantumCircuit) -> dict[MutationOperator, list[_Candidate]]:
    """Every mutant each operator can make, in gate order, unbuilt. `circuit` is flattened."""
    groups: dict[MutationOperator, list[_Candidate]] = {name: [] for name in _OPERATOR_ORDER}
    n = circuit.num_qubits

    def qubit_words(instruction: Any) -> str:
        return ", ".join(f"q{circuit.find_bit(q).index}" for q in instruction.qubits)

    gate_number = 0
    for index, instruction in enumerate(circuit.data):
        operation = instruction.operation
        if operation.name in _NOT_GATES:
            continue
        gate_number += 1
        where = f"the {operation.name} on {qubit_words(instruction)}, gate {gate_number}"
        groups["drop_gate"].append(
            _Candidate("drop_gate", f"dropping {where}", _replace_at(circuit, index, None))
        )
        if operation.name in _ASYMMETRIC_TWO_QUBIT and len(instruction.qubits) == 2:
            groups["swap_control_target"].append(
                _Candidate(
                    "swap_control_target",
                    f"swapping control and target of {where}",
                    _replace_at(circuit, index, None, reverse=True),
                )
            )
        for position, parameter in enumerate(operation.params):
            number = _numeric(parameter)
            if number is None or abs(number) <= 1e-9:
                continue
            negated = operation.to_mutable()
            params = list(operation.params)
            params[position] = -number
            negated.params = params
            label = "" if len(operation.params) == 1 else f" (parameter {position + 1})"
            groups["negate_angle"].append(
                _Candidate(
                    "negate_angle",
                    f"negating the {operation.name} angle{label} on "
                    f"{qubit_words(instruction)}, gate {gate_number}",
                    _replace_at(circuit, index, negated),
                )
            )
        if operation.name in _ADJOINT_PAIRS:
            groups["adjoint_swap"].append(
                _Candidate(
                    "adjoint_swap",
                    f"replacing {where} with {_ADJOINT_PAIRS[operation.name]}",
                    _replace_at(circuit, index, operation.inverse()),
                )
            )
    if n > 1 and gate_number:
        order = list(circuit.qubits)

        def reverse(_: int, ins: Any) -> tuple[Any, list[Any]]:
            if ins.operation.name == "measure":
                return ins.operation, list(ins.qubits)  # the readout stays where it was
            return ins.operation, [order[n - 1 - circuit.find_bit(q).index] for q in ins.qubits]

        groups["reverse_qubits"].append(
            _Candidate(
                "reverse_qubits",
                "reversing the qubit order of the whole circuit",
                lambda: _rebuild(circuit, reverse),
            )
        )
    return groups


def _select(groups: dict[MutationOperator, list[_Candidate]], limit: int) -> list[_Candidate]:
    """At most `limit` mutants: quota handed out round-robin over the operators, then taken
    evenly spaced within each operator's gate-ordered list. Deterministic, so the same
    subject always gets the same broken copies and a cached score is reproducible."""
    quota = dict.fromkeys(_OPERATOR_ORDER, 0)
    remaining = limit
    while remaining > 0:
        progressed = False
        for name in _OPERATOR_ORDER:
            if remaining and quota[name] < len(groups[name]):
                quota[name] += 1
                remaining -= 1
                progressed = True
        if not progressed:
            break
    chosen: list[_Candidate] = []
    for name in _OPERATOR_ORDER:
        items, take = groups[name], quota[name]
        if take == len(items):
            chosen.extend(items)
        else:
            chosen.extend(items[(j * len(items)) // take] for j in range(take))
    return chosen


def mutants(circuit: Any, kind: str | None = None, *, limit: int = MAX_MUTANTS) -> list[Mutant]:
    """Deliberately broken copies of `circuit` (DESIGN §2): drop a gate, swap an asymmetric
    two-qubit gate's control and target, negate a nonzero angle, swap s/t/sx for their
    adjoints, reverse the whole circuit's qubit order. Barriers and measurements are never
    mutated. At most `limit`, chosen deterministically. `kind` is accepted for symmetry with
    the checks; every operator applies to every kind of circuit check."""
    del kind
    return [candidate.mutant() for candidate in _select(_all_candidates(_flatten(circuit)), limit)]


def _teeth_key(prop: CheckProperty, fingerprint: str) -> str:
    payload = json.dumps([prop.expectation_key(), fingerprint], sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _with_teeth(
    judged: _Judged,
    *,
    deadline: float | None,
    teeth_cache: dict[str, CheckTeeth] | None,
) -> CheckVerdict:
    verdict = judged.verdict
    if verdict.status != "pass" or verdict.basis != "circuit" or verdict.teeth is not None:
        return verdict
    judge, subject = judged.judge, judged.subject
    if judge is None or subject is None:
        return verdict
    teeth = _measure_teeth(judge, subject, judged.behaviour, deadline=deadline, cache=teeth_cache)
    return verdict.model_copy(update={"teeth": teeth})


def _measure_teeth(
    judge: _Judge,
    subject: _Subject,
    original: Any,
    *,
    deadline: float | None,
    cache: dict[str, CheckTeeth] | None,
) -> CheckTeeth:
    import numpy as np
    from majorana_verification.statevector import _phase_align_distance

    key = _teeth_key(judge.prop, subject.fingerprint)
    if cache is not None and key in cache:
        return cache[key]
    width = subject.stripped.num_qubits
    ceiling = MUTATION_MAX_QUBITS_UNITARY if judge.unitary else MUTATION_MAX_QUBITS_STATE
    if width > ceiling:
        return CheckTeeth(
            status="not_measured",
            reason=(
                f"Too large to mutation-test: {width} qubits, and Leona mutation-tests "
                f"{'unitary' if judge.unitary else 'state'} checks up to {ceiling}."
            ),
        )
    flat = _flatten(subject.circuit)
    gates = sum(1 for ins in flat.data if ins.operation.name not in _NOT_GATES)
    if gates > MUTATION_MAX_GATES:
        return CheckTeeth(
            status="not_measured",
            reason=f"Too large to mutation-test: {gates} gates (the limit is {MUTATION_MAX_GATES}).",
        )
    groups = _all_candidates(flat)
    possible = sum(len(group) for group in groups.values())
    if possible == 0:
        return CheckTeeth(
            status="not_measured",
            reason="This circuit has no gate Leona knows how to break.",
        )
    chosen = _select(groups, MAX_MUTANTS)
    tried = equivalent = caught = 0
    survivors: list[str] = []
    for candidate in chosen:
        if deadline is not None and time.monotonic() > deadline:
            return CheckTeeth(
                status="not_measured",
                reason="The time budget for checks in this run ran out before this one "
                "could be mutation-tested.",
            )
        mutant = candidate.mutant()
        stripped = mutant.circuit.remove_final_measurements(inplace=False)
        try:
            behaviour = judge.behaviour(stripped)
        except Exception:  # noqa: BLE001 - a mutant the simulator refuses is not evidence
            continue
        if judge.unitary:
            same = _phase_align_distance(original, behaviour) <= _EQUIVALENT_TOLERANCE
        else:
            same = float(abs(np.vdot(original, behaviour)) ** 2) >= 1.0 - _EQUIVALENT_TOLERANCE
        if same:
            equivalent += 1
            continue
        tried += 1
        passed, _ = judge.judge(behaviour)
        if passed:
            if len(survivors) < 8:
                survivors.append(mutant.description)
        else:
            caught += 1
    if tried == 0:
        teeth = CheckTeeth(
            status="not_measured",
            reason=(
                "Every broken copy Leona could make behaves exactly like this circuit, so "
                "there was nothing for the check to catch."
            ),
            equivalent=equivalent,
        )
    else:
        reason = (
            f"{len(chosen)} of {possible} possible broken copies were tried, chosen "
            "deterministically."
            if len(chosen) < possible
            else ""
        )
        teeth = CheckTeeth(
            status="measured",
            reason=reason,
            mutants=tried,
            equivalent=equivalent,
            caught=caught,
            survivors=survivors,
        )
    if cache is not None:
        cache[key] = teeth
    return teeth


# --------------------------------------------------------------------------- a whole report


def apply_check_verdicts(
    spec: NotebookSpec,
    report: ExecutionReport,
    captures: Mapping[str, CheckCapture],
    *,
    budget_s: float = CHECK_BUDGET_S,
    teeth_cache: dict[str, CheckTeeth] | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> ExecutionReport:
    """`report` with `CellResult.check` set on every check cell. Blocking and CPU-bound:
    the worker runs it with `asyncio.to_thread`.

    Every verdict is judged first and the teeth second, so one run's budget buys every
    check a verdict before it buys any check a mutation test. A check that did not run
    (skipped, not reached, its capture failed) is `inconclusive` with the reason. Never
    changes `ok` or any cell's `status`: a failing check does not fail the notebook.
    """
    check_cells = {cell.id: cell for cell in spec.cells if cell.role == CellRole.CHECK}
    if not check_cells:
        return report
    deadline = clock() + budget_s
    judged: dict[str, _Judged] = {}
    for result in report.cells:
        cell = check_cells.get(result.id)
        if cell is None or cell.property is None:
            continue
        prop = cell.property
        if result.status in {"not_run", "skipped"}:
            reason = result.note or ("not run" if result.status == "not_run" else "skipped")
            judged[result.id] = _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis=_basis(prop),
                    checked_against=describe_expectation(prop),
                    detail=f"This check did not run: {reason}.",
                )
            )
            continue
        if result.status == "error":
            what = f"{result.error.ename}: {result.error.evalue}" if result.error else "an error"
            judged[result.id] = _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis=_basis(prop),
                    checked_against=describe_expectation(prop),
                    detail=f"Recording `{prop.subject}` failed ({what[:300]}).",
                )
            )
            continue
        capture = captures.get(result.id)
        if capture is None:
            judged[result.id] = _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis=_basis(prop),
                    checked_against=describe_expectation(prop),
                    detail="The sandbox recorded nothing for this check.",
                )
            )
            continue
        if clock() > deadline:
            judged[result.id] = _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis=_basis(prop),
                    checked_against=describe_expectation(prop),
                    detail="The time budget for checks in this run ran out before this one.",
                )
            )
            continue
        try:
            judged[result.id] = _judge(prop, capture)
        except Exception as exc:  # noqa: BLE001 - one broken check must not take the rest
            judged[result.id] = _Judged(
                CheckVerdict(
                    status="inconclusive",
                    basis=_basis(prop),
                    detail=f"The worker could not judge this check ({type(exc).__name__}).",
                )
            )
    verdicts: dict[str, CheckVerdict] = {}
    for cell_id, item in judged.items():
        try:
            verdicts[cell_id] = _with_teeth(item, deadline=deadline, teeth_cache=teeth_cache)
        except Exception as exc:  # noqa: BLE001
            verdicts[cell_id] = item.verdict.model_copy(
                update={
                    "teeth": CheckTeeth(
                        status="not_measured",
                        reason=f"Mutation testing failed on the worker ({type(exc).__name__}).",
                    )
                }
            )
    cells: list[CellResult] = [
        result.model_copy(update={"check": verdicts[result.id]})
        if result.id in verdicts
        else result
        for result in report.cells
    ]
    return report.model_copy(update={"cells": cells})
