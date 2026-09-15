/**
 * A pure reducer over a "revise the open circuit" run's events — what the
 * Ask Leona box needs to show while it follows one inline: which stages have
 * been reached, whether it has finished (and how), and the id of the
 * artifact it saved, if any.
 *
 * Deliberately narrower than the run page's own `WireEvent`: this box shows
 * a short stage checklist, not a full chat transcript, so it only reads the
 * handful of fields those stages and a terminal outcome need. The event
 * objects themselves come from the same wire protocol (decode `parseSseBlock`
 * output with `JSON.parse` and pass the array here) — this file owns no
 * network or stream-reading code, only the reduction.
 */

export type ReviseStageKey = "planned" | "coded" | "sandboxed" | "verified" | "saved";

export const REVISE_STAGE_EVENT_TYPE: Record<ReviseStageKey, string> = {
  planned: "plan.produced",
  coded: "code.generated",
  sandboxed: "sandbox.result",
  verified: "verification.semantic_review",
  saved: "artifact.saved",
};

export const REVISE_STAGE_ORDER: ReviseStageKey[] = ["planned", "coded", "sandboxed", "verified", "saved"];

export interface ReviseWireEvent {
  type: string;
  artifact_id?: string;
  status?: string;
  message?: string;
}

export type ReviseFollowStatus = "running" | "succeeded" | "failed" | "disconnected";

export interface ReviseFollowState {
  status: ReviseFollowStatus;
  /** Stages reached so far, in `REVISE_STAGE_ORDER`. */
  reachedStages: ReviseStageKey[];
  /** The artifact `artifact.saved` reported, or null before it arrives. */
  artifactId: string | null;
  /** Set once the run is known to have failed; null while running, disconnected, or on success. */
  errorMessage: string | null;
}

/**
 * @param streamEnded The SSE stream itself is over (`reader.read()` returned
 *   `done`, or the fetch/read threw) — distinct from "no run.finished yet
 *   because the run is still going". Only changes the outcome when nothing
 *   terminal (`run.finished`, `chat.error`, `run.error`) was ever seen: a
 *   dropped connection, a platform request timeout on a long run, or a proxy
 *   closing an idle stream all end the stream without telling this box
 *   anything about the run itself, which the run may still finish on the
 *   server after — "disconnected", not "failed".
 */
export function reviseFollowState(events: readonly ReviseWireEvent[], streamEnded = false): ReviseFollowState {
  const reachedStages = REVISE_STAGE_ORDER.filter((stage) =>
    events.some((event) => event.type === REVISE_STAGE_EVENT_TYPE[stage]));

  const saved = [...events].reverse().find((event) => event.type === "artifact.saved");
  const artifactId = saved?.artifact_id ?? null;

  const errorEvent = [...events].reverse().find((event) => event.type === "chat.error" || event.type === "run.error");
  const finished = [...events].reverse().find((event) => event.type === "run.finished");

  const errorMessage = errorEvent?.message
    ?? (finished && finished.status !== "succeeded" ? finished.message ?? null : null);

  const status: ReviseFollowStatus = finished
    ? (finished.status === "succeeded" && !errorEvent ? "succeeded" : "failed")
    : errorEvent
      ? "failed"
      : streamEnded
        ? "disconnected"
        : "running";

  return { status, reachedStages, artifactId, errorMessage: status === "failed" ? errorMessage ?? null : null };
}
