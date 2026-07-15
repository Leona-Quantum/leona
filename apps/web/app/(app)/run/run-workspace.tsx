"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { getLibraryArtifact, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { RunComposer, type ComposerFramework, type ComposerMode } from "../../../components/run-composer";
import { BrandMark } from "../../../components/icons";

export function RunWorkspace({ demoMode = false, locale = "en" }: { demoMode?: boolean; locale?: PublicLocale } = {}) {
  const copy = WORKSPACE_COPY[locale].run;
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<ComposerMode>("execute");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [contextArtifact, setContextArtifact] = useState<LibraryArtifact | null>(null);

  useEffect(() => {
    const artifactId = new URLSearchParams(window.location.search).get("artifact");
    if (!artifactId) return;
    const artifact = getLibraryArtifact(artifactId);
    if (artifact) {
      setContextArtifact(artifact);
      setPrompt(`Create a follow-up from the saved Library artifact “${artifact.title}”. Preserve the verified structure, explain any changes, and re-run the checks.`);
      return;
    }
    void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact context unavailable");
        return (await response.json()) as Record<string, unknown>;
      })
      .then((remote) => {
        if (typeof remote.id !== "string" || typeof remote.title !== "string") return;
        const remoteArtifact: LibraryArtifact = {
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
          resourceRows: [],
          source: "run",
        };
        setContextArtifact(remoteArtifact);
        setPrompt(`Create a follow-up from the saved Library artifact “${remoteArtifact.title}”. Preserve the verified structure, explain any changes, and re-run the checks.`);
      })
      .catch(() => undefined);
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
        body: JSON.stringify({ task_prompt: taskPrompt, mode, framework }),
      });
      const payload = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
      }
      rememberChat({
        id: payload.id,
        title: titleFromPrompt(taskPrompt),
        prompt: taskPrompt,
        createdAt: new Date().toISOString(),
        status: "queued",
        framework: frameworkLabel(framework),
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
        <div className="mj-run-home-content">
          <header className="mj-run-home-heading">
            <div className="mj-run-home-identity">
              <span className="mj-run-home-mark"><BrandMark size={18} /></span>
              <span className="mj-run-home-wordmark">LeonaQ</span>
            </div>
            <h1>{copy.title}</h1>
            <p>{copy.lede}</p>
          </header>

          <div className="mj-run-home-disclosures">
            <details className="mj-run-disclosure" name="run-home-detail">
              <summary>
                <span className="mj-run-disclosure-label">
                  <span>{copy.starterPrompts}</span>
                  <strong>{copy.examplesTitle}</strong>
                </span>
                <span className="mj-run-disclosure-count">{copy.promptCount}</span>
              </summary>
              <div className="mj-run-disclosure-content">
                <div className="mj-example-list">
                  {copy.examples.map((example) => (
                    <button
                      className="mj-example-button"
                      key={example.title}
                      type="button"
                      onClick={(event) => {
                        setPrompt(example.prompt);
                        setError(null);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                    >
                      <strong>{example.title}</strong>
                      <span>{example.prompt}</span>
                    </button>
                  ))}
                </div>
              </div>
            </details>

            <details className="mj-run-disclosure" name="run-home-detail">
              <summary>
                <span className="mj-run-disclosure-label">
                  <span>{copy.process}</span>
                  <strong>{copy.workflowTitle}</strong>
                </span>
                <span className="mj-run-disclosure-count">{copy.stepCount}</span>
              </summary>
              <div className="mj-run-disclosure-content">
                <p className="mj-run-disclosure-intro">{copy.workflowBody}</p>
                <div className="mj-home-capabilities">
                  {copy.capabilities.map((capability) => <div className="mj-capability" key={capability.title}><strong>{capability.title}</strong><span>{capability.body}</span></div>)}
                </div>
              </div>
            </details>
          </div>
          {contextArtifact ? (
            <aside className="mj-run-context-card" aria-label={copy.contextLabel}>
              <div>
                <span className="mj-section-label">{copy.contextLabel}</span>
                <strong>{contextArtifact.title}</strong>
                <span>{contextArtifact.framework} · {contextArtifact.family} · {contextArtifact.status === "verified" ? (locale === "ja" ? "検証済み" : "Verified") : (locale === "ja" ? "注意付きで保存" : "Saved with caveats")}</span>
              </div>
              <a className="mj-secondary-button" href={demoMode ? "/demo?view=library" : `/library/${contextArtifact.id}`}>{copy.viewArtifact}</a>
            </aside>
          ) : null}
        </div>
      </div>
      <RunComposer
        value={prompt}
        mode={mode}
        framework={framework}
        pending={pending}
        error={error}
        onChange={setPrompt}
        onModeChange={setMode}
        onFrameworkChange={setFramework}
        onSubmit={submit}
        onAttach={() => setError(locale === "ja" ? "添付はまだ利用できません。コードやコンテキストを問いに貼り付けてください。" : "Attachments are not enabled yet; paste code or context into the prompt.")}
        locale={locale}
      />
    </div>
  );
}

function titleFromPrompt(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 54 ? `${firstLine.slice(0, 54).trimEnd()}…` : firstLine;
}

function frameworkLabel(framework: ComposerFramework): string {
  return framework === "pennylane" ? "PennyLane" : framework === "cirq" ? "Cirq" : "Qiskit";
}
