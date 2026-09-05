/**
 * How a followed run's event stream ENDED, and what the notebook workspace may
 * conclude from it.
 *
 * `useRunProgress` used to report only the happy path: it invoked its callback
 * on `run.finished` / `run.error` and returned silently on every other exit — a
 * non-OK response, a socket closed mid-run, a proxy idle timeout. Silence there
 * is indistinguishable from "still running", so every caller kept the state it
 * had set up for the run and waited for an event that was never coming.
 *
 * Two things that costs, both silent:
 *
 * - The editor records the version a save authored and pins it once that run is
 *   over. A lost stream leaves the record pending, and the NEXT run to end —
 *   a chat turn, a rerun — consumes it and pins a version belonging to a
 *   different run. The reader is shown a stale notebook and nothing says so.
 *   (The same thing happens with a perfectly healthy stream if the reader
 *   starts a second run while the first is in flight: switching `runId` aborts
 *   the first reader, so its terminal event never arrives either. That is why
 *   the pending pin is keyed to its own run below rather than merely cleared.)
 * - The courses workspace clears `planRunActive` in the same callback, and that
 *   flag gates the "send" control. A lost plan-run stream disables the reader's
 *   chat box for the rest of the session.
 *
 * So the stream says which way it ended, and the decision each caller makes
 * from that lives here as a function rather than inline in a component, where
 * it could not be tested.
 */

/** `terminal` — the run reported `run.finished` or `run.error`. `lost` — the
 * stream ended, refused or broke without ever saying so. A stream WE closed
 * (unmount, or the followed run changing) is neither and is not reported. */
export type RunStreamOutcome = "terminal" | "lost";

/** The version an in-flight editor save authored, and the run that is writing
 * it. Keyed to the run so a pending pin can only ever be applied by the run
 * that created it. */
export interface AuthoredVersion {
  runId: string;
  seq: number;
}

export interface AuthoredPinDecision {
  /** Version to select, or `null` to leave the picker where it is. */
  pin: number | null;
  /** Whether the pending authored version is now spent and must be dropped. */
  clear: boolean;
  /** Whether to tell the reader the live connection dropped. */
  warn: boolean;
}

export function authoredPinAfterRun(
  authored: AuthoredVersion | null,
  endedRunId: string | null,
  outcome: RunStreamOutcome,
): AuthoredPinDecision {
  const warn = outcome === "lost";
  if (!authored) return { pin: null, clear: false, warn };

  // A different run ended. The authored run's reader was therefore torn down
  // when the followed id changed, so its terminal event will never arrive and
  // the pending pin is dead state — drop it. Applying it here instead is the
  // exact bug this module exists to prevent: it would pin the save's version
  // on the strength of some unrelated run finishing.
  if (authored.runId !== endedRunId) return { pin: null, clear: true, warn };

  // Ours, and it ended properly: show the reader what they wrote, whether the
  // run succeeded or failed. Following `current_version_seq` instead would show
  // them the PREVIOUS version on a failure, hiding it.
  if (outcome === "terminal") return { pin: authored.seq, clear: true, warn: false };

  // Ours, but lost. The version exists — the POST returned it — yet whether its
  // run has finished is precisely what we no longer know, and a still-queued
  // version has no spec to render. So do not select it, and do clear it: being
  // shown a stale version is silent, whereas not moving the picker is merely
  // stale, and the warning says so out loud.
  return { pin: null, clear: true, warn: true };
}
