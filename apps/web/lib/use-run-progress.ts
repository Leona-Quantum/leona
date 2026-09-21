"use client";

/**
 * Follow a `Run`'s SSE event stream, reset on every new run id.
 *
 * Extracted out of `notebook-workspace.tsx` (which had this inline) so the
 * courses workspace — which follows a plan run AND, independently, a run per
 * module being generated — can reuse the exact same reader rather than a
 * second copy that could drift from it. Call this hook once per run you want
 * to follow: the notebook workspace calls it once for `followedRunId`; the
 * course workspace calls it once for the plan run and once per module card
 * that has a run in flight (a component calling a hook in a loop across
 * separate elements is the ordinary React way to do "N independent live
 * subscriptions", not a violation of the rules-of-hooks, since each call site
 * is its own component instance).
 *
 * Reconnects on a drop the same way the Run page's own reader does
 * (`app/(app)/run/[taskId]/live-run.tsx`) — capped exponential backoff,
 * forever, via the shared `lib/reconnecting-sse-stream.ts` engine — rather
 * than the single attempt this hook used to make. Before that engine existed,
 * one dropped connection here was reported as the stream being permanently
 * "lost": the notebook editor's pending version pin and the courses
 * workspace's `planRunActive` gate both stayed stuck on that verdict even
 * though the run itself was very likely still going. Now a drop just
 * reconnects, the way it already did on the Run page.
 *
 * Not exported from `@majorana/ui`: that package is server-agnostic vendored
 * UI with no notion of this app's `/api/runs/:id/events/stream` route, and
 * every other run-following reader in this app (`live-run.tsx`) already lives
 * in `apps/web`.
 */
import { useEffect, useRef, useState } from "react";

import { followReconnectingSseStream } from "./reconnecting-sse-stream";
import type { RunStreamOutcome } from "./run-stream-outcome";

/** The one shape this reader needs off the stream. See `lib/notebook-progress.ts`
 * for why the reducer built from these events stays generic rather than naming
 * a pipeline's own stage ids. */
export interface RunProgressEvent {
  type: string;
  stage?: string | null;
  status?: string;
  duration_ms?: number;
  /**
   * Everything else the event carried. A run event is serialized as its envelope
   * columns with `payload` spread over them (`routes/runs._event_json`), so a
   * consumer that needs a lane-specific field — `notebook.grades` carries the
   * verdicts — reads it here rather than by widening this shared type once per lane.
   * Unknown on purpose: it is server data, narrowed by whoever knows what they asked
   * for, and never trusted into the DOM by this module.
   */
  [key: string]: unknown;
}

/**
 * `onTerminal` fires **at most once per stream**, and today only ever with
 * `"terminal"` — the run reported `run.finished` or `run.error`. Callers use
 * it to reload whatever the run just changed (the notebook + its versions +
 * turns; a course + its modules) and to stop waiting. It is handed the run id
 * the stream belonged to, which is not always the one the caller currently has
 * in state: switching runs re-creates the callback closure before the previous
 * reader is torn down, so a caller comparing against its own state can read the
 * NEXT run's id for the run that actually ended.
 *
 * It does NOT fire when *we* closed the stream — an unmount, or `runId`
 * changing — because that is not an outcome the caller should react to; the
 * caller is the one who caused it.
 *
 * `RunStreamOutcome`'s other value, `"lost"`, used to fire here on the FIRST
 * dropped connection — a refused response, a broken socket, a proxy idle
 * timeout — treating one hiccup as the stream being gone for good. Silence
 * there really is indistinguishable from "still running", so callers held
 * state open forever: the editor's pending version pin outlived its run and
 * was applied by the next one, and the courses rail left `planRunActive`
 * true, which disables the send control (see `lib/run-stream-outcome.ts` for
 * both). That silence bug is real, but declaring the stream "lost" after
 * exactly one attempt was the wrong fix for it — it just moved the same
 * problem one step earlier, onto a drop that usually recovers on its own. The
 * Run page's own reader (`app/(app)/run/[taskId]/live-run.tsx`) never gave up
 * like that; it reconnects with capped exponential backoff until the stream
 * either reaches a terminal event or the caller closes it. This hook now does
 * the same, via `lib/reconnecting-sse-stream.ts`, so a drop is retried rather
 * than reported. `"lost"` now fires only when the server answers with a
 * status no retry can change (401, 403, 404, 410 — see
 * `PERMANENT_STREAM_STATUSES`), which is the case where holding state open
 * forever really would be wrong.
 *
 * Read through a ref rather than listed as an effect dependency: the reader
 * that opens the stream should not restart just because the caller re-created
 * its callback closure on some unrelated re-render, and the ref means the
 * effect's only real dependency — `runId` — is also its only listed one, so
 * there is nothing here for `react-hooks/exhaustive-deps` to litigate.
 */
export function useRunProgress(
  runId: string | null,
  onTerminal?: (outcome: RunStreamOutcome, streamRunId: string) => void,
): RunProgressEvent[] {
  const [events, setEvents] = useState<RunProgressEvent[]>([]);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!runId) {
      setEvents([]);
      return;
    }
    const controller = new AbortController();
    setEvents([]);

    // Once per stream, and never for a close we asked for.
    let reported = false;
    function report(outcome: RunStreamOutcome) {
      if (reported || controller.signal.aborted) return;
      reported = true;
      onTerminalRef.current?.(outcome, runId as string);
    }

    // `Last-Event-ID`, so a reconnect after a drop does not replay events this
    // reader already appended to `events` — same header the Run page sends.
    let lastEventId: number | null = null;

    void followReconnectingSseStream({
      request: () => ({
        url: `/api/runs/${encodeURIComponent(runId as string)}/events/stream`,
        headers: lastEventId !== null ? { "Last-Event-ID": String(lastEventId) } : undefined,
      }),
      signal: controller.signal,
      onBlock: (block) => {
        if (block.id !== null) lastEventId = block.id;
        const event = JSON.parse(block.data) as RunProgressEvent;
        setEvents((current) => [...current, event]);
        if (event.type === "run.finished" || event.type === "run.error") {
          report("terminal");
          return true;
        }
        return false;
      },
      // No "reconnecting…" UI here (unlike the Run page's `connectionError`)
      // — a drop and its retry are invisible to the reader, the same way an
      // idle-timeout reconnect on the Run page itself is invisible until the
      // banner appears.
    }).then((outcome) => {
      // "terminal" was already reported by `onBlock`; "aborted" is a stream
      // this effect closed itself (unmount, or `runId` changing). "gone" is
      // the server saying no retry can help — signed out, not allowed, or no
      // such run — so the caller gets "lost" and its existing recovery (the
      // notebook editor clears cells stuck mid-grading and says so). A drop
      // is never reported this way: every drop is retried with the Run page's
      // own backoff.
      if (outcome === "gone") report("lost");
    });
    return () => controller.abort();
  }, [runId]);

  return events;
}
