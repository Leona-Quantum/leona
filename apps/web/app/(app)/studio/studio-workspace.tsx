"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { CheckIcon, CopyIcon, PanelRightIcon, SearchIcon } from "../../../components/icons";
import type { ComposerFramework } from "../../../components/run-composer";
import { frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { BUILDER_GATES, builderStepLabel, createBuilderStepId, generateBuilderCode, ROTATION_GATES, TWO_QUBIT_GATES, type BuilderGate, type BuilderStep, type CustomGateDefinition } from "../../../lib/studio-builder";
import { loadStoredCircuit, saveStoredCircuit } from "../../../lib/studio-circuits";
import { parseBuilderCircuit } from "../../../lib/studio-parse";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioPanel = "canvas" | "code" | "versions";
type StudioAction = "simulate" | "verify" | "save";

type BuilderSeed = {
  key: string;
  artifactIdentity: string | null;
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
};

type ArtifactHydration = "loading" | "ready" | "error";

const EMPTY_SEED: Omit<BuilderSeed, "key"> = { artifactIdentity: null, qubitCount: 2, steps: [], customGates: [] };

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
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [showEditor, setShowEditor] = useState(Boolean(artifactId || newDraft));
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("Untitled circuit");
  const [framework, setFramework] = useState<ComposerFramework>("qiskit");
  const [drafts, setDrafts] = useState<Record<ComposerFramework, string>>(() => makeDrafts(null));
  const [code, setCode] = useState(STARTER_CODES.qiskit);
  const [panel, setPanel] = useState<StudioPanel>("canvas");
  const [selectedGate, setSelectedGate] = useState("H");
  const [busy, setBusy] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [artifactHydration, setArtifactHydration] = useState<ArtifactHydration>(() => artifactId && !newDraft ? "loading" : "ready");
  const [artifactSyncError, setArtifactSyncError] = useState(false);
  const [builderSeed, setBuilderSeed] = useState<BuilderSeed>({ key: "seed-0", ...EMPTY_SEED });
  const seedCounter = useRef(0);

  // Local storage is read only after mount so the server and client render
  // the same initial markup; the artifact then hydrates through applyArtifact.
  useEffect(() => {
    let active = true;
    setArtifacts(loadLibraryArtifacts());
    setArtifactSyncError(false);
    setArtifactHydration(artifactId && !newDraft ? "loading" : "ready");
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
      .catch(() => {
        if (active) setArtifactSyncError(true);
      });

    if (artifactId) {
      const local = getLibraryArtifact(artifactId);
      if (local?.code) {
        applyArtifact(local);
      } else {
        if (local) applyArtifact(local);
        void loadArtifact(artifactId)
          .then((loaded) => {
            if (active && loaded) applyArtifact(loaded);
            else if (active) {
              setArtifactHydration("error");
              setMessage(copy.selectedUnavailable);
            }
          })
          .catch(() => {
            if (active) {
              setArtifactHydration("error");
              setMessage(copy.selectedUnavailable);
            }
          });
      }
    }
    return () => {
      active = false;
    };
  }, [artifactId, copy]);

  function seedForArtifact(next: LibraryArtifact, activeDrafts: Record<ComposerFramework, string>, activeFramework: ComposerFramework): { seed: BuilderSeed; note: string | null } {
    seedCounter.current += 1;
    const key = `${next.id}:${seedCounter.current}`;
    const stored = loadStoredCircuit(next.id);
    const artifactIdentity = studioArtifactIdentity(next);
    if (stored?.artifactIdentity === artifactIdentity) {
      return { seed: { key, artifactIdentity, qubitCount: stored.qubitCount, steps: stored.steps, customGates: stored.customGates }, note: copy.circuitRestored };
    }
    const hasOwnCode = Boolean(next.code || next.frameworkVariants);
    const parsed = hasOwnCode ? parseBuilderCircuit(activeDrafts[activeFramework], activeFramework) : null;
    if (parsed) {
      return { seed: { key, artifactIdentity, qubitCount: parsed.qubitCount, steps: parsed.steps, customGates: [] }, note: copy.circuitRestored };
    }
    return { seed: { key, ...EMPTY_SEED, artifactIdentity }, note: hasOwnCode ? copy.circuitNotRebuildable : null };
  }

  function applyArtifact(next: LibraryArtifact | null) {
    setArtifactHydration("ready");
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
    if (!next) {
      seedCounter.current += 1;
      setBuilderSeed({ key: `draft-${seedCounter.current}`, ...EMPTY_SEED });
      setMessage(null);
      return;
    }
    const { seed, note } = seedForArtifact(next, nextDrafts, nextFramework);
    setBuilderSeed(seed);
    setMessage(note);
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
      <div className={`mj-studio-workspace${showEditor ? ` mj-studio-workspace--editor${inspectorOpen ? "" : " mj-studio-workspace--editor-solo"}` : " mj-studio-workspace--discovery"}`}>
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
                  <button
                    className={`mj-secondary-button mj-studio-inspector-toggle${inspectorOpen ? " is-open" : ""}`}
                    type="button"
                    aria-pressed={inspectorOpen}
                    aria-label={inspectorOpen ? copy.hideInspector : copy.showInspector}
                    title={inspectorOpen ? copy.hideInspector : copy.showInspector}
                    onClick={() => setInspectorOpen((value) => !value)}
                  >
                    <PanelRightIcon size={15} open={inspectorOpen} />
                  </button>
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

              {artifactId && !newDraft && artifactHydration !== "ready" ? (
                <div className="mj-studio-empty" role={artifactHydration === "error" ? "alert" : "status"}>
                  {artifactHydration === "loading" ? copy.loadingArtifacts : copy.selectedUnavailable}
                </div>
              ) : (
                <>
                  <CircuitBuilder
                    key={builderSeed.key}
                    seed={builderSeed}
                    framework={framework}
                    selectedGate={selectedGate}
                    onSelectGate={setSelectedGate}
                    hidden={panel !== "canvas"}
                    copy={copy}
                    onCircuitChange={(circuit) => {
                      if (!artifact) return;
                      const persisted = saveStoredCircuit(artifact.id, { artifactIdentity: studioArtifactIdentity(artifact), ...circuit });
                      if (!persisted) setMessage(copy.persistenceUnavailable);
                    }}
                    onApply={(codes) => {
                      setDrafts(codes);
                      setCode(codes[framework]);
                      setMessage(copy.appliedToCode);
                    }}
                  />
                  {panel === "code" ? <CodeEditor code={code} framework={framework} onChange={setCode} onCopy={() => void copyCode()} copied={copied} copy={copy} /> : null}
                  {panel === "versions" ? <VersionPanel artifact={artifact} runId={runId} copy={copy} /> : null}
                </>
              )}

              <footer className="mj-studio-footer" aria-live="polite">
                {artifactSyncError ? <span role="alert">{copy.remoteSyncUnavailable}</span> : null}
                <span>{message ?? copy.footer}</span>
                {runId ? <a href={`/run/${runId}`}>{copy.openRun} →</a> : null}
              </footer>
            </section>

            <aside className="mj-studio-inspector" aria-label={copy.inspector} hidden={!inspectorOpen}>
              <div className="mj-studio-inspector-head">
                <span className="mj-section-label">{copy.inspector}</span>
                <span className="mj-mono-muted">{copy.liveDraft}</span>
                <button className="mj-studio-inspector-close" type="button" aria-label={copy.hideInspector} title={copy.hideInspector} onClick={() => setInspectorOpen(false)}>×</button>
              </div>
              <label className="mj-studio-field">
                <span>{locale === "ja" ? "フレームワーク" : "Framework"}</span>
                <select value={framework} onChange={(event) => changeFramework(event.target.value as ComposerFramework)}>
                  {FRAMEWORK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
              <div className="mj-studio-inspector-card">
                <span className="mj-section-label">{copy.selectedGate}</span>
                <strong>{selectedGate.startsWith("custom:") ? copy.customGateLabel : selectedGate}</strong>
                <p>{selectedGate.startsWith("custom:") ? copy.customGateInspector : copy.gateDescriptions[selectedGate] ?? copy.gateDescriptions.H}</p>
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
              </div>
              <button className="mj-primary-button" type="button" onClick={() => applyArtifact(null)}>{copy.new}</button>
            </div>
            <label className="mj-studio-search mj-studio-search--perch">
              <SearchIcon size={17} />
              <span className="sr-only">{copy.search}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
              <StudioPerch />
            </label>
            {artifactSyncError ? <p className="mj-studio-empty" role="alert">{copy.remoteSyncUnavailable}</p> : null}
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

/**
 * Decorative constellation companion perched on the discovery search bar: the
 * Leo sickle settles onto the top edge on mount, its tail drooping over the
 * rim, and hovering the bar makes it paw toward the search icon. Pure CSS
 * motion (globals.css) that collapses under prefers-reduced-motion.
 */
function StudioPerch() {
  return (
    <span className="mj-studio-perch" aria-hidden="true">
      <svg viewBox="0 0 30 24" width={30} height={24} fill="none">
        <path className="mj-perch-line" d="M7 11 9.5 14l1-6.2 4.2-1.1" />
        <path className="mj-perch-tail" d="M9.5 14c3.8 0.6 6.6 0.4 8.6 3s3.6 3.2 5.6 2.3" />
        <path className="mj-perch-paw" d="M7.6 13.6c-0.9 1.9-1 3.1-2.2 4.4" />
        <circle className="mj-perch-dot" cx="7" cy="11" r="1" />
        <circle className="mj-perch-dot" cx="10.5" cy="7.8" r="1" />
        <circle className="mj-perch-dot" cx="14.7" cy="6.7" r="1" />
        <circle className="mj-perch-dot mj-perch-dot--bright" cx="9.5" cy="14" r="1.7" />
      </svg>
    </span>
  );
}

const ANGLE_OPTIONS = ["pi/8", "pi/4", "pi/2", "pi", "3*pi/2", "2*pi"];

function CircuitBuilder({ seed, framework, selectedGate, onSelectGate, onApply, onCircuitChange, hidden, copy }: { seed: BuilderSeed; framework: ComposerFramework; selectedGate: string; onSelectGate: (gate: string) => void; onApply: (codes: Record<ComposerFramework, string>) => void; onCircuitChange?: (circuit: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }) => void; hidden: boolean; copy: StudioCopy }) {
  const [qubitCount, setQubitCount] = useState(seed.qubitCount);
  const [steps, setSteps] = useState<BuilderStep[]>(seed.steps);
  const [pendingQubits, setPendingQubits] = useState<number[]>([]);
  const [angle, setAngle] = useState("pi/2");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [customGates, setCustomGates] = useState<CustomGateDefinition[]>(seed.customGates);
  const [showCustomGateForm, setShowCustomGateForm] = useState(false);
  const [customGateName, setCustomGateName] = useState("");
  const [builderMessage, setBuilderMessage] = useState<string | null>(null);

  const onCircuitChangeRef = useRef(onCircuitChange);
  onCircuitChangeRef.current = onCircuitChange;
  useEffect(() => {
    // The untouched seed is not re-persisted; only user edits are reported.
    // Reference equality is the signal: any edit replaces these arrays, while
    // StrictMode's double-invoked mount effect still sees the seed values.
    if (qubitCount === seed.qubitCount && steps === seed.steps && customGates === seed.customGates) return;
    onCircuitChangeRef.current?.({ qubitCount, steps, customGates });
  }, [qubitCount, steps, customGates, seed]);

  const armedCustomId = selectedGate.startsWith("custom:") ? selectedGate.slice("custom:".length) : null;
  const armedCustom = armedCustomId ? customGates.find((gate) => gate.id === armedCustomId) ?? null : null;
  const armed: BuilderGate = (BUILDER_GATES as string[]).includes(selectedGate) ? selectedGate as BuilderGate : armedCustom ? "CUSTOM" : "H";
  const requiredQubits = armedCustom?.qubitCount ?? (TWO_QUBIT_GATES.includes(armed as (typeof TWO_QUBIT_GATES)[number]) ? 2 : 1);
  const selectedLabel = armed === "CUSTOM" ? armedCustom?.name ?? "Custom gate" : armed;

  function placeOnQubit(qubit: number) {
    if (requiredQubits > 1) {
      if (pendingQubits.includes(qubit)) {
        setPendingQubits((current) => current.filter((item) => item !== qubit));
        return;
      }
      const nextQubits = [...pendingQubits, qubit];
      if (nextQubits.length < requiredQubits) {
        setPendingQubits(nextQubits);
        return;
      }
      const nextStep: BuilderStep = armed === "CUSTOM" && armedCustom
        ? { id: createBuilderStepId(), gate: "CUSTOM", customGateId: armedCustom.id, qubits: nextQubits }
        : { id: createBuilderStepId(), gate: armed, qubits: nextQubits };
      setSteps((current) => [...current, nextStep]);
      setPendingQubits([]);
      return;
    }
    setSteps((current) => [...current, { id: createBuilderStepId(), gate: armed, qubits: [qubit], ...(ROTATION_GATES.includes(armed as (typeof ROTATION_GATES)[number]) ? { param: angle } : {}) }]);
    setBuilderMessage(null);
  }

  function changeQubitCount(delta: number) {
    const next = Math.min(6, Math.max(1, qubitCount + delta));
    if (next === qubitCount) return;
    setQubitCount(next);
    setPendingQubits((current) => current.filter((qubit) => qubit < next));
    if (next < qubitCount) setSteps((current) => current.filter((step) => step.qubits.every((q) => q < next)));
  }

  function selectStep(stepId: string, multi = false) {
    setSelectedStepIds((current) => {
      if (!multi) return [stepId];
      return current.includes(stepId) ? current.filter((id) => id !== stepId) : [...current, stepId];
    });
    setBuilderMessage(null);
  }

  function deleteSelected() {
    if (!selectedStepIds.length) return;
    const selected = new Set(selectedStepIds);
    setSteps((current) => current.filter((step) => !selected.has(step.id)));
    setSelectedStepIds([]);
    setBuilderMessage(null);
  }

  function deleteStep(stepId: string) {
    setSteps((current) => current.filter((step) => step.id !== stepId));
    setSelectedStepIds((current) => current.filter((id) => id !== stepId));
    setBuilderMessage(null);
  }

  function createCustomGate() {
    const selected = steps.filter((step) => selectedStepIds.includes(step.id));
    if (selected.length < 2 || selected.some((step) => step.gate === "CUSTOM" || step.gate === "M")) {
      setBuilderMessage(copy.customGateCannotGroup);
      return;
    }
    const name = customGateName.trim() || `Custom gate ${customGates.length + 1}`;
    const qubitOrder = Array.from(new Set(selected.flatMap((step) => step.qubits)));
    const definition: CustomGateDefinition = {
      id: createBuilderStepId("custom"),
      name,
      qubitCount: qubitOrder.length,
      steps: selected.map((step) => ({
        ...step,
        id: createBuilderStepId("definition"),
        qubits: step.qubits.map((qubit) => qubitOrder.indexOf(qubit)),
      })),
    };
    const groupedStep: BuilderStep = {
      id: createBuilderStepId(),
      gate: "CUSTOM",
      customGateId: definition.id,
      qubits: qubitOrder,
    };
    const selectedIds = new Set(selectedStepIds);
    let inserted = false;
    const nextSteps = steps.flatMap((step) => {
      if (!selectedIds.has(step.id)) return [step];
      if (inserted) return [];
      inserted = true;
      return [groupedStep];
    });
    setCustomGates((current) => [...current, definition]);
    setSteps(nextSteps);
    setSelectedStepIds([groupedStep.id]);
    setShowCustomGateForm(false);
    setCustomGateName("");
    setPendingQubits([]);
    onSelectGate(`custom:${definition.id}`);
    setBuilderMessage(copy.customGateCreated(name));
  }

  function removeCustomGate(id: string) {
    setCustomGates((current) => current.filter((gate) => gate.id !== id));
    setSteps((current) => current.filter((step) => step.customGateId !== id));
    setSelectedStepIds((current) => current.filter((stepId) => steps.some((step) => step.id === stepId && step.customGateId !== id)));
    if (selectedGate === `custom:${id}`) onSelectGate("H");
    setPendingQubits([]);
  }

  function handleStepKeyDown(stepId: string, event: KeyboardEvent<SVGGElement>) {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      deleteStep(stepId);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectStep(stepId);
    }
  }

  const columnWidth = 52;
  const leftPad = 74;
  const topPad = 34;
  const rowHeight = 52;
  const width = Math.max(560, leftPad + (steps.length + 2) * columnWidth + 40);
  const height = topPad + qubitCount * rowHeight + 10;

  return (
    <section className="mj-studio-surface mj-studio-canvas" aria-label={copy.canvasLabel} hidden={hidden}>
      <div className="mj-studio-surface-head">
        <div><span className="mj-section-label">{copy.canvasLabel}</span><h2>{copy.generatedPreview}</h2></div>
        <span className="mj-mono-muted">{frameworkLabel(framework)} · {qubitCount}q · {steps.length} ops</span>
      </div>

      <div className="mj-builder-palette" role="toolbar" aria-label={copy.palette}>
        {BUILDER_GATES.map((gate) => (
          <button key={gate} type="button" className={`mj-builder-gate${armed === gate ? " is-active" : ""}`} aria-pressed={armed === gate} onClick={() => { onSelectGate(gate); setPendingQubits([]); setBuilderMessage(null); }}>
            {gate}
          </button>
        ))}
        {ROTATION_GATES.includes(armed as (typeof ROTATION_GATES)[number]) ? (
          <label className="mj-builder-angle">
            <span>{copy.angleLabel}</span>
            <select value={angle} onChange={(event) => setAngle(event.target.value)}>
              {ANGLE_OPTIONS.map((option) => <option key={option} value={option}>{option.replace("pi", "π").replace("*", "")}</option>)}
            </select>
          </label>
        ) : null}
      </div>

      {customGates.length ? (
        <div className="mj-builder-custom-gates" aria-label={copy.customGates}>
          <span className="mj-section-label">{copy.customGates}</span>
          {customGates.map((gate) => {
            const active = selectedGate === `custom:${gate.id}`;
            return (
              <div className="mj-builder-custom-gate" key={gate.id}>
                <button className={`mj-builder-gate${active ? " is-active" : ""}`} type="button" aria-pressed={active} onClick={() => { onSelectGate(`custom:${gate.id}`); setPendingQubits([]); setBuilderMessage(null); }}>
                  {gate.name}<small>{gate.qubitCount}q</small>
                </button>
                <button className="mj-builder-custom-remove" type="button" aria-label={copy.deleteCustomGate(gate.name)} title={copy.deleteCustomGate(gate.name)} onClick={() => removeCustomGate(gate.id)}>×</button>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="mj-circuit-stage">
        <svg className="mj-circuit-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={copy.circuitAria(frameworkLabel(framework))} style={{ maxWidth: "100%" }}>
          {Array.from({ length: qubitCount }, (_, q) => {
            const y = topPad + q * rowHeight;
            return (
              <g key={q}>
                <text className="mj-circuit-label" x="18" y={y + 5}>q{q}</text>
                <line className="mj-circuit-wire" x1={leftPad - 16} y1={y} x2={width - 24} y2={y} />
                <g
                  className={`mj-circuit-gate mj-builder-slot${pendingQubits.includes(q) ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`q${q}: ${selectedLabel}`}
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
            const selected = selectedStepIds.includes(step.id);
            const label = builderStepLabel(step, customGates);
            const selectProps = {
              role: "button" as const,
              tabIndex: 0,
              "aria-label": `${label} on ${step.qubits.map((qubit) => `q${qubit}`).join(", ")}`,
              onClick: (event: MouseEvent<SVGGElement>) => selectStep(step.id, event.shiftKey),
              onKeyDown: (event: KeyboardEvent<SVGGElement>) => handleStepKeyDown(step.id, event),
            };
            if (step.gate === "CUSTOM") {
              const custom = customGates.find((gate) => gate.id === step.customGateId);
              const minQubit = Math.min(...step.qubits);
              const maxQubit = Math.max(...step.qubits);
              return (
                <g className={`mj-circuit-gate mj-circuit-custom-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
                  <title>{label}</title>
                  <line className="mj-circuit-control" x1={x} y1={yFor(minQubit)} x2={x} y2={yFor(maxQubit)} />
                  {step.qubits.map((qubit, qubitIndex) => (
                    <g key={`${step.id}-${qubit}`}>
                      <rect x={x - 17} y={yFor(qubit) - 17} width="34" height="34" rx="7" />
                      <text x={x} y={yFor(qubit) + 5}>{qubitIndex === 0 ? (custom?.name ?? "CG").slice(0, 5) : "·"}</text>
                    </g>
                  ))}
                </g>
              );
            }
            if (step.gate === "CX" || step.gate === "CZ" || step.gate === "SWAP") {
              const [control, target] = step.qubits;
              return (
                <g className={`mj-circuit-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
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
              <g className={`mj-circuit-gate${selected ? " is-selected" : ""}`} key={step.id} {...selectProps}>
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
        <button className="mj-secondary-button" type="button" onClick={() => { const removed = steps[steps.length - 1]; setSteps((current) => current.slice(0, -1)); if (removed) setSelectedStepIds((current) => current.filter((id) => id !== removed.id)); setPendingQubits([]); }} disabled={!steps.length}>{copy.undo}</button>
        <button className="mj-secondary-button" type="button" onClick={() => { setSteps([]); setSelectedStepIds([]); setPendingQubits([]); setBuilderMessage(null); }} disabled={!steps.length}>{copy.clearAll}</button>
        <button className="mj-secondary-button" type="button" onClick={deleteSelected} disabled={!selectedStepIds.length}>{copy.deleteSelected}</button>
        {selectedStepIds.length >= 2 ? <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(true)}>{copy.groupSelected}</button> : null}
        <button className="mj-primary-button" type="button" onClick={() => onApply(generateBuilderCode(steps, qubitCount, customGates))} disabled={!steps.length}>{copy.applyToCode}</button>
      </div>

      {showCustomGateForm ? (
        <form className="mj-builder-custom-form" onSubmit={(event) => { event.preventDefault(); createCustomGate(); }}>
          <label>
            <span>{copy.customGates}</span>
            <input autoFocus value={customGateName} onChange={(event) => setCustomGateName(event.target.value)} placeholder={copy.customGatePlaceholder} />
          </label>
          <button className="mj-primary-button" type="submit">{copy.createCustomGate}</button>
          <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(false)}>{copy.cancelCustomGate}</button>
        </form>
      ) : null}

      <div className="mj-studio-canvas-footer" aria-live="polite">
        <span>{builderMessage ?? (pendingQubits.length ? copy.pickTarget : selectedStepIds.length ? copy.selectedCount(selectedStepIds.length) : steps.length ? copy.builderHint : copy.builderEmpty)}</span>
        <span className="mj-mono-muted">{steps.length ? steps.map((step) => builderStepLabel(step, customGates)).join(" → ") : "—"}</span>
      </div>
    </section>
  );
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
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as Record<string, unknown>;
  const artifact = toLibraryArtifact(payload)[0];
  if (!artifact) return null;
  if (typeof payload.current_version_id === "string") {
    const versionResponse = await fetch(`/api/artifacts/${encodeURIComponent(id)}/versions/current`, { cache: "no-store" });
    if (!versionResponse.ok) return null;
    const version = (await versionResponse.json()) as Record<string, unknown>;
    artifact.code = typeof version.code === "string" ? version.code : artifact.code;
    artifact.frameworkVariants = frameworkVariantsFromRemote(version.framework_variants) ?? artifact.frameworkVariants;
    artifact.qasm = typeof version.qasm === "string" ? version.qasm : artifact.qasm;
    artifact.currentVersionId = payload.current_version_id;
    artifact.resourceRows = resourceRowsFromRemote(version.resource_estimates);
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

function studioArtifactIdentity(artifact: LibraryArtifact): string {
  if (artifact.currentVersionId) return `version:${artifact.currentVersionId}`;
  let hash = 2166136261;
  for (const character of `${artifact.framework}\u0000${artifact.code}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `source:${(hash >>> 0).toString(16)}`;
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
