"""Prompts for the notebook pipeline: outline → draft → repair → revise → review.

These are plain constants and small renderers, like `majorana_llm.prompts`, kept here so
the notebook lane owns its own words. The worker supplies the model call; this module
supplies what to say and what shape to expect back.

Every prompt that asks for notebook cells asks for the `.nb.py` percent format
(`leona_notebooks.source`), never for cells inside JSON — a model escaping Python into
JSON string literals fails on the notebook it cares least about.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from majorana_contracts.notebooks import MAX_HARDWARE_REQUESTS_PER_NOTEBOOK, NotebookReview

from leona_notebooks.spec import Audience, CellRole, Framework, NotebookKind, Reference, Seed, Style
from leona_notebooks.templates import KIND_DESCRIPTIONS, structure_for

# --------------------------------------------------------------------------- framework facts

#: What is true of the framework the cells run against. Verified on 2026-09-02 against
#: qiskit 2.5.2 with DeprecationWarning raised as an error. A wrong "fact" here ships a
#: failing cell to every reader, so this block changes only with a probe run.
QISKIT_2_FACTS = """\
Qiskit 2.5 facts (verified against 2.5.2; the in-place and measurement lines re-probed 2026-09-23):
- Imports: `from qiskit import QuantumCircuit`; `from qiskit.primitives import StatevectorSampler, StatevectorEstimator`;
  `from qiskit.quantum_info import SparsePauliOp, Statevector, Operator`;
  `from qiskit.transpiler import generate_preset_pass_manager`;
  `from qiskit.providers.fake_provider import GenericBackendV2`; `from qiskit.circuit import Parameter`.
- REMOVED, never use: `qiskit.execute`, `BasicAer`, `Aer` from `qiskit`, `qiskit.primitives.Sampler`/`Estimator` (V1),
  `QuantumCircuit.qasm()`, `bind_parameters` (use `assign_parameters`), `qiskit.opflow`, `qiskit.algorithms`.
- Sampling: `sampler = StatevectorSampler(seed=42)`; `job = sampler.run([qc], shots=1000)`;
  `counts = job.result()[0].data.meas.get_counts()` — `meas` is the register name `measure_all()` creates;
  a named classical register `c` is read as `.data.c.get_counts()`.
- Expectation values: `est = StatevectorEstimator()`; `ev = est.run([(qc, SparsePauliOp("ZZ"))]).result()[0].data.evs`
  (the circuit passed to an Estimator has NO measurements). Parameterised: `est.run([(qc, obs, [theta_values])])`.
- Transpilation: `backend = GenericBackendV2(num_qubits=5, seed=1)`; `pm = generate_preset_pass_manager(optimization_level=1, backend=backend)`;
  `isa = pm.run(qc)`; basis of that backend is cx, id, rz, sx, x (+ delay, measure, reset).
- Bit order: Qiskit prints qubit 0 as the RIGHTMOST character of a bitstring ('q1q0').
- Gate methods change the circuit IN PLACE: `qc.h(0)` returns an InstructionSet and `qc.measure_all()` returns None.
  Never chain them or use their result (`QuantumCircuit(1).h(0)` is NOT a circuit, and passing it to
  `Statevector.evolve` raises "Invalid input data format for Operator"). Write `qc = QuantumCircuit(1)`, then `qc.h(0)`
  on its own line, then use `qc`. `qc.measure_all(inplace=False)` returns a measured copy and leaves `qc` alone.
- A circuit with measurements has no statevector or operator: `Statevector(qc)`, `Operator(qc)` and `.evolve(qc)`
  raise "Cannot apply instruction with classical bits: measure". Build states before measuring, or pass
  `qc.remove_final_measurements(inplace=False)`.
- Drawing: `qc.draw("text")` always works; `qc.draw("mpl")` needs the `pylatexenc` package and matplotlib —
  use it only when a figure is the point, and never let a missing optional package break a cell.
- Visualisation: `from qiskit.visualization import plot_histogram, plot_bloch_multivector`; each returns a matplotlib Figure.
- OpenQASM 3: `from qiskit import qasm3; qasm3.dumps(qc)`.
- Library: `from qiskit.circuit.library import real_amplitudes, grover_operator, QFTGate, efficient_su2` (functions and gates;
  the old CamelCase classes still exist but warn).
