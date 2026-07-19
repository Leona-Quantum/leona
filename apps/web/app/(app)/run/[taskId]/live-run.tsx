"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { RunEvent } from "@majorana/ui";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { archiveChat, deleteChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { RunComposer } from "../../../../components/run-composer";
import { RUN_FIXTURES } from "./fixtures";

type WireEvent = {
  run_id: string;
  seq?: number;
  type: string;
  kind?: "reasoning" | "output";
  text?: string;
  message?: string;
  status?: string;
  verifier_decision?: string | null;
  interpretation?: string;
  revision?: number;
  exit_code?: number;
  method?: string;
  result?: string;
  details?: Record<string, unknown>;
  artifact_id?: string;
  plan?: { problem_summary?: string };
  candidates_considered?: number;
  failed_checks?: string[];
  critic_summary?: string | null;
  code?: string;
};

const VERIFICATION_METHOD_LABEL: Record<string, string> = {
  return_contract: "Checked the return contract",
  statistical: "Cross-checked the measured distribution",
  exact: "Compared the circuit against a reference",
  statistical_reproducibility: "Re-ran the circuit and compared",
  resource_contract: "Checked qubit/resource usage",
  measurement_policy: "Checked measurement coverage",
  success_criteria: "Checked the success threshold",
  structural: "Checked circuit structure",
  native_optimization_evidence: "Checked native optimization",
};

function processStepLabel(event: WireEvent): string | null {
  switch (event.type) {
    case "plan.produced":
      return event.plan?.problem_summary ? `Planned approach: ${event.plan.problem_summary}` : "Planned an approach";
    case "code.generated":
      return `Wrote candidate circuit${event.revision ? ` (revision ${event.revision})` : ""}`;
    case "sandbox.result":
      return event.exit_code === 0 ? "Ran the circuit in the sandbox" : "Circuit failed in the sandbox — repairing";
    case "verification.result": {
      const label = (event.method && VERIFICATION_METHOD_LABEL[event.method]) || `Verification (${event.method ?? "?"})`;
      return `${label}: ${event.result ?? "?"}`;
    }
    case "code.finalized":
      return "Finalized the verified circuit";
    case "artifact.saved":
      return "Saved the verified circuit to your vault";
    case "run.best_effort":
      return `Kept the closest attempt (revision ${event.revision}) — unverified`;
    case "run.error":
      return event.message ? `Error: ${event.message}` : "Run error";
    default:
      return null;
  }
}

function processLogFromEvents(events: WireEvent[]): string[] {
  return events.map(processStepLabel).filter((label): label is string => Boolean(label));
}

function processNarrative(events: WireEvent[], recentOnly = false): string {
  const steps = processLogFromEvents(events);
  return (recentOnly ? steps.slice(-2) : steps).join(". ");
}

function resultSummaryFromEvents(events: WireEvent[]): string | null {
  const successCheck = [...events]
    .reverse()
    .find((event) => event.type === "verification.result" && event.method === "success_criteria");
  const metric = successCheck?.details?.metric;
  const value = successCheck?.details?.value;
  if (typeof metric === "string" && typeof value === "number") {
    return `${metric.replaceAll("_", " ")} ≈ ${value.toFixed(4)}`;
  }
  return null;
}

function artifactIdFromEvents(events: WireEvent[]): string | null {
  const saved = [...events].reverse().find((event) => event.type === "artifact.saved");
  return saved?.artifact_id ?? null;
}

function planSummaryFromEvents(events: WireEvent[]): string | null {
  const produced = events.find((event) => event.type === "plan.produced");
  return produced?.plan?.problem_summary ?? null;
}

type ConversationPayload = {
  id: string;
  turns: Array<{
    run: { id: string; task_prompt: string; conversation_id: string };
    events: WireEvent[];
  }>;
};

type Turn = {
  id: string;
  prompt: string;
  answer: string | null;
  events: WireEvent[];
};

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

