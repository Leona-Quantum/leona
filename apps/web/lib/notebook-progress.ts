/**
 * Reduce a notebook generation/revision run's SSE event log into a compact
 * activity list for the chat rail — `StageRail`-shaped (`@majorana/ui`), not
 * the full `AgentActivity` model `lib/run-activity.ts` builds for `/run`.
 *
 * That richer reducer is keyed to Run's own fixed stage names (plan, generate,
 * screen, verify, compile, finalize…) and Notebooks does not share them — the
 * pipeline is outline -> draft -> compose/sandbox -> repair -> review (design
 * doc §3), a different worker job (`notebook.generate` / `notebook.revise`)
 * emitting its own `stage.started` / `stage.finished` events on the same `Run`
 * envelope. Rather than hardcode notebook stage ids that could drift from
 * whatever the worker actually emits, this reducer stays generic: it renders
 * whatever `stage` names arrive, in the order they were first seen. A run
 * with no stage events yet (still queued) yields an empty list, which the
 * caller renders as "waiting to start" rather than this module guessing.
 */

export interface NotebookProgressEvent {
  type: string;
  stage?: string | null;
  status?: string;
  duration_ms?: number;
}

export type NotebookProgressState = "pending" | "running" | "pass" | "fail";

export interface NotebookProgressStage {
  id: string;
  /** `elapsed` is formatted here (always with a unit) so no caller re-derives it. */
  elapsed?: string;
  state: NotebookProgressState;
}

function formatElapsed(durationMs: number | undefined): string | undefined {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return undefined;
  return durationMs < 1000 ? `${Math.round(durationMs)} ms` : `${(durationMs / 1000).toFixed(1)} s`;
}

export function notebookProgressFromEvents(
  events: readonly NotebookProgressEvent[],
): NotebookProgressStage[] {
  const order: string[] = [];
  const byStage = new Map<string, NotebookProgressStage>();
  let runFailed = false;

  for (const event of events) {
    if (event.type === "run.error") {
      runFailed = true;
      continue;
    }
    if (event.type === "run.finished") {
      if (event.status && event.status !== "succeeded") runFailed = true;
      continue;
    }
    const stage = event.stage;
    if (!stage) continue;
    if (event.type === "stage.started") {
      if (!byStage.has(stage)) order.push(stage);
      byStage.set(stage, { id: stage, state: "running" });
    } else if (event.type === "stage.finished") {
      if (!byStage.has(stage)) order.push(stage);
      byStage.set(stage, { id: stage, state: "pass", elapsed: formatElapsed(event.duration_ms) });
    }
  }

  const stages = order.map((id) => byStage.get(id)).filter((stage): stage is NotebookProgressStage => Boolean(stage));

  // A run that ended in error or a non-"succeeded" finish, with a stage still
  // open ("running", never got its own stage.finished), means that stage is
  // where things stopped — mark it failed rather than leave it reading as
  // still in progress after the stream itself has closed.
  if (runFailed) {
    const openIndex = stages.findIndex((stage) => stage.state === "running");
    if (openIndex >= 0) stages[openIndex] = { ...stages[openIndex], state: "fail" };
  }

  return stages;
}
