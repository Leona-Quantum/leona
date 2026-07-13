"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, StudioIcon } from "../../../components/icons";
import type { ComposerFramework } from "../../../components/run-composer";
import { frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, type LibraryArtifact } from "../../../lib/library-data";

type StudioPanel = "canvas" | "code" | "versions";
type StudioAction = "simulate" | "verify" | "save";

const FRAMEWORK_OPTIONS: Array<{ value: ComposerFramework; label: string }> = [
  { value: "qiskit", label: "Qiskit" },
  { value: "pennylane", label: "PennyLane" },
  { value: "cirq", label: "Cirq" },
];

const STARTER_CODES: Record<ComposerFramework, string> = {
  qiskit: `from qiskit import QuantumCircuit

qc = QuantumCircuit(2)
qc.h(0)
qc.cx(0, 1)
qc.measure_all()`,
  pennylane: `import pennylane as qml

dev = qml.device("default.qubit", wires=2, shots=1000)

@qml.qnode(dev)
def bell_state():
    qml.Hadamard(wires=0)
    qml.CNOT(wires=[0, 1])
    return qml.sample()`,
  cirq: `import cirq

qubits = cirq.LineQubit.range(2)
circuit = cirq.Circuit(
    cirq.H(qubits[0]),
    cirq.CNOT(qubits[0], qubits[1]),
    cirq.measure(*qubits, key="result"),
)`,
};

