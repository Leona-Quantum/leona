"use client";

import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  RunOutcome,
  RunProgress,
  SyntaxHighlightedCode,
  type RunEvent,
} from "@majorana/ui";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { archiveChat, deleteChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { RunComposer } from "../../../../components/run-composer";
import { RUN_FIXTURES } from "./fixtures";
import { verificationSummaryFromValue, type VerificationSummary } from "../../../../lib/verification-record";
import { runOutcomeFromEvents } from "../../../../lib/run-outcome";
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

function processStepLabel(event: WireEvent): string | null {
  switch (event.type) {
    case "plan.produced":
      return event.plan?.problem_summary ? `Planned approach: ${event.plan.problem_summary}` : "Planned an approach";
    case "code.generated":
      return `Wrote candidate circuit${event.revision ? ` (revision ${event.revision})` : ""}`;
    case "sandbox.result":
      return event.exit_code === 0 ? "Ran the circuit in the sandbox" : "Circuit failed in the sandbox — repairing";
    case "verification.semantic_review":
      switch (event.decision) {
        case "ready":
          return "Reviewed the candidate — looks aligned with the request";
        case "code_repair":
          return "Reviewed the candidate — found an issue, repairing the code";
        case "replan":
          return "Reviewed the candidate — the plan itself needs revising";
        case "inconclusive":
          return "Reviewed the candidate — inconclusive, gathering more evidence";
        default:
          return "Reviewed the candidate";
      }
    case "verification.strict_attempt":
      switch (event.decision) {
        case "pass":
          return "Strict verification passed — added a verified badge";
        case "inconclusive":
          return "Strict verification inconclusive — no dedicated check available for this case";
        case "fail":
          return "Strict verification found an issue — recorded as a disclosed limitation";
        default:
          return "Ran strict verification";
      }
    case "verification.result": {
      const label = (event.method && VERIFICATION_METHOD_LABEL[event.method]) || `Verification (${event.method ?? "?"})`;
      return `${label}: ${String(event.result ?? "?")}`;
    }
    case "code.finalized":
      return "Finalized the candidate circuit";
    case "artifact.saved":
      return "Saved the circuit and its verification state to your vault";
    case "run.best_effort":
      return `Kept the closest attempt (revision ${event.revision}) — unverified`;
    case "run.error":
      return event.message ? `Error: ${event.message}` : "Run error";
    default:
      return null;
  }
}

type ProcessStep = { key: string; label: string; event: WireEvent };

function processSteps(events: WireEvent[]): ProcessStep[] {
  const steps: ProcessStep[] = [];
  events.forEach((event, index) => {
    const label = processStepLabel(event);
    if (label) steps.push({ key: `${index}-${event.type}`, label, event });
  });
  return steps;
}

/** The expandable body under a step's summary line — the plan namekoQ shows in
 * request_plan's payload, the code a simulate tool ran, why review/strict
 * verification decided what it decided. Returns null for steps that have
 * nothing more to show than their one-line label. */
function processStepDetail(event: WireEvent): ReactNode {
  switch (event.type) {
    case "plan.produced": {
      const plan = event.plan;
      if (!plan) return null;
      const range = plan.success_criteria?.expected_range;
      return (
        <dl className="mj-run-process-detail-fields">
          {plan.algorithm ? (
            <>
              <dt>Algorithm</dt>
              <dd>{plan.algorithm}</dd>
            </>
          ) : null}
          {plan.framework ? (
            <>
              <dt>Framework</dt>
              <dd>{plan.framework}</dd>
            </>
          ) : null}
          {plan.qubits_estimate !== undefined ? (
            <>
              <dt>Qubits</dt>
              <dd>{plan.qubits_estimate}</dd>
            </>
          ) : null}
          {plan.success_criteria?.primary_metric ? (
            <>
              <dt>Success metric</dt>
              <dd>
                {plan.success_criteria.primary_metric}
                {range ? ` (${Object.entries(range).map(([bound, value]) => `${bound}: ${value}`).join(", ")})` : ""}
              </dd>
            </>
          ) : null}
        </dl>
      );
    }
    case "code.generated":
      return event.code ? <ChatMarkdown source={`\`\`\`python\n${event.code}\n\`\`\``} /> : null;
    case "sandbox.result":
      return event.stderr ? <pre className="mj-run-process-detail-pre">{event.stderr}</pre> : null;
    case "verification.semantic_review": {
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
    case "verification.strict_attempt":
      return event.reason_code || event.unverified_claims?.length ? (
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
      ) : null;
    default:
      return null;
  }
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

type Turn = {
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

function turnsFromConversation(payload: ConversationPayload): Turn[] {
  return payload.turns.map((turn) => ({
    id: turn.run.id,
    prompt: turn.run.task_prompt,
    answer: answerFromEvents(turn.events),
    events: turn.events,
    verificationSummary: verificationSummaryFromValue(turn.run.verification_summary),
    terminal: Boolean(turn.run.finished_at) || hasFinished(turn.events),
  }));
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

function CompletedAssistant({ turn }: { turn: Turn }) {
  const outcome = runOutcomeFromEvents(turn.events, turn.verificationSummary);
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${outcome ? " mj-chat-message--run" : ""}`}>
      <RunProgressBlock events={turn.events} running={false} />
      {outcome ? (
        <RunOutcome outcome={outcome} action={<ArtifactLink events={turn.events} />} />
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
  const outcome = runOutcomeFromEvents(events);
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${progress ? " mj-chat-message--run" : ""}`}>
      {progress ? <RunProgressBlock events={events} running={streaming} /> : null}
      {reasoning ? (
        <details className="mj-chat-thinking" open={streaming}>
          <summary>Thinking</summary>
          <ChatMarkdown source={reasoning} />
        </details>
      ) : null}
      {outcome ? (
        <RunOutcome outcome={outcome} action={<ArtifactLink events={events} />} />
      ) : text ? (
        <ChatMarkdown source={text} />
      ) : progress ? null : (
        <span className="mj-chat-message--loading">
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
          <span className="mj-chat-loading-dot" />
        </span>
      )}
      {!outcome ? <ArtifactLink events={events} /> : null}
    </div>
  );
}

function lastEvent(events: WireEvent[], type: string): WireEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

function llmCallFor(events: WireEvent[], ...stages: string[]): WireEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
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
      {event.stderr ? <pre className="mj-run-process-detail-pre">{event.stderr}</pre> : null}
    </div>
  );
}

type LiveStageCard = {
  id: "plan" | "generate" | "simulation" | "review";
  title: string;
  eyebrow: string;
  event: WireEvent;
  call: WireEvent | null;
};

function RunEvidenceFeed({ events, running }: { events: WireEvent[]; running: boolean }) {
  const plan = lastEvent(events, "plan.produced");
  const code = lastEvent(events, "code.generated");
  const simulation = lastEvent(events, "sandbox.result");
  const review = lastEvent(events, "verification.semantic_review");
  const cards: LiveStageCard[] = [
    plan ? {
      id: "plan",
      title: plan.plan?.problem_summary ?? "Circuit plan",
      eyebrow: "01 · Plan",
      event: plan,
      call: llmCallFor(events, "plan"),
    } : null,
    code ? {
      id: "generate",
      title: `Candidate revision ${code.revision ?? 1}`,
      eyebrow: "02 · Generated code",
      event: code,
      call: llmCallFor(events, "generate"),
    } : null,
    simulation ? {
      id: "simulation",
      title: simulation.exit_code === 0 ? "Simulation completed" : "Simulation needs repair",
      eyebrow: "03 · Simulation",
      event: simulation,
      call: null,
    } : null,
    review ? {
      id: "review",
      title: review.decision === "ready" ? "Aligned with the request" : "Review feedback",
      eyebrow: "04 · Review",
      event: review,
      call: llmCallFor(events, "verify", "review"),
    } : null,
  ].filter((card): card is LiveStageCard => card !== null);

  if (!cards.length) return null;
  const currentId = cards[cards.length - 1].id;
  return (
    <div className="mj-run-live-stages" aria-label="Live run details">
      {cards.map((card) => {
        const current = card.id === currentId;
        return (
          <details className="mj-run-live-stage" key={card.id} open={current}>
            <summary>
              <span className="mj-run-live-stage-index" aria-hidden="true">
                {current && running ? "–" : "✓"}
              </span>
              <span className="mj-run-live-stage-heading">
                <span>{card.eyebrow}</span>
                <strong>{card.title}</strong>
              </span>
              <span className="mj-run-live-stage-meta">
                <ModelCallMeta event={card.call} />
              </span>
            </summary>
            <div className="mj-run-live-stage-body">
              {card.id === "plan" ? <PlanStage event={card.event} /> : null}
              {card.id === "generate" ? <CodeStage event={card.event} /> : null}
              {card.id === "simulation" ? <SimulationResult event={card.event} /> : null}
              {card.id === "review" ? processStepDetail(card.event) : null}
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
  const steps = processSteps(events);
  if (!progress) return null;
  return (
    <section className="mj-run-workflow" aria-label="Run activity">
      <RunProgress progress={progress} />
      <RunEvidenceFeed events={events} running={running} />
      {steps.length ? (
        <details className="mj-run-progress-technical">
          <summary>
            <span>Technical details</span>
            <span>{steps.length} events</span>
          </summary>
          <div className="mj-run-progress-technical-body">
            <ProcessEventDetails steps={steps} />
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ProcessEventDetails({ steps }: { steps: ProcessStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ul className="mj-run-process-list">
      {steps.map((step) => {
        const labelClassName = "mj-run-process-text mj-run-process-text--done";
        const detail = processStepDetail(step.event);
        // Only steps with something to show underneath become an expandable pull
        // tab (the plan, the code a simulate tool ran, why review/strict
        // verification decided what it decided) — a step with nothing more to say
        // than its own summary line stays a plain, unclickable list item, so it
        // never shows a disclosure triangle that opens onto nothing.
        if (!detail) {
          return (
            <li key={step.key} className={labelClassName}>
              {step.label}
            </li>
          );
        }
        return (
          <li key={step.key}>
            <details className="mj-run-process-detail">
              <summary className={labelClassName}>{step.label}</summary>
              <div className="mj-run-process-detail-body">{detail}</div>
            </details>
          </li>
        );
      })}
    </ul>
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
