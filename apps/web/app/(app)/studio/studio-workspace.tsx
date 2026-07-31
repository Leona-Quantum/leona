"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type UIEvent } from "react";
import { SyntaxHighlightedCode, VerificationSummaryPanel, verificationHeadline } from "@majorana/ui";
import { CopyIcon, SearchIcon } from "../../../components/icons";
import { artifactFromResource, frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, statusFromVerificationSummary, type LibraryArtifact } from "../../../lib/library-data";
import type { PublicLocale } from "../../../lib/public-locale";
import { BUILDER_GATES, builderStepLabel, createBuilderStepId, generateBuilderCode, ROTATION_GATES, TWO_QUBIT_GATES, type BuilderCodeVariants, type BuilderGate, type BuilderStep, type CustomGateDefinition } from "../../../lib/studio-builder";
import { loadStoredCircuit, saveStoredCircuit } from "../../../lib/studio-circuits";
import { circuitSyncState, type CircuitSyncState } from "../../../lib/studio-sync";
import { looksLikeOpenQasm3, parseCircuitSource, parseInterchangeCircuit, reconstructInterchangeCircuit } from "../../../lib/circuit-conversion";
import { canvasSeedCandidates, draftSourceFramework, studioDraftBundle, type StudioDraftBundle } from "../../../lib/studio-drafts";
import { CircuitDiagram } from "../../../components/circuit-diagram";
import { MAX_BUILDER_QUBITS, MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS } from "../../../lib/studio-parse";
import { CIRCUIT_FRAMEWORKS, circuitFramework, circuitFrameworkOrNull, isExecutableCircuitFramework, type CircuitFrameworkKey } from "../../../lib/circuit-frameworks";
import { MAX_CPU_SEED, MAX_CPU_SHOTS, cpuSimulationEligibility, loadCpuSimulationRecords, runCpuSimulation, saveCpuSimulationRecord, sourceFingerprint, type CpuSimulationEligibility, type CpuSimulationLimits, type CpuSimulationRecord } from "../../../lib/studio-simulation";
import { TIER_LIMITS } from "../../../lib/account-tier";
import { formatShare, simulationChartData, simulationReading, type SimulationChartData, type SimulationReading } from "../../../lib/simulation-visual";
import { fetchQpuBackends, fetchQpuEstimate, fetchQpuRun, fetchQpuSubmissionGate, formatUsd, submitQpuRun, type QpuBackendInfo, type QpuCostEstimate, type QpuRunRecord, type QpuSubmissionGate } from "../../../lib/qpu";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { DEFAULT_RUN_SHOTS, sampling } from "../../../lib/studio-run-request";
import { verificationFromMetadata, verificationFromResource, type VerificationCheck } from "../../../lib/verification-record";
import { artifactExportManifest } from "../../../lib/artifact-export";
import { restoreRefusalLosses, versionPageFromResource, type ArtifactVersionSummary, type RestoreLoss, type VersionOrigin } from "../../../lib/artifact-versions";
import { studioVerificationDisplayState } from "../../../lib/verification-display";
import { DEFAULT_STUDIO_PANEL, STUDIO_PANELS, type StudioPanel } from "../../../lib/studio-panels";
import { PanelTabs, panelRegion } from "../../../components/panel-tabs";

// Tab order is the working order: you write code, you run it, you look at what
// you wrote, and then you read what the run said about it (Owner Inbox
// 2026-07-31). "visual" was "canvas" and "summary" absorbed the old "versions"
// tab, because a version list with no verdict beside it was never the thing
// anyone opened it for. The list itself lives in lib/studio-panels so the order
// can be asserted as a sequence.
type StudioAction = "simulation" | "save";
/** Panels that can be thrown full-screen. Both are things you look at closely. */
type StudioPopout = "code" | "visual";

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

type DraftBundle = StudioDraftBundle;

const FRAMEWORK_OPTIONS = CIRCUIT_FRAMEWORKS.map(({ key: value, label, executable }) => ({
  value,
  label: executable ? label : `${label} · export`,
}));

const STARTER_STEPS: BuilderStep[] = [
  { id: "starter-h", gate: "H", qubits: [0] },
  { id: "starter-cx", gate: "CX", qubits: [0, 1] },
  { id: "starter-m0", gate: "M", qubits: [0] },
  { id: "starter-m1", gate: "M", qubits: [1] },
];

const STARTER_CODES: BuilderCodeVariants = generateBuilderCode(STARTER_STEPS, 2);

/**
 * A new draft opens with the starter source already in the Code tab, so the
 * canvas is seeded from the same steps. An empty canvas beside a Bell pair in
 * the editor is the exact mismatch this surface is supposed to make visible —
 * it should not ship that mismatch as its own first impression.
 *
 * Distinct from EMPTY_SEED, which stays empty: it is the fallback for an
 * artifact whose code the builder cannot represent, and drawing a Bell pair
 * for an unrelated circuit would be a far worse lie than drawing nothing.
 */
const STARTER_SEED: Omit<BuilderSeed, "key"> = { artifactIdentity: null, qubitCount: 2, steps: STARTER_STEPS, customGates: [] };

