"use client";

import type { components } from "@majorana/contracts-gen";
import { CELL_ROLE_VALUES } from "@majorana/contracts-gen/enums";
import type { KeyboardEvent } from "react";
import { useEffect, useRef } from "react";
import type { CellEdit } from "../lib/notebook-editing";
import { raisesException } from "../lib/notebook-editing";
import type { PublicLocale } from "../lib/public-locale";
import { WORKSPACE_COPY } from "../lib/workspace-locale";

type Cell = components["schemas"]["Cell"];
type CellRole = components["schemas"]["CellRole"];
type NotebookCopy = (typeof WORKSPACE_COPY)[PublicLocale]["notebooks"];

const INDENT = "  ";

/**
 * The editing half of the notebook surface: the same cards the reader reads,
 * with their sources open in a textarea.
 *
 * Deliberately a plain `<textarea>` and nothing else. `apps/web/AGENTS.md` allows no new
 * npm dependencies and no component libraries, and a code editor is the classic place a
 * renderer grows one. What a textarea costs is syntax highlighting while typing, which
 * comes back the moment the reader leaves edit mode; what it buys is that the editor
 * works with a screen reader, on a phone keyboard, and with the browser's own undo
 * stack, none of which a hand-rolled contenteditable would.
 *
 * This component owns no state. Every keystroke goes up as a `CellEdit` and comes back
 * down as `cells` — so the draft has exactly one home (`notebook-workspace.tsx`) and the
 * spec that gets POSTed is the same array the reader is looking at.
 */
export function NotebookEditor({
  cells,
  locale = "en",
  focusedCellId,
  busy = false,
  onEdit,
  onInsert,
  onDelete,
  onMove,
  onFocusCell,
  onRunToHere,
}: {
  cells: Cell[];
  locale?: PublicLocale;
  focusedCellId: string | null;
  busy?: boolean;
  onEdit: (cellId: string, edit: CellEdit) => void;
  onInsert: (afterId: string | null, kind: Cell["kind"]) => void;
  onDelete: (cellId: string) => void;
  onMove: (cellId: string, direction: "up" | "down") => void;
  onFocusCell: (cellId: string) => void;
  onRunToHere: (cellId: string) => void;
}) {
  const copy = WORKSPACE_COPY[locale].notebooks;
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
      {cells.map((cell, index) => (
        <EditableCellCard
          key={cell.id}
          cell={cell}
          copy={copy}
          busy={busy}
          focused={focusedCellId === cell.id}
          canMoveUp={index > 0}
          canMoveDown={index < cells.length - 1}
          onEdit={onEdit}
          onInsert={onInsert}
          onDelete={onDelete}
          onMove={onMove}
          onFocusCell={onFocusCell}
          onRunToHere={onRunToHere}
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
  onEdit,
  onInsert,
  onDelete,
  onMove,
  onFocusCell,
  onRunToHere,
}: {
  cell: Cell;
  copy: NotebookCopy;
  busy: boolean;
  focused: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onEdit: (cellId: string, edit: CellEdit) => void;
  onInsert: (afterId: string | null, kind: Cell["kind"]) => void;
  onDelete: (cellId: string) => void;
  onMove: (cellId: string, direction: "up" | "down") => void;
  onFocusCell: (cellId: string) => void;
  onRunToHere: (cellId: string) => void;
}) {
  return (
    <article className="mj-notebook-edit-cell" data-kind={cell.kind} data-focused={focused}>
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

      <AutoGrowTextarea
        value={cell.source}
        label={copy.editCellSourceLabel(cell.id)}
        disabled={busy}
        onChange={(source) => onEdit(cell.id, { source })}
        onFocus={() => onFocusCell(cell.id)}
      />

      <div className="mj-notebook-edit-cell-actions mj-library-row-actions">
        <button type="button" disabled={busy} onClick={() => onInsert(cell.id, "markdown")}>
          {copy.editAddMarkdown}
        </button>
        <button type="button" disabled={busy} onClick={() => onInsert(cell.id, "code")}>
          {copy.editAddCode}
        </button>
        <button
          type="button"
          disabled={busy || !canMoveUp}
          onClick={() => onMove(cell.id, "up")}
        >
          {copy.editMoveUp}
        </button>
        <button
          type="button"
          disabled={busy || !canMoveDown}
          onClick={() => onMove(cell.id, "down")}
        >
          {copy.editMoveDown}
        </button>
        <button type="button" disabled={busy} onClick={() => onDelete(cell.id)}>
          {copy.editDelete}
        </button>
        {focused ? (
          <button
            type="button"
            className="mj-notebook-edit-run-to-here"
            disabled={busy}
            onClick={() => onRunToHere(cell.id)}
          >
            {copy.runToHere}
          </button>
        ) : null}
      </div>
    </article>
  );
}

/**
 * A monospace textarea that grows to its content, and where Tab indents instead of
 * leaving the field.
 *
 * The Tab handling is a deliberate accessibility trade with a deliberate escape hatch:
 * inside a code cell, Tab has to indent or the editor is unusable for Python, but
 * capturing Tab outright would trap a keyboard user in the textarea. Shift+Tab is left
 * alone, so it still moves focus backwards out of the field, and every action on the
 * card is a real `<button>` reachable that way.
 */
function AutoGrowTextarea({
  value,
  label,
  disabled,
  onChange,
  onFocus,
}: {
  value: string;
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onFocus: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    // Reset first: without it the height only ever ratchets upwards, so deleting
    // twenty lines leaves twenty lines of blank space behind.
    node.style.height = "auto";
    node.style.height = `${node.scrollHeight}px`;
  }, [value]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Tab" || event.shiftKey) return;
    event.preventDefault();
    const node = event.currentTarget;
    const { selectionStart, selectionEnd } = node;
    const next = `${value.slice(0, selectionStart)}${INDENT}${value.slice(selectionEnd)}`;
    onChange(next);
    // The caret would otherwise jump to the end of the whole cell on re-render, which
    // makes typing an indented block impossible after the first line.
    requestAnimationFrame(() => {
      node.selectionStart = node.selectionEnd = selectionStart + INDENT.length;
    });
  }

  return (
    <label className="mj-notebook-edit-source">
      <span className="sr-only">{label}</span>
      <textarea
        ref={ref}
        className="mj-notebook-edit-textarea mj-code-body"
        value={value}
        spellCheck={false}
        rows={2}
        disabled={disabled}
        onFocus={onFocus}
        onKeyDown={handleKeyDown}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
