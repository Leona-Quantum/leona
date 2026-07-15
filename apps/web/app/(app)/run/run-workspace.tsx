"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { getLibraryArtifact, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { hydrateArtifactFramework } from "../../../lib/framework-selection";
import { RunComposer, type ComposerFramework } from "../../../components/run-composer";

export function RunWorkspace({ demoMode = false, locale = "en" }: { demoMode?: boolean; locale?: PublicLocale } = {}) {
  const copy = WORKSPACE_COPY[locale].run;
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const frameworkCurrent = useRef<ComposerFramework>("qiskit");
  const frameworkTouched = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextArtifact, setContextArtifact] = useState<LibraryArtifact | null>(null);

  useEffect(() => {
    let active = true;
    const artifactId = new URLSearchParams(window.location.search).get("artifact");
    if (!artifactId) return () => { active = false; };
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
      if (hydrated.error) setError(hydrated.error);
      frameworkCurrent.current = hydrated.framework;
      setFramework(hydrated.framework);
      setPrompt(`Use the saved Library artifact “${artifact.title}” as context for my next question.`);
    }

    void loadContext().catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const taskPrompt = prompt.trim();
    if (!taskPrompt || pending) return;
    if (demoMode) {
      setError("Public preview mode is view-only. Sign in to start a real run.");
      return;
    }
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
          task_prompt: taskPrompt,
          mode: "execute",
          framework,
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
          <header className="mj-run-home-heading">
            <div>
              <h1>{copy.title}</h1>
              <p>{copy.lede}</p>
            </div>
            <div className="mj-run-home-status" aria-label={locale === "ja" ? "モデルの状態" : "Model status"}>
              <span className="mj-status-dot" aria-hidden="true" />
              {demoMode ? copy.previewStatus : copy.readyStatus}
            </div>
          </header>

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
            onClearContext={() => setContextArtifact(null)}
            onAttach={() => setError(locale === "ja" ? "添付はまだ利用できません。コードやコンテキストを問いに貼り付けてください。" : "Attachments are not enabled yet; paste code or context into the prompt.")}
            locale={locale}
          />

          {contextArtifact ? <a className="mj-run-context-link" href={demoMode ? "/demo?view=library" : `/library/${contextArtifact.id}`}>{copy.contextLabel}: {contextArtifact.title} · {copy.viewArtifact}</a> : null}

          <section className="mj-run-home-examples" aria-labelledby="examples-title">
            <div className="mj-run-home-examples-head">
              <h2 id="examples-title">{copy.examplesTitle}</h2>
              <span>{copy.workflowTitle}</span>
            </div>
            <div className="mj-example-list">
              {copy.examples.map((example) => (
                <button
                  className="mj-example-button"
                  key={example.title}
                  type="button"
                  onClick={() => {
                    setPrompt(example.prompt);
                    setError(null);
                  }}
                >
                  <strong>{example.title}</strong>
                  <span>{example.prompt}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}