- Keep every notebook under 60 seconds of total runtime and at most 12 qubits; seed every sampler so counts reproduce.

NOT INSTALLED in this sandbox — importing any of these is BLOCKED by the safety guard before the cell runs, whatever
it is used for: `qiskit_nature`, `qiskit_algorithms`, `qiskit_ibm_runtime`, `pyscf`. Reaching for one of them (to
build a molecular Hamiltonian, to run `VQE`/`QAOA` as an algorithm object, or to submit to real hardware) fails the
whole notebook with nothing executed — do the equivalent by hand instead:
- Chemistry Hamiltonians: write them as a `SparsePauliOp` with published coefficients, and say in markdown which
  paper they are from. For H2 at 0.735 Å in STO-3G, after parity mapping with two-qubit reduction, the standard
  2-qubit electronic Hamiltonian (O'Malley et al. 2016, "Scalable Quantum Simulation of Molecular Energies",
  arXiv:1512.06860) is `SparsePauliOp(["II", "IZ", "ZI", "ZZ", "XX"], [-1.052373245772859, 0.39793742484318045,
  -0.39793742484318045, -0.01128010425623538, 0.18093119978423156])`. Diagonalising it gives the ELECTRONIC ground
  energy (≈ -1.8573 Ha, verified with `numpy.linalg.eigvalsh` on 2026-09-23); add the nuclear repulsion energy
  (`1 / R_bohr`, ≈ 0.7199 Ha at 0.735 Å = 1.3892 Bohr) to get the TOTAL ground-state energy the literature quotes,
  ≈ -1.137 Ha — say which of the two numbers a cell is printing.
- VQE: no `qiskit_algorithms.VQE`. Write the loop yourself — `est = StatevectorEstimator()`, a cost function
  `lambda params: est.run([(ansatz, hamiltonian, params)]).result()[0].data.evs`, minimised with
  `scipy.optimize.minimize(cost, x0, method="COBYLA")` (gradient-free, so no parameter-shift rule needed). Verified
  on the H2 Hamiltonian above: converges to the exact electronic ground energy to 6 decimal places.
- QAOA: no `qiskit_algorithms.QAOA`. Build the cost operator by hand as a `SparsePauliOp` — for max-cut on edges
  `(i, j)`, the term is `0.5 * (I - Z_i Z_j)` per edge — then `QAOAAnsatz(cost_operator=cost_op, reps=p)` from
  `qiskit.circuit.library` (this ships in core Qiskit, not the algorithms package) builds the circuit; optimise the
  same way as VQE, over the SAME cost operator.
