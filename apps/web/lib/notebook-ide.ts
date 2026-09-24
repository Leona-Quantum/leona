/**
 * Pure helpers for the notebook IDE's notebook-level controls and per-cell status: the chip
 * a code cell shows, the error navigator's list of failing cells, and the outline built
 * from markdown headings. No React, no DOM — `components/notebook-cell-toolbar.tsx` and
 * `components/notebook-ide-bar.tsx` render from these.
 */

/** What a code cell's status chip says. "edited" is its own state rather than a flag on
 * the others: a result for code the reader has since changed is not a result for the code
 * on screen, and showing "Ran" beside it would claim the new code ran. */
export type CellRunChip = "ran" | "raised" | "not_run" | "running" | "edited" | "skipped";

export function cellRunChip({
  kind,
  execute,
  status,
  running = false,
  edited = false,
}: {
  kind: "code" | "markdown";
  execute: boolean;
  /** The last run's status for this cell (`NotebookCellView.status`), or `not_run`. */
  status: "ok" | "error" | "skipped" | "not_run";
  running?: boolean;
  /** The source on screen differs from the source that produced `status`. */
  edited?: boolean;
}): CellRunChip | null {
  if (kind !== "code") return null;
  if (running) return "running";
  if (status === "error") return edited ? "edited" : "raised";
  if (status === "ok") return edited ? "edited" : "ran";
  if (status === "skipped" || !execute) return "skipped";
  return "not_run";
}

/** The DOM id a cell's card carries, so the error navigator and the outline can scroll
 * to it. One scheme for the reading view and the editor, since only one is on screen. */
export function cellDomId(cellId: string): string {
  return `mj-notebook-cell-${cellId}`;
}

/** Ids of the cells whose last run raised, in notebook order. */
export function raisedCellIds(cells: readonly { id: string; status: string }[]): string[] {
  return cells.filter((cell) => cell.status === "error").map((cell) => cell.id);
}

export interface OutlineEntry {
  cellId: string;
  level: 1 | 2 | 3;
  text: string;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const ATX = /^ {0,3}(#{1,3})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const SETEXT_H1 = /^ {0,3}=+[ \t]*$/;
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/;
/** A line that cannot be the text of a setext heading: another block's opener. */
const NOT_PARAGRAPH = /^ {0,3}(?:#|>|[-*+][ \t]|\d+[.)][ \t]|`{3}|~{3})/;

/** A heading's words without its markdown: `**Bell** [state](url)` reads "Bell state". */
function plainHeading(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    // Single `*`/`_` only at word edges, so `qc_h_gate` keeps its underscores.
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w_])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The notebook's section headings, h1 to h3, in order. ATX (`## Title`) and setext
 * (`Title` over `===` or `---`) both count, because both render as headings in the cell.
 * Anything inside a fenced code block does not: a `# comment` in a ```python block is a
 * comment, not a section.
 */
export function notebookOutline(cells: readonly { id: string; kind: string; source: string }[]): OutlineEntry[] {
  const entries: OutlineEntry[] = [];
  for (const cell of cells) {
    if (cell.kind !== "markdown") continue;
    const lines = cell.source.split("\n");
    let fence: string | null = null;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const fenceMatch = FENCE.exec(line);
      if (fence !== null) {
        if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
        continue;
      }
      if (fenceMatch) {
        fence = fenceMatch[1];
        continue;
      }
      const atx = ATX.exec(line);
      if (atx) {
        const text = plainHeading(atx[2]);
        if (text) entries.push({ cellId: cell.id, level: atx[1].length as 1 | 2 | 3, text });
        continue;
      }
      const next = lines[index + 1];
      if (next !== undefined && line.trim() && !NOT_PARAGRAPH.test(line)) {
        const level = SETEXT_H1.test(next) ? 1 : SETEXT_H2.test(next) ? 2 : null;
        if (level !== null) {
          const text = plainHeading(line);
          if (text) entries.push({ cellId: cell.id, level, text });
          index += 1;
        }
      }
    }
  }
  return entries;
}
