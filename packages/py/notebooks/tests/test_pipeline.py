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

    async def execute(self, spec: NotebookSpec) -> ExecutionReport:
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
