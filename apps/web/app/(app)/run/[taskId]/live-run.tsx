"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  RunOutcome,
  SyntaxHighlightedCode,
  type RunEvent,
} from "@majorana/ui";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { archiveChat, deleteChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { RunComposer } from "../../../../components/run-composer";
import { RUN_FIXTURES } from "./fixtures";
import { verificationSummaryFromValue, type VerificationSummary } from "../../../../lib/verification-record";
import { runOutcomeFromEvents } from "../../../../lib/run-outcome";
import { runResultFromEvents } from "../../../../lib/run-result";
import { RunResult } from "../../../../components/run-result";
import { runProgressFromEvents } from "../../../../lib/run-progress";

type WireEvent = {
  run_id: string;
  seq?: number;
  type: string;
  kind?: "reasoning" | "output";
  text?: string;
  message?: string;
  status?: string;
  mode?: string;
  stage?: string | null;
  verifier_decision?: string | null;
  evidence_strength?: string | null;
  interpretation?: string;
  decision?: string;
  reason_code?: string | null;
  revision?: number;
  exit_code?: number;
  duration_ms?: number;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  method?: string;
  result?: unknown;
  details?: Record<string, unknown>;
  lint_ok?: boolean;
  typecheck_ok?: boolean;
  diagnostics?: string[];
  accepted?: boolean;
  phase?: string;
  reason?: string;
  metrics?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  compatibility?: Record<string, unknown>;
  artifact_id?: string;
  plan?: {
    problem_summary?: string;
    domain?: string;
    algorithm?: string;
    algorithm_rationale?: string;
    framework?: string;
    qubits_estimate?: number;
    expected_runtime_sec?: number;
    expected_output_keys?: string[];
    parameters?: {
      shots?: number | null;
      seed?: number | null;
      [key: string]: unknown;
    };
    success_criteria?: { primary_metric?: string; expected_range?: Record<string, number> };
    [key: string]: unknown;
  };
  candidates_considered?: number;
  failed_checks?: string[];
  critic_summary?: string | null;
  code?: string;
  language?: string;
  verification_summary?: unknown;
  residual_risks?: string | string[] | null;
  stdout?: string;
  stderr?: string;
  unverified_claims?: string[];
  feedback?: {
    critic?: {
      summary?: string;
      severity?: string;
      confidence?: string;
      mismatches?: Array<string | { aspect?: string; expected?: string; actual?: string }>;
      suggestions?: string[];
      repair_instructions?: string[];
      residual_risks?: string[];
    };
  };
};

// Every method the verifier emits needs an entry; a miss falls through to the raw
// enum value. Six of these were dead labels until 2026-07-20 — the emitter dropped
// the checks before they reached the wire, so `resultSummaryFromEvents` below,
// which reads the `success_criteria` event for a run's headline number, had never
// once found one.
const VERIFICATION_METHOD_LABEL: Record<string, string> = {
  return_contract: "Checked the return contract",
  statistical: "Cross-checked the measured distribution",
  statistical_native: "Compared against a trusted re-run of the circuit",
  exact: "Compared the circuit against a reference",
  exact_diag: "Diagonalized the Hamiltonian and compared the energy",
  brute_force: "Solved the instance classically and compared the objective",
  statistical_reproducibility: "Re-ran the circuit and compared",
  resource_contract: "Checked qubit/resource usage",
  measurement_policy: "Checked measurement coverage",
  success_criteria: "Checked the success threshold",
  structural: "Checked circuit structure",
  native_optimization_evidence: "Checked native optimization",
};

function ReviewStage({ event }: { event: WireEvent }) {
  const critic = event.feedback?.critic;
  if (!critic?.summary) return null;
  const suggestions = critic.suggestions ?? critic.repair_instructions;
  return (
    <div className="mj-run-process-detail-text">
      <p>{critic.summary}</p>
      {critic.mismatches?.length ? (
        <ul>
          {critic.mismatches.map((mismatch, index) => (
            <li key={index}>
              {typeof mismatch === "string"
                ? mismatch
                : `${mismatch.aspect ?? "mismatch"}: expected ${mismatch.expected ?? "?"}, got ${mismatch.actual ?? "?"}`}
            </li>
          ))}
        </ul>
      ) : null}
      {suggestions?.length ? (
        <ul>
          {suggestions.map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      ) : null}
      {critic.residual_risks?.length ? (
        <ul>
          {critic.residual_risks.map((risk, index) => (
            <li key={index}>{risk}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function StrictVerificationStage({ event }: { event: WireEvent }) {
  if (!event.reason_code && !event.unverified_claims?.length) return null;
  return (
    <div className="mj-run-process-detail-text">
      {event.reason_code ? <p>{event.reason_code}</p> : null}
      {event.unverified_claims?.length ? (
        <ul>
          {event.unverified_claims.map((claim, index) => (
            <li key={index}>{claim}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function artifactIdFromEvents(events: WireEvent[]): string | null {
  const saved = [...events].reverse().find((event) => event.type === "artifact.saved");
  return saved?.artifact_id ?? null;
}

type ConversationPayload = {
  id: string;
  turns: Array<{
    run: { id: string; task_prompt: string; conversation_id: string; verification_summary?: unknown; finished_at?: string | null };
    events: WireEvent[];
  }>;
};

export type Turn = {
  id: string;
  prompt: string;
  answer: string | null;
  events: WireEvent[];
  verificationSummary: VerificationSummary | null;
  terminal: boolean;
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
  const circuitRun = events.some((event) =>
    [
      "plan.produced",
      "code.generated",
      "sandbox.result",
      "verification.semantic_review",
      "run.best_effort",
      "artifact.saved",
    ].includes(event.type),
  );
  if (circuitRun) return null;
  const legacy = [...events].reverse().find((event) => event.type === "run.analysis" && event.interpretation);
  if (legacy?.interpretation) return legacy.interpretation;
  const finished = [...events].reverse().find((event) => event.type === "run.finished");
  if (finished && finished.status !== "succeeded") {
    return "The run did not complete successfully. Check the run's events for details.";
  }
  return null;
}

function hasFinished(events: WireEvent[]): boolean {
  return events.some((event) => event.type === "run.finished");
}

function retainRunEvent(event: WireEvent): boolean {
  // Token deltas can number in the hundreds for one candidate. Their durable final
  // call/code events carry everything this surface renders, while retaining every
  // delta makes each SSE update re-project an ever-growing array. Chat text has its
  // own streaming state and final chat.completed event.
  return event.type !== "llm.delta" && event.type !== "chat.delta";
}

function turnsFromConversation(payload: ConversationPayload): Turn[] {
  return payload.turns.map((turn) => {
    const events = turn.events.filter(retainRunEvent);
    return {
      id: turn.run.id,
      prompt: turn.run.task_prompt,
      answer: answerFromEvents(events),
      events,
      verificationSummary: verificationSummaryFromValue(turn.run.verification_summary),
      terminal: Boolean(turn.run.finished_at) || hasFinished(events),
    };
  });
}

function fixtureTurns(events: RunEvent[], fixtureId?: string): Turn[] {
  const queued = events.find((event) => event.type === "run.queued");
  const wireEvents = events as WireEvent[];
  return [{
    id: fixtureId ?? queued?.run_id ?? "example",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and verify the cut value.",
    answer: answerFromEvents(wireEvents),
    events: wireEvents,
    verificationSummary: verificationSummaryFromValue(events.find((event) => event.type === "run.finished")?.verification_summary),
    terminal: hasFinished(wireEvents),
  }];
}

export function LiveRun({ taskId }: { taskId: string }) {
  const router = useRouter();
  const fixtureEvents = RUN_FIXTURES[taskId] ?? null;
  const fixtureIsTerminal = Boolean(
    fixtureEvents?.some((event) => event.type === "run.finished"),
  );
  const [turns, setTurns] = useState<Turn[]>(
    fixtureEvents ? fixtureTurns(fixtureEvents, taskId) : [],
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streaming, setStreaming] = useState(!fixtureEvents || !fixtureIsTerminal);
  const [error, setError] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(Boolean(fixtureEvents && !fixtureIsTerminal));
  const [liveEvents, setLiveEvents] = useState<WireEvent[]>(
    fixtureEvents ? (fixtureEvents as WireEvent[]) : [],
  );
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [existingChat, setExistingChat] = useState<ChatSummary | null>(null);
  const lastEventId = useRef<number | null>(null);
  const loadSeq = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);

  useEffect(() => {
    setExistingChat(
      loadChatHistory({ includeArchived: true }).find(
        (item) => item.id === taskId || item.conversationId === conversationId,
      ) ?? null,
    );
  }, [conversationId, taskId]);

  const title = existingChat?.title ?? turns[0]?.prompt ?? "Quantum chat";

  useEffect(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setExistingChat(null);
    shouldAutoScrollRef.current = true;
  }, [taskId]);

  useEffect(() => {
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer || !shouldAutoScrollRef.current) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [taskId, turns, streamingText, reasoningText, liveEvents.length, pending]);

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
        conversationIdRef.current = payload.id;
        setConversationId(payload.id);
        setTurns(turnsFromConversation(payload));
        setPending(payload.turns.some((turn) =>
          turn.run.id === taskId
          && !hasFinished(turn.events)
          && !answerFromEvents(turn.events)
        ));
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
              if (retainRunEvent(event)) {
                setLiveEvents((current) => [...current, event]);
              }
              if (event.type === "chat.delta" && event.text) {
                setStreaming(true);
                if (event.kind === "reasoning") setReasoningText((current) => `${current}${event.text}`);
                else setStreamingText((current) => `${current}${event.text}`);
              }
              if (event.type === "chat.completed" && event.text) {
                setStreamingText(event.text);
                setStreaming(false);
              }
              if (event.type === "chat.error") {
                setError(event.message ?? "The assistant could not complete this response.");
                setStreaming(false);
                setPending(false);
              }
              if (event.type === "run.error") {
                // Domain failures belong to the deterministic result/progress model.
                // Keep the page-level error channel for transport and submission
                // failures so one provider error is not rendered twice.
                setStreaming(false);
                // Clear `pending` here too. If the stream ends after run.error
                // without a terminal run.finished — worker crash, dropped
                // connection — the composer stayed disabled forever with no
                // error surfaced anywhere. Progress and outcome already derive
                // failure from the error event, so nothing is lost by
                // re-enabling input.
                setPending(false);
              }
              if (event.type === "run.finished") {
                terminal = true;
                setPending(false);
                setStreaming(false);
                const sidebarChat = loadChatHistory({ includeDemo: false, includeArchived: true }).find(
                  (chat) => chat.id === taskId || chat.conversationId === conversationIdRef.current,
                );
                if (sidebarChat) {
                  updateChat(sidebarChat.id, { status: event.status === "succeeded" ? "draft" : "failed" });
                }
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
    if (!conversationId) {
      setError("The conversation is still loading. Try again in a moment.");
      return;
    }
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
      const chatToContinue = existingChat ?? loadChatHistory({ includeDemo: false, includeArchived: true }).find(
        (chat) => chat.id === taskId || chat.conversationId === conversationId,
      );
      if (chatToContinue) {
        updateChat(chatToContinue.id, { status: "queued" });
      } else {
        // Preserve one local identity even if the sidebar had not hydrated before
        // the user sent a follow-up. Later turns are grouped by conversation id.
        rememberChat({
          id: taskId,
          conversationId: payload.conversation_id ?? conversationId,
          title: titleFromPrompt(turns[0]?.prompt ?? taskPrompt),
          prompt: turns[0]?.prompt ?? taskPrompt,
          createdAt: new Date().toISOString(),
          status: "queued",
        });
      }
      router.replace(`/run/${payload.id}`, { scroll: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message submission failed");
      setPending(false);
    }
  }

  const activePrompt = turns.find((turn) => turn.id === taskId)?.prompt ?? existingChat?.prompt;
  const showActiveUser = Boolean(activePrompt && !turns.some((turn) => turn.id === taskId));

  return (
    <div className="mj-run-task">
      <div
        className="mj-run-task-scroll"
        ref={chatScrollRef}
        onScroll={(event) => {
          const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
          shouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 48;
        }}
      >
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
                {turn.answer || turn.terminal ? (
                  <CompletedAssistant turn={turn} />
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

export function CompletedAssistant({ turn }: { turn: Turn }) {
  // Failure context and the best produced output are separate concerns. A rejected
  // candidate still remains inspectable after the reason it was rejected.
  const result = runResultFromEvents(turn.events, turn.verificationSummary);
  const outcome = runOutcomeFromEvents(turn.events, turn.verificationSummary);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${result || outcome ? " mj-chat-message--run" : ""}`}>
      <RunProgressBlock events={turn.events} running={false} />
      {outcomeWithoutDuplicateCode && turn.events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={turn.events} />
      ) : outcomeWithoutDuplicateCode ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} action={<ArtifactLink events={turn.events} />} />
      ) : (
        <>
          {turn.answer ? (
            <ChatMarkdown source={turn.answer} />
          ) : (
            <p className="mj-run-waiting">The response completed without displayable content.</p>
          )}
          <ArtifactLink events={turn.events} />
        </>
      )}
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
  const progress = runProgressFromEvents(events, streaming);
  const result = runResultFromEvents(events);
  const outcome = runOutcomeFromEvents(events);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${progress ? " mj-chat-message--run" : ""}`}>
      {progress ? <RunProgressBlock events={events} running={streaming} /> : null}
      {reasoning ? (
        <details className="mj-chat-thinking" open={streaming}>
          <summary>Thinking</summary>
          <ChatMarkdown source={reasoning} />
        </details>
      ) : null}
      {outcomeWithoutDuplicateCode && events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={events} />
      ) : outcomeWithoutDuplicateCode ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} action={<ArtifactLink events={events} />} />
      ) : text ? (
        <ChatMarkdown source={text} />
      ) : progress ? null : (
        <span className="mj-chat-message--loading">
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
        </span>
      )}
      {!result && !outcomeWithoutDuplicateCode ? <ArtifactLink events={events} /> : null}
    </div>
  );
}

function FinalOutput({
  result,
  events,
}: {
  result: NonNullable<ReturnType<typeof runResultFromEvents>>;
  events: WireEvent[];
}) {
  return (
    <section className="mj-run-final-output" aria-label="Final Output">
      <header className="mj-run-final-output-heading">
        <span
          className="mj-run-final-output-marker"
          data-tone={result.trust.tone}
          aria-hidden="true"
        >
          {result.trust.tone === "ok" ? "✓" : "–"}
        </span>
        <div>
          <span>Deliverable</span>
          <h2>Final Output</h2>
        </div>
      </header>
      <RunResult
        result={result}
        action={<ArtifactLink events={events} />}
        artifactId={artifactIdFromEvents(events)}
      />
    </section>
  );
}

function lastEvent(events: WireEvent[], type: string): WireEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

function llmCallBefore(
  events: WireEvent[],
  beforeIndex: number,
  ...stages: string[]
): WireEvent | null {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "llm.call" && event.stage && stages.includes(event.stage)) {
      return event;
    }
  }
  return null;
}

function durationLabel(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) return null;
  return durationMs < 1000
    ? `${Math.round(durationMs)} ms`
    : `${(durationMs / 1000).toFixed(2)} s`;
}

function ModelCallMeta({ event }: { event: WireEvent | null }) {
  if (!event) return null;
  const parts = [
    event.model,
    durationLabel(event.duration_ms),
    event.input_tokens !== undefined && event.output_tokens !== undefined
      ? `${event.input_tokens.toLocaleString()} in · ${event.output_tokens.toLocaleString()} out`
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function SimulationResult({ event }: { event: WireEvent }) {
  const result = recordValue(event.result);
  const counts = recordValue(result?.counts);
  const countEntries = counts
    ? Object.entries(counts)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort(([left], [right]) => left.localeCompare(right))
    : [];
  const total = countEntries.reduce((sum, [, value]) => sum + value, 0);
  const max = Math.max(1, ...countEntries.map(([, value]) => value));
  const scalarEntries = result
    ? Object.entries(result).filter(
      ([key, value]) => key !== "counts" && ["string", "number", "boolean"].includes(typeof value),
    )
    : [];

  return (
    <div className="mj-run-live-simulation">
      <dl className="mj-run-live-facts">
        <div>
          <dt>Exit code</dt>
          <dd>{event.exit_code ?? "—"}</dd>
        </div>
        <div>
          <dt>Runtime</dt>
          <dd>{durationLabel(event.duration_ms) ?? "—"}</dd>
        </div>
        {total ? (
          <div>
            <dt>Shots</dt>
            <dd>{total.toLocaleString()}</dd>
          </div>
        ) : null}
        {scalarEntries.map(([key, value]) => (
          <div key={key}>
            <dt>{key.replaceAll("_", " ")}</dt>
            <dd>{String(value)}</dd>
          </div>
        ))}
      </dl>
      {countEntries.length ? (
        <div className="mj-run-live-chart" role="img" aria-label={`Measured counts from ${total} shots`}>
          {countEntries.map(([state, value]) => {
            const percent = total ? (value / total) * 100 : 0;
            return (
              <div className="mj-run-live-bar" key={state}>
                <code>{state}</code>
                <span className="mj-run-live-bar-track" aria-hidden="true">
                  <span style={{ width: `${(value / max) * 100}%` }} />
                </span>
                <span>
                  {value.toLocaleString()}
                  <small>{percent.toFixed(1)}%</small>
                </span>
              </div>
            );
          })}
        </div>
      ) : result && Object.keys(result).length ? (
        <pre className="mj-run-live-result-json">{JSON.stringify(result, null, 2)}</pre>
      ) : (
        <p className="mj-run-live-empty-result">
          This replay predates structured simulation values. Runtime diagnostics remain below.
        </p>
      )}
      {event.stdout || event.stderr ? (
        <details className="mj-run-live-logs">
          <summary>Runtime logs</summary>
          {event.stdout ? (
            <div>
              <span>stdout</span>
              <pre className="mj-run-process-detail-pre">{event.stdout}</pre>
            </div>
          ) : null}
          {event.stderr ? (
            <div>
              <span>stderr</span>
              <pre className="mj-run-process-detail-pre">{event.stderr}</pre>
            </div>
          ) : null}
        </details>
      ) : null}
    </div>
  );
}

type LiveStageKind =
  | "plan"
  | "generate"
  | "screen"
  | "simulation"
  | "verification"
  | "review"
  | "compilation"
  | "finalize"
  | "save"
  | "best_effort"
  | "pending";

type LiveStageState = "active" | "done" | "warn" | "error";

type LiveStageCard = {
  key: string;
  kind: LiveStageKind;
  title: string;
  eyebrow: string;
  state: LiveStageState;
  status: string;
  event: WireEvent | null;
  call: WireEvent | null;
};

const ACTIVITY_GLYPH: Record<LiveStageState, string> = {
  active: "•",
  done: "✓",
  warn: "–",
  error: "×",
};

function pendingActivity(events: WireEvent[], running: boolean): LiveStageCard | null {
  if (!running || lastEvent(events, "run.finished")) return null;
  const progress = runProgressFromEvents(events, true);
  const active = progress?.items.find((item) => item.state === "active");
  if (!active) return null;
  const revision = (lastEvent(events, "code.generated")?.revision ?? 0) + (
    active.id === "generate" ? 1 : 0
  );
  const copy: Record<string, { eyebrow: string; title: string }> = {
    plan: {
      eyebrow: "Thinking",
      title: "Understanding the request and choosing an approach",
    },
    generate: {
      eyebrow: "Generating code",
      title: `Writing candidate revision ${Math.max(1, revision)}`,
    },
    execute: {
      eyebrow: "Running & testing",
      title: `Running candidate revision ${Math.max(1, revision)}`,
    },
    review: {
      eyebrow: "Quality check",
      title: `Reviewing candidate revision ${Math.max(1, revision)}`,
    },
    save: {
      eyebrow: "Finalizing",
      title: "Preparing the final output",
    },
  };
  const current = copy[active.id] ?? copy.plan;
  return {
    key: `pending-${active.id}-${revision}`,
    kind: "pending",
    title: current.title,
    eyebrow: current.eyebrow,
    state: "active",
    status: "Running",
    event: null,
    call: null,
  };
}

function activityCards(events: WireEvent[], running: boolean): LiveStageCard[] {
  const cards: LiveStageCard[] = [];
  let planCount = 0;
  let currentRevision = 0;

  events.forEach((event, index) => {
    const key = `${event.seq ?? index}-${event.type}`;
    switch (event.type) {
      case "plan.produced":
        planCount += 1;
        cards.push({
          key,
          kind: "plan",
          title: event.plan?.problem_summary ?? "Circuit plan",
          eyebrow: planCount === 1 ? "Plan" : `Revised plan ${planCount}`,
          state: "done",
          status: "Complete",
          event,
          call: llmCallBefore(events, index, "plan"),
        });
        break;
      case "code.generated":
        currentRevision = event.revision ?? currentRevision + 1;
        cards.push({
          key,
          kind: "generate",
          title: `Candidate revision ${currentRevision}`,
          eyebrow: "Generated code",
          state: "done",
          status: "Complete",
          event,
          call: llmCallBefore(events, index, "generate"),
        });
        break;
      case "screen.result": {
        const passed = event.lint_ok !== false && event.typecheck_ok !== false;
        cards.push({
          key,
          kind: "screen",
          title: passed ? "Static checks passed" : "Static checks found an issue",
          eyebrow: "Code checks",
          state: passed ? "done" : "error",
          status: passed ? "Passed" : "Failed",
          event,
          call: null,
        });
        break;
      }
      case "sandbox.result": {
        const passed = event.exit_code === 0;
        cards.push({
          key,
          kind: "simulation",
          title: passed
            ? `Candidate revision ${Math.max(1, currentRevision)} executed`
            : `Candidate revision ${Math.max(1, currentRevision)} needs repair`,
          eyebrow: "Run & test",
          state: passed ? "done" : "error",
          status: passed ? "Passed" : "Failed",
          event,
          call: null,
        });
        break;
      }
      case "verification.result": {
        const result = String(event.result ?? "unavailable");
        const state: LiveStageState = result === "pass"
          ? "done"
          : result === "fail" || result === "error"
            ? "error"
            : "warn";
        cards.push({
          key,
          kind: "verification",
          title: (event.method && VERIFICATION_METHOD_LABEL[event.method])
            || `Verification: ${event.method ?? "check"}`,
          eyebrow: "Test result",
          state,
          status: result === "pass" ? "Passed" : result === "fail" ? "Failed" : "Unavailable",
          event,
          call: null,
        });
        break;
      }
      case "verification.semantic_review": {
        const ready = event.decision === "ready";
        cards.push({
          key,
          kind: "review",
          title: ready
            ? `Candidate revision ${Math.max(1, currentRevision)} aligned`
            : event.decision === "replan"
              ? "Quality check requested a revised plan"
              : "Quality check requested a code repair",
          eyebrow: "Quality check",
          state: ready ? "done" : "warn",
          status: ready ? "Passed" : "Needs revision",
          event,
          call: llmCallBefore(events, index, "verify", "review"),
        });
        break;
      }
      case "verification.strict_attempt": {
        const passed = event.decision === "pass";
        const failed = event.decision === "fail";
        cards.push({
          key,
          kind: "verification",
          title: passed
            ? "Strict verification passed"
            : failed
              ? "Strict verification found an issue"
              : "Strict verification was inconclusive",
          eyebrow: "Verification",
          state: passed ? "done" : failed ? "error" : "warn",
          status: passed ? "Passed" : failed ? "Failed" : "Inconclusive",
          event,
          call: null,
        });
        break;
      }
      case "compilation.result":
        cards.push({
          key,
          kind: "compilation",
          title: event.accepted === false
            ? "Compilation kept the original circuit"
            : "Circuit compilation completed",
          eyebrow: "Compilation",
          state: event.accepted === false ? "warn" : "done",
          status: event.accepted === false ? "Unchanged" : "Complete",
          event,
          call: null,
        });
        break;
      case "code.finalized":
        cards.push({
          key,
          kind: "finalize",
          title: `Finalized candidate revision ${event.revision ?? Math.max(1, currentRevision)}`,
          eyebrow: "Finalizing",
          state: "done",
          status: "Complete",
          event,
          call: null,
        });
        break;
      case "artifact.saved":
        cards.push({
          key,
          kind: "save",
          title: "Saved the artifact to Vault",
          eyebrow: "Save",
          state: "done",
          status: "Complete",
          event,
          call: null,
        });
        break;
      case "run.best_effort":
        cards.push({
          key,
          kind: "best_effort",
          title: `Selected revision ${event.revision ?? Math.max(1, currentRevision)} as the best available candidate`,
          eyebrow: "Finalizing",
          state: "warn",
          status: "Not accepted",
          event,
          call: null,
        });
        break;
      default:
        break;
    }
  });

  const pending = pendingActivity(events, running);
  if (pending) cards.push(pending);
  return cards;
}

function EventRecord({ value }: { value: unknown }) {
  if (value === undefined || value === null) return null;
  return (
    <pre className="mj-run-live-result-json">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function ScreenStage({ event }: { event: WireEvent }) {
  return (
    <div className="mj-run-live-simulation">
      <dl className="mj-run-live-facts">
        <div>
          <dt>Lint</dt>
          <dd>{event.lint_ok === false ? "Failed" : "Passed"}</dd>
        </div>
        <div>
          <dt>Type check</dt>
          <dd>{event.typecheck_ok === false ? "Failed" : "Passed"}</dd>
        </div>
      </dl>
      {event.diagnostics?.length ? (
        <pre className="mj-run-process-detail-pre">{event.diagnostics.join("\n")}</pre>
      ) : null}
    </div>
  );
}

function CompilationStage({ event }: { event: WireEvent }) {
  return (
    <div className="mj-run-live-simulation">
      {event.reason ? <p className="mj-run-live-empty-result">{event.reason}</p> : null}
      {event.before || event.after || event.compatibility ? (
        <EventRecord value={{
          before: event.before,
          after: event.after,
          compatibility: event.compatibility,
        }} />
      ) : null}
    </div>
  );
}

function ActivityDetail({ card }: { card: LiveStageCard }) {
  if (!card.event) {
    return (
      <div className="mj-run-live-active-copy">
        <span className="mj-run-live-pulse" aria-hidden="true" />
        Work is continuing. New evidence will appear here as soon as it is recorded.
      </div>
    );
  }
  switch (card.kind) {
    case "plan":
      return <PlanStage event={card.event} />;
    case "generate":
    case "finalize":
      return <CodeStage event={card.event} />;
    case "screen":
      return <ScreenStage event={card.event} />;
    case "simulation":
      return <SimulationResult event={card.event} />;
    case "review":
      return <ReviewStage event={card.event} />;
    case "verification":
      return card.event.type === "verification.strict_attempt"
        ? <StrictVerificationStage event={card.event} />
        : <EventRecord value={card.event.details ?? card.event.result} />;
    case "compilation":
      return <CompilationStage event={card.event} />;
    case "save":
      return <p className="mj-run-live-empty-result">The private artifact is available in Vault.</p>;
    case "best_effort":
      return (
        <div className="mj-run-process-detail-text">
          {card.event.critic_summary ? <p>{card.event.critic_summary}</p> : null}
          {card.event.failed_checks?.length ? (
            <ul>{card.event.failed_checks.map((check) => <li key={check}>{check}</li>)}</ul>
          ) : null}
        </div>
      );
    default:
      return null;
  }
}

function RunEvidenceFeed({ events, running }: { events: WireEvent[]; running: boolean }) {
  const cards = activityCards(events, running);

  if (!cards.length) return null;
  const currentKey = cards[cards.length - 1].key;
  return (
    <div className="mj-run-live-stages" aria-label="Agent activity">
      {cards.map((card, index) => {
        const current = card.key === currentKey;
        return (
          <details
            className="mj-run-live-stage"
            data-state={card.state}
            key={card.key}
            open={current}
          >
            <summary>
              <span className="mj-run-live-stage-index" aria-hidden="true">
                {card.state === "active"
                  ? ACTIVITY_GLYPH.active
                  : ACTIVITY_GLYPH[card.state] || String(index + 1).padStart(2, "0")}
              </span>
              <span className="mj-run-live-stage-heading">
                <span>{card.eyebrow}</span>
                <strong>{card.title}</strong>
              </span>
              <span className="mj-run-live-stage-meta">
                <ModelCallMeta event={card.call} />
                <strong>{card.status}</strong>
              </span>
            </summary>
            <div className="mj-run-live-stage-body">
              <ActivityDetail card={card} />
            </div>
          </details>
        );
      })}
    </div>
  );
}

function PlanStage({ event }: { event: WireEvent }) {
  const plan = event.plan;
  if (!plan) return null;
  const facts = [
    ["Algorithm", plan.algorithm],
    ["Framework", plan.framework],
    ["Qubits", plan.qubits_estimate],
    ["Shots", plan.parameters?.shots],
    ["Seed", plan.parameters?.seed],
    ["Expected runtime", plan.expected_runtime_sec !== undefined ? `${plan.expected_runtime_sec} s` : null],
    ["Primary metric", plan.success_criteria?.primary_metric],
    ["Outputs", plan.expected_output_keys?.join(", ")],
  ].filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "");
  return (
    <div className="mj-run-live-plan">
      {plan.algorithm_rationale ? <p>{plan.algorithm_rationale}</p> : null}
      <dl className="mj-run-live-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function CodeStage({ event }: { event: WireEvent }) {
  if (!event.code) return null;
  const language = event.language ?? "python";
  return (
    <pre
      className="mj-run-live-code"
      tabIndex={0}
      role="region"
      aria-label={`Generated ${language} source code`}
    >
      <SyntaxHighlightedCode code={event.code} language={language} />
    </pre>
  );
}

function RunProgressBlock({
  events,
  running,
}: {
  events: WireEvent[];
  running: boolean;
}) {
  const progress = runProgressFromEvents(events, running);
  if (!progress) return null;
  const completed = progress.items.filter((item) => item.state === "done").length;
  const active = progress.items.some((item) => item.state === "active");
  return (
    <section className="mj-run-workflow" aria-label="Run activity">
      <header className="mj-run-agent-head">
        <div>
          <span className="mj-run-agent-label">
            {active ? <span className="mj-run-progress-live-dot" aria-hidden="true" /> : null}
            {progress.label}
          </span>
          <strong>{progress.headline}</strong>
        </div>
        <span className="mj-run-agent-count">
          {completed}/{progress.items.length} stages
        </span>
      </header>
      <RunEvidenceFeed events={events} running={running} />
    </section>
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
