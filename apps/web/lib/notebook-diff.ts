/**
 * The honest diff between two notebook versions: cells matched by id, not by
 * array position. v1's revision ops keep a cell's id stable across a turn
 * (apply_revision never renumbers an untouched cell — see the design doc §3),
 * so an id match is the same cell across versions in a way a positional
 * diff (line 4 of file A vs line 4 of file B) is not — a single inserted
 * cell would otherwise make every cell after it read as "changed".
 *
 * Pure logic only: no DOM, no React. `components/notebook-diff-view.tsx`
 * renders what this computes.
 */
import type { components } from "@majorana/contracts-gen";

type NotebookSpec = components["schemas"]["NotebookSpec"];
type Cell = components["schemas"]["Cell"];

export type NotebookDiffCellStatus = "added" | "removed" | "changed" | "unchanged" | "moved";

export interface NotebookDiffLine {
  kind: "+" | "-" | " ";
  text: string;
}

export interface NotebookDiffCell {
  id: string;
  status: NotebookDiffCellStatus;
  /** Only set for `status: "changed"` — the line-level diff of `source`. */
  lines?: NotebookDiffLine[];
}

export interface NotebookDiffHeaderField {
  field: "title" | "summary" | "objectives" | "duration_minutes";
  before: string;
  after: string;
}

export interface NotebookVersionDiff {
  header: NotebookDiffHeaderField[];
  cells: NotebookDiffCell[];
}

/**
 * A minimal LCS-based line diff (no library) — the standard longest-common-
 * -subsequence table walked backward into a `+`/`-`/` ` script. O(n·m) time
 * and space in the two texts' line counts; a 200-line cell (n=m=200, 40,000
 * table cells) is microseconds, which is the only performance bar this needs
 * to clear.
 */
function diffLines(before: string, after: string): NotebookDiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: NotebookDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: " ", text: a[i] });
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "-", text: a[i] });
      i += 1;
    } else {
      out.push({ kind: "+", text: b[j] });
      j += 1;
    }
  }
  while (i < n) {
    out.push({ kind: "-", text: a[i] });
    i += 1;
  }
  while (j < m) {
    out.push({ kind: "+", text: b[j] });
    j += 1;
  }
  return out;
}

function cellsEqual(a: Cell, b: Cell): boolean {
  return (
    a.kind === b.kind &&
    a.role === b.role &&
    a.source === b.source &&
    a.execute === b.execute &&
    (a.stub ?? null) === (b.stub ?? null) &&
    (a.tags ?? []).join(" ") === (b.tags ?? []).join(" ")
  );
}

function diffHeader(older: NotebookSpec, newer: NotebookSpec): NotebookDiffHeaderField[] {
  const fields: Array<[NotebookDiffHeaderField["field"], string, string]> = [
    ["title", older.title, newer.title],
    ["summary", older.summary ?? "", newer.summary ?? ""],
    ["objectives", (older.objectives ?? []).join("\n"), (newer.objectives ?? []).join("\n")],
    [
      "duration_minutes",
      older.duration_minutes == null ? "" : String(older.duration_minutes),
      newer.duration_minutes == null ? "" : String(newer.duration_minutes),
    ],
  ];
  return fields
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({ field, before, after }));
}

export function diffNotebookVersions(older: NotebookSpec, newer: NotebookSpec): NotebookVersionDiff {
  const olderCells = older.cells ?? [];
  const newerCells = newer.cells ?? [];
  const olderById = new Map(olderCells.map((cell) => [cell.id, cell]));
  const newerById = new Map(newerCells.map((cell) => [cell.id, cell]));

  // Relative order of cells common to both versions, with the non-common
  // ones filtered out of each side first — cheap enough to detect "this
  // cell's id is in both, but they no longer agree on where it sits" (a
  // move) without a full sequence alignment, which the line diff above is
  // the one place this file actually needs.
  const commonOlderOrder = olderCells.filter((cell) => newerById.has(cell.id)).map((cell) => cell.id);
  const commonNewerOrder = newerCells.filter((cell) => olderById.has(cell.id)).map((cell) => cell.id);
  const olderPos = new Map(commonOlderOrder.map((id, index) => [id, index]));
  const newerPos = new Map(commonNewerOrder.map((id, index) => [id, index]));

  function statusFor(id: string): NotebookDiffCell {
    const before = olderById.get(id);
    const after = newerById.get(id);
    if (!before) return { id, status: "added" };
    if (!after) return { id, status: "removed" };
    if (!cellsEqual(before, after)) {
      return { id, status: "changed", lines: diffLines(before.source ?? "", after.source ?? "") };
    }
    if (olderPos.get(id) !== newerPos.get(id)) return { id, status: "moved" };
    return { id, status: "unchanged" };
  }

  // Output order: newer's own cell order carries every added/kept cell; a
  // removed cell is inserted right after the nearest cell (in older's
  // order) that survived into newer — "this used to follow that one" — or
  // at the very front when nothing before it survived.
  const anchorForRemoved = new Map<string, string | null>();
  let lastSurviving: string | null = null;
  for (const cell of olderCells) {
    if (newerById.has(cell.id)) {
      lastSurviving = cell.id;
    } else {
      anchorForRemoved.set(cell.id, lastSurviving);
    }
  }
  const removedByAnchor = new Map<string | null, string[]>();
  for (const cell of olderCells) {
    if (newerById.has(cell.id)) continue;
    const anchor = anchorForRemoved.get(cell.id) ?? null;
    const bucket = removedByAnchor.get(anchor);
    if (bucket) bucket.push(cell.id);
    else removedByAnchor.set(anchor, [cell.id]);
  }

  const cells: NotebookDiffCell[] = [];
  for (const id of removedByAnchor.get(null) ?? []) cells.push(statusFor(id));
  for (const cell of newerCells) {
    cells.push(statusFor(cell.id));
    for (const id of removedByAnchor.get(cell.id) ?? []) cells.push(statusFor(id));
  }

  return { header: diffHeader(older, newer), cells };
}
