"""The pipeline with scripted ports: order, repair budget, structure feedback, revise."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from leona_notebooks.execution import CellError, CellResult, ExecutionReport
from leona_notebooks.pipeline import (
    GenerationRequest,
    PipelineBudget,
    RevisionRequest,
    generate,
    revise,
)
from leona_notebooks.prompts import (
    NotebookOutline,
    NotebookReview,
    RepairContext,
    render_repair_user_prompt,
)
from leona_notebooks.revision import RevisionOp, RevisionPlan
from leona_notebooks.source import parse_source
from leona_notebooks.spec import Cell, NotebookSpec

from leona_notebook_fixtures import LESSON

OUTLINE = NotebookOutline.model_validate(
    {
        "title": "Quantum coin",
        "kind": "lesson",
        "summary": "s",
        "objectives": ["o"],
        "duration_minutes": 20,
        "sections": [
            {
                "heading": "h",
                "purpose": "p",
                "cells": [{"kind": "markdown", "role": "objective", "intent": "i"}],
            }
        ],
    }
)

BROKEN_LESSON = LESSON.replace("qc.h(0)\n", "qc.h(0)\nundefined_name\n")


@dataclass
class ScriptedPorts:
    drafts: list[str]
    repairs: list[str] = field(default_factory=list)
    execute_ok_when: str = "undefined_name"  # a cell containing this fails
    revision: RevisionPlan | None = None
    review_raises: bool = False
    calls: list[str] = field(default_factory=list)
    events: list[tuple[str, str, str]] = field(default_factory=list)
    contexts: list[RepairContext] = field(default_factory=list)
    #: When set, every execution reports this and runs no cell: the sandbox failing.
    sandbox_down: str | None = None

    async def outline(self, request: GenerationRequest) -> NotebookOutline:
        self.calls.append("outline")
        return OUTLINE

    async def draft(self, request, outline, feedback):
        self.calls.append(f"draft(feedback={'yes' if feedback else 'no'})")
        return self.drafts.pop(0)

    async def run_notebook(self, spec: NotebookSpec) -> ExecutionReport:
        self.calls.append("execute")
        if self.sandbox_down is not None:
            return ExecutionReport(
                notebook_slug=spec.slug, ok=False, runner="inprocess", note=self.sandbox_down
            )
        cells = []
        stopped = False
        for cell in spec.cells:
            if not cell.is_code:
                continue
            if stopped:
                cells.append(CellResult(id=cell.id, status="not_run"))
            elif self.execute_ok_when in cell.source:
                cells.append(
                    CellResult(
                        id=cell.id,
                        status="error",
                        error=CellError(
                            ename="NameError", evalue="name 'undefined_name' is not defined"
                        ),
                    )
                )
                stopped = True
            else:
                cells.append(CellResult(id=cell.id, status="ok"))
        return ExecutionReport(
            notebook_slug=spec.slug, ok=not stopped, runner="inprocess", cells=cells
        )

    async def repair(self, spec: NotebookSpec, context: RepairContext) -> str:
        self.calls.append(f"repair({context.cell_id})")
        self.contexts.append(context)
        return self.repairs.pop(0)

    async def review(self, spec, report) -> NotebookReview:
        self.calls.append("review")
        if self.review_raises:
            raise RuntimeError("reviewer down")
        return NotebookReview(verdict="ready")

    async def revise(self, request: RevisionRequest) -> RevisionPlan:
        self.calls.append("revise")
        assert self.revision is not None
        return self.revision

    async def observe(self, stage, status, detail="") -> None:
        self.events.append((stage, status, detail))


async def test_generate_happy_path_runs_stages_in_order() -> None:
    ports = ScriptedPorts(drafts=[LESSON])
    outcome = await generate(ports, GenerationRequest(brief="teach me a coin"))
    assert outcome.status == "ready"
    assert ports.calls == ["outline", "draft(feedback=no)", "execute", "review"]
    assert outcome.spec is not None and outcome.spec.brief == "teach me a coin"
    assert outcome.review is not None and outcome.review.verdict == "ready"
    assert [e[0] for e in ports.events if e[1] == "finished"] == [
        "notebook.outline",
        "notebook.draft",
        "notebook.execute",
        "notebook.review",
    ]
    assert "# %%" in outcome.source


async def test_a_failing_cell_is_repaired_by_id_and_rerun() -> None:
    fixed_cell = (
        "# %% id=c05 role=run\nfrom qiskit import QuantumCircuit\n"
        "from qiskit.primitives import StatevectorSampler\nqc = QuantumCircuit(1)\nqc.h(0)\n"
        "qc.measure_all()\ncounts = StatevectorSampler(seed=7).run([qc], shots=1000).result()[0].data.meas.get_counts()\ncounts\n"
    )
    ports = ScriptedPorts(drafts=[BROKEN_LESSON], repairs=[fixed_cell])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready", outcome.error
    assert ports.calls == [
        "outline",
        "draft(feedback=no)",
        "execute",
        "repair(c05)",
        "execute",
        "review",
    ]
    assert "undefined_name" not in outcome.spec.cell_by_id("c05").source
    assert outcome.spec.cell_by_id("c05").role.value == "run"
    assert [c.id for c in outcome.spec.cells] == [c.id for c in parse_source(LESSON).cells]


async def test_repair_budget_is_bounded_and_the_notebook_is_kept_with_the_error_named() -> None:
    # Plan 10-notebook-ide rule 1: a cell that still raises after the repair budget is a
    # RESULT the reader sees and can fix, not a notebook thrown away. Before 2026-09-23 this
    # was `failed`, and the reader of the 2026-09-24 production failure got nothing.
    still_broken = "# %% id=c05 role=run\nundefined_name\n"
    ports = ScriptedPorts(drafts=[BROKEN_LESSON], repairs=[still_broken] * 5)
    outcome = await generate(ports, GenerationRequest(brief="b"), PipelineBudget(max_repairs=2))
    assert outcome.status == "ready"
    assert outcome.error == ""
    assert "cell c05 failed: NameError" in outcome.cell_errors
    assert outcome.report is not None and not outcome.report.ok
    assert ports.calls.count("repair(c05)") == 2
    assert ports.calls.count("execute") == 3
    assert "review" not in ports.calls  # review is for a notebook that runs
    assert outcome.spec is not None


async def test_a_second_repair_is_told_the_first_one_failed_the_same_way() -> None:
    still_broken = "# %% id=c05 role=run\nundefined_name\n"
    ports = ScriptedPorts(drafts=[BROKEN_LESSON], repairs=[still_broken] * 3)
    await generate(ports, GenerationRequest(brief="b"), PipelineBudget(max_repairs=3))
    first, second, third = ports.contexts
    assert first.failed_fixes == ()
    assert len(second.failed_fixes) == 1 and "undefined_name" in second.failed_fixes[0][0]
    assert "NameError" in second.failed_fixes[0][1]
    assert len(third.failed_fixes) == 2
    prompt = render_repair_user_prompt(third)
    assert "YOUR EARLIER FIX #1 OF THIS CELL ALSO FAILED" in prompt
    assert "YOUR EARLIER FIX #2 OF THIS CELL ALSO FAILED" in prompt


async def test_a_run_where_nothing_executed_is_still_failed() -> None:
    ports = ScriptedPorts(drafts=[LESSON], sandbox_down="sandbox provider failed")
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "failed"
    assert outcome.error == "sandbox provider failed"
    assert outcome.cell_errors == ""
    assert "repair(c05)" not in "".join(ports.calls)  # nothing to repair: no cell ran


async def test_a_certain_lint_error_is_repaired_before_any_sandbox_run() -> None:
    removed_api = LESSON.replace("qc.h(0)\n", "qc.h(0)\nfrom qiskit import execute\n")
    fixed = "# %% id=c05 role=run\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(1)\nqc.h(0)\n"
    ports = ScriptedPorts(drafts=[removed_api], repairs=[fixed])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready" and outcome.report.ok
    assert ports.calls[:4] == ["outline", "draft(feedback=no)", "repair(c05)", "execute"]
    [context] = ports.contexts
    assert context.before_running and context.traceback == ""
    assert any("qiskit.execute" in note for note in context.lint_notes)
    assert "has not run yet" in render_repair_user_prompt(context)


async def test_a_heuristic_lint_finding_alone_does_not_spend_a_repair() -> None:
    # `gate-returns-instructions` can be wrong, so it must never trigger a model call on
    # a cell that has not failed.
    chained = LESSON.replace("qc.h(0)\n", "qc.h(0)\nextra = qc.x(0)\n")
    ports = ScriptedPorts(drafts=[chained])
    await generate(ports, GenerationRequest(brief="b"))
    assert ports.calls[:3] == ["outline", "draft(feedback=no)", "execute"]


def test_the_production_failure_gets_the_lint_note_and_the_hint_in_its_repair_prompt() -> None:
    from leona_notebooks.pipeline import _repair_context

    source = (
        "from qiskit.quantum_info import Statevector\nfrom qiskit import QuantumCircuit\n"
        "sv = Statevector.from_label('0').evolve(QuantumCircuit(1).h(0))\n"
    )
    spec = NotebookSpec(slug="s", title="t", cells=[Cell(id="c28", kind="code", source=source)])
    report = ExecutionReport(
        notebook_slug="s",
        ok=False,
        runner="inprocess",
        cells=[
            CellResult(
                id="c28",
                status="error",
                error=CellError(ename="QiskitError", evalue="'Invalid input data format for Operator'"),
            )
        ],
    )
    context = _repair_context(spec, report)
    assert context is not None
    assert any("InstructionSet" in note for note in context.lint_notes)
    assert any("InstructionSet" in hint for hint in context.hints)
    prompt = render_repair_user_prompt(context)
    assert "LEONA'S LINTER ON THIS CELL" in prompt and "WHAT THIS ERROR USUALLY MEANS" in prompt


async def test_structure_failure_feeds_back_into_a_second_draft() -> None:
    no_loop = LESSON.replace("# %% [markdown] role=predict\n", "# %% [markdown] role=note\n")
    ports = ScriptedPorts(drafts=[no_loop, LESSON])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready"
    assert ports.calls[:3] == ["outline", "draft(feedback=no)", "draft(feedback=yes)"]
    failed = [a for a in outcome.attempts if a.stage == "notebook.draft" and not a.ok]
    assert failed and "predict" in failed[0].detail


async def test_unparseable_draft_twice_fails_the_run_with_the_reason() -> None:
    ports = ScriptedPorts(drafts=["not a notebook", "still not"])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "failed"
    assert outcome.error.startswith("notebook.draft:")
    assert "execute" not in ports.calls


async def test_seed_run_cell_is_inserted_verbatim_when_the_draft_paraphrased_it() -> None:
    seed = (
        "from qiskit import QuantumCircuit\nqc = QuantumCircuit(3)\nqc.h(0)\nFINAL_CIRCUIT = qc\n"
    )
    ports = ScriptedPorts(drafts=[LESSON])
    outcome = await generate(ports, GenerationRequest(brief="b", seed_run_cell=seed))
    seeded = [c for c in outcome.spec.cells if "seed" in c.tags]
    assert len(seeded) == 1 and seeded[0].source == seed
    # immediately before the first run cell
    assert outcome.spec.index_of(seeded[0].id) == outcome.spec.index_of("c05") - 1


async def test_review_failure_is_advisory() -> None:
    ports = ScriptedPorts(drafts=[LESSON], review_raises=True)
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready" and outcome.review is None
    assert any(a.stage == "notebook.review" and not a.ok for a in outcome.attempts)


async def test_revise_applies_ops_reruns_and_keeps_the_reply() -> None:
    spec = parse_source(LESSON)
    plan = RevisionPlan(
        reply="Added a note.",
        summary="note after objective",
        ops=[
            RevisionOp(
                op="insert_after",
                cell_id="c01",
                cells_source="# %% [markdown] role=note\n# A note.\n",
            )
        ],
    )
    ports = ScriptedPorts(drafts=[], revision=plan)
    outcome = await revise(ports, RevisionRequest(spec=spec, message="add a note"))
    assert outcome.status == "ready"
    assert outcome.reply == "Added a note." and outcome.summary == "note after objective"
    assert outcome.spec.cells[1].source == "A note.\n"
    assert ports.calls == ["revise", "execute", "review"]


async def test_revise_with_no_ops_answers_without_a_new_version() -> None:
    spec = parse_source(LESSON)
    ports = ScriptedPorts(drafts=[], revision=RevisionPlan(reply="It is a Hadamard.", ops=[]))
    outcome = await revise(ports, RevisionRequest(spec=spec, message="what is H?"))
    assert (
        outcome.status == "ready" and outcome.spec is None and outcome.reply == "It is a Hadamard."
    )
    assert ports.calls == ["revise"]


async def test_revise_with_a_bad_op_fails_loudly() -> None:
    spec = parse_source(LESSON)
    ports = ScriptedPorts(
        drafts=[], revision=RevisionPlan(reply="", ops=[RevisionOp(op="delete", cell_id="nope")])
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="delete nope"))
    assert outcome.status == "failed" and "no cell 'nope'" in outcome.error


@pytest.mark.parametrize("bad", ["", "   "])
async def test_repair_returning_nothing_counts_as_a_failed_repair(bad: str) -> None:
    ports = ScriptedPorts(drafts=[BROKEN_LESSON], repairs=[bad, bad, bad])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready" and "cell c05 failed" in outcome.cell_errors
    assert all(not a.ok for a in outcome.attempts if a.stage == "notebook.repair")


# --- the grader audit stage (ai-ops#258) ------------------------------------------

# The exercise goes BEFORE the closing summary — `check_structure` requires a notebook
# to end on summary/references, and a draft that fails structure is redrafted rather
# than audited, which would test nothing.
_EXERCISE = """
# %% [markdown] role=objective
# ## Your turn

