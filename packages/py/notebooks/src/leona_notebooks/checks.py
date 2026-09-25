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
import asyncio
import cmath
import contextlib
import hashlib
import json
import logging
import math
import os
import re
import sys
import time
import weakref
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Literal

from majorana_contracts.notebooks import (
    CHECK_EXPRESSION_CONSTANTS,
    CHECK_EXPRESSION_FUNCTIONS,
    CHECK_DISTRIBUTION_MAX_QUBITS,
    CHECK_STATE_MAX_QUBITS,
    CHECK_STATE_REFERENCE_RE,
    CHECK_UNITARY_MAX_QUBITS,
    CHECK_UNITARY_REFERENCE_RE,
    MAX_CHECK_EXPRESSION_CHARS,
    MAX_CHECK_HAMILTONIAN_QUBITS,
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

_log = logging.getLogger("leona_notebooks.checks")

__all__ = [
    "CHECK_BUDGET_S",
    "MAX_CAPTURE_QASM_CHARS",
    "MAX_CAPTURE_TOTAL_CHARS",
    "MAX_MUTANTS",
    "MUTATION_MAX_QUBITS_STATE",
    "MUTATION_MAX_QUBITS_UNITARY",
    "CHECK_MEMORY_HEADROOM_BYTES",
    "CheckCapture",
    "CheckJob",
    "ExpressionError",
    "JudgedCheck",
    "Mutant",
    "QasmUnreadable",
    "Unreadable",
    "apply_check_verdicts",
    "apply_check_verdicts_isolated",
    "captures_from_observation",
    "captures_from_sandbox_result",
    "check_comment",
    "describe_expectation",
    "describe_property",
    "enforce_check_authorship",
    "evaluate_check",
    "evaluate_expression",
    "judge_checks",
    "judge_jobs",
    "merge_check_verdicts",
    "mutants",
    "plan_check_jobs",
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
#: Widest circuit the sandbox bothers exporting: the widest any check judges.
MAX_CAPTURE_QUBITS = CHECK_STATE_MAX_QUBITS
#: How many times the capture decomposes a circuit OpenQASM 3 cannot write (a sub-circuit
#: appended as an instruction) before giving up and calling it not exportable.
MAX_CAPTURE_DECOMPOSE_PASSES = 3
#: A flattened subject with more gates than this is judged but not mutation-tested.
MUTATION_MAX_GATES = 4_000
#: Most gate applications a program may expand to once every gate definition is unrolled
#: and every register-wide call broadcast, counted on the syntax tree BEFORE Qiskit's
#: importer builds anything (`_bound_program`). The importer's cost grows with this count:
#: 4,000 plain gates on 10 qubits (88,021 characters) imported in 0.59 s here, and a
#: 398-character program whose definitions double at each of 12 levels (4,096
#: applications) took 0.36 s (review of PR 1011, which also measured depth 16: 8.2 s).
MAX_EXPANDED_OPERATIONS = MUTATION_MAX_GATES
#: Deepest chain of gate definitions calling one another that is read at all.
MAX_GATE_NESTING = 12
#: Most classical bits a program may declare. A check reads at most 24 bits of outcome.
MAX_DECLARED_CLBITS = 1_024
#: Widest gate call carrying a `ctrl`, `negctrl` or `pow` modifier. Qiskit simulates such
#: a gate as one dense matrix over all its qubits.
MAX_MODIFIED_GATE_QUBITS = MUTATION_MAX_QUBITS_UNITARY
#: Cost guards, applied BEFORE simulating anything (the subject, a reference circuit, a
#: batch of mutants). Work is gates x 2**n for a statevector and gates x 4**n for a
#: unitary. Measured here (M1 Pro, one process) at 10 qubits: about 19 ns per unit of
#: statevector work (2,000 random gates) and about 11 ns per unit of unitary work (100
#: gates). Nothing wider was run (owner's resource rule), so the time these allow is an
#: ESTIMATE from those two figures: about 10 s for a statevector at the limit, about 6 s
#: for a unitary. A 24-qubit GHZ state (24 gates) fits; a 10-qubit unitary gets about 500
#: gates. The child process's wall clock (`CHECK_BUDGET_S`) bounds whatever these miss.
MAX_STATE_WORK = 1 << 29
MAX_UNITARY_WORK = 1 << 29
#: Memory the judging process may use on top of its own footprint after its imports.
#:
#: 64 MiB, because the judge SHARES a 512 MiB container with the process that started it,
#: and over the container's limit Cloud Run kills the whole instance and every job in it,
#: not only the check. The worker is `cpu=1000m, memory=512Mi` (`gcloud run services
#: describe majorana-worker`), and its own process already peaks near 292 MiB: Cloud
#: Monitoring, `run.googleapis.com/container/memory/utilizations`, hourly p99 over the 3
#: days to 2026-09-25, max 57.0% of 512 MiB, median 54% (measured by the coordinator, not
#: here). The judge's footprint after imports was 117 to 123 MiB resident on an M1 Pro
#: (Linux not measured). 512 - 292 - 120 leaves about 100 MiB; 64 keeps a margin for the
#: Linux footprint being larger. The API is 512 MiB too (`API_MEMORY_MI`).
#:
#: Enforced twice: RLIMIT_AS inside the child (Linux only) and the parent reading the
#: child's resident size every 50 ms and killing it (every platform). Each kind's ceiling
#: (`CHECK_*_MAX_QUBITS` in the contract) is sized so its measured or estimated peak fits
#: in this. `LEONA_CHECK_JUDGE_HEADROOM_MB` overrides it for one process.
CHECK_MEMORY_HEADROOM_BYTES = 64 << 20
#: How often the parent reads the child's resident size.
_MEMORY_POLL_S = 0.05


def check_judge_headroom_bytes() -> int:
    """`CHECK_MEMORY_HEADROOM_BYTES`, or `LEONA_CHECK_JUDGE_HEADROOM_MB` when it is set."""
    raw = os.environ.get("LEONA_CHECK_JUDGE_HEADROOM_MB", "").strip()
    if raw:
        try:
            megabytes = int(raw)
        except ValueError:
            _log.warning("LEONA_CHECK_JUDGE_HEADROOM_MB=%r is not a whole number; ignored", raw)
        else:
            if megabytes > 0:
                return megabytes << 20
    return CHECK_MEMORY_HEADROOM_BYTES


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
        what = "output state" if prop.kind == "state" else "unitary"
        return f"the {what} of the reference circuit written in the check (OpenQASM 3)"
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
            return f"the exact ground energy of the {width}-qubit Hamiltonian written in the check"
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
    # No possessives on the variable name: "counts's measured distribution" reads as a typo.
    if prop.kind == "distribution":
        return f"the measured distribution of {prop.subject} matches {what}"
    if prop.kind == "energy":
        return f"the energy of the state {prop.subject} prepares matches {what}"
    verb = "prepares" if prop.kind == "state" else "implements"
    return f"{prop.subject} {verb} {what}"


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

    "Changed" ignores `author` and `accepted` (`CheckProperty.expectation_key`). A check
    whose property matches one the parent had under ANOTHER id is the same check, so
    renaming a cell cannot turn Nala's check into the reader's (review of PR 1011).

    - **actor = user with no parent** (an uploaded `.ipynb`): the file's own claim is
      honoured only when it LOWERS trust. A check the file says is Nala's stays Nala's and
      unaccepted; every other check is the reader's, accepted; a `source` label is not
      taken from a file, since that is exactly the claim a hand-edited export would make.

    Every check cell's source is re-rendered from its property, so the comment always says
    what is actually judged.
    """
    by_id: dict[str, CheckProperty] = {}
    by_key: dict[str, CheckProperty] = {}
    if parent is not None:
        for earlier in parent.cells:
            if earlier.property is not None:
                by_id[earlier.id] = earlier.property
                by_key.setdefault(_expectation_json(earlier.property), earlier.property)
    cells: list[Cell] = []
    for cell in new.cells:
        prop = cell.property
        if prop is None:
            cells.append(cell)
            continue
        prior = by_id.get(cell.id)
        if prior is None or prior.expectation_key() != prop.expectation_key():
            prior = by_key.get(_expectation_json(prop))
        if actor == "nala":
            if prior is not None:
                stamp = {"author": prior.author, "accepted": prior.accepted}
            else:
                stamp = {"author": "nala", "accepted": False}
        elif prior is not None:
            stamp = {"author": prior.author, "accepted": prop.accepted}
        elif parent is None:
            if prop.author == "nala":
                stamp = {"author": "nala", "accepted": False}
            else:
                stamp = {"author": "user", "accepted": True}
        else:
            stamp = {"author": "source" if prop.author == "source" else "user", "accepted": True}
        stamped = prop.model_copy(update=stamp)
        cells.append(
            cell.model_copy(update={"property": stamped, "source": check_comment(stamped)})
        )
    return new.with_cells(cells)


def _expectation_json(prop: CheckProperty) -> str:
    return json.dumps(prop.expectation_key(), sort_keys=True)


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

    def size(self) -> int:
        """Characters this capture takes in the evidence sidecar (its JSON length)."""
        if self.kind == "circuit":
            return len(self.qasm)
        if self.kind == "value":
            value = list(self.value) if isinstance(self.value, tuple) else self.value
            return len(json.dumps(value))
        return 0

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
    records = block.get("cells", [])
    for raw in records if isinstance(records, list) else []:
        try:
            cell_id = raw.get("id") if isinstance(raw, dict) else None
            if not isinstance(cell_id, str) or cell_id not in wanted or cell_id in captures:
                continue
            if raw.get("capture") is None:
                continue
            capture = CheckCapture.from_record(raw.get("capture"))
            # Circuits and values share one budget, as they share one sidecar.
            size = capture.size()
            if total + size > MAX_CAPTURE_TOTAL_CHARS:
                capture = CheckCapture(kind="problem", problem="over_budget")
            else:
                total += size
            captures[cell_id] = capture
        except Exception:  # noqa: BLE001 - one malformed record must not cost the others
            continue
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
    "over_budget": "This notebook's checks together recorded more than "
    f"{MAX_CAPTURE_TOTAL_CHARS:,} characters of circuits and values, so this one was left out.",
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
    a_kind = ("an " if prop.kind[0] in "aeio" else "a ") + prop.kind  # "a unitary"
    return template.format(subject=prop.subject, detail=capture.detail or "?", a_kind=a_kind)


# --------------------------------------------------------------------------- reading OpenQASM


class QasmUnreadable(Exception):
    """An OpenQASM program that does not parse, or that Qiskit's importer refuses.

    `side` says whose program it was: the captured `subject`, or the check's `reference`
    circuit. A notebook check turns this into an `inconclusive` verdict; the connector
    route (`POST /v1/checks/circuit`) answers 400 with `message`, which carries the
    parser's own words (line and column when the grammar was the problem).
    """

    def __init__(self, side: Literal["subject", "reference"], message: str) -> None:
        super().__init__(message)
        self.side = side
        self.message = message


class _Inconclusive(Exception):
    """The check cannot judge this subject. Its message is shown to the reader; `qubits`
    is the subject's width when that is known and is the reason (too wide)."""

    def __init__(self, message: str, *, qubits: int | None = None) -> None:
        super().__init__(message)
        self.qubits = qubits


def _parser_words(exc: BaseException) -> str:
    """The parser's own account of what it could not read, in one line.

    `openqasm3.parse` raises an EMPTY `QASM3ParsingError` for a grammar error: the message
    lives on the ANTLR `RecognitionException` a cause or two down, as the offending token
    and its position. Lexer errors and the importer's refusals carry their text directly.
    Written by the connector lane (`circuit_check.py`, PR 1014) and moved here so the
    route and the worker say the same thing.
    """
    if isinstance(exc, RecursionError):
        return "it nests brackets or expressions too deeply to read"
    text = " ".join(str(exc).split())
    if not text:
        cause: BaseException | None = exc.__cause__
        while cause is not None and not text:
            candidates = [cause, *(arg for arg in cause.args if isinstance(arg, BaseException))]
            for candidate in candidates:
                token = getattr(candidate, "offendingToken", None)
                if token is not None and getattr(token, "line", None) is not None:
                    shown = "end of input" if token.text == "<EOF>" else repr(token.text)
                    text = f"L{token.line}:C{token.column}: unexpected {shown}"
                    break
            cause = cause.__cause__
    return (text or type(exc).__name__)[:500]


_CONTROL_FLOW_NODES = frozenset(
    {
        "BranchingStatement",
        "WhileLoop",
        "ForInLoop",
        "SwitchStatement",
        "Box",
        "BreakStatement",
        "ContinueStatement",
        "EndStatement",
    }
)
_STATEMENT_WORDS = {
    "AliasStatement": "a `let` alias",
    "ClassicalAssignment": "a classical assignment",
    "ConstantDeclaration": "a `const` declaration",
    "ExpressionStatement": "a bare expression",
    "ExternDeclaration": "an `extern` declaration",
    "SubroutineDefinition": "a `def` subroutine",
    "ReturnStatement": "a `return` statement",
    "CalibrationDefinition": "a `defcal` calibration",
    "CalibrationGrammarDeclaration": "a `defcalgrammar` declaration",
    "CalibrationStatement": "a `cal` block",
    "Pragma": "a `pragma`",
}


@dataclass(frozen=True)
class _Bounded:
    """What `_bound_program` read off the syntax tree, before anything was built."""

    program: Any  # openqasm3.ast.Program
    qubits: int
    operations: int


def _bound_program(
    text: str, *, side: Literal["subject", "reference"], max_qubits: int
) -> _Bounded:
    """Parse `text` to a syntax tree and refuse what would be expensive to build.

    Qiskit's importer expands every gate definition eagerly, so a few hundred characters of
    definitions that each call the previous one twice cost it exponential time (review of
    PR 1011: depth 12, 398 characters, 0.36 s; depth 16, 514 characters, 8.2 s). This walks
    the tree instead, counting gate applications by memoised sums over the definitions
    (times broadcast width, times control count), and refuses before the importer runs.
    Only literals it can read off the tree are counted; a size it cannot bound is refused
    rather than guessed. The walk is the connector lane's `_bound_source` (PR 1014), moved
    into the engine so both callers share it.

    Raises `QasmUnreadable` for a program that does not parse, `_Inconclusive` for one a
    check cannot judge.
    """
    import openqasm3
    from openqasm3 import ast

    what = "The circuit" if side == "subject" else "The check's reference circuit"
    try:
        program = openqasm3.parse(text)
    except MemoryError:
        raise
    except Exception as exc:  # noqa: BLE001 - any parser failure is the program's
        raise QasmUnreadable(side, f"{what} does not parse: {_parser_words(exc)}") from None

    registers: dict[str, int] = {}
    gate_sizes: dict[str, int] = {}
    gate_depths: dict[str, int] = {}
    declared = 0
    clbits = 0
    physical = -1
    operations = 0

    def literal(node: Any) -> int | None:
        return node.value if isinstance(node, ast.IntegerLiteral) else None

    def unbounded(words: str) -> _Inconclusive:
        return _Inconclusive(
            f"{what} {words}, so Leona cannot tell how large it is before building it. "
            "Write register sizes and modifier counts as plain numbers."
        )

    def note_physical(operand: Any) -> None:
        nonlocal physical
        name = getattr(operand, "name", None)
        if isinstance(name, str) and name.startswith("$") and name[1:].isdigit():
            physical = max(physical, int(name[1:]))

    def operand_width(operand: Any) -> int:
        note_physical(operand)
        if isinstance(operand, ast.Identifier):
            return registers.get(operand.name, 1)
        if isinstance(operand, ast.IndexedIdentifier):
            single = all(
                isinstance(index, list)
                and len(index) == 1
                and isinstance(index[0], ast.IntegerLiteral)
                for index in operand.indices
            )
            return 1 if single else registers.get(operand.name.name, 1)
        return 1

    def broadcast(operands: Any) -> int:
        return max((operand_width(operand) for operand in operands), default=1)

    def call_cost(node: Any, name: str | None, operands: list[Any], in_gate: bool) -> int:
        base = gate_sizes.get(name, 1) if name is not None else 1
        factor = 1
        for modifier in getattr(node, "modifiers", None) or []:
            kind = modifier.modifier.name
            if kind in {"ctrl", "negctrl"}:
                count = 1 if modifier.argument is None else literal(modifier.argument)
                if count is None:
                    raise unbounded("has a ctrl modifier whose count is not a number")
                factor *= count + 1
            if kind in {"ctrl", "negctrl", "pow"} and len(operands) > MAX_MODIFIED_GATE_QUBITS:
                raise _Inconclusive(
                    f"{what} applies a controlled or powered gate to {len(operands)} qubits. "
                    "Qiskit simulates such a gate as one dense matrix, and Leona builds those "
                    f"up to {MAX_MODIFIED_GATE_QUBITS} qubits."
                )
        return base * factor * (1 if in_gate else broadcast(operands))

    def too_complex() -> _Inconclusive:
        return _Inconclusive(
            f"{what} is too complex to check: it expands to more than "
            f"{MAX_EXPANDED_OPERATIONS:,} gate applications once its gate definitions are "
            "unrolled, or nests them more than "
            f"{MAX_GATE_NESTING} deep."
        )

    def add(count: int) -> None:
        nonlocal operations
        operations += count
        if operations > MAX_EXPANDED_OPERATIONS:
            raise too_complex()

    for statement in program.statements:
        if isinstance(statement, ast.QubitDeclaration):
            size = 1 if statement.size is None else literal(statement.size)
            if size is None:
                raise unbounded("declares a qubit register whose size is not a number")
            registers[statement.qubit.name] = size
            declared += size
    if declared > max_qubits:
        raise _Inconclusive(
            f"{what} has {declared} qubits; this check judges at most {max_qubits}.",
            qubits=declared if side == "subject" else None,
        )

    for statement in program.statements:
        name = type(statement).__name__
        if isinstance(statement, ast.Include | ast.QubitDeclaration | ast.IODeclaration):
            continue  # an input parameter is refused later as unbound, in words
        if isinstance(statement, ast.ClassicalDeclaration):
            if isinstance(statement.type, ast.BitType):
                size = 1 if statement.type.size is None else literal(statement.type.size)
                if size is None:
                    raise unbounded("declares a bit register whose size is not a number")
                clbits += size
                if clbits > MAX_DECLARED_CLBITS:
                    raise _Inconclusive(
                        f"{what} declares {clbits} classical bits; a check reads at most "
                        f"{MAX_DECLARED_CLBITS}."
                    )
                if statement.init_expression is not None:
                    add(1)
            continue
        if isinstance(statement, ast.QuantumGateDefinition):
            size = 0
            depth = 1
            for inner in statement.body:
                if isinstance(inner, ast.QuantumGate):
                    callee = inner.name.name
                    size += call_cost(inner, callee, inner.qubits, True)
                    depth = max(depth, gate_depths.get(callee, 0) + 1)
                elif isinstance(inner, ast.QuantumPhase):
                    size += call_cost(inner, None, inner.qubits, True)
                else:
                    size += 1
                if size > MAX_EXPANDED_OPERATIONS or depth > MAX_GATE_NESTING:
                    raise too_complex()
            gate_sizes[statement.name.name] = max(size, 1)
            gate_depths[statement.name.name] = depth
            continue
        if isinstance(statement, ast.QuantumGate):
            add(call_cost(statement, statement.name.name, statement.qubits, False))
            continue
        if isinstance(statement, ast.QuantumPhase):
            add(call_cost(statement, None, statement.qubits, False))
            continue
        if isinstance(statement, ast.QuantumMeasurementStatement):
            add(broadcast([statement.measure.qubit]))
            continue
        if isinstance(statement, ast.QuantumReset):
            add(broadcast([statement.qubits]))
            continue
        if isinstance(statement, ast.QuantumBarrier | ast.DelayInstruction):
            add(broadcast(statement.qubits))
            continue
        if name in _CONTROL_FLOW_NODES:
            raise _Inconclusive(
                f"{what} uses classical control flow (if, while, for, switch or box), so it "
                "has no single output state to check."
            )
        raise _Inconclusive(
            f"{what} uses {_STATEMENT_WORDS.get(name, name)}, which a circuit check does "
            "not read. Write the circuit as Qiskit's qasm3.dumps writes it."
        )
    width = declared + (physical + 1)
    if width > max_qubits:
        raise _Inconclusive(
            f"{what} has {width} qubits; this check judges at most {max_qubits}.",
            qubits=width if side == "subject" else None,
        )
    return _Bounded(program=program, qubits=width, operations=operations)


def _convert(bounded: _Bounded, *, side: Literal["subject", "reference"]) -> QuantumCircuit:
    """Build the circuit from an already-bounded tree with Qiskit's importer."""
    from qiskit_qasm3_import import convert

    what = "The circuit" if side == "subject" else "The check's reference circuit"
    try:
        return convert(bounded.program)
    except MemoryError:
        raise
    except Exception as exc:  # noqa: BLE001 - the importer's refusal is the program's
        raise QasmUnreadable(
            side, f"{what} could not be read by Qiskit's importer: {_parser_words(exc)}"
        ) from None


def _without_leading_resets(circuit: QuantumCircuit) -> QuantumCircuit:
    """The circuit without any reset that comes before every other operation on its qubit.

    A reset on a fresh qubit does nothing (the qubit is already |0⟩), and some builders
    and exporters write one at the top. Only those are removed: a reset after anything
    has touched its qubit is real, and the incapacity rule still refuses it.
    """
    touched: set[int] = set()
    kept = circuit.copy_empty_like()
    changed = False
    for instruction in circuit.data:
        indices = [circuit.find_bit(qubit).index for qubit in instruction.qubits]
        if instruction.operation.name == "reset" and not touched.intersection(indices):
            changed = True
            continue
        if instruction.operation.name != "barrier":
            touched.update(indices)
        kept.append(instruction.operation, list(instruction.qubits), list(instruction.clbits))
    return kept if changed else circuit


def _load(
    text: str, *, side: Literal["subject", "reference"], max_qubits: int
) -> tuple[QuantumCircuit, QuantumCircuit]:
    """(the circuit, the circuit without its final measurements), bounded, built and
    checked for the statevector path's incapacities, in that order."""
    from majorana_verification.statevector import (
        StatevectorIncapable,
        _reject_statevector_incapable,
    )

    what = "The circuit" if side == "subject" else "The check's reference circuit"
    bounded = _bound_program(text, side=side, max_qubits=max_qubits)
    circuit = _convert(bounded, side=side)
    if circuit.num_qubits > max_qubits:  # the tree's count is an estimate; this is exact
        raise _Inconclusive(
            f"{what} has {circuit.num_qubits} qubits; this check judges at most {max_qubits}.",
            qubits=circuit.num_qubits if side == "subject" else None,
        )
    circuit = _without_leading_resets(circuit)
    if circuit.parameters:
        names = ", ".join(sorted(p.name for p in circuit.parameters)[:5])
        raise _Inconclusive(
            f"{what} still has unbound parameters ({names}). Bind them with "
            "assign_parameters before the check."
        )
    stripped = circuit.remove_final_measurements(inplace=False)
    try:
        _reject_statevector_incapable(stripped)
    except StatevectorIncapable:
        raise _Inconclusive(
            f"{what} measures or resets a qubit before its end, or uses classical control "
            "flow, so it has no single output state to check."
        ) from None
    return circuit, stripped


def _gate_count(circuit: QuantumCircuit) -> int:
    return sum(1 for item in circuit.data if item.operation.name not in {"barrier", "measure"})


def _work(circuit: QuantumCircuit, *, unitary: bool) -> int:
    """The cost guard's unit: gates x 2**n for a statevector, gates x 4**n for a unitary."""
    return max(_gate_count(circuit), 1) * (4 if unitary else 2) ** circuit.num_qubits


def _guard_cost(circuit: QuantumCircuit, *, unitary: bool, what: str = "The circuit") -> None:
    limit = MAX_UNITARY_WORK if unitary else MAX_STATE_WORK
    if _work(circuit, unitary=unitary) > limit:
        raise _Inconclusive(
            f"{what} is too large to check in the time Leona gives one check: "
            f"{circuit.num_qubits} qubits and {_gate_count(circuit):,} gates"
            + (" for an exact unitary." if unitary else ".")
        )


# --------------------------------------------------------------------------- judgement


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

    circuit: QuantumCircuit  # as built, measurements included, leading resets removed
    stripped: QuantumCircuit  # final measurements removed
    qasm: str
    fingerprint: str


@dataclass
class _Judge:
    """One property's expectation, precomputed once, applied to the subject and to every
    mutant alike, so the teeth are measured with exactly the judgement the verdict used."""

    prop: CheckProperty
    checked_against: str
    #: circuit (measurement-stripped) -> behaviour (statevector data or unitary matrix).
    behaviour: Callable[[QuantumCircuit], np.ndarray]
    #: behaviour -> (passed, measure text).
    judge: Callable[[np.ndarray], tuple[bool, str]]
    #: behaviour -> diagnosis on a fail.
    diagnose: Callable[[np.ndarray], str]
    #: (original behaviour, mutant behaviour) -> whether NO check of this kind could tell
    #: them apart. Such a mutant is excluded from the teeth, not counted against the check.
    same: Callable[[np.ndarray, np.ndarray], bool]
    unitary: bool = False


def _same_state(a: np.ndarray, b: np.ndarray) -> bool:
    return _fidelity(a, b) >= 1.0 - _EQUIVALENT_TOLERANCE


def _statevector(circuit: QuantumCircuit) -> np.ndarray:
    import numpy as np
    from qiskit.quantum_info import Statevector

    return np.asarray(Statevector.from_instruction(circuit).data)


def _unitary(circuit: QuantumCircuit) -> np.ndarray:
    import numpy as np
    from qiskit.quantum_info import Operator

    return np.asarray(Operator(circuit).data)


def _load_subject(qasm: str, *, max_qubits: int) -> _Subject:
    from qiskit import qasm3

    circuit, stripped = _load(qasm, side="subject", max_qubits=max_qubits)
    normalised = qasm3.dumps(circuit)
    return _Subject(
        circuit=circuit,
        stripped=stripped,
        qasm=qasm,
        fingerprint=hashlib.sha256(normalised.encode("utf-8")).hexdigest(),
    )


_LIBRARY_WIDTH = re.compile(r"^(?:ghz|w|uniform|qft|iqft)\((\d+)\)$")


def _library_width(reference: str) -> int:
    match = _LIBRARY_WIDTH.match(reference)
    return int(match.group(1)) if match else 2  # bell and its variants


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


def _kind_ceiling(prop: CheckProperty, width_caps: Mapping[str, int] | None) -> int:
    """The widest subject this check judges: the kind's own ceiling, lowered (never
    raised) by a caller's cap. The connector route passes lower caps, because its instance
    has 512 MiB in all."""
    ceiling = {
        "state": CHECK_STATE_MAX_QUBITS,
        "distribution": CHECK_DISTRIBUTION_MAX_QUBITS,
        "energy": MAX_CHECK_HAMILTONIAN_QUBITS,
        "unitary": CHECK_UNITARY_MAX_QUBITS,
    }[prop.kind]
    if width_caps and prop.kind in width_caps:
        ceiling = min(ceiling, int(width_caps[prop.kind]))
    return ceiling


class _WidthMismatch(Exception):
    """The subject and the expectation are on different numbers of qubits: a real
    disagreement about the program, so a FAIL, never an inconclusive."""


def _expected_width(prop: CheckProperty) -> tuple[int | None, _Bounded | None]:
    """How many qubits the expectation is on, read WITHOUT building it: from the library
    name, the bitstring length, the Pauli string, or the reference program's syntax tree.
    `None` for a distribution, whose width is a question about classical bits."""
    if prop.kind == "distribution":
        return None, None
    if prop.amplitudes is not None:
        return len(next(iter(prop.amplitudes))), None
    if prop.hamiltonian is not None:
        return len(next(iter(prop.hamiltonian))), None
    if prop.reference is not None:
        return _library_width(prop.reference), None
    ceiling = CHECK_UNITARY_MAX_QUBITS if prop.kind == "unitary" else CHECK_STATE_MAX_QUBITS
    bounded = _bound_program(prop.reference_qasm or "", side="reference", max_qubits=ceiling)
    return bounded.qubits, bounded


def _reference_program(bounded: _Bounded | None, *, unitary: bool) -> QuantumCircuit:
    """The check's own reference circuit, built from its already-bounded tree."""
    from majorana_verification.statevector import (
        StatevectorIncapable,
        _reject_statevector_incapable,
    )

    assert bounded is not None
    what = "The check's reference circuit"
    circuit = _without_leading_resets(_convert(bounded, side="reference"))
    if circuit.parameters:
        raise _Inconclusive(f"{what} has unbound parameters.")
    circuit = circuit.remove_final_measurements(inplace=False)
    try:
        _reject_statevector_incapable(circuit)
    except StatevectorIncapable:
        raise _Inconclusive(f"{what} measures mid-circuit or uses control flow.") from None
    _guard_cost(circuit, unitary=unitary, what=what)
    return circuit


def _state_judge(prop: CheckProperty, subject: _Subject, bounded: _Bounded | None) -> _Judge:
    import numpy as np

    n = subject.stripped.num_qubits
    if prop.amplitudes is not None:
        try:
            expected = _vector_from_mapping(prop.amplitudes, n)
        except ExpressionError as exc:
            raise _Inconclusive(f"The check's amplitudes cannot be read: {exc}") from None
    elif prop.reference is not None:
        expected = _reference_state(prop.reference)
    else:
        expected = _statevector(_reference_program(bounded, unitary=False))
    norm = float(np.vdot(expected, expected).real)
    if not math.isclose(norm, 1.0, abs_tol=1e-6):
        raise _Inconclusive(
            f"The expected amplitudes are not a unit vector (their squared norm is "
            f"{norm:.6g}). Write them with the normalisation, for example 1/sqrt(2)."
        )
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
        same=_same_state,
    )


def _phase_diagnosis(expected: np.ndarray, actual: np.ndarray, n: int) -> str:
    """Name the one basis state whose phase is wrong, when the sizes all match.

    Vectorised: the first version built a Python dict entry per amplitude and compared
    every anchor with every other (239 bytes and O(m**2) work per amplitude; a wide
    state check would have used gigabytes and hours). The phase most basis states share
    is found by rounding the phases to a grid and taking the most common value.
    """
    import numpy as np

    sizes_match = bool(np.max(np.abs(np.abs(expected) - np.abs(actual))) <= 1e-6)
    support = np.flatnonzero(np.abs(expected) > 1e-9)
    if sizes_match and support.size:
        ratios = actual[support] / expected[support]
        magnitudes = np.abs(ratios)
        usable = magnitudes > 1e-12
        support, ratios = support[usable], ratios[usable] / magnitudes[usable]
        if support.size:
            grid = np.round(np.angle(ratios) / 1e-6).astype(np.int64)
            values, counts = np.unique(grid, return_counts=True)
            # On a tie, the phase of the lowest basis state wins, so |0...0> is the anchor
            # and the state that differs from it is the one named.
            shared = values[counts == counts.max()]
            common = ratios[np.flatnonzero(np.isin(grid, shared))[0]]
            wrong = support[np.abs(ratios - common) > 1e-6]
            if wrong.size == 1:
                k = int(wrong[0])
                bits = format(k, f"0{n}b")
                relative = cmath.phase(complex(actual[k] / expected[k]) / complex(common))
                return (
                    f"Every amplitude has the right size, but {_ket(bits)} has the wrong "
                    f"phase: expected {_complex_words(complex(expected[k] * common))}, got "
                    f"{_complex_words(complex(actual[k]))} (a relative phase of "
                    f"{_phase_words(relative)} on that basis state). Check the sign of a Z, "
                    "S, T or phase gate on the way to it."
                )
            if wrong.size:
                shown = ", ".join(_ket(format(int(k), f"0{n}b")) for k in wrong[:4])
                return (
                    "Every amplitude has the right size, but the relative phases differ on "
                    f"{wrong.size} basis states ({shown}" + (", …" if wrong.size > 4 else "") + ")."
                )
    inner = np.vdot(actual, expected)
    phase = inner / abs(inner) if abs(inner) > 1e-12 else 1
    k = int(np.argmax(np.abs(expected - phase * actual)))
    bits = format(k, f"0{n}b")
    return (
        f"The largest difference is on {_ket(bits)}: expected "
        f"{_complex_words(complex(expected[k]))}, got {_complex_words(complex(phase * actual[k]))} "
        "(after removing global phase)."
    )


def _unitary_judge(prop: CheckProperty, subject: _Subject, bounded: _Bounded | None) -> _Judge:
    from majorana_verification.statevector import _phase_align_distance

    n = subject.stripped.num_qubits
    if prop.reference is not None:
        reference = _unitary(_reference_circuit(prop.reference))
    else:
        reference = _unitary(_reference_program(bounded, unitary=True))
    tolerance = float(prop.tolerance or 0.0)

    def judge(actual: np.ndarray) -> tuple[bool, str]:
        distance = _phase_align_distance(reference, actual)
        passed = distance <= tolerance
        return passed, (
            f"largest entry of the difference, after removing global phase, "
            f"{distance:.2e} (needs ≤ {tolerance:.2e})"
        )

    def diagnose(actual: np.ndarray) -> str:
        # Row and column permutations by indexing, never by multiplying 2**n x 2**n
        # permutation matrices: that is 8**n work per candidate (review of PR 1011).
        def close(candidate: np.ndarray) -> bool:
            return _phase_align_distance(reference, candidate) <= tolerance

        adjoint = actual.conj().T
        if close(adjoint):
            return (
                "It matches the inverse (the adjoint) of the reference. A QFT and an "
                "inverse QFT are easy to swap. Check which one this circuit should be, "
                "and the sign of every controlled-phase angle."
            )
        if n > 1:
            perm = _reverse_permutation(n)
            if close(actual[perm, :]) or close(actual[:, perm]):
                return (
                    "It matches up to a reversal of the qubit order on one side. A QFT "
                    "written without its final swaps does exactly this."
                )
            if close(actual[perm][:, perm]):
                return (
                    "It matches with the whole circuit's qubit order reversed. Qiskit "
                    "counts q0 as the least significant qubit."
                )
            if close(adjoint[perm][:, perm]) or close(adjoint[perm, :]) or close(adjoint[:, perm]):
                return "It matches the inverse of the reference with the qubit order reversed."
        distance = _phase_align_distance(reference, actual)
        return (
            f"It differs from the reference: the largest entry of the difference is {distance:.3g}."
        )

    def same(a: np.ndarray, b: np.ndarray) -> bool:
        return _phase_align_distance(a, b) <= _EQUIVALENT_TOLERANCE

    return _Judge(
        prop=prop,
        checked_against=describe_expectation(prop)
        + ("" if prop.reference is not None else ", exact unitary")
        + " up to global phase",
        behaviour=_unitary,
        judge=judge,
        diagnose=diagnose,
        same=same,
        unitary=True,
    )


def _distribution_judge(prop: CheckProperty, subject: _Subject, bounded: _Bounded | None) -> _Judge:
    import numpy as np
    from majorana_verification.statevector import _keyed_marginal_distribution, measurement_map
    from qiskit.quantum_info import Statevector

    del bounded
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
                f"({len(measured)} measured). The check's probabilities have {width}."
            )
    else:
        key_width = circuit.num_qubits
        if width != key_width:
            raise _WidthMismatch(
                f"The circuit has {key_width} qubits and measures none. The check's "
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

    def same(a: np.ndarray, b: np.ndarray) -> bool:
        # A mutant that leaves the MEASURED distribution unchanged (a phase no measurement
        # sees, a gate on a qubit nobody measures) cannot be caught by any distribution
        # check, so it is equivalent here, even though its state differs (review of PR 1011).
        return tvd(distribution(a), distribution(b)) <= _EQUIVALENT_TOLERANCE

    return _Judge(
        prop=prop,
        checked_against=describe_expectation(prop) + " (ideal, exact; no sampling)",
        behaviour=_statevector,
        judge=judge,
        diagnose=diagnose,
        same=same,
    )


def _energy_judge(prop: CheckProperty, subject: _Subject, bounded: _Bounded | None) -> _Judge:
    import numpy as np
    from qiskit.quantum_info import SparsePauliOp

    del bounded
    assert prop.hamiltonian is not None
    width = len(next(iter(prop.hamiltonian)))
    # Qiskit's convention (q0 is the RIGHTMOST character), so `SparsePauliOp` takes the
    # strings unchanged. It gives the same matrix as `majorana_verification.hamiltonian`
    # (checked in `test_energy_uses_qiskit_pauli_order`) in 0.012 s instead of 2.8 s for the
    # contract's widest Hamiltonian (10 qubits, 256 terms; measured on an M1 Pro).
    matrix = SparsePauliOp.from_list(list(prop.hamiltonian.items())).to_matrix()
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
                    f"not the ground energy {ground:.6f}. It prepares an excited state. Widen "
                    "the ansatz or restart the optimiser from other parameters."
                )
            return (
                f"The circuit's energy {value:.6f} is {value - ground:.6f} above the ground "
                f"energy {ground:.6f} and matches no single energy level of this Hamiltonian, "
                "so the state is a superposition of several levels. Check that the circuit "
                "uses the optimised parameters."
            )
        return f"The circuit's energy is {value:.6f}. The check expects {target:.6f}."

    words = (
        f"the exact ground energy of the {width}-qubit Hamiltonian written in the check, "
        f"{ground:.6f} (from diagonalising it)"
        if prop.target == "ground"
        else describe_expectation(prop)
    )
    return _Judge(
        prop=prop,
        checked_against=words,
        behaviour=_statevector,
        judge=judge,
        diagnose=diagnose,
        same=_same_state,
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
    unreadable: Unreadable | None = None


def _judge_value(prop: CheckProperty, capture: CheckCapture) -> CheckVerdict:
    expected = prop.value
    actual = capture.value
    tolerance = float(prop.tolerance or 0.0)
    against = describe_expectation(prop) + f", within {tolerance:g}"
    teeth = CheckTeeth(
        status="not_measured",
        reason="A value check has no circuit to break, and Leona does not break code yet.",
    )
    if isinstance(expected, list) != isinstance(actual, tuple):

        def shape(value: Any) -> str:
            return (
                f"a list of {len(value)} numbers"
                if isinstance(value, list | tuple)
                else "one number"
            )

        return CheckVerdict(
            status="fail",
            basis="value",
            checked_against=against,
            detail=f"The code produced {shape(actual)}. The check expects {shape(expected)}.",
            teeth=teeth,
        )
    if isinstance(expected, list):
        assert isinstance(actual, tuple)
        if len(expected) != len(actual):
            return CheckVerdict(
                status="fail",
                basis="value",
                checked_against=against,
                detail=f"The code produced {len(actual)} numbers. The check expects {len(expected)}.",
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
                else f"Entry {index} is {actual[index]:.6g}. The check expects {expected[index]:.6g}."
            )
    else:
        assert isinstance(actual, float) and expected is not None
        worst = abs(actual - float(expected))
        passed = worst <= tolerance
        detail = (
            "" if passed else f"The code produced {actual:.10g}. The check expects {expected:.10g}."
        )
    return CheckVerdict(
        status="pass" if passed else "fail",
        basis="value",
        checked_against=against,
        measure=f"largest difference {worst:.2e} (needs ≤ {tolerance:.2e})",
        detail=detail,
        teeth=teeth,
    )


_OUT_OF_MEMORY_WORDS = (
    "Leona ran out of memory while checking this, so it stopped. The circuit is too large "
    "for the memory one check is given."
)


def _judge(
    prop: CheckProperty, capture: CheckCapture, *, width_caps: Mapping[str, int] | None = None
) -> _Judged:
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

    def inconclusive(detail: str, qubits: int | None = None) -> CheckVerdict:
        return CheckVerdict(
            status="inconclusive",
            basis="circuit",
            checked_against=describe_expectation(prop),
            detail=detail,
            qubits=subject.stripped.num_qubits if subject else qubits,
            subject_fingerprint=subject.fingerprint if subject else None,
            subject_qasm=qasm_shown,
        )

    try:
        # Order matters, and each step is cheap next to the one after it: read the subject
        # off its syntax tree and bound it, build it, compare widths WITHOUT building the
        # expectation, guard the simulation's cost, and only then simulate anything.
        subject = _load_subject(capture.qasm, max_qubits=_kind_ceiling(prop, width_caps))
        width = subject.stripped.num_qubits
        expected_width, bounded = _expected_width(prop)
        if expected_width is not None and expected_width != width:
            what = "the Hamiltonian acts on" if prop.kind == "energy" else "the expectation is on"
            raise _WidthMismatch(f"The circuit has {width} qubits, and {what} {expected_width}.")
        _guard_cost(subject.stripped, unitary=prop.kind == "unitary")
        judge = _JUDGES[prop.kind](prop, subject, bounded)
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
    except QasmUnreadable as exc:
        return _Judged(inconclusive(exc.message), unreadable=Unreadable(exc.side, exc.message))
    except _Inconclusive as exc:
        return _Judged(inconclusive(str(exc), exc.qubits))
    except MemoryError:
        return _Judged(inconclusive(_OUT_OF_MEMORY_WORDS))


def evaluate_check(
    prop: CheckProperty,
    capture: CheckCapture,
    *,
    deadline: float | None = None,
    teeth_cache: dict[str, CheckTeeth] | None = None,
    width_caps: Mapping[str, int] | None = None,
) -> CheckVerdict:
    """Judge one check in THIS process, and, if it passes on a circuit, measure its teeth.

    For tests and local tools. The worker and the connector route never call this
    directly: they go through `judge_checks`, which runs the same code in a child process
    that can be killed. `deadline` is a `time.monotonic()` value shared by every check in
    a run; `teeth_cache` lets repeated runs of an unchanged subject skip re-mutating it."""
    try:
        judged = _judge(prop, capture, width_caps=width_caps)
    except Exception as exc:  # noqa: BLE001 - a bug here must not read as a verdict
        return CheckVerdict(
            status="inconclusive",
            basis=_basis(prop),
            detail=f"Leona could not judge this check ({type(exc).__name__}).",
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
    clock: Callable[[], float] = time.monotonic,
) -> CheckTeeth:
    key = _teeth_key(judge.prop, subject.fingerprint)
    if cache is not None and key in cache:
        return cache[key]
    width = subject.stripped.num_qubits
    ceiling = MUTATION_MAX_QUBITS_UNITARY if judge.unitary else MUTATION_MAX_QUBITS_STATE
    if width > ceiling:
        return CheckTeeth(
            status="not_measured",
            reason=(
                f"Too large to test with broken copies: {width} qubits, and Leona does this "
                f"for {'unitary' if judge.unitary else 'state'} checks up to {ceiling}."
            ),
        )
    if MAX_MUTANTS * _work(subject.stripped, unitary=judge.unitary) > (
        MAX_UNITARY_WORK if judge.unitary else MAX_STATE_WORK
    ):
        return CheckTeeth(
            status="not_measured",
            reason=(
                f"Too large to test with broken copies in the time one check gets: "
                f"{MAX_MUTANTS} copies of {_gate_count(subject.stripped):,} gates on "
                f"{width} qubits."
            ),
        )
    flat = _flatten(subject.circuit)
    gates = sum(1 for ins in flat.data if ins.operation.name not in _NOT_GATES)
    if gates > MUTATION_MAX_GATES:
        return CheckTeeth(
            status="not_measured",
            reason=(
                f"Too large to test with broken copies: {gates:,} gates "
                f"(the limit is {MUTATION_MAX_GATES:,})."
            ),
        )
    groups = _all_candidates(flat)
    possible = sum(len(group) for group in groups.values())
    if possible == 0:
        return CheckTeeth(
            status="not_measured",
            reason="This circuit has no gate Leona knows how to break.",
        )
    chosen = _select(groups, MAX_MUTANTS)
    tried = equivalent = caught = could_not_run = 0
    survivors: list[str] = []
    for candidate in chosen:
        if deadline is not None and clock() > deadline:
            return CheckTeeth(
                status="not_measured",
                reason="The time for checks in this run ran out before this one could be "
                "tested with broken copies.",
            )
        try:
            mutant = candidate.mutant()
            behaviour = judge.behaviour(mutant.circuit.remove_final_measurements(inplace=False))
        except MemoryError:
            return CheckTeeth(
                status="not_measured",
                reason="Leona ran out of memory while testing this check with broken copies.",
            )
        except Exception:  # noqa: BLE001 - counted below, never silently dropped
            could_not_run += 1
            continue
        if judge.same(original, behaviour):
            equivalent += 1
            continue
        tried += 1
        passed, _ = judge.judge(behaviour)
        if passed:
            if len(survivors) < 8:
                survivors.append(mutant.description)
        else:
            caught += 1
    unrunnable = (
        f" {could_not_run} broken {'copy' if could_not_run == 1 else 'copies'} could not be run."
        if could_not_run
        else ""
    )
    if tried == 0:
        teeth = CheckTeeth(
            status="not_measured",
            reason=(
                "Every broken copy Leona could make behaves exactly like this circuit as far "
                "as this kind of check can see, so there was nothing for it to catch." + unrunnable
            ),
            equivalent=equivalent,
            could_not_run=could_not_run,
        )
    else:
        reason = (
            f"{len(chosen)} of {possible} possible broken copies were tried, chosen "
            "deterministically."
            if len(chosen) < possible
            else ""
        ) + unrunnable
        teeth = CheckTeeth(
            status="measured",
            reason=reason.strip(),
            mutants=tried,
            equivalent=equivalent,
            caught=caught,
            survivors=survivors,
            could_not_run=could_not_run,
        )
    if cache is not None:
        cache[key] = teeth
    return teeth


# --------------------------------------------------------------------------- jobs


@dataclass(frozen=True)
class Unreadable:
    """Which program did not parse (or was refused by Qiskit's importer), in the parser's
    own words. Kept apart from `inconclusive` so the connector route can answer 400."""

    side: Literal["subject", "reference"]
    message: str


@dataclass(frozen=True)
class CheckJob:
    """One check to judge: its property, and what the sandbox (or a caller) captured."""

    id: str
    property: CheckProperty
    capture: CheckCapture


@dataclass(frozen=True)
class JudgedCheck:
    """A verdict, and whether the subject or reference did not parse.

    `final` is False when the verdict (or its teeth) was filled in because the judging
    process was stopped: such a result says nothing about the circuit and is not cached.
    """

    verdict: CheckVerdict
    unreadable: Unreadable | None = None
    final: bool = True


def _inconclusive_without_capture(prop: CheckProperty, detail: str) -> CheckVerdict:
    return CheckVerdict(
        status="inconclusive",
        basis=_basis(prop),
        checked_against=describe_expectation(prop),
        detail=detail,
    )


def plan_check_jobs(
    spec: NotebookSpec, report: ExecutionReport, captures: Mapping[str, CheckCapture]
) -> tuple[list[CheckJob], dict[str, CheckVerdict]]:
    """Split a run's check cells into the ones there is something to judge (jobs) and the
    ones already settled without judging: not run, skipped, their capture raised, or
    nothing was captured. Those are `inconclusive` with the reason."""
    check_cells = {cell.id: cell for cell in spec.cells if cell.role == CellRole.CHECK}
    jobs: list[CheckJob] = []
    settled: dict[str, CheckVerdict] = {}
    for result in report.cells:
        cell = check_cells.get(result.id)
        if cell is None or cell.property is None:
            continue
        prop = cell.property
        if result.status in {"not_run", "skipped"}:
            reason = result.note or ("not run" if result.status == "not_run" else "skipped")
            settled[result.id] = _inconclusive_without_capture(
                prop, f"This check did not run: {reason}."
            )
            continue
        if result.status == "error":
            what = f"{result.error.ename}: {result.error.evalue}" if result.error else "an error"
            settled[result.id] = _inconclusive_without_capture(
                prop, f"Recording `{prop.subject}` failed ({what[:300]})."
            )
            continue
        capture = captures.get(result.id)
        if capture is None:
            settled[result.id] = _inconclusive_without_capture(
                prop, "The sandbox recorded nothing for this check."
            )
            continue
        jobs.append(CheckJob(result.id, prop, capture))
    return jobs, settled


def judge_jobs(
    jobs: list[CheckJob],
    *,
    deadline: float,
    teeth: bool = True,
    teeth_cache: dict[str, CheckTeeth] | None = None,
    width_caps: Mapping[str, int] | None = None,
    clock: Callable[[], float] = time.monotonic,
):
    """Judge `jobs` IN THIS PROCESS, yielding events as they happen:
    `("verdict", id, JudgedCheck)` for every job first, then `("teeth", id, CheckTeeth)`
    for each check that passed on a circuit. Verdicts before teeth, so one budget buys
    every check a verdict before it buys any check its broken copies.

    The child process (`leona_notebooks.check_judge`) streams these to its parent; the
    in-process `apply_check_verdicts` collects them for tests and local tools.
    """
    judged: dict[str, _Judged] = {}
    for job in jobs:
        if clock() > deadline:
            yield (
                "verdict",
                job.id,
                JudgedCheck(
                    _inconclusive_without_capture(
                        job.property, "The time for checks in this run ran out before this one."
                    ),
                    final=False,
                ),
            )
            continue
        try:
            item = _judge(job.property, job.capture, width_caps=width_caps)
        except Exception as exc:  # noqa: BLE001 - one broken check must not take the rest
            item = _Judged(
                _inconclusive_without_capture(
                    job.property, f"Leona could not judge this check ({type(exc).__name__})."
                )
            )
        judged[job.id] = item
        yield "verdict", job.id, JudgedCheck(item.verdict, item.unreadable)
    if not teeth:
        return
    for job_id, item in judged.items():
        if item.verdict.status != "pass" or item.verdict.basis != "circuit":
            continue
        if item.judge is None or item.subject is None:
            continue
        try:
            measured = _measure_teeth(
                item.judge,
                item.subject,
                item.behaviour,
                deadline=deadline,
                cache=teeth_cache,
                clock=clock,
            )
        except Exception as exc:  # noqa: BLE001
            measured = CheckTeeth(
                status="not_measured",
                reason=f"Testing with broken copies failed ({type(exc).__name__}).",
            )
        yield "teeth", job_id, measured


def merge_check_verdicts(
    report: ExecutionReport, verdicts: Mapping[str, CheckVerdict]
) -> ExecutionReport:
    """`report` with each verdict on its cell. Never changes `ok` or any cell's `status`:
    a failing check does not fail the notebook."""
    if not verdicts:
        return report
    cells: list[CellResult] = [
        result.model_copy(update={"check": verdicts[result.id]})
        if result.id in verdicts
        else result
        for result in report.cells
    ]
    return report.model_copy(update={"cells": cells})


def apply_check_verdicts(
    spec: NotebookSpec,
    report: ExecutionReport,
    captures: Mapping[str, CheckCapture],
    *,
    budget_s: float = CHECK_BUDGET_S,
    teeth_cache: dict[str, CheckTeeth] | None = None,
    clock: Callable[[], float] = time.monotonic,
    width_caps: Mapping[str, int] | None = None,
) -> ExecutionReport:
    """`report` with `CellResult.check` set on every check cell, judged IN THIS PROCESS.

    For tests and local tools only. Nothing here can stop a judgement that runs long or
    allocates too much, which is why the worker uses `apply_check_verdicts_isolated`.
    """
    jobs, settled = plan_check_jobs(spec, report, captures)
    verdicts: dict[str, CheckVerdict] = dict(settled)
    deadline = clock() + budget_s
    for event, job_id, payload in judge_jobs(
        jobs, deadline=deadline, teeth_cache=teeth_cache, width_caps=width_caps, clock=clock
    ):
        if event == "verdict":
            verdicts[job_id] = payload.verdict
        else:
            verdicts[job_id] = verdicts[job_id].model_copy(update={"teeth": payload})
    return merge_check_verdicts(report, verdicts)


# --------------------------------------------------------------------------- the child process
#
# Every check of a dispatch is judged in ONE child process (`python -m
# leona_notebooks.check_judge`) with a hard wall clock and a memory cap, so nothing a check
# does can hang or kill the worker, which is one instance running every user's jobs (review
# of PR 1011). `asyncio.to_thread` could not do this: a thread cannot be killed, and it
# shared the default executor with QPU submission and polling. The connector route
# (`POST /v1/checks/circuit`) calls `judge_checks` too.


def _job_payload(job: CheckJob) -> dict[str, Any]:
    capture = job.capture
    value = list(capture.value) if isinstance(capture.value, tuple) else capture.value
    return {
        "id": job.id,
        "property": job.property.model_dump(mode="json"),
        "capture": {
            "kind": capture.kind,
            "qasm": capture.qasm,
            "value": value,
            "problem": capture.problem,
            "detail": capture.detail,
        },
    }


def _child_env() -> dict[str, str]:
    """The child's whole environment. Nothing of the parent's is passed but the path to
    Python and its packages: the worker's environment holds database and provider
    credentials, and the child reads untrusted OpenQASM. One thread per library keeps the
    child's CPU and address space to one core's worth."""
    env = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "LANG": "C.UTF-8",
        "PYTHONHASHSEED": "0",
        "PYTHONDONTWRITEBYTECODE": "1",
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "MKL_NUM_THREADS": "1",
        "VECLIB_MAXIMUM_THREADS": "1",
        "NUMEXPR_NUM_THREADS": "1",
        "RAYON_NUM_THREADS": "1",
        "QISKIT_PARALLEL": "FALSE",
    }
    for name in ("PYTHONPATH", "VIRTUAL_ENV", "HOME"):
        if os.environ.get(name):
            env[name] = os.environ[name]
    return env


