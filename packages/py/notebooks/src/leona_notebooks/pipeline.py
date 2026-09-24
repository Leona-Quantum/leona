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
from leona_notebooks.answer_audit import AnswerAudit, audit_answers, demote_unsound_answers
from leona_notebooks.error_hints import hints_for
from leona_notebooks.grader_audit import GraderAudit, audit_graders, demote_unsound_graders
from leona_notebooks.lint import DEFINITE, lint_cell
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
    "notebook.answers",
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
    #: What reading the answer keys showed. `None` only when the notebook has no
    #: question cells at all — unlike `graders`, this audit runs nothing and so has no
    #: "could not be performed" state to distinguish.
    answers: AnswerAudit | None = None
    reply: str = ""
    summary: str = ""
    attempts: list[Attempt] = field(default_factory=list)
    error: str = ""
    #: On a `ready` outcome whose report is not clean: which cell raised and how, for the
    #: reader-facing turn. Empty when every cell ran, and always empty on `failed` (where
    #: `error` carries it). See `is_usable` for why these are two different states.
    cell_errors: str = ""

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


def _preceding_code(spec: NotebookSpec, cell_id: str) -> list[tuple[str, str]]:
    preceding: list[tuple[str, str]] = []
    for earlier in spec.cells:
        if earlier.id == cell_id:
            break
        if earlier.is_code:
            preceding.append((earlier.id, earlier.source))
    return preceding


def _lint_notes(spec: NotebookSpec, cell_id: str) -> tuple[str, ...]:
    cell = spec.cell_by_id(cell_id)
    preceding = [source for _, source in _preceding_code(spec, cell_id)]
    return tuple(finding.render() for finding in lint_cell(cell.source, preceding))


def _repair_context(
    spec: NotebookSpec,
    report: ExecutionReport,
    failed_fixes: dict[str, list[tuple[str, str]]] | None = None,
) -> RepairContext | None:
    failing = report.first_error()
    if failing is None or failing.error is None:
        return None
    cell = spec.cell_by_id(failing.id)
    return RepairContext(
        cell_id=cell.id,
        cell_source=cell.source,
        error_name=failing.error.ename,
        error_value=failing.error.evalue,
        traceback="".join(failing.error.traceback),
        preceding_sources=_preceding_code(spec, cell.id),
        stdout=failing.stdout,
        lint_notes=_lint_notes(spec, cell.id),
        hints=hints_for(failing.error.ename, failing.error.evalue),
        failed_fixes=tuple((failed_fixes or {}).get(cell.id, ())),
    )


def _first_definite_finding(
    spec: NotebookSpec,
    failed_fixes: dict[str, list[tuple[str, str]]] | None = None,
) -> RepairContext | None:
    """The first executable code cell with a lint finding that is certain to raise, as a
    repair context with no traceback. Heuristic findings (`gate-returns-instructions`) are
    not enough to spend a model call before running: they go into the repair prompt only
    once the cell has actually failed.

    Two callers: the pre-run loop in `_execute_and_repair` (before any sandbox dispatch,
    where `failed_fixes` is always empty — nothing has failed yet), and
    `_guard_blocked_context` (after the sandbox's own guard has already refused a cell the
    linter can also see — `forbidden-import` reads the same `ALLOWED_IMPORTS` set the guard
    checks — where `failed_fixes` carries whatever this cell has already failed on, so a
    second guard-caught repair is told the first one is not a fix to repeat).
    """
    preceding: list[str] = []
    for cell in spec.cells:
        if not cell.is_code:
            continue
        if cell.runs_in_sandbox:
            findings = lint_cell(cell.source, preceding)
            definite = [f for f in findings if f.code in DEFINITE]
            if definite:
                return RepairContext(
                    cell_id=cell.id,
                    cell_source=cell.source,
                    error_name=definite[0].code,
                    error_value=definite[0].message,
                    traceback="",
                    preceding_sources=_preceding_code(spec, cell.id),
                    lint_notes=tuple(f.render() for f in findings),
                    hints=hints_for(definite[0].code, definite[0].message),
                    failed_fixes=tuple((failed_fixes or {}).get(cell.id, ())),
                    before_running=True,
                )
        preceding.append(cell.source)
    return None


