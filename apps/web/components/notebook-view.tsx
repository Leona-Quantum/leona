"use client";

import type { components } from "@majorana/contracts-gen";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { ChatMarkdown } from "./chat-markdown";
import { NotebookCellToolbar } from "./notebook-cell-toolbar";
import { NotebookIdeBar } from "./notebook-ide-bar";
import { NotebookCodeEditor, NotebookCodeView, type EditorDiagnostic } from "./notebook-code-editor";
import { NotebookCheckCard } from "./notebook-check-card";
import { NotebookAddCheckForm } from "./notebook-add-check-form";
import { cellDomId } from "../lib/notebook-ide";
import { lintMessage, lintNotebook, type LintFinding } from "../lib/notebook-lint";
import { NotebookHardwareRequests, type NotebookHardwareContext } from "./notebook-hardware-card";
import { checkSummaryCounts, type CheckProperty } from "../lib/notebook-checks";
import type { NotebookCellStatus, NotebookCellView } from "../lib/notebook-view";
import type { PublicLocale } from "../lib/public-locale";
import { NOTEBOOK_CHECK_COPY, WORKSPACE_COPY } from "../lib/workspace-locale";

type Cell = components["schemas"]["Cell"];

/** "Add a check" (ai-ops 382): which code cell the form is open below, and the
 * subject name it opened with. See `NotebookCellEditState` above for why this is a
 * separate piece of state rather than folded into it. */
export interface NotebookCheckFormState {
  afterId: string;
  subjectHint: string;
}

/**
 * Per-cell editing, live in the read view (ai-ops 375, "each cell can be edited and
 * deleted and added manually and independently as well as by Nala"). The state itself
 * — which cell, its draft source, whether it is a brand-new cell not yet saved — lives
 * in `notebook-workspace.tsx`, the one place a POST is ever made, exactly the way the
 * page-level editor's `draftCells` does. This component only renders it and forwards
 * every keystroke and button press back up.
 */
export interface NotebookCellEditState {
  /** The cell being edited. For a new cell this is the id it will get on save
   * (computed once, with `nextCellId`, when "Add" was pressed) — not yet a real cell. */
  cellId: string;
  kind: Cell["kind"];
  source: string;
  /** A cell inserted by "Add below" and not yet saved — never true for editing an
   * existing cell in place. */
  isNew: boolean;
  /** For a new cell: the cell it goes after. Unused when `isNew` is false. */
  insertAfterId: string | null;
}