export function StudioWorkspace({ artifactId }: { artifactId?: string }) {
  const initialArtifact = artifactId ? getLibraryArtifact(artifactId) : null;
  const initialFramework = normalizeFramework(initialArtifact?.framework);
  const initialDrafts = makeDrafts(initialArtifact);
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>(() => loadLibraryArtifacts());
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(initialArtifact);
  const [selectedId, setSelectedId] = useState(artifactId ?? "");
  const [title, setTitle] = useState(initialArtifact?.title ?? "Untitled circuit");
  const [framework, setFramework] = useState<ComposerFramework>(initialFramework);
  const [drafts, setDrafts] = useState<Record<ComposerFramework, string>>(initialDrafts);
  const [code, setCode] = useState(initialDrafts[initialFramework]);
  const [panel, setPanel] = useState<StudioPanel>("canvas");
  const [selectedGate, setSelectedGate] = useState("H");
  const [busy, setBusy] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/artifacts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Artifact API unavailable");
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (!active || !Array.isArray(payload)) return;
        const remote = payload.flatMap((value) => toLibraryArtifact(value));
        const byId = new Map([...loadLibraryArtifacts(), ...remote].map((item) => [item.id, item]));
        setArtifacts([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => undefined);

    if (artifactId && !initialArtifact) {
      void loadArtifact(artifactId)
        .then((loaded) => {
          if (active && loaded) applyArtifact(loaded);
        })
        .catch(() => {
          if (active) setMessage("The selected artifact could not be loaded.");
        });
    }
    return () => {
      active = false;
    };
  }, [artifactId]);

  function applyArtifact(next: LibraryArtifact | null) {
    setArtifact(next);
    setSelectedId(next?.id ?? "");
    setTitle(next?.title ?? "Untitled circuit");
    const nextDrafts = makeDrafts(next);
    const nextFramework = normalizeFramework(next?.framework);
    setDrafts(nextDrafts);
    setFramework(nextFramework);
    setCode(nextDrafts[nextFramework]);
    setPanel("canvas");
    setRunId(null);
  }

  async function selectArtifact(id: string) {
    setMessage(null);
    const local = getLibraryArtifact(id);
    if (local?.code) {
      applyArtifact(local);
      return;
    }
    try {
      const loaded = await loadArtifact(id);
      if (loaded) applyArtifact(loaded);
      else setMessage("That artifact has no current version to edit.");
    } catch {
      setMessage("The selected artifact could not be loaded.");
    }
  }

  function changeFramework(next: ComposerFramework) {
    if (next === framework) return;
    setDrafts((current) => ({ ...current, [framework]: code }));
    setFramework(next);
    setCode(drafts[next] || STARTER_CODES[next]);
    setMessage(`Editing the ${frameworkLabel(next)} draft. Run it before treating it as verified.`);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setMessage(`${frameworkLabel(framework)} code copied.`);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage("Copy is unavailable in this browser context.");
    }
  }

  async function startRun(action: StudioAction) {
    if (!code.trim() || busy) return;
    setBusy(action);
    setMessage(null);
    setRunId(null);
    const intent = action === "simulate" ? "simulate" : action === "verify" ? "verify" : "verify and save a new version of";
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: `Please ${intent} the edited quantum circuit “${title}” in ${frameworkLabel(framework)}. Preserve the supplied source code, report the evidence clearly, and do not silently change frameworks.`,
          mode: "execute",
          framework,
          source_code: code,
          ...(artifact?.currentVersionId ? { artifact_version_id: artifact.currentVersionId } : {}),
        }),
      });
      const payload = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
      }
      setRunId(payload.id);
      setMessage(action === "save" ? "Verification started. A passing run will become the next saved version." : `${action === "simulate" ? "Simulation" : "Verification"} started in Nameko Run.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Run submission failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mj-studio-page">
      <header className="mj-studio-header">
        <div className="mj-studio-brand">
          <StudioIcon size={18} />
          <div>
            <span className="mj-section-label">R&amp;D workspace</span>
            <strong>Studio</strong>
          </div>
        </div>
        <div className="mj-studio-header-meta">
          <span className="mj-studio-status"><span className="mj-status-dot" aria-hidden="true" />Draft changes are local until verified</span>
          <a className="mj-secondary-button" href={selectedId ? `/library/${selectedId}` : "/library"}>Back to Library</a>
        </div>
      </header>

      <div className="mj-studio-workspace">
        <aside className="mj-studio-sidebar" aria-label="Studio artifacts">
          <div className="mj-studio-sidebar-head">
            <span className="mj-section-label">Artifacts</span>
            <button className="mj-secondary-button" type="button" onClick={() => applyArtifact(null)}>New</button>
          </div>
          <div className="mj-studio-artifact-list">
            {artifacts.length ? artifacts.map((item) => (
              <button
                className={`mj-studio-artifact${item.id === selectedId ? " is-active" : ""}`}
                type="button"
                key={item.id}
                onClick={() => void selectArtifact(item.id)}
              >
                <span className="mj-studio-artifact-mark" aria-hidden="true">{item.status === "verified" ? "✓" : "–"}</span>
                <span><strong>{item.title}</strong><small>{item.framework} · {item.family}</small></span>
              </button>
            )) : <p className="mj-studio-empty">No saved artifacts yet. Start with the Bell-state draft.</p>}
          </div>
          <p className="mj-studio-sidebar-note">Library stores saved artifacts. Studio is where drafts become evidence.</p>
        </aside>

        <main className="mj-studio-main">
          <div className="mj-studio-main-head">
            <div className="mj-studio-title-block">
              <label className="mj-section-label" htmlFor="studio-title">Working circuit</label>
              <input id="studio-title" className="mj-studio-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
              <p>{artifact ? `Editing version ${artifact.currentVersionId ? artifact.currentVersionId.slice(0, 8) : "draft"} · ${artifact.framework}` : "A clean draft for exploring a circuit before it enters Library."}</p>
            </div>
            <div className="mj-studio-actions">
              <button className="mj-secondary-button" type="button" onClick={() => void copyCode()}><CopyIcon size={14} />{copied ? "Copied" : "Copy code"}</button>
              <button className="mj-secondary-button" type="button" disabled={busy !== null} onClick={() => void startRun("simulate")}>{busy === "simulate" ? "Starting…" : "Simulate"}</button>
              <button className="mj-primary-button" type="button" disabled={busy !== null} onClick={() => void startRun("save")}>{busy === "save" ? "Starting…" : "Verify & save"}</button>
            </div>
          </div>

          <nav className="mj-studio-tabs" aria-label="Studio view">
            {(["canvas", "code", "versions"] as StudioPanel[]).map((item) => (
              <button className={panel === item ? "is-active" : ""} type="button" key={item} onClick={() => setPanel(item)}>
                {item === "canvas" ? "Circuit" : item === "code" ? "Code" : "Versions"}
              </button>
            ))}
          </nav>

          {panel === "canvas" ? <CircuitCanvas framework={framework} code={code} selectedGate={selectedGate} onSelectGate={setSelectedGate} /> : null}
          {panel === "code" ? <CodeEditor code={code} framework={framework} onChange={setCode} onCopy={() => void copyCode()} copied={copied} /> : null}
          {panel === "versions" ? <VersionPanel artifact={artifact} runId={runId} /> : null}

          <footer className="mj-studio-footer" aria-live="polite">
            <span>{message ?? "Select a gate to inspect it, or switch to Code to edit the source."}</span>
            {runId ? <a href={`/run/${runId}`}>Open live run →</a> : null}
          </footer>
        </main>

        <aside className="mj-studio-inspector" aria-label="Circuit inspector">
          <div className="mj-studio-inspector-head"><span className="mj-section-label">Inspector</span><span className="mj-mono-muted">live draft</span></div>
          <label className="mj-studio-field">
            <span>Framework</span>
            <select value={framework} onChange={(event) => changeFramework(event.target.value as ComposerFramework)}>
              {FRAMEWORK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <div className="mj-studio-inspector-card">
            <span className="mj-section-label">Selected gate</span>
            <strong>{selectedGate}</strong>
            <p>{gateDescription(selectedGate)}</p>
          </div>
          <div className="mj-studio-inspector-card">
            <span className="mj-section-label">Run contract</span>
            <dl className="mj-studio-contract">
              <div><dt>Mode</dt><dd>Execute</dd></div>
              <div><dt>Source</dt><dd>{artifact ? "Existing version" : "New draft"}</dd></div>
              <div><dt>Evidence</dt><dd>Sandbox + verifier</dd></div>
            </dl>
          </div>
          <div className="mj-studio-framework-note">
            <CheckIcon size={14} />
            <span>Qiskit stays the default. Switch only when you want a different framework draft.</span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function CircuitCanvas({ framework, code, selectedGate, onSelectGate }: { framework: ComposerFramework; code: string; selectedGate: string; onSelectGate: (gate: string) => void }) {
  const hasMeasure = code.toLowerCase().includes("measure") || code.toLowerCase().includes("sample");
  const gates = ["H", "CX", ...(hasMeasure ? ["M"] : [])];
  return (
    <section className="mj-studio-surface mj-studio-canvas" aria-label="Circuit canvas">
      <div className="mj-studio-surface-head">
        <div><span className="mj-section-label">Circuit canvas</span><h2>Bell-state starter</h2></div>
        <span className="mj-mono-muted">{frameworkLabel(framework)} · 2 qubits</span>
      </div>
      <div className="mj-circuit-stage">
        <svg className="mj-circuit-svg" viewBox="0 0 720 300" role="img" aria-label={`${frameworkLabel(framework)} circuit with two qubits`}>
          <line className="mj-circuit-wire" x1="86" y1="105" x2="655" y2="105" />
          <line className="mj-circuit-wire" x1="86" y1="195" x2="655" y2="195" />
          <text className="mj-circuit-label" x="28" y="111">q0</text>
          <text className="mj-circuit-label" x="28" y="201">q1</text>
          <g className={`mj-circuit-gate${selectedGate === "H" ? " is-selected" : ""}`} role="button" tabIndex={0} onClick={() => onSelectGate("H")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectGate("H"); }}>
            <rect x="170" y="80" width="50" height="50" rx="8" />
            <text x="195" y="111">H</text>
          </g>
          <g className={`mj-circuit-gate${selectedGate === "CX" ? " is-selected" : ""}`} role="button" tabIndex={0} onClick={() => onSelectGate("CX")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectGate("CX"); }}>
            <line className="mj-circuit-control" x1="365" y1="105" x2="365" y2="195" />
            <circle className="mj-circuit-control-dot" cx="365" cy="105" r="7" />
            <circle className="mj-circuit-target" cx="365" cy="195" r="17" />
            <path d="M365 184v22M354 195h22" />
            <text x="365" y="250">CX</text>
          </g>
          {hasMeasure ? (
            <g className={`mj-circuit-gate${selectedGate === "M" ? " is-selected" : ""}`} role="button" tabIndex={0} onClick={() => onSelectGate("M")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelectGate("M"); }}>
              <rect x="520" y="80" width="50" height="140" rx="8" />
              <text x="545" y="158">M</text>
            </g>
          ) : null}
          <text className="mj-circuit-output" x="640" y="92">out</text>
        </svg>
      </div>
      <div className="mj-studio-canvas-footer"><span>Click a gate to inspect its role.</span><span className="mj-mono-muted">{gates.join(" → ")}</span></div>
    </section>
  );
}

function CodeEditor({ code, framework, onChange, onCopy, copied }: { code: string; framework: ComposerFramework; onChange: (code: string) => void; onCopy: () => void; copied: boolean }) {
  return (
    <section className="mj-studio-surface mj-studio-code-panel" aria-label="Source editor">
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">Source editor</span><h2>{frameworkLabel(framework)} implementation</h2></div><button className="mj-secondary-button" type="button" onClick={onCopy}><CopyIcon size={14} />{copied ? "Copied" : "Copy code"}</button></div>
      <textarea className="mj-studio-code-editor" value={code} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${frameworkLabel(framework)} source editor`} />
      <p className="mj-studio-editor-note">Edit the draft directly. Simulate or verify it to produce evidence before it becomes a saved Library version.</p>
    </section>
  );
}