# %% id=ex1 role=solution stub="def double(x):\\n    ..." check={check}
def double(x):
    return 2 * x

# %% [markdown] role=summary
"""

GRADED_LESSON_VACUOUS = LESSON.replace(
    "\n# %% [markdown] role=summary\n", _EXERCISE.format(check='"assert callable(double)"')
)
GRADED_LESSON_HONEST = LESSON.replace(
    "\n# %% [markdown] role=summary\n", _EXERCISE.format(check='"assert double(3) == 6"')
)


@dataclass
class ExecutingPorts(ScriptedPorts):
    """`run_notebook` that really executes the cells, so a grader's verdict is the one
    running it would give rather than one the test scripted. Without this the audit
    would be tested against a fake that agrees with it by construction."""

    async def run_notebook(self, spec: NotebookSpec) -> ExecutionReport:
        self.calls.append("execute")
        namespace: dict[str, object] = {}
        cells, stopped = [], False
        for cell in spec.cells:
            if not cell.is_code:
                continue
            if stopped:
                cells.append(CellResult(id=cell.id, status="not_run"))
                continue
            try:
                exec(cell.source, namespace)  # noqa: S102 - a test's own sandbox
            except Exception as exc:  # noqa: BLE001
                cells.append(
                    CellResult(
                        id=cell.id,
                        status="error",
                        error=CellError(ename=type(exc).__name__, evalue=str(exc)),
                    )
                )
                # A grader raising is a failed GRADE, not a broken notebook — the same
                # rule `spec_with_graders` encodes with the `raises-exception` tag.
                stopped = not cell.may_raise
            else:
                cells.append(CellResult(id=cell.id, status="ok"))
        return ExecutionReport(
            notebook_slug=spec.slug, ok=not stopped, runner="inprocess", cells=cells
        )


async def test_a_generated_grader_that_cannot_fail_is_stripped_before_the_reader() -> None:
    ports = ExecutingPorts(drafts=[GRADED_LESSON_VACUOUS])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None
    assert [v.verdict for v in outcome.graders.verdicts] == ["cannot-fail"]
    # The exercise survives; only the verdict that would have been wrong goes.
    cell = outcome.spec.cell_by_id("ex1")
    assert cell.check is None
    assert cell.stub is not None and cell.source.strip().startswith("def double")
    assert ports.calls.count("execute") == 3, "one run, then the audit's two"
    assert ("notebook.graders", "failed", "0/1 graders sound, 1 unsound") in ports.events


async def test_a_sound_generated_grader_survives_the_audit() -> None:
    """The other arm. A gate that strips every grader passes the test above perfectly."""
    ports = ExecutingPorts(drafts=[GRADED_LESSON_HONEST])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None and outcome.graders.ok
    assert [v.verdict for v in outcome.graders.verdicts] == ["sound"]
    assert outcome.spec.cell_by_id("ex1").check == "assert double(3) == 6"
    assert ports.calls.count("execute") == 3


async def test_a_notebook_with_no_grader_spends_no_audit_run() -> None:
    ports = ExecutingPorts(drafts=[LESSON])
    outcome = await generate(ports, GenerationRequest(brief="b"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is None, "no audit ran, which is not the same as one that passed"
    assert ports.calls.count("execute") == 1
    assert not any(e[0] == "notebook.graders" for e in ports.events)


async def test_a_revise_turn_that_rewrites_a_grader_is_audited() -> None:
    """The lane the gate would otherwise miss: a reader asks for a harder exercise, the
    model rewrites the hidden assertion, and nothing had proved the new one."""
    spec = parse_source(GRADED_LESSON_HONEST, slug="graded")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="made it harder",
            summary="harder",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id="ex1",
                    cells_source=(
                        '# %% id=ex1 role=solution stub="def double(x):\\n    ..." '
                        'check="assert callable(double)"\ndef double(x):\n    return 2 * x\n'
                    ),
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="harder please"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None
    assert [v.verdict for v in outcome.graders.verdicts] == ["cannot-fail"]
    assert outcome.spec.cell_by_id("ex1").check is None


async def test_a_revise_turn_that_only_weakens_the_stub_is_still_audited() -> None:
    """The edit that invalidates a proof without touching the assertion.

    "Make the stub closer to the answer" leaves `check` byte-identical and turns a
    sound grader vacuous — the check now passes against the placeholder, so the reader
    is marked correct before starting. Keying the audit on the check text alone would
    skip exactly this case. Greptile caught it on PR 830.
    """
    spec = parse_source(GRADED_LESSON_HONEST, slug="graded")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="easier now",
            summary="softer stub",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id="ex1",
                    cells_source=(
                        # Same check, and a stub that already satisfies it.
                        '# %% id=ex1 role=solution stub="def double(x):\\n    return 2 * x" '
                        'check="assert double(3) == 6"\ndef double(x):\n    return 2 * x\n'
                    ),
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="make it easier"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None, "the audit must run when the stub moved"
    assert [v.verdict for v in outcome.graders.verdicts] == ["cannot-fail"]
    assert outcome.spec.cell_by_id("ex1").check is None


async def test_a_revise_turn_that_only_rewrites_the_solution_is_still_audited() -> None:
    """The mirror case: the author's own answer changes under an unchanged check, and
    the check can no longer pass against it."""
    spec = parse_source(GRADED_LESSON_HONEST, slug="graded")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="different approach",
            summary="new solution",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id="ex1",
                    cells_source=(
                        '# %% id=ex1 role=solution stub="def double(x):\\n    ..." '
                        'check="assert double(3) == 6"\ndef double(x):\n    return x + 1\n'
                    ),
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="rewrite it"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None
    assert [v.verdict for v in outcome.graders.verdicts] == ["cannot-pass"]


UPSTREAM_DEPENDENT = LESSON.replace(
    "\n# %% [markdown] role=summary\n",
    """
