"""What each notebook kind promises, and what each audience is owed, stated as checks.

A kind is a contract about structure. `structure_for(kind, level)` is the text the
generator is told to satisfy; `check_structure(spec)` is the check that can fail. The two
are written side by side so they cannot drift apart unnoticed: every requirement below is
both a sentence in the prompt and a predicate here.

**Two dimensions, because one was doing nothing.** `Audience.level` — newcomer, student,
engineer, researcher — existed on every spec, was dumped into the outline prompt as JSON,
and reached no rule, no prompt branch and no check anywhere in the package. A notebook
asked for a newcomer and a notebook asked for a researcher were held to byte-identical
requirements, so the level could only ever change the model's tone. It now carries the
requirements that actually differ between teaching someone their first circuit and
handing a researcher something they can build on: pacing and repetition at one end,
citation and reproducibility at the other.

The level rules are ADDITIVE to the kind rules and deliberately small. A rule earns its
place by being the thing a reader at that level is failed by when it is missing, and by
being checkable without reading the prose — the lesson of `_asserts_something` below,
which was `"assert" in source` until that was found to pass on `# assert this later`.
"""

from __future__ import annotations

import ast
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


#: Providers whose client objects submit work to real hardware. Kept as import roots
#: rather than class names: a reader can alias the class (`IBMProvider as P`) but the
#: import root has to appear for the module to be reachable at all.
_HARDWARE_IMPORT_ROOTS = frozenset(
    {
        "qiskit_ibm_runtime",
        "qiskit_ibm_provider",
        "qiskit_ionq",
        "braket",
        "azure",
        "qbraid",
        "pennylane_ionq",
        "pennylane_qiskit",
    }
)
#: Free-text tokens for the paths an import root does not catch — a credential write,
#: or the runtime service reached through an already-imported module.
_HARDWARE_TOKENS = ("save_account", "QiskitRuntimeService", "AwsDevice", "AwsQuantumTask")


def _asserts_something(source: str) -> bool:
    """Whether `source` contains a real `assert` STATEMENT.

    Not `"assert" in source`, which was the rule until this was written and which
    passes on `# assert this later`, on `print("we assert nothing")`, and on a variable
    called `assertion_count` — all three verified passing. A checkpoint is the cell that
    decides whether the reader got it right, so a substring is not enough to establish
    that it decides anything.

    Unparseable source counts as NOT asserting: a checkpoint that cannot be parsed
    cannot be shown to check anything, and failing open here would restore exactly the
    hole this replaces.
    """
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    return any(isinstance(node, ast.Assert) for node in ast.walk(tree))


def _checkpoints_assert(spec: NotebookSpec) -> bool:
    checkpoints = [cell for cell in spec.cells if cell.role == CellRole.CHECKPOINT and cell.is_code]
    return bool(checkpoints) and all(_asserts_something(cell.source) for cell in checkpoints)


def _reaches_hardware(source: str) -> bool:
    """Whether `source` reaches a real-QPU client, by import root or by token.

    The sandbox already refuses every one of these (`majorana_sandbox.guard`), and
    production egress is deny-all — so this rule is NOT what stops a job being
    submitted from the product. It matters for the notebook once it LEAVES: an
    exported `.ipynb` runs on the reader's own machine, with their own credentials
    and no guard, and `execute=True` is what says "run this on open". Until this was
    widened the rule matched two spellings of one vendor, so a Braket, IonQ, Azure or
    older-IBM cell exported cleanly with `execute=True`.
    """
    if any(token in source for token in _HARDWARE_TOKENS):
        return True
    try:
        tree = ast.parse(source)
    except SyntaxError:
        # Unparseable: fall back to the token scan above rather than claiming safety.
        return False
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            names = [node.module or ""]
        else:
            continue
        if any((name.split(".")[0] in _HARDWARE_IMPORT_ROOTS) for name in names):
            return True
    return False


