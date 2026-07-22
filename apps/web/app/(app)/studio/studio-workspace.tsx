"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type UIEvent } from "react";
import { SyntaxHighlightedCode } from "@majorana/ui";
import { CheckIcon, CopyIcon, PanelRightIcon, SearchIcon } from "../../../components/icons";
import { artifactFromResource, frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, type LibraryArtifact, type VerificationCheck } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { BUILDER_GATES, builderStepLabel, createBuilderStepId, generateBuilderCode, ROTATION_GATES, TWO_QUBIT_GATES, type BuilderCodeVariants, type BuilderGate, type BuilderStep, type CustomGateDefinition } from "../../../lib/studio-builder";
import { loadStoredCircuit, saveStoredCircuit } from "../../../lib/studio-circuits";
import { allCircuitConversionResults, parseCircuitSource, looksLikeOpenQasm3 } from "../../../lib/circuit-conversion";
import { CIRCUIT_FRAMEWORKS, circuitFramework, circuitFrameworkOrNull, isExecutableCircuitFramework, type CircuitFrameworkKey } from "../../../lib/circuit-frameworks";
import { MAX_CPU_SEED, MAX_CPU_SHOTS, cpuSimulationEligibility, loadCpuSimulationRecords, runCpuSimulation, saveCpuSimulationRecord, type CpuSimulationEligibility, type CpuSimulationRecord } from "../../../lib/studio-simulation";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { sampling } from "../../../lib/studio-run-request";
import { verificationFromMetadata } from "../../../lib/verification-record";

type StudioPanel = "canvas" | "code" | "simulation" | "versions";
type StudioAction = "simulation" | "save";

type BuilderSeed = {
  key: string;
  artifactIdentity: string | null;
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
};

type ArtifactHydration = "loading" | "ready" | "error";

const EMPTY_SEED: Omit<BuilderSeed, "key"> = { artifactIdentity: null, qubitCount: 2, steps: [], customGates: [] };

type StudioFramework = CircuitFrameworkKey;

type DraftBundle = {
  codes: BuilderCodeVariants;
  notes: Partial<Record<StudioFramework, string>>;
};

const FRAMEWORK_OPTIONS = CIRCUIT_FRAMEWORKS.map(({ key: value, label, executable }) => ({
  value,
  label: executable ? label : `${label} · export`,
}));

const STARTER_CODES: BuilderCodeVariants = generateBuilderCode([
  { id: "starter-h", gate: "H", qubits: [0] },
  { id: "starter-cx", gate: "CX", qubits: [0, 1] },
  { id: "starter-m0", gate: "M", qubits: [0] },
  { id: "starter-m1", gate: "M", qubits: [1] },
], 2);