# %% id=const role=setup
EXPECTED = 6

# %% [markdown] role=objective
# ## Your turn

# %% id=ex1 role=solution stub="def double(x):\\n    ..." check="assert double(3) == EXPECTED"
def double(x):
    return 2 * x

# %% [markdown] role=summary
""",
)


async def test_a_revise_turn_that_edits_an_UPSTREAM_cell_is_still_audited() -> None:
    """The third layer, and the least obvious: both audit arms run the whole notebook in
    one namespace, so a grader is proved against the state the cells above it leave
    behind. Here `EXPECTED` moves and the check — byte-identical, on a cell nobody
    touched — stops passing against the author's own solution. Greptile, PR 830."""
    spec = parse_source(UPSTREAM_DEPENDENT, slug="graded")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="changed the constant",
            summary="constant",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id="const",
                    cells_source="# %% id=const role=setup\nEXPECTED = 7\n",
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="change the constant"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is not None, "an upstream code edit must re-audit"
    assert [v.verdict for v in outcome.graders.verdicts] == ["cannot-pass"]
    assert outcome.spec.cell_by_id("ex1").check is None


async def test_a_revise_turn_that_only_edits_PROSE_still_spends_nothing() -> None:
    """The other side of the same rule. Markdown does not run, so it cannot move a
    grader's proof — and prose edits are most revise turns. A predicate that audited
    every revision would be correct and would also make the feature too expensive to
    keep."""
    spec = parse_source(GRADED_LESSON_HONEST, slug="graded")
    markdown = next(c for c in spec.cells if c.kind == "markdown")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="reworded",
            summary="prose",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id=markdown.id,
                    cells_source=f"# %% [markdown] id={markdown.id} role=objective\n# ## A clearer heading\n",
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="reword the heading"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is None
    assert ports.calls.count("execute") == 1
    assert outcome.spec.cell_by_id("ex1").check == "assert double(3) == 6"


