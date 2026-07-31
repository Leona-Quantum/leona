"use client";

import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  AgentActivity,
  RunOutcome,
  SyntaxHighlightedCode,
  type AgentActivityItem,
  type AgentActivityState,
  type RunEvent,
} from "@majorana/ui";
import { ChatMarkdown } from "../../../../components/chat-markdown";
import { archiveChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { displayChatTitle, titleFromPrompt } from "../../../../lib/chat-title";
import { RunComposer, type ComposerFramework } from "../../../../components/run-composer";
import type { ComposerMode } from "../../../../lib/run-mode";
import { RUN_FIXTURES } from "./fixtures";
import { verificationSummaryFromValue, type VerificationSummary } from "../../../../lib/verification-record";
import { runOutcomeFromEvents } from "../../../../lib/run-outcome";
import { runResultFromEvents } from "../../../../lib/run-result";
import { RunResult } from "../../../../components/run-result";
import {
  runActivityFromEvents,
  type RunActivityDetail,
} from "../../../../lib/run-activity";
import { formatShare, simulationChartData } from "../../../../lib/simulation-visual";
import { ThinkingLabel } from "../../../../components/thinking-label";
import { useSmoothedText } from "../../../../components/use-smoothed-text";

type WireEvent = {
  run_id: string;
  seq?: number;
  ts?: string;
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
  summary?: string;
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
  title?: string;
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
  not_applicable_reason?: string | null;
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
  //
  // `conversation.titled` is dropped for a different reason: it is workspace
  // metadata, not evidence about the run. Everything downstream of `liveEvents`
  // — progress, outcome, result — reasons about what the pipeline did, and a
  // naming event has no place in any of them. It is read straight off the wire
  // and off the raw conversation payload instead (see conversationTitleFrom*).
  return (
    event.type !== "llm.delta"
    && event.type !== "chat.delta"
    && event.type !== "conversation.titled"
  );
}

/** The model's name for this conversation, if its opening turn recorded one. */
function conversationTitleFromPayload(payload: ConversationPayload): string | null {
  for (const turn of payload.turns) {
    const titled = turn.events.find(
      (event) => event.type === "conversation.titled" && typeof event.title === "string",
    );
    if (titled?.title) return titled.title;
  }
  return null;
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
  const [stopping, setStopping] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(Boolean(fixtureEvents && !fixtureIsTerminal));
  const [liveEvents, setLiveEvents] = useState<WireEvent[]>(
    fixtureEvents ? (fixtureEvents as WireEvent[]) : [],
  );
  const [attachments, setAttachments] = useState<Array<{ name: string; size: number; content: string }>>([]);
  const [existingChat, setExistingChat] = useState<ChatSummary | null>(null);
  const [conversationTitle, setConversationTitle] = useState<string | null>(null);
  // The prompt of a follow-up that has been sent but whose turn has not come
  // back from /conversation yet. Without it the message the user just sent
  // renders nowhere for the length of a round trip.
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  // A conversation is still a place where the user picks how to be answered and
  // in which framework. Both selections used to exist only on the /run home
  // screen, so they vanished the moment the first message was sent.
  const [mode, setMode] = useState<ComposerMode>("auto");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const lastEventId = useRef<number | null>(null);
  const loadSeq = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const completionScrolledForTaskRef = useRef<string | null>(null);

  const currentRunIsTerminal = fixtureIsTerminal
    || liveEvents.some((event) => event.run_id === taskId && event.type === "run.finished")
    || turns.some((turn) => turn.id === taskId && turn.terminal);

  useEffect(() => {
    const found = loadChatHistory({ includeArchived: true }).find(
      (item) => item.id === taskId || item.conversationId === conversationId,
    ) ?? null;
    // Hold the current row while a follow-up is in flight. Each turn is a new run
    // id, so between `router.replace` and the next `/conversation` response the
    // new id is not in local history and `conversationId` is briefly null —
    // dropping the row there is what made the header flash from the conversation's
    // name to the raw text of its first prompt on every message.
    setExistingChat((current) => found ?? (conversationId === null ? current : null));
  }, [conversationId, taskId]);

  const title = conversationTitle
    ?? (existingChat ? displayChatTitle(existingChat) : null)
    ?? (turns[0]?.prompt ? titleFromPrompt(turns[0].prompt) : null)
    ?? "Quantum chat";

  useEffect(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setStopping(false);
    shouldAutoScrollRef.current = true;
    completionScrolledForTaskRef.current = null;
  }, [taskId]);

  useEffect(() => {
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer || !shouldAutoScrollRef.current) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
  }, [taskId, turns, streamingText, reasoningText, liveEvents.length, pending]);

  useEffect(() => {
    if (
      !currentRunIsTerminal
      || completionScrolledForTaskRef.current === taskId
      || !shouldAutoScrollRef.current
    ) {
      return;
    }
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer) return;
    const target = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>("[data-run-final-output]"),
    ).find((element) => element.dataset.runFinalOutput === taskId);
    // Conversation hydration can reveal `run.finished` one render before the
    // result projection mounts. Leave the request pending so the next turns or
    // event update can try again instead of falling back to the bottom edge.
    if (!target) return;

    const frame = window.requestAnimationFrame(() => {
      // Do not steal the viewport if the reader moved away while the terminal
      // render was settling. `onScroll` owns this preference.
      if (!shouldAutoScrollRef.current) return;
      const containerRect = scrollContainer.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const top = Math.max(
        0,
        scrollContainer.scrollTop + targetRect.top - containerRect.top - 16,
      );
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      scrollContainer.scrollTo({
        top,
        behavior: reducedMotion ? "auto" : "smooth",
      });
      completionScrolledForTaskRef.current = taskId;
      // The result heading, rather than its lower code/log content, is now the
      // stable reading anchor. Later hydration must not pull it down to the
      // bottom again.
      shouldAutoScrollRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentRunIsTerminal, liveEvents.length, taskId, turns]);

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
        const named = conversationTitleFromPayload(payload);
        // A reload has no live stream to learn the name from, so it comes off
        // the durable events. Only ever set, never cleared: an older turn that
        // predates naming would otherwise blank a name already on screen.
        if (named) setConversationTitle(named);
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
              if (event.type === "conversation.titled" && event.title) {
                const named = event.title;
                setConversationTitle(named);
                // Persist beside the run this browser already knows about, so the
                // sidebar shows the name too and the next workspace refresh — which
                // rebuilds every title from prompt text — cannot undo it.
                const sidebarChat = loadChatHistory({ includeDemo: false, includeArchived: true }).find(
                  (chat) => chat.id === taskId || chat.conversationId === conversationIdRef.current,
                );
                if (sidebarChat) updateChat(sidebarChat.id, { modelTitle: named });
              }
              if (event.type === "chat.error") {
                setError(event.message ?? "The assistant could not complete this response.");
                setStreaming(false);
                setPending(false);
                setStopping(false);
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
                setStopping(false);
              }
              if (event.type === "run.finished") {
                terminal = true;
                setPending(false);
                setStreaming(false);
                setStopping(false);
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

  async function stopRun() {
    if (stopping || (!streaming && !pending)) return;
    setStopping(true);
    setError(null);
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(taskId)}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          detail?: string;
          error?: string;
        } | null;
        throw new Error(
          payload?.detail
          ?? payload?.error
          ?? `Run could not be stopped (${response.status})`,
        );
      }
      // The event stream receives the durable run.finished/cancelled event and
      // updates the page in place. Do not navigate or delete the conversation.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run could not be stopped");
      setStopping(false);
    }
  }

  async function submitFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt) return;
    // The composer stays editable during a turn — drafting the next question
    // while reading the answer is the normal way to use this — but a turn is a
    // run and runs are sequential. Say so instead of swallowing the keystroke,
    // which is what this did while the box was simply disabled.
    if (pending) {
      setError("One response at a time. Stop the current one, or wait for it to finish.");
      return;
    }
    if (!conversationId) {
      setError("The conversation is still loading. Try again in a moment.");
      return;
    }
    setPending(true);
    setError(null);
    // Show the message immediately and empty the box. Each turn is a new run id,
    // so the sent text has no turn to live in until /conversation answers — it
    // used to disappear for that whole round trip while still sitting in the
    // composer, which read as the send having failed.
    setPendingPrompt(taskPrompt);
    setPrompt("");
    const sentAttachments = attachments;
    setAttachments([]);
    const attachmentBlocks = sentAttachments.map((attachment) => `\n\n--- Attachment: ${attachment.name} ---\n${attachment.content}`).join("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: `${taskPrompt}${attachmentBlocks}`,
          conversation_id: conversationId,
          // Both were silently dropped on every follow-up: the composer offered
          // neither control here, so a conversation could never be told to
          // execute, and every turn was submitted as Qiskit whatever the user
          // had picked on the way in.
          mode,
          framework,
        }),
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
          ...(conversationTitle ? { modelTitle: conversationTitle } : {}),
          prompt: turns[0]?.prompt ?? taskPrompt,
          createdAt: new Date().toISOString(),
          status: "queued",
        });
      }
      router.replace(`/run/${payload.id}`, { scroll: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message submission failed");
      setPending(false);
      // The turn never started, so put the text back rather than losing it.
      setPrompt((current) => current || taskPrompt);
      setAttachments((current) => (current.length ? current : sentAttachments));
      setPendingPrompt(null);
    }
  }

  const settledTurn = turns.find((turn) => turn.id === taskId);
  // `pendingPrompt` covers the window between send and the first /conversation
  // response; `existingChat.prompt` still covers a cold open of a run whose
  // conversation has not loaded yet.
  const activePrompt = settledTurn?.prompt ?? pendingPrompt ?? existingChat?.prompt;
  const showActiveUser = Boolean(activePrompt && !settledTurn);

  useEffect(() => {
    // The server's copy of the turn has arrived; the optimistic one would now be
    // a duplicate.
    if (settledTurn) setPendingPrompt(null);
  }, [settledTurn]);

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
              {/* Stop used to live here, and only when this browser happened to
                  have the conversation in local history — so on a cold open of a
                  running turn there was no way to cancel at all. It is now the
                  composer's send button, which is where a reader's hand already
                  is and which does not depend on localStorage. */}
              {!fixtureEvents && existingChat ? (
                <button className="mj-secondary-button" type="button" onClick={() => { archiveChat(existingChat.id, existingChat); router.push("/run"); }}>Archive</button>
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
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} turnId={turn.id} />
                ) : turn.id === taskId && pending ? (
                  <AssistantLoading turnId={turn.id} />
                ) : null}
              </div>
            ))}
            {showActiveUser ? (
              <div className="mj-chat-turn">
                <div className="mj-chat-message mj-chat-message--user"><ChatMarkdown source={activePrompt ?? ""} /></div>
                {streamingText || reasoningText || liveEvents.length > 0 ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} turnId={taskId} />
                ) : pending ? <AssistantLoading turnId={taskId} /> : null}
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
        mode={mode}
        onModeChange={setMode}
        framework={framework}
        onFrameworkChange={setFramework}
        onStop={fixtureEvents ? undefined : () => void stopRun()}
        stopping={stopping}
      />
    </div>
  );
}

