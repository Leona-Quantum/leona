"use client";

import { cellDomId, notebookOutline, raisedCellIds as raisedCellIdsOf, type OutlineEntry } from "../lib/notebook-ide";
import type { NotebookIdeCopy } from "../lib/workspace-locale";

/** Scrolls a cell's card into view and focuses it — the same DOM id scheme
 * (`cellDomId`) the editor and the read-only view both stamp on their cell cards, so
 * this bar works over either without knowing which one is on screen. Cards carry
 * `tabIndex={0}` for exactly this: command mode's J/K selection and this jump share
 * one notion of "the cell that has focus". */
function jumpToCell(cellId: string) {
  const node = document.getElementById(cellDomId(cellId));
  if (!node) return;
  node.scrollIntoView({ block: "start", behavior: "smooth" });
  if (node instanceof HTMLElement) node.focus();
}

/**
 * The notebook-level bar: Run all, "N cells raised an error — go to the first", and an
 * outline built from markdown headings. Pure DOM navigation (`jumpToCell`) — no prop for
 * "how to scroll", because both call sites (`notebook-editor.tsx`, `notebook-view.tsx`)
 * want the same behaviour and neither has a reason to override it.
 *
 * `onRunAll` is optional: until the workspace wires it, the bar still renders the error
 * navigator and the outline, just without a Run All button — a no-op-safe default rather
 * than a component that cannot render before every caller is ready.
 */
export function NotebookIdeBar({
  cells,
  cellStatuses,
  copy,
  busy = false,
  onRunAll,
}: {
  cells: readonly { id: string; kind: string; source: string }[];
  /** Cell id -> last run status, wherever the caller has it (`NotebookCellView.status`
   * in the read view, an optional `cellResults` prop in the editor). Absent entries are
   * not raised — a cell nobody has run yet cannot be "N cells raised". */
  cellStatuses: ReadonlyMap<string, string>;
  copy: NotebookIdeCopy;
  busy?: boolean;
  onRunAll?: () => void;
}) {
  const raised = raisedCellIdsOf(cells.map((cell) => ({ id: cell.id, status: cellStatuses.get(cell.id) ?? "not_run" })));
  const outline = notebookOutline(cells);
  if (!onRunAll && raised.length === 0 && outline.length === 0) return null;
  return (
    <div className="mj-notebook-ide-bar" role="group" aria-label={copy.barLabel}>
      <div className="mj-notebook-ide-bar-row">
        {onRunAll ? (
          <button type="button" className="mj-secondary-button" disabled={busy} onClick={onRunAll} title={copy.runAllHint}>
            {copy.runAll}
          </button>
        ) : null}
        {raised.length > 0 ? (
          <p className="mj-notebook-ide-raised" role="status">
            {copy.raised(raised.length)}{" "}
            <button type="button" onClick={() => jumpToCell(raised[0])}>
              {copy.goToRaised(raised.length)}
            </button>
          </p>
        ) : null}
      </div>
      {outline.length > 0 ? <NotebookOutline outline={outline} label={copy.outlineLabel} /> : null}
    </div>
  );
}

function NotebookOutline({ outline, label }: { outline: readonly OutlineEntry[]; label: string }) {
  return (
    <nav className="mj-notebook-ide-outline" aria-label={label}>
      <p className="mj-notebook-ide-outline-label">{label}</p>
      <ul>
        {outline.map((entry, index) => (
          <li key={`${entry.cellId}-${index}`} data-level={entry.level}>
            <button type="button" onClick={() => jumpToCell(entry.cellId)}>
              {entry.text}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
