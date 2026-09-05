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
from leona_notebooks.prompts import NotebookOutline, NotebookReview, RepairContext
from leona_notebooks.revision import RevisionOp, RevisionPlan
from leona_notebooks.source import parse_source
from leona_notebooks.spec import NotebookSpec

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

    async def outline(self, request: GenerationRequest) -> NotebookOutline:
        self.calls.append("outline")
        return OUTLINE

    async def draft(self, request, outline, feedback):
        self.calls.append(f"draft(feedback={'yes' if feedback else 'no'})")
        return self.drafts.pop(0)

    async def run_notebook(self, spec: NotebookSpec) -> ExecutionReport:
        self.calls.append("execute")
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


async def test_repair_budget_is_bounded_and_failure_is_named() -> None:
    still_broken = "# %% id=c05 role=run\nundefined_name\n"
    ports = ScriptedPorts(drafts=[BROKEN_LESSON], repairs=[still_broken] * 5)
    outcome = await generate(ports, GenerationRequest(brief="b"), PipelineBudget(max_repairs=2))
    assert outcome.status == "failed"
    assert ports.calls.count("repair(c05)") == 2
    assert ports.calls.count("execute") == 3
    assert "cell c05 failed: NameError" in outcome.error
    assert "review" not in ports.calls
    assert outcome.spec is not None  # the best attempt is kept for the reader to see


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
    assert outcome.status == "failed"
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


async def test_a_revise_turn_that_touches_no_grader_spends_nothing() -> None:
    spec = parse_source(GRADED_LESSON_HONEST, slug="graded")
    ports = ExecutingPorts(
        drafts=[],
        revision=RevisionPlan(
            reply="ok",
            summary="prose",
            ops=[
                RevisionOp(
                    op="replace",
                    cell_id="c02",
                    cells_source="# %% id=c02 role=setup\nimport qiskit\n",
                )
            ],
        ),
    )
    outcome = await revise(ports, RevisionRequest(spec=spec, message="tidy the setup"))
    assert outcome.status == "ready", outcome.error
    assert outcome.graders is None
    assert ports.calls.count("execute") == 1
    assert outcome.spec.cell_by_id("ex1").check == "assert double(3) == 6"


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
