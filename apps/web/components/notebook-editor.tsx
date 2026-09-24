"use client";

import type { components } from "@majorana/contracts-gen";
import { CELL_ROLE_VALUES } from "@majorana/contracts-gen/enums";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { NotebookCellToolbar } from "./notebook-cell-toolbar";
import { NotebookIdeBar } from "./notebook-ide-bar";
import type { EditorDiagnostic } from "./notebook-code-editor";
import { NotebookCodeEditor } from "./notebook-code-editor";
import {
  duplicateCell,
  nextCellId,
  raisesException,
  undoStructuralChange,
  type CellEdit,
  type StructuralChange,
} from "../lib/notebook-editing";
import { cellDomId, cellRunChip } from "../lib/notebook-ide";
import { lintMessage, lintNotebook, type LintFinding } from "../lib/notebook-lint";
import type { NotebookCellView } from "../lib/notebook-view";
import {
  commandModeKey,
  COMMAND_MODE_IDLE,
  type CommandModeState,
} from "../lib/notebook-shortcuts";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

type Cell = components["schemas"]["Cell"];
type CellRole = components["schemas"]["CellRole"];
type NotebookCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"];

/** How long to wait after the last keystroke before re-linting the whole draft. Linting
 * is pure and cheap (`lib/notebook-lint.ts` has no I/O), but a notebook with many code
 * cells re-lints every cell after it on every cell's own edit (each rule reads the names
 * bound by every earlier cell), so debouncing keeps a fast typist from re-running that
 * whole pass on every keystroke. */
const LINT_DEBOUNCE_MS = 250;

