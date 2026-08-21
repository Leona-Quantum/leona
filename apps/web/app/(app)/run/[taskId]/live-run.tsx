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
import { runToFollow } from "../../../../lib/conversation-follow";
import { refusalSentence } from "../../../../lib/api-error.ts";
import { QUEUE_POLL_INTERVAL_MS, isWaitingForWorker, queuePositionLabel } from "../../../../lib/queue-position";
import { archiveChat, loadChatHistory, rememberChat, updateChat, type ChatSummary } from "../../../../lib/chat-history";
import { displayChatTitle, titleFromPrompt } from "../../../../lib/chat-title";
import { RunComposer, type ComposerFramework } from "../../../../components/run-composer";
import { hydrateConversationFramework } from "../../../../lib/framework-selection";
import type { ComposerMode } from "../../../../lib/run-mode";
import { RUN_FIXTURES } from "./fixtures";
import { verificationSummaryFromValue, type VerificationSummary } from "../../../../lib/verification-record";
import { friendlyFailure, runOutcomeFromEvents } from "../../../../lib/run-outcome";
import { runResultFromEvents } from "../../../../lib/run-result";
import { RunResult } from "../../../../components/run-result";
import { ResultVisualizations } from "../../../../components/result-visualization";
import {
  runActivityFromEvents,
  type RunActivityDetail,
} from "../../../../lib/run-activity";
import { resultVisualizationFromResult } from "../../../../lib/result-visualization";
import { ThinkingLabel } from "../../../../components/thinking-label";
import { useSmoothedText } from "../../../../components/use-smoothed-text";
import type { PublicLocale } from "../../../../lib/public-locale";
import {
  contextualReviewFollowUps,
  followUpPrompts,
  splitAssistantFollowUps,
  type FollowUpPromptKind,
} from "../../../../lib/follow-up-prompts";

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
  resolved?: string;
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
  missing_inputs?: string[];
  allow_ai_assumptions_available?: boolean;
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
      suggested_follow_ups?: string[];
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

const VERIFICATION_METHOD_LABEL_JA: Record<string, string> = {
  return_contract: "戻り値契約を確認",
  statistical: "測定分布を照合",
  statistical_native: "信頼できる再実行結果と比較",
  exact: "参照値と比較",
  exact_diag: "Hamiltonianを厳密対角化して比較",
  brute_force: "古典的な全探索と比較",
  statistical_reproducibility: "回路を再実行して比較",
  resource_contract: "量子ビット・リソース使用量を確認",
  measurement_policy: "測定範囲を確認",
  success_criteria: "成功条件を確認",
  structural: "回路構造を確認",
  native_optimization_evidence: "ネイティブ最適化を確認",
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
    run: {
      id: string;
      task_prompt: string;
      conversation_id: string;
      framework?: string;
      verification_summary?: unknown;
      finished_at?: string | null;
    };
    events: WireEvent[];
  }>;
};

export type Turn = {
  id: string;
  prompt: string;
  answer: string | null;
  followUps: string[];
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

function answerFromEvents(events: WireEvent[], locale: PublicLocale = "en"): string | null {
  const completed = [...events].reverse().find((event) => event.type === "chat.completed" && event.text);
  if (completed?.text) return splitAssistantFollowUps(completed.text).answer;
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
    return locale === "ja"
      ? "実行は正常に完了しませんでした。詳細は実行イベントを確認してください。"
      : "The run did not complete successfully. Check the run's events for details.";
  }
  return null;
}

