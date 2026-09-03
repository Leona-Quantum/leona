/**
 * Pure cell edits for the in-browser notebook editor.
 *
 * Every one of these takes the pinned version's cells and returns a new array — no
 * mutation, no React, no DOM. `notebook-workspace.tsx` holds the draft in state and
 * posts the resulting spec; this file is where "what does 'move that cell up' mean"
 * is decided and tested.
 *
 * The one rule with a counterpart on the server: a new cell's id is the lowest free
 * `cNN`, the same rule as `leona_notebooks.authoring.next_cell_id`. The two have to
 * agree — an id minted here travels to the API as part of the spec, and a version
 * saved with a colliding id fails `NotebookSpec`'s uniqueness validator on the way in.
 */
import type { components } from "@majorana/contracts-gen";

type Cell = components["schemas"]["Cell"];
type CellRole = components["schemas"]["CellRole"];
type NotebookSpec = components["schemas"]["NotebookSpec"];

/** The fields the editor lets a reader change. Everything else on a cell is carried
 * through untouched, which is what keeps an edit from quietly dropping `stub` or
 * `timeout_s` off a cell Nala wrote. */
export interface CellEdit {
  source?: string;
  kind?: Cell["kind"];
  role?: CellRole | null;
  execute?: boolean;
  raisesException?: boolean;
}

const RAISES_TAG = "raises-exception";

/**
 * The lowest free `cNN`. Mirrors `assign_cell_ids`'s documented rule (and
 * `leona_notebooks.authoring.next_cell_id`, which is the implementation that actually
 * runs on the server). Counts from 1 and skips what is taken, so deleting c02 and
 * adding a cell reuses c02 rather than climbing forever.
 */
export function nextCellId(cells: readonly Cell[]): string {
  const used = new Set(cells.map((cell) => cell.id));
  let index = 1;
  while (used.has(`c${String(index).padStart(2, "0")}`)) index += 1;
  return `c${String(index).padStart(2, "0")}`;
}

/** The generated types make `tags` optional (pydantic gives it a default, so OpenAPI
 * does not mark it required). Every read of it goes through here, so a cell that
 * arrived without the key behaves as one with no tags rather than throwing. */
function tagsOf(cell: Pick<Cell, "tags">): readonly string[] {
  return cell.tags ?? [];
}

function applyTag(tags: readonly string[], tag: string, present: boolean): string[] {
  const without = tags.filter((existing) => existing !== tag);
  return present ? [...without, tag] : without;
}

/** One cell changed in place. Unknown ids return the array unchanged rather than
 * throwing: a stale click after a reload should be a no-op, not a crash. */
export function applyCellEdit(cells: readonly Cell[], cellId: string, edit: CellEdit): Cell[] {
  return cells.map((cell) => {
    if (cell.id !== cellId) return cell;
    const next: Cell = { ...cell };
    if (edit.source !== undefined) next.source = edit.source;
    if (edit.kind !== undefined) {
      next.kind = edit.kind;
      // A markdown cell can carry neither a stub nor a raises-exception tag — the
      // contract's own `_stub_only_on_code` validator refuses the first, and the
      // second would be silently meaningless. Clearing them here keeps a
      // code -> markdown flip from producing a spec the API rejects.
      if (edit.kind === "markdown") {
        next.stub = null;
        next.tags = applyTag(tagsOf(next), RAISES_TAG, false);
      }
    }
    if (edit.role !== undefined) next.role = edit.role;
    if (edit.execute !== undefined) next.execute = edit.execute;
    if (edit.raisesException !== undefined && next.kind === "code") {
      next.tags = applyTag(tagsOf(next), RAISES_TAG, edit.raisesException);
    }
    return next;
  });
}

/** Whether this cell is tagged to keep going past an exception. */
export function raisesException(cell: Pick<Cell, "tags">): boolean {
  return tagsOf(cell).includes(RAISES_TAG);
}

/** A new empty cell below `afterId`. `afterId === null` puts it at the top. */
export function insertCellAfter(
  cells: readonly Cell[],
  afterId: string | null,
  kind: Cell["kind"],
): { cells: Cell[]; id: string } {
  const id = nextCellId(cells);
  const created: Cell = {
    id,
    kind,
    role: null,
    source: "",
    tags: [],
    execute: true,
    stub: null,
    timeout_s: null,
  };
  const index = afterId === null ? -1 : cells.findIndex((cell) => cell.id === afterId);
  // An unknown `afterId` appends rather than dropping the cell on the floor.
  const at = index === -1 && afterId !== null ? cells.length : index + 1;
  return { cells: [...cells.slice(0, at), created, ...cells.slice(at)], id };
}

/** Remove one cell. Removing the last cell is allowed — an empty notebook is a legal
 * spec, and refusing it would strand a reader who wants to start over. */
export function deleteCell(cells: readonly Cell[], cellId: string): Cell[] {
  return cells.filter((cell) => cell.id !== cellId);
}

/** Move a cell one position. A move off either end is a no-op, so holding the button
 * down at the top of the notebook does nothing rather than wrapping around. */
export function moveCell(cells: readonly Cell[], cellId: string, direction: "up" | "down"): Cell[] {
  const index = cells.findIndex((cell) => cell.id === cellId);
  if (index === -1) return [...cells];
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= cells.length) return [...cells];
  const next = [...cells];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** The spec to POST: the pinned version's, with the edited cells. Everything else —
 * kind, audience, style, framework, references, seeds — is carried through, so an edit
 * to one cell cannot silently reset the notebook's metadata. */
export function specWithCells(spec: NotebookSpec, cells: readonly Cell[]): NotebookSpec {
  return { ...spec, cells: [...cells] };
}

/** Whether the draft differs from the version it was opened from. Compared on the
 * fields the editor can change plus order, rather than by deep-equalling the whole
 * cell: a field the editor never touches cannot make the notebook look dirty. */
export function cellsAreDirty(original: readonly Cell[], draft: readonly Cell[]): boolean {
  if (original.length !== draft.length) return true;
  return original.some((cell, index) => {
    const other = draft[index];
    return (
      cell.id !== other.id ||
      cell.kind !== other.kind ||
      cell.role !== other.role ||
      cell.source !== other.source ||
      cell.execute !== other.execute ||
      raisesException(cell) !== raisesException(other)
    );
  });
}