# --------------------------------------------------- the answer-key audit, in the lane
#
# `answer_audit` has its own unit tests. What these prove is the WIRING — that generate
# and revise actually call it and act on what it says. A perfectly correct audit nothing
# calls is exactly the state question cells were already in: engine built, unreachable.

# Inserted BEFORE the summary cell, not appended: `check_structure` requires the
# notebook to end with `summary` or `references`, so questions tacked on the end make
# the draft fail structure and never reach the audit at all.
_SUMMARY_CELL = "# %% [markdown] role=summary"
_QUESTIONS = (
    "# %% [markdown] role=question "
    'answer={"kind":"numeric","value":0.5,"tolerance":0.01,"unit":"probability"}\n'
    "# What is the chance of measuring 1?\n\n"
    "# %% [markdown] role=question "
    'answer={"kind":"numeric","value":0.5,"tolerance":0.9}\n'
    "# A key that accepts 0, so it grades nothing.\n\n"
)
assert LESSON.count(_SUMMARY_CELL) == 1
QUESTION_LESSON = LESSON.replace(_SUMMARY_CELL, _QUESTIONS + _SUMMARY_CELL)


async def test_generate_reads_the_answer_keys_and_strips_the_one_that_grades_nothing() -> None:
    ports = ScriptedPorts(drafts=[QUESTION_LESSON])
    outcome = await generate(ports, GenerationRequest(brief="teach me a coin"))
    assert outcome.status == "ready"
    assert outcome.answers is not None
    assert [v.verdict for v in outcome.answers.verdicts] == ["sound", "cannot-fail"]
    kept = [cell.id for cell in outcome.spec.cells if cell.answer is not None]
    assert len(kept) == 1
    # The question survives; only its verdict goes.
    assert (
        sum(1 for c in outcome.spec.cells if c.role is not None and c.role.value == "question") == 2
    )
    assert any(
        stage == "notebook.answers" and status == "failed" for stage, status, _ in ports.events
    )