async def _resident_bytes(pid: int) -> int | None:
    """A process's resident size: `/proc/<pid>/statm`, then `/proc/<pid>/status` (Linux),
    then `ps` (a macOS dev machine, where the kernel ignores RLIMIT_AS). `None` only when
    none of the three can be read."""
    try:
        with open(f"/proc/{pid}/statm", "rb") as handle:
            pages = int(handle.read().split()[1])
        return pages * os.sysconf("SC_PAGE_SIZE")
    except (OSError, ValueError, IndexError):
        pass
    try:
        with open(f"/proc/{pid}/status", "rb") as handle:
            for line in handle:
                if line.startswith(b"VmRSS:"):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    try:
        probe = await asyncio.create_subprocess_exec(
            "ps",
            "-o",
            "rss=",
            "-p",
            str(pid),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await asyncio.wait_for(probe.communicate(), 2)
        text = out.decode("ascii", "replace").strip()
        return int(text) * 1024 if text else None
    except (OSError, ValueError, TimeoutError):
        return None


def _stopped_words(outcome: str, seconds: float) -> tuple[str, str]:
    """(verdict detail, teeth reason) for a check the child never finished."""
    if outcome == "timeout":
        return (
            f"This took too long to check, so Leona stopped after {seconds:g} seconds. "
            "Nothing was decided.",
            f"Not tested with broken copies: this run's checks took too long, so Leona "
            f"stopped after {seconds:g} seconds.",
        )
    if outcome == "memory":
        return (
            "The process checking this stopped before it finished. It most likely ran out "
            "of memory. Nothing was decided.",
            "Not tested with broken copies: the process checking it stopped before it "
            "finished, most likely because it ran out of memory.",
        )
    return (
        "The process checking this stopped unexpectedly before it finished. Nothing was decided.",
        "Not tested with broken copies: the process checking it stopped unexpectedly.",
    )


#: One judge child at a time per process (per event loop: the worker and the API each run
#: exactly one), whatever the process's job concurrency. Two children at once would need
#: twice the headroom the container has (`CHECK_MEMORY_HEADROOM_BYTES`). A later call
#: waits; its own wall clock starts when it gets the slot. Keyed by loop because an
#: asyncio primitive belongs to the loop it first waited on, and tests run many loops.
_JUDGE_SLOTS: weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Semaphore] = (
    weakref.WeakKeyDictionary()
)