export function StudioWorkspace({ artifactId, newDraft = false, locale = "en" }: { artifactId?: string; newDraft?: boolean; locale?: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].studio;
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [showEditor, setShowEditor] = useState(Boolean(artifactId || newDraft));
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("Untitled circuit");
  const [framework, setFramework] = useState<StudioFramework>("qiskit");
  const [drafts, setDrafts] = useState<BuilderCodeVariants>(() => makeDraftBundle(null).codes);
  const [draftNotes, setDraftNotes] = useState<Partial<Record<StudioFramework, string>>>(() => makeDraftBundle(null).notes);
  const [code, setCode] = useState(STARTER_CODES.qiskit);
  const [panel, setPanel] = useState<StudioPanel>("canvas");
  const [selectedGate, setSelectedGate] = useState("H");
  const [busy, setBusy] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [simulationRecords, setSimulationRecords] = useState<CpuSimulationRecord[]>([]);
  const [rerunPending, setRerunPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  // Strings, not numbers: an empty seed field means "let the planner choose" and
  // a number state would have to encode that as 0, which is a valid seed.
  const [shots, setShots] = useState("4096");
  const [seed, setSeed] = useState("");
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
        const remote = payload.flatMap((value) => artifactFromResource(value));
        const byId = new Map([...loadLibraryArtifacts(), ...remote].map((item) => [item.id, item]));
        setArtifacts([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => {
        if (active) setArtifactSyncError(true);
      });

    if (artifactId) {
      const local = getLibraryArtifact(artifactId);
      // Render the local cache immediately, but always hydrate the canonical
      // version as well. The cache intentionally holds only a light artifact
      // summary, while the current version supplies provenance such as stored
      // OpenQASM that CPU simulation needs for its bounded fallback model.
      if (local) applyArtifact(local);
      void loadArtifact(artifactId)
        .then((loaded) => {
          if (!active) return;
          if (loaded) applyArtifact(loaded);
          else if (!local) {
            setArtifactHydration("error");
            setMessage(copy.selectedUnavailable);
          }
        })
        .catch(() => {
          // A cached artifact remains usable if the network is temporarily
          // unavailable; only fail the selection when there is no local copy.
          if (active && !local) {
            setArtifactHydration("error");
            setMessage(copy.selectedUnavailable);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [artifactId, copy]);

  useEffect(() => {
    setSimulationRecords(artifact ? loadCpuSimulationRecords(artifact.id) : []);
    setRerunPending(false);
  }, [artifact?.id]);

  useEffect(() => {
    setRerunPending(false);
  }, [code, framework]);

  const cpuEligibility = useMemo(() => cpuSimulationEligibility({
    artifactId: artifact?.id ?? "",
    code,
    framework,
    qasm: artifact?.code === code ? artifact.qasm : null,
  }), [artifact?.id, artifact?.code, artifact?.qasm, code, framework]);

  function seedForArtifact(next: LibraryArtifact, activeDrafts: BuilderCodeVariants, activeFramework: StudioFramework): { seed: BuilderSeed; note: string | null } {
    seedCounter.current += 1;
    const key = `${next.id}:${seedCounter.current}`;
    const stored = loadStoredCircuit(next.id);
    const artifactIdentity = studioArtifactIdentity(next);
    if (stored?.artifactIdentity === artifactIdentity) {
      return { seed: { key, artifactIdentity, qubitCount: stored.qubitCount, steps: stored.steps, customGates: stored.customGates }, note: copy.circuitRestored };
    }
    const hasOwnCode = Boolean(next.code || next.frameworkVariants || next.qasm);
    const candidates = [
      { framework: activeFramework, code: activeDrafts[activeFramework] },
      ...Object.entries(next.frameworkVariants ?? {}).flatMap(([name, code]) => {
        const framework = normalizeFramework(name);
        return framework ? [{ framework, code }] : [];
      }),
      ...(next.qasm ? [{ framework: "openqasm3" as const, code: next.qasm }] : []),
    ];
    const parsed = hasOwnCode
      ? candidates.map((candidate) => parseCircuitSource(candidate.code, candidate.framework)).find(Boolean) ?? null
      : null;
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
    const nextBundle = makeDraftBundle(next);
    const nextDrafts = nextBundle.codes;
    const nextFramework = normalizeFramework(next?.framework)
      ?? CIRCUIT_FRAMEWORKS.find(({ key }) => Boolean(nextDrafts[key]))?.key
      ?? "qiskit";
    setDrafts(nextDrafts);
    setDraftNotes(nextBundle.notes);
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

  function changeFramework(next: StudioFramework) {
    if (next === framework) return;
    const nextDrafts = { ...drafts, [framework]: code };
    setDrafts(nextDrafts);
    setFramework(next);
    setCode(nextDrafts[next]);
    const conversionNote = draftNotes[next];
    setMessage(
      !nextDrafts[next]
        ? locale === "ja"
          ? `${frameworkLabel(next)} へ変換できる移植可能な回路またはOpenQASM 3が保存されていません。`
          : `No portable circuit or stored OpenQASM 3 is available for a ${frameworkLabel(next)} conversion.`
        : conversionNote
          ? conversionNote
          : isExecutableCircuitFramework(next)
        ? copy.editingDraft(frameworkLabel(next))
        : locale === "ja"
          ? `${frameworkLabel(next)} のエクスポートを編集中です。実行と検証は Qiskit、PennyLane、Cirq で利用できます。`
          : `Editing the ${frameworkLabel(next)} export. Run and verification remain available in Qiskit, PennyLane, and Cirq.`,
    );
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

  function openSimulation() {
    setPanel("simulation");
    setMessage(null);
  }

  function startCpuSimulation(confirmRerun = false) {
    if (!artifact) {
      setPanel("simulation");
      setMessage(copy.simulationArtifactRequired);
      return;
    }
    if (!cpuEligibility.eligible) {
      setPanel("simulation");
      setMessage(copy.cpuUnavailable(cpuEligibility.reason));
      return;
    }
    const parsedShots = Number(shots.trim());
    if (!Number.isInteger(parsedShots) || parsedShots < 1 || parsedShots > MAX_CPU_SHOTS) {
      setMessage(copy.cpuInvalidShots(MAX_CPU_SHOTS));
      return;
    }
    const parsedSeed = seed.trim() === "" ? undefined : Number(seed.trim());
    if (parsedSeed !== undefined && (!Number.isInteger(parsedSeed) || parsedSeed < 0 || parsedSeed > MAX_CPU_SEED)) {
      setMessage(copy.cpuInvalidSeed(MAX_CPU_SEED));
      return;
    }
    const priorMatch = simulationRecords.some((record) => (
      record.sourceFingerprint === cpuEligibility.sourceFingerprint
      && record.interchangeFingerprint === cpuEligibility.interchangeFingerprint
      && record.framework === framework
    ));
    if (priorMatch && !confirmRerun) {
      setRerunPending(true);
      return;
    }

    setBusy("simulation");
    try {
      const record = runCpuSimulation({
        artifactId: artifact.id,
        artifactVersionId: artifact.currentVersionId,
        code,
        framework,
        qasm: artifact.code === code ? artifact.qasm : null,
        shots: parsedShots,
        seed: parsedSeed,
      });
      if (!saveCpuSimulationRecord(record)) {
        setMessage(copy.simulationPersistenceUnavailable);
        return;
      }
      setSimulationRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setRerunPending(false);
      setMessage(copy.cpuSimulationRecorded);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.simulationFailed);
    } finally {
      setBusy(null);
    }
  }

  async function startRun() {
    if (!code.trim() || busy || !isExecutableCircuitFramework(framework)) return;
    setBusy("save");
    setMessage(null);
    setRunId(null);
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: `Please verify and save a new version of the edited quantum circuit “${title}” in ${frameworkLabel(framework)}. Preserve the supplied source code, report the evidence clearly, and do not silently change frameworks.`,
          mode: "execute",
          framework,
          source_code: code,
          ...sampling(shots, seed),
          ...(artifact?.currentVersionId ? { artifact_version_id: artifact.currentVersionId } : {}),
        }),
      });
      const payload = (await response.json()) as { id?: string; detail?: string; error?: string };
      if (!response.ok || !payload.id) {
        throw new Error(payload.detail ?? payload.error ?? `Run submission failed (${response.status})`);
      }
      setRunId(payload.id);
      setMessage(copy.verificationStarted);
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
                  <button className="mj-secondary-button" type="button" disabled={!code.trim()} onClick={openSimulation}>{copy.simulate}</button>
                  <button className="mj-primary-button" type="button" disabled={!code.trim() || busy !== null || !isExecutableCircuitFramework(framework)} onClick={() => void startRun()}>{busy === "save" ? copy.starting : copy.verifySave}</button>
                </div>
              </div>

              <nav className="mj-studio-tabs" aria-label={copy.view}>
                {(["canvas", "code", "simulation", "versions"] as StudioPanel[]).map((item) => (
                  <button className={panel === item ? "is-active" : ""} type="button" key={item} onClick={() => setPanel(item)}>
                    {item === "canvas" ? copy.circuit : item === "code" ? copy.code : item === "simulation" ? copy.simulation : copy.versions}
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
                      setDraftNotes({});
                      setCode(codes[framework]);
                      setMessage(copy.appliedToCode);
                    }}
                  />
                  {panel === "code" ? <CodeEditor code={code} framework={framework} onChange={setCode} onCopy={() => void copyCode()} copied={copied} copy={copy} /> : null}
                  {panel === "simulation" ? (
                    <SimulationPanel
                      artifact={artifact}
                      eligibility={cpuEligibility}
                      records={simulationRecords}
                      rerunPending={rerunPending}
                      busy={busy === "simulation"}
                      onRun={() => startCpuSimulation()}
                      onConfirmRerun={() => startCpuSimulation(true)}
                      onCancelRerun={() => setRerunPending(false)}
                      copy={copy}
                    />
                  ) : null}
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
                <select value={framework} onChange={(event) => changeFramework(event.target.value as StudioFramework)}>
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
                {/* These inputs apply to the bounded CPU lane and are also passed
                    through unchanged when the user explicitly starts Verify & save. */}
                <div className="mj-studio-sampling">
                  <label htmlFor="studio-shots">{copy.shots}</label>
                  <input
                    id="studio-shots"
                    type="number"
                    min={1}
                    max={MAX_CPU_SHOTS}
                    step={256}
                    value={shots}
                    onChange={(event) => setShots(event.target.value)}
                    inputMode="numeric"
                  />
                  <label htmlFor="studio-seed">{copy.seed}</label>
                  <input
                    id="studio-seed"
                    type="number"
                    min={0}
                    max={MAX_CPU_SEED}
                    value={seed}
                    placeholder={copy.seedAuto}
                    onChange={(event) => setSeed(event.target.value)}
                    inputMode="numeric"
                  />
                </div>
                <p className="mj-studio-sampling-note">{copy.samplingNote}</p>
              </div>
              <div className="mj-studio-inspector-card">
                <span className="mj-section-label">{copy.cpuLane}</span>
                <p>{cpuEligibility.eligible ? copy.cpuEligible : copy.cpuUnavailable(cpuEligibility.reason)}</p>
                <button className="mj-secondary-button" type="button" onClick={openSimulation}>{copy.openSimulation}</button>
              </div>
              <div className="mj-studio-framework-note">
                <CheckIcon size={14} />
                <span>{isExecutableCircuitFramework(framework)
                  ? copy.frameworkNote
                  : locale === "ja"
                    ? "この形式はコピーとエクスポート用です。Leona Quantum のサンドボックス実行は Qiskit、PennyLane、Cirq に限定されています。"
                    : "This format is available for copy and export. Leona Quantum sandbox execution is limited to Qiskit, PennyLane, and Cirq."}</span>
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
            <label className="mj-studio-search mj-studio-search--dots">
              <SearchIcon size={17} />
              <span className="sr-only">{copy.search}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
              <StudioDots />
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
 * Decorative studio companion (Owner Inbox 2026-07-19, replacing the walking
 * cat): a thin strip of superposition "dots" drifting along the top edge of the
 * discovery search bar. They periodically COLLAPSE toward a random point and
 * disperse again — a measurement motif — and while the bar is hovered/focused
 * they converge toward the pointer instead, so it stays interactive. Canvas so
 * many points stay cheap; reads --accent / --text-0 at runtime to theme with
 * light/dark, and holds a single static frame under prefers-reduced-motion.
 */
function StudioDots() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const host = canvas.closest<HTMLElement>(".mj-studio-search--dots") ?? canvas.parentElement;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const N = 30;
    const dots = Array.from({ length: N }, (_, i) => ({
      bx: (i + 0.5) / N,
      by: 0.28 + Math.random() * 0.44,
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 0.7,
      amp: 0.05 + Math.random() * 0.06,
      r: 0.8 + Math.random() * 1.3,
      bright: Math.random() < 0.16,
    }));

    // Collapse cycle: drift, then converge to a random x, hold, disperse.
    let collapseX = 0.5;
    let cycleStart = 0;
    const CYCLE = 480; // frames (~8s at 60fps)

    let pointer: number | null = null;
    let hovering = false;
    const onMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer = rect.width ? (event.clientX - rect.left) / rect.width : null;
    };
    const onEnter = () => { hovering = true; };
    const onLeave = () => { hovering = false; pointer = null; };
    host?.addEventListener("pointermove", onMove);
    host?.addEventListener("pointerenter", onEnter);
    host?.addEventListener("pointerleave", onLeave);

    function colors() {
      const st = getComputedStyle(canvas!);
      return {
        accent: st.getPropertyValue("--accent").trim() || "olivedrab",
        bright: st.getPropertyValue("--text-0").trim() || "black",
      };
    }

    function resize() {
      const w = canvas!.clientWidth, h = canvas!.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.max(1, w * dpr);
      canvas!.height = Math.max(1, h * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    let frame = 0;
    let raf = 0;

    function draw() {
      const W = canvas!.clientWidth, H = canvas!.clientHeight;
      const { accent, bright } = colors();
      ctx!.clearRect(0, 0, W, H);

      // Collapse strength + target for this frame.
      let conv = 0;
      let targetX = collapseX;
      let targetY = 0.5;
      if (hovering && pointer != null) {
        conv = 0.85;
        targetX = pointer;
      } else if (!reduceMotion) {
        const p = (frame - cycleStart) / CYCLE;
        if (p >= 1) { cycleStart = frame; collapseX = 0.18 + Math.random() * 0.64; }
        // converge over first 25%, hold to 45%, disperse to 70%, drift after.
        const q = (frame - cycleStart) / CYCLE;
        if (q < 0.25) conv = ease(q / 0.25);
        else if (q < 0.45) conv = 1;
        else if (q < 0.7) conv = 1 - ease((q - 0.45) / 0.25);
        else conv = 0;
      } else {
        conv = 0.4;
      }

      const t = frame / 60;
      dots.forEach((d) => {
        const dx = reduceMotion ? d.bx : d.bx + Math.sin(t * d.speed + d.phase) * d.amp;
        const dy = reduceMotion ? d.by : d.by + Math.cos(t * d.speed * 0.8 + d.phase) * d.amp * 1.4;
        const x = (dx + (targetX - dx) * conv) * W;
        const y = (dy + (targetY - dy) * conv) * H;
        if (conv > 0.15 && !reduceMotion) {
          ctx!.globalAlpha = 0.12 * conv;
          ctx!.strokeStyle = accent;
          ctx!.beginPath();
          ctx!.moveTo(targetX * W, targetY * H);
          ctx!.lineTo(x, y);
          ctx!.stroke();
        }
        ctx!.globalAlpha = 0.45 + 0.5 * conv;
        ctx!.fillStyle = d.bright ? bright : accent;
        ctx!.beginPath();
        ctx!.arc(x, y, d.r + (d.bright ? 0.8 : 0), 0, Math.PI * 2);
        ctx!.fill();
      });
      ctx!.globalAlpha = 1;
    }

    function tick() { frame += 1; draw(); raf = window.requestAnimationFrame(tick); }

    resize();
    draw();
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(canvas);
    if (!reduceMotion) raf = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      host?.removeEventListener("pointermove", onMove);
      host?.removeEventListener("pointerenter", onEnter);
      host?.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return (
    <span className="mj-studio-dots" aria-hidden="true">
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
    </span>
  );
}

const ANGLE_OPTIONS = ["pi/8", "pi/4", "pi/2", "pi", "3*pi/2", "2*pi"];

function CircuitBuilder({ seed, framework, selectedGate, onSelectGate, onApply, onCircuitChange, hidden, copy }: { seed: BuilderSeed; framework: StudioFramework; selectedGate: string; onSelectGate: (gate: string) => void; onApply: (codes: BuilderCodeVariants) => void; onCircuitChange?: (circuit: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }) => void; hidden: boolean; copy: StudioCopy }) {
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

function CodeEditor({ code, framework, onChange, onCopy, copied, copy }: { code: string; framework: StudioFramework; onChange: (code: string) => void; onCopy: () => void; copied: boolean; copy: StudioCopy }) {
  // Colored editor (Owner Inbox 2026-07-19, "all code should be colored well"):
  // a syntax-highlighted <pre> sits directly behind a transparent-text
  // <textarea> that shares its exact typography and padding, so the caret and
  // selection stay real while the visible glyphs are the colored tokens. A
  // trailing newline keeps the highlight height in step with the textarea, and
  // onScroll keeps the two layers aligned.
  const highlightRef = useRef<HTMLPreElement>(null);
  const syncScroll = (event: UIEvent<HTMLTextAreaElement>) => {
    const el = event.currentTarget;
    if (highlightRef.current) {
      highlightRef.current.scrollTop = el.scrollTop;
      highlightRef.current.scrollLeft = el.scrollLeft;
    }
  };
  return (
    <section className="mj-studio-surface mj-studio-code-panel" aria-label={copy.sourceEditor}>
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">{copy.sourceEditor}</span><h2>{copy.implementation(frameworkLabel(framework))}</h2></div><button className="mj-secondary-button" type="button" onClick={onCopy} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button></div>
      <div className="mj-studio-code-editor-wrap">
        <pre className="mj-studio-code-highlight" aria-hidden="true" ref={highlightRef}>
          <SyntaxHighlightedCode code={code + "\n"} language={framework} />
        </pre>
        <textarea className="mj-studio-code-editor" value={code} onChange={(event) => onChange(event.target.value)} onScroll={syncScroll} spellCheck={false} aria-label={`${frameworkLabel(framework)} ${copy.sourceEditorInput}`} />
      </div>
      <p className="mj-studio-editor-note">{copy.editorNote}</p>
    </section>
  );
}

/** The evidence the saved version actually carries.
 *
 * `LibraryArtifact` has carried `checks` and `criticSummary` since the Vault
 * detail page started rendering them, and this panel showed neither — a truncated
 * version id and, if a run had just been submitted, a link out. So the tab named
 * "Versions" in the surface whose whole job is producing verified artifacts was
 * the one place in the product that could not tell you what was verified.
 *
 * `checks` is populated when a version has been opened in the Vault; absent is
 * "not loaded here", not "nothing was checked", and the copy says so rather than
 * implying an empty list means an empty panel.
 */
function SimulationPanel({
  artifact,
  eligibility,
  records,
  rerunPending,
  busy,
  onRun,
  onConfirmRerun,
  onCancelRerun,
  copy,
}: {
  artifact: LibraryArtifact | null;
  eligibility: CpuSimulationEligibility;
  records: CpuSimulationRecord[];
  rerunPending: boolean;
  busy: boolean;
  onRun: () => void;
  onConfirmRerun: () => void;
  onCancelRerun: () => void;
  copy: StudioCopy;
}) {
  const currentRecords = eligibility.eligible
    ? records.filter((record) => (
      record.sourceFingerprint === eligibility.sourceFingerprint
      && record.interchangeFingerprint === eligibility.interchangeFingerprint
    ))
    : [];
  return (
    <section className="mj-studio-surface mj-studio-simulation-panel" aria-label={copy.simulation}>
      <div className="mj-studio-surface-head">
        <div>
          <span className="mj-section-label">{copy.cpuLane}</span>
          <h2>{copy.simulation}</h2>
        </div>
        <span className="mj-mono-muted">{eligibility.eligible ? copy.cpuEligible : copy.cpuUnavailable(eligibility.reason)}</span>
      </div>
      <div className="mj-studio-simulation-body">
        <p className="mj-studio-simulation-boundary">{copy.simulationBoundary}</p>
        <dl className="mj-studio-contract">
          <div><dt>{copy.simulationArtifact}</dt><dd>{artifact?.title ?? copy.newDraftSource}</dd></div>
          <div><dt>{copy.sourceFingerprint}</dt><dd>{eligibility.sourceFingerprint}</dd></div>
          {eligibility.eligible && eligibility.interchangeFingerprint ? <div><dt>{copy.interchangeFingerprint}</dt><dd>{eligibility.interchangeFingerprint}</dd></div> : null}
          {eligibility.eligible ? <div><dt>{copy.simulationModel}</dt><dd>{simulationModelLabel(eligibility.model, copy)}</dd></div> : null}
          <div><dt>{copy.simulator}</dt><dd>{copy.browserCpu}</dd></div>
        </dl>

        {eligibility.eligible ? (
          rerunPending ? (
            <div className="mj-studio-simulation-confirm" role="status">
              <p>{copy.rerunPrompt}</p>
              <div>
                <button className="mj-primary-button" type="button" disabled={busy} onClick={onConfirmRerun}>{busy ? copy.starting : copy.confirmRerun}</button>
                <button className="mj-secondary-button" type="button" disabled={busy} onClick={onCancelRerun}>{copy.cancel}</button>
              </div>
            </div>
          ) : (
            <button className="mj-primary-button" type="button" disabled={busy} onClick={onRun}>
              {busy ? copy.starting : currentRecords.length ? copy.rerunCpuSimulation : copy.runCpuSimulation}
            </button>
          )
        ) : <p className="mj-studio-simulation-unavailable" role="alert">{copy.cpuUnavailable(eligibility.reason)}</p>}

        <section className="mj-studio-hardware-lanes" aria-label={copy.hardwareLanes}>
          <span className="mj-section-label">{copy.hardwareLanes}</span>
          <div><button className="mj-secondary-button" type="button" disabled title={copy.gpuUnavailable}>{copy.gpuSimulation}</button><p>{copy.gpuUnavailable}</p></div>
          <div><button className="mj-secondary-button" type="button" disabled title={copy.qpuUnavailable}>{copy.qpuExecution}</button><p>{copy.qpuUnavailable}</p></div>
        </section>

        <section className="mj-studio-simulation-records" aria-label={copy.simulationResults}>
          <div className="mj-studio-simulation-records-head"><span className="mj-section-label">{copy.simulationResults}</span><span className="mj-mono-muted">{records.length}</span></div>
          {records.length ? records.map((record) => <SimulationRecordCard record={record} copy={copy} key={record.id} />) : <p className="mj-studio-empty">{copy.simulationNoRecords}</p>}
        </section>
      </div>
    </section>
  );
}

function SimulationRecordCard({ record, copy }: { record: CpuSimulationRecord; copy: StudioCopy }) {
  const counts = Object.entries(record.counts).sort(([, left], [, right]) => right - left).slice(0, 8);
  return (
    <article className="mj-studio-simulation-record">
      <div className="mj-studio-simulation-record-head"><strong>{copy.simulationRecord}</strong><span className="mj-mono-muted">{record.createdAt}</span></div>
      <dl className="mj-studio-contract">
        <div><dt>{copy.simulator}</dt><dd>{copy.browserCpu}</dd></div>
        <div><dt>{copy.artifactVersion}</dt><dd>{record.artifactVersionId ? record.artifactVersionId.slice(0, 12) : copy.newDraftSource}</dd></div>
        <div><dt>{copy.sourceFingerprint}</dt><dd>{record.sourceFingerprint}</dd></div>
        {record.interchangeFingerprint ? <div><dt>{copy.interchangeFingerprint}</dt><dd>{record.interchangeFingerprint}</dd></div> : null}
        <div><dt>{copy.simulationModel}</dt><dd>{simulationModelLabel(record.model, copy)}</dd></div>
        <div><dt>{copy.shots}</dt><dd>{record.shots.toLocaleString("en-US")}</dd></div>
        <div><dt>{copy.seed}</dt><dd>{record.seed}</dd></div>
        <div><dt>{copy.operations}</dt><dd>{record.operationCount} · {record.qubitCount}q</dd></div>
      </dl>
      <div className="mj-studio-simulation-counts"><span className="mj-section-label">{copy.resultCounts}</span><code>{counts.map(([bitstring, count]) => `${bitstring}: ${count}`).join("\n")}</code></div>
    </article>
  );
}

function simulationModelLabel(model: CpuSimulationRecord["model"], copy: StudioCopy): string {
  return model === "direct_source" ? copy.directSourceModel : copy.standardDecompositionModel;
}

function VersionPanel({ artifact, runId, copy }: { artifact: LibraryArtifact | null; runId: string | null; copy: StudioCopy }) {
  const checks: VerificationCheck[] = artifact?.checks ?? [];
  return (
    <section className="mj-studio-surface mj-studio-version-panel" aria-label={copy.versionHistory}>
      <div className="mj-studio-surface-head"><div><span className="mj-section-label">{copy.versionHistory}</span><h2>{artifact ? artifact.title : copy.newDraftSource}</h2></div><span className="mj-mono-muted">{copy.repositoryView}</span></div>
      <div className="mj-studio-version-row"><span className="mj-studio-version-dot" /><div><strong>{artifact?.currentVersionId ? copy.currentVersion(artifact.currentVersionId.slice(0, 12)) : copy.draftNotSaved}</strong><p>{artifact ? copy.currentVersionNote : copy.draftVersionNote}</p></div></div>
      {artifact ? (
        <div className="mj-studio-version-evidence">
          <span className="mj-section-label">{copy.evidence}</span>
          <p className="mj-studio-evidence-grade">{studioEvidenceLabel(artifact.status, copy)}</p>
          {artifact.criticSummary ? <p className="mj-studio-evidence-summary">{artifact.criticSummary}</p> : null}
          {checks.length ? (
            <ul className="mj-verification-checks">
              {checks.map((check) => (
                <li key={check.method}>
                  <span className={`mj-verification-check mj-verification-check--${check.result === "pass" ? "pass" : "fail"}`} aria-hidden="true">{check.result === "pass" ? "✓" : "✕"}</span>
                  <code>{check.method}</code>
                  <span className="mj-mono-muted">{check.result}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mj-mono-muted">{copy.evidenceNotLoaded}</p>
          )}
          {artifact.id ? <p><a href={`/library/${encodeURIComponent(artifact.id)}`}>{copy.openFullRecord}</a></p> : null}
        </div>
      ) : null}
      {runId ? <div className="mj-studio-version-row"><span className="mj-studio-version-dot is-pending" /><div><strong>{copy.verificationQueued}</strong><p><a href={`/run/${runId}`}>{runId.slice(0, 12)}</a> · {copy.verificationAttach(runId.slice(0, 12))}</p></div></div> : null}
    </section>
  );
}

/** Never the bare word "Verified" for a structural pass — that conflation is what
 * the Vault list was fixed for, and Studio must not reintroduce it. */
function studioEvidenceLabel(status: LibraryArtifact["status"], copy: StudioCopy): string {
  if (status === "structural") return copy.evidenceStructural;
  if (status === "failed") return copy.evidenceFailed;
  if (status === "verified_caveats") return copy.evidenceCaveats;
  return copy.evidencePhysical;
}

async function loadArtifact(id: string): Promise<LibraryArtifact | null> {
  const response = await fetch(`/api/artifacts/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) return null;
  const payload = (await response.json()) as Record<string, unknown>;
  const artifact = artifactFromResource(payload)[0];
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
    // The Versions panel is only useful if the checks arrive with the artifact.
    // Without this the panel could only ever show evidence for an artifact this
    // browser had already opened in the Vault — i.e. almost never, which would
    // make the whole panel look like it did not work.
    const record = verificationFromMetadata(version.metadata);
    artifact.checks = record.checks ?? artifact.checks;
    artifact.criticSummary = record.criticSummary ?? artifact.criticSummary;
  }
  return artifact;
}


function makeDraftBundle(artifact: LibraryArtifact | null): DraftBundle {
  if (!artifact) return { codes: { ...STARTER_CODES }, notes: {} };
  const active = normalizeFramework(artifact?.framework);
  const variants = artifact?.frameworkVariants ?? {};
  const provided: Partial<BuilderCodeVariants> = {};
  for (const [name, code] of Object.entries(variants)) {
    const framework = normalizeFramework(name);
    if (framework && code) provided[framework] = code;
  }
  if (artifact.code && active) provided[active] = artifact.code;
  const qasm = artifact.qasm && looksLikeOpenQasm3(artifact.qasm) ? artifact.qasm : null;
  if (qasm) provided.openqasm3 = qasm;
  const candidates = Object.entries(provided)
    .map(([framework, code]) => ({ framework: framework as StudioFramework, code }))
  const source = candidates.find((candidate) => Boolean(parseCircuitSource(candidate.code, candidate.framework)))
    ?? (qasm ? { framework: "openqasm3" as const, code: qasm } : undefined);
  const converted = source
    ? allCircuitConversionResults(source.code, source.framework, qasm)
    : {};
  const notes: Partial<Record<StudioFramework, string>> = {};
  for (const { key } of CIRCUIT_FRAMEWORKS) {
    const conversion = converted[key];
    if (!provided[key] && conversion?.fidelity === "standard_gate_decomposition") {
      notes[key] = conversion.note;
    }
  }
  return {
    codes: Object.fromEntries(
      CIRCUIT_FRAMEWORKS.map(({ key }) => [key, provided[key] ?? converted[key]?.code ?? ""]),
    ) as BuilderCodeVariants,
    notes,
  };
}

function normalizeFramework(value: string | undefined): StudioFramework | null {
  return circuitFrameworkOrNull(value)?.key ?? null;
}

function studioArtifactIdentity(artifact: LibraryArtifact): string {
  if (artifact.currentVersionId) return `version:${artifact.currentVersionId}`;
  let hash = 2166136261;
  const variants = Object.entries(artifact.frameworkVariants ?? {})
    .sort(([left], [right]) => left.localeCompare(right));
  const identitySource = JSON.stringify({
    framework: artifact.framework,
    code: artifact.code,
    qasm: artifact.qasm,
    variants,
  });
  for (const character of identitySource) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `source:${(hash >>> 0).toString(16)}`;
}

function frameworkLabel(framework: StudioFramework): string {
  return circuitFramework(framework).label;
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