function lintFindingsToDiagnostics(
  findings: readonly LintFinding[],
  copy: (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"]["ide"]["lint"],
): EditorDiagnostic[] {
  return findings.map((finding) => ({
    line: finding.line,
    col: finding.col,
    endLine: finding.endLine,
    endCol: finding.endCol,
    severity: finding.severity,
    code: finding.code,
    message: lintMessage(finding, copy),
  }));
}

export type NotebookCellActionKind =
  | "explain"
  | "simplify"
  | "figure"
  | "exercise"
  // Learner actions (Lane E): "explainError" needs no reader input and fires
  // immediately; "checkAttempt" opens the inline textarea below before it
  // fires — see `onCellAction`'s `detail` parameter.
  | "explainError"
  | "checkAttempt"
  // A `role=question` cell. Distinct from "checkAttempt" because the two go to
  // DIFFERENT halves of the same request: a code attempt is `code[cellId]`, an
  // answer is `answers[cellId]`, and the server grades them by different routes.
  // One action kind carrying both would have to guess from the cell's role, which
  // is the guess `graded` already exists to avoid making twice.
  | "answerQuestion";

/** One cell's verdict, straight off the generated contract rather than restated
 * here: the browser renders a verdict, it never decides one, so the only thing it
 * needs is the server's own shape. */
export type NotebookCellGrade = components["schemas"]["CellGrade"];

/** The redacted half of a question's answer key — see `answerPromptOf`. */
type AnswerPrompt = components["schemas"]["AnswerPrompt"];

/** Roles the "Check my attempt" action shows on — exactly the roles a reader
 * writes their own code against: a stand-alone exercise, a challenge's own
 * solution cell (grading an alternate attempt), and a checkpoint (the
 * assertion that says whether earlier work was right). */
const CHECKABLE_ROLES = new Set(["exercise", "solution", "checkpoint"]);

type NotebookCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"];

/**
 * Renders one notebook version's cells, in spec order — the reader's lesson,
 * joined with whatever the sandbox produced for it (`notebookCellViews`,
 * `lib/notebook-view.ts`). Never renders `text/html` output as HTML: model
 * output crosses this boundary as data, and the classification in
 * `lib/notebook-view.ts` already made sure no "html" kind exists here to
 * reach for React's raw-HTML injection prop on.
 */
export function NotebookView({
  cells,
  locale = "en",
  framework = "qiskit",
  onCellAction,
  grades,
  gradingCellIds,
  busy = false,
  onRunAll,
  onAskNala,
  onFixWithNala,
  hardware,
  cellEdit,
  onStartEditCell,
  onStartInsertCell,
  onChangeCellEditSource,
  onSaveCellEdit,
  onCancelCellEdit,
  onMoveCell,
  onDeleteCell,
  onDuplicateCell,
  onAskNalaToChangeCell,
  onAcceptCheck,
  checkForm,
  onStartAddCheck,
  onCancelAddCheck,
  onSubmitAddCheck,
}: {
  cells: NotebookCellView[];
  locale?: PublicLocale;
  framework?: string;
  /** `detail` carries the reader's free-text attempt for `"checkAttempt"`;
   * every other action kind calls this with `detail` omitted. */
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
  /** Verdicts by cell id, from the last graded attempt. */
  grades?: Record<string, NotebookCellGrade>;
  /** Cells whose attempt is in the sandbox right now. */
  gradingCellIds?: ReadonlySet<string>;
  busy?: boolean;
  /** The IDE bar's "Run all". Omit it and the bar still renders the error navigator
   * and the outline, just without that button — a no-op-safe default for the
   * workspace to wire once it decides what "run all" from the read view should do. */
  onRunAll?: () => void;
  onAskNala?: (cellId: string) => void;
  onFixWithNala?: (cellId: string) => void;
  /** Which notebook version this is, so a `leona_submit` cell gets its "Run on hardware" card. Omit it and no card renders (the read-only share page). */
  hardware?: Omit<NotebookHardwareContext, "locale">;
  /**
   * Per-cell editing (ai-ops 375). The workspace passes `cellEdit` and every
   * `on*` handler below only when editing is allowed at all (the same conditions
   * the page-level Edit button uses — `canEdit` there) — omit them, as the
   * read-only share page does, and no per-cell edit/add/move/delete/duplicate
   * button renders anywhere in this view, the same "only what a caller wires"
   * rule `onAskNala`/`onFixWithNala` already follow above.
   */
  cellEdit?: NotebookCellEditState | null;
  /** Turns an existing cell into its inline editor (or asks first, if another
   * cell's edit is unsaved — that confirm lives in the workspace, not here). */
  onStartEditCell?: (cellId: string) => void;
  /** Inserts an empty cell after `afterId` and opens it for editing. */
  onStartInsertCell?: (afterId: string, kind: Cell["kind"]) => void;
  onChangeCellEditSource?: (source: string) => void;
  onSaveCellEdit?: (options: { execute: boolean; runUntil?: string | null }) => void;
  onCancelCellEdit?: () => void;
  onMoveCell?: (cellId: string, direction: "up" | "down") => void;
  onDeleteCell?: (cellId: string) => void;
  onDuplicateCell?: (cellId: string) => void;
  /** "Ask Nala to change this cell": starts a chat message about it. */
  onAskNalaToChangeCell?: (cellId: string) => void;
  /** Accept a check (ai-ops 382): `property.accepted = true`, offered only where the
   * rest of per-cell editing is (omit it, as the read-only share page does, and no
   * check anywhere in the notebook shows an Accept button). */
  onAcceptCheck?: (cellId: string) => void;
  /** "Add a check": which code cell the form is open below, mirroring `cellEdit`
   * above. `null`/omitted renders no form. */
  checkForm?: NotebookCheckFormState | null;
  onStartAddCheck?: (afterId: string) => void;
  onCancelAddCheck?: () => void;
  onSubmitAddCheck?: (property: CheckProperty) => void;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const checkCopy = NOTEBOOK_CHECK_COPY[locale];
  const checkCounts = useMemo(() => checkSummaryCounts(cells), [cells]);
  // Lint runs once per render of the version on screen (no debounce: unlike the editor,
  // this surface's source never changes without a whole new `cells` array arriving), so
  // a reader sees the same "certain-to-fail Qiskit mistake" flags Nala's own draft would
  // have shown while writing this notebook, even before touching Edit.
  const findings = useMemo(() => lintNotebook(cells), [cells]);
  const cellStatuses = useMemo(() => {
    const map = new Map<string, string>();
    for (const cell of cells) map.set(cell.id, cell.status);
    return map;
  }, [cells]);
  if (!cells.length) return null;
  const editingExistingId = cellEdit && !cellEdit.isNew ? cellEdit.cellId : null;
  const pendingInsertAfterId = cellEdit && cellEdit.isNew ? cellEdit.insertAfterId : null;
  return (
    <div className="mj-notebook-view">
      <NotebookIdeBar cells={cells} cellStatuses={cellStatuses} copy={copy.ide} busy={busy} onRunAll={onRunAll} />
      {checkCounts ? (
        <p className="mj-notebook-check-summary" aria-label={checkCopy.summaryLabel}>
          {checkCopy.summary(checkCounts)}
        </p>
      ) : null}
      {cells.map((cell, index) => (
        <Fragment key={cell.id}>
          {editingExistingId === cell.id && cellEdit ? (
            <NotebookCellEditCard
              cellEdit={cellEdit}
              copy={copy}
              busy={busy}
              onChangeSource={onChangeCellEditSource}
              onSave={onSaveCellEdit}
              onCancel={onCancelCellEdit}
            />
          ) : (
        <NotebookCellCard
          cell={cell}
          copy={copy}
          checkCopy={checkCopy}
          framework={framework}
          busy={busy}
          diagnostics={cell.kind === "code" ? lintFindingsToDiagnostics(findings[cell.id] ?? [], copy.ide.lint) : []}
          onCellAction={onCellAction}
          onAskNala={onAskNala}
          onFixWithNala={onFixWithNala}
          onStartEditCell={onStartEditCell}
          onStartInsertCell={onStartInsertCell}
          onMoveCell={onMoveCell}
          onDeleteCell={onDeleteCell}
          onDuplicateCell={onDuplicateCell}
          onAskNalaToChangeCell={onAskNalaToChangeCell}
          canMoveUp={index > 0}
          canMoveDown={index < cells.length - 1}
          grade={grades?.[cell.id]}
          grading={gradingCellIds?.has(cell.id) ?? false}
          // Any attempt in flight locks EVERY graded cell's submit, not just its own.
          // The workspace follows one run at a time, so starting a second attempt
          // replaces the followed run and aborts the first one's stream — the first
          // cell would sit on "Running your code…" and its finished verdict would
          // never arrive. Greptile caught it on PR 832. One at a time is also the
          // honest reading of a single sandbox dispatch per attempt.
          locked={busy || (gradingCellIds?.size ?? 0) > 0}
          hardware={hardware ? { ...hardware, locale } : undefined}
          onAcceptCheck={onAcceptCheck}
          onStartAddCheck={onStartAddCheck}
        />
          )}
          {pendingInsertAfterId === cell.id && cellEdit ? (
            <NotebookCellEditCard
              cellEdit={cellEdit}
              copy={copy}
              busy={busy}
              onChangeSource={onChangeCellEditSource}
              onSave={onSaveCellEdit}
              onCancel={onCancelCellEdit}
            />
          ) : null}
          {checkForm?.afterId === cell.id ? (
            <NotebookAddCheckForm
              afterId={checkForm.afterId}
              subjectHint={checkForm.subjectHint}
              copy={checkCopy}
              busy={busy}
              onCancel={() => onCancelAddCheck?.()}
              onSubmit={(property) => onSubmitAddCheck?.(property)}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}

/**
 * One cell's inline editor, in the read view (ai-ops 375): the same `NotebookCodeEditor`
 * the page-level editor uses, for an existing cell's source or a brand-new one not yet
 * saved. Markdown cells get it too (`python={false}`, as `NotebookCodeEditor` already
 * supports) — only the source changes here, never kind/role/execute, which stay the
 * page-level editor's job.
 *
 * Every save goes through the SAME `POST .../versions` path the page-level editor's
 * "Save & run" does (`saveDraft` in `notebook-workspace.tsx`), just for one cell's worth
 * of change — so every per-cell edit is a new version, undoable from the version picker
 * exactly like a bulk edit is.
 */
function NotebookCellEditCard({
  cellEdit,
  copy,
  busy,
  onChangeSource,
  onSave,
  onCancel,
}: {
  cellEdit: NotebookCellEditState;
  copy: NotebookCopy;
  busy: boolean;
  onChangeSource?: (source: string) => void;
  onSave?: (options: { execute: boolean; runUntil?: string | null }) => void;
  onCancel?: () => void;
}) {
  const isCode = cellEdit.kind === "code";
  // Focused once, when this card first mounts — not on every keystroke's re-render,
  // which is why this is a stable ref via useEffect rather than an inline callback ref
  // (a fresh arrow function every render would make React re-run it every render too).
  const textarea = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    textarea.current?.focus();
  }, []);
  return (
    <article
      id={cellDomId(cellEdit.cellId)}
      className="mj-notebook-cell"
      data-kind={cellEdit.kind}
      data-editing="true"
      tabIndex={0}
    >
      <div className="mj-notebook-cell-head">
        <span className="mj-notebook-edit-cell-id">{cellEdit.cellId}</span>
      </div>
      <NotebookCodeEditor
        value={cellEdit.source}
        onChange={(source) => onChangeSource?.(source)}
        label={copy.editCellSourceLabel(cellEdit.cellId)}
        problemsLabel={copy.ide.problemsLabel(cellEdit.cellId)}
        copy={copy.ide}
        language={isCode ? "python" : "markdown"}
        python={isCode}
        disabled={busy}
        onEscape={() => onCancel?.()}
        onSave={() => onSave?.({ execute: false })}
        inputRef={(node) => {
          textarea.current = node;
        }}
      />
      <div className="mj-notebook-cell-edit-actions" role="group" aria-label={copy.ide.editCell}>
        {isCode ? (
          <button
            type="button"
            className="mj-primary-button"
            disabled={busy}
            onClick={() => onSave?.({ execute: true, runUntil: cellEdit.cellId })}
          >
            {busy ? copy.saving : copy.ide.saveCellAndRun}
          </button>
        ) : null}
        <button
          type="button"
          className={isCode ? "mj-secondary-button" : "mj-primary-button"}
          disabled={busy}
          onClick={() => onSave?.({ execute: false })}
        >
          {busy ? copy.saving : copy.ide.saveCell}
        </button>
        <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => onCancel?.()}>
          {copy.ide.cancelCellEdit}
        </button>
      </div>
    </article>
  );
}

function NotebookCellCard({
  cell,
  copy,
  checkCopy,
  framework,
  diagnostics,
  onCellAction,
  onAskNala,
  onFixWithNala,
  onStartEditCell,
  onStartInsertCell,
  onMoveCell,
  onDeleteCell,
  onDuplicateCell,
  onAskNalaToChangeCell,
  canMoveUp,
  canMoveDown,
  grade,
  grading,
  locked,
  busy,
  hardware,
  onAcceptCheck,
  onStartAddCheck,
}: {
  cell: NotebookCellView;
  copy: NotebookCopy;
  checkCopy: (typeof NOTEBOOK_CHECK_COPY)[PublicLocale];
  framework: string;
  diagnostics?: EditorDiagnostic[];
  onCellAction?: (cellId: string, action: NotebookCellActionKind, detail?: string) => void;
  onAskNala?: (cellId: string) => void;
  onFixWithNala?: (cellId: string) => void;
  onStartEditCell?: (cellId: string) => void;
  onStartInsertCell?: (afterId: string, kind: Cell["kind"]) => void;
  onMoveCell?: (cellId: string, direction: "up" | "down") => void;
  onDeleteCell?: (cellId: string) => void;
  onDuplicateCell?: (cellId: string) => void;
  onAskNalaToChangeCell?: (cellId: string) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  grade?: NotebookCellGrade;
  grading?: boolean;
  locked?: boolean;
  busy?: boolean;
  hardware?: NotebookHardwareContext;
  onAcceptCheck?: (cellId: string) => void;
  onStartAddCheck?: (afterId: string) => void;
}) {
  const [attemptOpen, setAttemptOpen] = useState(false);
  const [attemptText, setAttemptText] = useState("");
  const showExplainError = cell.error !== null;
  const showCheckAttempt = cell.role !== null && CHECKABLE_ROLES.has(cell.role);
  const isCheckCell = cell.role === "check" && cell.checkProperty !== null;

  function submitAttempt() {
    if (!onCellAction || !attemptText.trim() || locked) return;
    onCellAction(cell.id, "checkAttempt", attemptText);
    setAttemptOpen(false);
  }

  return (
    <article
      id={cellDomId(cell.id)}
      className="mj-notebook-cell"
      data-kind={cell.kind}
      data-status={cell.status}
      tabIndex={0}
    >
      <div className="mj-notebook-cell-head">
        {cell.role ? <span className="mj-notebook-cell-role">{cell.role}</span> : null}
        <span className="mj-notebook-cell-pill" data-status={cell.status}>{copy.cellStatus[cell.status]}</span>
        {onCellAction ? (
          <div className="mj-notebook-cell-actions mj-library-row-actions">
            <button type="button" disabled={busy} onClick={() => onCellAction(cell.id, "explain")}>{copy.actionExplain}</button>
            <button type="button" disabled={busy} onClick={() => onCellAction(cell.id, "simplify")}>{copy.actionSimplify}</button>
            <button type="button" disabled={busy} onClick={() => onCellAction(cell.id, "figure")}>{copy.actionAddFigure}</button>
            <button type="button" disabled={busy} onClick={() => onCellAction(cell.id, "exercise")}>{copy.actionExercise}</button>
            {showExplainError ? (
              <button type="button" disabled={busy} onClick={() => onCellAction(cell.id, "explainError")}>
                {copy.actionExplainError}
              </button>
            ) : null}
            {showCheckAttempt ? (
              <button type="button" aria-pressed={attemptOpen} onClick={() => setAttemptOpen((open) => !open)}>
                {copy.actionCheckAttempt}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      {isCheckCell ? (
        <NotebookCheckCard cell={cell} copy={checkCopy} canAccept={Boolean(onAcceptCheck)} busy={busy} onAccept={onAcceptCheck} />
      ) : cell.kind === "markdown" ? (
        // Reuses the chat thread's own typography (headings, code, lists,
        // links) rather than restating it: `.mj-chat-message` is styled once,
        // in styles.css, and every renderer of model/author markdown —
        // Nala's replies and a notebook's markdown cells alike — wraps in it.
        <div className="mj-chat-message mj-chat-message--assistant">
          <ChatMarkdown source={cell.source} />
        </div>
      ) : (
        <NotebookCodeView
          value={cell.source}
          language={framework}
          diagnostics={diagnostics ?? []}
          problemsLabel={copy.ide.problemsLabel(cell.id)}
          copy={copy.ide}
        />
      )}
      {onAskNala || onFixWithNala || onStartEditCell || onStartInsertCell || onMoveCell || onDeleteCell || onDuplicateCell || onAskNalaToChangeCell ? (
        <NotebookCellToolbar
          cellId={cell.id}
          kind={cell.kind}
          copy={copy}
          ideCopy={copy.ide}
          busy={busy}
          raised={cell.error !== null}
          durationMs={cell.kind === "code" ? cell.durationMs : null}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          collapseStructural
          onAskNala={onAskNala ? () => onAskNala(cell.id) : undefined}
          onFixWithNala={onFixWithNala ? () => onFixWithNala(cell.id) : undefined}
          onEditCell={onStartEditCell ? () => onStartEditCell(cell.id) : undefined}
          onInsert={onStartInsertCell ? (kind) => onStartInsertCell(cell.id, kind) : undefined}
          onMove={onMoveCell ? (direction) => onMoveCell(cell.id, direction) : undefined}
          onDelete={onDeleteCell ? () => onDeleteCell(cell.id) : undefined}
          onDuplicate={onDuplicateCell ? () => onDuplicateCell(cell.id) : undefined}
          onAskNalaToChange={onAskNalaToChangeCell ? () => onAskNalaToChangeCell(cell.id) : undefined}
        />
      ) : null}
      {cell.kind === "code" && !isCheckCell && onStartAddCheck ? (
        <div className="mj-notebook-cell-add-check">
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={() => onStartAddCheck(cell.id)}>
            {checkCopy.addCheck}
          </button>
        </div>
      ) : null}
      {cell.kind === "code" ? <NotebookCellOutputs cell={cell} copy={copy} /> : null}
      <NotebookHardwareRequests cell={cell} context={hardware} />
      {grading ? <p className="mj-notebook-cell-grade" data-status="grading">{copy.gradePending}</p> : null}
      {!grading && grade ? (
        <div className="mj-notebook-cell-grade" data-status={grade.status}>
          <p className="mj-notebook-cell-grade-verdict">{copy.gradeVerdict[grade.status]}</p>
          {grade.message ? <p>{grade.message}</p> : null}
          {/* The failed assertion, verbatim. "Your code did not satisfy
              `assert len(counts) == 2`" ends an argument that "the model thought
              your answer was incomplete" starts, which is the whole reason this
              path exists instead of asking Nala. */}
          {grade.detail ? <pre className="mj-code-body">{grade.detail}</pre> : null}
          {grade.hint ? <p className="mj-notebook-cell-grade-hint">{grade.hint}</p> : null}
          <p className="mj-notebook-cell-grade-by">
            {grade.graded_by === "deterministic" ? copy.gradeByCheck : copy.gradeByModel}
          </p>
        </div>
      ) : null}
      {/* Below the verdict, not above it: after a wrong answer the reader wants to see
          why before trying again, and an input rendered first pushes the explanation
          off the bottom of a long cell. */}
      {cell.answerPrompt && onCellAction ? (
        <NotebookAnswerInput
          cellId={cell.id}
          prompt={cell.answerPrompt}
          copy={copy}
          locked={locked || grading}
          onSubmit={(response) => onCellAction(cell.id, "answerQuestion", response)}
        />
      ) : null}
      {showCheckAttempt && attemptOpen ? (
        <div className="mj-notebook-cell-attempt">
          <label>
            <span className="sr-only">{copy.actionCheckAttempt}</span>
            <textarea
              value={attemptText}
              onChange={(event) => setAttemptText(event.target.value)}
              placeholder={copy.checkAttemptPlaceholder}
              rows={4}
              autoFocus
            />
          </label>
          <div className="mj-notebook-cell-attempt-actions">
            <button
              type="button"
              className="mj-secondary-button"
              onClick={() => {
                setAttemptOpen(false);
                setAttemptText("");
              }}
            >
              {copy.actionCheckAttemptCancel}
            </button>
            <button
              type="button"
              className="mj-primary-button"
              disabled={!attemptText.trim() || locked}
              onClick={submitAttempt}
            >
              {cell.graded ? copy.checkAttemptGrade : copy.checkAttemptSubmit}
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

/**
 * The input a `role=question` cell gets, and the only place a reader's answer is
 * composed. One component per kind because the shapes have nothing in common: a
 * choice submits an INDEX, a numeric submits a number as typed (the server owns the
 * tolerance), text and rubric submit prose.
 *
 * `prompt` is `NotebookCellView.answerPrompt`, which is the redacted half by
 * construction — see `answerPromptOf`. Nothing here receives the answer key, so
 * nothing here can render it, and that is the property to preserve if this file is
 * ever refactored to take the cell whole.
 */
function NotebookAnswerInput({
  cellId,
  prompt,
  copy,
  locked,
  onSubmit,
}: {
  cellId: string;
  prompt: AnswerPrompt;
  copy: NotebookCopy;
  locked?: boolean;
  onSubmit: (response: string) => void;
}) {
  const [value, setValue] = useState("");
  const answered = value.trim().length > 0;
  const name = `mj-answer-${cellId}`;

  function submit() {
    if (!answered || locked) return;
    onSubmit(value);
  }

  return (
    <div className="mj-notebook-cell-answer" data-kind={prompt.kind}>
      <fieldset>
        <legend>{copy.answerLegend}</legend>
        {prompt.kind === "choice" ? (
          <ul className="mj-notebook-answer-options">
            {(prompt.options ?? []).map((option, index) => (
              <li key={`${name}-${index}`}>
                <label>
                  <input
                    type="radio"
                    name={name}
                    // The INDEX, not the text. `deterministic_grade` compares
                    // `int(response)` against the key's `correct`, so sending the
                    // option's words would be graded as an unreadable option number
                    // and every reader would be told they were wrong.
                    value={String(index)}
                    checked={value === String(index)}
                    onChange={() => setValue(String(index))}
                  />
                  <span>{option}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : prompt.kind === "numeric" ? (
          <label className="mj-notebook-answer-numeric">
            <span className="sr-only">{copy.answerLegend}</span>
            <input
              type="number"
              inputMode="decimal"
              step="any"
              value={value}
              placeholder={copy.answerNumericPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
            {prompt.unit ? <span className="mj-notebook-answer-unit">{prompt.unit}</span> : null}
          </label>
        ) : prompt.kind === "text" ? (
          <label>
            <span className="sr-only">{copy.answerLegend}</span>
            <input
              type="text"
              value={value}
              placeholder={copy.answerTextPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        ) : (
          <label>
            <span className="sr-only">{copy.answerLegend}</span>
            <textarea
              value={value}
              rows={3}
              placeholder={copy.answerRubricPlaceholder}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
        )}
      </fieldset>
      {/* Said before the reader answers, not after the verdict arrives. Which kind of
          grader is behind a question changes how much weight its verdict deserves, and
          that is worth knowing while deciding how much care to spend on the answer. */}
      {prompt.kind === "rubric" ? (
        <p className="mj-notebook-answer-note">{copy.answerModelGraded}</p>
      ) : null}
      <div className="mj-notebook-cell-attempt-actions">
        <button type="button" className="mj-secondary-button" onClick={() => setValue("")}>
          {copy.answerClear}
        </button>
        <button
          type="button"
          className="mj-primary-button"
          disabled={!answered || locked}
          onClick={submit}
        >
          {copy.answerSubmit}
        </button>
      </div>
    </div>
  );
}

function NotebookCellOutputs({ cell, copy }: { cell: NotebookCellView; copy: NotebookCopy }) {
  const idle: NotebookCellStatus[] = ["not_run", "skipped"];
  if (idle.includes(cell.status) && !cell.stdout && !cell.stderr && cell.outputs.length === 0 && !cell.error) {
    return null;
  }
  return (
    <div className="mj-notebook-cell-outputs">
      {cell.stdout ? (
        <pre className="mj-notebook-cell-stdout">
          <span className="sr-only">{copy.cellStdout}</span>
          {cell.stdout}
        </pre>
      ) : null}
      {cell.stderr ? (
        <pre className="mj-notebook-cell-stderr">
          <span className="sr-only">{copy.cellStderr}</span>
          {cell.stderr}
        </pre>
      ) : null}
      {cell.outputs.map((output, index) =>
        output.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data: URI, not an optimizable remote asset
          <img key={index} className="mj-notebook-cell-figure" alt="figure" src={output.src} />
        ) : (
          <pre key={index} className="mj-notebook-cell-output-text">{output.text}</pre>
        ),
      )}
      {cell.error ? (
        <pre className="mj-notebook-cell-error" role="alert">
          <strong>{copy.cellErrorLabel}:</strong> {cell.error.ename}: {cell.error.evalue}
        </pre>
      ) : null}
      {cell.truncated ? <p className="mj-notebook-cell-truncated-note">{copy.cellTruncated}</p> : null}
    </div>
  );
}
