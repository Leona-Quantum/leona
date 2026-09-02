"""What each notebook kind promises, stated as checks.

A kind is a contract about structure. `structure_for(kind)` is the text the generator
is told to satisfy; `check_structure(spec)` is the check that can fail. The two are
written side by side so they cannot drift apart unnoticed: every requirement below is
both a sentence in the prompt and a predicate here.
"""

from __future__ import annotations

from dataclasses import dataclass

from leona_notebooks.spec import LEARNING_LOOP, CellRole, NotebookKind, NotebookSpec


@dataclass(frozen=True)
class StructureRule:
    """One requirement, both as prose (for the model) and as a predicate (for us)."""

    text: str
    check: "callable[[NotebookSpec], bool]"  # noqa: UP037 - forward ref for readability


def _has_role(role: CellRole, minimum: int = 1) -> "callable[[NotebookSpec], bool]":
    return lambda spec: sum(1 for cell in spec.cells if cell.role == role) >= minimum


def _first_is(role: CellRole) -> "callable[[NotebookSpec], bool]":
    return lambda spec: bool(spec.cells) and spec.cells[0].role == role


def _last_is_one_of(*roles: CellRole) -> "callable[[NotebookSpec], bool]":
    return lambda spec: bool(spec.cells) and spec.cells[-1].role in roles


def _loop_present(spec: NotebookSpec) -> bool:
    """At least one full predict → run → observe → explain → modify sequence appears,
    in order (other cells may sit between the steps)."""
    wanted = list(LEARNING_LOOP)
    position = 0
    for cell in spec.cells:
        if position < len(wanted) and cell.role == wanted[position]:
            position += 1
    return position == len(wanted)


def _every_solution_has_stub(spec: NotebookSpec) -> bool:
    return all(
        cell.stub is not None
        for cell in spec.cells
        if cell.role == CellRole.SOLUTION and cell.is_code
    )


def _has_code(spec: NotebookSpec) -> bool:
    return any(cell.is_code for cell in spec.cells)


def _checkpoints_assert(spec: NotebookSpec) -> bool:
    checkpoints = [cell for cell in spec.cells if cell.role == CellRole.CHECKPOINT and cell.is_code]
    return bool(checkpoints) and all("assert" in cell.source for cell in checkpoints)


def _hardware_cells_do_not_auto_execute(spec: NotebookSpec) -> bool:
    return all(
        not cell.execute
        for cell in spec.cells
        if cell.is_code and ("QiskitRuntimeService" in cell.source or "save_account" in cell.source)
    )


_COMMON: tuple[StructureRule, ...] = (
    StructureRule(
        "The first cell is a markdown cell with role=objective saying what the reader will build or learn.",
        _first_is(CellRole.OBJECTIVE),
    ),
    StructureRule(
        "The notebook ends with a markdown cell of role=summary or role=references.",
        _last_is_one_of(CellRole.SUMMARY, CellRole.REFERENCES),
    ),
    StructureRule("There is at least one code cell.", _has_code),
    StructureRule(
        "Any cell that would talk to IBM Quantum (QiskitRuntimeService, save_account) is marked execute=false.",
        _hardware_cells_do_not_auto_execute,
    ),
)

