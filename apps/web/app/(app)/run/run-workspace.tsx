"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { refusalSentence } from "../../../lib/api-error.ts";
import { titleFromPrompt } from "../../../lib/chat-title";
import { artifactFromResource, type LibraryArtifact } from "../../../lib/library-data";
import { consumeLandingPromptHandoff } from "../../../lib/landing-prompt-handoff";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import {
  canSubmitAfterArtifactHydration,
  hydrateArtifactFramework,
  type ArtifactFrameworkHydration,
} from "../../../lib/framework-selection";
import type { ComposerMode } from "../../../lib/run-mode";
import { RunComposer, type ComposerFramework } from "../../../components/run-composer";
import { ElectronField } from "../../../components/electron-field";

interface PromptAttachment {
  name: string;
  size: number;
  content: string;
}

const ATTACHMENT_EXTENSIONS = [".py", ".txt", ".md", ".json", ".qasm", ".csv"];
const ATTACHMENT_MAX_BYTES = 64 * 1024;
const ATTACHMENT_MAX_COUNT = 4;

export function RunWorkspace({ demoMode = false, locale = "en" }: { demoMode?: boolean; locale?: PublicLocale } = {}) {
  const copy = WORKSPACE_COPY[locale].run;
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ComposerMode>("auto");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const [artifactHydration, setArtifactHydration] =
    useState<ArtifactFrameworkHydration>("checking");
  const frameworkCurrent = useRef<ComposerFramework>("qiskit");
  const frameworkTouched = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextArtifact, setContextArtifact] = useState<LibraryArtifact | null>(null);
  const [attachments, setAttachments] = useState<PromptAttachment[]>([]);
  const [confirmingSend, setConfirmingSend] = useState(false);
  const [composerEngaged, setComposerEngaged] = useState(false);

  useEffect(() => {
    let active = true;
    const artifactId = new URLSearchParams(window.location.search).get("artifact");
    if (!artifactId) {
      setArtifactHydration("idle");
      return () => { active = false; };
    }
    setArtifactHydration("loading");
    const selectedArtifactId = artifactId;

    async function loadContext() {
      const response = await fetch(`/api/artifacts/${encodeURIComponent(selectedArtifactId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      const remote = (await response.json()) as Record<string, unknown>;
      let artifact = artifactFromResource(remote)[0];
      if (!artifact) throw new Error(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      if (artifact.currentVersionId && !artifact.code) {
        const versionResponse = await fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/versions/current`, { cache: "no-store" });
        if (versionResponse.ok) {
          const version = (await versionResponse.json()) as Record<string, unknown>;
          artifact = { ...artifact, code: typeof version.code === "string" ? version.code : "" };
        }
      }
      if (!active) return;
      setContextArtifact(artifact);
      const hydrated = hydrateArtifactFramework(
        frameworkCurrent.current,
        frameworkTouched.current,
        artifact.framework,
      );
      if (hydrated.error) {
        setError(hydrated.error);
        setArtifactHydration("error");
        return;
      }
      frameworkCurrent.current = hydrated.framework;
      setFramework(hydrated.framework);
      setArtifactHydration("ready");
      setPrompt(locale === "ja"
        ? `保存済みArtifact「${artifact.title}」を次の質問のコンテキストとして使用してください。`
        : `Use the saved artifact “${artifact.title}” as context for my next question.`);
    }

    void loadContext().catch(() => {
      if (!active) return;
      setError(locale === "ja" ? "Artifactのコンテキストを利用できません" : "Artifact context unavailable");
      setArtifactHydration("error");
    });
    return () => { active = false; };
  }, []);

  // Pre-fills from the landing page's composer (ai-ops 102), signed-out visitor
  // → sign-in → straight back here with their own words already in the box —
  // never auto-submitted; the owner's ruling was explicit that the person still
  // presses run themselves. `?artifact=` above wins when both are present: it is
  // a deliberate "view in Run" action, and a leftover landing prompt should
  // never override an explicit one. Checked independently here rather than
  // folded into the effect above because the two sources are unrelated (a URL
  // param that starts an async fetch vs. a synchronous read of the visitor's
  // own storage), and merging them would make the precedence harder to see, not
  // easier.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("artifact")) return;
    const carried = consumeLandingPromptHandoff();
    if (carried) setPrompt(carried);
  }, []);

  function addFiles(files: File[]) {
    void (async () => {
      const candidates: PromptAttachment[] = [];
      const errors: string[] = [];
      for (const file of files) {
        const lowered = file.name.toLowerCase();
        if (!ATTACHMENT_EXTENSIONS.some((extension) => lowered.endsWith(extension))) {
          errors.push(copy.attachUnsupported(file.name));
          continue;
        }
        if (file.size > ATTACHMENT_MAX_BYTES) {
          errors.push(copy.attachTooLarge(file.name));
          continue;
        }
        try {
          candidates.push({ name: file.name, size: file.size, content: await file.text() });
        } catch {
          errors.push(copy.attachReadFailed(file.name));
        }
      }

      const nextByName = new Map(attachments.map((item) => [item.name, item]));
      for (const candidate of candidates) {
        if (!nextByName.has(candidate.name) && nextByName.size >= ATTACHMENT_MAX_COUNT) {
          errors.push(copy.attachLimit);
          continue;
        }
        nextByName.set(candidate.name, candidate);
      }
      setAttachments([...nextByName.values()]);
      setError([...new Set(errors)].join(" ") || null);
    })();
  }

  function promptWithAttachments(taskPrompt: string): string {
    if (!attachments.length) return taskPrompt;
    const blocks = attachments.map((attachment) => `\n\n--- Attachment: ${attachment.name} ---\n${attachment.content}`);
    return `${taskPrompt}${blocks.join("")}`;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    if (!canSubmitAfterArtifactHydration(artifactHydration)) {
      setError(
        artifactHydration === "error"
          ? locale === "ja" ? "送信前にArtifactコンテキストのエラーを解決してください。" : "Resolve the artifact context error before submitting."
          : locale === "ja" ? "Artifactのフレームワーク読み込みが完了するまでお待ちください。" : "Wait for the artifact framework to finish loading.",
      );
      return;
    }
    if (demoMode) {
      setError(locale === "ja" ? "公開プレビューは閲覧専用です。実際に実行するにはサインインしてください。" : "Public preview mode is view-only. Sign in to start a real run.");
      return;
    }
    if (contextArtifact) {
      setConfirmingSend(true);
      return;
    }
    await sendRun(taskPrompt);
  }

  async function sendRun(taskPrompt: string) {
    if (pending) return;
    setConfirmingSend(false);
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: promptWithAttachments(taskPrompt),
          // Auto remains the safe default, while a deliberate user selection is
          // authoritative and bypasses intent reclassification in the worker.
          mode,
          framework,
          response_locale: locale,
          ...(contextArtifact?.code ? { source_code: contextArtifact.code } : {}),
          ...(contextArtifact?.currentVersionId ? { artifact_version_id: contextArtifact.currentVersionId } : {}),
        }),
      });
      const payload = (await response.json()) as { id?: string; conversation_id?: string };
      if (!response.ok || !payload.id) {
        throw new Error(refusalSentence(payload) ?? `Run submission failed (${response.status})`);
      }
      rememberChat({
        id: payload.id,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
        conversationId: payload.conversation_id,
      });
      router.push(`/run/${payload.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Run submission failed");
      setPending(false);
    }
  }

  return (
    <div className="mj-run-home">
      <div className="mj-run-home-scroll">
        <div className="mj-run-home-content mj-run-home-content--centered">
          <header className="mj-run-home-heading mj-run-home-hero">
            <span className={`mj-run-hero-lioness${composerEngaged ? " is-engaged" : ""}`} aria-hidden="true">
              <ElectronField target="lioness" />
            </span>
            <RunGreeting copy={copy} />
            {demoMode ? (
              <div className="mj-run-home-status" aria-label={locale === "ja" ? "モデルの状態" : "Model status"}>
                <span className="mj-status-dot" aria-hidden="true" />
                {copy.previewStatus}
              </div>
            ) : null}
          </header>

          <div
            className="mj-run-composer-stage"
            onFocusCapture={() => setComposerEngaged(true)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setComposerEngaged(false);
            }}
          >
            <RunComposer
              value={prompt}
              pending={pending}
              error={error}
              onChange={setPrompt}
              mode={mode}
              onModeChange={setMode}
              framework={framework}
              onFrameworkChange={(value) => {
                frameworkTouched.current = true;
                frameworkCurrent.current = value;
                setFramework(value);
              }}
              onSubmit={submit}
              centered
              contextArtifact={contextArtifact ? { title: contextArtifact.title, framework: contextArtifact.framework, codeAvailable: Boolean(contextArtifact.code) } : null}
              onClearContext={() => {
                setContextArtifact(null);
                setConfirmingSend(false);
              }}
              onFiles={demoMode ? undefined : addFiles}
              attachments={attachments.map(({ name, size }) => ({ name, size }))}
              onRemoveAttachment={(name) => setAttachments((current) => current.filter((item) => item.name !== name))}
              onAttach={demoMode ? () => setError(locale === "ja" ? "公開プレビューでは添付を利用できません。" : "Attachments are unavailable in the public preview.") : undefined}
              // The same prompts the example strip below offers, typed into the
              // box itself. A blank composer with a generic placeholder is the
              // hardest version of this product to start using; showing real
              // questions being written is the cheapest way to answer "what can
              // I even ask it".
              suggestions={copy.examples.map((example) => example.prompt)}
              locale={locale}
            />
          </div>

          {confirmingSend && contextArtifact ? (
            <div className="mj-run-confirm" role="alertdialog" aria-labelledby="run-confirm-title" aria-describedby="run-confirm-body">
              <strong id="run-confirm-title">{copy.confirmSendTitle}</strong>
              <p id="run-confirm-body">{copy.confirmSendBody(contextArtifact.title)}</p>
              <blockquote>{prompt.trim()}</blockquote>
              <div className="mj-run-confirm-actions">
                <button className="mj-primary-button" type="button" disabled={pending} onClick={() => void sendRun(prompt.trim())}>{copy.confirmSend}</button>
                <button className="mj-secondary-button" type="button" onClick={() => setConfirmingSend(false)}>{copy.confirmCancel}</button>
              </div>
            </div>
          ) : null}

          {artifactHydration === "checking" || artifactHydration === "loading" ? (
            <p className="mj-run-context-link" role="status">{locale === "ja" ? "Artifactコンテキストを読み込み中…" : "Loading artifact context…"}</p>
          ) : null}
          {artifactHydration === "error" ? (
            <p className="mj-run-context-link" role="alert">{locale === "ja" ? "Artifactコンテキストを読み込めませんでした。" : "Artifact context could not be loaded."}</p>
          ) : null}

          {contextArtifact ? <a className="mj-run-context-link" href={demoMode ? "/demo?view=library" : `/studio?artifact=${encodeURIComponent(contextArtifact.id)}`}>{copy.contextLabel}: {contextArtifact.title} · {copy.viewArtifact}</a> : null}

          <ExampleStrip
            copy={copy}
            onPick={(value) => {
              setPrompt(value);
              setError(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}

function RunGreeting({ copy }: { copy: (typeof WORKSPACE_COPY)[PublicLocale]["run"] }) {
  const [full, setFull] = useState("");
  const [typed, setTyped] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    const hour = new Date().getHours();
    const greeting = hour < 12 ? copy.greetingMorning : hour < 18 ? copy.greetingAfternoon : copy.greetingEvening;
    setFull(greeting);
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(greeting);
      setDone(true);
      return;
    }
    let index = 0;
    setTyped("");
    setDone(false);
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(greeting.slice(0, index));
      if (index >= greeting.length) {
        window.clearInterval(timer);
        setDone(true);
      }
    }, 55);
    return () => window.clearInterval(timer);
  }, [copy]);

  return (
    <h1 className="mj-run-greeting mj-run-greeting--hero" aria-label={full}>
      <span aria-hidden="true">
        {typed}
        <span className={`mj-run-greeting-caret${done ? " is-done" : ""}`} />
      </span>
    </h1>
  );
}

/**
 * One button, and the full set behind it.
 *
 * This has now shed two layers. It was a ticker printing the same paragraph the
 * composer's placeholder types a few pixels above it; then a heading plus a row
 * of title chips. The chips were a third listing of prompts on a screen that
 * already types one and holds the rest one click away, and the heading named a
 * section whose entire content was that duplication. What is left is the part
 * neither of the others can do: reach every prompt, with its full sentence, on
 * demand.
 *
 * `examplesTitle` stays as the section's accessible name. The heading is gone
 * visually, but a landmark with no name is worse for a screen reader than one
 * with a name nobody sees.
 */
function ExampleStrip({ copy, onPick }: { copy: (typeof WORKSPACE_COPY)[PublicLocale]["run"]; onPick: (prompt: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const allPrompts = [...copy.examples, ...copy.morePrompts];

  return (
    <section className="mj-run-home-examples" aria-label={copy.examplesTitle}>
      <div className="mj-example-strip">
        <button className="mj-secondary-button mj-example-more" type="button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
          {expanded ? copy.examplesClose : copy.examplesMore}
        </button>
      </div>
      {expanded ? (
        <div className="mj-example-popout">
          {allPrompts.map((example) => (
            <button
              className="mj-example-button"
              key={example.title}
              type="button"
              onClick={() => {
                onPick(example.prompt);
                setExpanded(false);
              }}
            >
              <strong>{example.title}</strong>
              <span>{example.prompt}</span>
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}