function answerFromEvents(events: WireEvent[]): string | null {
  const completed = [...events].reverse().find((event) => event.type === "chat.completed" && event.text);
  if (completed?.text) return completed.text;
  const legacy = [...events].reverse().find((event) => event.type === "run.analysis" && event.interpretation);
  if (legacy?.interpretation) return legacy.interpretation;
  // Circuit-execution runs (mode=execute) never emit chat.completed/run.analysis —
  // their "answer" is a verified artifact. Without this fallback the turn never
  // gets marked answered, so `pending` flips back to true after every reload and
  // the UI is stuck on "Live" forever even though the run finished.
  const finished = [...events].reverse().find((event) => event.type === "run.finished");
  if (!finished) return null;
  if (finished.status !== "succeeded") {
    // A failed execute run used to end here, and this line was the entire answer —
    // even when the loop had written four candidates and simply run out of budget.
    // If one of them survives as best-effort evidence, say so and say what is wrong
    // with it, without ever calling it verified.
    const best = [...events].reverse().find((event) => event.type === "run.best_effort");
    if (best) {
      const blocker = best.critic_summary ?? best.failed_checks?.[0] ?? null;
      // The code has to travel inside the answer text: this surface renders one
      // markdown body and an artifact link, and an unverified candidate must never
      // become an artifact. A fenced block is the only way it reaches the user here.
      return [
        `The run did not finish verification, but it got close. Revision ${best.revision} of ${best.candidates_considered} got the furthest — **unverified, and not saved to your Vault.**`,
        blocker ? `\nWhat stopped it: ${blocker}` : "",
        best.failed_checks?.length ? `\n\nFailing checks: ${best.failed_checks.join(", ")}.` : "",
        best.code ? `\n\n\`\`\`python\n${best.code}\n\`\`\`` : "",
        "\n\nTreat this as a starting point, not a result.",
      ].join("");
    }
    return "The run did not complete successfully. Check the run's events for details.";
  }
  const saved = events.some((event) => event.type === "artifact.saved");
  const problem = planSummaryFromEvents(events);
  const metric = resultSummaryFromEvents(events);
  const opening = problem ?? `Verified (${finished.verifier_decision ?? "pass"})`;
  const sentences = [opening.endsWith(".") ? opening : `${opening}.`];
  if (metric) sentences.push(`Result: ${metric}.`);
  sentences.push(saved ? "Saved to your vault." : "No artifact was saved.");
  return sentences.join(" ");
}

function turnsFromConversation(payload: ConversationPayload): Turn[] {
  return payload.turns.map((turn) => ({
    id: turn.run.id,
    prompt: turn.run.task_prompt,
    answer: answerFromEvents(turn.events),
    events: turn.events,
  }));
}

function fixtureTurns(events: RunEvent[]): Turn[] {
  const queued = events.find((event) => event.type === "run.queued");
  const answer = events.find((event) => event.type === "run.analysis");
  return [{
    id: queued?.run_id ?? "example",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and verify the cut value.",
    answer: answer?.type === "run.analysis" ? answer.interpretation : "This is an example run transcript.",
    events: [],
  }];
}