def _is_guard_blocked(report: ExecutionReport) -> bool:
    """Whether `report` is the shape `ProductionNotebookPorts.run_notebook` returns for a
    `NotebookGuardError`: EVERY code cell `skipped`, none `error` — see
    `services/worker/src/majorana_worker/notebook_handlers.py`. `report.first_error()`
    only looks at `status == "error"`, so it is blind to this, and without this check a
    guard refusal reads to `_execute_and_repair` exactly like a sandbox that fell over:
    "not a cell error, nothing to repair" — which is what happened to `rnd-vqe-h2-a`
    (ai-ops#375 round 1): the guard blocked c04's `import qiskit_nature`, the repair loop
    broke on the next iteration, and the run was reported `failed` with 0 of 9 code cells
    ever executed."""
    return (
        not report.ok
        and report.first_error() is None
        and any(cell.status == "skipped" and "safety guard" in cell.note for cell in report.cells)
    )


def _guard_blocked_context(
    spec: NotebookSpec, failed_fixes: dict[str, list[tuple[str, str]]]
) -> RepairContext | None:
    """A repair context for a guard-blocked report, built from the linter rather than
    parsed out of the guard's own message text.

    The guard's `NotebookGuardError` records which cells it refused and why, but
    `ProductionNotebookPorts.run_notebook` folds that into one string shared by every
    `CellResult.note` (see `_is_guard_blocked`) and the structured `dict[str, list[str]]`
    the guard built goes nowhere the pipeline can read it back. Re-deriving it by
    re-parsing that string would drift the moment the message wording changes; instead
    this asks `leona_notebooks.lint` the SAME question the guard just answered —
    `forbidden-import` reads off the identical `ALLOWED_IMPORTS` set
    (`lint._allowed_imports`) the sandbox guard checks — so the cell this names is
    guaranteed to be a cell the guard would also refuse.

    Returns `None` when the block was for a violation `lint` cannot see (a denied
    substring or call, not a disallowed import): there is nothing here to build a useful
    repair context from, and the loop falls back to giving up, as it did before this
    existed — narrower than "every guard violation is repairable" on purpose, since a
    wrong finding here would send the repair model after a cell that was not the
    problem.
    """
    return _first_definite_finding(spec, failed_fixes)


def is_usable(report: ExecutionReport) -> bool:
    """Whether a run produced a notebook worth handing to the reader.

    A cell that raised is a RESULT, the rule `_handle_author` in the worker already
    applies to a reader's own edit (plan 10-notebook-ide, rule 1). Before 2026-09-23 a
    generated notebook with one failing cell was saved `failed` and shown as nothing: the
    production notebook of 2026-09-24 01:07Z had 36 cells, 7 of its 9 code cells ran, and
    the reader got a page that said it was still being prepared and a chat that refused
    his messages. What is not usable is a run where nothing executed at all (the sandbox
    failed, the guard refused everything): there is no result to show."""
    return report.ok or report.executed_count() > 0


def _weakened_check_finding(source: str) -> str | None:
    """The message of the first `leona_notebooks.lint.WEAKENS_CHECK` finding in `source`,
    or `None`. Used to refuse a repair that passes a check by making it unable to fail,
    rather than by fixing what it checks — see `REPAIR_SYSTEM_PROMPT` and
    `_validate_repair_cells`."""
    from leona_notebooks.lint import WEAKENS_CHECK

    for finding in lint_cell(source):
        if finding.code in WEAKENS_CHECK:
            return finding.message
    return None


