"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RunView, type RunEvent } from "@majorana/ui";
import { loadChatHistory, rememberChat, updateChat } from "../../../../lib/chat-history";
import { rememberArtifactFromRun } from "../../../../lib/library-data";
import { RunComposer, type ComposerFramework, type ComposerMode } from "../../../../components/run-composer";
import { RUN_FIXTURES } from "./fixtures";

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
  const router = useRouter();
  const fixtureEvents = RUN_FIXTURES[taskId] ?? null;
  const [events, setEvents] = useState<RunEvent[]>(fixtureEvents ?? []);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ComposerMode>("execute");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const [pending, setPending] = useState(false);
  const lastEventId = useRef<number | null>(null);

  useEffect(() => {
    if (fixtureEvents) {
      setEvents(fixtureEvents);
      setError(null);
      return;
    }

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    async function consume() {
      while (!controller.signal.aborted) {
        try {
          const headers: Record<string, string> = {};
          if (lastEventId.current !== null) headers["Last-Event-ID"] = String(lastEventId.current);
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
  }, [fixtureEvents, taskId]);

  useEffect(() => {
    const finished = [...events].reverse().find((event) => event.type === "run.finished");
    if (!finished || finished.type !== "run.finished") return;
    const status = finished.verifier_decision === "pass" ? "verified" : "failed";
    updateChat(taskId, { status });
    const chat = loadChatHistory().find((item) => item.id === taskId);
    if (chat) rememberArtifactFromRun(events, chat.prompt);
  }, [events, taskId]);

  async function submitFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ task_prompt: taskPrompt, mode, framework }),
      });
      const payload = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
      }
      rememberChat({
        id: payload.id,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
        framework: frameworkLabel(framework),
      });
      router.push(`/run/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run submission failed");
      setPending(false);
    }
  }

  return (
    <div className="mj-run-task">
      <div className="mj-run-task-scroll">
        <div className="mj-run-task-content">
          <header className="mj-run-task-header">
            <div>
              <h1>{fixtureEvents ? "MaxCut on a 5-node ring" : "Run in progress"}</h1>
              <span className="mj-run-task-id">{taskId}</span>
            </div>
            <span className="mj-run-home-status">
              <span className="mj-status-dot" aria-hidden="true" />
              {fixtureEvents ? "Example run" : "Live event stream"}
            </span>
          </header>
          {error ? <p className="mj-run-stream-error" role="status">{error}; reconnecting</p> : null}
          <div className="mj-run-task-canvas">
            <RunView events={events} emptyMessage="Connecting to the pipeline…" animateText={!fixtureEvents} />
          </div>
        </div>
      </div>
      <RunComposer
        value={prompt}
        mode={mode}
        framework={framework}
        pending={pending}
        error={null}
        onChange={setPrompt}
        onModeChange={setMode}
        onFrameworkChange={setFramework}
        onSubmit={submitFollowup}
        onAttach={() => setError("Attachments are not enabled yet; paste code or context into the prompt.")}
      />
    </div>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}

function frameworkLabel(framework: ComposerFramework): string {
  return framework === "pennylane" ? "PennyLane" : framework === "cirq" ? "Cirq" : "Qiskit";
}