export function CompletedAssistant({ turn }: { turn: Turn }) {
  // Failure context and the best produced output are separate concerns. A rejected
  // candidate still remains inspectable after the reason it was rejected.
  const activity = runActivityFromEvents(turn.events, false);
  const result = runResultFromEvents(turn.events, turn.verificationSummary);
  const outcome = runOutcomeFromEvents(turn.events, turn.verificationSummary);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${activity || result || outcome ? " mj-chat-message--run" : ""}`}>
      {chatFallbackNotice(turn.events) ? <ChatFallbackNotice /> : null}
      {activity ? <RunActivityBlock activity={activity} events={turn.events} /> : null}
      {!result && outcomeWithoutDuplicateCode && turn.events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={turn.events} runId={turn.id} />
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
  turnId,
}: {
  reasoning: string;
  text: string;
  streaming: boolean;
  events: WireEvent[];
  turnId?: string | null;
}) {
  const activity = runActivityFromEvents(events, streaming);
  const result = runResultFromEvents(events);
  const outcome = runOutcomeFromEvents(events);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  // Both streams are paced rather than painted in the worker's 160-character
  // lumps. The answer settles when the stream closes; the reasoning settles as
  // soon as answer text starts, because the model has stopped adding to it.
  const smoothedText = useSmoothedText(text, !streaming);
  const smoothedReasoning = useSmoothedText(reasoning, !streaming || Boolean(text));
  // null until the reader expresses a preference; see the <details> below.
  const [thoughtOpen, setThoughtOpen] = useState<boolean | null>(null);
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${activity ? " mj-chat-message--run" : ""}`}>
      {chatFallbackNotice(events) ? <ChatFallbackNotice /> : null}
      {reasoning ? (
        // Open while it is the only thing there is to read, and folded away by
        // the answer arriving — the thought is context for the answer, not a
        // second answer to scroll past every time. `open` is derived only until
        // the reader touches it: a streaming turn re-renders many times a
        // second, so a plain derived `open` would slam the panel shut again
        // every frame after they opened it.
        <details
          className="mj-chat-thinking"
          open={thoughtOpen ?? (streaming && !text)}
          onToggle={(event) => setThoughtOpen(event.currentTarget.open)}
        >
          <summary>
            {streaming && !text
              ? <ThinkingLabel turnId={turnId} className="mj-chat-thinking-label" />
              : <span className="mj-chat-thinking-word">Thought for a moment</span>}
          </summary>
          <ChatMarkdown source={smoothedReasoning} />
        </details>
      ) : null}
      {activity ? <RunActivityBlock activity={activity} events={events} /> : null}
      {!result && outcomeWithoutDuplicateCode && events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={events} runId={turnId} />
      ) : outcomeWithoutDuplicateCode ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} action={<ArtifactLink events={events} />} />
      ) : text ? (
        <ChatMarkdown source={smoothedText} />
      ) : activity ? null : (
        <ThinkingLabel turnId={turnId} className="mj-chat-message--loading mj-chat-thinking-label" />
      )}
      {!result && !outcomeWithoutDuplicateCode ? <ArtifactLink events={events} /> : null}
    </div>
  );
}