def _judge_slot() -> asyncio.Semaphore:
    loop = asyncio.get_running_loop()
    slot = _JUDGE_SLOTS.get(loop)
    if slot is None:
        slot = _JUDGE_SLOTS[loop] = asyncio.Semaphore(1)
    return slot


async def judge_checks(
    jobs: list[CheckJob],
    *,
    budget_s: float = CHECK_BUDGET_S,
    kill_after_s: float | None = None,
    memory_headroom_bytes: int | None = None,
    width_caps: Mapping[str, int] | None = None,
    teeth: bool = True,
    _argv: list[str] | None = None,
    _on_event: Callable[[dict[str, Any]], None] | None = None,
) -> dict[str, JudgedCheck]:
    """Judge every job in ONE child process that is killed at `kill_after_s` (default
    `budget_s`), and return a result for every job, whatever happened to the child.

    `budget_s` is the child's own deadline: it stops starting new work after it, giving
    every check a verdict before any check its broken copies. `kill_after_s` is the hard
    wall clock. `memory_headroom_bytes` (default `check_judge_headroom_bytes()`, 64 MiB)
    is the memory the child may use above its footprint after its imports, enforced
    twice: RLIMIT_AS inside the child (Linux only), and this function reading the child's
    resident size every 50 ms and killing it above footprint + headroom (every platform;
    an allocation faster than one poll can overshoot until the next). `width_caps` lowers the
    widest subject judged per kind, never raises it. A check the child never finished is
    `inconclusive` with the reason ("took too long to check", "ran out of memory"), and a
    passing check whose broken copies were cut short says so in its teeth.

    Only one child runs at a time in a process (`_judge_slot`): a second call waits for
    the first, and its wall clock starts when it gets the slot.

    `_argv` and `_on_event` are for tests: a stand-in child, and a look at every event.
    """
    if not jobs:
        return {}
    async with _judge_slot():
        return await _judge_checks_now(
            jobs,
            budget_s=budget_s,
            kill_after_s=kill_after_s,
            memory_headroom_bytes=memory_headroom_bytes,
            width_caps=width_caps,
            teeth=teeth,
            _argv=_argv,
            _on_event=_on_event,
        )