export function LiveRun({ taskId }: { taskId: string }) {
  const router = useRouter();
  const fixtureEvents = RUN_FIXTURES[taskId] ?? null;
  const [turns, setTurns] = useState<Turn[]>(fixtureEvents ? fixtureTurns(fixtureEvents) : []);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streaming, setStreaming] = useState(!fixtureEvents);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [liveEvents, setLiveEvents] = useState<WireEvent[]>([]);
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [existingChat, setExistingChat] = useState<ChatSummary | null>(null);
  const lastEventId = useRef<number | null>(null);
  const loadSeq = useRef(0);

  useEffect(() => {
    setExistingChat(
      loadChatHistory({ includeArchived: true }).find(
        (item) => item.id === taskId || item.conversationId === conversationId,
      ) ?? null,
    );
  }, [conversationId, taskId]);

  const title = existingChat?.title ?? turns[0]?.prompt ?? "Quantum chat";

  useEffect(() => {
    if (fixtureEvents) return;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    setLiveEvents([]);
    setStreamingText("");
    setReasoningText("");
    setError(null);
    lastEventId.current = null;

    async function loadConversation() {
      const seq = ++loadSeq.current;
      const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/conversation`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Conversation could not be loaded (${response.status})`);
      const payload = (await response.json()) as ConversationPayload;
      // Discard the response if a newer loadConversation() call has started since
      // (e.g. the terminal reload racing the initial one) so a stale response can't
      // overwrite fresher turns/pending state.
      if (!controller.signal.aborted && seq === loadSeq.current) {
        setConversationId(payload.id);
        setTurns(turnsFromConversation(payload));
        setPending(payload.turns.some((turn) => turn.run.id === taskId && !answerFromEvents(turn.events)));
      }
    }

    async function consume() {
      void loadConversation().catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Conversation could not be loaded");
      });

      while (!controller.signal.aborted) {
        try {
          const headers: Record<string, string> = {};
          if (lastEventId.current !== null) headers["Last-Event-ID"] = String(lastEventId.current);
          const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/events/stream`, {
            headers,
            cache: "no-store",
            signal: controller.signal,
          });
          if (!response.ok) throw new Error(`Response stream failed (${response.status})`);
          if (!response.body) throw new Error("Response stream returned no body");

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
              const event = JSON.parse(parsed.data) as WireEvent;
              if (parsed.id !== null) lastEventId.current = parsed.id;
              setLiveEvents((current) => [...current, event]);
              if (event.type === "chat.delta" && event.text) {
                setStreaming(true);
                if (event.kind === "reasoning") setReasoningText((current) => `${current}${event.text}`);
                else setStreamingText((current) => `${current}${event.text}`);
              }
              if (event.type === "chat.completed" && event.text) {
                setStreamingText(event.text);
                setStreaming(false);
              }
              if (event.type === "chat.error" || event.type === "run.error") {
                setError(event.message ?? "The assistant could not complete this response.");
                setStreaming(false);
                setPending(false);
              }
              if (event.type === "run.finished") {
                terminal = true;
                setPending(false);
                setStreaming(false);
                updateChat(taskId, { status: event.status === "succeeded" ? "draft" : "failed" });
                void loadConversation().catch((cause) => {
                  if (!controller.signal.aborted) {
                    setError(cause instanceof Error ? cause.message : "Conversation could not be reloaded");
                  }
                });
              }
            }
          }
          if (terminal) return;
          throw new Error("Response stream ended before the response finished");
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Response stream failed");
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

  function addFiles(files: File[]) {
    void (async () => {
      const candidates: Array<{ name: string; size: number; content: string }> = [];
      const errors: string[] = [];
      for (const file of files) {
        const lowered = file.name.toLowerCase();
        if (![".py", ".txt", ".md", ".json", ".qasm", ".csv"].some((extension) => lowered.endsWith(extension))) {
          errors.push(`${file.name} is not a supported text attachment (.py, .txt, .md, .json, .qasm, .csv).`);
          continue;
        }
        if (file.size > 64 * 1024) {
          errors.push(`${file.name} is larger than 64 KB — paste the relevant part instead.`);
          continue;
        }
        try {
          candidates.push({ name: file.name, size: file.size, content: await file.text() });
        } catch {
          errors.push(`${file.name} could not be read.`);
        }
      }
      const nextByName = new Map(attachments.map((item) => [item.name, item]));
      for (const candidate of candidates) {
        if (!nextByName.has(candidate.name) && nextByName.size >= 4) {
          errors.push("Up to 4 attachments per message.");
          continue;
        }
        nextByName.set(candidate.name, candidate);
      }
      setAttachments([...nextByName.values()]);
      setError([...new Set(errors)].join(" ") || null);
    })();
  }

  async function submitFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    setPending(true);
    setError(null);
    const attachmentBlocks = attachments.map((attachment) => `\n\n--- Attachment: ${attachment.name} ---\n${attachment.content}`).join("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ task_prompt: `${taskPrompt}${attachmentBlocks}`, conversation_id: conversationId }),
      });
      const payload = (await response.json()) as { id?: string; conversation_id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) throw new Error(payload.detail ?? payload.error ?? `Message submission failed (${response.status})`);
      rememberChat({
        id: payload.id,
        conversationId: payload.conversation_id ?? conversationId ?? undefined,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
      });
      router.push(`/run/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message submission failed");
      setPending(false);
    }
  }

  const activePrompt = turns.find((turn) => turn.id === taskId)?.prompt ?? existingChat?.prompt;
  const showActiveUser = Boolean(activePrompt && !turns.some((turn) => turn.id === taskId));

  return (
    <div className="mj-run-task">
      <div className="mj-run-task-scroll">
        <div className="mj-chat-content">
          <header className="mj-chat-header">
            <div>
              <h1>{title}</h1>
              <span className="mj-chat-subtitle">{fixtureEvents ? "Example conversation" : streaming || pending ? "Streaming response" : "Conversation"}</span>
            </div>
            <div className="mj-run-task-actions">
              <span className="mj-run-home-status">
                <span className="mj-status-dot" aria-hidden="true" />
                {fixtureEvents ? "Example" : streaming || pending ? "Live" : "Ready"}
              </span>
              {!fixtureEvents && existingChat ? (
                <>
                  <button className="mj-secondary-button" type="button" onClick={() => { archiveChat(existingChat.id, existingChat); router.push("/run"); }}>Archive</button>
                  <button className="mj-secondary-button mj-danger-button" type="button" onClick={() => { deleteChat(existingChat.id); router.push("/run"); }}>Delete</button>
                </>
              ) : null}
            </div>
          </header>
          {error ? <p className="mj-run-stream-error" role="status">{error}</p> : null}
          <div className="mj-chat-thread" aria-live="polite">
            {turns.map((turn) => (
              <div className="mj-chat-turn" key={turn.id}>
                <div className="mj-chat-message mj-chat-message--user">
                  <ChatMarkdown source={turn.prompt} />
                </div>
                {turn.answer ? (
                  <div className="mj-chat-message mj-chat-message--assistant">
                    <ChatMarkdown source={turn.answer} />
                    <ArtifactLink events={turn.events} />
                  </div>
                ) : turn.id === taskId && (streamingText || reasoningText || liveEvents.length > 0) ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} />
                ) : turn.id === taskId && pending ? (
                  <AssistantLoading />
                ) : null}
              </div>
            ))}
            {showActiveUser ? (
              <div className="mj-chat-turn">
                <div className="mj-chat-message mj-chat-message--user"><ChatMarkdown source={activePrompt ?? ""} /></div>
                {streamingText || reasoningText || liveEvents.length > 0 ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} />
                ) : pending ? <AssistantLoading /> : null}
              </div>
            ) : null}
            {!turns.length && !activePrompt && !pending ? <p className="mj-run-waiting">Connecting to the conversation…</p> : null}
          </div>
        </div>
      </div>
      <RunComposer
        value={prompt}
        pending={pending}
        error={null}
        onChange={setPrompt}
        onSubmit={submitFollowup}
        onFiles={addFiles}
        attachments={attachments.map(({ name, size }) => ({ name, size }))}
        onRemoveAttachment={(name) => setAttachments((current) => current.filter((item) => item.name !== name))}
      />
    </div>
  );
}