def _validate_repair_cells(
    spec: NotebookSpec, cell_id: str, explicit_targets: list[Cell], replacement: list[Cell]
) -> None:
    """What `REPAIR_SYSTEM_PROMPT` asks for, checked rather than trusted: at most
    `prompts.MAX_REPAIR_CELLS` cells touched, every one of them a cell that already
    existed (never a new one smuggled in), each keeping the kind and role of the cell it
    replaces, and none of them a check weakened into something that cannot fail. Raising
    `_StageFailed` here is exactly what an unparseable repair already does — the caller
    (`_execute_and_repair`) counts it as a failed repair attempt and tries again, up to
    the budget, rather than applying it.

    `replacement` (the cells with no `id=`, or `id=cell_id`, standing in for the failing
    cell) is checked for a COUNT of at most one before this is called at all — see the
    call site — because more than one there is new cells being inserted under cover of
    "replacing the failing cell", which no amount of per-cell validation here can permit.
    """
    from leona_notebooks.prompts import MAX_REPAIR_CELLS

    touched = 1 + len(explicit_targets)
    if touched > MAX_REPAIR_CELLS:
        raise _StageFailed(
            "notebook.repair",
            f"the repair touched {touched} cells; at most {MAX_REPAIR_CELLS} are allowed "
            "in one repair",
        )
    candidates = list(explicit_targets)
    if replacement:
        candidates.append(replacement[0].model_copy(update={"id": cell_id}))
    for candidate in candidates:
        try:
            original = spec.cell_by_id(candidate.id)
        except KeyError:
            # Cannot actually happen for `explicit_targets` (already filtered to ids in
            # `named`) or for the primary replacement (its id IS `cell_id`, which the
            # caller already has); kept as a named failure rather than an assertion so a
            # future caller that stops filtering this way fails loudly, not silently.
            raise _StageFailed(
                "notebook.repair", f"the repair named cell {candidate.id!r}, which does not exist"
            ) from None
        if candidate.kind != original.kind or candidate.role != original.role:
            raise _StageFailed(
                "notebook.repair",
                f"the repair changed cell {candidate.id}'s kind or role "
                f"({original.kind}/{original.role} -> {candidate.kind}/{candidate.role}); "
                "a repair may fix a cell's content, not what kind of cell it is",
            )
        if candidate.is_code:
            weakened = _weakened_check_finding(candidate.source)
            if weakened is not None:
                raise _StageFailed(
                    "notebook.repair",
                    f"the repair of cell {candidate.id} weakens a check instead of fixing "
                    f"it: {weakened}",
                )


def _with_omitted_from(spec: NotebookSpec, cell: Cell, *, as_id: str | None = None) -> Cell:
    """`cell` with every attribute it left unset taken from the existing cell it replaces
    (`as_id`, or its own id). Only unset values are filled: `role`, `stub`, `check`,
    `answer` and `timeout_s` when None, `tags` when empty. `kind`, `source` and `execute`
    are always the repair's own."""
    try:
        original = spec.cell_by_id(as_id or cell.id)
    except KeyError:
        return cell
    update: dict[str, object] = {}
    for name in ("role", "stub", "check", "answer", "timeout_s"):
        if getattr(cell, name) is None and getattr(original, name) is not None:
            update[name] = getattr(original, name)
    if not cell.tags and original.tags:
        update["tags"] = list(original.tags)
    return cell.model_copy(update=update) if update else cell