async def _judge_checks_now(
    jobs: list[CheckJob],
    *,
    budget_s: float,
    kill_after_s: float | None,
    memory_headroom_bytes: int | None,
    width_caps: Mapping[str, int] | None,
    teeth: bool,
    _argv: list[str] | None,
    _on_event: Callable[[dict[str, Any]], None] | None,
) -> dict[str, JudgedCheck]:
    """`judge_checks` once it holds this process's judge slot."""
    loop = asyncio.get_running_loop()
    kill_after = float(kill_after_s if kill_after_s is not None else budget_s)
    headroom = (
        int(memory_headroom_bytes)
        if memory_headroom_bytes is not None
        else check_judge_headroom_bytes()
    )
    payload = json.dumps(
        {
            "jobs": [_job_payload(job) for job in jobs],
            "budget_s": float(budget_s),
            "memory_headroom_bytes": headroom,
            "width_caps": dict(width_caps or {}),
            "teeth": bool(teeth),
        }
    ).encode("utf-8")
    argv = _argv or [sys.executable, "-m", "leona_notebooks.check_judge"]
    results: dict[str, JudgedCheck] = {}
    teeth_arrived: set[str] = set()
    outcome = "died"
    started = loop.time()
    process = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_child_env(),
        limit=1 << 22,
    )
    stderr_tail = bytearray()

    async def drain_stderr() -> None:
        assert process.stderr is not None
        while chunk := await process.stderr.read(4096):
            stderr_tail.extend(chunk)
            del stderr_tail[:-4096]

    stderr_task = asyncio.create_task(drain_stderr())
    #: Set when the child reports its footprint ("ready"): footprint + headroom.
    memory_limit: list[int] = []
    killed_for_memory: list[bool] = []

    async def watch_memory() -> None:
        unreadable = 0
        while process.returncode is None:
            if memory_limit:
                try:
                    resident = await _resident_bytes(process.pid)
                except Exception:  # noqa: BLE001 - a broken watch must say so, not vanish
                    _log.exception("check judge memory watch failed; RLIMIT_AS still applies")
                    return
                if _on_event is not None:
                    _on_event({"event": "watch", "resident": resident, "limit": memory_limit[0]})
                if resident is None:
                    unreadable += 1
                    if unreadable == 20:
                        _log.warning("check judge memory watch cannot read the child's size")
                elif resident > memory_limit[0]:
                    killed_for_memory.append(True)
                    with contextlib.suppress(ProcessLookupError):
                        process.kill()
                    return
            await asyncio.sleep(_MEMORY_POLL_S)

    memory_task = asyncio.create_task(watch_memory())
    try:
        assert process.stdin is not None and process.stdout is not None
        try:
            process.stdin.write(payload)
            await asyncio.wait_for(process.stdin.drain(), kill_after)
            process.stdin.close()
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass
        while True:
            remaining = kill_after - (loop.time() - started)
            if remaining <= 0:
                outcome = "timeout"
                break
            try:
                line = await asyncio.wait_for(process.stdout.readline(), remaining)
            except TimeoutError:
                outcome = "timeout"
                break
            if not line:
                break
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if not isinstance(event, dict):
                continue
            if _on_event is not None:
                _on_event(event)
            kind = event.get("event")
            if kind == "ready" and not memory_limit:
                footprint = event.get("rss_bytes")
                if isinstance(footprint, int) and footprint > 0:
                    memory_limit.append(footprint + headroom)
                continue
            if kind == "done":
                outcome = "done"
                break
            job_id = event.get("id")
            if not isinstance(job_id, str):
                continue
            try:
                if kind == "verdict":
                    raw = event.get("unreadable")
                    unreadable = (
                        Unreadable(
                            side="reference" if raw.get("side") == "reference" else "subject",
                            message=str(raw.get("message") or "")[:500],
                        )
                        if isinstance(raw, dict)
                        else None
                    )
                    results[job_id] = JudgedCheck(
                        CheckVerdict.model_validate(event.get("verdict")),
                        unreadable,
                        final=bool(event.get("final", True)),
                    )
                elif kind == "teeth" and job_id in results:
                    measured = CheckTeeth.model_validate(event.get("teeth"))
                    previous = results[job_id]
                    results[job_id] = JudgedCheck(
                        previous.verdict.model_copy(update={"teeth": measured}),
                        previous.unreadable,
                        previous.final,
                    )
                    teeth_arrived.add(job_id)
            except ValueError:
                continue  # a malformed event is dropped; the job is filled in below
    finally:
        if process.returncode is None:
            with contextlib.suppress(ProcessLookupError):
                process.kill()
        await process.wait()
        for task in (stderr_task, memory_task):
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
    if outcome != "done" and stderr_tail:
        _log.warning(
            "check judge stopped (%s, exit %s): %s",
            outcome,
            process.returncode,
            bytes(stderr_tail[-1000:]).decode("utf-8", "replace"),
        )
    if outcome == "died" and (
        killed_for_memory or process.returncode == -9 or b"MemoryError" in bytes(stderr_tail)
    ):
        outcome = "memory"  # SIGKILL is what the kernel's OOM killer sends
    detail, teeth_reason = _stopped_words(outcome, kill_after)
    for job in jobs:
        result = results.get(job.id)
        if result is None:
            results[job.id] = JudgedCheck(
                _inconclusive_without_capture(job.property, detail), final=False
            )
            continue
        verdict = result.verdict
        if (
            teeth
            and outcome != "done"
            and verdict.status == "pass"
            and verdict.basis == "circuit"
            and job.id not in teeth_arrived
        ):
            results[job.id] = JudgedCheck(
                verdict.model_copy(
                    update={"teeth": CheckTeeth(status="not_measured", reason=teeth_reason)}
                ),
                result.unreadable,
                final=False,
            )
    return results


