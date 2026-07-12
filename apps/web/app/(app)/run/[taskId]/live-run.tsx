"use client";

import { useEffect, useRef, useState } from "react";
import { RunView, type RunEvent } from "@majorana/ui";

function parseEvent(block: string): { id: number | null; data: string } | null {
  const lines = block.split("\n");
  if (lines.some((line) => line.startsWith(":"))) return null;
  const idLine = lines.find((line) => line.startsWith("id:"));
  const data = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  const parsedId = idLine ? Number(idLine.slice("id:".length).trim()) : NaN;
  return { id: Number.isFinite(parsedId) ? parsedId : null, data };
}

export function LiveRun({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastEventId = useRef<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function consume() {
      while (!controller.signal.aborted) {
        try {
          const headers: Record<string, string> = {};
          if (lastEventId.current !== null) {
            headers["Last-Event-ID"] = String(lastEventId.current);
          }
          const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/events/stream`, {
            headers,
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Event stream failed (${response.status})`);
          if (!response.body) throw new Error("Event stream returned no body");

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
              const parsed = parseEvent(block);
              if (!parsed) continue;
              const event = JSON.parse(parsed.data) as RunEvent;
              if (parsed.id !== null) lastEventId.current = parsed.id;
              setEvents((current) => {
                if (current.some((item) => item.seq === event.seq)) return current;
                return [...current, event].sort((a, b) => a.seq - b.seq);
              });
              if (event.type === "run.finished") terminal = true;
            }
          }
          if (terminal) return;
          throw new Error("Event stream ended before the run finished");
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Event stream failed");
          await new Promise<void>((resolve) => {
            reconnectTimer = setTimeout(resolve, 1000);
          });
          setError(null);
        }
      }
    }

    void consume();
    return () => {
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [taskId]);

  return (
    <>
      {error ? (
        <p role="status" style={{ color: "var(--warn)", fontSize: "var(--fs-12)" }}>
          {error}; reconnecting
        </p>
      ) : null}
      <RunView events={events} emptyMessage="Connecting to the pipeline…" />
    </>
  );
}
