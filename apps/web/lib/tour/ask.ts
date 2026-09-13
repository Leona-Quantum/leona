import { refusalSentence, submittedId } from "../api-error.ts";
import { rememberChat } from "../chat-history";
import { titleFromPrompt } from "../chat-title";
import { splitAssistantFollowUps } from "../follow-up-prompts";
import type { PublicLocale } from "../public-locale";

/**
 * The guide's "Ask Nala": the reader's question, with the tour step it was asked
 * from, sent down the same path the Run composer uses (`POST /api/runs`).
 *
 * No new endpoint and no new provider. The cost of that is real and is shown
 * before anything is sent: it starts a conversation that appears in the reader's
 * chats and counts toward their plan's usage, exactly as typing the question into
 * Run would. `explain` mode is selected explicitly, which the worker treats as
 * authoritative and answers in prose without running code
 * (services/worker/src/majorana_worker/intent.py, `resolve_mode`).
 *
 * Nothing here ever invents an answer. Offline says offline; a refusal is the
 * server's own sentence; an answer still being written says so and links to it.
 */

export type AskStart =
  | { kind: "started"; runId: string }
  | { kind: "offline" }
  | { kind: "refused"; message: string | null };

export type AskAnswer =
  | { kind: "answer"; runId: string; text: string }
  | { kind: "pending"; runId: string }
  | { kind: "failed"; runId: string };

export async function askNala({ prompt, question, locale }: { prompt: string; question: string; locale: PublicLocale }): Promise<AskStart> {
  let response: Response;
  try {
    response = await fetch("/api/runs", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ task_prompt: prompt, mode: "explain", framework: "qiskit", response_locale: locale }),
    });
  } catch {
    return { kind: "offline" };
  }
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const runId = submittedId(payload);
  if (!response.ok || !runId) {
    if (response.status >= 500 || payload === null) return { kind: "offline" };
    return { kind: "refused", message: refusalSentence(payload) };
  }
  const conversationId = payload && typeof payload === "object" && typeof (payload as Record<string, unknown>).conversation_id === "string"
    ? ((payload as Record<string, unknown>).conversation_id as string)
    : undefined;
  rememberChat({ id: runId, title: titleFromPrompt(question), prompt: question, createdAt: new Date().toISOString(), status: "queued", conversationId });
  return { kind: "started", runId };
}

type ConversationEvent = { type?: unknown; text?: unknown; status?: unknown };

/** The text of the finished answer in a conversation payload, if there is one yet. */
export function answerFromConversation(payload: unknown): { text: string | null; finished: boolean; failed: boolean } {
  const turns = payload && typeof payload === "object" ? (payload as { turns?: unknown }).turns : null;
  if (!Array.isArray(turns) || turns.length === 0) return { text: null, finished: false, failed: false };
  const events = (turns[turns.length - 1] as { events?: unknown }).events;
  if (!Array.isArray(events)) return { text: null, finished: false, failed: false };
  const list = events as ConversationEvent[];
  const completed = [...list].reverse().find((event) => event.type === "chat.completed" && typeof event.text === "string" && event.text);
  const finishedEvent = [...list].reverse().find((event) => event.type === "run.finished");
  const text = completed ? splitAssistantFollowUps(completed.text as string).answer : null;
  return { text: text || null, finished: Boolean(finishedEvent), failed: Boolean(finishedEvent && finishedEvent.status !== "succeeded" && !text) };
}

export async function waitForAnswer(runId: string, { cancelled, timeoutMs = 90_000, intervalMs = 3_000 }: { cancelled: () => boolean; timeoutMs?: number; intervalMs?: number }): Promise<AskAnswer> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && !cancelled()) {
    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/conversation`, { cache: "no-store" });
      if (!response.ok) continue;
      const found = answerFromConversation(await response.json());
      if (found.text) return { kind: "answer", runId, text: found.text };
      if (found.failed) return { kind: "failed", runId };
    } catch {
      // A dropped poll is not an answer and not a failure; try again until the deadline.
    }
  }
  return { kind: "pending", runId };
}

/** A few sentences of plain text for the guide's box; the full answer is one click away. */
export function shortAnswer(markdown: string, max = 320): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  if (sentenceEnd > max * 0.5) return cut.slice(0, sentenceEnd + 1);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > max * 0.5 ? space : max)}…`;
}
