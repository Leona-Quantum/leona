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

from leona_notebooks.spec import Audience, CellRole, Framework, NotebookKind, Reference, Seed, Style
from leona_notebooks.templates import KIND_DESCRIPTIONS, structure_for

# --------------------------------------------------------------------------- framework facts

#: What is true of the framework the cells run against. Verified on 2026-09-02 against
#: qiskit 2.5.2 with DeprecationWarning raised as an error. A wrong "fact" here ships a
#: failing cell to every reader, so this block changes only with a probe run.
QISKIT_2_FACTS = """\
Qiskit 2.5 facts (verified against 2.5.2):
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
- Drawing: `qc.draw("text")` always works; `qc.draw("mpl")` needs the `pylatexenc` package and matplotlib —
  use it only when a figure is the point, and never let a missing optional package break a cell.
- Visualisation: `from qiskit.visualization import plot_histogram, plot_bloch_multivector`; each returns a matplotlib Figure.
- OpenQASM 3: `from qiskit import qasm3; qasm3.dumps(qc)`.
- Library: `from qiskit.circuit.library import real_amplitudes, grover_operator, QFTGate, efficient_su2` (functions and gates;
  the old CamelCase classes still exist but warn).
- Keep every notebook under 60 seconds of total runtime and at most 12 qubits; seed every sampler so counts reproduce.
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
        "of these (a hardware submission reading a token) is marked execute=false and explained in prose."
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
Use `tags=["raises-exception"]` only on a cell that is meant to fail. Markdown may use $...$ for maths.
Do not number cells; do not add ids. Never write an API token, email address or file path into a cell.
"""

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
        "structure_requirements": structure_for(kind),
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
  that says what was expected, and tolerates sampling noise (bands, not exact counts).
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
        "STRUCTURE REQUIREMENTS:\n- " + "\n- ".join(structure_for(outline.kind)),
        "FRAMEWORK FACTS:\n" + facts,
        allowed_imports_text(),
        "OUTPUT FORMAT:\n" + SOURCE_FORMAT_SPEC,
        f"Write all prose in: {'Japanese (です・ます体)' if response_locale == 'ja' else 'English'}. Code comments may stay in English.",
    ]
    if seed_material:
        parts.insert(2, "SEED MATERIAL (verbatim):\n" + seed_material)
    return "\n\n".join(parts)


# --------------------------------------------------------------------------- repair stage

REPAIR_SYSTEM_PROMPT = """\
You are Nala. A cell of a notebook you wrote failed when it ran. Return the corrected cell(s) in
Leona notebook source (percent format), and nothing else. Keep the cell's role and intent; change the
least that makes it run. If the failure reveals an error in an earlier cell, return that cell too,
with its `id=` marker so it replaces the right one. Never silence an error with a bare `except`, and
never delete an assertion to make a checkpoint pass — fix what it checks.
"""


@dataclass(frozen=True)
class RepairContext:
    cell_id: str
    cell_source: str
    error_name: str
    error_value: str
    traceback: str
    preceding_sources: list[tuple[str, str]]  # (id, source) of earlier code cells
    stdout: str = ""


def render_repair_user_prompt(context: RepairContext, framework: str = "qiskit") -> str:
    earlier = "\n\n".join(
        f"# %% id={cid}\n{src.rstrip()}" for cid, src in context.preceding_sources[-6:]
    )
    return (
        f"FAILED CELL (id={context.cell_id}):\n# %% id={context.cell_id}\n{context.cell_source.rstrip()}\n\n"
        f"ERROR: {context.error_name}: {context.error_value}\n\nTRACEBACK:\n{context.traceback[-3000:]}\n\n"
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


class ReviewFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cell_id: str | None = None
    severity: Literal["blocker", "should-fix", "nit"]
    category: Literal["accuracy", "pedagogy", "code", "structure", "safety", "style"]
    finding: str
    suggestion: str = ""


class NotebookReview(BaseModel):
    """Advisory, like the execute pipeline's alignment review: it never blocks a save,
    it tells the reader what a second pair of eyes saw."""

    model_config = ConfigDict(extra="forbid")

    verdict: Literal["ready", "needs-attention"]
    findings: list[ReviewFinding] = Field(default_factory=list)
    what_this_notebook_does_not_establish: list[str] = Field(default_factory=list)


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