async def test_a_notebook_with_no_questions_reports_no_answer_audit_at_all() -> None:
    # `None`, not an empty audit: "there were no questions" and "the keys were checked
    # and were fine" are different facts, and a caller reporting "answer keys checked"
    # off a falsy value would conflate them — the same distinction `graders` carries.
    ports = ScriptedPorts(drafts=[LESSON])
    outcome = await generate(ports, GenerationRequest(brief="teach me a coin"))
    assert outcome.answers is None
    assert not any(stage == "notebook.answers" for stage, _, _ in ports.events)


async def test_the_answer_audit_runs_even_when_the_notebook_does_not_execute() -> None:
    # Unlike the grader audit, which is gated on `report.ok`. A question is markdown: a
    # broken code cell says nothing about whether its answer key can fail, and a reader
    # who gets the failed notebook still meets the question.
    one_bad_key = (
        "# %% [markdown] role=question "
        'answer={"kind":"numeric","value":0.5,"tolerance":0.9}\n'
        "# A key that accepts 0.\n\n"
    )
    broken = BROKEN_LESSON.replace(_SUMMARY_CELL, one_bad_key + _SUMMARY_CELL)
    still_broken = "# %% id=c05 role=run\nundefined_name\n"
    ports = ScriptedPorts(drafts=[broken], repairs=[still_broken] * 5)
    outcome = await generate(
        ports, GenerationRequest(brief="teach me a coin"), PipelineBudget(max_repairs=1)
    )
    assert outcome.status == "ready" and outcome.cell_errors  # kept, with the error named
    assert outcome.answers is not None
    assert [v.verdict for v in outcome.answers.verdicts] == ["cannot-fail"]
    assert all(cell.answer is None for cell in outcome.spec.cells)