_RULES: dict[NotebookKind, tuple[StructureRule, ...]] = {
    NotebookKind.LESSON: (
        *_COMMON,
        StructureRule(
            "Every concept is taught through the loop predict → run → observe → explain → modify, using those cell roles in that order at least once.",
            _loop_present,
        ),
        StructureRule(
            "Every checkpoint cell (role=checkpoint) is code containing an assert that would fail if the earlier cells were wrong.",
            _checkpoints_assert,
        ),
        StructureRule(
            "There is at least one markdown cell of role=concept.", _has_role(CellRole.CONCEPT)
        ),
    ),
    NotebookKind.LAB: (
        *_COMMON,
        StructureRule(
            "The lab follows predict → run → observe → explain → modify at least once, in that order.",
            _loop_present,
        ),
        StructureRule(
            "There are at least two checkpoint cells, each asserting something about the reader's results.",
            lambda spec: _has_role(CellRole.CHECKPOINT, 2)(spec) and _checkpoints_assert(spec),
        ),
        StructureRule(
            "There is a role=setup code cell near the top that imports what the lab needs and prints the Qiskit version.",
            _has_role(CellRole.SETUP),
        ),
    ),
    NotebookKind.CHALLENGE: (
        *_COMMON,
        StructureRule(
            "Each task is a markdown cell of role=exercise followed by a code cell of role=solution that carries a stub (the learner-facing placeholder).",
            lambda spec: (
                _has_role(CellRole.EXERCISE)(spec)
                and _has_role(CellRole.SOLUTION)(spec)
                and _every_solution_has_stub(spec)
            ),
        ),
        StructureRule(
            "Every checkpoint tolerates the stub: it asserts only when the learner's variable is not None.",
            _checkpoints_assert,
        ),
        StructureRule("There is at least one role=hint markdown cell.", _has_role(CellRole.HINT)),
    ),
    NotebookKind.SOLUTION: (
        *_COMMON,
        StructureRule(
            "Solutions are role=solution code cells; each is preceded by the exercise it answers.",
            _has_role(CellRole.SOLUTION),
        ),
    ),
    NotebookKind.WALKTHROUGH: (
        *_COMMON,
        StructureRule(
            "The seed's own code appears verbatim in a role=run cell before any modification of it.",
            _has_role(CellRole.RUN),
        ),
        StructureRule(
            "Every claim taken from the source is in a role=explain cell that names where in the source it comes from.",
            _has_role(CellRole.EXPLAIN),
        ),
        StructureRule(
            "There is a role=references markdown cell listing the seed and every paper cited.",
            _has_role(CellRole.REFERENCES),
        ),
    ),
    NotebookKind.DEMO: (
        *_COMMON,
        StructureRule(
            "One role=run cell builds and runs the circuit; one role=observe cell shows the result; one role=explain cell explains it.",
            lambda spec: all(
                _has_role(r)(spec) for r in (CellRole.RUN, CellRole.OBSERVE, CellRole.EXPLAIN)
            ),
        ),
    ),
    NotebookKind.QUIZ: (
        *_COMMON,
        StructureRule(
            "Each question is a markdown cell of role=question; its answer is a role=answer cell (markdown or code) so the challenge build hides it.",
            lambda spec: (
                _has_role(CellRole.QUESTION, 3)(spec) and _has_role(CellRole.ANSWER, 3)(spec)
            ),
        ),
    ),
    NotebookKind.HARDWARE: (
        *_COMMON,
        StructureRule(
            "Every cell that needs an IBM Quantum account is execute=false and is preceded by a markdown cell saying what it costs and how to get the token from the environment, never from the notebook.",
            _hardware_cells_do_not_auto_execute,
        ),
        StructureRule(
            "A local execute=true path (a simulated backend such as GenericBackendV2 or a fake backend) runs the same ISA circuit first.",
            _has_role(CellRole.RUN),
        ),
    ),
    NotebookKind.BENCHMARK: (
        *_COMMON,
        StructureRule(
            "Both methods run on the same problem instance in role=run cells, and a role=observe cell puts their results side by side.",
            lambda spec: _has_role(CellRole.RUN, 2)(spec) and _has_role(CellRole.OBSERVE)(spec),
        ),
        StructureRule(
            "A role=explain cell states what the comparison does and does not establish.",
            _has_role(CellRole.EXPLAIN),
        ),
    ),
    NotebookKind.PROJECT: (
        *_COMMON,
        StructureRule(
            "The project has role=exercise cells for each milestone and a role=checkpoint that verifies the integration.",
            lambda spec: (
                _has_role(CellRole.EXERCISE, 2)(spec) and _has_role(CellRole.CHECKPOINT)(spec)
            ),
        ),
    ),
    NotebookKind.SCRATCH: (StructureRule("There is at least one code cell.", _has_code),),
}