def _apply_repair(
    spec: NotebookSpec, cell_id: str, text: str
) -> tuple[NotebookSpec, tuple[str, ...]]:
    """A repair is a replace of the failing cell, plus any earlier cell the model named
    by id. Cells without an id become replacements of the failing cell, in order.

    Returns the new spec and the ids actually touched (for the attempt log — a repair
    that fixed a claim in three places should say so, not just name the cell that failed).
    """
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
    # A repair routinely writes a bare `# %%` header, leaving out the attributes of the cell
    # it replaces. Read as written, an omitted `role` failed the kind/role check below
    # (`code/run -> code/None`), so EVERY such repair was refused and the budget spent for
    # nothing: measured 2026-09-24, a `QFTGate(inverse=True)` and a `c_if` the linter had
    # correctly caught were never fixed. Before that check existed, the same omission
    # silently dropped the role, and would drop a grader's `check`/`answer` too. What the
    # repair left out is taken from the original cell; what it set explicitly is kept, so
    # a repair that CHANGES a role is still refused.
    explicit_targets = [_with_omitted_from(spec, c) for c in explicit_targets]
    replacement = [_with_omitted_from(spec, c, as_id=cell_id) for c in replacement]
    if len(replacement) > 1:
        # More than one cell standing in for the ONE failing cell is new cells being
        # inserted under cover of a replace, not a fix of it — `no new cells` from
        # `REPAIR_SYSTEM_PROMPT`. Checked before `_validate_repair_cells` because that
        # function only looks at `replacement[0]`; without this, cell 2+ would be
        # silently dropped from validation and then silently spliced in anyway.
        raise _StageFailed(
            "notebook.repair",
            f"the repair replaced cell {cell_id} with {len(replacement)} cells; "
            "a repair may only replace a cell with ONE cell, never insert new ones",
        )
    _validate_repair_cells(spec, cell_id, explicit_targets, replacement)
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
    # `cell_id` is only in `touched` when something actually replaced it (`replacement`
    # non-empty) — a repair that fixes only an EARLIER cell by id and leaves the failing
    # cell as-is (the assertion was right; the circuit above it was wrong) touches that
    # earlier cell, not the one the model was shown as failing.
    touched_ids = [*(t.id for t in explicit_targets), *([cell_id] if replacement else [])]
    touched = tuple(dict.fromkeys(touched_ids))
    return apply_revision(spec, RevisionPlan(reply="", ops=plan_ops)), touched


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
    repairs = 0

    # Before the first sandbox run: a cell the linter can PROVE will raise is repaired
    # now, from the finding, rather than after a run that would only confirm it. Shares
    # the repair budget, and stops the moment a repair leaves the same finding in place,
    # so a model that cannot fix it here gets the traceback below instead.
    last_seen: tuple[str, str] | None = None
    while repairs < budget.max_repairs:
        context = _first_definite_finding(spec)
        if context is None or (context.cell_id, context.error_value) == last_seen:
            break
        last_seen = (context.cell_id, context.error_value)
        repairs += 1
        await ports.observe(
            "notebook.repair", "started", f"{context.cell_id}: {context.error_name}"
        )
        try:
            text = await ports.repair(spec, context)
            spec, touched = _apply_repair(spec, context.cell_id, text)
        except (SourceParseError, RevisionError, ValueError, _StageFailed) as exc:
            attempts.append(Attempt("notebook.repair", False, str(exc)))
            await ports.observe("notebook.repair", "failed", str(exc))
            continue
        attempts.append(Attempt("notebook.repair", True, ", ".join(touched)))
        await ports.observe("notebook.repair", "finished", context.cell_id)

    await ports.observe("notebook.execute", "started")
    report = await ports.run_notebook(spec)
    await ports.observe("notebook.execute", "finished" if report.ok else "failed", report.note)
    attempts.append(Attempt("notebook.execute", report.ok, report.note))
    #: cell id -> [(source the model returned, the error that source then raised)].
    failed_fixes: dict[str, list[tuple[str, str]]] = {}
    while not report.ok and repairs < budget.max_repairs:
        context = _repair_context(spec, report, failed_fixes)
        if context is None and _is_guard_blocked(report):
            # `report.first_error()` cannot see a guard refusal (every cell is
            # `skipped`, none `error`) — without this branch the loop below reads it as
            # "not a cell error: nothing to repair" and gives up. See
            # `_guard_blocked_context` and `_is_guard_blocked`.
            context = _guard_blocked_context(spec, failed_fixes)
            if context is not None and (context.cell_id, context.error_value) == last_seen:
                # The PRE-RUN loop above already spent a repair on this exact finding
                # and gave up on it (that is what left `last_seen` set to it, and the
                # cell still has it, so it reached the sandbox and the guard blocked
                # it). Retrying here would be the same wasted model call the pre-run
                # loop's own `last_seen` check exists to avoid; the difference is only
                # WHERE the repeat would happen, not whether it is still a repeat.
                context = None
        if context is None:
            break  # not a cell error (the sandbox itself failed): nothing to repair
        repairs += 1
        await ports.observe(
            "notebook.repair", "started", f"{context.cell_id}: {context.error_name}"
        )
        try:
            text = await ports.repair(spec, context)
            spec, touched = _apply_repair(spec, context.cell_id, text)
        except (SourceParseError, RevisionError, ValueError, _StageFailed) as exc:
            attempts.append(Attempt("notebook.repair", False, str(exc)))
            await ports.observe("notebook.repair", "failed", str(exc))
            continue
        attempts.append(Attempt("notebook.repair", True, ", ".join(touched)))
        await ports.observe("notebook.repair", "finished", context.cell_id)
        await ports.observe("notebook.execute", "started")
        report = await ports.run_notebook(spec)
        await ports.observe("notebook.execute", "finished" if report.ok else "failed", report.note)
        attempts.append(Attempt("notebook.execute", report.ok, report.note))
        again = report.first_error()
        if again is not None and again.id == context.cell_id and again.error is not None:
            failed_fixes.setdefault(context.cell_id, []).append(
                (
                    spec.cell_by_id(context.cell_id).source,
                    f"{again.error.ename}: {again.error.evalue[:300]}",
                )
            )
        elif _is_guard_blocked(report):
            # The fix did not remove whatever the guard refuses — same cell or a
            # different one, either way still 0 cells run. Recorded under THIS
            # iteration's cell id (not re-derived from the new report) so a repair
            # that keeps failing the guard the same way is told so, the same as a
            # repair that keeps raising the same traceback.
            again_context = _guard_blocked_context(spec, failed_fixes)
            if again_context is not None and again_context.cell_id == context.cell_id:
                failed_fixes.setdefault(context.cell_id, []).append(
                    (spec.cell_by_id(context.cell_id).source, again_context.error_value)
                )
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