# ----------------------------------------- the audience reaches the gate (or it does nothing)


async def test_the_requested_audience_reaches_the_structure_gate() -> None:
    """The level-specific rules are dead unless the CANDIDATE carries the level.

    `check_structure` reads `spec.audience.level`, and the spec it reads is the one
    `parse_source` built from the model's draft. The `.nb.py` header format has no
    `audience:` key at all, so a parsed candidate always carries the default,
    `Audience(level="engineer")` — and `engineer` is deliberately the one level with no
    extra rules. Without the pipeline copying the outline's audience onto the candidate,
    a newcomer's course would be checked against nothing beyond its kind, every unit test
    of the level rules would still pass, and the whole audience dimension would run zero
    times in production.

    Asserted through the pipeline's own feedback, because that is the only place the
    effect is observable: a failing rule becomes the text handed back to the model on its
    retry. The expected strings are taken FROM the rule set rather than typed out — a
    hand-copied sentence would make this test fail when a rule is reworded, which teaches
    the next reader to loosen the assertion rather than to look.
    """
    from leona_notebooks.prompts import NotebookOutline
    from leona_notebooks.templates import _LEVEL_RULES

    newcomer_only = {rule.text for rule in _LEVEL_RULES["newcomer"]} - {
        rule.text for rule in _LEVEL_RULES["engineer"]
    }
    assert newcomer_only, "the newcomer level has no rules of its own; this test proves nothing"

    class NewcomerPorts(ScriptedPorts):
        async def outline(self, request):
            self.calls.append("outline")
            return NotebookOutline.model_validate(
                {**OUTLINE.model_dump(), "audience": {"level": "newcomer"}}
            )

    ports = NewcomerPorts(drafts=[LESSON, LESSON])
    await generate(
        ports, GenerationRequest(brief="teach me a coin", audience={"level": "newcomer"})
    )
    failures = {detail for stage, status, detail in ports.events if status == "failed"}
    assert failures & newcomer_only, (
        "no newcomer-only rule reached the gate, so the draft was checked as an engineer "
        f"notebook. failures seen: {sorted(failures)}"
    )

    # The control: the SAME draft asked for at the default level must not trip any of
    # those rules, or the assertion above is about the fixture rather than the level.
    default_ports = ScriptedPorts(drafts=[LESSON, LESSON])
    await generate(default_ports, GenerationRequest(brief="teach me a coin"))
    default_failures = {d for _s, status, d in default_ports.events if status == "failed"}
    assert not (default_failures & newcomer_only)