function lintFindingsToDiagnostics(findings: readonly LintFinding[], copy: NotebookCopy["ide"]["lint"]): EditorDiagnostic[] {
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

/**
 * The editing half of the notebook surface: the same cards the reader reads, with their
 * sources open in a real code editor (`components/notebook-code-editor.tsx`) instead of
 * plain text.
 *
 * Still no new npm dependency: `apps/web/AGENTS.md` allows none, and `notebook-code-
 * editor.tsx`'s own doc comment says why CodeMirror/Monaco are out (production CSP blocks
 * the `<style>` tags both inject). What changed from the plain-textarea version this
 * replaced is the *underlay* — highlighting, a line-number gutter, lint underlines — not
 * the control the reader types into, which is still a real `<textarea>` for the same
 * reasons the plain version had one: it works with a screen reader, a phone keyboard, and
 * the browser's own undo stack.
 *
 * This component still owns no DRAFT state. Every keystroke and every structural edit goes
 * up as a call to one of the `on*` props and comes back down as `cells` — the draft has
 * exactly one home (`notebook-workspace.tsx`), and the spec that gets POSTed is the same
 * array the reader is looking at. The one thing tracked locally is the undo stack for
 * *structural* changes (insert/delete/move/convert): each of those already round-trips
 * through a callback that mutates the parent's `cells`, so recording "what the last one
 * was" here, and replaying `undoStructuralChange` over the CURRENT `cells` when the reader
 * presses Z, needs nothing from the parent but the one new optional callback documented
 * below.
 */
export function NotebookEditor({
  cells,
  locale = "en",
  focusedCellId,
  busy = false,
  cellResults = [],
  onEdit,
  onInsert,
  onDelete,
  onMove,
  onFocusCell,
  onRunToHere,
  onRunAll,
  onDuplicate,
  onUndoStructural,
  onSave,
  onAskNala,
  onFixWithNala,
  onExplainError,
}: {
  cells: Cell[];
  locale?: PublicLocale;
  focusedCellId: string | null;
  busy?: boolean;
  /**
   * The last run's per-cell results, so the editor can show a status chip, a duration and
   * the error navigator without redoing that join itself. `notebook-workspace.tsx` already
   * computes this exact array (`notebookCellViews(...)`) for `NotebookView` — passing the
   * SAME array here is the whole wiring; nothing new to compute.
   */
  cellResults?: readonly NotebookCellView[];
  onEdit: (cellId: string, edit: CellEdit) => void;
  onInsert: (afterId: string | null, kind: Cell["kind"]) => void;
  onDelete: (cellId: string) => void;
  onMove: (cellId: string, direction: "up" | "down") => void;
  onFocusCell: (cellId: string) => void;
  onRunToHere: (cellId: string) => void;
  /** Notebook-level "Run all". Omit it and the IDE bar simply renders without that
   * button — a no-op-safe default rather than a component that cannot render until the
   * workspace is ready to wire it. */
  onRunAll?: () => void;
  onDuplicate?: (cellId: string) => void;
  /** Command mode's Z. Fired with the exact `StructuralChange` this component recorded
   * when it last called `onInsert`/`onDelete`/`onMove`/`onEdit({kind})`/`onDuplicate` —
   * the workspace applies it with `undoStructuralChange(draftCells, change)` and sets
   * that as the new draft. */
  onUndoStructural?: (change: StructuralChange) => void;
  /** Cmd/Ctrl+S from anywhere in the editor (a cell's code or command mode alike). */
  onSave?: () => void;
  onAskNala?: (cellId: string) => void;
  onFixWithNala?: (cellId: string) => void;
  onExplainError?: (cellId: string) => void;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks;
  const resultById = useMemo(() => {
    const map = new Map<string, NotebookCellView>();
    for (const result of cellResults) map.set(result.id, result);
    return map;
  }, [cellResults]);
  const cellStatuses = useMemo(() => {
    const map = new Map<string, string>();
    for (const result of cellResults) map.set(result.id, result.status);
    return map;
  }, [cellResults]);

  // Debounced so a fast typist re-lints once after they pause, not once per keystroke —
  // see LINT_DEBOUNCE_MS above.
  const [diagnosticsByCell, setDiagnosticsByCell] = useState<Record<string, LintFinding[]>>({});
  useEffect(() => {
    const timer = setTimeout(() => setDiagnosticsByCell(lintNotebook(cells)), LINT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [cells]);

  // The last structural change, for command mode's Z. A ref, not state: recording it is
  // never itself something the reader should see re-render for.
  const lastChange = useRef<StructuralChange | null>(null);
  const textareas = useRef(new Map<string, HTMLTextAreaElement>());

  function recordAndInsert(afterId: string | null, kind: Cell["kind"]) {
    lastChange.current = { kind: "inserted", id: nextCellId(cells), source: "" };
    onInsert(afterId, kind);
  }
  function recordAndDelete(cellId: string) {
    const index = cells.findIndex((cell) => cell.id === cellId);
    const cell = cells[index];
    if (cell) lastChange.current = { kind: "deleted", cell, index };
    onDelete(cellId);
  }
  function recordAndMove(cellId: string, direction: "up" | "down") {
    lastChange.current = { kind: "moved", id: cellId, direction };
    onMove(cellId, direction);
  }
  function recordAndConvert(cellId: string, to: Cell["kind"]) {
    const cell = cells.find((c) => c.id === cellId);
    if (cell) lastChange.current = { kind: "converted", before: cell };
    onEdit(cellId, { kind: to });
  }
  function recordAndDuplicate(cellId: string) {
    const cell = cells.find((c) => c.id === cellId);
    if (cell) lastChange.current = { kind: "inserted", id: nextCellId(cells), source: cell.source };
    onDuplicate?.(cellId);
  }
  function undoLast() {
    const change = lastChange.current;
    if (!change || !onUndoStructural) return;
    onUndoStructural(change);
    lastChange.current = null;
  }
  function focusCard(cellId: string) {
    onFocusCell(cellId);
    const node = document.getElementById(cellDomId(cellId));
    if (node instanceof HTMLElement) node.focus();
  }
  function editCard(cellId: string) {
    textareas.current.get(cellId)?.focus();
  }

  if (cells.length === 0) {
    return (
      <div className="mj-notebook-edit">
        <p className="mj-notebook-edit-empty">{copy.editEmpty}</p>
        <div className="mj-notebook-edit-add">
          <button type="button" onClick={() => onInsert(null, "markdown")} disabled={busy}>
            {copy.editAddMarkdown}
          </button>
          <button type="button" onClick={() => onInsert(null, "code")} disabled={busy}>
            {copy.editAddCode}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mj-notebook-edit">
      <p className="mj-notebook-edit-hint">{copy.editHint}</p>
      <p className="sr-only">{copy.ide.commandKeys}</p>
      <NotebookIdeBar cells={cells} cellStatuses={cellStatuses} copy={copy.ide} busy={busy} onRunAll={onRunAll} />
      {cells.map((cell, index) => (
        <EditableCellCard
          key={cell.id}
          cell={cell}
          copy={copy}
          busy={busy}
          focused={focusedCellId === cell.id}
          canMoveUp={index > 0}
          canMoveDown={index < cells.length - 1}
          previousCellId={index > 0 ? cells[index - 1].id : null}
          result={resultById.get(cell.id)}
          diagnostics={
            cell.kind === "code" ? lintFindingsToDiagnostics(diagnosticsByCell[cell.id] ?? [], copy.ide.lint) : []
          }
          onEdit={onEdit}
          onInsert={recordAndInsert}
          onDelete={recordAndDelete}
          onMove={recordAndMove}
          onConvert={recordAndConvert}
          onDuplicate={onDuplicate ? recordAndDuplicate : undefined}
          onFocusCell={onFocusCell}
          onRunToHere={onRunToHere}
          onAskNala={onAskNala}
          onFixWithNala={onFixWithNala}
          onExplainError={onExplainError}
          onSave={onSave}
          onFocusCard={focusCard}
          onEditCard={editCard}
          onUndo={onUndoStructural ? undoLast : undefined}
          registerTextarea={(node) => {
            if (node) textareas.current.set(cell.id, node);
            else textareas.current.delete(cell.id);
          }}
        />
      ))}
    </div>
  );
}

function EditableCellCard({
  cell,
  copy,
  busy,
  focused,
  canMoveUp,
  canMoveDown,
  previousCellId,
  result,
  diagnostics,
  onEdit,
  onInsert,
  onDelete,
  onMove,
  onConvert,
  onDuplicate,
  onFocusCell,
  onRunToHere,
  onAskNala,
  onFixWithNala,
  onExplainError,
  onSave,
  onFocusCard,
  onEditCard,
  onUndo,
  registerTextarea,
}: {
  cell: Cell;
  copy: NotebookCopy;
  busy: boolean;
  focused: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  previousCellId: string | null;
  result: NotebookCellView | undefined;
  diagnostics: EditorDiagnostic[];
  onEdit: (cellId: string, edit: CellEdit) => void;
  onInsert: (afterId: string | null, kind: Cell["kind"]) => void;
  onDelete: (cellId: string) => void;
  onMove: (cellId: string, direction: "up" | "down") => void;
  onConvert: (cellId: string, to: Cell["kind"]) => void;
  onDuplicate?: (cellId: string) => void;
  onFocusCell: (cellId: string) => void;
  onRunToHere: (cellId: string) => void;
  onAskNala?: (cellId: string) => void;
  onFixWithNala?: (cellId: string) => void;
  onExplainError?: (cellId: string) => void;
  onSave?: () => void;
  onFocusCard: (cellId: string) => void;
  onEditCard: (cellId: string) => void;
  onUndo?: () => void;
  registerTextarea: (node: HTMLTextAreaElement | null) => void;
}) {
  const [commandState, setCommandState] = useState<CommandModeState>(COMMAND_MODE_IDLE);
  const raised = result?.status === "error";
  const edited = result != null && result.source !== cell.source;
  const chip =
    cell.kind === "code"
      ? cellRunChip({
          kind: "code",
          execute: cell.execute,
          status: result?.status ?? "not_run",
          edited,
        })
      : null;

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    // Only when the keystroke landed on the card itself, not on a button, select or the
    // textarea inside it — those are real fields and single keys inside them are letters,
    // not commands. See `commandModeKey`'s own doc comment for the full rule.
    const onCell = event.target === event.currentTarget;
    const { state, command } = commandModeKey(
      commandState,
      {
        key: event.key,
        shiftKey: event.shiftKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        repeat: event.repeat,
        isComposing: event.nativeEvent.isComposing,
      },
      { onCell },
    );
    setCommandState(state);
    if (!command) return;
    event.preventDefault();
    switch (command.kind) {
      case "edit":
        onEditCard(cell.id);
        return;
      case "insert":
        onInsert(command.where === "below" ? cell.id : previousCellId, cell.kind);
        return;
      case "delete":
        onDelete(cell.id);
        return;
      case "convert":
        onConvert(cell.id, command.to);
        return;
      case "select":
        onFocusCard(command.delta === 1 ? nextSiblingId() : previousCellId ?? cell.id);
        return;
      case "run":
        onRunToHere(cell.id);
        return;
      case "run-and-advance":
        onRunToHere(cell.id);
        onFocusCard(nextSiblingId());
        return;
      case "undo":
        onUndo?.();
        return;
      case "save":
        onSave?.();
        return;
    }
  }

  // The next cell's id, read off the DOM rather than threaded down as a prop: J/K only
  // needs SOME adjacent cell to move to, and every card already carries its id in
  // `cellDomId` for the IDE bar's jumps, so reusing it here avoids passing the whole
  // notebook's id order to every single card just for one keystroke.
  function nextSiblingId(): string {
    const node = document.getElementById(cellDomId(cell.id));
    const next = node?.nextElementSibling;
    return next?.id === undefined ? cell.id : next.id.replace(/^mj-notebook-cell-/, "");
  }

  return (
    <article
      id={cellDomId(cell.id)}
      className="mj-notebook-edit-cell"
      data-kind={cell.kind}
      data-focused={focused}
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
    >
      <div className="mj-notebook-edit-cell-head">
        <span className="mj-notebook-edit-cell-id">{cell.id}</span>
        <label className="mj-notebook-edit-field">
          <span className="sr-only">{copy.editKindLabel}</span>
          <select
            value={cell.kind}
            disabled={busy}
            aria-label={copy.editKindLabel}
            onChange={(event) => onEdit(cell.id, { kind: event.target.value as Cell["kind"] })}
          >
            <option value="markdown">{copy.editKindOption.markdown}</option>
            <option value="code">{copy.editKindOption.code}</option>
          </select>
        </label>
        <label className="mj-notebook-edit-field">
          <span className="sr-only">{copy.editRoleLabel}</span>
          <select
            value={cell.role ?? ""}
            disabled={busy}
            aria-label={copy.editRoleLabel}
            onChange={(event) =>
              onEdit(cell.id, { role: (event.target.value || null) as CellRole | null })
            }
          >
            <option value="">{copy.editRoleNone}</option>
            {CELL_ROLE_VALUES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        {cell.kind === "code" ? (
          <>
            <label className="mj-notebook-edit-toggle">
              <input
                type="checkbox"
                checked={cell.execute}
                disabled={busy}
                onChange={(event) => onEdit(cell.id, { execute: event.target.checked })}
              />
              {copy.editExecuteLabel}
            </label>
            <label className="mj-notebook-edit-toggle">
              <input
                type="checkbox"
                checked={raisesException(cell)}
                disabled={busy}
                onChange={(event) => onEdit(cell.id, { raisesException: event.target.checked })}
              />
              {copy.editRaisesLabel}
            </label>
          </>
        ) : null}
      </div>

      <NotebookCodeEditor
        value={cell.source}
        onChange={(source) => onEdit(cell.id, { source })}
        label={copy.editCellSourceLabel(cell.id)}
        problemsLabel={copy.ide.problemsLabel(cell.id)}
        copy={copy.ide}
        language={cell.kind === "code" ? "python" : "markdown"}
        python={cell.kind === "code"}
        disabled={busy}
        diagnostics={diagnostics}
        onFocus={() => onFocusCell(cell.id)}
        onRun={() => onRunToHere(cell.id)}
        onRunAndAdvance={() => {
          onRunToHere(cell.id);
          onFocusCard(nextSiblingId());
        }}
        onEscape={() => onFocusCard(cell.id)}
        onSave={onSave}
        inputRef={registerTextarea}
      />

      <NotebookCellToolbar
        cellId={cell.id}
        kind={cell.kind}
        copy={copy}
        ideCopy={copy.ide}
        busy={busy}
        raised={raised}
        chip={chip}
        durationMs={result?.durationMs ?? null}
        focused={focused}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onInsert={(kind) => onInsert(cell.id, kind)}
        onMove={(direction) => onMove(cell.id, direction)}
        onDelete={() => onDelete(cell.id)}
        onDuplicate={onDuplicate ? () => onDuplicate(cell.id) : undefined}
        onConvert={(to) => onConvert(cell.id, to)}
        onRunToHere={() => onRunToHere(cell.id)}
        onAskNala={onAskNala ? () => onAskNala(cell.id) : undefined}
        onFixWithNala={onFixWithNala ? () => onFixWithNala(cell.id) : undefined}
        onExplainError={onExplainError ? () => onExplainError(cell.id) : undefined}
      />
    </article>
  );
}
