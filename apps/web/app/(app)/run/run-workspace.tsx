"use client";

import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rememberChat } from "../../../lib/chat-history";
import { getLibraryArtifact, type LibraryArtifact } from "../../../lib/library-data";
import { RunComposer, type ComposerFramework, type ComposerMode } from "../../../components/run-composer";
import { BrandMark } from "../../../components/icons";

const EXAMPLES = [
  {
    title: "Recover a marked state with Grover",
    prompt: "Use Grover to recover the marked state 1100 and verify the measured distribution.",
  },
  {
    title: "Compare QAOA with a classical baseline",
    prompt: "Use QAOA to solve MaxCut on a 5-node ring and compare the result with an exact classical baseline.",
  },
  {
    title: "Build and verify a Bell state",
    prompt: "Build a Bell state in Qiskit, simulate it, and verify the expected 00/11 distribution.",
  },
  {
    title: "Estimate a QFT resource profile",
    prompt: "Estimate the qubit count, depth, and gate profile for a QFT circuit on eight qubits.",
  },
];

export function RunWorkspace({ demoMode = false }: { demoMode?: boolean } = {}) {
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
      setPrompt(`Create a follow-up from the saved Quepo artifact “${artifact.title}”. Preserve the verified structure, explain any changes, and re-run the checks.`);
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
        setPrompt(`Create a follow-up from the saved Quepo artifact “${remoteArtifact.title}”. Preserve the verified structure, explain any changes, and re-run the checks.`);
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
            <h1>What are you working on?</h1>
            <p>Describe a quantum problem, paste code to review, or continue from a saved artifact.</p>
          </header>

          <div className="mj-run-home-disclosures">
            <details className="mj-run-disclosure" name="run-home-detail">
              <summary>
                <span className="mj-run-disclosure-label">
                  <span>Starter prompts</span>
                  <strong>Try an example</strong>
                </span>
                <span className="mj-run-disclosure-count">4 prompts</span>
              </summary>
              <div className="mj-run-disclosure-content">
                <div className="mj-example-list">
                  {EXAMPLES.map((example) => (
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
                  <span>Process</span>
                  <strong>How Nameko works</strong>
                </span>
                <span className="mj-run-disclosure-count">3 steps</span>
              </summary>
              <div className="mj-run-disclosure-content">
                <p className="mj-run-disclosure-intro">
                  Every run keeps its plan, generated code, checks, results, and saved artifact together.
                </p>
                <div className="mj-home-capabilities">
                  <div className="mj-capability">
                    <strong>Plan first</strong>
                    <span>Choose a method and verification target before compute.</span>
                  </div>
                  <div className="mj-capability">
                    <strong>Show the work</strong>
                    <span>Follow code, compilation, and checks as evidence arrives.</span>
                  </div>
                  <div className="mj-capability">
                    <strong>Save to Quepo</strong>
                    <span>Keep verified runs as reusable Library artifacts.</span>
                  </div>
                </div>
              </div>
            </details>
          </div>
          {contextArtifact ? (
            <aside className="mj-run-context-card" aria-label="Quepo artifact context">
              <div>
                <span className="mj-section-label">Quepo context</span>
                <strong>{contextArtifact.title}</strong>
                <span>{contextArtifact.framework} · {contextArtifact.family} · {contextArtifact.status === "verified" ? "Verified" : "Saved with caveats"}</span>
              </div>
              <a className="mj-secondary-button" href={demoMode ? "/demo?view=library" : `/library/${contextArtifact.id}`}>View artifact</a>
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
        onAttach={() => setError("Attachments are not enabled yet; paste code or context into the prompt.")}
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