function AssistantMessage({
  reasoning,
  text,
  streaming,
  events,
}: {
  reasoning: string;
  text: string;
  streaming: boolean;
  events: WireEvent[];
}) {
  const narrative = processNarrative(events);
  return (
    <div className="mj-chat-message mj-chat-message--assistant">
      {narrative ? <ProcessNarrative events={events} /> : null}
      {reasoning ? (
        <details className="mj-chat-thinking" open={streaming}>
          <summary>Thinking</summary>
          <ChatMarkdown source={reasoning} />
        </details>
      ) : null}
      {text ? (
        <ChatMarkdown source={text} />
      ) : narrative ? null : (
        <span className="mj-chat-message--loading">
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
        </span>
      )}
      <ArtifactLink events={events} />
    </div>
  );
}

function ProcessNarrative({ events }: { events: WireEvent[] }) {
  const narrative = processNarrative(events, true);
  if (!narrative) return null;
  return (
    <p className="mj-run-process-text" key={narrative}>
      {narrative}
    </p>
  );
}

function ArtifactLink({ events }: { events: WireEvent[] }) {
  const artifactId = artifactIdFromEvents(events);
  if (!artifactId) return null;
  return (
    <Link className="mj-secondary-button" href={`/library/${artifactId}`}>
      View in Vault →
    </Link>
  );
}

function AssistantLoading() {
  return (
    <div className="mj-chat-message mj-chat-message--assistant mj-chat-message--loading" aria-label="Waiting for response">
      <span className="mj-chat-loading-dot" />
      <span className="mj-chat-loading-dot" />
      <span className="mj-chat-loading-dot" />
    </div>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
