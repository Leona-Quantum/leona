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
type AnswerPrompt = components["schemas"]["AnswerPrompt"];
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
  error: { ename: string; evalue: string; traceback: string[] } | null;
  /** Any output on this cell was cut for the sandbox's evidence budget. */
  truncated: boolean;
  durationMs: number | null;
  /**
   * Whether this cell produces a real verdict — a hidden assertion or an answer key
   * on the server. It decides which of two entirely different things "check my
   * attempt" does: post the attempt for a deterministic grade, or ask Nala's opinion.
   *
   * Derived from the presence of the key rather than from its contents, so it keeps
   * working when the payload a reader receives stops carrying the key at all — which
   * is where this is going, and the reason no code below ever reads `check` itself.
   */
  graded: boolean;
  /**
   * What the reader is shown of a question: the kind of input to draw, the options for
   * a `choice`, the unit for a `numeric`. Never the answer.
   *
   * Derived by `answerPromptOf`, which builds it from `answer_prompt` when the payload
   * carries one and REDACTS `answer` when it does not. The workspace is served the
   * authored spec today — the answer key really is in the browser's payload, filed as
   * ai-ops issue 260 — so this is the boundary that decides what gets DRAWN, and it exists
   * as a separate field precisely so no renderer ever reaches into `cell.answer`.
   */
  answerPrompt: AnswerPrompt | null;
}

/**
 * The reader-safe half of a question cell, from whichever half the payload carries.
 *
 * Field-by-field rather than a spread: a spread of `answer` would carry `correct`,
 * `accept` and `value` into the props of a component whose whole job is to render its
 * props, and the leak would be one careless `JSON.stringify` away. Listing the three
 * safe fields means a new key kind cannot smuggle a fourth.
 */
export function answerPromptOf(cell: Cell): AnswerPrompt | null {
  if (cell.answer_prompt) {
    return {
      kind: cell.answer_prompt.kind,
      options: cell.answer_prompt.options ?? [],
      unit: cell.answer_prompt.unit ?? "",
    };
  }
  if (!cell.answer) return null;
  const key = cell.answer;
  return {
    kind: key.kind,
    options: key.kind === "choice" ? key.options : [],
    unit: key.kind === "numeric" ? (key.unit ?? "") : "",
  };
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
      error: result?.error
        ? { ename: result.error.ename, evalue: result.error.evalue, traceback: result.error.traceback ?? [] }
        : null,
      truncated: outputs.some((output) => output.truncated),
      durationMs: result ? result.duration_ms : null,
      graded: cell.check != null || cell.answer != null || cell.answer_prompt != null,
      answerPrompt: answerPromptOf(cell),
    };
  });
}

/**
 * The text the "Explain this error" cell action (`components/notebook-view.tsx`)
 * quotes back to Nala. Prefers the real traceback the sandbox captured; a
 * cell error with no traceback lines (seen from `NotebookGuardError` and a
 * couple of other non-Python failure paths) falls back to `ename: evalue`
 * rather than sending an empty fenced block.
 */
export function errorTracebackText(error: NotebookCellView["error"]): string {
  if (!error) return "";
  if (error.traceback.length > 0) return error.traceback.join("\n");
  return `${error.ename}: ${error.evalue}`;
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
