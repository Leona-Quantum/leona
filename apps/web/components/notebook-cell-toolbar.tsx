"use client";

import type { CellRunChip } from "../lib/notebook-ide";
import type { NotebookIdeCopy } from "../lib/workspace-locale";

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
 * once, so no call site has to remember the rule.
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
  onInsert,
  onMove,
  onDelete,
  onDuplicate,
  onConvert,
  onRunToHere,
  onAskNala,
  onFixWithNala,
  onExplainError,
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
  onInsert?: (kind: "code" | "markdown") => void;
  onMove?: (direction: "up" | "down") => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
  onConvert?: (to: "markdown" | "code") => void;
  onRunToHere?: () => void;
  onAskNala?: () => void;
  onFixWithNala?: () => void;
  onExplainError?: () => void;
}) {
  const isCode = kind === "code";
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
      {isCode && onAskNala ? (
        <button type="button" disabled={busy} onClick={onAskNala} title={ideCopy.askNalaHint}>
          {ideCopy.askNala}
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
    </div>
  );
}