function VersionPanel({ artifact, runId }: { artifact: LibraryArtifact | null; runId: string | null }) {
  return (
    <section className="mj-studio-surface mj-studio-version-panel" aria-label="Artifact versions">
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">Version history</span><h2>{artifact ? artifact.title : "New draft"}</h2></div><span className="mj-mono-muted">repository view</span></div>
      <div className="mj-studio-version-row"><span className="mj-studio-version-dot" /><div><strong>{artifact?.currentVersionId ? `Current · ${artifact.currentVersionId.slice(0, 12)}` : "Draft · not saved"}</strong><p>{artifact ? "The current Library version remains unchanged until a passing verification run saves the next version." : "Run verification to create the first durable artifact version."}</p></div></div>
      {runId ? <div className="mj-studio-version-row"><span className="mj-studio-version-dot is-pending" /><div><strong>Verification run queued</strong><p>Run <a href={`/run/${runId}`}>{runId.slice(0, 12)}</a> will attach evidence when it finishes.</p></div></div> : null}
    </section>
  );
}

async function loadArtifact(id: string): Promise<LibraryArtifact | null> {
  const existing = getLibraryArtifact(id);
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) return existing;
  const payload = (await response.json()) as Record<string, unknown>;
  const artifact = toLibraryArtifact(payload)[0];
  if (!artifact) return existing;
  if (typeof payload.current_version_id === "string") {
    const versionResponse = await fetch(`/api/artifacts/${encodeURIComponent(id)}/versions/current`, { cache: "no-store" });
    if (versionResponse.ok) {
      const version = (await versionResponse.json()) as Record<string, unknown>;
      artifact.code = typeof version.code === "string" ? version.code : artifact.code;
      artifact.frameworkVariants = frameworkVariantsFromRemote(version.framework_variants) ?? artifact.frameworkVariants;
      artifact.qasm = typeof version.qasm === "string" ? version.qasm : artifact.qasm;
      artifact.currentVersionId = payload.current_version_id;
      artifact.resourceRows = resourceRowsFromRemote(version.resource_estimates);
    }
  }
  return artifact;
}

