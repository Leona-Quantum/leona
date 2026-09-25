/**
 * Reduce a notebook generation/revision run's SSE event log into a live view of the
 * notebook developing in real time (plan 10-notebook-ide, "Live" lane): what Nala is
 * doing right now, the cells as they are written, each cell's execution result once it
 * has one, and the repair log.
 *
 * Pure and generic, the same way `lib/notebook-progress.ts` is: this reads whatever
 * `notebook.*` events the worker actually emits
 * (`services/worker/src/majorana_worker/notebook_handlers.py`,
 * `packages/py/contracts/src/majorana_contracts/events.py`) rather than guessing at a
 * shape, and it is fed the SAME `RunProgressEvent[]` `useRunProgress` already collects
 * — no second SSE subscription.
 *
 * **This module never needs to redact anything.** The worker withholds a graded or
 * solution-only cell's real text before it ever reaches `notebook.draft.delta` /
 * `notebook.draft.parsed` / `notebook.repair` (`leona_notebooks.live_draft.LiveDraftGuard`,
 * `NotebookSpec.for_learner()`) — see the Live lane's report for the redaction finding
 * (the run's event stream is workspace-scoped, not author-scoped). A cell this reducer
 * never SEES is a cell it correctly never shows; there is no second gate to build here.
 */

export type LiveNotebookPhase =
  | "idle"
  | "outlining"
  | "drafting"
  | "checking"
  | "running"
  | "repairing"
  | "reviewing"
  | "done"
  | "failed";

/** The four states a cell can be in DURING a live run — distinct from
 * `NotebookCellStatus` (`lib/notebook-view.ts`), which describes a FINISHED
 * version's report and has no "not dispatched yet" state at all. */
export type LiveCellStatus = "queued" | "ran" | "raised" | "not_run";

export interface LiveCellView {
  id: string;
  kind: "markdown" | "code";
  role: string | null;
  source: string;
  /** `true` for the one cell currently being streamed — the trailing, still-open
   * cell of an incremental parse. Never true once `notebook.draft.parsed` has
   * replaced the incremental view for this attempt. */
  writing: boolean;
  status: LiveCellStatus;
  ename: string | null;
  evalue: string | null;
  /** A `role=check` cell's verdict, straight off `NotebookLiveCellResult.check` —
   * status only, the same "no stdout, no outputs" rule the rest of this event
   * follows. `null` before this cell's check has run (or reset to null every
   * attempt below is never needed: a check's cell id is judged once per dispatch,
   * same as its status) and for every non-check cell. */
  check: "pass" | "fail" | "inconclusive" | null;
}

export interface LiveRepairEntry {
  cellId: string;
  status: "started" | "finished" | "failed";
  /** "<ename>: <evalue>" of the error being repaired (started/finished), or the
   * repair call's own failure message (failed) — see `NotebookRepair`'s docstring
   * in `events.py` for why one field carries both. */
  error: string | null;
  attempt: number;
  of: number;
  beforeRunning: boolean;
  /** The repaired cell's new source, redacted server-side to `null` for a
   * graded/solution-only cell. Present only once `status` is "finished". */
  source: string | null;
}

export interface LiveNotebookState {
  phase: LiveNotebookPhase;
  /** The safe fragment of the CURRENT draft attempt's raw text — reset whenever a
   * new draft attempt starts, and never populated by a repair's own (much
   * shorter) delta stream, which drives `currentRepair` instead. */
  draftText: string;
  /** Best-known cells: the last `notebook.draft.parsed` for the current draft
   * attempt if one has arrived, else an incremental parse of `draftText` — see
   * `parseCellsIncrementally`. Execution status/error is overlaid from the latest
   * `notebook.cells`, and a finished repair's redacted `source` (when non-null)
   * is overlaid onto its cell. */
  cells: LiveCellView[];
  /** Every `notebook.repair` event, oldest first — a log a caller can render in
   * full, or reduce further (e.g. "how many attempts has this cell had"). */
  repairs: LiveRepairEntry[];
  /** The most recent repair that has started but not yet finished/failed, or
   * `null` when no repair is in flight — what the "Nala is fixing cell X"
   * banner is shown for. */
  currentRepair: LiveRepairEntry | null;
}

