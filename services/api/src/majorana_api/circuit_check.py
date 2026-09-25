"""Judge one OpenQASM 3 circuit against one `CheckProperty`, for `POST /v1/checks/circuit`.

The judgement is the check-cell engine's, unchanged (`leona_notebooks.checks.evaluate_check`,
DESIGN §1-§2 in ai-ops/desk/leona/plans/platform-vision-20260924/phase-a/). What this module
adds is everything a route on the API needs and a notebook run on the worker did not:

1. **A bound on the input before anything is built from it.** A notebook's check sees a
   circuit the sandbox exported from a real `QuantumCircuit`. This route sees text anyone
   with a session or a token wrote, and three short programs cost far more than their
   length suggests: `qubit[100000000] q;` allocates a hundred million qubits in the
   importer; a chain of `gate g2 a { g1 a; g1 a; }` definitions doubles per line, so 40
   lines is 2**40 gate applications once simulated; and `ctrl(11) @ x` on 12 qubits is
   simulated as a dense 4096 x 4096 matrix (256 MiB). `_bound_source` reads the program
   as an AST (`openqasm3.parse`, the parser Qiskit's own importer calls) and refuses each
   of these from the tree, before `qiskit_qasm3_import` is handed it.
2. **Width ceilings the API can afford.** The engine's verification ceilings (24 qubits
   for a state, 12 for a unitary) are sized for the worker. One 24-qubit statevector is
   2**24 x 16 bytes = 256 MiB, and a state check holds two (the circuit's and the
   expected one), which is the API instance's whole 512 MiB (`API_MEMORY_MI` in
   infra/fleet.env) before the process itself. So this route judges only what the engine
   can also mutation-test: `MUTATION_MAX_QUBITS_STATE` (12) for state, distribution and
   energy checks and `MUTATION_MAX_QUBITS_UNITARY` (8) for unitary checks. Wider is
   `inconclusive`, with `not_measured` teeth, and says to use a notebook.
3. **The expectation is bounded too.** The engine builds a library reference before it
   compares widths, so `reference: "ghz(24)"` on a 2-qubit circuit would still allocate a
   24-qubit state. References and `reference_qasm` are held to the same ceilings.
4. **`teeth` is always set** (`CircuitCheckResponse`'s promise), as `not_measured` with the
   reason whenever no broken copies were tried.

Nothing here writes anywhere, and nothing is executed: parsing and simulating a circuit is
not running code, the same line `leona_notebooks.circuits` draws for a pasted circuit.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any

from leona_notebooks.checks import (
    CHECK_BUDGET_S,
    MUTATION_MAX_GATES,
    MUTATION_MAX_QUBITS_STATE,
    MUTATION_MAX_QUBITS_UNITARY,
    CheckCapture,
    describe_expectation,
    evaluate_check,
)
from majorana_contracts import CheckProperty, CheckTeeth, CheckVerdict

#: One request's wall-clock budget, parsing and mutation testing included, and no larger
#: than a whole notebook run's (`CHECK_BUDGET_S`, 20 s). Passed to the engine as a
#: deadline, which it checks before each broken copy, so nothing is left running when it
#: passes: the verdict still comes back, with teeth `not_measured` for want of time.
#:
#: The deadline does NOT interrupt the one simulation of the circuit itself. What bounds
#: that is the ceilings below. Measured 2026-09-25 on an Apple M1 Pro, one process, one
#: run each, near-worst inputs inside those ceilings (~3,300 gates, 64,000 characters):
#: parsing 0.46 s; a failing state check on 12 qubits 7.7 s (14 qubits: 2.4 s, so the 12
#: figure likely carries first-call warm-up); a failing unitary check on 8 qubits 5.5 s;
#: an energy check on the contract's widest Hamiltonian (10 qubits, 256 terms) 9.6 s. The
#: API's Cloud Run vCPU was NOT measured.
CIRCUIT_CHECK_BUDGET_S = 10.0
assert CIRCUIT_CHECK_BUDGET_S <= CHECK_BUDGET_S, "the route may not outspend a notebook run"

#: Widest circuit judged here, per kind. See the module docstring, point 2.
MAX_QUBITS: dict[str, int] = {
    "state": MUTATION_MAX_QUBITS_STATE,
    "distribution": MUTATION_MAX_QUBITS_STATE,
    "energy": MUTATION_MAX_QUBITS_STATE,
    "unitary": MUTATION_MAX_QUBITS_UNITARY,
}

#: Most gate applications a program may expand to, with every gate definition unrolled
#: and every register-wide call broadcast. The engine's own `MUTATION_MAX_GATES`: 64,000
#: characters of plain gates is about 3,300, so this refuses only a program whose gate
#: definitions multiply.
MAX_EXPANDED_OPERATIONS = MUTATION_MAX_GATES

#: Most classical bits a program may declare. A check reads at most 24 bits of outcome
#: (`probabilities` keys); this bounds only the allocation, like the qubit count does.
MAX_DECLARED_CLBITS = 1_024

#: Widest gate call that carries a `ctrl`, `negctrl` or `pow` modifier. Qiskit simulates a
#: controlled or powered gate as one dense matrix over all its qubits, so this is the
#: widest dense unitary the engine builds for a mutant: 8 qubits, 256 x 256.
MAX_MODIFIED_GATE_QUBITS = MUTATION_MAX_QUBITS_UNITARY

_LIBRARY_WIDTH_RE = re.compile(r"^(?:ghz|w|uniform|qft|iqft)\((\d+)\)$")


class QasmUnreadable(Exception):
    """The program does not parse, or the importer refuses it. The route answers 400."""

    def __init__(self, message: str, *, reason: str = "qasm_unreadable") -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason


class _Refused(Exception):
    """The check cannot judge this program here. Becomes an `inconclusive` verdict."""

    def __init__(self, detail: str, teeth: str, *, qubits: int | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.teeth = teeth
        self.qubits = qubits


@dataclass(frozen=True)
class _Bounded:
    """What `_bound_source` learned from the tree, without building anything."""

    program: Any  # openqasm3.ast.Program
    qubits: int


def _a(kind: str) -> str:
    """ "a state", "an energy", "a unitary" (a "you" sound, so "a")."""
    return ("an " if kind[:1] in "aeio" else "a ") + kind


def _too_wide(width: int, prop: CheckProperty, *, what: str = "The circuit") -> _Refused:
    cap = MAX_QUBITS[prop.kind]
    return _Refused(
        f"{what} has {width} qubits; Leona judges {_a(prop.kind)} check sent to it directly "
        f"up to {cap} qubits, the widest it can also test with broken copies. Check a wider "
        "circuit in a notebook, where it is judged on the worker.",
        f"Too large to test with broken copies here: {width} qubits (the limit for "
        f"{_a(prop.kind)} check is {cap}).",
        qubits=width,
    )


def _parser_words(exc: BaseException) -> str:
    """The parser's own account of what it could not read, in one line.

    `openqasm3.parse` raises an EMPTY `QASM3ParsingError` for a grammar error: its
    message lives on the ANTLR `RecognitionException` two causes down (the bail
    strategy wraps it in a `ParseCancellationException`), as the offending token and
    its position. Lexer errors and the importer's refusals carry their text directly.
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