# ------------------------------- a structure failure that survives is visible, not silent
#
# `check_structure` is not a gate, and reading the draft loop as one is the mistake these
# cover. On a failure the loop keeps `spec = spec or candidate` — "the best so far rather
# than nothing" — so when every attempt fails, `spec` is not None, nothing raises, and the
# notebook finishes `ready` while violating its own kind's contract. That trade is
# defensible. Nobody being able to tell was not.
#
# Named for what it is missing, NOT `BROKEN_LESSON` — that name is taken (line 41, a
# lesson broken by an undefined name, which is about EXECUTION rather than structure).
# Appending a second definition to the end of the module silently rebound it and broke
# five tests that never mention it.

LESSON_WITHOUT_ITS_OBJECTIVE = """\
# ---
# title: Missing its objective
# kind: lesson
# ---

# %% [markdown] role=concept
# Superposition, described without ever asking you to predict anything.

# %% role=run
value = 1

# %% [markdown] role=summary
# Done.
"""


async def test_a_draft_that_never_satisfies_its_structure_still_reports_what_it_missed() -> None:
    """It ships — and it says so, which is the whole change.

    Both draft attempts return a lesson with no objective cell and no learning loop. The
    notebook runs, so it is `ready`; the failures now ride out on the review's warnings,
    which `NotebookVersion.warnings` mirrors, instead of going to `ports.observe` and
    being forgotten.
    """
    ports = ScriptedPorts(drafts=[LESSON_WITHOUT_ITS_OBJECTIVE] * 2)
    outcome = await generate(ports, GenerationRequest(brief="teach me something"))

    assert outcome.status == "ready", "the trade is unchanged: a notebook that runs still ships"
    assert outcome.review is not None, "with no review there is nowhere for a warning to live"
    structure = [w for w in outcome.review.warnings if w.startswith("structure:")]
    assert structure, outcome.review.warnings
    assert any("objective" in w for w in structure), structure