async def _audit_answers(
    ports: NotebookPorts, spec: NotebookSpec, attempts: list[Attempt]
) -> tuple[NotebookSpec, AnswerAudit | None]:
    """Read every generated answer key and drop the ones proved worthless.

    The same ruling as `_audit_graders` (ai-ops#258), applied to the other half of a
    graded notebook. Three things differ, and all three follow from the audit being
    static:

    * **It costs nothing.** No sandbox run, no model call. So it is not gated on the
      notebook executing — a question cell is markdown, and a notebook whose code failed
      still ships its questions to a reader.
    * **It always runs on the revise lane too.** `_audit_graders` is gated on a check
      having moved because re-proving one costs two sandbox runs; re-reading an answer
      key costs a dictionary lookup, so the gate would be more expensive than the work.
    * **It has no "could not run" state.** Reading a dataclass does not fail the way
      executing a notebook does, so `None` here means "no question cells", never "the
      check did not happen".
    """
    audit = audit_answers(spec)
    if not audit.verdicts:
        return spec, None
    if audit.unsound:
        spec = demote_unsound_answers(spec, audit)
    detail = audit.summary()
    attempts.append(Attempt("notebook.answers", audit.ok, detail))
    await ports.observe("notebook.answers", "finished" if audit.ok else "failed", detail)
    for verdict in audit.unsound + audit.inconclusive:
        await ports.observe("notebook.answers", "finished", verdict.describe())
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


