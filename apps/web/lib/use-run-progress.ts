"use client";

/**
 * Follow a `Run`'s SSE event stream, reset on every new run id.
 *
 * Extracted out of `notebook-workspace.tsx` (which had this inline) so the
 * courses workspace — which follows a plan run AND, independently, a run per
 * module being generated — can reuse the exact same reconnect-free reader
 * rather than a second copy that could drift from it. Call this hook once per
 * run you want to follow: the notebook workspace calls it once for
 * `followedRunId`; the course workspace calls it once for the plan run and
 * once per module card that has a run in flight (a component calling a hook
 * in a loop across separate elements is the ordinary React way to do "N
 * independent live subscriptions", not a violation of the rules-of-hooks,
 * since each call site is its own component instance).
 *
 * Not exported from `@majorana/ui`: that package is server-agnostic vendored
 * UI with no notion of this app's `/api/runs/:id/events/stream` route, and
 * every other run-following reader in this app (`live-run.tsx`) already lives
 * in `apps/web`.
 */
import { useEffect, useRef, useState } from "react";

import type { RunStreamOutcome } from "./run-stream-outcome";

/** The one shape this reader needs off the stream. See `lib/notebook-progress.ts`
 * for why the reducer built from these events stays generic rather than naming
 * a pipeline's own stage ids. */
export interface RunProgressEvent {
  type: string;
  stage?: string | null;
  status?: string;
  duration_ms?: number;
}

function parseSseBlock(block: string): { id: string | null; data: string } | null {
  const lines = block.split("\n");
  if (lines.some((line) => line.startsWith(":"))) return null;
  const idLine = lines.find((line) => line.startsWith("id:"));
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  return { id: idLine ? idLine.slice("id:".length).trim() : null, data };
}

/**
 * `onTerminal` fires **exactly once per stream**, with how that stream ended:
 * `"terminal"` when the run reported `run.finished` or `run.error`, `"lost"`
 * when the stream refused, broke or ran out without ever saying so. Callers use
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
 * Reporting the lost case at all is the point. Returning silently there is
 * indistinguishable from "still running", so callers held state open forever:
 * the editor's pending version pin outlived its run and was applied by the next
 * one, and the courses rail left `planRunActive` true, which disables the send
 * control. See `lib/run-stream-outcome.ts` for both, and for the decision the
 * notebook workspace makes from the outcome.
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

    // Once per stream, and never for a close we asked for. `reported` also
    // covers the ordinary path where the loop reaches its "ran out" exit after
    // a terminal event has already been announced.
    let reported = false;
    function report(outcome: RunStreamOutcome) {
      if (reported || controller.signal.aborted) return;
      reported = true;
      onTerminalRef.current?.(outcome, runId as string);
    }

    async function consume() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId as string)}/events/stream`, {
          cache: "no-store",
          signal: controller.signal,
        });
        // A refused or bodiless response is a lost stream, not a quiet no-op:
        // the run carries on server-side and the caller must stop waiting on it.
        if (!response.ok || !response.body) {
          report("lost");
          return;
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let terminal = false;
        while (!terminal) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replaceAll("\r\n", "\n");
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const block of blocks) {
            const parsed = parseSseBlock(block);
            if (!parsed) continue;
            const event = JSON.parse(parsed.data) as RunProgressEvent;
            setEvents((current) => [...current, event]);
            if (event.type === "run.finished" || event.type === "run.error") {
              terminal = true;
              report("terminal");
            }
          }
        }
        // Out of stream without a terminal event — a no-op if one already
        // arrived, and the whole point of this call if one never did.
        report("lost");
      } catch {
        // A dropped connection stops the live activity list from updating. The
        // run itself is unaffected and a refresh picks up its finished state,
        // but the caller cannot be left waiting on an event that is no longer
        // coming, so say the stream was lost rather than nothing at all.
        report("lost");
      }
    }

    void consume();
    return () => controller.abort();
  }, [runId]);

  return events;
}