function followUpsFromEvents(events: WireEvent[]): string[] {
  const completed = [...events].reverse().find(
    (event) => event.type === "chat.completed" && event.text,
  );
  if (completed?.text) {
    const prompts = splitAssistantFollowUps(completed.text).prompts;
    if (prompts.length >= 2) return prompts;
  }
  return contextualReviewFollowUps(events);
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

function turnsFromConversation(payload: ConversationPayload, locale: PublicLocale = "en"): Turn[] {
  return payload.turns.map((turn) => {
    const events = turn.events.filter(retainRunEvent);
    return {
      id: turn.run.id,
      prompt: turn.run.task_prompt,
      answer: answerFromEvents(events, locale),
      followUps: followUpsFromEvents(events),
      events,
      verificationSummary: verificationSummaryFromValue(turn.run.verification_summary),
      terminal: Boolean(turn.run.finished_at) || hasFinished(events),
    };
  });
}

function fixtureTurns(events: RunEvent[], fixtureId?: string, locale: PublicLocale = "en"): Turn[] {
  const queued = events.find((event) => event.type === "run.queued");
  const wireEvents = events as WireEvent[];
  return [{
    id: fixtureId ?? queued?.run_id ?? "example",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and verify the cut value.",
    answer: answerFromEvents(wireEvents, locale),
    followUps: followUpsFromEvents(wireEvents),
    events: wireEvents,
    verificationSummary: verificationSummaryFromValue(events.find((event) => event.type === "run.finished")?.verification_summary),
    terminal: hasFinished(wireEvents),
  }];
}

export function LiveRun({ taskId, locale = "en" }: { taskId: string; locale?: PublicLocale }) {
  const router = useRouter();
  const fixtureEvents = RUN_FIXTURES[taskId] ?? null;
  const fixtureIsTerminal = Boolean(
    fixtureEvents?.some((event) => event.type === "run.finished"),
  );
  const [turns, setTurns] = useState<Turn[]>(
    fixtureEvents ? fixtureTurns(fixtureEvents, taskId, locale) : [],
  );
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [streaming, setStreaming] = useState(!fixtureEvents || !fixtureIsTerminal);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(Boolean(fixtureEvents && !fixtureIsTerminal));
  // Claimable runs ahead of this one, or null for "we are not claiming to know"
  // (ai-ops#91). Null is also what a failed poll sets — see the effect below.
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
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
  const frameworkTouched = useRef(false);
  // The run this page is following. It starts as the one in the URL and then
  // tracks the conversation's newest turn — see lib/conversation-follow.ts for
  // why the URL is not that run for most of a conversation's life.
  const [activeRunId, setActiveRunId] = useState(taskId);
  const activeRunIdRef = useRef(taskId);
  const lastEventId = useRef<number | null>(null);
  const loadSeq = useRef(0);
  const conversationIdRef = useRef<string | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const composerInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldAutoScrollRef = useRef(true);

  /** Move the page onto a run, synchronously for readers inside async callbacks. */
  function followRun(runId: string) {
    activeRunIdRef.current = runId;
    setActiveRunId(runId);
  }

  useEffect(() => {
    const found = loadChatHistory({ includeArchived: true }).find(
      (item) => item.id === taskId || item.conversationId === conversationId,
    ) ?? null;
    // Hold the current row while a follow-up is in flight: `conversationId` is
    // briefly null while the conversation reloads, and dropping the row there is
    // what made the header flash from the conversation's name to the raw text of
    // its first prompt on every message.
    setExistingChat((current) => found ?? (conversationId === null ? current : null));
  }, [conversationId, taskId]);

  const title = conversationTitle
    ?? (existingChat ? displayChatTitle(existingChat) : null)
    ?? (turns[0]?.prompt ? titleFromPrompt(turns[0].prompt) : null)
    ?? (locale === "ja" ? "量子チャット" : "Quantum chat");

  useEffect(() => {
    conversationIdRef.current = null;
    setConversationId(null);
    setStopping(false);
    frameworkTouched.current = false;
    setFramework("qiskit");
    followRun(taskId);
    shouldAutoScrollRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- followRun is stable by construction
  }, [taskId]);

  // A conversation opens at its end and stays there while it grows.
  //
  // The second pin is not superstition: the thread keeps growing after the
  // render that placed us at the end commits — markdown, highlighted code and
  // the result panel each settle a beat later, and all of them add height below
  // the fold, which leaves the reader short of the newest message. A timer
  // rather than requestAnimationFrame or ResizeObserver deliberately: neither
  // runs while the tab is hidden, and a conversation left open in a background
  // tab is exactly where the rest of a turn arrives. `onScroll` still owns the
  // preference — scroll up and both pins stop.
  useEffect(() => {
    const scrollContainer = chatScrollRef.current;
    if (!scrollContainer || !shouldAutoScrollRef.current) return;
    scrollContainer.scrollTop = scrollContainer.scrollHeight;
    const settle = setTimeout(() => {
      if (!shouldAutoScrollRef.current) return;
      scrollContainer.scrollTop = scrollContainer.scrollHeight;
    }, 120);
    return () => clearTimeout(settle);
  }, [taskId, activeRunId, turns, streamingText, reasoningText, liveEvents.length, pending]);

  useEffect(() => {
    if (fixtureEvents) return;
    const followedRunId = activeRunId;
    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    setLiveEvents([]);
    setStreamingText("");
    setReasoningText("");
    setError(null);
    lastEventId.current = null;

    async function loadConversation() {
      const seq = ++loadSeq.current;
      const response = await fetch(`/api/runs/${encodeURIComponent(followedRunId)}/conversation`, {
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
        setTurns(turnsFromConversation(payload, locale));
        const named = conversationTitleFromPayload(payload);
        // A reload has no live stream to learn the name from, so it comes off
        // the durable events. Only ever set, never cleared: an older turn that
        // predates naming would otherwise blank a name already on screen.
        if (named) setConversationTitle(named);
        // Follow the conversation, not the URL. Anything that re-enters a
        // conversation — the sidebar, a bookmark, a reload after switching tabs —
        // names its FIRST run, and that run has been finished for as long as the
        // conversation has had a second turn. Whether a turn is still generating
        // is a property of the newest one.
        const newest = payload.turns.at(-1);
        setFramework((current) => hydrateConversationFramework(
          current,
          frameworkTouched.current,
          newest?.run.framework,
        ));
        const follow = runToFollow(payload.turns.map((turn) => turn.run.id), activeRunIdRef.current);
        if (newest && follow === newest.run.id) {
          if (follow !== activeRunIdRef.current) followRun(follow);
          setPending(
            !(Boolean(newest.run.finished_at) || hasFinished(newest.events))
            && !answerFromEvents(newest.events, locale),
          );
        }
      }
    }

    async function consume() {
      void loadConversation().catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : locale === "ja" ? "会話を読み込めませんでした" : "Conversation could not be loaded");
      });

      while (!controller.signal.aborted) {
        try {
          const headers: Record<string, string> = {};
          if (lastEventId.current !== null) headers["Last-Event-ID"] = String(lastEventId.current);
          const response = await fetch(`/api/runs/${encodeURIComponent(followedRunId)}/events/stream`, {
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
                setError(locale === "ja"
                  ? friendlyFailure(event.message, event.stage, event.code, locale)
                  : event.message ?? "The assistant could not complete this response.");
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
                    setError(cause instanceof Error ? cause.message : locale === "ja" ? "会話を再読み込みできませんでした" : "Conversation could not be reloaded");
                  }
                });
              }
            }
          }
          if (terminal) return;
          throw new Error("Response stream ended before the response finished");
        } catch (cause) {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : locale === "ja" ? "応答ストリームに失敗しました" : "Response stream failed");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- taskId is read only for the sidebar row's identity; the stream follows activeRunId
  }, [fixtureEvents, activeRunId, taskId]);

  /**
   * How many runs are ahead of this one, while it is still waiting.
   *
   * A poll rather than a stream event, and that is forced rather than chosen:
   * the SSE stream emits `run.queued` and then nothing at all until
   * `run.started`, so the entire wait is a period with no events. There is
   * nothing to push a changing number down.
   *
   * ## A stale position is worse than none
   *
   * The stream reconnects on a 1s loop and does not blank the screen, so a
   * number left over from before a drop would sit there looking live. Every
   * exit from this effect therefore clears it: a failed fetch, a non-OK
   * response, a run that is no longer queued, and unmount. The user then sees
   * the plain waiting state, which is honest, instead of "3 runs ahead" frozen
   * from four minutes ago.
   *
   * Deliberately no time estimate. See `lib/queue-position.ts`.
   */
  useEffect(() => {
    if (fixtureEvents) return;
    const runId = activeRunId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const payload = (await response.json()) as { status?: string; queue_position?: number | null };
        if (cancelled) return;
        if (!isWaitingForWorker(payload.status)) {
          setQueuePosition(null);
          return;
        }
        setQueuePosition(payload.queue_position ?? null);
        timer = setTimeout(() => void poll(), QUEUE_POLL_INTERVAL_MS);
      } catch {
        // Whatever went wrong, we can no longer stand behind the last number.
        if (!cancelled) setQueuePosition(null);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      setQueuePosition(null);
    };
  }, [fixtureEvents, activeRunId]);

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
          errors.push(locale === "ja" ? `${file.name}を読み取れませんでした。` : `${file.name} could not be read.`);
        }
      }
      const nextByName = new Map(attachments.map((item) => [item.name, item]));
      for (const candidate of candidates) {
        if (!nextByName.has(candidate.name) && nextByName.size >= 4) {
          errors.push(locale === "ja" ? "1メッセージにつき添付は4件までです。" : "Up to 4 attachments per message.");
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
      const response = await fetch(`/api/runs/${encodeURIComponent(activeRunIdRef.current)}/cancel`, {
        method: "POST",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as unknown;
        throw new Error(
          refusalSentence(payload) ?? `Run could not be stopped (${response.status})`,
        );
      }
      // The event stream receives the durable run.finished/cancelled event and
      // updates the page in place. Do not navigate or delete the conversation.
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : locale === "ja" ? "実行を停止できませんでした" : "Run could not be stopped");
      setStopping(false);
    }
  }

  async function submitFollowup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await sendFollowup(prompt.trim(), false);
  }

  async function sendFollowup(taskPrompt: string, allowAssumptions: boolean) {
    if (!taskPrompt) return;
    // The composer stays editable during a turn — drafting the next question
    // while reading the answer is the normal way to use this — but a turn is a
    // run and runs are sequential. Say so instead of swallowing the keystroke,
    // which is what this did while the box was simply disabled.
    if (pending) {
      setError(locale === "ja" ? "一度に実行できる応答は1件です。現在の応答を停止するか、完了までお待ちください。" : "One response at a time. Stop the current one, or wait for it to finish.");
      return;
    }
    if (!conversationId) {
      setError(locale === "ja" ? "会話を読み込み中です。少し待ってから再試行してください。" : "The conversation is still loading. Try again in a moment.");
      return;
    }
    const previousRunId = activeRunIdRef.current;
    setPending(true);
    setError(null);
    // Show the message immediately and empty the box. Each turn is a new run id,
    // so the sent text has no turn to live in until /conversation answers — it
    // used to disappear for that whole round trip while still sitting in the
    // composer, which read as the send having failed.
    setPendingPrompt(taskPrompt);
    // A new message belongs at the end, even if the reader had scrolled up to
    // re-read something before writing it.
    shouldAutoScrollRef.current = true;
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
          mode: allowAssumptions ? "execute" : mode,
          allow_ai_assumptions: allowAssumptions,
          framework,
          response_locale: locale,
        }),
      });
      const payload = (await response.json()) as { id?: string; conversation_id?: string };
      if (!response.ok || !payload.id) {
        throw new Error(refusalSentence(payload) ?? `Message submission failed (${response.status})`);
      }
      // Follow the new turn in place. This used to `router.replace` onto the new
      // run's URL, and because the whole authed surface sits behind a
      // `loading.tsx` boundary and the run page is `force-dynamic`, every
      // message tore the conversation off the screen, showed the workspace
      // skeleton, and remounted the page — losing the scroll position and the
      // message the user had just sent. Nothing needed the URL to name the
      // newest run: /conversation answers for any run in the conversation, and
      // every link back into one names its first.
      followRun(payload.id);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : locale === "ja" ? "メッセージの送信に失敗しました" : "Message submission failed");
      // The turn never started; go back to following the one that was on screen.
      followRun(previousRunId);
      setPending(false);
      // The turn never started, so put the text back rather than losing it.
      setPrompt((current) => current || taskPrompt);
      setAttachments((current) => (current.length ? current : sentAttachments));
      setPendingPrompt(null);
    }
  }

  const settledTurn = turns.find((turn) => turn.id === activeRunId);
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

  function selectFollowUp(nextPrompt: string) {
    setPrompt(nextPrompt);
    setError(null);
    requestAnimationFrame(() => composerInputRef.current?.focus());
  }

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
              <span className="mj-chat-subtitle">
                {fixtureEvents
                  ? locale === "ja" ? "会話サンプル" : "Example conversation"
                  : streaming || pending
                    ? locale === "ja" ? "応答を生成中" : "Streaming response"
                    : locale === "ja" ? "会話" : "Conversation"}
              </span>
            </div>
            <div className="mj-run-task-actions">
              <span className="mj-run-home-status">
                <span className="mj-status-dot" aria-hidden="true" />
                {fixtureEvents ? locale === "ja" ? "サンプル" : "Example" : streaming || pending ? locale === "ja" ? "実行中" : "Live" : locale === "ja" ? "準備完了" : "Ready"}
              </span>
              {/* Stop used to live here, and only when this browser happened to
                  have the conversation in local history — so on a cold open of a
                  running turn there was no way to cancel at all. It is now the
                  composer's send button, which is where a reader's hand already
                  is and which does not depend on localStorage. */}
              {!fixtureEvents && existingChat ? (
                <button className="mj-secondary-button" type="button" onClick={() => { archiveChat(existingChat.id, existingChat); router.push("/run"); }}>{locale === "ja" ? "アーカイブ" : "Archive"}</button>
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
                  <CompletedAssistant
                    turn={turn}
                    locale={locale}
                    onFollowUp={fixtureEvents ? undefined : selectFollowUp}
                    onUseAiAssumptions={fixtureEvents ? undefined : (promptText) => void sendFollowup(promptText, true)}
                  />
                ) : turn.id === activeRunId && (streamingText || reasoningText || liveEvents.length > 0) ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} turnId={turn.id} locale={locale} />
                ) : turn.id === activeRunId && pending ? (
                  <AssistantLoading turnId={turn.id} locale={locale} queuePosition={queuePosition} />
                ) : null}
              </div>
            ))}
            {showActiveUser ? (
              <div className="mj-chat-turn">
                <div className="mj-chat-message mj-chat-message--user"><ChatMarkdown source={activePrompt ?? ""} /></div>
                {streamingText || reasoningText || liveEvents.length > 0 ? (
                  <AssistantMessage reasoning={reasoningText} text={streamingText} streaming={streaming} events={liveEvents} turnId={activeRunId} locale={locale} />
                ) : pending ? <AssistantLoading turnId={activeRunId} locale={locale} queuePosition={queuePosition} /> : null}
              </div>
            ) : null}
            {!turns.length && !activePrompt && !pending ? <p className="mj-run-waiting">{locale === "ja" ? "会話に接続しています…" : "Connecting to the conversation…"}</p> : null}
          </div>
        </div>
      </div>
      <RunComposer
        value={prompt}
        pending={pending}
        error={null}
        onChange={setPrompt}
        inputRef={composerInputRef}
        onSubmit={submitFollowup}
        onFiles={addFiles}
        attachments={attachments.map(({ name, size }) => ({ name, size }))}
        onRemoveAttachment={(name) => setAttachments((current) => current.filter((item) => item.name !== name))}
        mode={mode}
        onModeChange={setMode}
        framework={framework}
        onFrameworkChange={(value) => {
          frameworkTouched.current = true;
          setFramework(value);
        }}
        onStop={fixtureEvents ? undefined : () => void stopRun()}
        stopping={stopping}
        locale={locale}
      />
    </div>
  );
}

