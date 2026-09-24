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
        "h", "x", "y", "z", "s", "sdg", "t", "tdg", "sx", "sxdg",
        "rx", "ry", "rz", "rxx", "ryy", "rzz", "rzx", "p", "u", "r",
        "cx", "cy", "cz", "ch", "cp", "crx", "cry", "crz", "cu", "cs", "csdg", "csx",
        "ccx", "ccz", "cswap", "swap", "iswap", "dcx", "ecr", "mcx", "mcp",
        "rv", "id", "barrier", "measure", "measure_all", "reset", "append", "delay",
        "initialize", "unitary", "prepare_state",
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
_REMOVED_METHODS: dict[str, str] = {
    "bind_parameters": "`bind_parameters` was removed in Qiskit 1.0. Use `assign_parameters`.",
}

#: Constructors and methods that need a circuit WITHOUT measurements.
_STATE_BUILDERS: frozenset[str] = frozenset({"Statevector", "Operator", "DensityMatrix"})
_STATE_METHODS: frozenset[str] = frozenset({"from_instruction", "evolve"})


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
    {"removed-qiskit-api", "measured-circuit-has-no-statevector", "forbidden-import", "syntax-error"}
)


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
    def __init__(self, *, report: bool, allowed: frozenset[str] | None) -> None:
        self.report = report
        self.allowed = allowed
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
        self._check_state_of_measured(node)
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
            return  # `qc.h(0).c_if(...)`: using the InstructionSet on purpose
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

    def _check_state_of_measured(self, node: ast.Call) -> None:
        func = node.func
        name = None
        if isinstance(func, ast.Name) and func.id in _STATE_BUILDERS:
            name = func.id
        elif isinstance(func, ast.Attribute) and (
            func.attr in _STATE_METHODS
            or (func.attr in _STATE_BUILDERS)
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


_SEVERITY: dict[str, Severity] = {
    "gate-returns-instructions": "warning",
    "removed-qiskit-api": "error",
    "measured-circuit-has-no-statevector": "error",
    "forbidden-import": "error",
    "syntax-error": "error",
}


def lint_cell(source: str, preceding: Iterable[str] = ()) -> list[Diagnostic]:
    """Findings for one code cell, given the code cells that run before it, in order.

    Earlier cells are read only for the names they bind; their own mistakes are not
    reported here (lint each cell with its own call). An earlier cell that does not parse
    contributes nothing, rather than stopping the check of this one.
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
    checker = _Checker(report=True, allowed=allowed)
    checker.circuits = dict(state.circuits)
    checker.run(tree)
    checker.found.sort(key=lambda d: (d.line, d.col, d.code))
    return checker.found


def lint_spec(spec) -> dict[str, list[Diagnostic]]:
    """Findings for every executable code cell of a `NotebookSpec`, keyed by cell id.
    Cells with none are left out."""
    findings: dict[str, list[Diagnostic]] = {}
    preceding: list[str] = []
    for cell in spec.cells:
        if not cell.is_code:
            continue
        if getattr(cell, "execute", True) is False:
            preceding.append(cell.source)
            continue
        found = lint_cell(cell.source, preceding)
        if found:
            findings[cell.id] = found
        preceding.append(cell.source)
    return findings


__all__ = ["DEFINITE", "Diagnostic", "GATE_METHODS", "lint_cell", "lint_spec"]