def _job_key(job: CheckJob) -> str:
    payload = _job_payload(job)
    payload.pop("id")
    payload["property"] = job.property.expectation_key()
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()


async def apply_check_verdicts_isolated(
    spec: NotebookSpec,
    report: ExecutionReport,
    captures: Mapping[str, CheckCapture],
    *,
    cache: dict[str, JudgedCheck] | None = None,
    budget_s: float = CHECK_BUDGET_S,
    memory_headroom_bytes: int | None = None,
) -> ExecutionReport:
    """What the worker calls after every dispatch: `report` with a verdict on every check
    cell, judged in one killable child process (`judge_checks`).

    `cache` holds finished results by (the check's expectation, the capture), for the life
    of one run. A generation dispatches the same notebook several times (the first run,
    each repair's rerun, the grader audit's two runs); a check whose subject did not change
    is not judged again, and when nothing changed no child is started at all.
    """
    jobs, settled = plan_check_jobs(spec, report, captures)
    verdicts: dict[str, CheckVerdict] = dict(settled)
    pending: list[CheckJob] = []
    for job in jobs:
        hit = cache.get(_job_key(job)) if cache is not None else None
        if hit is not None:
            verdicts[job.id] = hit.verdict
        else:
            pending.append(job)
    if pending:
        judged = await judge_checks(
            pending, budget_s=budget_s, memory_headroom_bytes=memory_headroom_bytes
        )
        for job in pending:
            result = judged[job.id]
            verdicts[job.id] = result.verdict
            if cache is not None and result.final:
                cache[_job_key(job)] = result
    return merge_check_verdicts(report, verdicts)