export function StudioWorkspace({ artifactId, newDraft = false, locale = "en", limits = TIER_LIMITS.free }: { artifactId?: string; newDraft?: boolean; locale?: PublicLocale; limits?: CpuSimulationLimits }) {
  const copy = WORKSPACE_COPY[locale].studio;
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [showEditor, setShowEditor] = useState(Boolean(artifactId || newDraft));
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("Untitled circuit");
  const [framework, setFramework] = useState<StudioFramework>("qiskit");
  const [drafts, setDrafts] = useState<BuilderCodeVariants>(() => ({ ...STARTER_CODES }));
  const [draftNotes, setDraftNotes] = useState<Partial<Record<StudioFramework, string>>>({});
  // Which tabs hold another framework's source rather than a conversion of it.
  // Everything that pairs code with a framework — export header, run request,
  // the parser — must resolve through this, never trust the selected tab alone.
  const [draftFallbacks, setDraftFallbacks] = useState<DraftBundle["fallbacks"]>({});
  const [code, setCode] = useState(STARTER_CODES.qiskit);
  const [panel, setPanel] = useState<StudioPanel>(DEFAULT_STUDIO_PANEL);
  const [selectedGate, setSelectedGate] = useState("H");
  const [busy, setBusy] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [simulationRecords, setSimulationRecords] = useState<CpuSimulationRecord[]>([]);
  const [rerunPending, setRerunPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [popout, setPopout] = useState<StudioPopout | null>(null);

  /** Changing tab always closes a popout.
   *
   * Leaving it set is not merely untidy: only two panels can pop out, so
   * switching away from a popped-out Code tab left `popout === "code"` with
   * nothing rendering it, and returning to Code reopened it full-screen with no
   * action from the user in between. */
  function selectPanel(next: StudioPanel) {
    setPanel(next);
    setPopout(null);
  }
  // Strings, not numbers: an empty seed field means "let the planner choose" and
  // a number state would have to encode that as 0, which is a valid seed.
  const [shots, setShots] = useState(String(DEFAULT_RUN_SHOTS));
  const [seed, setSeed] = useState("");
  const [artifactHydration, setArtifactHydration] = useState<ArtifactHydration>(() => artifactId && !newDraft ? "loading" : "ready");
  const [artifactSyncError, setArtifactSyncError] = useState(false);
  const [verificationStale, setVerificationStale] = useState(false);
  // Matches the starter source `code` is initialised with, so the first paint
  // is already self-consistent.
  const [builderSeed, setBuilderSeed] = useState<BuilderSeed>({ key: "seed-0", ...STARTER_SEED });
  const seedCounter = useRef(0);
  // What the canvas currently draws. The builder owns the editing state; this
  // mirror exists so the page can tell whether the diagram still matches the
  // code, which only the page can see. Seeding resets it; user edits update it.
  const [canvasCircuit, setCanvasCircuit] = useState<{ qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }>(
    () => ({ qubitCount: STARTER_SEED.qubitCount, steps: STARTER_SEED.steps, customGates: STARTER_SEED.customGates }),
  );

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

  // The language the editor's text is actually in. Equal to the selected tab
  // except when that tab is a source fallback — a framework with no safe
  // conversion shows the stored source instead of an empty editor, and calling
  // that source by the tab's name would mislabel every export and run made from
  // it, and hand the parser the wrong language.
  const sourceFramework = draftSourceFramework({ fallbacks: draftFallbacks }, framework);

  // The diagram is only trustworthy while it still describes the code that
  // will actually run. Compare structurally rather than textually: generated
  // and hand-written source differ in imports and spacing while meaning the
  // same circuit, and a warning that fires constantly gets ignored.
  const canvasSync: CircuitSyncState = useMemo(() => {
    const fromCode = parseCircuitSource(code, sourceFramework);
    if (fromCode) return circuitSyncState(fromCode, canvasCircuit);
    // The active code is outside the builder's subset — an LLM run's Python with
    // transpile/AerSimulator boilerplate is the common case. If the canvas was
    // reconstructed from the artifact's stored interchange QASM, the diagram is
    // still a faithful picture of what runs, so compare against that rather than
    // calling it unrepresentable. The `artifact.code === code` guard drops this
    // the moment the source is edited away from the saved artifact, so an edit
    // honestly falls back to "the diagram no longer matches the code".
    const fromQasm = artifact?.code === code && artifact.qasm ? parseInterchangeCircuit(artifact.qasm) : null;
    return circuitSyncState(fromQasm, canvasCircuit);
  }, [code, sourceFramework, canvasCircuit, artifact?.code, artifact?.qasm]);

  const cpuEligibility = useMemo(() => cpuSimulationEligibility({
    artifactId: artifact?.id ?? "",
    code,
    framework: sourceFramework,
    qasm: artifact?.code === code ? artifact.qasm : null,
  }, limits), [artifact?.id, artifact?.code, artifact?.qasm, code, sourceFramework, limits]);

  // The full evidence panel used to sit above the tabs on every draft, so the
  // most prominent block on a brand-new circuit was a grey box explaining that
  // it had no evidence yet. It is one chip in the header now, and the panel
  // itself lives in the tab that is about evidence.
  const verificationDisplayState = studioVerificationDisplayState({
    hydration: artifactHydration,
    hasArtifact: Boolean(artifact),
    stale: verificationStale,
  });

  function seedForArtifact(next: LibraryArtifact, bundle: DraftBundle, activeFramework: StudioFramework): { seed: BuilderSeed; note: string | null } {
    const activeDrafts = bundle.codes;
    seedCounter.current += 1;
    const key = `${next.id}:${seedCounter.current}`;
    const stored = loadStoredCircuit(next.id);
    const artifactIdentity = studioArtifactIdentity(next);
    // A cached seed is trusted only if it is still drawable. An editable draft
    // (<= the builder's width) is the user's own work and always kept whatever
    // its depth. A wider cached seed is a persisted read-only reconstruction —
    // and one persisted before this change had no step guard, so it can exceed
    // the current bounds and would render the pathological SVG the guard exists
    // to prevent. When it does, drop the cache and fall through to fresh
    // reconstruction, which re-applies the guard (and surfaces too_large).
    const cachedIsDrawable = stored
      && (stored.qubitCount <= MAX_BUILDER_QUBITS
        || (stored.qubitCount <= MAX_VIEWABLE_QUBITS && stored.steps.length <= MAX_VIEWABLE_STEPS));
    if (stored?.artifactIdentity === artifactIdentity && cachedIsDrawable) {
      return { seed: { key, artifactIdentity, qubitCount: stored.qubitCount, steps: stored.steps, customGates: stored.customGates }, note: copy.circuitRestored };
    }
    const hasOwnCode = Boolean(next.code || next.frameworkVariants || next.qasm);
    // Every draft the picker holds, not just the artifact's own stored variants.
    // The OpenQASM 3 draft is very often derived from source the editable parser
    // rejects, and it is exactly what the interchange reader can draw — skipping
    // it is what left artifacts opening to a blank canvas beside a perfectly
    // drawable circuit one tab away. See canvasSeedCandidates.
    const candidates = canvasSeedCandidates(next, activeDrafts, activeFramework, bundle.fallbacks);
    // First choice: an editable circuit the six-wire builder can reconstruct.
    const parsed = hasOwnCode
      ? candidates.map((candidate) => parseCircuitSource(candidate.code, candidate.framework)).find(Boolean) ?? null
      : null;
    if (parsed) {
      return { seed: { key, artifactIdentity, qubitCount: parsed.qubitCount, steps: parsed.steps, customGates: [] }, note: copy.circuitRestored };
    }
    // Fallback: reconstruct a read-only diagram from the stored interchange QASM
    // (or wider builder-shaped source). LLM-run artifacts store Qiskit qasm3
    // output — richer gates, a `meas` register, per-qubit measurement, and often
    // more than six qubits — which the editable parser rejects, so before this
    // fallback those artifacts opened to an empty canvas and showed no circuit
    // at all. The interchange reader draws the standard-gate subset up to the
    // *viewing* ceiling (higher than the simulation ceiling — looking costs only
    // SVG); anything above six qubits opens read-only (below, editable). It can
    // also decline as too_large — a decomposed gate set that would draw a
    // pathological diagram — which we surface honestly rather than as an empty
    // canvas that looks like a bug.
    // The stored interchange first, then the OpenQASM 3 draft the picker just
    // derived. An artifact whose export never ran has no stored qasm at all, and
    // for those the derived draft is the only interchange there is — without it
    // the canvas stays empty for every run whose best-effort export was skipped.
    // `looksLikeOpenQasm3` inside the reader rejects a source-fallback draft, so
    // this can never hand it Python.
    const interchange = hasOwnCode
      ? [next.qasm, activeDrafts.openqasm3]
        .filter((value): value is string => Boolean(value))
        .map((qasm) => reconstructInterchangeCircuit(qasm))
        .find((result) => result.kind !== "unparsable") ?? null
      : null;
    // Only reach for the builder-shaped fallback if the interchange QASM path
    // didn't already produce a drawable circuit — parsing every candidate is
    // wasted work once the primary path succeeds.
    const fallback = interchange?.kind === "ok" || !hasOwnCode
      ? null
      : candidates.map((candidate) => parseCircuitSource(candidate.code, candidate.framework, MAX_VIEWABLE_QUBITS)).find(Boolean) ?? null;
    const reconstructed = interchange?.kind === "ok"
      ? interchange.circuit
      : fallback && fallback.steps.length <= MAX_VIEWABLE_STEPS
        ? fallback
        : null;
    if (reconstructed) {
      const note = reconstructed.qubitCount > MAX_BUILDER_QUBITS ? copy.circuitViewerReadonly : copy.circuitRestored;
      return { seed: { key, artifactIdentity, qubitCount: reconstructed.qubitCount, steps: reconstructed.steps, customGates: [] }, note };
    }
    const tooLargeToDraw = interchange?.kind === "too_large" || (fallback !== null && fallback.steps.length > MAX_VIEWABLE_STEPS);
    return { seed: { key, ...EMPTY_SEED, artifactIdentity }, note: hasOwnCode ? (tooLargeToDraw ? copy.circuitTooLargeToDraw : copy.circuitNotRebuildable) : null };
  }

  function applyArtifact(next: LibraryArtifact | null) {
    setArtifactHydration("ready");
    setShowEditor(true);
    setArtifact(next);
    setTitle(next?.title ?? "Untitled circuit");
    const nextBundle = makeDraftBundle(next, copy);
    const nextDrafts = nextBundle.codes;
    const nextFramework = normalizeFramework(next?.framework)
      ?? CIRCUIT_FRAMEWORKS.find(({ key }) => Boolean(nextDrafts[key]))?.key
      ?? "qiskit";
    setDrafts(nextDrafts);
    setDraftNotes(nextBundle.notes);
    setDraftFallbacks(nextBundle.fallbacks);
    setFramework(nextFramework);
    setCode(nextDrafts[nextFramework]);
    selectPanel(DEFAULT_STUDIO_PANEL);
    setRunId(null);
    setVerificationStale(false);
    if (!next) {
      seedCounter.current += 1;
      seedBuilder({ key: `draft-${seedCounter.current}`, ...STARTER_SEED });
      setMessage(null);
      return;
    }
    const { seed, note } = seedForArtifact(next, nextBundle, nextFramework);
    seedBuilder(seed);
    setMessage(note);
  }

  /** Reseed the canvas and the mirror together — they must never disagree. */
  function seedBuilder(seed: BuilderSeed) {
    setBuilderSeed(seed);
    setCanvasCircuit({ qubitCount: seed.qubitCount, steps: seed.steps, customGates: seed.customGates });
  }

  /** Redraw the canvas from whatever the Code tab currently holds. */
  function rebuildCanvasFromCode() {
    const parsed = parseCircuitSource(code, sourceFramework);
    if (!parsed) return;
    seedCounter.current += 1;
    seedBuilder({
      key: `rebuild-${seedCounter.current}`,
      artifactIdentity: builderSeed.artifactIdentity,
      qubitCount: parsed.qubitCount,
      steps: parsed.steps,
      customGates: [],
    });
    setMessage(copy.rebuiltFromCode);
  }

  const filteredArtifacts = artifacts.filter((item) => {
    const normalized = query.trim().toLowerCase();
    return !normalized || [item.title, item.family, item.framework, item.description, ...item.tags].join(" ").toLowerCase().includes(normalized);
  });

  async function selectArtifact(id: string) {
    setMessage(null);
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

  function downloadDraft() {
    if (!artifact) return;
    const exportArtifact = verificationStale
      ? { ...artifact, status: "stale" as const, verificationSummary: null }
      : artifact;
    // sourceFramework, not the selected tab: an export that labelled a stored
    // Qiskit source as PennyLane would be a lie in a file that outlives the tab.
    const body = JSON.stringify(artifactExportManifest(exportArtifact, { framework: sourceFramework, code }), null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${artifact.slug || artifact.id}.majorana.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function openSimulation() {
    selectPanel("simulation");
    setMessage(null);
  }

  function startCpuSimulation(confirmRerun = false) {
    if (!artifact) {
      selectPanel("simulation");
      setMessage(copy.simulationArtifactRequired);
      return;
    }
    if (!cpuEligibility.eligible) {
      selectPanel("simulation");
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
        framework: sourceFramework,
        qasm: artifact.code === code ? artifact.qasm : null,
        shots: parsedShots,
        seed: parsedSeed,
      }, limits);
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
    // Both must be executable. `framework` keeps the button's meaning tied to
    // the tab the user is looking at; `sourceFramework` is what actually gets
    // submitted, and a source fallback can point at a framework the API cannot
    // run even when the selected tab is one it can.
    if (!code.trim() || busy || !isExecutableCircuitFramework(framework) || !isExecutableCircuitFramework(sourceFramework)) return;
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
          // sourceFramework: submitting the editor's text under the selected
          // tab's name would hand the pipeline Qiskit source labelled PennyLane
          // whenever that tab is a source fallback, and it would fail on the
          // framework contract rather than on anything the user did.
          task_prompt: `Please verify and save a new version of the edited quantum circuit “${title}” in ${frameworkLabel(sourceFramework)}. Preserve the supplied source code, report the evidence clearly, and do not silently change frameworks.`,
          mode: "execute",
          framework: sourceFramework,
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
      <div className={`mj-studio-workspace${showEditor ? " mj-studio-workspace--editor mj-studio-workspace--editor-solo" : " mj-studio-workspace--discovery"}`}>
        {showEditor ? (
          <>
            <section className="mj-studio-main">
              <div className="mj-studio-main-head">
                <div className="mj-studio-title-block">
                  <label className="mj-section-label" htmlFor="studio-title">{copy.workingCircuit}</label>
                  <input id="studio-title" className="mj-studio-title-input" value={title} onChange={(event) => setTitle(event.target.value)} />
                  <p>{artifact ? copy.editingVersion(artifact.currentVersionId ? artifact.currentVersionId.slice(0, 8) : (locale === "ja" ? "下書き" : "draft"), artifact.framework) : copy.newDraft}</p>
                </div>
                {/* Simulate and Copy code used to sit here as full-size buttons
                    beside a tab bar that already contained both — three ways to
                    reach two places. Each now lives once, inside the tab that
                    owns it (Owner Inbox 2026-07-31). */}
                <div className="mj-studio-actions">
                  {/* The chip is a shortcut to the evidence panel. On the tab
                      that already renders that panel it would just be the same
                      sentence twice. */}
                  {panel === "summary" ? null : (
                    <StudioVerdictChip
                      summary={artifact?.verificationSummary ?? null}
                      state={verificationDisplayState}
                      onOpen={() => selectPanel("summary")}
                      copy={copy}
                    />
                  )}
                  {artifact ? <button className="mj-secondary-button" type="button" onClick={downloadDraft}>{copy.downloadExport}</button> : null}
                  <button className="mj-primary-button" type="button" disabled={!code.trim() || busy !== null || !isExecutableCircuitFramework(framework) || !isExecutableCircuitFramework(sourceFramework)} onClick={() => void startRun()}>{busy === "save" ? copy.starting : copy.verifySave}</button>
                </div>
              </div>

              <PanelTabs
                panels={STUDIO_PANELS}
                active={panel}
                onSelect={selectPanel}
                label={copy.view}
                labelFor={(item) => (item === "code" ? copy.code : item === "simulation" ? copy.simulation : item === "visual" ? copy.visual : copy.summary)}
                idPrefix="studio"
              />

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
                    hidden={panel !== "visual"}
                    region={panelRegion("studio", "visual")}
                    popout={popout === "visual"}
                    onTogglePopout={() => setPopout((current) => (current === "visual" ? null : "visual"))}
                    copy={copy}
                    syncState={canvasSync}
                    onRebuildFromCode={rebuildCanvasFromCode}
                    sourceCode={code}
                    onCircuitChange={(circuit) => {
                      setCanvasCircuit(circuit);
                      if (!artifact) return;
                      const persisted = saveStoredCircuit(artifact.id, { artifactIdentity: studioArtifactIdentity(artifact), ...circuit });
                      if (!persisted) setMessage(copy.persistenceUnavailable);
                    }}
                    onApply={(codes) => {
                      setDrafts(codes);
                      // Notes and fallbacks describe the drafts and must be
                      // cleared with them. Applying the canvas regenerates every
                      // framework from the diagram, so no tab is a source
                      // reference any more — a stale mapping here would label a
                      // freshly generated PennyLane export as Qiskit.
                      setDraftNotes({});
                      setDraftFallbacks({});
                      setCode(codes[framework]);
                      setVerificationStale(Boolean(artifact));
                      setMessage(copy.appliedToCode);
                    }}
                  />
                  {panel === "code" ? (
                    <CodeEditor
                      code={code}
                      framework={framework}
                      sourceFramework={sourceFramework}
                      onChange={(next) => { setCode(next); setVerificationStale(Boolean(artifact)); }}
                      onCopy={() => void copyCode()}
                      copied={copied}
                      onFrameworkChange={changeFramework}
                      note={draftNotes[framework] ?? null}
                      popout={popout === "code"}
                      region={panelRegion("studio", "code")}
                      onTogglePopout={() => setPopout((current) => (current === "code" ? null : "code"))}
                      copy={copy}
                      locale={locale}
                    />
                  ) : null}
                  {panel === "simulation" ? (
                    <SimulationPanel
                      artifact={artifact}
                      eligibility={cpuEligibility}
                      records={simulationRecords}
                      shots={shots}
                      seed={seed}
                      onShotsChange={setShots}
                      onSeedChange={setSeed}
                      rerunPending={rerunPending}
                      busy={busy === "simulation"}
                      onRun={() => startCpuSimulation()}
                      onConfirmRerun={() => startCpuSimulation(true)}
                      onCancelRerun={() => setRerunPending(false)}
                      onRunInSandbox={
                        code.trim() && isExecutableCircuitFramework(sourceFramework)
                          ? () => void startRun()
                          : null
                      }
                      sandboxBusy={busy !== null}
                      copy={copy}
                    />
                  ) : null}
                  {panel === "summary" ? (
                    <SummaryPanel
                      artifact={artifact}
                      runId={runId}
                      stale={verificationStale}
                      state={verificationDisplayState}
                      copy={copy}
                      locale={locale}
                      onRestored={(seq) => {
                        // Re-hydrate rather than patching state: a restore
                        // changes code, OpenQASM, variants, estimates and the
                        // verdict together, and half of them arrive only from
                        // the version resource.
                        if (artifact) void selectArtifact(artifact.id);
                        setVerificationStale(false);
                        setMessage(copy.restoreDone(seq));
                      }}
                    />
                  ) : null}
                </>
              )}

              <footer className="mj-studio-footer" aria-live="polite">
                {artifactSyncError ? <span role="alert">{copy.remoteSyncUnavailable}</span> : null}
                <span>{message ?? copy.footer}</span>
                {runId ? <a href={`/run/${runId}`}>{copy.openRun} →</a> : null}
              </footer>
            </section>

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
                    <span className="mj-studio-artifact-mark" aria-hidden="true">{item.status === "verified" ? "✓" : "–"}</span><span className="sr-only">{item.status.replaceAll("_", " ")}</span>
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
 * The header's one-line verdict, and the way into the evidence behind it.
 *
 * The full `VerificationSummaryPanel` used to sit above the tab bar on every
 * draft, so the largest block on a new circuit was a box saying it had no
 * evidence. The wording comes from `verificationHeadline` in the same module
 * that renders the panel, so the chip and the panel cannot disagree about what
 * an artifact's evidence amounts to.
 */
function StudioVerdictChip({
  summary,
  state,
  onOpen,
  copy,
}: {
  summary: Parameters<typeof verificationHeadline>[0];
  state: Parameters<typeof verificationHeadline>[1];
  onOpen: () => void;
  copy: StudioCopy;
}) {
  const headline = verificationHeadline(summary, state);
  return (
    <button
      className="mj-studio-verdict-chip"
      type="button"
      data-tone={headline.tone}
      onClick={onOpen}
      title={copy.openSummary}
    >
      <span aria-hidden="true">{headline.glyph}</span>
      {headline.title}
      <span className="sr-only">— {copy.openSummary}</span>
    </button>
  );
}

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

function CircuitBuilder({ seed, framework, selectedGate, onSelectGate, onApply, onCircuitChange, hidden, popout, onTogglePopout, region, copy, syncState, onRebuildFromCode, sourceCode }: { seed: BuilderSeed; framework: StudioFramework; selectedGate: string; onSelectGate: (gate: string) => void; onApply: (codes: BuilderCodeVariants) => void; onCircuitChange?: (circuit: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }) => void; hidden: boolean; popout: boolean; onTogglePopout: () => void; region?: Record<string, string>; copy: StudioCopy; syncState: CircuitSyncState; onRebuildFromCode: () => void; sourceCode: string }) {
  const [qubitCount, setQubitCount] = useState(seed.qubitCount);
  const [steps, setSteps] = useState<BuilderStep[]>(seed.steps);
  const [pendingQubits, setPendingQubits] = useState<number[]>([]);
  const [angle, setAngle] = useState("pi/2");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [customGates, setCustomGates] = useState<CustomGateDefinition[]>(seed.customGates);
  const [showCustomGateForm, setShowCustomGateForm] = useState(false);
  const [customGateName, setCustomGateName] = useState("");
  const [builderMessage, setBuilderMessage] = useState<string | null>(null);
  const [applyConfirmPending, setApplyConfirmPending] = useState(false);

  // A circuit wider than the six-wire editable grid opens as a read-only
  // diagram: the drag-and-drop builder, its palette, and its edit controls all
  // assume ≤6 wires, so for a reconstructed 10- or 20-qubit circuit we show the
  // diagram (so it renders at all) but hide every affordance that would edit it.
  const readOnly = qubitCount > MAX_BUILDER_QUBITS;

  // A pending confirmation describes one specific pair of a diagram and a
  // source. If either side moves — the code is edited again, the canvas is
  // changed, or the two come back into agreement — the armed button would be
  // consenting to something the user was never shown, so disarm it.
  useEffect(() => {
    setApplyConfirmPending(false);
  }, [syncState.kind, sourceCode, steps, qubitCount, customGates]);

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


  return (
    <StudioPanelSurface
      className="mj-studio-canvas"
      label={copy.canvasLabel}
      eyebrow={copy.canvasLabel}
      heading={copy.generatedPreview}
      meta={<span className="mj-mono-muted">{frameworkLabel(framework)} · {qubitCount}q · {steps.length} ops</span>}
      popout={popout}
      onTogglePopout={onTogglePopout}
      copy={copy}
      hidden={hidden}
      region={region}
    >
      {readOnly ? (
        <div className="mj-circuit-sync mj-circuit-sync--readonly" role="status">
          <span>{copy.readonlyDiagram(qubitCount)}</span>
        </div>
      ) : null}

      {readOnly ? null : (
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
      )}

      {!readOnly && customGates.length ? (
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

      {readOnly || syncState.kind === "in_sync" ? null : (
        <div className={`mj-circuit-sync mj-circuit-sync--${syncState.kind}`} role="status">
          <span>{syncState.kind === "diverged" ? copy.canvasOutOfDate : copy.canvasBeyondBuilder}</span>
          {syncState.kind === "diverged" ? (
            <button className="mj-secondary-button" type="button" onClick={onRebuildFromCode}>{copy.rebuildFromCode}</button>
          ) : null}
        </div>
      )}

      <CircuitDiagram
        qubitCount={qubitCount}
        steps={steps}
        customGates={customGates}
        ariaLabel={copy.circuitAria(frameworkLabel(framework))}
        interaction={readOnly ? undefined : {
          selectedStepIds,
          pendingQubits,
          selectedLabel,
          onPlaceOnQubit: placeOnQubit,
          onSelectStep: selectStep,
          onStepKeyDown: handleStepKeyDown,
        }}
      />

      {readOnly ? null : (
      <div className="mj-builder-controls">
        <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(1)} disabled={qubitCount >= 6}>{copy.addQubit}</button>
        <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(-1)} disabled={qubitCount <= 1}>{copy.removeQubit}</button>
        <button className="mj-secondary-button" type="button" onClick={() => { const removed = steps[steps.length - 1]; setSteps((current) => current.slice(0, -1)); if (removed) setSelectedStepIds((current) => current.filter((id) => id !== removed.id)); setPendingQubits([]); }} disabled={!steps.length}>{copy.undo}</button>
        <button className="mj-secondary-button" type="button" onClick={() => { setSteps([]); setSelectedStepIds([]); setPendingQubits([]); setBuilderMessage(null); }} disabled={!steps.length}>{copy.clearAll}</button>
        <button className="mj-secondary-button" type="button" onClick={deleteSelected} disabled={!selectedStepIds.length}>{copy.deleteSelected}</button>
        {selectedStepIds.length >= 2 ? <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(true)}>{copy.groupSelected}</button> : null}
        <button
          className="mj-primary-button"
          type="button"
          onClick={() => {
            // Applying replaces the Code tab. Confirm whenever the source is
            // not already this diagram — both when it has moved on since the
            // diagram was drawn, and when it is source the builder cannot
            // draw at all. The second case is the more destructive of the
            // two: unrepresentable code is by definition code no diagram can
            // reproduce, so overwriting it cannot be undone from the canvas.
            if (syncState.kind !== "in_sync" && !applyConfirmPending) {
              setApplyConfirmPending(true);
              setBuilderMessage(syncState.kind === "diverged" ? copy.applyOverwritesEditedCode : copy.applyOverwritesUnrepresentableCode);
              return;
            }
            setApplyConfirmPending(false);
            onApply(generateBuilderCode(steps, qubitCount, customGates));
          }}
          disabled={!steps.length}
        >
          {applyConfirmPending ? copy.confirmApply : copy.applyToCode}
        </button>
        {applyConfirmPending ? (
          <button className="mj-secondary-button" type="button" onClick={() => { setApplyConfirmPending(false); setBuilderMessage(null); }}>{copy.cancel}</button>
        ) : null}
      </div>
      )}

      {!readOnly && showCustomGateForm ? (
        <form className="mj-builder-custom-form" onSubmit={(event) => { event.preventDefault(); createCustomGate(); }}>
          <label>
            <span>{copy.customGates}</span>
            <input autoFocus value={customGateName} onChange={(event) => setCustomGateName(event.target.value)} placeholder={copy.customGatePlaceholder} />
          </label>
          <button className="mj-primary-button" type="submit">{copy.createCustomGate}</button>
          <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(false)}>{copy.cancelCustomGate}</button>
        </form>
      ) : null}

      {/* The gate's description was the inspector's headline card, one panel
          away from the palette it described. Folded away by default because it
          is reference material, not state. */}
      {readOnly ? null : (
        <details className="mj-sim-details mj-studio-gate-note">
          <summary>{copy.selectedGate}: {selectedGate.startsWith("custom:") ? copy.customGateLabel : selectedGate}</summary>
          <p>{selectedGate.startsWith("custom:") ? copy.customGateInspector : copy.gateDescriptions[selectedGate] ?? copy.gateDescriptions.H}</p>
        </details>
      )}

      <div className="mj-studio-canvas-footer" aria-live="polite">
        <span>{readOnly ? copy.readonlyDiagramHint : (builderMessage ?? (pendingQubits.length ? copy.pickTarget : selectedStepIds.length ? copy.selectedCount(selectedStepIds.length) : steps.length ? copy.builderHint : copy.builderEmpty))}</span>
        <span className="mj-mono-muted">{steps.length ? steps.map((step) => builderStepLabel(step, customGates)).join(" → ") : "—"}</span>
      </div>
    </StudioPanelSurface>
  );
}

/**
 * @param framework the selected tab.
 * @param sourceFramework the language the text is actually in. Differs only for
 *   a source reference, where the heading must not read "OpenQASM 3.0
 *   implementation" over Python and the highlighter must not tokenize Python as
 *   OpenQASM. The toast that explains the fallback is transient; this is not.
 */
function CodeEditor({
  code,
  framework,
  sourceFramework,
  onChange,
  onCopy,
  copied,
  onFrameworkChange,
  note,
  popout,
  onTogglePopout,
  region,
  copy,
  locale,
}: {
  code: string;
  framework: StudioFramework;
  sourceFramework: StudioFramework;
  onChange: (code: string) => void;
  onCopy: () => void;
  copied: boolean;
  onFrameworkChange: (framework: StudioFramework) => void;
  note: string | null;
  popout: boolean;
  onTogglePopout: () => void;
  region?: Record<string, string>;
  copy: StudioCopy;
  locale: PublicLocale;
}) {
  const isSourceReference = sourceFramework !== framework;
  const heading = isSourceReference
    ? copy.sourceReferenceHeading(frameworkLabel(sourceFramework), frameworkLabel(framework))
    : copy.implementation(frameworkLabel(framework));
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
  const executable = isExecutableCircuitFramework(framework);
  return (
    <StudioPanelSurface
      className="mj-studio-code-panel"
      label={copy.sourceEditor}
      eyebrow={copy.sourceEditor}
      heading={heading}
      popout={popout}
      onTogglePopout={onTogglePopout}
      region={region}
      copy={copy}
      controls={
        <>
          {/* The framework picker lived in the inspector, one panel away from
              the code it retargets, which is why the conversions read as absent
              (Owner Inbox 2026-07-31). All eight are offered here; the four that
              cannot be executed say so in the option itself. */}
          <label className="mj-studio-framework-select">
            <span className="sr-only">{locale === "ja" ? "フレームワーク" : "Framework"}</span>
            <select value={framework} onChange={(event) => onFrameworkChange(event.target.value as StudioFramework)}>
              {FRAMEWORK_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button className="mj-secondary-button" type="button" onClick={onCopy} title={copied ? copy.copied : copy.copyCode}><CopyIcon size={14} />{copied ? copy.copied : copy.copyCode}</button>
        </>
      }
    >
      <div className="mj-studio-code-editor-wrap">
        <pre className="mj-studio-code-highlight" aria-hidden="true" ref={highlightRef}>
          <SyntaxHighlightedCode code={code + "\n"} language={sourceFramework} />
        </pre>
        <textarea className="mj-studio-code-editor" value={code} onChange={(event) => onChange(event.target.value)} onScroll={syncScroll} spellCheck={false} aria-label={`${frameworkLabel(sourceFramework)} ${copy.sourceEditorInput}`} />
      </div>
      {/* Three separate things can be true of the text above, and each is only
          printed when it is: it was rewritten through standard gates, it is
          another framework's source shown under this tab's name, or the tab
          cannot be executed. A blanket "conversions may be lossy" strip would
          warn about stored native code that was never touched. */}
      <div className="mj-studio-code-notes">
        {note ? <p className="mj-studio-code-note" data-tone="warn">{note}</p> : null}
        {isSourceReference ? <p className="mj-studio-code-note" data-tone="warn">{copy.conversionUnavailable(frameworkLabel(framework), frameworkLabel(sourceFramework))}</p> : null}
        {!executable ? <p className="mj-studio-code-note">{copy.exportOnlyFramework}</p> : null}
        <details className="mj-studio-code-about">
          <summary>{copy.aboutConversions}</summary>
          <p>{copy.conversionExplainer}</p>
          <p className="mj-studio-editor-note">{copy.editorNote}</p>
        </details>
      </div>
    </StudioPanelSurface>
  );
}

/**
 * The chrome every Studio tab shares: eyebrow, heading, its own controls, and a
 * popout.
 *
 * The tabs had drifted into four different header shapes — one with a button on
 * the right, one with a muted string, one with neither — which is most of why
 * the surface read as four unrelated screens (Owner Inbox 2026-07-31: "clear
 * sections, not verbose"). The popout is a plain full-viewport panel rather than
 * a modal: nothing behind it needs to be blocked, and the four hand-rolled
 * dialogs in this repo already share a missing focus trap that a fifth copy
 * would inherit.
 */
function StudioPanelSurface({
  className,
  label,
  eyebrow,
  heading,
  meta,
  controls,
  popout,
  onTogglePopout,
  copy,
  children,
  hidden = false,
  region,
}: {
  className: string;
  label: string;
  eyebrow: string;
  heading: string;
  meta?: ReactNode;
  controls?: ReactNode;
  popout?: boolean;
  onTogglePopout?: () => void;
  copy: StudioCopy;
  children: ReactNode;
  hidden?: boolean;
  /** role/id/aria-labelledby from panelRegion, so its tab points somewhere. */
  region?: Record<string, string>;
}) {
  useEffect(() => {
    if (!popout || !onTogglePopout) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onTogglePopout();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popout, onTogglePopout]);

  return (
    <section
      className={`mj-studio-surface ${className}${popout ? " is-popout" : ""}`}
      aria-label={label}
      hidden={hidden}
      {...region}
    >
      <div className="mj-studio-surface-head">
        <div>
          <span className="mj-section-label">{eyebrow}</span>
          <h2>{heading}</h2>
        </div>
        <div className="mj-studio-surface-controls">
          {meta}
          {controls}
          {onTogglePopout ? (
            <button
              className="mj-icon-button"
              type="button"
              aria-pressed={Boolean(popout)}
              aria-label={popout ? copy.collapsePanel : copy.expandPanel}
              title={popout ? copy.collapsePanel : copy.expandPanel}
              onClick={onTogglePopout}
            >
              <span aria-hidden="true">{popout ? "⤡" : "⤢"}</span>
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </section>
  );
}

/** Where a circuit can be run, in one place, with each lane's real status.
 *
 * Three lanes exist and they are not interchangeable: the browser CPU lane runs
 * a bounded statevector locally and produces no evidence; the GPU lane has no
 * provider attached yet; hardware runs on a real QPU and costs money. Grouping
 * them makes the choice legible and stops the CPU lane's eligibility text from
 * being printed twice — once as the panel's status line and once inside the box
 * explaining what to do about it.
 */
function SimulationPanel({
  artifact,
  eligibility,
  records,
  shots,
  seed,
  onShotsChange,
  onSeedChange,
  rerunPending,
  busy,
  onRun,
  onConfirmRerun,
  onCancelRerun,
  onRunInSandbox,
  sandboxBusy,
  copy,
}: {
  artifact: LibraryArtifact | null;
  eligibility: CpuSimulationEligibility;
  records: CpuSimulationRecord[];
  shots: string;
  seed: string;
  onShotsChange: (value: string) => void;
  onSeedChange: (value: string) => void;
  rerunPending: boolean;
  busy: boolean;
  onRun: () => void;
  onConfirmRerun: () => void;
  onCancelRerun: () => void;
  onRunInSandbox: (() => void) | null;
  sandboxBusy: boolean;
  copy: StudioCopy;
}) {
  const currentRecords = eligibility.eligible
    ? records.filter((record) => (
      record.sourceFingerprint === eligibility.sourceFingerprint
      && record.interchangeFingerprint === eligibility.interchangeFingerprint
    ))
    : [];
  return (
    <section className="mj-studio-surface mj-studio-simulation-panel" aria-label={copy.simulation} {...panelRegion("studio", "simulation")}>
      <div className="mj-studio-surface-head">
        <div>
          <span className="mj-section-label">{copy.computeLanes}</span>
          <h2>{copy.simulation}</h2>
        </div>
        <div className="mj-studio-surface-controls">
          {/* Shots and seed came from the inspector. They belong beside the run
              control they parameterise, not in a panel you had to keep open on
              a different tab to see them. */}
          <label className="mj-studio-inline-field" htmlFor="studio-shots">
            <span>{copy.shots}</span>
            <input
              id="studio-shots"
              type="number"
              min={1}
              max={MAX_CPU_SHOTS}
              step={256}
              value={shots}
              onChange={(event) => onShotsChange(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="mj-studio-inline-field" htmlFor="studio-seed">
            <span>{copy.seed}</span>
            <input
              id="studio-seed"
              type="number"
              min={0}
              max={MAX_CPU_SEED}
              value={seed}
              placeholder={copy.seedAuto}
              onChange={(event) => onSeedChange(event.target.value)}
              inputMode="numeric"
            />
          </label>
        </div>
      </div>
      <div className="mj-studio-simulation-body">
        <div className="mj-studio-lane">
          <div className="mj-studio-lane-head">
            <span className="mj-studio-lane-title">{copy.cpuLane}</span>
            <span className="mj-mono-muted">{eligibility.eligible ? copy.cpuEligible : copy.cpuUnavailableShort}</span>
          </div>
        <details className="mj-sim-details">
          <summary>{copy.simulationContextDetails}</summary>
          <p className="mj-studio-simulation-boundary">{copy.simulationBoundary}</p>
          <dl className="mj-studio-contract">
            <div><dt>{copy.simulationArtifact}</dt><dd>{artifact?.title ?? copy.newDraftSource}</dd></div>
            <div><dt>{copy.sourceFingerprint}</dt><dd>{eligibility.sourceFingerprint}</dd></div>
            {eligibility.eligible && eligibility.interchangeFingerprint ? <div><dt>{copy.interchangeFingerprint}</dt><dd>{eligibility.interchangeFingerprint}</dd></div> : null}
            {eligibility.eligible ? <div><dt>{copy.simulationModel}</dt><dd>{simulationModelLabel(eligibility.model, copy)}</dd></div> : null}
            <div><dt>{copy.simulator}</dt><dd>{copy.browserCpu}</dd></div>
          </dl>
          <p className="mj-studio-sampling-note">{copy.samplingNote}</p>
        </details>

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
        ) : (
          <div className="mj-studio-simulation-unavailable" role="alert">
            <p>{copy.cpuUnavailable(eligibility.reason)}</p>
            {/* The browser lane can only run circuits its bounded parser can
                rebuild, which is the Studio builder's own twelve-gate shape —
                so ordinary Qiskit with transpile/AerSimulator, loops, or helper
                functions never qualifies, which is nearly everything a run
                produces. That was a dead end with no next step on the screen.
                The sandbox runs the exact source instead, including whatever
                error it raises, which is the outcome a user asking "why won't
                this simulate" actually wants. */}
            {onRunInSandbox ? (
              <>
                <p>{copy.sandboxFallbackExplainer}</p>
                <button className="mj-primary-button" type="button" disabled={sandboxBusy} onClick={onRunInSandbox}>
                  {sandboxBusy ? copy.starting : copy.runInSandbox}
                </button>
              </>
            ) : null}
          </div>
        )}
        </div>

        {/* The GPU lane is listed because it is a lane, and it says exactly what
            is true of it — a provider is being arranged and nothing is wired to
            it yet (Owner Inbox 2026-07-31). What it deliberately does NOT have
            is a run button: an earlier version of this lane was a control that
            existed only to be disabled, which was removed for being a promise
            the screen could not keep. A named status is information; a dead
            button is a lie. The control appears with the provider. */}
        <div className="mj-studio-lane" data-state="pending">
          <div className="mj-studio-lane-head">
            <span className="mj-studio-lane-title">{copy.gpuLane}</span>
            <span className="mj-mono-muted">{copy.gpuPending}</span>
          </div>
          <p>{copy.gpuExplainer}</p>
        </div>

        <div className="mj-studio-lane">
          <QpuLane artifact={artifact} shots={shots} copy={copy} />
        </div>

        <section className="mj-studio-simulation-records" aria-label={copy.simulationResults}>
          <div className="mj-studio-simulation-records-head"><span className="mj-section-label">{copy.simulationResults}</span><span className="mj-mono-muted">{records.length}</span></div>
          {records.length ? records.map((record) => <SimulationRecordCard record={record} family={artifact?.family ?? null} copy={copy} key={record.id} />) : <p className="mj-studio-empty">{copy.simulationNoRecords}</p>}
        </section>
      </div>
    </section>
  );
}

function SimulationRecordCard({ record, family, copy }: { record: CpuSimulationRecord; family: string | null; copy: StudioCopy }) {
  const data = simulationChartData(record.counts, record.shots);
  const reading = data ? simulationReading(family, data) : null;
  return (
    <article className="mj-studio-simulation-record">
      <div className="mj-studio-simulation-record-head"><strong>{copy.simulationRecord}</strong><span className="mj-mono-muted">{record.createdAt}</span></div>
      {data ? (
        <>
          <div className="mj-sim-headline">
            <div className="mj-sim-headline-stat">
              <span className="mj-section-label">{copy.simulationPeak}</span>
              <strong><code>|{data.peak.bitstring}⟩</code> · {formatShare(data.peak.share, "en-US")}</strong>
            </div>
            <span className="mj-mono-muted">{copy.simulationRecordSummary(record.shots.toLocaleString("en-US"), record.qubitCount)}</span>
          </div>
          {reading ? <p className="mj-sim-reading">{simulationReadingText(reading, copy)}</p> : null}
          <SimulationDistribution data={data} copy={copy} />
        </>
      ) : null}
      <details className="mj-sim-details">
        <summary>{copy.simulationDetails}</summary>
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
        <div className="mj-studio-simulation-counts"><span className="mj-section-label">{copy.resultCounts}</span><code>{Object.entries(record.counts).sort(([, left], [, right]) => right - left).map(([bitstring, count]) => `${bitstring}: ${count}`).join("\n")}</code></div>
      </details>
    </article>
  );
}

function QpuLane({ artifact, shots, copy }: { artifact: LibraryArtifact | null; shots: string; copy: StudioCopy }) {
  const [backends, setBackends] = useState<QpuBackendInfo[] | null>(null);
  const [gate, setGate] = useState<QpuSubmissionGate | null>(null);
  const [catalogError, setCatalogError] = useState(false);
  const [selected, setSelected] = useState("");
  const [estimate, setEstimate] = useState<QpuCostEstimate | null>(null);
  const [estimateError, setEstimateError] = useState(false);
  const [estimating, setEstimating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [qpuRun, setQpuRun] = useState<QpuRunRecord | null>(null);

  const parsedShots = Number.parseInt(shots, 10);
  const shotCount = Number.isInteger(parsedShots) && parsedShots >= 1 && parsedShots <= MAX_CPU_SHOTS ? parsedShots : 1024;

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchQpuBackends(), fetchQpuSubmissionGate()])
      .then(([backendList, submissionGate]) => {
        if (cancelled) return;
        setBackends(backendList);
        setGate(submissionGate);
        setSelected((current) => current || backendList[0]?.device_id || "");
      })
      .catch(() => {
        if (!cancelled) setCatalogError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setEstimating(true);
    setEstimateError(false);
    fetchQpuEstimate(selected, shotCount)
      .then((result) => {
        if (!cancelled) setEstimate(result);
      })
      .catch(() => {
        if (!cancelled) {
          setEstimate(null);
          setEstimateError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setEstimating(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, shotCount]);

  const backend = backends?.find((item) => item.device_id === selected) ?? null;
  const verified = artifact?.status === "verified" || artifact?.status === "verified_caveats";
  // Only a stored interchange program is submittable: the qasm field also
  // carries human-readable availability notes for artifacts without one.
  const submittableQasm = artifact?.qasm && looksLikeOpenQasm3(artifact.qasm) ? artifact.qasm : null;
  const canSubmit = Boolean(
    gate?.submission_available && verified && submittableQasm && selected && !submitting,
  );

  function startHardwareSubmission() {
    if (!submittableQasm || !selected) return;
    setSubmitting(true);
    setSubmitError(null);
    submitQpuRun({
      device_id: selected,
      shots: shotCount,
      qasm: submittableQasm,
      source_fingerprint: sourceFingerprint(submittableQasm),
    })
      .then(setQpuRun)
      .catch((cause: unknown) => {
        setSubmitError(cause instanceof Error ? cause.message : copy.hardwareEstimateFailed);
      })
      .finally(() => setSubmitting(false));
  }

  // A submitted job settles on the provider's schedule; poll the durable
  // record until it reports a terminal state.
  useEffect(() => {
    if (!qpuRun || qpuRun.status === "done" || qpuRun.status === "error" || qpuRun.status === "cancelled") return;
    const timer = window.setInterval(() => {
      fetchQpuRun(qpuRun.id)
        .then((next) => setQpuRun(next))
        .catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [qpuRun]);

  return (
    <div className="mj-qpu-lane">
      {/* Was a permanently disabled button, sitting directly above the device
          picker and submit control that DO work — so the lane read as switched
          off while its real flow was live underneath. It was only ever a label;
          it is one now. */}
      <span className="mj-qpu-lane-title">{copy.qpuExecution}</span>
      {catalogError ? <p>{copy.hardwareCatalogUnavailable}</p> : null}
      {!catalogError && !backends ? <p>{copy.hardwareCatalogLoading}</p> : null}
      {backends && backends.length ? (
        <div className="mj-qpu-flow">
          <label className="mj-studio-field">
            <span>{copy.hardwareDevice}</span>
            <select value={selected} onChange={(event) => setSelected(event.target.value)}>
              {backends.map((item) => <option value={item.device_id} key={item.device_id}>{item.display_name}</option>)}
            </select>
          </label>
          {backend ? (
            <div className="mj-qpu-estimate">
              <span className="mj-mono-muted">{backend.access === "free_queue" ? copy.hardwareAccessFree : `${copy.hardwareAccessOnDemand} · ${copy.hardwareRateConfirmed(backend.rate_confirmed_on)}`}</span>
              {estimating ? <p>{copy.hardwareEstimating}</p> : null}
              {estimateError ? <p role="alert">{copy.hardwareEstimateFailed}</p> : null}
              {estimate && !estimating ? (
                estimate.basis === "vendor_rate_card" ? (
                  <>
                    <dl className="mj-studio-contract">
                      <div><dt>{copy.hardwareTaskFee}</dt><dd>{estimate.task_fee_usd !== null ? formatUsd(estimate.task_fee_usd) : "—"}</dd></div>
                      <div><dt>{copy.hardwareShotFees(estimate.shots.toLocaleString("en-US"))}</dt><dd>{estimate.shot_fees_usd !== null ? formatUsd(estimate.shot_fees_usd) : "—"}</dd></div>
                      <div><dt>{copy.hardwareEstimatedTotal}</dt><dd><strong>{estimate.total_usd !== null ? formatUsd(estimate.total_usd) : "—"}</strong></dd></div>
                    </dl>
                    <p className="mj-qpu-disclaimer">{estimate.disclaimer}</p>
                  </>
                ) : (
                  <p className="mj-qpu-disclaimer">{estimate.allowance_note}</p>
                )
              ) : null}
              <p className="mj-qpu-source"><a href={backend.rate_source} target="_blank" rel="noreferrer">{copy.hardwareRateSource} ↗</a></p>
            </div>
          ) : null}
          <button
            className="mj-primary-button"
            type="button"
            disabled={!canSubmit}
            title={gate && !gate.submission_available ? copy.hardwareBlockedReason(gate.blocked_reason ?? "") : undefined}
            onClick={startHardwareSubmission}
          >
            {submitting ? copy.starting : copy.hardwareRequestSubmission}
          </button>
          {!verified ? <p className="mj-qpu-note">{copy.hardwareVerifiedRequired}</p> : null}
          {verified && !submittableQasm ? <p className="mj-qpu-note">{copy.hardwareInterchangeRequired}</p> : null}
          {gate && !gate.submission_available ? <p className="mj-qpu-note">{copy.hardwareBlockedReason(gate.blocked_reason ?? "")}</p> : null}
          {submitError ? <p className="mj-qpu-note" role="alert">{submitError}</p> : null}
          {qpuRun ? (
            <div className="mj-qpu-record" role="status">
              <dl className="mj-studio-contract">
                <div><dt>{copy.hardwareJobStatus}</dt><dd>{qpuRun.status}</dd></div>
                {qpuRun.provider_job_id ? <div><dt>{copy.hardwareJobId}</dt><dd>{qpuRun.provider_job_id}</dd></div> : null}
                {qpuRun.error ? <div><dt>{copy.hardwareJobError}</dt><dd>{qpuRun.error}</dd></div> : null}
              </dl>
              {qpuRun.raw_counts ? (
                <div className="mj-studio-simulation-counts">
                  <span className="mj-section-label">{copy.hardwareRawCounts}</span>
                  <code>{Object.entries(qpuRun.raw_counts).sort(([, left], [, right]) => right - left).map(([bitstring, count]) => `${bitstring}: ${count}`).join("\n")}</code>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SimulationDistribution({ data, copy }: { data: SimulationChartData; copy: StudioCopy }) {
  const totalShots = data.bars.reduce((sum, bar) => sum + bar.count, 0) + data.otherShots;
  return (
    <div className="mj-sim-chart">
      <span className="mj-section-label">{copy.simulationDistribution}</span>
      <div className="mj-sim-chart-rows">
        {data.bars.map((bar) => (
          <div
            className={bar.peak ? "mj-sim-chart-row is-peak" : "mj-sim-chart-row"}
            title={`|${bar.bitstring}⟩ · ${bar.count.toLocaleString("en-US")} / ${totalShots.toLocaleString("en-US")} · ${formatShare(bar.share, "en-US")}`}
            key={bar.bitstring}
          >
            <code>{bar.bitstring}</code>
            <span className="mj-sim-chart-track"><span className="mj-sim-chart-fill" style={{ width: `${Math.max(bar.share * 100, 0.75)}%` }} /></span>
            <span className="mj-sim-chart-value">{formatShare(bar.share, "en-US")}</span>
          </div>
        ))}
        {data.otherStates ? (
          <div className="mj-sim-chart-row is-other" title={`${copy.simulationOtherBar(data.otherStates)} · ${data.otherShots.toLocaleString("en-US")} / ${totalShots.toLocaleString("en-US")}`}>
            <code>…</code>
            <span className="mj-sim-chart-track"><span className="mj-sim-chart-fill" style={{ width: `${Math.max((data.otherShots / totalShots) * 100, 0.75)}%` }} /></span>
            <span className="mj-sim-chart-value">{copy.simulationOtherBar(data.otherStates)}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function simulationReadingText(reading: SimulationReading, copy: StudioCopy): string {
  if (reading.kind === "concentrated") return copy.readingConcentrated(reading.peak.bitstring, formatShare(reading.peak.share, "en-US"));
  if (reading.kind === "paired") return copy.readingPaired(reading.first.bitstring, reading.second.bitstring, formatShare(reading.combinedShare, "en-US"));
  return copy.readingSpread(reading.distinctStates, reading.peak.bitstring, formatShare(reading.peak.share, "en-US"));
}

function simulationModelLabel(model: CpuSimulationRecord["model"], copy: StudioCopy): string {
  return model === "direct_source" ? copy.directSourceModel : copy.standardDecompositionModel;
}

/** What this circuit is, what was proved about it, and which versions exist.
 *
 * This is the old Versions tab with the evidence it was always missing. A
 * version list without a verdict beside it answers a question nobody was
 * asking: the reason to open a version history here is to find out whether the
 * current version is trustworthy, and until now that meant leaving for the
 * Vault. The run contract came from the inspector for the same reason — it
 * describes what the next Verify & save will do, which is a fact about this
 * artifact's evidence, not a control.
 *
 * `checks` is populated when a version has been opened in the Vault; absent is
 * "not loaded here", not "nothing was checked", and the copy says so rather
 * than implying an empty list means an empty panel.
 */
function SummaryPanel({
  artifact,
  runId,
  stale,
  state,
  copy,
  locale,
  onRestored,
}: {
  artifact: LibraryArtifact | null;
  runId: string | null;
  stale: boolean;
  state: ReturnType<typeof studioVerificationDisplayState>;
  copy: StudioCopy;
  locale: PublicLocale;
  onRestored: (seq: number) => void;
}) {
  const checks: VerificationCheck[] = artifact?.checks ?? [];
  return (
    <section className="mj-studio-surface mj-studio-version-panel" aria-label={copy.summary} {...panelRegion("studio", "summary")}>
      <div className="mj-studio-surface-head">
        <div>
          <span className="mj-section-label">{copy.summary}</span>
          <h2>{artifact ? artifact.title : copy.newDraftSource}</h2>
        </div>
        <span className="mj-mono-muted">{artifact?.framework ?? ""}</span>
      </div>

      <div className="mj-studio-summary-section">
        <span className="mj-section-label">{copy.evidence}</span>
        <VerificationSummaryPanel summary={artifact?.verificationSummary ?? null} state={state} />
        {artifact?.criticSummary ? <p className="mj-studio-evidence-summary">{artifact.criticSummary}</p> : null}
        {artifact ? (
          checks.length ? (
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
          )
        ) : null}
        {artifact?.id ? <p><a href={`/library/${encodeURIComponent(artifact.id)}`}>{copy.openFullRecord}</a></p> : null}
      </div>

      <div className="mj-studio-summary-section">
        <span className="mj-section-label">{copy.versionHistory}</span>
        {stale ? <div className="mj-studio-version-row"><span className="mj-studio-version-dot is-pending" /><div><strong>{copy.uncommittedEdits}</strong><p>{copy.uncommittedEditsNote}</p></div></div> : null}
        {runId ? <div className="mj-studio-version-row"><span className="mj-studio-version-dot is-pending" /><div><strong>{copy.verificationQueued}</strong><p><a href={`/run/${runId}`}>{runId.slice(0, 12)}</a> · {copy.verificationAttach(runId.slice(0, 12))}</p></div></div> : null}
        {artifact ? (
          <VersionHistory artifact={artifact} copy={copy} locale={locale} onRestored={onRestored} />
        ) : (
          <div className="mj-studio-version-row"><span className="mj-studio-version-dot" /><div><strong>{copy.draftNotSaved}</strong><p>{copy.draftVersionNote}</p></div></div>
        )}
      </div>

      <details className="mj-sim-details">
        <summary>{copy.runContract}</summary>
        <dl className="mj-studio-contract">
          <div><dt>{copy.mode}</dt><dd>{copy.execute}</dd></div>
          <div><dt>{copy.source}</dt><dd>{artifact ? copy.existingVersion : copy.newDraftSource}</dd></div>
          <div><dt>{copy.evidence}</dt><dd>{copy.sandboxVerifier}</dd></div>
        </dl>
      </details>
    </section>
  );
}

function originLabel(origin: VersionOrigin, copy: StudioCopy): string {
  if (origin === "agent_run") return copy.versionOriginAgentRun;
  if (origin === "studio_draft") return copy.versionOriginStudioDraft;
  if (origin === "imported_reference") return copy.versionOriginImportedReference;
  if (origin === "starter_example") return copy.versionOriginStarterExample;
  return copy.versionOriginUnknown;
}

function capabilityLabel(loss: RestoreLoss, copy: StudioCopy): string {
  if (loss === "qasm") return copy.capabilityQasm;
  if (loss === "export") return copy.capabilityExport;
  if (loss === "resource_estimates") return copy.capabilityResourceEstimates;
  if (loss === "framework_variants") return copy.capabilityFrameworkVariants;
  return copy.capabilityVerification;
}

/** What a row HOLDS, in the same words the restore warning uses for losing it. */
function heldCapabilities(row: ArtifactVersionSummary, copy: StudioCopy): string[] {
  const held: string[] = [];
  if (row.hasQasm) held.push(copy.capabilityQasm);
  if (row.exportable) held.push(copy.capabilityExport);
  if (row.hasResourceEstimates) held.push(copy.capabilityResourceEstimates);
  if (row.hasFrameworkVariants) held.push(copy.capabilityFrameworkVariants);
  if (row.verified) held.push(copy.capabilityVerification);
  return held;
}

/**
 * The artifact's versions, and the way back to one of them.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not read "current" from the top of the list. Restoring moves
 * `artifacts.current_version_id` and writes no row, so the current version is
 * frequently not the newest `seq`; the server flags it and this reads the flag.
 *
 * It does not present versions as equivalent. A version the user typed in
 * Studio has no OpenQASM, no exports, no estimates and no verdict — restoring
 * one over a verified run is a real loss, so each row states what it holds and
 * a lossy restore has to be confirmed against a list of what goes.
 */
function VersionHistory({
  artifact,
  copy,
  locale,
  onRestored,
}: {
  artifact: LibraryArtifact;
  copy: StudioCopy;
  locale: PublicLocale;
  onRestored: (seq: number) => void;
}) {
  const [rows, setRows] = useState<ArtifactVersionSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [nextBeforeSeq, setNextBeforeSeq] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<{ row: ArtifactVersionSummary; losses: RestoreLoss[] } | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const artifactId = artifact.id;
  // Keyed on the current version too: after a restore the pointer moved, so
  // every row's `is_current` and `restore_losses` are stale.
  const currentVersionId = artifact.currentVersionId ?? null;

  useEffect(() => {
    let active = true;
    setRows(null);
    setFailed(false);
    void fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/versions`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("version history unavailable");
        return (await response.json()) as unknown;
      })
      .then((payload) => {
        if (!active) return;
        const page = versionPageFromResource(payload);
        setRows(page.versions);
        setNextBeforeSeq(page.nextBeforeSeq);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [artifactId, currentVersionId]);

  async function loadOlder() {
    if (nextBeforeSeq === null) return;
    const response = await fetch(
      `/api/artifacts/${encodeURIComponent(artifactId)}/versions?before_seq=${nextBeforeSeq}`,
      { cache: "no-store" },
    );
    if (!response.ok) {
      setFailed(true);
      return;
    }
    const page = versionPageFromResource(await response.json());
    setRows((current) => [...(current ?? []), ...page.versions]);
    setNextBeforeSeq(page.nextBeforeSeq);
  }

  async function restore(row: ArtifactVersionSummary, acknowledged: boolean) {
    if (restoring) return;
    setRestoring(row.id);
    setRestoreError(null);
    try {
      const response = await fetch(
        `/api/artifacts/${encodeURIComponent(artifactId)}/versions/${encodeURIComponent(row.id)}/restore`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acknowledge_capability_loss: acknowledged }),
        },
      );
      if (response.status === 409) {
        // The list said this restore was free but the artifact moved under us.
        // Ask, with the server's list — never resend acknowledged on its behalf.
        const losses = restoreRefusalLosses(await response.json());
        if (losses) {
          setConfirming({ row, losses });
          return;
        }
        throw new Error("restore refused");
      }
      if (!response.ok) throw new Error("restore failed");
      setConfirming(null);
      onRestored(row.seq);
    } catch {
      setRestoreError(copy.restoreFailed);
    } finally {
      setRestoring(null);
    }
  }

  if (failed) return <p className="mj-mono-muted" role="alert">{copy.versionHistoryUnavailable}</p>;
  if (rows === null) return <p className="mj-mono-muted" role="status">{copy.versionHistoryLoading}</p>;
  if (!rows.length) return <p className="mj-mono-muted">{copy.versionHistoryEmpty}</p>;

  return (
    <>
      {restoreError ? <p role="alert" className="mj-delete-dialog-error">{restoreError}</p> : null}
      {rows.map((row) => {
        const held = heldCapabilities(row, copy);
        return (
          <div className="mj-studio-version-row" key={row.id}>
            <span className={`mj-studio-version-dot${row.isCurrent ? "" : " is-past"}`} />
            <div>
              <span className="mj-studio-version-meta">
                <strong>{copy.versionLabel(row.seq)}</strong>
                {row.isCurrent ? <span className="mj-mono-muted">{copy.versionCurrentBadge}</span> : null}
                <span className="mj-mono-muted">{originLabel(row.origin, copy)}</span>
              </span>
              <p>
                {held.length ? `${copy.versionHolds}: ${held.join(" · ")}` : copy.versionHoldsNothing}
              </p>
              {row.createdAt ? (
                <p className="mj-mono-muted">
                  {new Date(row.createdAt).toLocaleDateString(locale === "ja" ? "ja-JP" : "en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              ) : null}
            </div>
            {row.isCurrent ? null : (
              <button
                className="mj-secondary-button"
                type="button"
                disabled={restoring !== null}
                onClick={() => {
                  // A lossy restore opens the dialog straight from the list's
                  // own loss codes; the server still refuses an unacknowledged
                  // one, so this is a faster path to the same gate, not a
                  // replacement for it.
                  if (row.restoreLosses.length) setConfirming({ row, losses: row.restoreLosses });
                  else void restore(row, false);
                }}
              >
                {restoring === row.id ? copy.restoring : copy.restore}
              </button>
            )}
          </div>
        );
      })}
      {nextBeforeSeq !== null ? (
        <button className="mj-secondary-button" type="button" onClick={() => void loadOlder()}>
          {copy.versionShowOlder}
        </button>
      ) : null}
      {confirming ? (
        <div
          className="mj-delete-dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setConfirming(null);
          }}
        >
          <section className="mj-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="mj-restore-dialog-title">
            <p className="mj-eyebrow">{copy.versionHistory}</p>
            <h2 id="mj-restore-dialog-title">{copy.restoreConfirmTitle}</h2>
            <p>{copy.restoreConfirmBody(confirming.row.seq)}</p>
            {confirming.losses.length ? (
              <>
                <p>{copy.restoreLossIntro}</p>
                <ul>
                  {confirming.losses.map((loss) => (
                    <li key={loss}>{capabilityLabel(loss, copy)}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {restoreError ? <p role="alert" className="mj-delete-dialog-error">{restoreError}</p> : null}
            <div className="mj-delete-dialog-actions">
              <button className="mj-secondary-button" type="button" onClick={() => setConfirming(null)}>
                {copy.restoreCancel}
              </button>
              <button
                className="mj-danger-button"
                type="button"
                disabled={restoring !== null}
                onClick={() => void restore(confirming.row, true)}
              >
                {restoring ? copy.restoring : copy.restoreConfirmAnyway}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

/** Never the bare word "Verified" for a structural pass — that conflation is what
 * the Vault list was fixed for, and Studio must not reintroduce it. */
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
    artifact.verificationSummary = verificationFromResource(version) ?? artifact.verificationSummary ?? null;
    artifact.status = statusFromVerificationSummary(artifact.verificationSummary);
  }
  return artifact;
}


function makeDraftBundle(artifact: LibraryArtifact | null, copy: StudioCopy): DraftBundle {
  if (!artifact) return { codes: { ...STARTER_CODES }, notes: {}, fallbacks: {} };
  return studioDraftBundle(artifact, copy);
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
