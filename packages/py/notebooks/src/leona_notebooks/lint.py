"""A static check of notebook cells for mistakes that are certain to break, before anything runs.

The notebook that failed in production on 2026-09-24 (01:07Z) died on one line a reader
of Qiskit would spot at a glance: `Statevector.from_label("0").evolve(QuantumCircuit(1).h(0))`.
`QuantumCircuit.h` appends the gate and returns an `InstructionSet`, not the circuit, so
`evolve` was handed the wrong object and raised. The repair loop then spent three model
calls and three sandbox runs failing on the same cell, because the only thing it was told
was the traceback, and the traceback points into Qiskit's operator constructor rather than
at the chained call. This module names the mistake at the line where it was made.

It is used twice, and the two uses want different things from it:

* **The pipeline** (`leona_notebooks.pipeline`) puts the findings for a failing cell into
  the repair prompt, and repairs a cell with a definite error BEFORE the first sandbox run,
  when the finding is one that cannot be a false alarm (an import the guard refuses, an
  API Qiskit 2 removed, a statevector of a measured circuit, a syntax error).
* **The editor** shows the findings as the reader types. The browser has its own
  implementation (`apps/web/lib/notebook-lint.ts`); both are tested against
  `tests/data/lint-cases.json`, which is the only place the rules are defined by example,
  so neither can quietly grow a rule the other lacks.

What it deliberately is not: a type checker. Every rule here keys on a syntactic shape and
a small amount of name tracking (which names were bound to a `QuantumCircuit`, and which of
those have been measured), in source order, across the cells that run before this one. A
name the tracking cannot follow is simply not checked. The failure this accepts is a missed
mistake, which costs one sandbox run; the failure it refuses is a false alarm on correct
code, which would teach a reader to ignore the flags and would send the pipeline to repair
a cell that was right.
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import Iterable, Literal

Severity = Literal["error", "warning"]

#: Circuit methods that append an instruction and return an `InstructionSet` (or, for
#: `measure_all`, `None`). Using the RESULT of one of these as though it were the circuit
#: is the mistake `gate-returns-instructions` names. Kept to methods that exist on
#: `QuantumCircuit` in Qiskit 2.5, so a lookalike on some other object is not matched by
#: name alone — the receiver has to be a circuit as well.
GATE_METHODS: frozenset[str] = frozenset(
    {
        "h",
        "x",
        "y",
        "z",
        "s",
        "sdg",
        "t",
        "tdg",
        "sx",
        "sxdg",
        "rx",
        "ry",
        "rz",
        "rxx",
        "ryy",
        "rzz",
        "rzx",
        "p",
        "u",
        "r",
        "cx",
        "cy",
        "cz",
        "ch",
        "cp",
        "crx",
        "cry",
        "crz",
        "cu",
        "cs",
        "csdg",
        "csx",
        "ccx",
        "ccz",
        "cswap",
        "swap",
        "iswap",
        "dcx",
        "ecr",
        "mcx",
        "mcp",
        "rv",
        "id",
        "barrier",
        "measure",
        "measure_all",
        "reset",
        "append",
        "delay",
        "initialize",
        "unitary",
        "prepare_state",
    }
)

#: Methods that return a NEW circuit when called on a circuit, so the name they are bound
#: to is a circuit too. `measured` says whether the result carries measurements.
_CIRCUIT_RETURNING: dict[str, bool | None] = {
    "copy": None,  # same measured state as the receiver
    "compose": None,
    "assign_parameters": None,
    "inverse": False,
    "decompose": None,
    "reverse_bits": None,
    "remove_final_measurements": False,  # only when inplace=False; see _circuit_value
    "measure_all": True,  # only when inplace=False
}

#: Qiskit 1.x names that Qiskit 2 removed, with what to write instead.
_REMOVED_FROM: dict[str, dict[str, str]] = {
    "qiskit": {
        "execute": "`qiskit.execute` was removed in Qiskit 1.0. Run circuits with a primitive: `StatevectorSampler().run([qc], shots=1000)`.",
        "Aer": "`Aer` is no longer importable from `qiskit`. Use `from qiskit_aer import AerSimulator`, or `StatevectorSampler` from `qiskit.primitives`.",
        "BasicAer": "`BasicAer` was removed in Qiskit 1.0. Use `StatevectorSampler` from `qiskit.primitives`.",
        "IBMQ": "`IBMQ` was removed. Hardware access goes through `qiskit_ibm_runtime`, and on Leona through `leona_submit(qc)`.",
    },
    "qiskit.primitives": {
        "Sampler": "The V1 `Sampler` was removed in Qiskit 2.0. Use `StatevectorSampler`.",
        "Estimator": "The V1 `Estimator` was removed in Qiskit 2.0. Use `StatevectorEstimator`.",
        "BackendSampler": "`BackendSampler` was removed in Qiskit 2.0. Use `BackendSamplerV2`.",
        "BackendEstimator": "`BackendEstimator` was removed in Qiskit 2.0. Use `BackendEstimatorV2`.",
    },
}

#: Whole modules that no longer exist in Qiskit 2.
_REMOVED_MODULES: dict[str, str] = {
    "qiskit.opflow": "`qiskit.opflow` was removed. Use `SparsePauliOp` from `qiskit.quantum_info`.",
    "qiskit.algorithms": "`qiskit.algorithms` was removed. The algorithms moved to the separate `qiskit_algorithms` package, which this sandbox does not have; write the loop directly with a primitive.",
    "qiskit.providers.aer": "`qiskit.providers.aer` was removed. Use `from qiskit_aer import AerSimulator`.",
    "qiskit.test": "`qiskit.test` was removed.",
    "qiskit.tools": "`qiskit.tools` was removed.",
}

#: Removed METHODS, matched on the attribute name at any receiver. Both names are
#: distinctive enough that a false alarm needs an object of some other library with the
#: same method, which nothing this sandbox imports has.
#:
#: `c_if` verified removed on qiskit 2.5.2: `InstructionSet` no longer has it
#: (`AttributeError: 'InstructionSet' object has no attribute 'c_if'`; `dir(InstructionSet)`
#: is only `add`, `cargs`, `instructions`, `inverse`, `qargs`). The replacement,
#: `with qc.if_test((clbit, value)):`, was probed too, and probing it surfaced a SECOND
#: trap the message below exists to head off: `StatevectorSampler` cannot run the circuit
#: `if_test` produces (`QiskitError: StatevectorSampler cannot handle ControlFlowOp`,
#: reproduced on qiskit 2.5.2) — a repair that only swaps the method name still fails, one
#: cell later, on a notebook whose header says `execution: local-statevector`.
#: `AerSimulator().run(qc, shots=...).result().get_counts()` was verified to run the same
#: circuit and return counts.
_REMOVED_METHODS: dict[str, str] = {
    "bind_parameters": "`bind_parameters` was removed in Qiskit 1.0. Use `assign_parameters`.",
    "c_if": (
        "`.c_if(clbit, value)` was removed from `InstructionSet` in Qiskit 2. The replacement "
        "is a context manager: `with qc.if_test((clbit, value)): qc.x(target)` (a bare int "
        "clbit index works, exactly like the old `.c_if(index, value)`). But a circuit that "
        "uses `if_test` cannot run on `StatevectorSampler` "
        "(`QiskitError: StatevectorSampler cannot handle ControlFlowOp`) — run it with "
        "`AerSimulator` instead: `from qiskit_aer import AerSimulator; "
        "AerSimulator().run(qc, shots=...).result().get_counts()`."
    ),
}

#: `QFTGate.__init__` takes only `num_qubits` on qiskit 2.5.2 (verified:
#: `inspect.signature(QFTGate.__init__)` is `(self, num_qubits: int)`). Any other keyword —
#: `inverse`, `do_swaps`, `approximation_degree` — belonged to the OLD `QFT` class
#: (`qiskit.circuit.library.QFT`, still importable in 2.5.2 but deprecated since 2.1 and
#: removed in 3.0) and raises `TypeError: QFTGate.__init__() got an unexpected keyword
#: argument '...'`. Verified: `QFTGate(n).inverse()` is exactly the adjoint of `QFTGate(n)`
#: (bit-for-bit equal, not just equal up to global phase, for n in 1..4).
_QFTGATE_VALID_KEYWORDS: frozenset[str] = frozenset({"num_qubits"})

#: Constructors and methods that need a circuit WITHOUT measurements.
_STATE_BUILDERS: frozenset[str] = frozenset({"Statevector", "Operator", "DensityMatrix"})
_STATE_METHODS: frozenset[str] = frozenset({"from_instruction", "evolve"})

#: `InstructionSet`'s real public API on qiskit 2.5.2 (`dir(InstructionSet)`, names that
#: don't start with `_`): `add`, `cargs`, `instructions`, `inverse`, `qargs`. `.c_if` is
#: kept in this allowlist too, even though it is NOT part of that API any more, so the
#: INNER gate call in `qc.h(0).c_if(...)` stays exempt from `instructionset-has-no-attribute`
#: — the OUTER `.c_if(...)` call already gets the specific, correctly-remediated
#: `removed-qiskit-api` finding (`_REMOVED_METHODS["c_if"]`), and this check's own generic
#: "then use `qc.c_if`" advice would be wrong: `QuantumCircuit` does not have `.c_if` either.
_INSTRUCTION_SET_ATTRS: frozenset[str] = frozenset(
    {"add", "cargs", "instructions", "inverse", "qargs", "c_if"}
)


#: Calls that build a circuit from OpenQASM text (`qasm2.loads`, `qasm3.load`,
#: `QuantumCircuit.from_qasm_str`, ...): matched by method name alone, so an unrelated
#: `json.loads` also stands the rule down, which is the safe direction for it.
_QASM_LOADERS = frozenset({"loads", "load", "from_qasm_str", "from_qasm_file"})


def _never_creates_meas_register(sources: Iterable[str]) -> bool:
    """Whether NO code cell in `sources` could ever create a classical register literally
    named "meas" — the only two ways Qiskit does that are `measure_all()` (any receiver,
    in place or not: even `inplace=False` still names the COPY's register "meas") and an
    explicit `ClassicalRegister(size, "meas")` / `ClassicalRegister(size, name="meas")`.

    Scoped to the WHOLE notebook (every code cell, not just the ones before the cell being
    linted) on purpose: the read that raised `AttributeError: 'DataBin' object has no
    attribute 'meas'` in production lived inside a helper function (`def run_and_count(qc):
    ... return job.result()[0].data.meas...`) defined in one cell and called from another
    with a circuit measured by plain `.measure(...)`, not `measure_all()` — the mistake is
    provable only by knowing NO cell anywhere creates a "meas" register, since a per-cell,
    preceding-only scan cannot see into a function body's own argument at call time. A cell
    that fails to parse is treated as "might create one": the safe direction, since this
    function existing to say "certain to raise" means it must never be fooled by code it
    could not read into saying so.
    """
    for source in sources:
        try:
            tree = ast.parse(source)
        except SyntaxError:
            return False
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr == "measure_all":
                return False
            # A circuit read from OpenQASM text carries whatever registers the text
            # declares, "meas" included, and the text is not in the notebook's code.
            if (isinstance(func, ast.Attribute) and func.attr in _QASM_LOADERS) or (
                isinstance(func, ast.Name) and func.id in _QASM_LOADERS
            ):
                return False
            is_classical_register = (
                isinstance(func, ast.Name) and func.id == "ClassicalRegister"
            ) or (isinstance(func, ast.Attribute) and func.attr == "ClassicalRegister")
            if not is_classical_register:
                continue
            for index, arg in enumerate(node.args):
                # A name that is not a string literal (a variable, an f-string) might be
                # "meas": the safe reading, since this function may only say "never".
                if index == 1 and not (isinstance(arg, ast.Constant) and arg.value != "meas"):
                    return False
            for kw in node.keywords:
                if kw.arg == "name" and not (
                    isinstance(kw.value, ast.Constant) and kw.value.value != "meas"
                ):
                    return False
    return True


@dataclass(frozen=True)
class Diagnostic:
    code: str
    severity: Severity
    line: int
    col: int
    message: str
    end_line: int | None = None
    end_col: int | None = None

    def render(self) -> str:
        return f"line {self.line}: {self.message}"

    def as_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity,
            "line": self.line,
            "col": self.col,
            "end_line": self.end_line,
            "end_col": self.end_col,
            "message": self.message,
        }


#: Findings that are never a false alarm on code that runs: each of these raises. The
#: pipeline repairs a cell carrying one BEFORE spending a sandbox run on it.
DEFINITE: frozenset[str] = frozenset(
    {
        "removed-qiskit-api",
        "measured-circuit-has-no-statevector",
        "forbidden-import",
        "syntax-error",
        "data-meas-without-measure-all",
        "instructionset-has-no-attribute",
    }
)

#: A check that CANNOT fail, in one of the two obvious shapes a repair passing a check by
#: weakening it (rather than fixing it) is caught in. Never a false alarm — either shape
#: is unconditionally suspicious — but not `DEFINITE`: that set means "certain to raise,
#: repair it before running", and these findings mean the opposite, "certain NOT to raise,
#: even when the physics it is meant to prove is wrong", which is a reason to REFUSE a
#: repair (`pipeline._apply_repair`), not to auto-fix a cell for having it.
WEAKENS_CHECK: frozenset[str] = frozenset({"assert-always-true", "assertion-swallowed"})


def _allowed_imports() -> frozenset[str] | None:
    """The guard's own list, or None when the guard is not installed (the Jupyter-only
    install of this package), in which case the import rule is skipped rather than guessed."""
    try:
        from majorana_sandbox.guard import ALLOWED_IMPORTS
    except Exception:  # noqa: BLE001 - optional dependency
        return None
    return frozenset(ALLOWED_IMPORTS)


def _is_quantum_circuit_call(node: ast.AST) -> bool:
    if not isinstance(node, ast.Call):
        return False
    func = node.func
    return (isinstance(func, ast.Name) and func.id == "QuantumCircuit") or (
        isinstance(func, ast.Attribute) and func.attr == "QuantumCircuit"
    )


def _keyword_is_false(call: ast.Call, name: str) -> bool:
    for kw in call.keywords:
        if kw.arg == name and isinstance(kw.value, ast.Constant) and kw.value.value is False:
            return True
    return False


class _Checker(ast.NodeVisitor):
    def __init__(
        self,
        *,
        report: bool,
        allowed: frozenset[str] | None,
        deny_meas_databin: bool = False,
    ) -> None:
        self.report = report
        self.allowed = allowed
        #: True only when NO code cell in the whole notebook could ever create a classical
        #: register named "meas" (`_never_creates_meas_register`) — gates
        #: `data-meas-without-measure-all`, which is a whole-notebook fact, not a per-cell
        #: one, so this is computed once by the caller and threaded through, never derived
        #: from what this one cell (or its preceding cells) happens to contain.
        self.deny_meas_databin = deny_meas_databin
        #: name -> measured? for every name known to hold a QuantumCircuit.
        self.circuits: dict[str, bool] = {}
        self.parents: dict[ast.AST, ast.AST] = {}
        self.found: list[Diagnostic] = []

    # ------------------------------------------------------------------ plumbing

    def run(self, tree: ast.Module) -> None:
        for parent in ast.walk(tree):
            for child in ast.iter_child_nodes(parent):
                self.parents[child] = parent
        for statement in tree.body:
            self.visit(statement)

    def _emit(self, code: str, node: ast.AST, message: str) -> None:
        if not self.report:
            return
        end_col = getattr(node, "end_col_offset", None)
        self.found.append(
            Diagnostic(
                code=code,
                severity=_SEVERITY[code],
                line=getattr(node, "lineno", 1),
                col=getattr(node, "col_offset", 0) + 1,
                end_line=getattr(node, "end_lineno", None),
                end_col=end_col + 1 if end_col is not None else None,
                message=message,
            )
        )

    def _receiver_is_circuit(self, node: ast.AST) -> bool:
        return _is_quantum_circuit_call(node) or (
            isinstance(node, ast.Name) and node.id in self.circuits
        )

    def _circuit_value(self, value: ast.AST) -> bool | None:
        """If `value` evaluates to a circuit, whether that circuit is measured; else None."""
        if _is_quantum_circuit_call(value):
            return False
        if isinstance(value, ast.Name) and value.id in self.circuits:
            return self.circuits[value.id]
        if isinstance(value, ast.Call) and isinstance(value.func, ast.Attribute):
            method = value.func.attr
            receiver = value.func.value
            if method in _CIRCUIT_RETURNING and self._receiver_is_circuit(receiver):
                if method in {"measure_all", "remove_final_measurements"}:
                    if not _keyword_is_false(value, "inplace"):
                        return None  # in place: returns None, and the gate rule says so
                    return _CIRCUIT_RETURNING[method]
                marker = _CIRCUIT_RETURNING[method]
                if marker is not None:
                    return marker
                if isinstance(receiver, ast.Name):
                    return self.circuits.get(receiver.id, False)
                return False
        return None

    # ------------------------------------------------------------------ statements

    def visit_Assign(self, node: ast.Assign) -> None:
        self.visit(node.value)
        measured = self._circuit_value(node.value)
        for target in node.targets:
            self._bind(target, measured)

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:
        if node.value is not None:
            self.visit(node.value)
            self._bind(node.target, self._circuit_value(node.value))

    def _bind(self, target: ast.AST, measured: bool | None) -> None:
        if isinstance(target, ast.Name):
            if measured is None:
                self.circuits.pop(target.id, None)
            else:
                self.circuits[target.id] = measured
        else:
            self.visit(target)

    def visit_Expr(self, node: ast.Expr) -> None:
        self.visit(node.value)
        call = node.value
        if isinstance(call, ast.Call) and isinstance(call.func, ast.Attribute):
            receiver = call.func.value
            if isinstance(receiver, ast.Name) and receiver.id in self.circuits:
                if call.func.attr in {"measure", "measure_all"} and not _keyword_is_false(
                    call, "inplace"
                ):
                    self.circuits[receiver.id] = True
                elif call.func.attr == "remove_final_measurements" and not _keyword_is_false(
                    call, "inplace"
                ):
                    self.circuits[receiver.id] = False

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_module(alias.name, node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        module = node.module or ""
        if node.level:
            return  # a relative import: nothing here can say what it names
        self._check_module(module, node)
        removed = _REMOVED_FROM.get(module, {})
        for alias in node.names:
            if alias.name in removed:
                self._emit("removed-qiskit-api", node, removed[alias.name])

    def _check_module(self, module: str, node: ast.AST) -> None:
        for prefix, message in _REMOVED_MODULES.items():
            if module == prefix or module.startswith(prefix + "."):
                self._emit("removed-qiskit-api", node, message)
                return
        top = module.split(".", 1)[0]
        if self.allowed is not None and top and top not in self.allowed:
            self._emit(
                "forbidden-import",
                node,
                f"The sandbox does not allow `import {top}`. Cells may import only: "
                + ", ".join(sorted(self.allowed))
                + ".",
            )

    # ------------------------------------------------------------------ expressions

    def visit_Call(self, node: ast.Call) -> None:
        func = node.func
        if isinstance(func, ast.Attribute):
            self._check_gate_value(node, func)
            if func.attr in _REMOVED_METHODS:
                self._emit("removed-qiskit-api", node, _REMOVED_METHODS[func.attr])
            elif func.attr == "qasm" and not node.args and not node.keywords:
                self._emit(
                    "removed-qiskit-api",
                    node,
                    "`QuantumCircuit.qasm()` was removed in Qiskit 1.0. Use `qasm2.dumps(qc)` or `qasm3.dumps(qc)`.",
                )
            elif (
                func.attr == "execute"
                and isinstance(func.value, ast.Name)
                and func.value.id == "qiskit"
            ):
                self._emit("removed-qiskit-api", node, _REMOVED_FROM["qiskit"]["execute"])
        self._check_qftgate_keywords(node, func)
        self._check_state_of_measured(node)
        self.generic_visit(node)

    def _check_qftgate_keywords(self, node: ast.Call, func: ast.expr) -> None:
        is_qftgate = (isinstance(func, ast.Name) and func.id == "QFTGate") or (
            isinstance(func, ast.Attribute) and func.attr == "QFTGate"
        )
        if not is_qftgate:
            return
        for kw in node.keywords:
            if kw.arg is not None and kw.arg not in _QFTGATE_VALID_KEYWORDS:
                self._emit(
                    "removed-qiskit-api",
                    node,
                    f"`QFTGate.__init__` takes only `num_qubits` on qiskit 2.5.2 — "
                    f"`{kw.arg}` raises `TypeError: QFTGate.__init__() got an unexpected "
                    f"keyword argument '{kw.arg}'`. For the inverse QFT use "
                    "`QFTGate(n).inverse()` (verified exactly the adjoint of `QFTGate(n)`, "
                    "not just equal up to global phase). `do_swaps`, `approximation_degree` "
                    "and `inverse` belonged to the OLD `qiskit.circuit.library.QFT` class, "
                    "which still exists in 2.5.2 but is deprecated (removed in Qiskit 3.0) — "
                    "prefer `QFTGate`.",
                )
                return

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if (
            self.deny_meas_databin
            and node.attr == "meas"
            and isinstance(node.value, ast.Attribute)
            and node.value.attr == "data"
        ):
            self._emit(
                "data-meas-without-measure-all",
                node,
                "`.data.meas` only exists when the circuit was measured with `measure_all()`, "
                'which creates a classical register literally named "meas". No cell in this '
                'notebook calls `measure_all()` or creates a register named "meas", so this '
                "is certain to raise `AttributeError: 'DataBin' object has no attribute "
                "'meas'`. Read the result by the classical register's own name instead — "
                '`QuantumCircuit(n, m)` creates a register called `"c"` by default (so does '
                "plain `.measure(...)` on a circuit built that way), read as "
                "`.data.c.get_counts()`.",
            )
        self.generic_visit(node)

    def _check_gate_value(self, node: ast.Call, func: ast.Attribute) -> None:
        if func.attr not in GATE_METHODS or not self._receiver_is_circuit(func.value):
            return
        if func.attr == "measure_all" and _keyword_is_false(node, "inplace"):
            return  # returns a new, measured circuit: using the value is the point
        parent = self.parents.get(node)
        if isinstance(parent, ast.Expr):
            return  # a statement: the result is thrown away, which is correct
        if isinstance(parent, ast.Attribute):
            if parent.attr in _INSTRUCTION_SET_ATTRS:
                return  # a real InstructionSet attribute, e.g. `qc.h(0).instructions`
            shown = ast.unparse(node)
            if len(shown) > 60:
                shown = shown[:57] + "..."
            self._emit(
                "instructionset-has-no-attribute",
                parent,
                f"`{shown}.{parent.attr}` reads `.{parent.attr}` off the InstructionSet "
                f"that `.{func.attr}(...)` returns, not the circuit. InstructionSet's real "
                "attributes are `add`, `cargs`, `instructions`, `inverse` and `qargs` — "
                f"nothing named `{parent.attr}` — so this is certain to raise "
                f"`AttributeError: 'InstructionSet' object has no attribute '{parent.attr}'`. "
                "Create the circuit first (for example `qc = QuantumCircuit(1)`), apply the "
                f"gate on its own line (`qc.{func.attr}(0)`), then use `qc.{parent.attr}`.",
            )
            return
        shown = ast.unparse(node)
        if len(shown) > 60:
            shown = shown[:57] + "..."
        if func.attr == "measure_all":
            message = (
                f"`{shown}` measures the circuit in place and returns None, not the circuit. "
                "Call it on its own line and then use the circuit, or use "
                "`measure_all(inplace=False)` for a measured copy."
            )
        else:
            message = (
                f"`{shown}` adds the gate and returns an InstructionSet, not the circuit. "
                "Create the circuit first (for example `qc = QuantumCircuit(1)`), apply the gate "
                "on its own line (`qc.h(0)`), then use `qc`."
            )
        self._emit("gate-returns-instructions", node, message)

    def visit_Assert(self, node: ast.Assert) -> None:
        if _is_trivially_true(node.test):
            shown = ast.unparse(node.test)
            self._emit(
                "assert-always-true",
                node,
                f"`assert {shown}` can never fail — the condition is a constant, not "
                "something computed from the circuit or its results. A check that always "
                "passes proves nothing; assert a concrete value from the run instead.",
            )
        self.generic_visit(node)

    def visit_Try(self, node: ast.Try) -> None:
        if _wraps_an_assert(node.body) and _swallows_assertion_error(node.handlers):
            self._emit(
                "assertion-swallowed",
                node,
                "This `try`/`except` wraps an `assert` and does not re-raise, so the "
                "assertion can never fail the cell — a caught-and-dropped AssertionError "
                "is a check that cannot fail, which is not a check. Remove the "
                "try/except, or re-raise, so a real disagreement with the simulator still "
                "surfaces.",
            )
        self.generic_visit(node)

    def _check_state_of_measured(self, node: ast.Call) -> None:
        func = node.func
        name = None
        if isinstance(func, ast.Name) and func.id in _STATE_BUILDERS:
            name = func.id
        elif isinstance(func, ast.Attribute) and (
            func.attr in _STATE_METHODS or (func.attr in _STATE_BUILDERS)
        ):
            name = func.attr
        if name is None or not node.args:
            return
        argument = node.args[0]
        if isinstance(argument, ast.Name) and self.circuits.get(argument.id) is True:
            self._emit(
                "measured-circuit-has-no-statevector",
                node,
                f"`{argument.id}` has measurements, so it has no statevector or operator. "
                "Build the state from the circuit before measuring it, or pass "
                f"`{argument.id}.remove_final_measurements(inplace=False)`.",
            )


#: Exception names that would catch an `AssertionError`, matched by NAME only — good
#: enough here because a repair reaching for a custom exception class under one of these
#: names to smuggle an assertion past this check would be a stranger and more deliberate
#: evasion than anything seen so far, and the obvious forms are the ones this exists for.
_ASSERTION_SWALLOWING_EXCEPTS: frozenset[str] = frozenset(
    {"Exception", "BaseException", "AssertionError"}
)


def _is_trivially_true(test: ast.expr) -> bool:
    """Whether `test` cannot evaluate to anything but a truthy value, so `assert test`
    can never fail. Deliberately narrow — a `Constant` (`assert True`, `assert 1`,
    `assert "ok"`) or a non-empty tuple literal (`assert True, "message"` parses `msg`
    separately, but `assert (True, "message")` — the parenthesised mistake — is a
    two-element tuple, and a non-empty tuple is always truthy). NOT constant-folded
    (`assert 1 == 1` is not caught): the obvious forms are what a repair reaches for to
    dodge a check, and folding arbitrary expressions risks a false alarm on code that
    merely happens to be foldable, which would teach a reader to ignore this finding.
    """
    if isinstance(test, ast.Constant):
        return bool(test.value)
    if isinstance(test, ast.Tuple):
        return len(test.elts) > 0
    return False


def _wraps_an_assert(body: list[ast.stmt]) -> bool:
    return any(isinstance(node, ast.Assert) for stmt in body for node in ast.walk(stmt))


def _catches_assertion_error(handler: ast.ExceptHandler) -> bool:
    if handler.type is None:
        return True  # bare `except:`
    names = handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
    return any(
        isinstance(name, ast.Name) and name.id in _ASSERTION_SWALLOWING_EXCEPTS for name in names
    )


def _reraises(body: list[ast.stmt]) -> bool:
    return any(isinstance(node, ast.Raise) for stmt in body for node in ast.walk(stmt))


def _swallows_assertion_error(handlers: list[ast.ExceptHandler]) -> bool:
    return any(
        _catches_assertion_error(handler) and not _reraises(handler.body) for handler in handlers
    )


_SEVERITY: dict[str, Severity] = {
    "gate-returns-instructions": "warning",
    "removed-qiskit-api": "error",
    "measured-circuit-has-no-statevector": "error",
    "forbidden-import": "error",
    "syntax-error": "error",
    "assert-always-true": "error",
    "assertion-swallowed": "error",
    "data-meas-without-measure-all": "error",
    "instructionset-has-no-attribute": "error",
}


def lint_cell(
    source: str,
    preceding: Iterable[str] = (),
    *,
    deny_meas_databin: bool = False,
) -> list[Diagnostic]:
    """Findings for one code cell, given the code cells that run before it, in order.

    Earlier cells are read only for the names they bind; their own mistakes are not
    reported here (lint each cell with its own call). An earlier cell that does not parse
    contributes nothing, rather than stopping the check of this one.

    `deny_meas_databin` gates `data-meas-without-measure-all` — a WHOLE-NOTEBOOK fact
    (`_never_creates_meas_register`), not something derivable from `source` and `preceding`
    alone, so it defaults to False (the rule off) for any caller that has not computed it.
    `lint_spec` computes it once, over every cell, and passes it to each call.
    """
    allowed = _allowed_imports()
    state = _Checker(report=False, allowed=allowed)
    for earlier in preceding:
        try:
            state.run(ast.parse(earlier))
        except SyntaxError:
            continue
    try:
        tree = ast.parse(source)
    except SyntaxError as exc:
        return [
            Diagnostic(
                code="syntax-error",
                severity="error",
                line=exc.lineno or 1,
                col=exc.offset or 1,
                message=f"This cell is not valid Python: {exc.msg}.",
            )
        ]
    checker = _Checker(report=True, allowed=allowed, deny_meas_databin=deny_meas_databin)
    checker.circuits = dict(state.circuits)
    checker.run(tree)
    checker.found.sort(key=lambda d: (d.line, d.col, d.code))
    return checker.found


def lint_spec(spec) -> dict[str, list[Diagnostic]]:
    """Findings for every executable code cell of a `NotebookSpec`, keyed by cell id.
    Cells with none are left out."""
    findings: dict[str, list[Diagnostic]] = {}
    preceding: list[str] = []
    deny_meas_databin = _never_creates_meas_register(
        cell.source for cell in spec.cells if cell.is_code
    )
    for cell in spec.cells:
        if not cell.is_code:
            continue
        if not cell.runs_in_sandbox:
            preceding.append(cell.source)
            continue
        found = lint_cell(cell.source, preceding, deny_meas_databin=deny_meas_databin)
        if found:
            findings[cell.id] = found
        preceding.append(cell.source)
    return findings


__all__ = ["DEFINITE", "WEAKENS_CHECK", "Diagnostic", "GATE_METHODS", "lint_cell", "lint_spec"]