async def test_a_compliant_notebook_gets_no_structure_warnings() -> None:
    """The control. Without it the assertion above passes on a build that warns always,
    which would mark every notebook broken and teach readers to ignore the field."""
    ports = ScriptedPorts(drafts=[LESSON])
    outcome = await generate(ports, GenerationRequest(brief="teach me a coin"))
    assert outcome.status == "ready"
    warnings = list(outcome.review.warnings) if outcome.review else []
    assert not [w for w in warnings if w.startswith("structure:")], warnings


async def test_a_chat_edit_that_deletes_the_objective_cell_is_reported() -> None:
    """`revise()` never called `check_structure` at all.

    `apply_revision` honours a `delete` faithfully — that is its job — so a chat edit
    could remove the objective cell, or every checkpoint, and the notebook came back
    `ready` with nothing recording that it no longer met its contract.
    """
    from leona_notebooks.spec import CellRole

    before = parse_source(LESSON)
    objective = next(cell for cell in before.cells if cell.role is CellRole.OBJECTIVE)
    ports = ScriptedPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="Removed the intro.",
            summary="drop the objective",
            ops=[RevisionOp(op="delete", cell_id=objective.id)],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=before, message="drop the intro"))

    assert outcome.spec is not None
    assert all(cell.role is not CellRole.OBJECTIVE for cell in outcome.spec.cells)
    warnings = list(outcome.review.warnings) if outcome.review else []
    assert any(w.startswith("structure:") for w in warnings), warnings
