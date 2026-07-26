/**
 * One rule for what a conversation is called in the sidebar.
 *
 * The name a user sees comes from the model, carried on the `conversation.titled`
 * event the worker emits on a thread's opening turn (see
 * `_title_conversation` in services/worker). This module is only the client-side
 * FALLBACK — used before that event arrives, and for any run this browser learns
 * about from the control plane, whose list endpoint carries prompts and not names.
 *
 * It deliberately produces the same *shape* as a model title rather than the
 * whole prompt. Three separate copies of a 54-character truncation used to live
 * in run-workspace.tsx, live-run.tsx and shell.tsx, which is how sidebar rows
 * ended up reading as paragraphs: one of them would be updated and the other two
 * would keep re-deriving the long form over the top of it on the next refresh.
 *
 * Kept in step with `normalize_conversation_title` in the worker. The word cap is
 * whitespace-based, which bounds the languages that use spaces and is a no-op for
 * Japanese — where the character cap is what actually keeps a row a row.
 */

export const TITLE_MAX_WORDS = 5;
export const TITLE_MAX_CHARS = 60;

/** A short, sidebar-shaped name derived from the user's own message. */
export function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0] ?? "";
  const collapsed = firstLine.trim().split(/\s+/).filter(Boolean);
  if (!collapsed.length) return "";
  const capped = collapsed.slice(0, TITLE_MAX_WORDS).join(" ");
  return capped.slice(0, TITLE_MAX_CHARS).replace(/[\s.,、。]+$/u, "");
}

/**
 * Which of the names a chat may carry actually gets shown.
 *
 * Order is a rule about authorship, not about freshness: a name the user typed
 * outranks a name the model wrote, which outranks a name this client derived
 * from the prompt because nothing better had arrived yet. Getting this backwards
 * is what let a background refresh overwrite a model title with prompt text.
 */
export function displayChatTitle(chat: {
  titleOverride?: string;
  modelTitle?: string;
  title?: string;
  prompt?: string;
}): string {
  return (
    chat.titleOverride?.trim()
    || chat.modelTitle?.trim()
    || chat.title?.trim()
    || titleFromPrompt(chat.prompt ?? "")
    || "Untitled conversation"
  );
}