def _literal_int(node: Any) -> int | None:
    from openqasm3 import ast

    return node.value if isinstance(node, ast.IntegerLiteral) else None


_CONTROL_FLOW_NAMES = (
    "BranchingStatement",
    "WhileLoop",
    "ForInLoop",
    "SwitchStatement",
    "Box",
    "BreakStatement",
    "ContinueStatement",
    "EndStatement",
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


def _bound_source(text: str, *, max_qubits: int, prop: CheckProperty, what: str) -> _Bounded:
    """Parse `text` to an AST and refuse what would be expensive to build or simulate.

    Raises `QasmUnreadable` for a program that does not parse and `_Refused` for one the
    check cannot judge here. Counts only literals it can read off the tree; anything it
    cannot bound (a register sized by an expression, a modifier count that is not a
    number) is refused rather than guessed at, because over-refusing costs a caller a
    retry and under-counting costs every caller on the instance.
    """
    import openqasm3
    from openqasm3 import ast

    try:
        program = openqasm3.parse(text)
    except Exception as exc:  # noqa: BLE001 - any parser failure is the caller's program
        raise QasmUnreadable(f"{what}'s OpenQASM 3 does not parse: {_parser_words(exc)}") from None

    registers: dict[str, int] = {}
    qubits = clbits = operations = 0
    gate_sizes: dict[str, int] = {}

    def refuse_unbounded(words: str) -> _Refused:
        return _Refused(
            f"{what} {words}, so Leona cannot bound how large it is before building it. "
            "Write register sizes and modifier counts as plain numbers.",
            "Not tested with broken copies: the check could not read the circuit.",
        )

    def operand_width(operand: Any) -> int:
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

    def broadcast(operands: Iterable[Any]) -> int:
        return max((operand_width(operand) for operand in operands), default=1)

    def call_cost(node: Any, *, name: str | None, operands: list[Any], in_gate: bool) -> int:
        base = gate_sizes.get(name, 1) if name is not None else 1
        factor = 1
        for modifier in getattr(node, "modifiers", None) or []:
            kind = modifier.modifier.name
            if kind in {"ctrl", "negctrl"}:
                count = 1 if modifier.argument is None else _literal_int(modifier.argument)
                if count is None:
                    raise refuse_unbounded("has a ctrl modifier whose count is not a number")
                factor *= count + 1
            if kind in {"ctrl", "negctrl", "pow"} and len(operands) > MAX_MODIFIED_GATE_QUBITS:
                raise _Refused(
                    f"{what} applies a controlled or powered gate to {len(operands)} qubits. "
                    "Qiskit simulates such a gate as one dense matrix, and Leona builds those "
                    f"up to {MAX_MODIFIED_GATE_QUBITS} qubits.",
                    "Not tested with broken copies: the check could not judge the circuit.",
                )
        return base * factor * (1 if in_gate else broadcast(operands))

    def add(count: int) -> None:
        nonlocal operations
        operations += count
        if operations > MAX_EXPANDED_OPERATIONS:
            raise _Refused(
                f"{what} expands to more than {MAX_EXPANDED_OPERATIONS:,} gate applications "
                "once its gate definitions are unrolled; Leona judges circuits up to that "
                "size here.",
                f"Too large to test with broken copies: over {MAX_EXPANDED_OPERATIONS:,} "
                "gate applications.",
            )

    # Every register first, so a width refusal names the program's whole width.
    for statement in program.statements:
        if isinstance(statement, ast.QubitDeclaration):
            size = 1 if statement.size is None else _literal_int(statement.size)
            if size is None:
                raise refuse_unbounded("declares a qubit register whose size is not a number")
            registers[statement.qubit.name] = size
            qubits += size
    if qubits > max_qubits:
        raise _too_wide(qubits, prop, what=what)

    for statement in program.statements:
        name = type(statement).__name__
        if isinstance(statement, ast.Include | ast.QubitDeclaration):
            continue  # the importer refuses anything but stdgates.inc, as a 400
        if isinstance(statement, ast.ClassicalDeclaration):
            if isinstance(statement.type, ast.BitType):
                size = 1 if statement.type.size is None else _literal_int(statement.type.size)
                if size is None:
                    raise refuse_unbounded("declares a bit register whose size is not a number")
                clbits += size
                if clbits > MAX_DECLARED_CLBITS:
                    raise _Refused(
                        f"{what} declares {clbits} classical bits; Leona reads at most "
                        f"{MAX_DECLARED_CLBITS} here.",
                        "Not tested with broken copies: the check could not judge the circuit.",
                    )
                if statement.init_expression is not None:
                    add(1)
            # Any other type: the importer refuses it before evaluating anything (a 400).
            continue
        if isinstance(statement, ast.IODeclaration):
            continue  # an unbound parameter; the engine says so as `inconclusive`
        if isinstance(statement, ast.QuantumGateDefinition):
            size = 0
            for inner in statement.body:
                if isinstance(inner, ast.QuantumGate):
                    size += call_cost(
                        inner, name=inner.name.name, operands=inner.qubits, in_gate=True
                    )
                elif isinstance(inner, ast.QuantumPhase):
                    size += call_cost(inner, name=None, operands=inner.qubits, in_gate=True)
                else:
                    size += 1
                if size > MAX_EXPANDED_OPERATIONS:
                    add(size)  # raises
            gate_sizes[statement.name.name] = max(size, 1)
            continue
        if isinstance(statement, ast.QuantumGate):
            add(
                call_cost(
                    statement, name=statement.name.name, operands=statement.qubits, in_gate=False
                )
            )
            continue
        if isinstance(statement, ast.QuantumPhase):
            add(call_cost(statement, name=None, operands=statement.qubits, in_gate=False))
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
        if name in _CONTROL_FLOW_NAMES:
            raise _Refused(
                f"{what} uses classical control flow (if, while, for, switch or box), so it "
                "has no single output state to check.",
                "Not tested with broken copies: the check could not judge the circuit.",
            )
        raise _Refused(
            f"{what} uses {_STATEMENT_WORDS.get(name, name)}, which a circuit check does "
            "not read. Send the circuit as Qiskit's qasm3.dumps writes it.",
            "Not tested with broken copies: the check could not judge the circuit.",
        )
    return _Bounded(program=program, qubits=qubits)


def _import(bounded: _Bounded, *, what: str) -> None:
    """Convert the bounded tree with Qiskit's importer, so a program it refuses (an
    undefined gate, an unsupported include) is a 400 with the importer's own words
    rather than an `inconclusive` from the engine's second parse."""
    from qiskit_qasm3_import import convert

    try:
        convert(bounded.program)
    except Exception as exc:  # noqa: BLE001 - the importer's refusal is the caller's program
        raise QasmUnreadable(
            f"{what}'s OpenQASM 3 could not be read by Qiskit's importer: {_parser_words(exc)}"
        ) from None


def _bound_expectation(prop: CheckProperty) -> None:
    """Refuse an expectation the engine would build before comparing widths."""
    cap = MAX_QUBITS[prop.kind]
    if prop.reference is not None:
        match = _LIBRARY_WIDTH_RE.match(prop.reference)
        width = int(match.group(1)) if match else 2  # bell and its variants
        if width > cap:
            raise _too_wide(width, prop, what=f"The reference {prop.reference}")
    if prop.reference_qasm is not None:
        bounded = _bound_source(
            prop.reference_qasm, max_qubits=cap, prop=prop, what="The check's reference circuit"
        )
        _import(bounded, what="The check's reference circuit")


def _refusal_verdict(prop: CheckProperty, refused: _Refused) -> CheckVerdict:
    return CheckVerdict(
        status="inconclusive",
        basis="circuit",
        checked_against=describe_expectation(prop),
        detail=refused.detail,
        qubits=refused.qubits,
        teeth=CheckTeeth(status="not_measured", reason=refused.teeth),
    )


_TEETH_WHEN_ABSENT = {
    "fail": (
        "Broken copies are tried only on a check that passes. This one failed, so there "
        "was nothing to test."
    ),
    "inconclusive": "Not tested with broken copies: the check could not judge the circuit.",
    "pass": "Leona did not test this check with broken copies.",
}


def _with_explicit_teeth(verdict: CheckVerdict) -> CheckVerdict:
    if verdict.teeth is not None:
        return verdict
    reason = _TEETH_WHEN_ABSENT[verdict.status]
    return verdict.model_copy(update={"teeth": CheckTeeth(status="not_measured", reason=reason)})


def judge_circuit(
    qasm: str,
    prop: CheckProperty,
    *,
    budget_s: float = CIRCUIT_CHECK_BUDGET_S,
    clock: Callable[[], float] = time.monotonic,
) -> CheckVerdict:
    """The verdict on `qasm` against `prop`, with `teeth` always set. Blocking and
    CPU-bound: the route runs it in a worker thread.

    Raises `QasmUnreadable` (the route's 400) for a subject or reference circuit that does
    not parse. Everything else the check cannot judge is an `inconclusive` verdict, never
    an exception. `prop.kind == "value"` is the route's to refuse before calling this.
    """
    if prop.kind not in MAX_QUBITS:
        raise ValueError(f"{prop.kind!r} is not a circuit check")
    deadline = clock() + budget_s
    try:
        bounded = _bound_source(
            qasm, max_qubits=MAX_QUBITS[prop.kind], prop=prop, what="The circuit"
        )
        _import(bounded, what="The circuit")
        _bound_expectation(prop)
    except _Refused as refused:
        return _refusal_verdict(prop, refused)
    verdict = evaluate_check(prop, CheckCapture(kind="circuit", qasm=qasm), deadline=deadline)
    return _with_explicit_teeth(verdict)


__all__ = [
    "CIRCUIT_CHECK_BUDGET_S",
    "MAX_DECLARED_CLBITS",
    "MAX_EXPANDED_OPERATIONS",
    "MAX_MODIFIED_GATE_QUBITS",
    "MAX_QUBITS",
    "QasmUnreadable",
    "judge_circuit",
]