def _with_structure_warnings(
    review: NotebookReview | None, spec: NotebookSpec
) -> NotebookReview | None:
    """Carry any surviving structure failures out where a reader can see them.

    **`check_structure` is not a gate, and reading the draft loop as one is the mistake
    this closes.** On a failure the loop keeps `spec = spec or candidate` — "the best so
    far rather than nothing" — so when every draft attempt fails, `spec` is not None, no
    exception is raised, and the notebook proceeds to execution and can finish `ready`
    while violating its own kind's contract. That choice is defensible: a notebook that
    runs beats no notebook. What was not defensible is that nobody could tell. The
    failures went to `ports.observe` and were then forgotten, so the stored version
    carried no trace, and neither the author nor a later session could see that a lesson
    shipped with no objective cell or a newcomer's course with none of its pacing.

    Called AFTER execution and repair rather than only inside the draft loop, because
    repair rewrites cells: a draft that satisfied its contract can stop satisfying it,
    and a draft that failed can be fixed into compliance by a repair aimed at something
    else. The loop's own check answers a question about a spec that no longer exists.

    Non-blocking, deliberately. `status` still comes from whether the code ran. This is
    the same shape the range smoke takes for Qapps under owner ruling ai-ops 180 — warn
    the creator, publish either way — and the same reason: a rule that can destroy the
    thing a reader waited for needs evidence these rules have not yet earned.
    """
    problems = check_structure(spec)
    if not problems:
        return review
    notes = [f"structure: {problem}" for problem in problems]
    if review is None:
        # Review is skipped when execution failed and swallowed when it raises, and
        # `NotebookVersion.warnings` is mirrored out of the review blob — so with no
        # review there is nowhere for a warning to live. One is synthesised rather than
        # letting the finding fall on the floor in exactly the cases (a broken or
        # unreviewed notebook) where it is most worth having.
        return NotebookReview(verdict="needs-attention", warnings=notes)
    return review.model_copy(update={"warnings": [*review.warnings, *notes]})


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
                    # The audience and style come from the REQUEST (via the outline the
                    # planner returned), never from the draft. `parse_source` reads
                    # neither out of the `.nb.py` header — there is no `audience:` key in
                    # that format — so a parsed candidate always carries
                    # `Audience(level="engineer")`, whatever the reader asked for.
                    #
                    # Without this the level-specific structure rules would be dead in
                    # the pipeline: `check_structure` reads the level off the spec, would
                    # always have read "engineer", and `engineer` is deliberately the one
                    # level with no rules. A newcomer's course would have been checked
                    # against nothing extra and the whole audience dimension would have
                    # run zero times while every test of it passed.
                    "audience": outline.audience,
                    "style": outline.style,
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

        # Before the `report.ok` gate: an answer key is data, so it is judged whether
        # or not the notebook's code ran, and a reader who gets a broken notebook must
        # still not get a question that marks them right for typing nothing.
        spec, answers = await _audit_answers(ports, spec, attempts)

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

        review = _with_structure_warnings(review, spec)
        status: Literal["ready", "failed"] = "ready" if is_usable(report) else "failed"
        return PipelineOutcome(
            status=status,
            spec=spec,
            report=report,
            review=review,
            outline=outline,
            graders=graders,
            answers=answers,
            summary=f"generated from brief: {request.brief[:80]}",
            attempts=attempts,
            error="" if status == "ready" else describe_failure(report),
            cell_errors="" if report.ok or status == "failed" else describe_failure(report),
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
    # Unconditional, unlike the grader audit above: a revise turn can write or weaken an
    # answer key as easily as a grader, and re-reading one is cheaper than deciding
    # whether it moved.
    spec, answers = await _audit_answers(ports, spec, attempts)
    review: NotebookReview | None = None
    if budget.review and report.ok:
        try:
            review = await ports.review(spec, report)
        except Exception as exc:  # noqa: BLE001 - advisory
            attempts.append(Attempt("notebook.review", False, str(exc)))
    # A chat edit could delete the objective cell, or every checkpoint, or the last
    # `role=answer` cell in a quiz, and nothing anywhere noticed: this lane never called
    # `check_structure` at all. `apply_revision` honours `delete` and `replace` ops
    # faithfully, which is its job, so the only thing that can tell a reader their
    # notebook has stopped meeting its own contract is a check on the result.
    review = _with_structure_warnings(review, spec)
    status: Literal["ready", "failed"] = "ready" if is_usable(report) else "failed"
    return PipelineOutcome(
        status=status,
        spec=spec,
        report=report,
        review=review,
        graders=graders,
        answers=answers,
        reply=plan.reply,
        summary=plan.summary or "edited in chat",
        attempts=attempts,
        error="" if status == "ready" else describe_failure(report),
        cell_errors="" if report.ok or status == "failed" else describe_failure(report),
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


def describe_failure(report: ExecutionReport) -> str:
    first = report.first_error()
    if first is not None and first.error is not None:
        return f"cell {first.id} failed: {first.error.ename}: {first.error.evalue[:300]}"
    return report.note or "the notebook did not execute cleanly"
