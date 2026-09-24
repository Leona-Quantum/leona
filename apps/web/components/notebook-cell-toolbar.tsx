"use client";

import type { CellRunChip } from "../lib/notebook-ide";
import type { NotebookIdeCopy } from "../lib/workspace-locale";
import "./notebook-ide.css";

type NotebookActionCopy = {
  editAddMarkdown: string;
  editAddCode: string;
  editDelete: string;
  editMoveUp: string;
  editMoveDown: string;
  runToHere: string;
  actionExplainError: string;
};

/**
 * One code or markdown cell's actions, in both the editor (every button below) and the
 * read-only view (only the buttons a caller wires: no structural editing there, since a
 * reader is not looking at a draft). A caller gets exactly the buttons it passes handlers
 * for — `notebook-editor.tsx` passes the whole set, `notebook-view.tsx` passes only
 * `onAskNala`/`onFixWithNala`/`onExplainError` — so this file has one shape rather than two
 * near-duplicates that drift.
 *
 * The structural button LABELS (`Add text below`, `Add code below`, `Move up`, `Move down`,
 * `Delete cell`, `Run to here`) are the exact strings `notebook-editor.tsx` already shipped
 * and `tests/forms/notebook-editor.test.tsx` pins by accessible name — this component reuses
 * them rather than inventing new copy, so that test needed no changes for this toolbar.
 *
 * "Markdown cells get the structural buttons only" (the IDE lane brief): the status chip,
 * duration, Ask Nala and the raised-cell actions are all gated on `kind === "code"` here,
 * once, so no call site has to remember the rule. `onEditCell` and `onAskNalaToChange` are
 * the exception — per-cell editing (ai-ops 375) offers both on a markdown cell too, since a
 * reader edits and asks Nala to change a text cell exactly as they would a code one.
 *
 * `collapseStructural` (the read view, `notebook-view.tsx`) puts the structural group
 * (add/move/duplicate/delete) behind one "More actions" disclosure instead of laying every
 * button out flat: the read view now offers Edit and Ask Nala to change on every cell, and a
 * flat toolbar with all of that plus the structural buttons reads as a wall of links. The
 * bulk editor (`notebook-editor.tsx`) does not set it, so its existing flat layout — and the
 * tests pinning it by accessible name — is unchanged.
 */
export function NotebookCellToolbar({
  cellId,
  kind,
  copy,
  ideCopy,
  busy = false,
  raised = false,
  chip,
  durationMs,
  canMoveUp,
  canMoveDown,
  focused = false,
  collapseStructural = false,
  onInsert,
  onMove,
  onDelete,
  onDuplicate,
  onConvert,
  onRunToHere,
  onAskNala,
  onFixWithNala,
  onExplainError,
  onEditCell,
  onAskNalaToChange,
}: {
  cellId: string;
  kind: "code" | "markdown";
  copy: NotebookActionCopy;
  ideCopy: NotebookIdeCopy;
  busy?: boolean;
  /** The cell's last run raised — gates "Fix with Nala" and "Explain this error". */
  raised?: boolean;
  chip?: CellRunChip | null;
  durationMs?: number | null;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** "Run to here" shows only on the focused cell, matching the plain-textarea editor
   * this replaces — a button on every cell would say "run" thirty times over one notebook. */
  focused?: boolean;
  /** Wrap the structural group (add/move/duplicate/delete/convert) behind a "More
   * actions" disclosure rather than laying it out flat. See the doc comment above. */
  collapseStructural?: boolean;
  onInsert?: (kind: "code" | "markdown") => void;
  onMove?: (direction: "up" | "down") => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onConvert?: (to: "markdown" | "code") => void;
  onRunToHere?: () => void;
  onAskNala?: () => void;
  onFixWithNala?: () => void;
  onExplainError?: () => void;
  /** Per-cell editing (ai-ops 375): turns this cell into its inline editor. Any kind. */
  onEditCell?: () => void;
  /** "as well as by Nala": starts a chat message about changing this cell. Any kind. */
  onAskNalaToChange?: () => void;
}) {
  const isCode = kind === "code";
  const structuralButtons = (
    <>
      {onInsert ? (
        <>
          <button type="button" disabled={busy} onClick={() => onInsert("markdown")}>
            {copy.editAddMarkdown}
          </button>
          <button type="button" disabled={busy} onClick={() => onInsert("code")}>
            {copy.editAddCode}
          </button>
        </>
      ) : null}
      {onMove ? (
        <>
          <button type="button" disabled={busy || canMoveUp === false} onClick={() => onMove("up")}>
            {copy.editMoveUp}
          </button>
          <button type="button" disabled={busy || canMoveDown === false} onClick={() => onMove("down")}>
            {copy.editMoveDown}
          </button>
        </>
      ) : null}
      {onDuplicate ? (
        <button type="button" disabled={busy} onClick={onDuplicate}>
          {ideCopy.duplicate}
        </button>
      ) : null}
      {onConvert ? (
        <button type="button" disabled={busy} onClick={() => onConvert(isCode ? "markdown" : "code")}>
          {isCode ? ideCopy.convertToText : ideCopy.convertToCode}
        </button>
      ) : null}
      {onDelete ? (
        <button type="button" disabled={busy} onClick={onDelete}>
          {copy.editDelete}
        </button>
      ) : null}
    </>
  );
  const hasStructural = Boolean(onInsert || onMove || onDuplicate || onConvert || onDelete);
  return (
    <div className="mj-notebook-ide-toolbar mj-library-row-actions" role="group" aria-label={ideCopy.toolbarLabel(cellId)}>
      {isCode && chip ? (
        <span className="mj-notebook-ide-chip" data-chip={chip}>
          {ideCopy.chip[chip]}
        </span>
      ) : null}
      {isCode && durationMs != null ? (
        <span className="mj-notebook-ide-duration" title={ideCopy.durationHint}>
          {ideCopy.duration(durationMs)}
        </span>
      ) : null}
      {isCode && onRunToHere && focused ? (
        <button type="button" className="mj-notebook-ide-run-to-here" disabled={busy} onClick={onRunToHere} title={ideCopy.runToHereHint}>
          {copy.runToHere}
        </button>
      ) : null}
      {onEditCell ? (
        <button type="button" disabled={busy} onClick={onEditCell}>
          {ideCopy.editCell}
        </button>
      ) : null}
      {!collapseStructural ? structuralButtons : null}
      {isCode && onAskNala ? (
        <button type="button" disabled={busy} onClick={onAskNala} title={ideCopy.askNalaHint}>
          {ideCopy.askNala}
        </button>
      ) : null}
      {onAskNalaToChange ? (
        <button type="button" disabled={busy} onClick={onAskNalaToChange} title={ideCopy.askNalaToChangeHint}>
          {ideCopy.askNalaToChange}
        </button>
      ) : null}
      {isCode && raised && onFixWithNala ? (
        <button type="button" disabled={busy} onClick={onFixWithNala} title={ideCopy.fixWithNalaHint}>
          {ideCopy.fixWithNala}
        </button>
      ) : null}
      {isCode && raised && onExplainError ? (
        <button type="button" disabled={busy} onClick={onExplainError}>
          {copy.actionExplainError}
        </button>
      ) : null}
      {collapseStructural && hasStructural ? (
        <details className="mj-notebook-ide-toolbar-more mj-notebooks-disclosure">
          <summary>{ideCopy.cellMoreActions}</summary>
          <div className="mj-notebook-toolbar-options">{structuralButtons}</div>
        </details>
      ) : null}
    </div>
  );
}
