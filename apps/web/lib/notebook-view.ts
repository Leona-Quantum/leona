/**
 * Pure joins and classifications for rendering a notebook version.
 *
 * `NotebookSpec.cells` is the notebook's shape; `ExecutionReport.cells` is what
 * running it produced, matched back to the spec by `id` (never by array
 * position — a repair can reorder or drop cells between attempts). Nothing
 * here touches the DOM or imports React: `components/notebook-view.tsx` is the
 * renderer, this is what it renders from.
 */
import type { components } from "@majorana/contracts-gen";

type Cell = components["schemas"]["Cell"];
type CellRole = components["schemas"]["CellRole"];
type CellOutput = components["schemas"]["CellOutput"];
type CellResult = components["schemas"]["CellResult"];
type ExecutionReport = components["schemas"]["ExecutionReport"];
type NotebookVersionStatus = components["schemas"]["NotebookVersionStatus"];

export type NotebookCellStatus = "ok" | "error" | "skipped" | "not_run";

/**
 * `image/png` is the one mime the sandbox actually emits today (§2 of the
 * design doc: no `matplotlib` in the sandbox image yet means figures mostly
 * arrive as `figures: unavailable` text, not as this output at all) — but the
 * contract allows five others, and every one of them renders as text, INCLUDING
 * `text/html`. That last one is deliberate, not an oversight: this is model
 * output, injecting it as raw HTML would be an XSS hole, and the brief
 * this was built from says so explicitly. There is no HTML rendering path here
 * for a reader to accidentally wire back in.
 */
export type NotebookOutputView =
  | { kind: "image"; mime: "image/png"; src: string; truncated: boolean }
  | { kind: "text"; mime: Exclude<CellOutput["mime"], "image/png">; text: string; truncated: boolean };

export function classifyCellOutput(output: CellOutput): NotebookOutputView {
  if (output.mime === "image/png") {
    return { kind: "image", mime: "image/png", src: `data:image/png;base64,${output.data}`, truncated: output.truncated };
  }
  return { kind: "text", mime: output.mime, text: output.data, truncated: output.truncated };
}

export interface NotebookCellView {
  id: string;
  kind: Cell["kind"];
  role: CellRole | null;
  source: string;
  execute: boolean;
  status: NotebookCellStatus;
  stdout: string;
  stderr: string;
  outputs: NotebookOutputView[];
  error: { ename: string; evalue: string } | null;
  /** Any output on this cell was cut for the sandbox's evidence budget. */
  truncated: boolean;
  durationMs: number | null;
}

function resultFor(results: Map<string, CellResult>, cellId: string): CellResult | undefined {
  return results.get(cellId);
}

/**
 * The default status a cell gets when the report carries no result for it —
 * true of every cell before the first run, and of any cell the sandbox never
 * reached because an earlier one raised (Jupyter's Run-All semantics, per the
 * design doc §2). A cell marked `execute: false` (hardware, credentials) is
 * "skipped" rather than "not_run": the product never attempts it, by design,
 * not because a run stopped short.
 */
function defaultStatus(cell: Cell): NotebookCellStatus {
  if (cell.kind !== "code" || !cell.execute) return "skipped";
  return "not_run";
}

export function notebookCellViews(
  cells: readonly Cell[] | null | undefined,
  report: ExecutionReport | null | undefined,
): NotebookCellView[] {
  const results = new Map<string, CellResult>();
  for (const result of report?.cells ?? []) results.set(result.id, result);

  return (cells ?? []).map((cell): NotebookCellView => {
    const result = resultFor(results, cell.id);
    const outputs = (result?.outputs ?? []).map(classifyCellOutput);
    return {
      id: cell.id,
      kind: cell.kind,
      role: cell.role,
      source: cell.source,
      execute: cell.execute,
      status: result?.status ?? defaultStatus(cell),
      stdout: result?.stdout ?? "",
      stderr: result?.stderr ?? "",
      outputs,
      error: result?.error ? { ename: result.error.ename, evalue: result.error.evalue } : null,
      truncated: outputs.some((output) => output.truncated),
      durationMs: result ? result.duration_ms : null,
    };
  });
}

/**
 * The four states `notebooks-home.tsx`'s list pill shows. Not a re-export of
 * `NotebookVersionStatus`: "running" reads to a reader as "the notebook is mid
 * -execution", which is true but not the headline — Nala is still writing it.
 * "generating" is the word the design doc's own list description uses.
 */
export type NotebookStatusPill = "queued" | "generating" | "ready" | "failed";

export function notebookStatusPill(status: NotebookVersionStatus): NotebookStatusPill {
  return status === "running" ? "generating" : status;
}
