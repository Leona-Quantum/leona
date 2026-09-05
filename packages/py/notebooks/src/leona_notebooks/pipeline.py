"""The notebook pipeline, with its side effects behind a Protocol.

    brief (+ seeds) → outline → draft → parse → structure check → execute
                    → repair (bounded) → grader audit → review (advisory) → save

The order is owned here, not by the model. `NotebookPorts` is what the worker implements
with real LLM calls, the real sandbox and the repository layer; tests implement it with
scripted responses. The pipeline never imports the control plane, the worker, FastAPI or
SQLAlchemy — the same rule `majorana_agent` lives under.

A revise turn is the same shape with one stage: message → plan → apply → execute →
repair → save.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Protocol

from leona_notebooks.execution import ExecutionReport
from leona_notebooks.grader_audit import GraderAudit, audit_graders, demote_unsound_graders
from leona_notebooks.prompts import NotebookOutline, NotebookReview, RepairContext
from leona_notebooks.revision import RevisionError, RevisionPlan, apply_revision
from leona_notebooks.source import SourceParseError, parse_source, render_source
from leona_notebooks.spec import Cell, NotebookSpec, Seed
from leona_notebooks.templates import check_structure

Stage = Literal[
    "notebook.outline",
    "notebook.draft",
    "notebook.execute",
    "notebook.repair",
    "notebook.graders",
    "notebook.review",
    "notebook.revise",
    "notebook.save",
]


@dataclass(frozen=True)
class GenerationRequest:
    brief: str
    kind_hint: str | None = None
    audience: dict | None = None
    style: dict | None = None
    framework: dict | None = None
    seeds: tuple[Seed, ...] = ()
    seed_material: str = ""
    #: A `role=run` cell that must appear verbatim (an Atlas record's own code).
    seed_run_cell: str | None = None
    response_locale: str = "en"
    slug: str | None = None


@dataclass(frozen=True)
class RevisionRequest:
    spec: NotebookSpec
    message: str
    history: tuple[dict[str, str], ...] = ()
    response_locale: str = "en"


@dataclass
class PipelineBudget:
    max_draft_attempts: int = 2
    max_repairs: int = 3
    review: bool = True


@dataclass
class Attempt:
    stage: Stage
    ok: bool
    detail: str = ""


@dataclass
class PipelineOutcome:
    status: Literal["ready", "failed"]
    spec: NotebookSpec | None
    report: ExecutionReport | None
    review: NotebookReview | None = None
    outline: NotebookOutline | None = None
    #: What the two grader runs showed. `None` when the audit did not run at all —
    #: which is not the same as an audit that found nothing, and a caller reporting
    #: "graders checked" off a falsy value would conflate the two.
    graders: GraderAudit | None = None
    reply: str = ""
    summary: str = ""
    attempts: list[Attempt] = field(default_factory=list)
    error: str = ""

    @property
    def source(self) -> str:
        return render_source(self.spec) if self.spec is not None else ""


class NotebookPorts(Protocol):
    """Everything with a side effect. Each method either returns or raises; the
    pipeline decides what a failure means."""

    async def outline(self, request: GenerationRequest) -> NotebookOutline: ...

    async def draft(
        self, request: GenerationRequest, outline: NotebookOutline, feedback: str | None
    ) -> str:
        """Returns `.nb.py` text."""
        ...

    async def run_notebook(self, spec: NotebookSpec) -> ExecutionReport: ...

    async def repair(self, spec: NotebookSpec, context: RepairContext) -> str:
        """Returns `.nb.py` text of the corrected cell(s), with `id=` markers."""
        ...

    async def review(self, spec: NotebookSpec, report: ExecutionReport) -> NotebookReview: ...

    async def revise(self, request: RevisionRequest) -> RevisionPlan: ...

    async def observe(
        self, stage: Stage, status: Literal["started", "finished", "failed"], detail: str = ""
    ) -> None:
        """Progress, for the run's event stream — awaited so an implementation can write
        to the run's events live, on the handler's own session. Never raises."""
        ...


class _StageFailed(Exception):
    def __init__(self, stage: Stage, detail: str) -> None:
        super().__init__(detail)
        self.stage = stage
        self.detail = detail


def _repair_context(spec: NotebookSpec, report: ExecutionReport) -> RepairContext | None:
    failing = report.first_error()
    if failing is None or failing.error is None:
        return None
    cell = spec.cell_by_id(failing.id)
    preceding: list[tuple[str, str]] = []
    for earlier in spec.cells:
        if earlier.id == cell.id:
            break
        if earlier.is_code:
            preceding.append((earlier.id, earlier.source))
    return RepairContext(
        cell_id=cell.id,
        cell_source=cell.source,
        error_name=failing.error.ename,
        error_value=failing.error.evalue,
        traceback="".join(failing.error.traceback),
        preceding_sources=preceding,
        stdout=failing.stdout,
    )


def _apply_repair(spec: NotebookSpec, cell_id: str, text: str) -> NotebookSpec:
    """A repair is a replace of the failing cell, plus any earlier cell the model named
    by id. Cells without an id become replacements of the failing cell, in order."""
    from leona_notebooks.revision import RevisionOp, explicit_ids

    body = text.strip()
    if not body:
        raise _StageFailed("notebook.repair", "the repair returned no cells")
    fragment = parse_source("# ---\n# title: repair\n# ---\n" + body + "\n")
    named = {c.id for c in spec.cells}
    explicit = explicit_ids(body)
    explicit_targets = [
        c for c in fragment.cells if c.id in explicit and c.id in named and c.id != cell_id
    ]
    replacement = [c for c in fragment.cells if c not in explicit_targets]
    plan_ops = [
        RevisionOp(op="replace", cell_id=target.id, cells_source=render_cells([target]))
        for target in explicit_targets
    ]
    if replacement:
        plan_ops.append(
            RevisionOp(
                op="replace",
                cell_id=cell_id,
                cells_source=render_cells(replacement, include_ids=False),
            )
        )
    if not plan_ops:
        raise _StageFailed("notebook.repair", "the repair returned no cells")
    return apply_revision(spec, RevisionPlan(reply="", ops=plan_ops))


def render_cells(cells: list[Cell], *, include_ids: bool = True) -> str:
    """Percent-format text for a list of cells (no header)."""
    from leona_notebooks.spec import NotebookSpec as _Spec

    rendered = render_source(
        _Spec(slug="fragment", title="fragment", cells=cells), include_ids=include_ids
    )
    return rendered.split("# ---\n", 2)[2]


async def _execute_and_repair(
    ports: NotebookPorts, spec: NotebookSpec, budget: PipelineBudget, attempts: list[Attempt]
) -> tuple[NotebookSpec, ExecutionReport]:
    await ports.observe("notebook.execute", "started")
    report = await ports.run_notebook(spec)
    await ports.observe("notebook.execute", "finished" if report.ok else "failed", report.note)
    attempts.append(Attempt("notebook.execute", report.ok, report.note))
    repairs = 0
    while not report.ok and repairs < budget.max_repairs:
        context = _repair_context(spec, report)
        if context is None:
            break  # not a cell error (the sandbox itself failed): nothing to repair
        repairs += 1
        await ports.observe(
            "notebook.repair", "started", f"{context.cell_id}: {context.error_name}"
        )
        try:
            text = await ports.repair(spec, context)
            spec = _apply_repair(spec, context.cell_id, text)
        except (SourceParseError, RevisionError, ValueError, _StageFailed) as exc:
            attempts.append(Attempt("notebook.repair", False, str(exc)))
            await ports.observe("notebook.repair", "failed", str(exc))
            continue
        attempts.append(Attempt("notebook.repair", True, context.cell_id))
        await ports.observe("notebook.repair", "finished", context.cell_id)
        await ports.observe("notebook.execute", "started")
        report = await ports.run_notebook(spec)
        await ports.observe("notebook.execute", "finished" if report.ok else "failed", report.note)
        attempts.append(Attempt("notebook.execute", report.ok, report.note))
    return spec, report


async def _audit_graders(
    ports: NotebookPorts, spec: NotebookSpec, attempts: list[Attempt]
) -> tuple[NotebookSpec, GraderAudit | None]:
    """Prove every generated grader can fail and can be passed, and drop the ones that
    cannot (owner ruling ai-ops#258).

    Two sandbox runs, flat, and none at all for a notebook with no graded code cell.
    A defective grader demotes its own cell to an ungraded exercise rather than failing
    the notebook: the reader still gets the lesson, and does not get a verdict that is
    wrong in the direction nobody complains about.

    The audit is advisory about ITS OWN failure and load-bearing about what it proves.
    If the audit cannot run — the sandbox is down, an execution raises — the notebook
    still ships, and `graders` stays `None` so the outcome says the check did not
    happen instead of implying it passed.
    """
    if not any(cell.check is not None for cell in spec.cells):
        return spec, None
    await ports.observe("notebook.graders", "started")
    try:
        audit = await audit_graders(spec, ports.run_notebook)
    except Exception as exc:  # noqa: BLE001 - never fails the notebook, never lies about it
        attempts.append(Attempt("notebook.graders", False, str(exc)))
        await ports.observe("notebook.graders", "failed", str(exc))
        return spec, None
    if audit.unsound:
        spec = demote_unsound_graders(spec, audit)
    detail = audit.summary()
    attempts.append(Attempt("notebook.graders", audit.ok, detail))
    await ports.observe("notebook.graders", "finished" if audit.ok else "failed", detail)
    for verdict in audit.unsound + audit.inconclusive:
        await ports.observe("notebook.graders", "finished", verdict.describe())
    return spec, audit


def _ensure_seed_run_cell(spec: NotebookSpec, seed_run_cell: str | None) -> NotebookSpec:
    """A walkthrough must run the seed's code verbatim. If the draft paraphrased it, put
    the verbatim cell in front of the first run cell."""
    if not seed_run_cell:
        return spec
    wanted = seed_run_cell.strip()
    if any(c.is_code and wanted in c.source for c in spec.cells):
        return spec
    cells = list(spec.cells)
    index = next(
        (i for i, c in enumerate(cells) if c.role is not None and c.role.value == "run"), 1
    )
    cells.insert(
        index,
        Cell(id=spec.next_cell_id(), kind="code", role="run", source=seed_run_cell, tags=["seed"]),  # type: ignore[arg-type]
    )
    return spec.with_cells(cells)


async def generate(
    ports: NotebookPorts, request: GenerationRequest, budget: PipelineBudget | None = None
) -> PipelineOutcome:
    budget = budget or PipelineBudget()
    attempts: list[Attempt] = []
    outline: NotebookOutline | None = None
    try:
        await ports.observe("notebook.outline", "started")
        outline = await ports.outline(request)
        await ports.observe("notebook.outline", "finished", outline.title)
        attempts.append(Attempt("notebook.outline", True, outline.title))

        spec: NotebookSpec | None = None
        feedback: str | None = None
        for _ in range(budget.max_draft_attempts):
            await ports.observe("notebook.draft", "started")
            text = await ports.draft(request, outline, feedback)
            try:
                candidate = parse_source(text, slug=request.slug)
            except (SourceParseError, ValueError) as exc:
                feedback = f"The draft did not parse as notebook source: {exc}"
                attempts.append(Attempt("notebook.draft", False, feedback))
                await ports.observe("notebook.draft", "failed", feedback)
                continue
            candidate = candidate.model_copy(
                update={
                    "brief": request.brief,
                    "seeds": list(request.seeds),
                    "references": candidate.references or list(outline.references),
                }
            )
            candidate = _ensure_seed_run_cell(candidate, request.seed_run_cell)
            problems = check_structure(candidate)
            if problems:
                feedback = "The draft misses these requirements:\n- " + "\n- ".join(problems)
                attempts.append(Attempt("notebook.draft", False, feedback))
                await ports.observe("notebook.draft", "failed", "; ".join(problems)[:300])
                spec = spec or candidate  # keep the best so far rather than nothing
                continue
            spec = candidate
            attempts.append(Attempt("notebook.draft", True, f"{len(spec.cells)} cells"))
            await ports.observe("notebook.draft", "finished", f"{len(spec.cells)} cells")
            break
        if spec is None:
            raise _StageFailed("notebook.draft", feedback or "no draft parsed")

        spec, report = await _execute_and_repair(ports, spec, budget, attempts)

        graders: GraderAudit | None = None
        if report.ok:
            # Only on a notebook that runs. Auditing graders inside a notebook that
            # already fails would report every one of them `inconclusive`, spend two
            # sandbox runs saying so, and bury the real error under the noise.
            spec, graders = await _audit_graders(ports, spec, attempts)

        review: NotebookReview | None = None
        if budget.review and report.ok:
            await ports.observe("notebook.review", "started")
            try:
                review = await ports.review(spec, report)
                await ports.observe("notebook.review", "finished", review.verdict)
                attempts.append(Attempt("notebook.review", True, review.verdict))
            except Exception as exc:  # noqa: BLE001 - advisory: never fails the notebook
                attempts.append(Attempt("notebook.review", False, str(exc)))
                await ports.observe("notebook.review", "failed", str(exc))

        status: Literal["ready", "failed"] = "ready" if report.ok else "failed"
        error = "" if report.ok else _describe_failure(report)
        return PipelineOutcome(
            status=status,
            spec=spec,
            report=report,
            review=review,
            outline=outline,
            graders=graders,
            summary=f"generated from brief: {request.brief[:80]}",
            attempts=attempts,
            error=error,
        )
    except _StageFailed as exc:
        await ports.observe(exc.stage, "failed", exc.detail)
        return PipelineOutcome(
            status="failed",
            spec=None,
            report=None,
            outline=outline,
            attempts=attempts,
            error=f"{exc.stage}: {exc.detail}",
        )


async def revise(
    ports: NotebookPorts, request: RevisionRequest, budget: PipelineBudget | None = None
) -> PipelineOutcome:
    budget = budget or PipelineBudget()
    attempts: list[Attempt] = []
    await ports.observe("notebook.revise", "started")
    plan = await ports.revise(request)
    if not plan.ops:
        await ports.observe("notebook.revise", "finished", "no edit")
        return PipelineOutcome(
            status="ready",
            spec=None,
            report=None,
            reply=plan.reply,
            summary="",
            attempts=[Attempt("notebook.revise", True, "answered without editing")],
        )
    try:
        spec = apply_revision(request.spec, plan)
    except RevisionError as exc:
        await ports.observe("notebook.revise", "failed", str(exc))
        return PipelineOutcome(
            status="failed",
            spec=None,
            report=None,
            reply=plan.reply,
            attempts=[Attempt("notebook.revise", False, str(exc))],
            error=f"notebook.revise: {exc}",
        )
    attempts.append(Attempt("notebook.revise", True, f"{len(plan.ops)} op(s)"))
    await ports.observe("notebook.revise", "finished", plan.summary or f"{len(plan.ops)} op(s)")
    spec, report = await _execute_and_repair(ports, spec, budget, attempts)
    graders: GraderAudit | None = None
    # A revise turn can write a grader as easily as `generate` can — "make exercise 2
    # harder" rewrites the hidden assertion — so this lane needs the same proof. It only
    # needs it when a check actually moved, though: auditing an edit that touched none
    # of them would spend two sandbox runs per chat message to re-prove what generation
    # already proved.
    if report.ok and _grader_proof_is_stale(request.spec, spec):
        spec, graders = await _audit_graders(ports, spec, attempts)
    review: NotebookReview | None = None
    if budget.review and report.ok:
        try:
            review = await ports.review(spec, report)
        except Exception as exc:  # noqa: BLE001 - advisory
            attempts.append(Attempt("notebook.review", False, str(exc)))
    return PipelineOutcome(
        status="ready" if report.ok else "failed",
        spec=spec,
        report=report,
        review=review,
        graders=graders,
        reply=plan.reply,
        summary=plan.summary or "edited in chat",
        attempts=attempts,
        error="" if report.ok else _describe_failure(report),
    )


def _grader_proof_is_stale(before: NotebookSpec, after: NotebookSpec) -> bool:
    """Whether a revision invalidated what the audit proved about this notebook.

    Both audit arms execute the WHOLE notebook in one ordered namespace, so a grader's
    proof is a statement about the executed program, not about the graded cell. Three
    layers of that, and each was found by taking the layer above seriously:

    1. the check text — the obvious one;
    2. the graded cell's `stub` and `source`, which are what the two arms substitute in.
       "Make the stub closer to the answer" leaves the assertion byte-identical and
       turns a sound grader vacuous;
    3. **every other cell that runs.** `assert double(3) == expected` is proved against
       whatever `expected` was when the audit ran; editing, deleting, inserting or
       reordering an upstream cell can make the same assertion accept a blank exercise
       or reject the authored solution, without the graded cell changing at all.

    So the comparison is the ordered executed shape of the notebook. Markdown is not in
    it — prose edits, which are most revise turns, cost nothing — and neither is a
    notebook with no grader at all, which returns before any of this. What it does cost
    is two sandbox runs on any revise turn that moves runnable code in a graded
    notebook, and that is the honest price of the guarantee: the alternative is a
    verdict that was true of a notebook the reader is no longer reading.

    Both findings are Greptile's, on PR 830.
    """
    if not any(cell.check is not None for cell in after.cells):
        return False

    def executed(
        spec: NotebookSpec,
    ) -> list[tuple[str, str, str | None, str | None, tuple[str, ...]]]:
        # ORDERED, and including the id: reordering two cells changes what a later one
        # sees, and a list keyed by id would report a reorder as no change at all.
        return [
            (cell.id, cell.source, cell.stub, cell.check, tuple(cell.tags))
            for cell in spec.cells
            if cell.runs_in_sandbox
        ]

    return executed(before) != executed(after)


def _describe_failure(report: ExecutionReport) -> str:
    first = report.first_error()
    if first is not None and first.error is not None:
        return f"cell {first.id} failed: {first.error.ename}: {first.error.evalue[:300]}"
    return report.note or "the notebook did not execute cleanly"