function toLibraryArtifact(value: unknown): LibraryArtifact[] {
  if (!value || typeof value !== "object") return [];
  const remote = value as Record<string, unknown>;
  if (typeof remote.id !== "string" || typeof remote.title !== "string") return [];
  const existing = getLibraryArtifact(remote.id);
  return [{
    id: remote.id,
    slug: typeof remote.slug === "string" ? remote.slug : remote.id,
    title: remote.title,
    family: typeof remote.family === "string" ? remote.family : "Simulation",
    framework: typeof remote.framework === "string" ? remote.framework : "Qiskit",
    status: existing?.status ?? "verified",
    updatedAt: typeof remote.updated_at === "string" ? remote.updated_at : new Date().toISOString(),
    description: existing?.description ?? "Saved artifact in the workspace repository.",
    tags: existing?.tags ?? ["artifact"],
    verification: existing?.verification ?? "Verification evidence is available after loading the current version.",
    code: existing?.code ?? "",
    qasm: existing?.qasm ?? null,
    currentVersionId: typeof remote.current_version_id === "string" ? remote.current_version_id : existing?.currentVersionId,
    resourceRows: existing?.resourceRows ?? [],
    runId: existing?.runId,
    source: existing?.source ?? "run",
  }];
}

function makeDrafts(artifact: LibraryArtifact | null): Record<ComposerFramework, string> {
  const active = normalizeFramework(artifact?.framework);
  const variants = artifact?.frameworkVariants ?? {};
  return {
    qiskit: variants.qiskit ?? (active === "qiskit" && artifact?.code ? artifact.code : STARTER_CODES.qiskit),
    pennylane: variants.pennylane ?? (active === "pennylane" && artifact?.code ? artifact.code : STARTER_CODES.pennylane),
    cirq: variants.cirq ?? (active === "cirq" && artifact?.code ? artifact.code : STARTER_CODES.cirq),
  };
}

function normalizeFramework(value: string | undefined): ComposerFramework {
  const normalized = value?.toLowerCase();
  return normalized === "pennylane" ? "pennylane" : normalized === "cirq" ? "cirq" : "qiskit";
}

function frameworkLabel(framework: ComposerFramework): string {
  return framework === "pennylane" ? "PennyLane" : framework === "cirq" ? "Cirq" : "Qiskit";
}

function gateDescription(gate: string): string {
  if (gate === "CX") return "Controlled-X entangles the target with the control qubit.";
  if (gate === "M") return "Measurement records the final computational-basis result.";
  return "Hadamard creates an equal superposition on the selected qubit.";
}

function resourceRowsFromRemote(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([label, raw]) => {
    if (typeof raw !== "string" && typeof raw !== "number") return [];
    return [{ label: label.replaceAll("_", " "), value: String(raw) }];
  });
}