def _hardware_cells_do_not_auto_execute(spec: NotebookSpec) -> bool:
    return all(
        not cell.execute for cell in spec.cells if cell.is_code and _reaches_hardware(cell.source)
    )


def _calls_leona_submit(source: str) -> bool:
    """Whether `source` CALLS `leona_submit` — a call node, not the word. A comment, a
    string, or a markdown-style mention in a code cell does not ask for hardware.
    Unparseable source counts as not calling it, the same way `_asserts_something` treats
    it: a cell that cannot be parsed cannot be shown to ask for anything."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    return any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "leona_submit"
        for node in ast.walk(tree)
    )


def _leona_submit_cells_execute(spec: NotebookSpec) -> bool:
    """Every cell that calls `leona_submit` is an ordinary cell the sandbox runs.

    The opposite of the rule above, and the two have to be read together. `leona_submit`
    only records a request while its cell RUNS (`sandbox_program._ln_submit`); an
    `execute=false` cell never runs, so its request would silently never reach the page,
    and the reader would see no way to run the circuit the prose promised. A cell that
    ALSO reaches a vendor SDK is refused here too: the other rule forces it to
    `execute=false`, which is the same silent loss by a longer road — the vendor half
    belongs in its own cell.
    """
    return all(
        cell.runs_in_sandbox and not _reaches_hardware(cell.source)
        for cell in spec.cells
        if cell.is_code and _calls_leona_submit(cell.source)
    )


def _some_cell_submits_through_leona(spec: NotebookSpec) -> bool:
    return any(
        cell.runs_in_sandbox and _calls_leona_submit(cell.source)
        for cell in spec.cells
        if cell.is_code
    )


# ------------------------------------------------------------------ audience-level predicates


def _markdown_at_least_matches_code(spec: NotebookSpec) -> bool:
    code = sum(1 for cell in spec.cells if cell.is_code)
    markdown = sum(1 for cell in spec.cells if not cell.is_code)
    return markdown >= code


def _every_code_cell_is_introduced(spec: NotebookSpec) -> bool:
    """No two code cells run back to back.

    For a newcomer the gap between two consecutive code cells is where the notebook
    stopped teaching and started demonstrating. `setup` is exempt at the very top —
    imports need no essay — and so is a `checkpoint` or a hidden-grader cell, which
    belongs immediately after the code it checks rather than after a paragraph.
    """
    exempt = {CellRole.SETUP, CellRole.CHECKPOINT}
    previous_was_code = False
    for cell in spec.cells:
        if not cell.is_code:
            previous_was_code = False
            continue
        if previous_was_code and cell.role not in exempt:
            return False
        previous_was_code = True
    return True


def _loop_repetitions(spec: NotebookSpec) -> int:
    """How many complete predict → run → observe → explain → modify sequences appear.

    Counted greedily and in order, the same way `_loop_present` finds one: the roles of a
    loop may be separated by other cells, but they must arrive in the loop's order, and a
    sequence is only counted once it completes.
    """
    wanted = list(LEARNING_LOOP)
    position = 0
    completed = 0
    for cell in spec.cells:
        if cell.role == wanted[position]:
            position += 1
            if position == len(wanted):
                completed += 1
                position = 0
    return completed


def _code_cells_are_short(limit: int) -> "callable[[NotebookSpec], bool]":
    """Every code cell is at most `limit` non-blank lines.

    A beginner reading a forty-line cell is reading, not learning: whatever it does, the
    notebook has stopped being able to say which line did it. Blank lines do not count,
    so this constrains substance rather than punishing readable spacing.
    """

    def check(spec: NotebookSpec) -> bool:
        return all(
            len([line for line in cell.source.splitlines() if line.strip()]) <= limit
            for cell in spec.cells
            if cell.is_code
        )

    return check


def _has_an_exercise_with_a_stub(spec: NotebookSpec) -> bool:
    return any(cell.is_code and cell.stub is not None and cell.stub.strip() for cell in spec.cells)


def _cites_literature(spec: NotebookSpec) -> bool:
    return bool(spec.references) and _has_role(CellRole.REFERENCES)(spec)


def _explains_after_the_last_run(spec: NotebookSpec) -> bool:
    """An interpretation arrives after the final result, not only before it.

    A research notebook that ends on its last output has reported a number and said
    nothing about it. `observe` does not satisfy this: describing what appeared is not
    the same as saying what it means.
    """
    last_run = max(
        (index for index, cell in enumerate(spec.cells) if cell.role == CellRole.RUN),
        default=None,
    )
    if last_run is None:
        return False
    return any(
        cell.role in {CellRole.EXPLAIN, CellRole.SUMMARY} for cell in spec.cells[last_run + 1 :]
    )


#: Constructors whose output is random unless they are told otherwise. Matched on the
#: callee's own name, so an aliased import (`from qiskit.primitives import
#: StatevectorSampler as S`) is missed — deliberate: a name-based miss reports the
#: notebook as compliant, which is the safe direction for an ADVISORY rule and the wrong
#: direction for a security one. This is the former.
_SAMPLING_CONSTRUCTORS = frozenset(
    {
        "StatevectorSampler",
        "StatevectorEstimator",
        "SamplerV2",
        "EstimatorV2",
        "Sampler",
        "Estimator",
        "AerSimulator",
        "GenericBackendV2",
        "default_rng",
    }
)
#: Any of these keywords counts as seeding it; the SDKs disagree on the spelling.
_SEED_KEYWORDS = frozenset({"seed", "seed_simulator", "seed_transpiler"})


def _sampling_is_seeded(spec: NotebookSpec) -> bool:
    """Every sampler, estimator or RNG is constructed with a seed.

    Reproducibility is the difference between a research notebook and a demonstration:
    without a seed the reader cannot get the author's number back, and cannot tell a real
    disagreement from shot noise. `default_rng()` is included because a numpy RNG seeded
    by the clock is the same problem wearing different clothes.

    An unparseable cell counts as seeded rather than failing the notebook — this is an
    advisory writing rule, and a syntax error is `check_structure`'s least useful thing
    to report when the sandbox is about to report it precisely.
    """
    for cell in spec.cells:
        if not cell.is_code:
            continue
        try:
            tree = ast.parse(cell.source)
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            name = (
                node.func.id
                if isinstance(node.func, ast.Name)
                else node.func.attr
                if isinstance(node.func, ast.Attribute)
                else None
            )
            if name not in _SAMPLING_CONSTRUCTORS:
                continue
            seeded = any(kw.arg in _SEED_KEYWORDS for kw in node.keywords if kw.arg)
            # `default_rng(42)` seeds positionally; the qiskit primitives do not.
            if name == "default_rng" and node.args:
                seeded = True
            if not seeded:
                return False
    return True


def _states_its_mathematics(spec: NotebookSpec) -> bool:
    return spec.style.math_level != "none"


def _every_solution_answers_a_preceding_exercise(spec: NotebookSpec) -> bool:
    """Each `role=solution` cell has its own `role=exercise` cell earlier in the notebook.

    The SOLUTION rule's prose has promised this since it was written — "each is preceded
    by the exercise it answers" — while its predicate was `_has_role(CellRole.SOLUTION)`,
    which is satisfied by a notebook that is nothing but solutions in a row. This module's
    own docstring is the reason that matters: every requirement here is "both a sentence
    in the prompt and a predicate", written side by side "so they cannot drift apart
    unnoticed". They drifted, and the sentence is the half the model is given.

    Distinct exercises, not merely one somewhere before: three solutions after a single
    exercise is a solution notebook that has stopped saying which answer belongs to which
    question, which is exactly what the ordering was for.
    """
    unmatched = 0
    for cell in spec.cells:
        if cell.role == CellRole.EXERCISE:
            unmatched += 1
        elif cell.role == CellRole.SOLUTION:
            if unmatched == 0:
                return False
            unmatched -= 1
    return True


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
    StructureRule(
        "A cell that calls leona_submit(circuit, shots=...) is an ordinary execute=true cell that "
        "imports nothing from a vendor SDK and reads no token.",
        _leona_submit_cells_execute,
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
            lambda spec: (
                _has_role(CellRole.SOLUTION)(spec)
                and _every_solution_answers_a_preceding_exercise(spec)
            ),
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
        StructureRule(
            "At least one execute=true cell builds the measured circuit and calls "
            "leona_submit(circuit, shots=...), so the reader can run it on a real device "
            "from the notebook page after seeing the price.",
            _some_cell_submits_through_leona,
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

#: What each audience is owed, on top of whatever the kind requires. Keyed by
#: `Audience.level`.
#:
#: `engineer` is the default level on every `Audience`, and therefore the level of every
#: notebook and curriculum written before this existed. Its rule set is deliberately
#: EMPTY: adding a requirement here would retroactively fail content that was correct
#: when it was authored, and `check_structure` is a hard gate in the pipeline. An empty
#: tuple is the honest statement that the default level asks for nothing beyond its kind.
_LEVEL_RULES: dict[str, tuple[StructureRule, ...]] = {
    "newcomer": (
        StructureRule(
            "There are at least as many markdown cells as code cells — a newcomer needs "
            "at least as much explanation as code.",
            _markdown_at_least_matches_code,
        ),
        StructureRule(
            "No two code cells run back to back: every code cell is introduced by prose "
            "saying what it is about to do and what to watch for. A setup cell at the top, "
            "and a checkpoint straight after the cell it checks, are the exceptions.",
            _every_code_cell_is_introduced,
        ),
        StructureRule(
            "The predict → run → observe → explain → modify loop is completed at least "
            "TWICE, so the idea is met more than once rather than demonstrated and dropped.",
            lambda spec: _loop_repetitions(spec) >= 2,
        ),
        StructureRule(
            "No code cell is longer than 20 non-blank lines; split anything bigger, so the "
            "notebook can still say which line produced what.",
            _code_cells_are_short(20),
        ),
    ),
    "student": (
        StructureRule(
            "The predict → run → observe → explain → modify loop is completed at least once.",
            _loop_present,
        ),
        StructureRule(
            "There is at least one exercise the reader fills in: a code cell carrying a "
            "stub, so they write something before being shown the answer.",
            _has_an_exercise_with_a_stub,
        ),
        StructureRule(
            "There are at least two checkpoint cells, each asserting something concrete "
            "about what the reader just produced.",
            lambda spec: _has_role(CellRole.CHECKPOINT, 2)(spec) and _checkpoints_assert(spec),
        ),
    ),
    "engineer": (),
    "researcher": (
        StructureRule(
            "Every claim taken from the literature is cited: the notebook lists references "
            "and ends with a role=references cell naming them. Never invent a citation.",
            _cites_literature,
        ),
        StructureRule(
            "Every sampler, estimator, simulated backend or random generator is constructed "
            "with an explicit seed, so the reader gets the same numbers back and can tell a "
            "real disagreement from shot noise.",
            _sampling_is_seeded,
        ),
        StructureRule(
            "The last result is interpreted after it is produced: a role=explain or "
            "role=summary cell comes after the final role=run cell, saying what the number "
            "means and what it does not establish.",
            _explains_after_the_last_run,
        ),
        StructureRule(
            "The mathematics is stated rather than skipped — this audience is not served by "
            "an analogy in place of the expression.",
            _states_its_mathematics,
        ),
    ),
}

#: Named starting points aimed at the far end of the audience range. The `STARTER_BRIEFS`
#: below were all newcomer-to-intermediate, so the product's own suggestions only ever
#: demonstrated half of what the generator can be asked for.
RESEARCH_BRIEFS: tuple[dict[str, str], ...] = (
    {
        "id": "reproduce-a-paper-circuit",
        "kind": "walkthrough",
        "level": "researcher",
        "title": "Reproduce a circuit from a paper",
        "brief": (
            "I have a paper with an ansatz I want to reproduce. Build its circuit in Qiskit "
            "exactly as specified, state where in the paper each construction choice comes "
            "from, run it on a statevector simulator with a fixed seed, and compare what you "
            "get against the figure the paper reports. Say plainly which parts of the paper "
            "the reproduction does not cover."
        ),
    },
    {
        "id": "error-mitigation-study",
        "kind": "benchmark",
        "level": "researcher",
        "title": "Does zero-noise extrapolation earn its shots?",
        "brief": (
            "Compare a raw expectation value against a zero-noise-extrapolated one on the "
            "same observable and the same noisy backend, at matched total shot budget. Report "
            "bias and variance separately, seed everything, and state what the comparison "
            "does not establish — in particular that a fake backend's noise model has no "
            "coherent error, so it flatters any twirling-based method."
        ),
    },
    {
        "id": "resource-estimate",
        "kind": "benchmark",
        "level": "researcher",
        "title": "What would this actually cost on hardware?",
        "brief": (
            "Take an algorithm I give you, transpile it to a real device's ISA at several "
            "optimisation levels, and report two-qubit gate count, depth and estimated "
            "duration for each. Plot how the count scales with problem size. Be explicit "
            "that a transpiled count is a lower bound on what a run costs."
        ),
    },
    {
        "id": "ansatz-expressibility",
        "kind": "lab",
        "level": "researcher",
        "title": "Expressibility and entangling capability of an ansatz",
        "brief": (
            "Measure expressibility (KL divergence of the fidelity distribution against Haar) "
            "and Meyer-Wallach entangling capability for two parameterised circuits at "
            "matched parameter count. Seed the sampling, show the fidelity histograms, and "
            "state the sample-size error on both numbers before comparing them."
        ),
    },
    {
        "id": "barren-plateau-probe",
        "kind": "lab",
        "level": "researcher",
        "title": "Watch a barren plateau appear",
        "brief": (
            "Show the variance of a cost-function gradient collapsing as a hardware-efficient "
            "ansatz gets wider, for a fixed observable. Fit the decay, compare it against the "
            "exponential the literature predicts, and say what the fit does not establish "
            "about trainability at the sizes we can actually simulate."
        ),
    },
)


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


def structure_for(kind: NotebookKind, level: str | None = None) -> list[str]:
    """The requirements a notebook of this kind, for this audience, must satisfy.

    `level` is optional so every existing caller keeps working; passing it is what makes
    a beginner course and a research notebook different documents rather than the same
    document in a different register.
    """
    rules = list(_RULES[kind])
    rules += list(_LEVEL_RULES.get(level or "", ()))
    return [rule.text for rule in rules]


def check_structure(spec: NotebookSpec) -> list[str]:
    """The requirements this spec fails. Empty means the structure holds.

    The level is read off the spec rather than passed in, so a notebook cannot be checked
    against a different audience from the one it declares.
    """
    rules = list(_RULES[spec.kind]) + list(_LEVEL_RULES.get(spec.audience.level, ()))
    return [rule.text for rule in rules if not rule.check(spec)]


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
        "brief": "Take a Bell circuit from local simulation to a real IBM QPU: simulate it first, then hand it to leona_submit so I can pick a device, see the price and run it from this page. Also show the qiskit-ibm-runtime version (token from an environment variable, ISA transpilation, SamplerV2, retrieving the job) for running it from my own machine. Never put a token in the notebook.",
    },
    {
        "id": "certification-drill",
        "kind": "quiz",
        "title": "Certification practice: primitives and results",
        "brief": "Ten original practice questions in the style of the IBM Qiskit developer certification on SamplerV2 and EstimatorV2 inputs and result objects, each with a code cell that checks the answer.",
    },
)
