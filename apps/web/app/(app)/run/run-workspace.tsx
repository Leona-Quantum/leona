"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { getLibraryArtifact, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import {
  canSubmitAfterArtifactHydration,
  hydrateArtifactFramework,
  type ArtifactFrameworkHydration,
} from "../../../lib/framework-selection";
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
      let artifact = getLibraryArtifact(selectedArtifactId);
      if (!artifact) {
        const response = await fetch(`/api/artifacts/${encodeURIComponent(selectedArtifactId)}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Artifact context unavailable");
        const remote = (await response.json()) as Record<string, unknown>;
        if (typeof remote.id !== "string" || typeof remote.title !== "string") throw new Error("Artifact context unavailable");
        artifact = {
          id: remote.id,
          slug: typeof remote.slug === "string" ? remote.slug : remote.id,
          title: remote.title,
          family: typeof remote.family === "string" ? remote.family : "Simulation",
          framework: typeof remote.framework === "string" ? remote.framework : "Qiskit",
          status: "verified",
          updatedAt: typeof remote.updated_at === "string" ? remote.updated_at : new Date().toISOString(),
          description: "Saved artifact in the workspace repository.",
          tags: [typeof remote.family === "string" ? remote.family.toLowerCase() : "artifact"],
          verification: "Verification evidence is retained with the saved run.",
          code: "",
          qasm: null,
          currentVersionId: typeof remote.current_version_id === "string" ? remote.current_version_id : undefined,
          resourceRows: [],
          source: "run",
        };
      }
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
      setPrompt(`Use the saved Library artifact “${artifact.title}” as context for my next question.`);
    }

    void loadContext().catch(() => {
      if (!active) return;
      setError("Artifact context unavailable");
      setArtifactHydration("error");
    });
    return () => { active = false; };
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
          ? "Resolve the artifact context error before submitting."
          : "Wait for the artifact framework to finish loading.",
      );
      return;
    }
    if (demoMode) {
      setError("Public preview mode is view-only. Sign in to start a real run.");
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
          mode: "execute",
          framework,
          ...(contextArtifact?.code ? { source_code: contextArtifact.code } : {}),
          ...(contextArtifact?.currentVersionId ? { artifact_version_id: contextArtifact.currentVersionId } : {}),
        }),
      });
      const payload = (await response.json()) as { id?: string; conversation_id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
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
            <p className="mj-run-context-link" role="status">Loading artifact context…</p>
          ) : null}
          {artifactHydration === "error" ? (
            <p className="mj-run-context-link" role="alert">Artifact context could not be loaded.</p>
          ) : null}

          {contextArtifact ? <a className="mj-run-context-link" href={demoMode ? "/demo?view=library" : `/library/${contextArtifact.id}`}>{copy.contextLabel}: {contextArtifact.title} · {copy.viewArtifact}</a> : null}

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

function ExampleStrip({ copy, onPick }: { copy: (typeof WORKSPACE_COPY)[PublicLocale]["run"]; onPick: (prompt: string) => void }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const examples = copy.examples;
  const allPrompts = [...copy.examples, ...copy.morePrompts];

  useEffect(() => {
    if (paused || expanded) return;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % examples.length), 6000);
    return () => window.clearInterval(timer);
  }, [paused, expanded, examples.length]);

  const active = examples[index];
  return (
    <section className="mj-run-home-examples" aria-labelledby="examples-title">
      <div className="mj-run-home-examples-head">
        <h2 id="examples-title">{copy.examplesTitle}</h2>
      </div>
      <div
        className="mj-example-strip"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocus={() => setPaused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused(false);
        }}
      >
        <button className="mj-example-ticker" type="button" key={active.title} onClick={() => onPick(active.prompt)}>
          <strong>{active.title}</strong>
          <span>{active.prompt}</span>
        </button>
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

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