function FinalOutput({
  result,
  events,
  runId,
}: {
  result: NonNullable<ReturnType<typeof runResultFromEvents>>;
  events: WireEvent[];
  runId?: string | null;
}) {
  const accepted = events.some(
    (event) => event.type === "run.finished" && event.status === "succeeded",
  );
  const heading = accepted ? "Final Output" : "Best available result";
  return (
    <section
      className="mj-run-final-output"
      aria-label={heading}
      data-run-final-output={runId ?? undefined}
    >
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {heading} ready. {result.trust.label}.
      </span>
      <header className="mj-run-final-output-heading">
        <span
          className="mj-run-final-output-marker"
          data-tone={result.trust.tone}
          aria-hidden="true"
        >
          {result.trust.tone === "ok" ? "✓" : "–"}
        </span>
        <div>
          <span>{accepted ? "Deliverable" : "Result preserved"}</span>
          <h2>{heading}</h2>
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

/**
 * "You asked for this to be run and it was answered in prose instead."
 *
 * `auto` is the composer's default, so every message is classified before it
 * dispatches, and when that classification cannot be made — the router is down,
 * or its verdict is unreadable — the run resolves to chat. That is the right
 * default; silently starting an execution on a guess is worse. But it was
 * invisible: `run.mode_resolved` is emitted and logged, and the only code in the
 * repo that rendered it was a dev-only fixtures page, so a user who asked for a
 * circuit and got an essay had nothing on screen telling them why.
 *
 * Only the `fallback` source is surfaced. A classifier that decided chat decided
 * it from the message, and annotating every conversational answer with a note
 * about routing would be noise on the common path.
 */
function chatFallbackNotice(events: WireEvent[]): boolean {
  const resolved = lastEvent(events, "run.mode_resolved");
  return Boolean(
    resolved
    && (resolved as { source?: string }).source === "fallback"
    && (resolved as { resolved?: string }).resolved === "chat"
    && (resolved as { requested?: string }).requested !== "chat",
  );
}

function ChatFallbackNotice() {
  return (
    <p className="mj-run-fallback-notice" role="status">
      Answered in chat. The router could not classify this message, so it was not
      run — resend it with <strong>Execute</strong> selected to run it.
    </p>
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
  const chart = total ? simulationChartData(Object.fromEntries(countEntries), total) : null;
  const scalarEntries = result
    ? Object.entries(result).filter(
      ([key, value]) => key !== "counts" && ["string", "number", "boolean"].includes(typeof value),
    )
    : [];

  return (
    <div className="mj-run-live-simulation">
      <section>
        <div className="mj-run-activity-section-head">
          <strong>Structured result</strong>
          <span>{event.exit_code === 0 ? "Execution passed" : "Execution output"}</span>
        </div>
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
        {chart ? (
          // Every other counts chart in the product goes through simulationChartData
          // and formatShare. This one had its own sort, no cap on how many bars it
          // would draw, and its own `toFixed(1)` — so a 12-qubit circuit drew
          // hundreds of rows here and a dozen everywhere else, with the percentages
          // rounded differently in each. role="group" rather than role="img": every
          // bitstring, count and percentage below is real text, and role="img"
          // hid all of it behind a label that only said counts exist.
          <div className="mj-run-live-chart" role="group" aria-label={`Measured counts from ${total.toLocaleString()} shots`}>
            {chart.bars.map((bar) => (
              <div className="mj-run-live-bar" key={bar.bitstring}>
                <code>{bar.bitstring}</code>
                <span className="mj-run-live-bar-track" aria-hidden="true">
                  <span style={{ width: `${(bar.count / chart.peak.count) * 100}%` }} />
                </span>
                <span>
                  {bar.count.toLocaleString()}
                  <small>{formatShare(bar.share, "en-US")}</small>
                </span>
              </div>
            ))}
            {chart.otherStates ? (
              <p className="mj-run-live-chart-note">
                {`Showing the ${chart.bars.length} heaviest of ${chart.distinctStates.toLocaleString()} measured outcomes.`}
              </p>
            ) : null}
          </div>
        ) : result && Object.keys(result).length ? (
          <pre className="mj-run-live-result-json">{JSON.stringify(result, null, 2)}</pre>
        ) : (
          <p className="mj-run-live-empty-result">
            This replay predates structured simulation values. Runtime diagnostics remain below.
          </p>
        )}
      </section>
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

function PlanStage({ event }: { event: WireEvent }) {
  const plan = event.plan;
  if (!plan) return null;
  const executionFacts = [
    ["Framework", plan.framework],
    ["Qubits", plan.qubits_estimate],
    ["Shots", plan.parameters?.shots],
    ["Seed", plan.parameters?.seed],
    ["Runtime", plan.expected_runtime_sec !== undefined ? `${plan.expected_runtime_sec} s` : null],
  ].filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "");
  const primaryMetric = plan.success_criteria?.primary_metric;
  const outputs = plan.expected_output_keys?.filter(Boolean) ?? [];
  return (
    <div className="mj-run-plan-overview">
      <header className="mj-run-plan-summary">
        <div className="mj-run-plan-copy">
          <span>Proposed approach</span>
          {plan.algorithm_rationale ? <p>{plan.algorithm_rationale}</p> : null}
        </div>
        {plan.algorithm ? (
          <div className="mj-run-plan-algorithm">
            <span>Algorithm</span>
            <strong>{plan.algorithm}</strong>
          </div>
        ) : null}
      </header>
      {executionFacts.length ? (
        <dl className="mj-run-plan-metrics">
          {executionFacts.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {primaryMetric || outputs.length ? (
        <div className="mj-run-plan-contract">
          {primaryMetric ? (
            <div>
              <span>Optimizes</span>
              <strong>{primaryMetric}</strong>
            </div>
          ) : null}
          {outputs.length ? (
            <div>
              <span>Returns</span>
              <ul aria-label="Expected outputs">
                {outputs.map((output) => <li key={output}>{output}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
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

function EventMeta({ event }: { event: WireEvent | null }) {
  if (!event) return null;
  return (
    <div className="mj-run-activity-call-meta">
      <ModelCallMeta event={event} />
    </div>
  );
}

function ResourceStage({ event }: { event: WireEvent }) {
  const entries = Object.entries(event.metrics ?? {}).filter(
    (entry): entry is [string, string | number | boolean] =>
      ["string", "number", "boolean"].includes(typeof entry[1]),
  );
  if (!entries.length) {
    return event.metrics ? <EventRecord value={event.metrics} /> : null;
  }
  return (
    <dl className="mj-run-live-facts">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt>{key.replaceAll("_", " ")}</dt>
          <dd>{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivityEmptyDetail({ state }: { state: AgentActivityState }) {
  const copy = state === "active"
    ? "Work is continuing. New evidence will appear here when it is recorded."
    : state === "error"
      ? "This operation stopped before detailed evidence was recorded."
      : state === "warn"
        ? "This operation completed with limited recorded evidence."
        : "No additional detail was recorded for this operation.";
  return (
    <div className="mj-run-live-active-copy">
      {state === "active" ? <span className="mj-run-live-pulse" aria-hidden="true" /> : null}
      {copy}
    </div>
  );
}

function CodeActivityDetail({
  detail,
  events,
  state,
}: {
  detail: Extract<RunActivityDetail, { kind: "code" }>;
  events: WireEvent[];
  state: AgentActivityState;
}) {
  const bestEffort = detail.bestEffortIndex === null ? null : events[detail.bestEffortIndex];
  const retainedAttempt = detail.attempts.find(
    (attempt) => attempt.revision === bestEffort?.revision,
  );
  const automaticIndex = retainedAttempt?.eventIndex
    ?? detail.eventIndex
    ?? detail.bestEffortIndex;
  const [selectedIndex, setSelectedIndex] = useState<number | null>(automaticIndex);
  const [copied, setCopied] = useState(false);
  const selectionTouched = useRef(false);

  useEffect(() => {
    if (!selectionTouched.current) setSelectedIndex(automaticIndex);
  }, [automaticIndex]);

  const source = selectedIndex === null ? null : events[selectedIndex];
  const selectedRevision = source?.revision
    ?? detail.attempts.find((attempt) => attempt.eventIndex === selectedIndex)?.revision;
  const call = selectedIndex === null
    ? detail.callIndex === null ? null : events[detail.callIndex]
    : llmCallBefore(events, selectedIndex, "generate");

  async function copySource() {
    if (!source?.code) return;
    try {
      await navigator.clipboard.writeText(source.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mj-run-activity-detail-stack">
      {detail.attempts.length > 1 || bestEffort?.candidates_considered ? (
        <div className="mj-run-attempt-history">
          <div className="mj-run-activity-section-head">
            <strong>Repair history</strong>
            {bestEffort?.candidates_considered ? (
              <span>{bestEffort.candidates_considered} candidates considered</span>
            ) : null}
          </div>
          {detail.attempts.length ? (
            <ol>
              {detail.attempts.map((attempt) => (
                <li data-state={attempt.state} key={`${attempt.revision}-${attempt.eventIndex}`}>
                  <span aria-hidden="true">
                    {attempt.state === "done" ? "✓" : attempt.state === "error" ? "×" : "–"}
                  </span>
                  <strong>Revision {attempt.revision}</strong>
                  <small>{attempt.status}</small>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      {bestEffort?.critic_summary ? (
        <p className="mj-run-live-empty-result">{bestEffort.critic_summary}</p>
      ) : null}
      <section>
        <div className="mj-run-activity-section-head mj-run-code-section-head">
          <div>
            <strong>Candidate source</strong>
            {selectedRevision ? <span>Revision {selectedRevision}</span> : null}
          </div>
          <div className="mj-run-code-actions">
            {detail.attempts.length > 1 ? (
              <label>
                <span className="sr-only">Displayed code revision</span>
                <select
                  aria-label="Displayed code revision"
                  value={selectedIndex ?? ""}
                  onChange={(event) => {
                    selectionTouched.current = true;
                    setSelectedIndex(Number(event.target.value));
                    setCopied(false);
                  }}
                >
                  {detail.attempts.map((attempt) => (
                    <option key={`${attempt.revision}-${attempt.eventIndex}`} value={attempt.eventIndex}>
                      Revision {attempt.revision} · {attempt.status}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {source?.code ? (
              <button className="mj-secondary-button" type="button" onClick={() => void copySource()}>
                {copied ? "Copied" : "Copy code"}
              </button>
            ) : null}
          </div>
        </div>
        {source?.code ? <CodeStage event={source} /> : <ActivityEmptyDetail state={state} />}
        <EventMeta event={call} />
      </section>
    </div>
  );
}

function ChecksActivityDetail({
  detail,
  events,
  state,
}: {
  detail: Extract<RunActivityDetail, { kind: "checks" }>;
  events: WireEvent[];
  state: AgentActivityState;
}) {
  const screen = detail.screenIndex === null ? null : events[detail.screenIndex];
  const resources = detail.resourceIndex === null ? null : events[detail.resourceIndex];
  if (!screen && !resources) return <ActivityEmptyDetail state={state} />;
  return (
    <div className="mj-run-activity-detail-stack">
      {screen ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>Code checks</strong></div>
          <ScreenStage event={screen} />
        </section>
      ) : null}
      {resources ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>Resource estimate</strong></div>
          <ResourceStage event={resources} />
        </section>
      ) : null}
    </div>
  );
}

function checkState(event: WireEvent): "done" | "warn" | "error" {
  const outcome = String(event.result ?? event.decision ?? "unavailable");
  if (outcome === "pass" || outcome === "ready") return "done";
  if (outcome === "fail" || outcome === "error") return "error";
  return "warn";
}

function checkStatus(event: WireEvent): string {
  const outcome = String(event.result ?? event.decision ?? "unavailable");
  if (outcome === "pass" || outcome === "ready") return "Passed";
  if (outcome === "fail" || outcome === "error") return "Failed";
  if (outcome === "code_repair") return "Repair requested";
  if (outcome === "replan") return "Replan requested";
  if (outcome === "skipped") return "Skipped";
  if (outcome === "inconclusive") return "Inconclusive";
  return "Unavailable";
}

function VerificationRow({
  event,
  label,
  children,
}: {
  event: WireEvent;
  label: string;
  children?: ReactNode;
}) {
  const state = checkState(event);
  return (
    <li data-state={state}>
      <span aria-hidden="true">{state === "done" ? "✓" : state === "error" ? "×" : "–"}</span>
      <div>
        <strong>{label}</strong>
        <small>{checkStatus(event)}</small>
        {children}
      </div>
    </li>
  );
}

function VerificationActivityDetail({
  detail,
  events,
  state,
}: {
  detail: Extract<RunActivityDetail, { kind: "verification" }>;
  events: WireEvent[];
  state: AgentActivityState;
}) {
  const review = detail.reviewIndex === null ? null : events[detail.reviewIndex];
  const strict = detail.strictIndex === null ? null : events[detail.strictIndex];
  if (!detail.eventIndices.length && !review && !strict) {
    return <ActivityEmptyDetail state={state} />;
  }
  return (
    <ol className="mj-run-verification-list">
      {detail.eventIndices.map((index) => {
        const event = events[index];
        const label = event.method && VERIFICATION_METHOD_LABEL[event.method]
          ? VERIFICATION_METHOD_LABEL[event.method]
          : `Verification: ${event.method ?? "check"}`;
        return (
          <VerificationRow event={event} key={`${event.seq ?? index}-${event.method ?? "check"}`} label={label}>
            {event.details ? (
              <details className="mj-run-verification-evidence">
                <summary>Evidence</summary>
                <EventRecord value={event.details} />
              </details>
            ) : null}
          </VerificationRow>
        );
      })}
      {review ? (
        <VerificationRow event={review} label="Intent and result alignment">
          <ReviewStage event={review} />
          <EventMeta event={llmCallBefore(events, detail.reviewIndex ?? 0, "verify", "review")} />
        </VerificationRow>
      ) : null}
      {strict ? (
        <VerificationRow event={strict} label="Strict acceptance review">
          <StrictVerificationStage event={strict} />
        </VerificationRow>
      ) : null}
    </ol>
  );
}

function CompilationActivityDetail({
  detail,
  events,
  state,
}: {
  detail: Extract<RunActivityDetail, { kind: "compilation" }>;
  events: WireEvent[];
  state: AgentActivityState;
}) {
  const compilation = detail.eventIndex === null ? null : events[detail.eventIndex];
  const resources = detail.resourceIndex === null ? null : events[detail.resourceIndex];
  if (!compilation && !resources) return <ActivityEmptyDetail state={state} />;
  return (
    <div className="mj-run-activity-detail-stack">
      {compilation ? <CompilationStage event={compilation} /> : null}
      {resources ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>Compiled resources</strong></div>
          <ResourceStage event={resources} />
        </section>
      ) : null}
    </div>
  );
}

const FINALIZE_LABEL: Record<string, string> = {
  "code.finalized": "Final code selected",
  "sandbox.result": "Final simulation",
  "baseline.result": "Reference comparison",
  "run.analysis": "Result analysis",
  "artifact.saved": "Result package created",
  "run.best_effort": "Best available candidate retained",
};

function finalizeState(event: WireEvent): "done" | "warn" | "error" {
  if (event.type === "run.best_effort" || event.not_applicable_reason) return "warn";
  if (event.type === "sandbox.result" && event.exit_code !== 0) return "error";
  return "done";
}

function finalizeStatus(event: WireEvent): string {
  if (event.type === "run.best_effort") return "Not accepted";
  if (event.not_applicable_reason) return "Not applicable";
  if (event.type === "sandbox.result") return event.exit_code === 0 ? "Passed" : "Failed";
  if (event.type === "artifact.saved") return "Packaged";
  if (event.type === "code.finalized" && event.revision) return `Revision ${event.revision}`;
  return "Complete";
}

function FinalizeActivityDetail({
  detail,
  events,
  state,
}: {
  detail: Extract<RunActivityDetail, { kind: "finalize" }>;
  events: WireEvent[];
  state: AgentActivityState;
}) {
  const indices = [...detail.eventIndices];
  if (detail.bestEffortIndex !== null && !indices.includes(detail.bestEffortIndex)) {
    indices.push(detail.bestEffortIndex);
  }
  if (!indices.length) return <ActivityEmptyDetail state={state} />;
  indices.sort((left, right) => left - right);
  return (
    <ol className="mj-run-finalize-list">
      {indices.map((index) => {
        const event = events[index];
        const state = finalizeState(event);
        const explanation = event.type === "run.analysis"
          ? event.interpretation ?? event.summary
          : event.type === "run.best_effort"
            ? event.critic_summary
            : event.not_applicable_reason;
        return (
          <li data-state={state} key={`${event.seq ?? index}-${event.type}`}>
            <span aria-hidden="true">{state === "done" ? "✓" : state === "error" ? "×" : "–"}</span>
            <div>
              <strong>{FINALIZE_LABEL[event.type] ?? event.type}</strong>
              <small>{finalizeStatus(event)}</small>
              {explanation ? <p>{explanation}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function RunActivityDetailPanel({
  item,
  events,
}: {
  item: AgentActivityItem<RunActivityDetail>;
  events: WireEvent[];
}) {
  const detail = item.detail;
  if (detail.kind === "plan") {
    const index = detail.eventIndices.at(-1);
    const event = index === undefined ? null : events[index];
    const call = detail.callIndex === null ? null : events[detail.callIndex];
    return event ? (
      <div className="mj-run-activity-detail-stack">
        <section className="mj-run-plan-section">
          <PlanStage event={event} />
          <EventMeta event={call} />
        </section>
      </div>
    ) : <ActivityEmptyDetail state={item.state} />;
  }
  if (detail.kind === "code") {
    return <CodeActivityDetail detail={detail} events={events} state={item.state} />;
  }
  if (detail.kind === "checks") {
    return <ChecksActivityDetail detail={detail} events={events} state={item.state} />;
  }
  if (detail.kind === "execution") {
    const event = detail.eventIndex === null ? null : events[detail.eventIndex];
    return event
      ? <SimulationResult event={event} />
      : <ActivityEmptyDetail state={item.state} />;
  }
  if (detail.kind === "verification") {
    return (
      <VerificationActivityDetail detail={detail} events={events} state={item.state} />
    );
  }
  if (detail.kind === "compilation") {
    return (
      <CompilationActivityDetail detail={detail} events={events} state={item.state} />
    );
  }
  return <FinalizeActivityDetail detail={detail} events={events} state={item.state} />;
}

function RunActivityBlock({
  activity,
  events,
}: {
  activity: NonNullable<ReturnType<typeof runActivityFromEvents>>;
  events: WireEvent[];
}) {
  return (
    <AgentActivity
      activity={activity}
      renderDetail={(item) => <RunActivityDetailPanel events={events} item={item} />}
    />
  );
}

/**
 * Keep this result, or go to it if it is already kept.
 *
 * A finished run always materializes its artifact — the conversion tabs below
 * read the saved version, and the next turn in this conversation forks from it —
 * but it is not filed in the Vault until the user says so (migration 0036). So
 * this control has to know which state it is in, which the run events cannot
 * say: `artifact.saved` is emitted for kept and unkept alike. Hence the fetch.
 *
 * While that fetch is in flight nothing is rendered rather than guessing a
 * label, because guessing wrong means offering to keep something already kept.
 */
function ArtifactLink({ events }: { events: WireEvent[] }) {
  const artifactId = artifactIdFromEvents(events);
  const [kept, setKept] = useState<boolean | null>(null);
  const [keeping, setKeeping] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!artifactId) return;
    let active = true;
    setKept(null);
    fetch(`/api/artifacts/${artifactId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { kept_at?: string | null } | null) => {
        if (!active) return;
        // A failed lookup leaves this null and renders nothing: the artifact is
        // safe either way, and a wrong button is worse than no button.
        if (payload) setKept(Boolean(payload.kept_at));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [artifactId]);

  if (!artifactId || kept === null) return null;

  if (kept) {
    return (
      <Link className="mj-secondary-button" href={`/library/${artifactId}`}>
        View in Vault →
      </Link>
    );
  }

  async function keep() {
    if (keeping) return;
    setKeeping(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/artifacts/${artifactId}/keep`, { method: "POST" });
      if (!response.ok) throw new Error("keep failed");
      setKept(true);
    } catch {
      setFailed(true);
    } finally {
      setKeeping(false);
    }
  }

  return (
    <span className="mj-run-keep">
      <button className="mj-secondary-button" type="button" disabled={keeping} onClick={keep}>
        {keeping ? "Keeping…" : "Keep in Vault"}
      </button>
      {failed ? (
        <small role="alert">Could not keep this — try again.</small>
      ) : (
        <small>Not saved to your Vault yet.</small>
      )}
    </span>
  );
}

function AssistantLoading({ turnId }: { turnId?: string | null }) {
  return (
    <div className="mj-chat-message mj-chat-message--assistant mj-chat-message--loading" aria-label="Waiting for response">
      <ThinkingLabel turnId={turnId} />
    </div>
  );
}