KIND_DESCRIPTIONS: dict[NotebookKind, str] = {
    NotebookKind.LESSON: "A guided lesson: one idea at a time, each taught by predicting, running, observing, explaining, then changing something.",
    NotebookKind.LAB: "A hands-on session notebook with checkpoints — the main notebook of a study-group meeting.",
    NotebookKind.CHALLENGE: "Answer-free tasks with stubs; the solution notebook is derived from the same source.",
    NotebookKind.SOLUTION: "A challenge with every solution in place, plus the self-evaluation checklist.",
    NotebookKind.WALKTHROUGH: "An Atlas record or a paper walked line by line, with the source's own code run first.",
    NotebookKind.DEMO: "One algorithm, built, run and explained.",
    NotebookKind.QUIZ: "Practice questions with hidden answers and self-check cells.",
    NotebookKind.HARDWARE: "A credential-safe path from a local simulation to a real QPU job.",
    NotebookKind.BENCHMARK: "Two methods or backends compared on one problem, with what the comparison does not show stated.",
    NotebookKind.PROJECT: "A capstone template with milestones and an integration checkpoint.",
    NotebookKind.SCRATCH: "A freeform notebook — imported or a researcher's own.",
}


def structure_for(kind: NotebookKind) -> list[str]:
    """The requirements a notebook of this kind must satisfy, as prompt text."""
    return [rule.text for rule in _RULES[kind]]


def check_structure(spec: NotebookSpec) -> list[str]:
    """The requirements this spec fails. Empty means the structure holds."""
    return [rule.text for rule in _RULES[spec.kind] if not rule.check(spec)]


#: Named starting points the product offers before the reader types anything. Each is a
#: brief the generator would receive verbatim; the point is that a newcomer sees what a
#: good ask looks like.
STARTER_BRIEFS: tuple[dict[str, str], ...] = (
    {
        "id": "first-circuit",
        "kind": "lesson",
        "title": "My first quantum circuit",
        "brief": "I know Python but nothing about quantum computing. Teach me to build a one-qubit circuit in Qiskit, run it, and understand why the results are random. Use a coin-flip analogy.",
    },
    {
        "id": "bell-state",
        "kind": "lesson",
        "title": "Entanglement, hands on",
        "brief": "Show me what entanglement means by building a Bell state, measuring both qubits many times, and comparing with two independent coins. Keep the maths minimal; explain the bitstring order Qiskit uses.",
    },
    {
        "id": "grover-2q",
        "kind": "demo",
        "title": "Two-qubit Grover search",
        "brief": "Demonstrate Grover's algorithm on two qubits: build the oracle for one marked state, apply the diffusion operator, and show the marked state's probability after one iteration.",
    },
    {
        "id": "transpile-to-target",
        "kind": "lab",
        "title": "From an ideal circuit to a target-compatible one",
        "brief": "A lab on transpilation in Qiskit 2.x: a Target, basis gates, routing, and what an ISA circuit is. Use GenericBackendV2 so nothing needs an account.",
    },
    {
        "id": "vqe-one-qubit",
        "kind": "lab",
        "title": "A one-qubit variational solver",
        "brief": "Build a parameterised one-qubit circuit, define an objective with EstimatorV2, and minimise it with scipy. Show the energy landscape as a plot.",
    },
    {
        "id": "hardware-first-job",
        "kind": "hardware",
        "title": "Your first job on IBM Quantum hardware",
        "brief": "Take a Bell circuit from local simulation to a real IBM QPU with qiskit-ibm-runtime: account setup from an environment variable, ISA transpilation, SamplerV2 submission, job monitoring and retrieval. Never put a token in the notebook.",
    },
    {
        "id": "certification-drill",
        "kind": "quiz",
        "title": "Certification practice: primitives and results",
        "brief": "Ten original practice questions in the style of the IBM Qiskit developer certification on SamplerV2 and EstimatorV2 inputs and result objects, each with a code cell that checks the answer.",
    },
)