export function CompletedAssistant({
  turn,
  locale = "en",
  onFollowUp,
  onUseAiAssumptions,
}: {
  turn: Turn;
  locale?: PublicLocale;
  onFollowUp?: (prompt: string) => void;
  onUseAiAssumptions?: (prompt: string) => void;
}) {
  // Failure context and the best produced output are separate concerns. A rejected
  // candidate still remains inspectable after the reason it was rejected.
  const activity = runActivityFromEvents(turn.events, false, locale);
  const result = runResultFromEvents(turn.events, turn.verificationSummary, locale);
  const outcome = runOutcomeFromEvents(turn.events, turn.verificationSummary, locale);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  const failed = turn.events.some(
    (event) => event.type === "run.finished" && event.status !== "succeeded",
  );
  const followUpKind: FollowUpPromptKind = failed
    ? "failure"
    : result
      ? "result"
      : "answer";
  const canOfferAiAssumptions = turn.events.some(
    (event) => event.type === "chat.completed" && event.allow_ai_assumptions_available,
  ) || turn.events.some(
    (event) => event.type === "run.mode_resolved"
      && event.resolved === "chat"
      && /(?:missing|required|not provided|not specified|未指定|不足|必要|欠け)/i.test(event.reason ?? ""),
  );
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${activity || result || outcome ? " mj-chat-message--run" : ""}`}>
      {chatFallbackNotice(turn.events) ? <ChatFallbackNotice locale={locale} /> : null}
      {activity ? <RunActivityBlock activity={activity} events={turn.events} locale={locale} /> : null}
      {!result && outcomeWithoutDuplicateCode && turn.events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} locale={locale} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={turn.events} runId={turn.id} locale={locale} />
      ) : outcomeWithoutDuplicateCode ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} action={<ArtifactLink events={turn.events} locale={locale} />} locale={locale} />
      ) : (
        <>
          {turn.answer ? (
            <ChatMarkdown source={turn.answer} />
          ) : (
            <p className="mj-run-waiting">{locale === "ja" ? "応答は完了しましたが、表示できる内容がありません。" : "The response completed without displayable content."}</p>
          )}
          <ArtifactLink events={turn.events} locale={locale} />
        </>
      )}
      {onUseAiAssumptions && canOfferAiAssumptions ? (
        <section className="mj-ai-assumption-action" aria-label={locale === "ja" ? "不足情報の補完" : "Complete missing details"}>
          <p>{locale === "ja" ? "不足している値をAIが教育用の例として補完し、そのまま実行できます。" : "The AI can fill the missing values with a clearly labeled educational example and run it."}</p>
          <button className="mj-primary-button" type="button" onClick={() => onUseAiAssumptions(turn.prompt)}>
            {locale === "ja" ? "AIが補完して実行" : "Fill details and run"}
          </button>
        </section>
      ) : null}
      {onFollowUp ? (
        <FollowUpQuestions
          kind={followUpKind}
          locale={locale}
          onSelect={onFollowUp}
          prompts={turn.followUps}
        />
      ) : null}
    </div>
  );
}

function FollowUpQuestions({
  kind,
  locale,
  onSelect,
  prompts: contextualPrompts,
}: {
  kind: FollowUpPromptKind;
  locale: PublicLocale;
  onSelect: (prompt: string) => void;
  prompts?: readonly string[];
}) {
  const prompts = contextualPrompts && contextualPrompts.length >= 2
    ? contextualPrompts.slice(0, 3)
    : followUpPrompts(kind, locale);
  return (
    <section
      className="mj-run-follow-ups"
      aria-label={locale === "ja" ? "次に試せる質問" : "Suggested follow-up questions"}
    >
      <div className="mj-run-follow-ups-heading">
        <strong>{locale === "ja" ? "次に試せる質問" : "Suggested Follow-ups"}</strong>
        <span className="sr-only">{locale === "ja" ? "選ぶと入力欄に入ります" : "Select one to add it to the composer"}</span>
      </div>
      <div className="mj-run-follow-ups-list">
        {prompts.map((prompt) => (
          <button type="button" key={prompt} onClick={() => onSelect(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
    </section>
  );
}

function AssistantMessage({
  reasoning,
  text,
  streaming,
  events,
  turnId,
  locale,
}: {
  reasoning: string;
  text: string;
  streaming: boolean;
  events: WireEvent[];
  turnId?: string | null;
  locale: PublicLocale;
}) {
  const activity = runActivityFromEvents(events, streaming, locale);
  const result = runResultFromEvents(events, null, locale);
  const outcome = runOutcomeFromEvents(events, null, locale);
  const outcomeWithoutDuplicateCode = outcome && result
    ? { ...outcome, code: undefined }
    : outcome;
  // Both streams are paced rather than painted in the worker's 160-character
  // lumps. The answer settles when the stream closes; the reasoning settles as
  // soon as answer text starts, because the model has stopped adding to it.
  const smoothedText = useSmoothedText(splitAssistantFollowUps(text).answer, !streaming);
  const smoothedReasoning = useSmoothedText(reasoning, !streaming || Boolean(text));
  // null until the reader expresses a preference; see the <details> below.
  const [thoughtOpen, setThoughtOpen] = useState<boolean | null>(null);
  return (
    <div className={`mj-chat-message mj-chat-message--assistant${activity ? " mj-chat-message--run" : ""}`}>
      {chatFallbackNotice(events) ? <ChatFallbackNotice locale={locale} /> : null}
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
              ? <ThinkingLabel turnId={turnId} className="mj-chat-thinking-label" locale={locale} />
              : <span className="mj-chat-thinking-word">{locale === "ja" ? "少し考えました" : "Thought for a moment"}</span>}
          </summary>
          <ChatMarkdown source={smoothedReasoning} />
        </details>
      ) : null}
      {activity ? <RunActivityBlock activity={activity} events={events} locale={locale} /> : null}
      {!result && outcomeWithoutDuplicateCode && events.some((event) => event.type === "run.finished" && event.status !== "succeeded") ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} locale={locale} />
      ) : null}
      {result ? (
        <FinalOutput result={result} events={events} runId={turnId} locale={locale} />
      ) : outcomeWithoutDuplicateCode ? (
        <RunOutcome outcome={outcomeWithoutDuplicateCode} action={<ArtifactLink events={events} locale={locale} />} locale={locale} />
      ) : text ? (
        <ChatMarkdown source={smoothedText} />
      ) : activity ? null : (
        <ThinkingLabel turnId={turnId} className="mj-chat-message--loading mj-chat-thinking-label" locale={locale} />
      )}
      {!result && !outcomeWithoutDuplicateCode ? <ArtifactLink events={events} locale={locale} /> : null}
    </div>
  );
}

function FinalOutput({
  result,
  events,
  runId,
  locale,
}: {
  result: NonNullable<ReturnType<typeof runResultFromEvents>>;
  events: WireEvent[];
  runId?: string | null;
  locale: PublicLocale;
}) {
  const accepted = events.some(
    (event) => event.type === "run.finished" && event.status === "succeeded",
  );
  const heading = accepted
    ? locale === "ja" ? "最終出力" : "Final Output"
    : locale === "ja" ? "利用可能な最良結果" : "Best available result";
  const [open, setOpen] = useState(true);
  return (
    <>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {locale === "ja" ? `${heading}の準備ができました。` : `${heading} ready.`} {result.trust.label}.
      </span>
      <details
        className="mj-run-final-output"
        aria-label={heading}
        data-run-final-output={runId ?? undefined}
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary className="mj-run-final-output-heading">
          <span
            className="mj-run-final-output-marker"
            data-tone={result.trust.tone}
            aria-hidden="true"
          >
            {result.trust.tone === "ok" ? "✓" : "–"}
          </span>
          <span className="mj-run-final-output-heading-copy">
            <span>{accepted ? locale === "ja" ? "結果とコード" : "Result and code" : locale === "ja" ? "確認できる結果" : "Result preserved"}</span>
            <strong>{heading}</strong>
          </span>
        </summary>
        <RunResult
          result={result}
          action={<ArtifactLink events={events} locale={locale} />}
          artifactId={artifactIdFromEvents(events)}
          locale={locale}
          showSummary={false}
        />
      </details>
      <div className="mj-run-final-explanation">
        <ChatMarkdown source={result.summary} />
      </div>
    </>
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

function ChatFallbackNotice({ locale }: { locale: PublicLocale }) {
  return (
    <p className="mj-run-fallback-notice" role="status">
      {locale === "ja" ? (
        <>チャットで回答しました。Routerがメッセージを分類できなかったため実行していません。実行するには<strong>実行</strong>を選んで再送してください。</>
      ) : (
        <>Answered in chat. The router could not classify this message, so it was not run — resend it with <strong>Execute</strong> selected to run it.</>
      )}
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

function ModelCallMeta({ event, locale = "en" }: { event: WireEvent | null; locale?: PublicLocale }) {
  if (!event) return null;
  const parts = [
    durationLabel(event.duration_ms),
    event.input_tokens !== undefined && event.output_tokens !== undefined
      ? locale === "ja"
        ? `入力 ${event.input_tokens.toLocaleString("ja-JP")}・出力 ${event.output_tokens.toLocaleString("ja-JP")}`
        : `${event.input_tokens.toLocaleString()} in · ${event.output_tokens.toLocaleString()} out`
      : null,
  ].filter((part): part is string => Boolean(part));
  return parts.length ? <span>{parts.join(" · ")}</span> : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function SimulationResult({ event, locale }: { event: WireEvent; locale: PublicLocale }) {
  const result = recordValue(event.result);
  const visualization = resultVisualizationFromResult(result, [], locale);
  const hasVisualization = Boolean(
    visualization.distribution
    || visualization.traces.length
    || visualization.values.length,
  );

  return (
    <div className="mj-run-live-simulation">
      <section>
        <div className="mj-run-activity-section-head">
          <strong>{locale === "ja" ? "構造化結果" : "Structured result"}</strong>
          <span>{event.exit_code === 0 ? locale === "ja" ? "実行成功" : "Execution passed" : locale === "ja" ? "実行出力" : "Execution output"}</span>
        </div>
        <dl className="mj-run-live-facts">
          <div>
            <dt>{locale === "ja" ? "終了コード" : "Exit code"}</dt>
            <dd>{event.exit_code ?? "—"}</dd>
          </div>
          <div>
            <dt>{locale === "ja" ? "実行時間" : "Runtime"}</dt>
            <dd>{durationLabel(event.duration_ms) ?? "—"}</dd>
          </div>
          {visualization.distribution?.kind === "counts" ? (
            <div>
              <dt>{locale === "ja" ? "ショット数" : "Shots"}</dt>
              <dd>{visualization.distribution.total.toLocaleString(locale === "ja" ? "ja-JP" : "en-US")}</dd>
            </div>
          ) : null}
        </dl>
        {hasVisualization ? (
          <ResultVisualizations {...visualization} locale={locale} />
        ) : result && Object.keys(result).length ? (
          <pre className="mj-run-live-result-json">{JSON.stringify(result, null, 2)}</pre>
        ) : (
          <p className="mj-run-live-empty-result">
            {locale === "ja" ? "この結果には数値の詳細が含まれていません。実行の状態は以下で確認できます。" : "This replay predates structured simulation values. Runtime diagnostics remain below."}
          </p>
        )}
      </section>
      {event.stdout || event.stderr ? (
        <details className="mj-run-live-logs">
          <summary>{locale === "ja" ? "実行ログ" : "Runtime logs"}</summary>
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

function ScreenStage({ event, locale }: { event: WireEvent; locale: PublicLocale }) {
  return (
    <div className="mj-run-live-simulation">
      <dl className="mj-run-live-facts">
        <div>
          <dt>Lint</dt>
          <dd>{event.lint_ok === false ? locale === "ja" ? "失敗" : "Failed" : locale === "ja" ? "合格" : "Passed"}</dd>
        </div>
        <div>
          <dt>{locale === "ja" ? "型チェック" : "Type check"}</dt>
          <dd>{event.typecheck_ok === false ? locale === "ja" ? "失敗" : "Failed" : locale === "ja" ? "合格" : "Passed"}</dd>
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

function PlanStage({ event, locale }: { event: WireEvent; locale: PublicLocale }) {
  const plan = event.plan;
  if (!plan) return null;
  const executionFacts = [
    [locale === "ja" ? "フレームワーク" : "Framework", plan.framework],
    [locale === "ja" ? "量子ビット数" : "Qubits", plan.qubits_estimate],
    [locale === "ja" ? "ショット数" : "Shots", plan.parameters?.shots],
    ["Seed", plan.parameters?.seed],
    [locale === "ja" ? "実行時間" : "Runtime", plan.expected_runtime_sec !== undefined ? `${plan.expected_runtime_sec} s` : null],
  ].filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== null && entry[1] !== "");
  const primaryMetric = plan.success_criteria?.primary_metric;
  const outputs = plan.expected_output_keys?.filter(Boolean) ?? [];
  return (
    <div className="mj-run-plan-overview">
      <header className="mj-run-plan-summary">
        <div className="mj-run-plan-copy">
          <span>{locale === "ja" ? "提案したアプローチ" : "Proposed approach"}</span>
          {plan.algorithm_rationale ? <p>{plan.algorithm_rationale}</p> : null}
        </div>
        {plan.algorithm ? (
          <div className="mj-run-plan-algorithm">
            <span>{locale === "ja" ? "アルゴリズム" : "Algorithm"}</span>
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
              <span>{locale === "ja" ? "最適化対象" : "Optimizes"}</span>
              <strong>{primaryMetric}</strong>
            </div>
          ) : null}
          {outputs.length ? (
            <div>
              <span>{locale === "ja" ? "返却値" : "Returns"}</span>
              <ul aria-label={locale === "ja" ? "想定される出力" : "Expected outputs"}>
                {outputs.map((output) => <li key={output}>{output}</li>)}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CodeStage({ event, locale = "en" }: { event: WireEvent; locale?: PublicLocale }) {
  if (!event.code) return null;
  const language = event.language ?? "python";
  return (
    <pre
      className="mj-run-live-code"
      tabIndex={0}
      role="region"
      aria-label={locale === "ja" ? `生成された${language}コード` : `Generated ${language} source code`}
    >
      <SyntaxHighlightedCode code={event.code} language={language} />
    </pre>
  );
}

function EventMeta({ event, locale = "en" }: { event: WireEvent | null; locale?: PublicLocale }) {
  if (!event) return null;
  return (
    <div className="mj-run-activity-call-meta">
      <ModelCallMeta event={event} locale={locale} />
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

function ActivityEmptyDetail({ state, locale }: { state: AgentActivityState; locale: PublicLocale }) {
  const copy = state === "active"
    ? locale === "ja" ? "処理を続けています。新しい確認結果が出ると、ここに表示されます。" : "Work is continuing. New evidence will appear here when it is recorded."
    : state === "error"
      ? locale === "ja" ? "詳しい確認結果が出る前に、この処理は停止しました。" : "This operation stopped before detailed evidence was recorded."
      : state === "warn"
        ? locale === "ja" ? "確認できる情報が限られた状態で、この処理は完了しました。" : "This operation completed with limited recorded evidence."
        : locale === "ja" ? "この処理には追加の詳細がありません。" : "No additional detail was recorded for this operation.";
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
  locale,
}: {
  detail: Extract<RunActivityDetail, { kind: "code" }>;
  events: WireEvent[];
  state: AgentActivityState;
  locale: PublicLocale;
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
            <strong>{locale === "ja" ? "コードの更新履歴" : "Repair history"}</strong>
            {bestEffort?.candidates_considered ? (
              <span>{bestEffort.candidates_considered}{locale === "ja" ? "通りを確認" : " candidates considered"}</span>
            ) : null}
          </div>
          {detail.attempts.length ? (
            <ol>
              {detail.attempts.map((attempt) => (
                <li data-state={attempt.state} key={`${attempt.revision}-${attempt.eventIndex}`}>
                  <span aria-hidden="true">
                    {attempt.state === "done" ? "✓" : attempt.state === "error" ? "×" : "–"}
                  </span>
                  <strong>{locale === "ja" ? "更新版" : "Revision"} {attempt.revision}</strong>
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
            <strong>{locale === "ja" ? "実行用コード" : "Candidate source"}</strong>
            {selectedRevision ? <span>{locale === "ja" ? "更新版" : "Revision"} {selectedRevision}</span> : null}
          </div>
          <div className="mj-run-code-actions">
            {detail.attempts.length > 1 ? (
              <label>
                <span className="sr-only">{locale === "ja" ? "表示するコードの更新版" : "Displayed code revision"}</span>
                <select
                  aria-label={locale === "ja" ? "表示するコードの更新版" : "Displayed code revision"}
                  value={selectedIndex ?? ""}
                  onChange={(event) => {
                    selectionTouched.current = true;
                    setSelectedIndex(Number(event.target.value));
                    setCopied(false);
                  }}
                >
                  {detail.attempts.map((attempt) => (
                    <option key={`${attempt.revision}-${attempt.eventIndex}`} value={attempt.eventIndex}>
                      {locale === "ja" ? "更新版" : "Revision"} {attempt.revision} · {attempt.status}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {source?.code ? (
              <button className="mj-secondary-button" type="button" onClick={() => void copySource()}>
                {copied ? locale === "ja" ? "コピー済み" : "Copied" : locale === "ja" ? "コードをコピー" : "Copy code"}
              </button>
            ) : null}
          </div>
        </div>
        {source?.code ? <CodeStage event={source} locale={locale} /> : <ActivityEmptyDetail state={state} locale={locale} />}
        <EventMeta event={call} locale={locale} />
      </section>
    </div>
  );
}

function ChecksActivityDetail({
  detail,
  events,
  state,
  locale,
}: {
  detail: Extract<RunActivityDetail, { kind: "checks" }>;
  events: WireEvent[];
  state: AgentActivityState;
  locale: PublicLocale;
}) {
  const screen = detail.screenIndex === null ? null : events[detail.screenIndex];
  const resources = detail.resourceIndex === null ? null : events[detail.resourceIndex];
  if (!screen && !resources) return <ActivityEmptyDetail state={state} locale={locale} />;
  return (
    <div className="mj-run-activity-detail-stack">
      {screen ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>{locale === "ja" ? "コードチェック" : "Code checks"}</strong></div>
          <ScreenStage event={screen} locale={locale} />
        </section>
      ) : null}
      {resources ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>{locale === "ja" ? "リソース見積もり" : "Resource estimate"}</strong></div>
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

function checkStatus(event: WireEvent, locale: PublicLocale): string {
  const outcome = String(event.result ?? event.decision ?? "unavailable");
  if (outcome === "pass" || outcome === "ready") return locale === "ja" ? "合格" : "Passed";
  if (outcome === "fail" || outcome === "error") return locale === "ja" ? "不合格" : "Failed";
  if (outcome === "code_repair") return locale === "ja" ? "コード修正要求" : "Repair requested";
  if (outcome === "replan") return locale === "ja" ? "再計画要求" : "Replan requested";
  if (outcome === "skipped") return locale === "ja" ? "スキップ" : "Skipped";
  if (outcome === "inconclusive") return locale === "ja" ? "判定不能" : "Inconclusive";
  return locale === "ja" ? "利用不可" : "Unavailable";
}

function VerificationRow({
  event,
  label,
  children,
  locale,
}: {
  event: WireEvent;
  label: string;
  children?: ReactNode;
  locale: PublicLocale;
}) {
  const state = checkState(event);
  return (
    <li data-state={state}>
      <span aria-hidden="true">{state === "done" ? "✓" : state === "error" ? "×" : "–"}</span>
      <div>
        <strong>{label}</strong>
        <small>{checkStatus(event, locale)}</small>
        {children}
      </div>
    </li>
  );
}

function VerificationActivityDetail({
  detail,
  events,
  state,
  locale,
}: {
  detail: Extract<RunActivityDetail, { kind: "verification" }>;
  events: WireEvent[];
  state: AgentActivityState;
  locale: PublicLocale;
}) {
  const review = detail.reviewIndex === null ? null : events[detail.reviewIndex];
  const strict = detail.strictIndex === null ? null : events[detail.strictIndex];
  if (!detail.eventIndices.length && !review && !strict) {
    return <ActivityEmptyDetail state={state} locale={locale} />;
  }
  return (
    <ol className="mj-run-verification-list">
      {detail.eventIndices.map((index) => {
        const event = events[index];
        const methodLabels = locale === "ja" ? VERIFICATION_METHOD_LABEL_JA : VERIFICATION_METHOD_LABEL;
        const label = event.method && methodLabels[event.method]
          ? methodLabels[event.method]
          : locale === "ja" ? `確認: ${event.method ?? "確認"}` : `Verification: ${event.method ?? "check"}`;
        return (
          <VerificationRow event={event} key={`${event.seq ?? index}-${event.method ?? "check"}`} label={label} locale={locale}>
            {event.details ? (
              <details className="mj-run-verification-evidence">
                <summary>{locale === "ja" ? "確認内容" : "Evidence"}</summary>
                <EventRecord value={event.details} />
              </details>
            ) : null}
          </VerificationRow>
        );
      })}
      {review ? (
        <VerificationRow event={review} label={locale === "ja" ? "依頼と結果の整合性" : "Intent and result alignment"} locale={locale}>
          <ReviewStage event={review} />
          <EventMeta event={llmCallBefore(events, detail.reviewIndex ?? 0, "verify", "review")} locale={locale} />
        </VerificationRow>
      ) : null}
      {strict ? (
        <VerificationRow event={strict} label={locale === "ja" ? "追加の確認" : "Strict acceptance review"} locale={locale}>
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
  locale,
}: {
  detail: Extract<RunActivityDetail, { kind: "compilation" }>;
  events: WireEvent[];
  state: AgentActivityState;
  locale: PublicLocale;
}) {
  const compilation = detail.eventIndex === null ? null : events[detail.eventIndex];
  const resources = detail.resourceIndex === null ? null : events[detail.resourceIndex];
  if (!compilation && !resources) return <ActivityEmptyDetail state={state} locale={locale} />;
  return (
    <div className="mj-run-activity-detail-stack">
      {compilation ? <CompilationStage event={compilation} /> : null}
      {resources ? (
        <section>
          <div className="mj-run-activity-section-head"><strong>{locale === "ja" ? "コンパイル後のリソース" : "Compiled resources"}</strong></div>
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

const FINALIZE_LABEL_JA: Record<string, string> = {
  "code.finalized": "最終コードを選択",
  "sandbox.result": "最終シミュレーション",
  "baseline.result": "参照ベースラインとの比較",
  "run.analysis": "結果分析",
  "artifact.saved": "Result package created",
  "run.best_effort": "確認用に最良の結果を保持",
};

function finalizeState(event: WireEvent): "done" | "warn" | "error" {
  if (event.type === "run.best_effort" || event.not_applicable_reason) return "warn";
  if (event.type === "sandbox.result" && event.exit_code !== 0) return "error";
  return "done";
}

function finalizeStatus(event: WireEvent, locale: PublicLocale): string {
  if (event.type === "run.best_effort") return locale === "ja" ? "不採用" : "Not accepted";
  if (event.not_applicable_reason) return locale === "ja" ? "対象外" : "Not applicable";
  if (event.type === "sandbox.result") return event.exit_code === 0 ? locale === "ja" ? "合格" : "Passed" : locale === "ja" ? "失敗" : "Failed";
  if (event.type === "artifact.saved") return locale === "ja" ? "保存済み" : "Packaged";
  if (event.type === "code.finalized" && event.revision) return `${locale === "ja" ? "更新版" : "Revision"} ${event.revision}`;
  return locale === "ja" ? "完了" : "Complete";
}

function FinalizeActivityDetail({
  detail,
  events,
  state,
  locale,
}: {
  detail: Extract<RunActivityDetail, { kind: "finalize" }>;
  events: WireEvent[];
  state: AgentActivityState;
  locale: PublicLocale;
}) {
  const indices = [...detail.eventIndices];
  if (detail.bestEffortIndex !== null && !indices.includes(detail.bestEffortIndex)) {
    indices.push(detail.bestEffortIndex);
  }
  if (!indices.length) return <ActivityEmptyDetail state={state} locale={locale} />;
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
              <strong>{(locale === "ja" ? FINALIZE_LABEL_JA : FINALIZE_LABEL)[event.type] ?? event.type}</strong>
              <small>{finalizeStatus(event, locale)}</small>
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
  locale,
}: {
  item: AgentActivityItem<RunActivityDetail>;
  events: WireEvent[];
  locale: PublicLocale;
}) {
  const detail = item.detail;
  if (detail.kind === "plan") {
    const index = detail.eventIndices.at(-1);
    const event = index === undefined ? null : events[index];
    const call = detail.callIndex === null ? null : events[detail.callIndex];
    return event ? (
      <div className="mj-run-activity-detail-stack">
        <section className="mj-run-plan-section">
          <PlanStage event={event} locale={locale} />
          <EventMeta event={call} locale={locale} />
        </section>
      </div>
    ) : <ActivityEmptyDetail state={item.state} locale={locale} />;
  }
  if (detail.kind === "code") {
    return <CodeActivityDetail detail={detail} events={events} state={item.state} locale={locale} />;
  }
  if (detail.kind === "checks") {
    return <ChecksActivityDetail detail={detail} events={events} state={item.state} locale={locale} />;
  }
  if (detail.kind === "execution") {
    const event = detail.eventIndex === null ? null : events[detail.eventIndex];
    return event
      ? <SimulationResult event={event} locale={locale} />
      : <ActivityEmptyDetail state={item.state} locale={locale} />;
  }
  if (detail.kind === "verification") {
    return (
      <VerificationActivityDetail detail={detail} events={events} state={item.state} locale={locale} />
    );
  }
  if (detail.kind === "compilation") {
    return (
      <CompilationActivityDetail detail={detail} events={events} state={item.state} locale={locale} />
    );
  }
  return <FinalizeActivityDetail detail={detail} events={events} state={item.state} locale={locale} />;
}

function RunActivityBlock({
  activity,
  events,
  locale,
}: {
  activity: NonNullable<ReturnType<typeof runActivityFromEvents>>;
  events: WireEvent[];
  locale: PublicLocale;
}) {
  return (
    <AgentActivity
      activity={activity}
      locale={locale}
      renderDetail={(item) => <RunActivityDetailPanel events={events} item={item} locale={locale} />}
    />
  );
}

/**
 * Keep this result, or go to it if it is already kept.
 *
 * A finished run always materializes its artifact — the conversion tabs below
 * read the saved version, and the next turn in this conversation forks from it —
 * but it is not kept until the user says so (migration 0036). So
 * this control has to know which state it is in, which the run events cannot
 * say: `artifact.saved` is emitted for kept and unkept alike. Hence the fetch.
 *
 * While that fetch is in flight nothing is rendered rather than guessing a
 * label, because guessing wrong means offering to keep something already kept.
 */
function ArtifactLink({ events, locale }: { events: WireEvent[]; locale: PublicLocale }) {
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
      <Link className="mj-secondary-button" href={`/studio?artifact=${encodeURIComponent(artifactId)}`}>
        {locale === "ja" ? "Studioで表示" : "View in Studio"} →
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
        {keeping ? locale === "ja" ? "保存中…" : "Keeping…" : locale === "ja" ? "この結果を保存" : "Keep this result"}
      </button>
      {failed ? (
        <small role="alert">{locale === "ja" ? "保存できませんでした。もう一度お試しください。" : "Could not keep this — try again."}</small>
      ) : (
        <small>{locale === "ja" ? "まだWorkspaceに保存されていません。" : "Not saved to your workspace yet."}</small>
      )}
    </span>
  );
}

function AssistantLoading({ turnId, locale, queuePosition }: { turnId?: string | null; locale: PublicLocale; queuePosition?: number | null }) {
  // The queue line replaces nothing — it sits under the thinking label, because
  // "waiting" and "where in the line" are different facts and the second one is
  // absent most of the time. `role="status"` so a reader who cannot see the
  // number is told it when it changes.
  const queued = queuePositionLabel(queuePosition, locale);
  return (
    <div className="mj-chat-message mj-chat-message--assistant mj-chat-message--loading" aria-label={locale === "ja" ? "応答を待っています" : "Waiting for response"}>
      <ThinkingLabel turnId={turnId} locale={locale} />
      {queued ? <p className="mj-run-queue-position" role="status">{queued}</p> : null}
    </div>
  );
}
