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
 * `onTerminal` fires once, when the stream reports `run.finished` or
 * `run.error` — callers use it to reload whatever the run just changed
 * (the notebook + its versions + turns; a course + its modules).
 *
 * Read through a ref rather than listed as an effect dependency: the reader
 * that opens the stream should not restart just because the caller re-created
 * its callback closure on some unrelated re-render, and the ref means the
 * effect's only real dependency — `runId` — is also its only listed one, so
 * there is nothing here for `react-hooks/exhaustive-deps` to litigate.
 */
export function useRunProgress(runId: string | null, onTerminal?: () => void): RunProgressEvent[] {
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

    async function consume() {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId as string)}/events/stream`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok || !response.body) return;
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
              onTerminalRef.current?.();
            }
          }
        }
      } catch {
        // A dropped connection here just stops the live activity list from
        // updating; the run itself is unaffected, and the next poll of this
        // page (or a manual refresh) picks up the finished state.
      }
    }

    void consume();
    return () => controller.abort();
  }, [runId]);

  return events;
}