/** The one shape this reducer needs off an event — a structural subset of
 * `RunProgressEvent` (`lib/use-run-progress.ts`) so this module has no import
 * dependency on that hook and stays trivially testable with plain object literals. */
export interface LiveNotebookEvent {
  type: string;
  stage?: string | null;
  status?: string;
  [key: string]: unknown;
}

const INITIAL_STATE: LiveNotebookState = {
  phase: "idle",
  draftText: "",
  cells: [],
  repairs: [],
  currentRepair: null,
};

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * A best-effort, forgiving parse of `.nb.py` percent-format text into cells, for text
 * that may be incomplete (still streaming). Not `leona_notebooks.source.parse_source`
 * ported to TypeScript — that parser is authoritative and rejects anything malformed,
 * which a half-written draft always is. This one only needs to find `# %%` cell
 * markers and their `id=`/`role=`/`[markdown]` tokens well enough to render a live
 * preview; the notebook is later parsed for real, server-side, and `notebook.draft.parsed`
 * replaces this view with that authoritative result.
 *
 * Text before the first `# %%` marker (the YAML front-matter: title, kind,
 * objectives) is not a cell and is not returned as one.
 */
export function parseCellsIncrementally(text: string): LiveCellView[] {
  const lines = text.split("\n");
  const cells: LiveCellView[] = [];
  let current: { kind: "markdown" | "code"; id: string | null; role: string | null; lines: string[] } | null = null;
  let positional = 0;

  function cellFrom(
    state: { kind: "markdown" | "code"; id: string | null; role: string | null; lines: string[] },
    writing: boolean,
  ): LiveCellView {
    const source =
      state.kind === "markdown"
        ? state.lines
            .map((line) => (line.startsWith("# ") ? line.slice(2) : line.startsWith("#") ? line.slice(1) : line))
            .join("\n")
        : state.lines.join("\n");
    const id = state.id ?? `c${String(++positional).padStart(2, "0")}`;
    return { id, kind: state.kind, role: state.role, source, writing, status: "queued", ename: null, evalue: null, check: null };
  }

  for (const line of lines) {
    const marker = /^# %%(.*)$/.exec(line);
    if (marker) {
      if (current) cells.push(cellFrom(current, false));
      const rest = marker[1] ?? "";
      const kind: "markdown" | "code" = /\[(markdown|md)\]/.test(rest) ? "markdown" : "code";
      const idMatch = /(?:^|\s)id=("?)([\w-]+)\1/.exec(rest);
      const roleMatch = /(?:^|\s)role=("?)([\w-]+)\1/.exec(rest);
      current = { kind, id: idMatch ? idMatch[2] : null, role: roleMatch ? roleMatch[2] : null, lines: [] };
      continue;
    }
    if (current) current.lines.push(line);
    // A line before the first marker is front-matter; ignored here on purpose.
  }
  if (current) {
    // The trailing cell has no closing marker yet — it is the one Nala is
    // writing right now.
    cells.push(cellFrom(current, true));
  }
  return cells;
}

function phaseForStage(stage: string, repairInFlight: boolean): LiveNotebookPhase | null {
  switch (stage) {
    case "plan":
      return "outlining";
    case "generate":
      // `notebook.draft` and `notebook.repair` both map to Stage.GENERATE on the
      // generic stage.started/finished pair (`_STAGE_MAP` in notebook_handlers.py),
      // so this event alone cannot tell a fresh draft from a repair attempt — a
      // repair already set its own, more specific phase ("checking"/"repairing")
      // via its own `notebook.repair` event, and this must not overwrite it.
      return repairInFlight ? null : "drafting";
    case "final_execute":
      return "running";
    case "verify":
      return "reviewing";
    default:
      return null;
  }
}

export function liveNotebookFromEvents(events: readonly LiveNotebookEvent[]): LiveNotebookState {
  let phase: LiveNotebookPhase = "idle";
  let draftAttempt = 0;
  let draftText = "";
  let parsedCells: LiveCellView[] | null = null;
  let parsedMatchesCurrentDraft = false;
  let repairInFlight = false;
  const repairs: LiveRepairEntry[] = [];
  const cellResults = new Map<
    string,
    { status: LiveCellStatus; ename: string | null; evalue: string | null; check: "pass" | "fail" | "inconclusive" | null }
  >();
  const repairedSources = new Map<string, string>();

  for (const event of events) {
    switch (event.type) {
      case "stage.started": {
        const stage = asString(event.stage);
        const next = stage ? phaseForStage(stage, repairInFlight) : null;
        if (next) phase = next;
        break;
      }
      case "notebook.draft.delta": {
        if (repairInFlight) break; // a repair's own (short) fragment, not the draft
        const attempt = asNumber(event.attempt, draftAttempt);
        if (attempt !== draftAttempt) {
          draftAttempt = attempt;
          draftText = "";
          parsedMatchesCurrentDraft = false;
        }
        draftText += asString(event.text);
        break;
      }
      case "notebook.draft.parsed": {
        const rawCells = Array.isArray(event.cells) ? (event.cells as Record<string, unknown>[]) : [];
        parsedCells = rawCells.map((cell) => ({
          id: asString(cell.id),
          kind: cell.kind === "markdown" ? "markdown" : "code",
          role: asNullableString(cell.role),
          source: asString(cell.source),
          writing: false,
          status: "queued",
          ename: null,
          evalue: null,
          check: null,
        }));
        parsedMatchesCurrentDraft = true;
        break;
      }
      case "notebook.cells": {
        const rawCells = Array.isArray(event.cells) ? (event.cells as Record<string, unknown>[]) : [];
        for (const cell of rawCells) {
          const id = asString(cell.id);
          if (!id) continue;
          const rawStatus = asString(cell.status);
          const status: LiveCellStatus = rawStatus === "ok" ? "ran" : rawStatus === "error" ? "raised" : "not_run";
          const rawCheck = asNullableString(cell.check);
          const check = rawCheck === "pass" || rawCheck === "fail" || rawCheck === "inconclusive" ? rawCheck : null;
          cellResults.set(id, { status, ename: asNullableString(cell.ename), evalue: asNullableString(cell.evalue), check });
        }
        break;
      }
      case "notebook.repair": {
        const status = asString(event.status);
        const entry: LiveRepairEntry = {
          cellId: asString(event.cell_id),
          status: status === "finished" || status === "failed" ? status : "started",
          error: asNullableString(event.error),
          attempt: asNumber(event.attempt, repairs.length + 1),
          of: asNumber(event.of, 1),
          beforeRunning: event.before_running === true,
          source: asNullableString(event.source),
        };
        repairs.push(entry);
        if (entry.status === "started") {
          repairInFlight = true;
          phase = entry.beforeRunning ? "checking" : "repairing";
        } else {
          repairInFlight = false;
          if (entry.status === "finished" && entry.source !== null) {
            repairedSources.set(entry.cellId, entry.source);
          }
        }
        break;
      }
      case "run.error": {
        phase = "failed";
        break;
      }
      case "run.finished": {
        phase = event.status === "succeeded" ? "done" : "failed";
        break;
      }
      default:
        break;
    }
  }

  const baseCells: LiveCellView[] =
    parsedMatchesCurrentDraft && parsedCells !== null ? parsedCells : parseCellsIncrementally(draftText);

  const cells = baseCells.map((cell) => {
    const result = cellResults.get(cell.id);
    const repairedSource = repairedSources.get(cell.id);
    return {
      ...cell,
      source: repairedSource ?? cell.source,
      status: result?.status ?? cell.status,
      ename: result?.ename ?? cell.ename,
      evalue: result?.evalue ?? cell.evalue,
      check: result?.check ?? cell.check,
    };
  });

  const lastRepair = repairs[repairs.length - 1] ?? null;
  const currentRepair = lastRepair && lastRepair.status === "started" ? lastRepair : null;

  if (events.length === 0) return INITIAL_STATE;
  return { phase, draftText, cells, repairs, currentRepair };
}
