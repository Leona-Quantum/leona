"""A reader's own circuit as a notebook seed — "build a lesson around THIS circuit."

`Seed(kind="circuit", content=<pasted text>)` carries either OpenQASM 3 or Qiskit
Python. `validate_circuit_seed` is the one gate a circuit seed passes through before
its material reaches a prompt or its code reaches a `run` cell:

- OpenQASM 3 is PARSED with `qiskit.qasm3.loads` — never executed. Parsing is not
  execution, so (per AGENTS.md's sandbox invariant) it is allowed to run here, in the
  worker, outside the sandbox.
- Python is checked with the SAME static guard the sandbox runs before any cell
  (`majorana_sandbox.guard.check_python_code`) and refused on any finding. A circuit
  seed that passes is still never `exec`'d here — its description is read with `ast`
  alone, and the verbatim text becomes the reader's own `run` cell, executed later,
  in the sandbox, like every other cell.
"""

from __future__ import annotations

import ast
from collections import Counter
from dataclasses import dataclass
from typing import Literal

CircuitLanguage = Literal["qasm3", "python"]


def classify_circuit_text(text: str) -> CircuitLanguage:
    """OpenQASM 3 if the text opens with (or declares, anywhere) an `OPENQASM 3`
    version pragma or a `qubit[` array declaration; Python otherwise. A comment or
    blank line may precede the pragma, so this checks containment, not a strict
    prefix — the same tolerance `majorana_openqasm.program.detect_version` gives a
    provenance-commented QASM header."""
    if "OPENQASM 3" in text or "qubit[" in text:
        return "qasm3"
    return "python"


@dataclass(frozen=True)
class CircuitSeedMaterial:
    """What a validated circuit seed contributes: prose for the outline/draft
    prompts, and the verbatim source of the notebook's first `run` cell."""

    language: CircuitLanguage
    description_text: str
    run_cell_source: str


def _embed_triple_quoted(name: str, text: str) -> str:
    body = text.strip()
    # QASM3 include statements use plain double quotes ("stdgates.inc"); a
    # literal `"""` inside a reader's program is not realistic, but a program
    # that does contain one still embeds cleanly with the other delimiter
    # rather than producing a syntax error in the generated cell.
    quote = "'''" if '"""' in body else '"""'
    return f"{name} = {quote}\n{body}\n{quote}"


def _describe_qasm3(text: str) -> CircuitSeedMaterial | list[str]:
    from qiskit import qasm3

    try:
        circuit = qasm3.loads(text)
    except Exception as exc:  # noqa: BLE001 - reported as a refusal finding, not raised
        return [f"could not parse as OpenQASM 3: {exc}"]
    ops = circuit.count_ops()
    gate_counts = ", ".join(f"{name}={count}" for name, count in sorted(ops.items()))
    description = (
        f"OpenQASM 3 circuit: {circuit.num_qubits} qubit(s), {circuit.num_clbits} classical "
        f"bit(s), depth {circuit.depth()}. Gate counts: {gate_counts or '(none)'}."
    )
    run_cell = (
        f"{_embed_triple_quoted('QASM', text)}\n\n"
        "from qiskit import qasm3\n\n"
        "qc = qasm3.loads(QASM)\n"
        "qc.draw()\n"
    )
    return CircuitSeedMaterial("qasm3", description, run_cell)


def _callee_name(func: ast.expr) -> str | None:
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


class _CircuitVisitor(ast.NodeVisitor):
    """Reads a description off the syntax tree only — this never calls `exec`,
    `eval`, or imports the reader's text as a module."""

    def __init__(self) -> None:
        self.imports: list[str] = []
        self.qc_names: list[str] = []
        self.gate_calls: Counter[str] = Counter()

    def visit_Import(self, node: ast.Import) -> None:  # noqa: N802 - ast.NodeVisitor API
        self.imports.extend(alias.name for alias in node.names)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:  # noqa: N802
        if node.module:
            self.imports.append(node.module)
        self.generic_visit(node)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        if isinstance(node.value, ast.Call) and _callee_name(node.value.func) == "QuantumCircuit":
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.qc_names.append(target.id)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        if (
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id in self.qc_names
        ):
            self.gate_calls[node.func.attr] += 1
        self.generic_visit(node)


def _describe_python(text: str) -> CircuitSeedMaterial | list[str]:
    from majorana_sandbox.guard import check_python_code

    guard = check_python_code(text)
    if not guard.ok:
        return guard.violations

    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        return [f"not valid Python: {exc}"]

    visitor = _CircuitVisitor()
    visitor.visit(tree)
    imports = ", ".join(sorted(set(visitor.imports))) or "(none)"
    qc_names = ", ".join(visitor.qc_names) or "(none found at top level)"
    gate_summary = (
        ", ".join(f"{name}={count}" for name, count in sorted(visitor.gate_calls.items()))
        or "(none detected)"
    )
    description = (
        f"Python (Qiskit) circuit. Imports: {imports}. QuantumCircuit variable(s): {qc_names}. "
        f"Gate/method calls: {gate_summary}."
    )
    return CircuitSeedMaterial("python", description, text)


def validate_circuit_seed(text: str) -> CircuitSeedMaterial | list[str]:
    """Classify, guard/parse, and describe a reader's pasted circuit. Returns the
    seed material on success, or a non-empty list of findings on refusal — never
    raises, so the caller decides what a refusal means (the worker fails the run
    with `circuit_seed_rejected` and these findings as the reason)."""
    language = classify_circuit_text(text)
    if language == "qasm3":
        return _describe_qasm3(text)
    return _describe_python(text)