- Real hardware needs `qiskit_ibm_runtime`, also absent. A cell that submits to real hardware is marked
  `execute=false` and explained in prose (Leona's own submission path, not a package import) — simulate locally with
  `StatevectorSampler`/`AerSimulator` instead, adding a noise model only if the point of the cell is noise.
"""

FRAMEWORK_FACTS: dict[str, str] = {"qiskit": QISKIT_2_FACTS}


def allowed_imports_text() -> str:
    """The sandbox guard's import allowlist, rendered for a prompt. Read from the guard
    itself so the prompt can never promise a module the sandbox refuses."""
    from majorana_sandbox.guard import ALLOWED_IMPORTS

    names = ", ".join(sorted(ALLOWED_IMPORTS))
    return (
        "EXECUTION RULES: cells run in a network-locked sandbox. The ONLY top-level modules a cell may "
        f"import are: {names}. Never import sys, os, subprocess, pathlib, requests or pickle; never call "
        "open(), eval(), exec() or __import__(); never read environment variables. A cell that needs any "
        "of these (a hardware submission reading a token) is marked execute=false and explained in prose.\n"
        + HARDWARE_SUBMIT_TEXT
    )


#: How a notebook runs a circuit on a real QPU from inside the product. Part of the
#: execution rules rather than the hardware kind's structure alone, because any notebook
#: may reasonably end on "now try it on a real device", and the rule that matters —
#: this call goes in an ORDINARY cell — is the same whichever kind it appears in. The
#: sandbox side is `sandbox_program._ln_submit`; what it refuses is `hardware.py`.
HARDWARE_SUBMIT_TEXT = (
    "RUNNING ON REAL HARDWARE: to let the reader run a circuit on a real QPU, call "
    "`leona_submit(circuit, shots=1024)` in an ordinary execute=true cell. It is already defined — "
    "no import, no account, no token — and it sends nothing: it records the circuit, and the reader "
    "picks a device, sees the price and confirms under that cell. Give it a qiskit QuantumCircuit "
    "that is measured (`measure_all()`) and has every parameter bound; an optional "
    "`label='...'` names the run. Call it at most a few times per notebook (the limit is "
    f"{MAX_HARDWARE_REQUESTS_PER_NOTEBOOK}). Put the "
    "`leona_submit` call on the last line of its cell so its confirmation shows. Code that talks to "
    "IBM directly (qiskit_ibm_runtime, QiskitRuntimeService, save_account) stays in its own "
    "execute=false cell, for readers running the notebook on their own machine."
)


# --------------------------------------------------------------------------- source format

SOURCE_FORMAT_SPEC = """\
Write the notebook in Leona notebook source (jupytext percent format with a YAML header):

# ---
# title: <title>
# kind: <lesson|lab|challenge|walkthrough|demo|quiz|hardware|benchmark|project>
# summary: <one sentence>
# objectives:
#   - <what the reader can do afterwards>
# prerequisites:
#   - <what is assumed>
# duration_minutes: <int>
# ---

# %% [markdown] role=objective
# ## <heading>
# <markdown, every line prefixed with "# ">

# %% role=run
<plain Python, no prefix>

Rules: every cell starts with a `# %%` marker line; markdown cells say `[markdown]`; every cell has
`role=<role>` from: setup objective concept predict run observe explain modify checkpoint figure
exercise hint solution question answer summary references note. Add `execute=false` to any cell that
needs credentials or the network. A `role=solution` code cell also carries `stub="<learner placeholder>"`
(a JSON string) that leaves every name later checkpoints read defined (e.g. `answer = None`).
It may also carry `check="<hidden assertion>"` (a JSON string) — the grader. The reader never
sees it; it runs in their namespace straight after their cell, and it must satisfy BOTH of:
it FAILS against the stub, and it PASSES against your own solution. `assert callable(f)` is
not a grader — it is true of the stub as well, and it marks the reader correct before they
start. Assert on a VALUE the exercise is about (`assert double(3) == 6`), and give the assert
a message saying what was expected. A grader that fails either test is stripped before the
reader sees it, and the exercise ships ungraded, so a weak check costs the exercise its
feedback rather than passing quietly.
A `role=question` MARKDOWN cell may carry `answer={...}` (a JSON object) — the reader gets an
input box under it and a real verdict, and the key never reaches their browser. Four kinds:
  answer={"kind":"choice","options":["...","..."],"correct":0,"explanation":"why"}
  answer={"kind":"numeric","value":0.5,"tolerance":0.01,"unit":"probability","explanation":"why"}
  answer={"kind":"text","accept":["Hadamard","the Hadamard gate"],"explanation":"why"}
  answer={"kind":"rubric","rubric":"what a good answer must mention"}
Prefer `choice` and `numeric`: they are decided in Python, so the reader can argue with the
verdict and lose. Use `text` ONLY when the right answers are a short closed set of spellings —
anything open-ended is `rubric`, which is graded by a model and says so. Three ways a key is
thrown away before a reader meets it, each because it grades something other than knowing the
answer: a `numeric` whose `tolerance` is at least `|value|`, because then typing 0 is correct;
a `text` whose accepted answer is printed in the question's own visible text; two `choice`
options that read the same, because the reader who picks the other one is marked wrong. Write
the question so the answer is NOT in it, and set a tolerance that a wrong method would miss.
Use `tags=["raises-exception"]` only on a cell that is meant to fail. Markdown may use $...$ for maths.
Do not number cells; do not add ids. Never write an API token, email address or file path into a cell.
"""

# --------------------------------------------------------------------------- the audience

#: How to WRITE for each audience, as opposed to what the notebook must structurally
#: contain (`templates._LEVEL_RULES`, which is checkable and enforced). The two are
#: separate on purpose: the rules are what we can fail a draft for, and this is the
#: judgement the rules cannot express.
#:
#: Before this existed, `Audience.level` reached the model only as one word inside a JSON
#: blob, so "newcomer" and "researcher" produced the same notebook in a different tone.
AUDIENCE_GUIDANCE: dict[str, str] = {
    "newcomer": (
        "Someone who can write Python and has never met quantum computing. Assume nothing: "
        "the first time a term appears — qubit, superposition, amplitude, measurement, "
        "shots — define it in one plain sentence before using it. Prefer one idea per cell "
        "and repeat each idea in a second, slightly different setting before moving on; a "
        "beginner learns from the second encounter, not the first. Use the analogy that was "
        "asked for, then say exactly where it stops being true, because an analogy nobody "
        "retires becomes a misconception. Never write a line of code the surrounding prose "
        "has not already accounted for, and never leave a printed number unexplained. "
        "Mathematics only where it is the shortest honest explanation."
    ),
    "student": (
        "Someone taking a course, who has seen the linear algebra and wants to connect it to "
        "running code. Show the expression and then the circuit that realises it, in that "
        "order. Make them predict and then commit to an answer before running — a student "
        "who reads the output first learns nothing from it. Every exercise gets a real check "
        "with a message saying what was expected, and hints go one step at a time rather "
        "than collapsing to the answer."
    ),
    "engineer": (
        "A working software engineer evaluating whether this is usable. Lead with the "
        "runnable thing and keep the theory to what is needed to read it. Be concrete about "
        "versions, APIs and what breaks: a deprecated call, a bit-order convention, a result "
        "object whose shape is not obvious. Say what the code costs — qubits, shots, "
        "wall-clock — and where it stops scaling."
    ),
    "researcher": (
        "Someone who may build on this and will check it. Write for a reader who will "
        "disagree: state the claim, the evidence, and the conditions under which it holds. "
        "Cite the specific paper and the specific place in it — never a bare author-year for "
        "a claim the paper makes in passing, and never a citation you have not read in the "
        "seed material. Seed everything and say what the seed controls. Report the "
        "uncertainty beside every number: shot noise, sample size, fit error. Include the "
        "control, not just the arm — a result with nothing to compare against is a "
        "measurement, not a finding. End by saying what the notebook does NOT establish; "
        "that paragraph is the one a researcher reads first. No analogies."
    ),
}


# --------------------------------------------------------------------------- outline stage


class PlannedCell(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Literal["markdown", "code"]
    role: CellRole
    intent: str = Field(description="One sentence: what this cell does for the reader.")


class PlannedSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading: str
    purpose: str
    cells: list[PlannedCell] = Field(min_length=1)


class NotebookOutline(BaseModel):
    """What the model returns from the outline stage — everything but the cells' text."""

    model_config = ConfigDict(extra="forbid")

    title: str
    kind: NotebookKind
    summary: str
    audience: Audience = Field(default_factory=Audience)
    style: Style = Field(default_factory=Style)
    framework: Framework = Field(default_factory=Framework)
    objectives: list[str] = Field(min_length=1)
    prerequisites: list[str] = Field(default_factory=list)
    duration_minutes: int = Field(ge=5, le=240)
    sections: list[PlannedSection] = Field(min_length=1)
    references: list[Reference] = Field(default_factory=list)
    #: Things the brief asked for that the outline could not honour, with why.
    declined: list[str] = Field(default_factory=list)
    #: Questions the model would ask the reader if it could; the product shows them as
    #: suggestions after the first draft rather than blocking on them.
    open_questions: list[str] = Field(default_factory=list)


OUTLINE_SYSTEM_PROMPT = """\
You are Nala, Leona Quantum's teaching assistant. You plan Jupyter notebooks that teach quantum
computing by running code. You are given a reader's brief and, sometimes, seed material (an Atlas
record's code and prose, a paper, an existing notebook). Return a JSON outline only.

Principles you never trade away:
1. Code first. Each idea is met as a runnable cell before the mathematics that explains it, and the
   mathematics is the minimum needed to explain what the reader just saw.
2. The loop is predict → run → observe → explain → modify. A reader guesses before running, sees the
   result, reads why, then changes one thing and runs again.
3. Every notebook ends with something working and a checkpoint that would fail if it did not.
4. Honesty about randomness: shots fluctuate, counts differ between runs, and the notebook says so.
5. The reader's preferences (analogies, tone, depth, language, specific circuits they asked for) are
   requirements, not suggestions. If one cannot be honoured, say so in `declined` with the reason.
6. Nothing in a cell may need a credential, a network, or more than ~60 seconds of CPU.

Plan sections; for each section list the cells with role and intent. Keep it to what a reader can
finish in the requested duration. Do not write cell text at this stage.
"""


def render_outline_user_prompt(
    *,
    brief: str,
    kind_hint: NotebookKind | None,
    audience: Audience | None,
    style: Style | None,
    framework: Framework | None,
    seeds: list[Seed],
    seed_material: str,
    response_locale: str = "en",
) -> str:
    kind = kind_hint or NotebookKind.LESSON
    payload: dict[str, Any] = {
        "brief": brief,
        "kind_hint": kind.value,
        "kind_meaning": KIND_DESCRIPTIONS[kind],
        "structure_requirements": structure_for(kind, (audience or Audience()).level),
        "audience": (audience or Audience()).model_dump(),
        "style": (style or Style()).model_dump(),
        "framework": (framework or Framework()).model_dump(),
        "seeds": [seed.model_dump() for seed in seeds],
        "response_language": response_locale,
        "outline_json_schema": NotebookOutline.model_json_schema(),
    }
    material = (
        f"\n\nSEED MATERIAL (verbatim, cite it, never invent beyond it):\n{seed_material}"
        if seed_material
        else ""
    )
    return json.dumps(payload, ensure_ascii=False, indent=2) + material


# --------------------------------------------------------------------------- draft stage

DRAFT_SYSTEM_PROMPT = """\
You are Nala, Leona Quantum's teaching assistant. You write the cells of a Jupyter notebook from an
approved outline. Output the notebook source and nothing else — no preamble, no fences around the
whole document.

Writing rules:
- Follow the outline's sections and cell roles exactly; you may split a planned cell in two, never drop one.
- Markdown explains in the reader's language and register. Prefer one clear paragraph to three hedged ones.
  If analogies were requested, use them and then say where the analogy stops being true.
- Code is complete, runnable top to bottom, seeded, and prints what the reader should look at. A cell
  ends with the expression to display (a Figure, a dict of counts) when a picture or a value is the point.
- Every `role=predict` markdown cell asks the reader to write down a specific guess before running.
- Every `role=checkpoint` code cell asserts something concrete about earlier results, with a message
  that says what was expected, and tolerates sampling noise (bands, not exact counts). Assert on
  BEHAVIOUR — counts, probabilities, an expectation value, a statevector equal up to global phase
  (`abs(np.vdot(a, b))` close to 1, never `a == b`) — never on circuit STRUCTURE such as a gate count
  or a gate name surviving unchanged: `generate_preset_pass_manager` rewrites gates into its basis set
  (cx, id, rz, sx, x) and can remove, fuse or reorder them while leaving the circuit's action identical,
  so a check that counts `mcx` or expects a named gate to still be there after transpiling is checking
  an implementation detail, not the claim, and breaks on a circuit that is still correct.
- Every `role=modify` step changes exactly one thing and asks the reader to explain the changed result.
- Cite seed material and papers by title in `role=references`; never invent a citation.
- Obey the framework facts below to the letter. A deprecated or removed API is a failed notebook.
"""


def render_draft_user_prompt(
    outline: NotebookOutline,
    *,
    brief: str,
    seed_material: str,
    response_locale: str = "en",
) -> str:
    facts = FRAMEWORK_FACTS.get(outline.framework.name, "")
    parts = [
        "BRIEF (the reader's own words):\n" + brief,
        "OUTLINE (JSON):\n" + outline.model_dump_json(indent=2),
        "STRUCTURE REQUIREMENTS:\n- "
        + "\n- ".join(structure_for(outline.kind, outline.audience.level)),
        "WHO THIS IS FOR:\n" + AUDIENCE_GUIDANCE[outline.audience.level],
        "FRAMEWORK FACTS:\n" + facts,
        allowed_imports_text(),
        "OUTPUT FORMAT:\n" + SOURCE_FORMAT_SPEC,
        f"Write all prose in: {'Japanese (です・ます体)' if response_locale == 'ja' else 'English'}. Code comments may stay in English.",
    ]
    if seed_material:
        parts.insert(2, "SEED MATERIAL (verbatim):\n" + seed_material)
    return "\n\n".join(parts)


# --------------------------------------------------------------------------- repair stage

#: How many cells one repair reply may replace: the failing cell plus, when it names them
#: explicitly by `id=`, the code cells it depends on and the markdown that states the same
#: claim. Enforced in `leona_notebooks.pipeline._apply_repair`, quoted here so the number
#: in the prompt and the number the pipeline actually allows cannot drift apart.
MAX_REPAIR_CELLS = 4

REPAIR_SYSTEM_PROMPT = """\
You are Nala. A cell of a notebook you wrote failed when it ran. Return the corrected cell(s) in
Leona notebook source (percent format), and nothing else. Keep the cell's role and intent; change the
least that makes it run.

If the failure reveals an error in an earlier cell, or a claim stated in nearby markdown that is now
wrong, return that cell too, with its `id=` marker so it replaces the right one — an id you were shown
for an EXISTING cell, never one you invent. You may touch at most {max_cells} cells this way (the
failing cell plus up to {max_cells_minus_one} others); a fix that needs more than that is not the
least change that makes it run, and you have likely misread which cell is actually wrong. Never
introduce a new cell and never delete one — only replace cells that already exist, one for one.

Never silence an error with a bare `except`, and never make a failing check pass by weakening it:
not by deleting the assertion, not by rewriting it to something that is trivially true (`assert True`,
a tolerance so wide it cannot fail), not by wrapping it in a `try`/`except` that swallows the failure.
A check that cannot fail is not a check, and returning one is refused, not applied. If the check is
actually right and something upstream is wrong, fix the upstream cell or the claim instead — see the
reasoning rule below for an `AssertionError`.

If you are told an earlier fix of yours failed the same way, do not return that fix again: find a
different cause, and prefer the simplest code that demonstrates the same idea.
""".format(max_cells=MAX_REPAIR_CELLS, max_cells_minus_one=MAX_REPAIR_CELLS - 1)


@dataclass(frozen=True)
class RepairContext:
    cell_id: str
    cell_source: str
    error_name: str
    error_value: str
    traceback: str
    preceding_sources: list[tuple[str, str]]  # (id, source) of earlier code cells
    stdout: str = ""
    #: What `leona_notebooks.lint` says about this cell, one rendered finding per line.
    #: A traceback points at where Qiskit gave up, which is often not where the mistake is
    #: (the 2026-09-24 production failure pointed into `Operator.__init__`); the linter
    #: points at the line that made it.
    lint_notes: tuple[str, ...] = ()
    #: Known meanings of this error message (`leona_notebooks.error_hints`).
    hints: tuple[str, ...] = ()
    #: Earlier repairs of THIS cell in this run that did not work, newest last, each as
    #: (source the model returned, the error it then raised). Without this every repair
    #: is the first repair, and a model that made a mistake once makes it three times —
    #: which is what happened on 2026-09-24: three fixes, three identical failures.
    failed_fixes: tuple[tuple[str, str], ...] = ()
    #: `True` when there is no traceback because the cell has not run: the linter found a
    #: certain error before any sandbox time was spent on it.
    before_running: bool = False


def render_repair_user_prompt(context: RepairContext, framework: str = "qiskit") -> str:
    earlier = "\n\n".join(
        f"# %% id={cid}\n{src.rstrip()}" for cid, src in context.preceding_sources[-6:]
    )
    lint = (
        "LEONA'S LINTER ON THIS CELL (line numbers are within the cell):\n"
        + "\n".join(f"- {note}" for note in context.lint_notes)
        + "\n\n"
        if context.lint_notes
        else ""
    )
    hints = (
        "WHAT THIS ERROR USUALLY MEANS:\n"
        + "\n".join(f"- {hint}" for hint in context.hints)
        + "\n\n"
        if context.hints
        else ""
    )
    failed = "".join(
        f"YOUR EARLIER FIX #{n} OF THIS CELL ALSO FAILED, with {error}. Do not return it again:\n"
        f"{source.rstrip()}\n\n"
        for n, (source, error) in enumerate(context.failed_fixes, start=1)
    )
    what = (
        "This cell has not run yet. The linter found an error that will certainly raise, listed below.\n\n"
        if context.before_running
        else f"ERROR: {context.error_name}: {context.error_value}\n\nTRACEBACK:\n{context.traceback[-3000:]}\n\n"
    )
    # A failed `assert` is not "a bug in Qiskit" the way every other entry in this table
    # is — it is the notebook's OWN claim about its OWN result disagreeing with what the
    # simulator actually returned. The observed values are already in `error_value` above
    # (the assert's message is written to carry them), so this adds the one instruction
    # that was missing: decide, from the physics, which of the three things is wrong,
    # before writing any code. Gated on the exact exception name so an unrelated
    # `AssertionError`-shaped false alarm never gets this treatment by accident — there
    # is none today (every `assert` in a generated cell is a checkpoint's own claim), but
    # the gate costs nothing and the alternative is silently wrong advice.
    assertion_reasoning = (
        "THIS IS A FAILED ASSERTION, not a Qiskit bug: the notebook checked its own claim against\n"
        "the simulator and the simulator disagreed. For a statevector/sampler simulation of a small\n"
        "circuit, the SIMULATOR IS GROUND TRUTH — read the observed values in the error above. Before\n"
        "writing any fix, decide from the physics which of three things is wrong, and say which in one\n"
        "sentence: (1) the assertion's claim about what should happen, (2) the expected value or bound\n"
        "it checks against, or (3) the circuit that produced the state being checked. Fix THAT thing —\n"
        "if the claim is wrong, correct it and every markdown cell that states it too (return those\n"
        "cells by id, within the cell budget above); if an earlier cell built the wrong circuit, fix\n"
        "that cell instead of the assertion; if the assertion is right, tighten it correctly without\n"
        "weakening it. Never rewrite the circuit to match a claim you have not verified — that hides a\n"
        "wrong physics claim instead of fixing it, and never make the assertion pass by weakening it.\n\n"
        if context.error_name == "AssertionError"
        else ""
    )
    return (
        f"FAILED CELL (id={context.cell_id}):\n# %% id={context.cell_id}\n{context.cell_source.rstrip()}\n\n"
        + what
        + assertion_reasoning
        + lint
        + hints
        + failed
        + (f"STDOUT BEFORE THE ERROR:\n{context.stdout[-1500:]}\n\n" if context.stdout else "")
        + f"EARLIER CODE CELLS (for context; return one only if it is the real cause):\n{earlier}\n\n"
        f"FRAMEWORK FACTS:\n{FRAMEWORK_FACTS.get(framework, '')}\n\n{allowed_imports_text()}\n\n"
        "Return the corrected cell(s) in percent format with `# %% id=<id> role=<role>` markers."
    )


# --------------------------------------------------------------------------- revise stage

REVISE_SYSTEM_PROMPT = """\
You are Nala, editing a Jupyter notebook with its reader in a chat. You are given the current notebook
source and the reader's message. Return JSON only: a `RevisionPlan` with a short `reply` to the reader,
a one-line `summary` of the change, and `ops` — explicit edit operations on cells by id.

Operations: `replace` (new cells replace the cell with `cell_id`), `insert_after` / `insert_before`
(new cells go next to `cell_id`), `delete` (remove `cell_id`), `move` (move `cell_id` to after
`after_id`), `set_field` (change a header field: title, summary, objectives, prerequisites,
duration_minutes, style, audience). New cells are given in `cells_source` as percent-format text
(without ids; they are assigned). Edit the fewest cells that honour the request; keep the rest
byte-identical. If the message is a question rather than an edit, answer in `reply` and return no ops.
If the request would make the notebook wrong or unrunnable, say so in `reply` and propose the nearest
change you can make. Respect the framework facts.
"""


def render_revise_user_prompt(
    *,
    source_text: str,
    message: str,
    history: list[dict[str, str]],
    framework: str = "qiskit",
    response_locale: str = "en",
) -> str:
    from leona_notebooks.revision import RevisionPlan

    turns = "\n".join(f"{turn['role']}: {turn['content']}" for turn in history[-8:])
    return (
        f"CURRENT NOTEBOOK SOURCE:\n{source_text}\n\n"
        + (f"EARLIER TURNS:\n{turns}\n\n" if turns else "")
        + f"READER'S MESSAGE:\n{message}\n\n"
        f"FRAMEWORK FACTS:\n{FRAMEWORK_FACTS.get(framework, '')}\n\n{allowed_imports_text()}\n\n"
        f"CELL SOURCE FORMAT FOR NEW CELLS:\n{SOURCE_FORMAT_SPEC}\n\n"
        f"Reply language: {'Japanese' if response_locale == 'ja' else 'English'}.\n"
        f"RevisionPlan JSON schema:\n{json.dumps(RevisionPlan.model_json_schema())}"
    )


# --------------------------------------------------------------------------- review stage


# `ReviewFinding` and `NotebookReview` are contracts (`majorana_contracts.notebooks`):
# the API returns them to the reader, so their definition lives at the boundary.

REVIEW_SYSTEM_PROMPT = """\
You review a teaching notebook that has already executed. Return JSON only (`NotebookReview`).
Check, in this order: (1) accuracy — every physics or mathematics claim in the markdown is true and
matches what the code actually computes; (2) pedagogy — predictions come before runs, explanations
follow observations, one thing changes per modify step, jargon is introduced only where it is used;
(3) code — no removed APIs, seeds present, checkpoints assert something that could fail; (4) safety —
no credential, token, network call or filesystem write; (5) style — the reader's requested register
and language are respected. Severity: a `blocker` is a false claim or a cell a reader cannot run;
`should-fix` hurts learning; `nit` is taste. List in `what_this_notebook_does_not_establish` the
claims a reader might take away that the code does not prove (e.g. "that this scales", "that the
hardware result would match").
"""


def render_review_user_prompt(
    *, source_text: str, execution_summary: str, response_locale: str = "en"
) -> str:
    return (
        f"NOTEBOOK SOURCE:\n{source_text}\n\nEXECUTION SUMMARY:\n{execution_summary}\n\n"
        f"Write findings in: {'Japanese' if response_locale == 'ja' else 'English'}.\n"
        f"NotebookReview JSON schema:\n{json.dumps(NotebookReview.model_json_schema())}"
    )


# --------------------------------------------------------------------------- circuit seed material


def render_circuit_seed_material(material: Any) -> str:
    """Seed-material text for a `kind="circuit"` seed (`leona_notebooks.circuits`'s
    `CircuitSeedMaterial`), in the same "quote it, cite it" register as
    `leona_notebooks.atlas.seed_from_record`'s ATLAS RECORD block. `material` is typed
    `Any` to avoid an import cycle (`circuits.py` does not depend on `prompts.py`)."""
    return (
        "READER-SUPPLIED CIRCUIT: the reader pasted this circuit themselves. The lesson "
        "must use it as its central demonstration — run it first, unchanged, then explain "
        f"and modify it.\n{material.description_text}"
    )


def execution_summary_text(report_cells: list[dict[str, Any]]) -> str:
    """A compact, model-readable digest of an ExecutionReport (`report.model_dump()['cells']`)."""
    lines = []
    for cell in report_cells:
        status = cell.get("status")
        line = f"- {cell.get('id')}: {status} ({cell.get('duration_ms', 0)} ms)"
        if cell.get("stdout"):
            line += f" stdout={cell['stdout'][:200]!r}"
        if cell.get("error"):
            line += f" error={cell['error'].get('ename')}: {cell['error'].get('evalue', '')[:200]}"
        figures = sum(1 for out in cell.get("outputs", []) if out.get("mime") == "image/png")
        if figures:
            line += f" figures={figures}"
        lines.append(line)
    return "\n".join(lines)
