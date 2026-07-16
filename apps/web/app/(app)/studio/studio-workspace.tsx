"use client";

import { useEffect, useState } from "react";
import { CheckIcon, CopyIcon, SearchIcon } from "../../../components/icons";
import type { ComposerFramework } from "../../../components/run-composer";
import { frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

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

export function StudioWorkspace({ artifactId, newDraft = false, locale = "en" }: { artifactId?: string; newDraft?: boolean; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].studio;
  const initialArtifact = artifactId ? getLibraryArtifact(artifactId) : null;
  const initialFramework = normalizeFramework(initialArtifact?.framework);
  const initialDrafts = makeDrafts(initialArtifact);
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>(() => loadLibraryArtifacts());
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(initialArtifact);
  const [showEditor, setShowEditor] = useState(Boolean(artifactId || newDraft));
  const [query, setQuery] = useState("");
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
          if (active) setMessage(copy.selectedUnavailable);
        });
    }
    return () => {
      active = false;
    };
  }, [artifactId, copy]);

  function applyArtifact(next: LibraryArtifact | null) {
    setShowEditor(true);
    setArtifact(next);
    setTitle(next?.title ?? "Untitled circuit");
    const nextDrafts = makeDrafts(next);
    const nextFramework = normalizeFramework(next?.framework);
    setDrafts(nextDrafts);
    setFramework(nextFramework);
    setCode(nextDrafts[nextFramework]);
    setPanel("canvas");
    setRunId(null);
  }

  const filteredArtifacts = artifacts.filter((item) => {
    const normalized = query.trim().toLowerCase();
    return !normalized || [item.title, item.family, item.framework, item.description, ...item.tags].join(" ").toLowerCase().includes(normalized);
  });

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
      else setMessage(copy.noCurrentVersion);
    } catch {
      setMessage(copy.selectedUnavailable);
    }
  }

  function changeFramework(next: ComposerFramework) {
    if (next === framework) return;
    setDrafts((current) => ({ ...current, [framework]: code }));
    setFramework(next);
    setCode(drafts[next] || STARTER_CODES[next]);
    setMessage(copy.editingDraft(frameworkLabel(next)));
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setMessage(copy.codeCopied(frameworkLabel(framework)));
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setMessage(copy.copyUnavailable);
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
      setMessage(action === "save" ? copy.verificationStarted : copy.actionStarted(action === "simulate" ? (locale === "ja" ? "シミュレーション" : "Simulation") : (locale === "ja" ? "検証" : "Verification")));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.submissionFailed);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mj-studio-page">
      <div className={`mj-studio-workspace${showEditor ? " mj-studio-workspace--editor" : " mj-studio-workspace--discovery"}`}>
        {showEditor ? (
          <>
            <section className="mj-studio-main">
              <div className="mj-studio-main-head">
                <div className="mj-studio-title-block">
                  <label className="mj-section-label" htmlFor="studio-title">{copy.workingCircuit}</label>
                  <input id="studio-title" className="mj-studio-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
                  <p>{artifact ? copy.editingVersion(artifact.currentVersionId ? artifact.currentVersionId.slice(0, 8) : (locale === "ja" ? "下書き" : "draft"), artifact.framework) : copy.newDraft}</p>
                </div>
                <div className="mj-studio-actions">
                  <button className="mj-secondary-button" type="button" onClick={() => void copyCode()} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button>
                  <button className="mj-secondary-button" type="button" disabled={busy !== null} onClick={() => void startRun("simulate")}>{busy === "simulate" ? copy.starting : copy.simulate}</button>
                  <button className="mj-primary-button" type="button" disabled={busy !== null} onClick={() => void startRun("save")}>{busy === "save" ? copy.starting : copy.verifySave}</button>
                </div>
              </div>

              <nav className="mj-studio-tabs" aria-label={copy.view}>
                {(["canvas", "code", "versions"] as StudioPanel[]).map((item) => (
                  <button className={panel === item ? "is-active" : ""} type="button" key={item} onClick={() => setPanel(item)}>
                    {item === "canvas" ? copy.circuit : item === "code" ? copy.code : copy.versions}
                  </button>
                ))}
              </nav>

              {panel === "canvas" ? (
                <CircuitBuilder
                  framework={framework}
                  selectedGate={selectedGate}
                  onSelectGate={setSelectedGate}
                  copy={copy}
                  onApply={(codes) => {
                    setDrafts(codes);
                    setCode(codes[framework]);
                    setMessage(copy.appliedToCode);
                  }}
                />
              ) : null}
              {panel === "code" ? <CodeEditor code={code} framework={framework} onChange={setCode} onCopy={() => void copyCode()} copied={copied} copy={copy} /> : null}
              {panel === "versions" ? <VersionPanel artifact={artifact} runId={runId} copy={copy} /> : null}

              <footer className="mj-studio-footer" aria-live="polite">
                <span>{message ?? copy.footer}</span>
                {runId ? <a href={`/run/${runId}`}>{copy.openRun} →</a> : null}
              </footer>
            </section>

            <aside className="mj-studio-inspector" aria-label={copy.inspector}>
              <div className="mj-studio-inspector-head"><span className="mj-section-label">{copy.inspector}</span><span className="mj-mono-muted">{copy.liveDraft}</span></div>
              <label className="mj-studio-field">
                <span>{locale === "ja" ? "フレームワーク" : "Framework"}</span>
                <select value={framework} onChange={(event) => changeFramework(event.target.value as ComposerFramework)}>
                  {FRAMEWORK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="mj-studio-inspector-card">
                <span className="mj-section-label">{copy.selectedGate}</span>
                <strong>{selectedGate}</strong>
                <p>{copy.gateDescriptions[selectedGate] ?? copy.gateDescriptions.H}</p>
              </div>
              <div className="mj-studio-inspector-card">
                <span className="mj-section-label">{copy.runContract}</span>
                <dl className="mj-studio-contract">
                  <div><dt>{copy.mode}</dt><dd>{copy.execute}</dd></div>
                  <div><dt>{copy.source}</dt><dd>{artifact ? copy.existingVersion : copy.newDraftSource}</dd></div>
                  <div><dt>{copy.evidence}</dt><dd>{copy.sandboxVerifier}</dd></div>
                </dl>
              </div>
              <div className="mj-studio-framework-note">
                <CheckIcon size={14} />
                <span>{copy.frameworkNote}</span>
              </div>
            </aside>
          </>
        ) : (
          <section className="mj-studio-discovery">
            <div className="mj-studio-discovery-heading">
              <div>
                <span className="mj-section-label">{copy.label}</span>
                <h1>{copy.title}</h1>
                <p>{copy.sidebarNote}</p>
              </div>
              <button className="mj-primary-button" type="button" onClick={() => applyArtifact(null)}>{copy.new}</button>
            </div>
            <label className="mj-studio-search">
              <SearchIcon size={17} />
              <span className="sr-only">{copy.search}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
            </label>
            <div className="mj-studio-discovery-list">
              {filteredArtifacts.length ? filteredArtifacts.map((item) => (
                <article className="mj-studio-discovery-card" key={item.id}>
                  <button type="button" onClick={() => void selectArtifact(item.id)}>
                    <span className="mj-studio-artifact-mark" aria-hidden="true">{item.status === "verified" ? "✓" : "–"}</span>
                    <span><strong>{item.title}</strong><small>{item.framework} · {item.family} · {formatDiscoveryDate(item.updatedAt, locale)}</small><em>{item.description}</em></span>
                  </button>
                  <a className="mj-secondary-button" href={`/run?artifact=${encodeURIComponent(item.id)}`}>{copy.openRun}</a>
                </article>
              )) : <p className="mj-studio-empty">{artifacts.length ? copy.noSearchResults : copy.empty}</p>}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

type BuilderGate = "H" | "X" | "Y" | "Z" | "S" | "T" | "RX" | "RY" | "RZ" | "CX" | "CZ" | "SWAP" | "M";
type BuilderStep = { gate: BuilderGate; qubits: number[]; param?: string };

const BUILDER_GATES: BuilderGate[] = ["H", "X", "Y", "Z", "S", "T", "RX", "RY", "RZ", "CX", "CZ", "SWAP", "M"];
const TWO_QUBIT_GATES: BuilderGate[] = ["CX", "CZ", "SWAP"];
const ROTATION_GATES: BuilderGate[] = ["RX", "RY", "RZ"];
const ANGLE_OPTIONS = ["pi/8", "pi/4", "pi/2", "pi", "3*pi/2", "2*pi"];

function CircuitBuilder({ framework, selectedGate, onSelectGate, onApply, copy }: { framework: ComposerFramework; selectedGate: string; onSelectGate: (gate: string) => void; onApply: (codes: Record<ComposerFramework, string>) => void; copy: StudioCopy }) {
  const [qubitCount, setQubitCount] = useState(2);
  const [steps, setSteps] = useState<BuilderStep[]>([]);
  const [pendingControl, setPendingControl] = useState<number | null>(null);
  const [angle, setAngle] = useState("pi/2");

  const armed = (BUILDER_GATES as string[]).includes(selectedGate) ? (selectedGate as BuilderGate) : "H";

  function placeOnQubit(qubit: number) {
    if (TWO_QUBIT_GATES.includes(armed)) {
      if (pendingControl === null) {
        setPendingControl(qubit);
        return;
      }
      if (pendingControl === qubit) {
        setPendingControl(null);
        return;
      }
      setSteps((current) => [...current, { gate: armed, qubits: [pendingControl, qubit] }]);
      setPendingControl(null);
      return;
    }
    setSteps((current) => [...current, { gate: armed, qubits: [qubit], ...(ROTATION_GATES.includes(armed) ? { param: angle } : {}) }]);
  }

  function changeQubitCount(delta: number) {
    const next = Math.min(6, Math.max(1, qubitCount + delta));
    if (next === qubitCount) return;
    setQubitCount(next);
    setPendingControl(null);
    if (next < qubitCount) setSteps((current) => current.filter((step) => step.qubits.every((q) => q < next)));
  }

  const columnWidth = 52;
  const leftPad = 74;
  const topPad = 34;
  const rowHeight = 52;
  const width = Math.max(560, leftPad + (steps.length + 2) * columnWidth + 40);
  const height = topPad + qubitCount * rowHeight + 10;

  return (
    <section className="mj-studio-surface mj-studio-canvas" aria-label={copy.canvasLabel}>
      <div className="mj-studio-surface-head">
        <div><span className="mj-section-label">{copy.canvasLabel}</span><h2>{copy.generatedPreview}</h2></div>
        <span className="mj-mono-muted">{frameworkLabel(framework)} · {qubitCount}q · {steps.length} ops</span>
      </div>

      <div className="mj-builder-palette" role="toolbar" aria-label={copy.palette}>
        {BUILDER_GATES.map((gate) => (
          <button key={gate} type="button" className={`mj-builder-gate${armed === gate ? " is-active" : ""}`} aria-pressed={armed === gate} onClick={() => { onSelectGate(gate); setPendingControl(null); }}>
            {gate}
          </button>
        ))}
        {ROTATION_GATES.includes(armed) ? (
          <label className="mj-builder-angle">
            <span>{copy.angleLabel}</span>
            <select value={angle} onChange={(event) => setAngle(event.target.value)}>
              {ANGLE_OPTIONS.map((option) => <option key={option} value={option}>{option.replace("pi", "π").replace("*", "")}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mj-circuit-stage">
        <svg className="mj-circuit-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.circuitAria(frameworkLabel(framework))} style={{ maxWidth: "100%" }}>
          {Array.from({ length: qubitCount }, (_, q) => {
            const y = topPad + q * rowHeight;
            return (
              <g key={q}>
                <text className="mj-circuit-label" x="18" y={y + 5}>q{q}</text>
                <line className="mj-circuit-wire" x1={leftPad - 16} y1={y} x2={width - 24} y2={y} />
                <g
                  className={`mj-circuit-gate mj-builder-slot${pendingControl === q ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`q${q}: ${armed}`}
                  onClick={() => placeOnQubit(q)}
                  onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); placeOnQubit(q); } }}
                >
                  <rect x={leftPad + steps.length * columnWidth - 17} y={y - 17} width="34" height="34" rx="7" strokeDasharray="4 3" fill="transparent" />
                  <text x={leftPad + steps.length * columnWidth} y={y + 5}>+</text>
                </g>
              </g>
            );
          })}
          {steps.map((step, index) => {
            const x = leftPad + index * columnWidth;
            const yFor = (q: number) => topPad + q * rowHeight;
            if (step.gate === "CX" || step.gate === "CZ" || step.gate === "SWAP") {
              const [control, target] = step.qubits;
              return (
                <g className="mj-circuit-gate" key={index}>
                  <line className="mj-circuit-control" x1={x} y1={yFor(control)} x2={x} y2={yFor(target)} />
                  {step.gate === "SWAP" ? (
                    <>
                      <path d={`M${x - 7} ${yFor(control) - 7}l14 14M${x - 7} ${yFor(control) + 7}l14 -14`} />
                      <path d={`M${x - 7} ${yFor(target) - 7}l14 14M${x - 7} ${yFor(target) + 7}l14 -14`} />
                    </>
                  ) : (
                    <>
                      <circle className="mj-circuit-control-dot" cx={x} cy={yFor(control)} r="6" />
                      {step.gate === "CX" ? (
                        <>
                          <circle className="mj-circuit-target" cx={x} cy={yFor(target)} r="13" />
                          <path d={`M${x} ${yFor(target) - 9}v18M${x - 9} ${yFor(target)}h18`} />
                        </>
                      ) : (
                        <circle className="mj-circuit-control-dot" cx={x} cy={yFor(target)} r="6" />
                      )}
                    </>
                  )}
                </g>
              );
            }
            const y = yFor(step.qubits[0]);
            return (
              <g className="mj-circuit-gate" key={index}>
                <rect x={x - 17} y={y - 17} width="34" height="34" rx="7" />
                <text x={x} y={y + 5}>{step.gate === "M" ? "M" : step.gate}</text>
                {step.param ? <text className="mj-circuit-label" x={x} y={y + 30}>{step.param.replace("pi", "π").replace("*", "")}</text> : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mj-builder-controls">
        <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(1)} disabled={qubitCount >= 6}>{copy.addQubit}</button>
        <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(-1)} disabled={qubitCount <= 1}>{copy.removeQubit}</button>
        <button className="mj-secondary-button" type="button" onClick={() => { setSteps((current) => current.slice(0, -1)); setPendingControl(null); }} disabled={!steps.length}>{copy.undo}</button>
        <button className="mj-secondary-button" type="button" onClick={() => { setSteps([]); setPendingControl(null); }} disabled={!steps.length}>{copy.clearAll}</button>
        <button className="mj-primary-button" type="button" onClick={() => onApply(generateBuilderCode(steps, qubitCount))} disabled={!steps.length}>{copy.applyToCode}</button>
      </div>

      <div className="mj-studio-canvas-footer" aria-live="polite">
        <span>{pendingControl !== null ? copy.pickTarget : steps.length ? copy.builderHint : copy.builderEmpty}</span>
        <span className="mj-mono-muted">{steps.length ? steps.map((step) => step.gate).join(" → ") : "—"}</span>
      </div>
    </section>
  );
}

function generateBuilderCode(steps: BuilderStep[], qubitCount: number): Record<ComposerFramework, string> {
  const ordered = steps.filter((step) => step.gate !== "M");
  const measured = steps.some((step) => step.gate === "M");
  const usesAngle = ordered.some((step) => step.param);

  const qiskitLines = ordered.map((step) => {
    const [a, b] = step.qubits;
    switch (step.gate) {
      case "H": return `qc.h(${a})`;
      case "X": return `qc.x(${a})`;
      case "Y": return `qc.y(${a})`;
      case "Z": return `qc.z(${a})`;
      case "S": return `qc.s(${a})`;
      case "T": return `qc.t(${a})`;
      case "RX": return `qc.rx(${step.param}, ${a})`;
      case "RY": return `qc.ry(${step.param}, ${a})`;
      case "RZ": return `qc.rz(${step.param}, ${a})`;
      case "CX": return `qc.cx(${a}, ${b})`;
      case "CZ": return `qc.cz(${a}, ${b})`;
      case "SWAP": return `qc.swap(${a}, ${b})`;
      default: return "";
    }
  }).filter(Boolean);
  const qiskit = [
    "from qiskit import QuantumCircuit",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    `qc = QuantumCircuit(${qubitCount})`,
    ...qiskitLines,
    ...(measured ? ["qc.measure_all()"] : []),
  ].join("\n");

  const pennylaneLines = ordered.map((step) => {
    const [a, b] = step.qubits;
    switch (step.gate) {
      case "H": return `    qml.Hadamard(wires=${a})`;
      case "X": return `    qml.PauliX(wires=${a})`;
      case "Y": return `    qml.PauliY(wires=${a})`;
      case "Z": return `    qml.PauliZ(wires=${a})`;
      case "S": return `    qml.S(wires=${a})`;
      case "T": return `    qml.T(wires=${a})`;
      case "RX": return `    qml.RX(${step.param}, wires=${a})`;
      case "RY": return `    qml.RY(${step.param}, wires=${a})`;
      case "RZ": return `    qml.RZ(${step.param}, wires=${a})`;
      case "CX": return `    qml.CNOT(wires=[${a}, ${b}])`;
      case "CZ": return `    qml.CZ(wires=[${a}, ${b}])`;
      case "SWAP": return `    qml.SWAP(wires=[${a}, ${b}])`;
      default: return "";
    }
  }).filter(Boolean);
  const pennylane = [
    "import pennylane as qml",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    `dev = qml.device("default.qubit", wires=${qubitCount}${measured ? ", shots=1000" : ""})`,
    "",
    "@qml.qnode(dev)",
    "def circuit():",
    ...(pennylaneLines.length ? pennylaneLines : ["    pass"]),
    measured ? "    return qml.sample()" : "    return qml.state()",
  ].join("\n");

  const cirqLines = ordered.map((step) => {
    const [a, b] = step.qubits;
    switch (step.gate) {
      case "H": return `    cirq.H(qubits[${a}]),`;
      case "X": return `    cirq.X(qubits[${a}]),`;
      case "Y": return `    cirq.Y(qubits[${a}]),`;
      case "Z": return `    cirq.Z(qubits[${a}]),`;
      case "S": return `    cirq.S(qubits[${a}]),`;
      case "T": return `    cirq.T(qubits[${a}]),`;
      case "RX": return `    cirq.rx(${step.param}).on(qubits[${a}]),`;
      case "RY": return `    cirq.ry(${step.param}).on(qubits[${a}]),`;
      case "RZ": return `    cirq.rz(${step.param}).on(qubits[${a}]),`;
      case "CX": return `    cirq.CNOT(qubits[${a}], qubits[${b}]),`;
      case "CZ": return `    cirq.CZ(qubits[${a}], qubits[${b}]),`;
      case "SWAP": return `    cirq.SWAP(qubits[${a}], qubits[${b}]),`;
      default: return "";
    }
  }).filter(Boolean);
  const cirq = [
    "import cirq",
    ...(usesAngle ? ["from numpy import pi"] : []),
    "",
    `qubits = cirq.LineQubit.range(${qubitCount})`,
    "circuit = cirq.Circuit(",
    ...cirqLines,
    ...(measured ? ["    cirq.measure(*qubits, key=\"result\"),"] : []),
    ")",
  ].join("\n");

  return { qiskit, pennylane, cirq };
}

function CodeEditor({ code, framework, onChange, onCopy, copied, copy }: { code: string; framework: ComposerFramework; onChange: (code: string) => void; onCopy: () => void; copied: boolean; copy: StudioCopy }) {
  return (
    <section className="mj-studio-surface mj-studio-code-panel" aria-label={copy.sourceEditor}>
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">{copy.sourceEditor}</span><h2>{copy.implementation(frameworkLabel(framework))}</h2></div><button className="mj-secondary-button" type="button" onClick={onCopy} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button></div>
      <textarea className="mj-studio-code-editor" value={code} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label={`${frameworkLabel(framework)} ${copy.sourceEditorInput}`} />
      <p className="mj-studio-editor-note">{copy.editorNote}</p>
    </section>
  );
}

function VersionPanel({ artifact, runId, copy }: { artifact: LibraryArtifact | null; runId: string | null; copy: StudioCopy }) {
  return (
    <section className="mj-studio-surface mj-studio-version-panel" aria-label={copy.versionHistory}>
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">{copy.versionHistory}</span><h2>{artifact ? artifact.title : copy.newDraftSource}</h2></div><span className="mj-mono-muted">{copy.repositoryView}</span></div>
      <div className="mj-studio-version-row"><span className="mj-studio-version-dot" /><div><strong>{artifact?.currentVersionId ? copy.currentVersion(artifact.currentVersionId.slice(0, 12)) : copy.draftNotSaved}</strong><p>{artifact ? copy.currentVersionNote : copy.draftVersionNote}</p></div></div>
      {runId ? <div className="mj-studio-version-row"><span className="mj-studio-version-dot is-pending" /><div><strong>{copy.verificationQueued}</strong><p><a href={`/run/${runId}`}>{runId.slice(0, 12)}</a> · {copy.verificationAttach(runId.slice(0, 12))}</p></div></div> : null}
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

function formatDiscoveryDate(value: string, locale: PublicLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  return date.toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric" });
}

function resourceRowsFromRemote(value: unknown): Array<{ label: string; value: string }> {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([label, raw]) => {
    if (typeof raw !== "string" && typeof raw !== "number") return [];
    return [{ label: label.replaceAll("_", " "), value: String(raw) }];
  });
}
