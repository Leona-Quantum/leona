"use client";

import { useRef, useState, type FormEvent } from "react";
import { refusalSentence, submittedId } from "../../../lib/api-error";
import { parseSseBlock, splitSseBuffer } from "../../../lib/sse-events";
import { REVISE_STAGE_ORDER, reviseFollowState, type ReviseWireEvent } from "../../../lib/studio-revise-follow";
import type { CircuitChangeSummary } from "../../../lib/circuit-change-summary";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/**
 * "Ask Leona": change the open circuit by describing the change, instead of
 * editing gates or code directly. Submits with `source_intent: "revise"`
 * (PR 889) and follows the run's own SSE stream inline — using the same
 * block/line parsing the run page uses (lib/sse-events.ts) and a purpose-built
 * reducer (lib/studio-revise-follow.ts) rather than the run page's full chat
 * machinery, which this box has no use for.
 *
 * This component owns only the submit-and-follow lifecycle (busy, the stage
 * checklist, a submission error). Everything that happens once a revision is
 * saved — loading the new version in place, the change summary, and the
 * one-shot "go back" — is controlled by the caller (studio-workspace.tsx),
 * because that is where `loadArtifact`/`applyArtifact` and the outer draft
 * state (the "before" circuit to diff against, the backup to restore) live.
 */
export function AskLeonaBox({
  code,
  framework,
  artifactVersionId,
  onSaved,
  changeSummary,
  canGoBack,
  onGoBack,
  copy,
}: {
  code: string;
  framework: string;
  artifactVersionId?: string;
  /** Called once the run has saved a new artifact version. */
  onSaved: (artifactId: string) => void;
  /** The diff for the most recently completed revision, or null before one has run. */
  changeSummary: CircuitChangeSummary | null;
  /** Whether a pre-revision backup is still available to restore. */
  canGoBack: boolean;
  onGoBack: () => void;
  copy: StudioCopy;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ReviseWireEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const follow = reviseFollowState(events);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    setEvents([]);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          task_prompt: taskPrompt,
          mode: "execute",
          framework,
          source_code: code,
          source_intent: "revise",
          ...(artifactVersionId ? { artifact_version_id: artifactVersionId } : {}),
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as unknown;
      const runId = submittedId(payload);
      if (!response.ok || !runId) throw new Error(refusalSentence(payload) ?? copy.submissionFailed);
      await followRun(runId, controller.signal);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : copy.submissionFailed);
      setBusy(false);
    }
  }

  async function followRun(runId: string, signal: AbortSignal) {
    const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/events/stream`, { cache: "no-store", signal });
    if (!response.ok || !response.body) throw new Error(copy.submissionFailed);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let collected: ReviseWireEvent[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { blocks, remainder } = splitSseBuffer(buffer);
      buffer = remainder;
      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        let decoded: ReviseWireEvent;
        try {
          decoded = JSON.parse(parsed.data) as ReviseWireEvent;
        } catch {
          continue; // A malformed event is skipped, not fatal to the rest of the stream.
        }
        collected = [...collected, decoded];
        setEvents(collected);
        if (decoded.type === "run.finished") {
          const state = reviseFollowState(collected);
          setBusy(false);
          if (state.status === "succeeded" && state.artifactId) onSaved(state.artifactId);
          else if (state.status === "failed") setError(state.errorMessage ?? copy.submissionFailed);
          await reader.cancel();
          return;
        }
      }
    }
    setBusy(false);
  }

  function cancel() {
    abortRef.current?.abort();
    setBusy(false);
  }

  return (
    <section className="mj-ask-leona" aria-labelledby="studio-ask-leona-title">
      <h3 id="studio-ask-leona-title">{copy.askTitle}</h3>
      <form onSubmit={submit} className="mj-ask-leona-form">
        <label className="sr-only" htmlFor="studio-ask-leona-input">{copy.askTitle}</label>
        <input
          id="studio-ask-leona-input"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={copy.askPlaceholder}
          disabled={busy}
        />
        {busy ? (
          <button className="mj-secondary-button" type="button" onClick={cancel}>{copy.askCancel}</button>
        ) : (
          <button className="mj-primary-button" type="submit" disabled={!prompt.trim() || !code.trim()}>{copy.askSubmit}</button>
        )}
      </form>
      {busy ? (
        <ol className="mj-ask-leona-stages" aria-live="polite">
          {REVISE_STAGE_ORDER.map((stage) => (
            <li key={stage} className={follow.reachedStages.includes(stage) ? "is-done" : undefined}>
              {copy.askStageLabel[stage]}
            </li>
          ))}
        </ol>
      ) : null}
      {error ? <p className="mj-circuit-sync mj-circuit-sync--unrepresentable" role="alert">{error}</p> : null}
      {changeSummary && !changeSummary.unchanged ? (
        <p className="mj-mono-muted">{copy.askChangeSummary(changeSummary.added, changeSummary.removed)}</p>
      ) : null}
      {canGoBack ? <button className="mj-secondary-button" type="button" onClick={onGoBack}>{copy.askGoBack}</button> : null}
    </section>
  );
}
