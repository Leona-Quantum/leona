"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type UIEvent } from "react";
import { useRouter } from "next/navigation";
import { SyntaxHighlightedCode, VerificationSummaryPanel, verificationHeadline } from "@majorana/ui";
import { CopyIcon, SearchIcon } from "../../../components/icons";
import { artifactFromResource, frameworkVariantsFromRemote, getLibraryArtifact, loadLibraryArtifacts, statusFromVerificationSummary, type LibraryArtifact } from "../../../lib/library-data";
import { refusalSentence, refusalStrings, submittedId } from "../../../lib/api-error.ts";
import { fetchArtifactPages } from "../../../lib/artifact-page";
import {
  ARTIFACT_PROJECTS_EVENT,
  loadArtifactProjects,
  type ArtifactProject,
} from "../../../lib/artifact-projects";
import {
  ALL_PROJECTS,
  discoveryTabs,
  filterDiscoveryArtifacts,
  projectOf,
  sameFilter,
  surviveProjectChange,
  type ProjectFilter,
} from "../../../lib/studio-discovery";
import type { PublicLocale } from "../../../lib/public-locale";
import { ANGLE_GATES, BUILDER_GATES, builderGateArity, builderStepLabel, createBuilderStepId, customGateUsageCount, generateBuilderCode, ungroupCustomGateStep, type BuilderCodeVariants, type BuilderGate, type BuilderStep, type BuiltinBuilderGate, type CustomGateDefinition } from "../../../lib/studio-builder";
import { popStudioHistory, pushStudioHistory, type StudioHistorySnapshot } from "../../../lib/studio-history";
import { EditBlockPanel } from "./studio-edit-block-panel";
import { BLOCK_TEMPLATES, instantiateBlock, validateBlockParams, type BlockParams, type BlockTemplate } from "../../../lib/circuit-blocks";
import { BlocksPanel } from "./studio-blocks-panel";
import { workedExample, type WorkedExample } from "../../../lib/worked-examples";
import { cloneWorkedExampleDraft } from "../../../lib/studio-example-draft";
import { importedArtifactHref } from "../../../lib/atlas-studio-import";
import { ExampleGallery } from "./studio-example-gallery";
import { ExampleNotesPanel } from "./studio-example-notes-panel";
import { circuitChangeSummary, type CircuitChangeSummary } from "../../../lib/circuit-change-summary";
import { AskLeonaBox } from "./studio-ask-leona";
import { QpuMeasuredVsIdeal } from "./qpu-measured-vs-ideal";
import { QpuNoisyPreview } from "./qpu-noisy-preview";
import { loadStoredCircuit, saveStoredCircuit } from "../../../lib/studio-circuits";
import { circuitSyncState, type CircuitSyncState } from "../../../lib/studio-sync";
import { looksLikeOpenQasm3, parseCircuitSource, parseInterchangeCircuit, reconstructInterchangeCircuit } from "../../../lib/circuit-conversion";
import { circuitIRDiagram, circuitIRFromMetadata, validateCircuitIR, type CircuitIRReadOnlyReason } from "../../../lib/circuit-ir";
import { canvasSeedCandidates, draftSourceFramework, studioDraftBundle, type StudioDraftBundle } from "../../../lib/studio-drafts";
import { CircuitDiagram, type CircuitDiagramInspection } from "../../../components/circuit-diagram";
import { MAX_VIEWABLE_QUBITS, MAX_VIEWABLE_STEPS, type ParsedBuilderCircuit } from "../../../lib/studio-parse";
import { CIRCUIT_FRAMEWORKS, circuitFramework, circuitFrameworkOrNull, isExecutableCircuitFramework, type CircuitFrameworkKey } from "../../../lib/circuit-frameworks";
import { MAX_CPU_SEED, MAX_CPU_SHOTS, cpuSimulationEligibility, cpuSimulationRecord, loadCpuSimulationRecords, planCpuSimulation, saveCpuSimulationRecord, sourceFingerprint, type CpuSimulationEligibility, type CpuSimulationLimits, type CpuSimulationRecord } from "../../../lib/studio-simulation";
import { simulator } from "../../../lib/simulator-client";
import { CpuRunSlot } from "../../../lib/studio-cpu-run";
import { TIER_LIMITS } from "../../../lib/account-tier";
import { formatShare, simulationChartData, simulationReading, type SimulationChartData, type SimulationReading } from "../../../lib/simulation-visual";
import { QPU_RUN_POLL_MS, QpuSubmissionRefused, afterRestore, backendNameOf, fetchLatestQpuRunFor, fetchQpuBackends, fetchQpuEstimate, fetchQpuRun, fetchQpuSubmissionGate, formatUsd, isPricedOnly, isUnfinishedRun, runForCircuit, submitQpuRun, type QpuBackendInfo, type QpuCostEstimate, type QpuRunRecord, type QpuSubmissionGate } from "../../../lib/qpu";
import { ZNE_SCALE_FACTORS } from "../../../lib/qpu-mitigation";
import { WORKSPACE_COPY } from "../../../lib/workspace-locale";
import { DEFAULT_RUN_SHOTS, sampling } from "../../../lib/studio-run-request";
import { verificationFromMetadata, verificationFromResource, type VerificationCheck } from "../../../lib/verification-record";
import { artifactExportManifest } from "../../../lib/artifact-export";
import { restoreRefusalLosses, versionPageFromResource, type ArtifactVersionSummary, type RestoreLoss, type VersionOrigin } from "../../../lib/artifact-versions";
import { studioVerificationDisplayState } from "../../../lib/verification-display";
import { DEFAULT_STUDIO_PANEL, STUDIO_PANELS, type StudioPanel } from "../../../lib/studio-panels";
import { circuitCompressionMetrics, circuitStepSignature, compressCircuit, type CircuitCompressionStrategy } from "../../../lib/studio-compression";
import {
  builderStepsFromExternalResult,
  circuitOptimizationRequest,
  externalOptimizationResultFromEvent,
  type CircuitOptimizationResult,
  type ExternalCircuitCompiler,
} from "../../../lib/studio-external-compression";
import {
  SYNTHESIS_CONNECTIVITIES,
  SYNTHESIS_OBJECTIVES,
  builderStepsFromSynthesisCandidate,
  isApplicable as isSynthesisCandidateApplicable,
  objectiveMetric,
  synthesisRequest,
  synthesisResultEventFromEvent,
  type SynthesisCandidate,
  type SynthesisConnectivity,
  type SynthesisObjective,
  type SynthesisResult,
  type SynthesisTarget,
} from "../../../lib/studio-synthesis";
import { PanelTabs, panelRegion } from "../../../components/panel-tabs";
import { CommentsPanel } from "../../../components/comments-panel";
import { COMMENTS_ANCHOR, isCommentableId } from "../../../lib/comments";
import { circuitMoments } from "../../../lib/circuit-moments";
import { gateFamily, type GateFamily } from "../../../lib/gate-inspector";
import { gateShortcutKey, isTypingTarget, studioShortcut } from "../../../lib/studio-shortcuts";
import { insertBeforeTrailingMeasurements } from "../../../lib/studio-placement";
import { GateInspectorCard } from "./studio-gate-inspector";
import { PlayheadPanel } from "./studio-playhead";
import { StudioParameterSweep } from "./studio-parameter-sweep";
import { ShortcutSheet } from "./studio-shortcut-sheet";

// Tab order is the working order: you write code, you run it, you look at what
// you wrote, and then you read what the run said about it (Owner Inbox
// 2026-07-31). "visual" was "canvas" and "summary" absorbed the old "versions"
// tab, because a version list with no verdict beside it was never the thing
// anyone opened it for. The list itself lives in lib/studio-panels so the order
// can be asserted as a sequence.
type StudioAction = "simulation" | "save" | "bring" | "qapp";
/** Panels that can be thrown full-screen. Both are things you look at closely. */
type StudioPopout = "code" | "visual";

type BuilderSeed = {
  key: string;
  artifactIdentity: string | null;
  qubitCount: number;
  steps: BuilderStep[];
  customGates: CustomGateDefinition[];
  readOnly: boolean;
  readOnlyReasons: CircuitIRReadOnlyReason[];
  operationCount: number;
};

type ArtifactHydration = "loading" | "ready" | "error";

const EMPTY_SEED: Omit<BuilderSeed, "key"> = {
  artifactIdentity: null,
  qubitCount: 2,
  steps: [],
  customGates: [],
  readOnly: false,
  readOnlyReasons: [],
  operationCount: 0,
};

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
/** The simulator consumer Studio's CPU run asks under (lib/simulator-client.ts). */
const STUDIO_CPU_RUN = "studio-cpu-run";

const STARTER_SEED: Omit<BuilderSeed, "key"> = {
  artifactIdentity: null,
  qubitCount: 2,
  steps: STARTER_STEPS,
  customGates: [],
  readOnly: false,
  readOnlyReasons: [],
  operationCount: STARTER_STEPS.length,
};

export function StudioWorkspace({ artifactId, newDraft = false, exampleId, atlasSlug, locale = "en", limits = TIER_LIMITS.free }: { artifactId?: string; newDraft?: boolean; exampleId?: string; atlasSlug?: string; locale?: PublicLocale; limits?: CpuSimulationLimits }) {
  const copy = WORKSPACE_COPY[locale].studio;
  const [artifacts, setArtifacts] = useState<LibraryArtifact[]>([]);
  const [artifact, setArtifact] = useState<LibraryArtifact | null>(null);
  const [showEditor, setShowEditor] = useState(Boolean(artifactId || newDraft || exampleId || atlasSlug));
  const [activeExample, setActiveExample] = useState<WorkedExample | null>(null);
  const [showGallery, setShowGallery] = useState(false);
  const [askChangeSummary, setAskChangeSummary] = useState<CircuitChangeSummary | null>(null);
  const [askBackup, setAskBackup] = useState<{
    artifact: LibraryArtifact | null;
    builderSeed: BuilderSeed;
    title: string;
    drafts: BuilderCodeVariants;
    framework: StudioFramework;
    activeExample: WorkedExample | null;
  } | null>(null);
  const [query, setQuery] = useState("");
  // The workspace's projects, read from the mirror the sidebar hydrates rather
  // than fetched again here. `hydrateArtifactProjects` ends in
  // `replaceArtifactProjects`, which emits ARTIFACT_PROJECTS_EVENT — this page
  // listens for that and never calls hydrate itself, which is what keeps the
  // two surfaces from taking turns refreshing each other forever.
  const [artifactProjects, setArtifactProjects] = useState<ArtifactProject[]>([]);
  const [projectFilter, setProjectFilter] = useState<ProjectFilter>(ALL_PROJECTS);
  const [title, setTitle] = useState(copy.untitledCircuit);
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
  const router = useRouter();
  const [busy, setBusy] = useState<StudioAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [qappPrompt, setQappPrompt] = useState("");
  const [simulationRecords, setSimulationRecords] = useState<CpuSimulationRecord[]>([]);
  const [rerunPending, setRerunPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [popout, setPopout] = useState<StudioPopout | null>(null);
  /** Code beside the diagram, on the Visual tab (UX pass 6). */
  const [split, setSplit] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

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
  // A Mentions link ends in `#comments` (lib/comments.ts `targetHref`), and the
  // thread lives on the Summary tab, so arriving that way opens Summary rather
  // than leaving the reader on Code looking for it.
  useEffect(() => {
    if (window.location.hash === COMMENTS_ANCHOR) setPanel("summary");
  }, []);
  // Strings, not numbers: an empty seed field means "let the planner choose" and
  // a number state would have to encode that as 0, which is a valid seed.
  const [shots, setShots] = useState(String(DEFAULT_RUN_SHOTS));
  const [seed, setSeed] = useState("");
  const [artifactHydration, setArtifactHydration] = useState<ArtifactHydration>(() => (artifactId || atlasSlug) && !newDraft ? "loading" : "ready");
  const [artifactSyncError, setArtifactSyncError] = useState(false);
  const [artifactsLoading, setArtifactsLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
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

  // The project mirror, after mount and on every change the sidebar makes.
  //
  // Its own effect with no dependencies, because it must not be torn down and
  // rebuilt when the route's artifact changes: creating a project in the rail
  // while a circuit is open has to reach this list, and a listener that
  // remounted on `artifactId` would still work but would re-read storage for
  // no reason on every navigation.
  useEffect(() => {
    const read = () => {
      const projects = loadArtifactProjects();
      setArtifactProjects(projects);
      // A project deleted from the rail while its tab is selected would
      // otherwise pin this pane to an id nothing matches — an empty list under
      // a tab that is no longer in the row, over circuits that still exist.
      setProjectFilter((current) => {
        const survived = surviveProjectChange(current, projects);
        return sameFilter(survived, current) ? current : survived;
      });
    };
    read();
    window.addEventListener(ARTIFACT_PROJECTS_EVENT, read);
    return () => window.removeEventListener(ARTIFACT_PROJECTS_EVENT, read);
  }, []);

  // Local storage is read only after mount so the server and client render
  // the same initial markup; the artifact then hydrates through applyArtifact.
  useEffect(() => {
    let active = true;
    setArtifacts(loadLibraryArtifacts());
    setArtifactSyncError(false);
    setArtifactsLoading(true);
    setArtifactHydration((artifactId || atlasSlug) && !newDraft ? "loading" : "ready");
    // Paged, not a single fetch: an un-paged read returns the route's default
    // of 50 rows and is indistinguishable from a workspace that holds 50. Studio
    // is now the only surface over these rows, so a truncated list here is the
    // whole list as far as the person is concerned. See lib/artifact-page.ts.
    void fetchArtifactPages((query) => fetch(`/api/artifacts${query}`, { cache: "no-store" }))
      .then(({ rows: payload }) => {
        if (!active) return;
        const remote = payload.flatMap((value) => artifactFromResource(value));
        const byId = new Map([...loadLibraryArtifacts(), ...remote].map((item) => [item.id, item]));
        setArtifacts([...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
      })
      .catch(() => {
        if (active) setArtifactSyncError(true);
      })
      .finally(() => { if (active) setArtifactsLoading(false); });

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
    } else if (atlasSlug) {
      // A signed-out "Add to Studio" click, honoured after sign-in: the record
      // page sent the reader here rather than to the page-wide sign-in return
      // (/run). The import is the same POST the signed-in button makes; on
      // success the URL becomes the new artifact's, so a reload or a shared
      // link never imports twice. `replace`, not `push`: Back should leave
      // Studio, not re-run the import.
      void fetch(`/api/repository/${encodeURIComponent(atlasSlug)}/export`, { method: "POST", cache: "no-store" })
        .then(async (response) => {
          const payload = (await response.json()) as { id?: string; error?: string };
          if (!response.ok || typeof payload.id !== "string") throw new Error(payload.error ?? copy.atlasImportFailed);
          return payload.id;
        })
        .then((id) => {
          if (active) router.replace(importedArtifactHref(id));
        })
        .catch((cause: unknown) => {
          if (!active) return;
          setArtifactHydration("error");
          setMessage(cause instanceof Error && cause.message ? cause.message : copy.atlasImportFailed);
        });
    } else if (exampleId) {
      const example = workedExample(exampleId);
      if (example) applyExample(example);
      else {
        // An unknown id gives a normal new draft plus a short notice, rather
        // than an empty page with no explanation.
        setArtifactHydration("ready");
        setShowEditor(true);
        seedCounter.current += 1;
        seedBuilder({ key: `draft-${seedCounter.current}`, ...STARTER_SEED });
        setMessage(copy.exampleNotFound);
      }
    }
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyExample is stable by construction (module-scope helpers only)
  }, [artifactId, exampleId, atlasSlug, copy, loadAttempt]);

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
    // Circuit IR is a trusted observation of this exact stored version. Opaque
    // operations intentionally have no builder decomposition, so structural
    // comparison would erase them and call the faithful read-only view stale.
    if (builderSeed.readOnly && artifact?.code === code) return { kind: "in_sync" };
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
  }, [code, sourceFramework, canvasCircuit, artifact?.code, artifact?.qasm, builderSeed.readOnly]);

  const cpuEligibility = useMemo(() => cpuSimulationEligibility({
    artifactId: artifact?.id ?? "",
    code,
    framework: sourceFramework,
    qasm: artifact?.code === code ? artifact.qasm : null,
  }, limits), [artifact?.id, artifact?.code, artifact?.qasm, code, sourceFramework, limits]);

  // The header's one line about the circuit, and whether the newest CPU record
  // still describes the code on screen — the same fingerprint test the lane uses.
  const canvasMetrics = useMemo(() => circuitCompressionMetrics(canvasCircuit.steps), [canvasCircuit.steps]);
  const latestRecord = simulationRecords[0] ?? null;
  const cpuRunState: "none" | "current" | "stale" = !latestRecord
    ? "none"
    : cpuEligibility.eligible
      && latestRecord.sourceFingerprint === cpuEligibility.sourceFingerprint
      && latestRecord.interchangeFingerprint === cpuEligibility.interchangeFingerprint
      ? "current"
      : "stale";
  const splitOn = split && panel === "visual";

  // Live sync is offered only when nothing can be lost: every framework draft is
  // byte-for-byte what the current diagram generates, so regenerating after an
  // edit replaces generated text with generated text. Hand-edited or stored
  // native source never qualifies and keeps the explicit Apply and its
  // confirmation.
  // It also requires the structural check to agree, so "Live" is never shown
  // beside a banner saying the diagram no longer matches.
  const liveSync = useMemo(() => {
    if (!splitOn || builderSeed.readOnly || canvasSync.kind !== "in_sync") return false;
    const generated = generateBuilderCode(canvasCircuit.steps, canvasCircuit.qubitCount, canvasCircuit.customGates);
    const current: BuilderCodeVariants = { ...drafts, [framework]: code };
    return CIRCUIT_FRAMEWORKS.every(({ key }) => current[key] === generated[key]);
  }, [splitOn, builderSeed.readOnly, canvasSync.kind, canvasCircuit, drafts, framework, code]);

  // Tab, sheet, split and run keys. Gate keys belong to the builder, which
  // listens for them itself while it is on screen. See lib/studio-shortcuts.
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const shortcutsOpenRef = useRef(shortcutsOpen);
  shortcutsOpenRef.current = shortcutsOpen;
  const runCpuRef = useRef<() => void>(() => undefined);
  runCpuRef.current = () => void startCpuSimulation();
  // A CPU run answers later (it runs in the simulator worker), by which time
  // the reader may have opened another artifact. `cpuRuns` decides whether the
  // answer may still touch the page, and holds one run at a time, which `busy`
  // cannot do on its own: a second press of Run or its shortcut reaches the
  // handler before `busy` has rendered (lib/studio-cpu-run.ts).
  // `shownArtifactId` is the artifact on screen as of the latest render, which
  // an answer can arrive ahead of the effect below.
  const [cpuRuns] = useState(() => new CpuRunSlot());
  const shownArtifactId = useRef<string | null>(null);
  shownArtifactId.current = artifact?.id ?? null;
  const shownId = artifact?.id ?? null;
  useEffect(() => {
    // Another artifact is on screen: a run started on the last one is
    // abandoned, its job withdrawn, and Run released for this one.
    if (cpuRuns.show(shownId)) {
      simulator.cancel(STUDIO_CPU_RUN);
      setBusy((current) => (current === "simulation" ? null : current));
    }
  }, [cpuRuns, shownId]);
  // Studio going away abandons a run still in flight.
  useEffect(() => () => {
    if (cpuRuns.show(null)) simulator.cancel(STUDIO_CPU_RUN);
  }, [cpuRuns]);
  useEffect(() => {
    if (!showEditor) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented || shortcutsOpenRef.current) return;
      const shortcut = studioShortcut(event, { panel: panelRef.current, typing: isTypingTarget(event.target), visualShown: false });
      if (!shortcut) return;
      if (shortcut.kind === "panel") selectPanel(shortcut.panel);
      else if (shortcut.kind === "sheet") setShortcutsOpen(true);
      else if (shortcut.kind === "split") {
        const onVisual = panelRef.current === "visual";
        selectPanel("visual");
        setSplit((current) => (onVisual ? !current : true));
      } else if (shortcut.kind === "run-cpu") runCpuRef.current();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showEditor]);

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
    // The diagram virtualizes both axes, so a valid cached user edit remains
    // drawable regardless of circuit width or depth.
    if (stored?.artifactIdentity === artifactIdentity) {
      return {
        seed: {
          key,
          artifactIdentity,
          qubitCount: stored.qubitCount,
          steps: stored.steps,
          customGates: stored.customGates,
          readOnly: false,
          readOnlyReasons: [],
          operationCount: stored.steps.length,
        },
        note: copy.circuitRestored,
      };
    }
    const hasOwnCode = Boolean(next.code || next.frameworkVariants || next.qasm || next.circuitIr);
    // Every draft the picker holds, not just the artifact's own stored variants.
    // The OpenQASM 3 draft is very often derived from source the editable parser
    // rejects, and it is exactly what the interchange reader can draw — skipping
    // it is what left artifacts opening to a blank canvas beside a perfectly
    // drawable circuit one tab away. See canvasSeedCandidates.
    const candidates = canvasSeedCandidates(next, activeDrafts, activeFramework, bundle.fallbacks);
    // First choice: source the deterministic builder can reconstruct exactly.
    const parsed = hasOwnCode
      ? candidates.map((candidate) => parseCircuitSource(candidate.code, candidate.framework)).find(Boolean) ?? null
      : null;
    if (parsed) {
      return {
        seed: {
          key,
          artifactIdentity,
          qubitCount: parsed.qubitCount,
          steps: parsed.steps,
          customGates: [],
          readOnly: false,
          readOnlyReasons: [],
          operationCount: parsed.steps.length,
        },
        note: copy.circuitRestored,
      };
    }
    // Second choice: the framework-native circuit observation. Unlike QASM it
    // can retain an unsupported high-level operation (for example one 8-wire
    // DiagonalGate) as one named block. The mapper permits editing only when
    // every operation can round-trip through the existing builder; otherwise
    // the same diagram is intentionally read-only and the source stays intact.
    const observedCircuit = validateCircuitIR(next.circuitIr);
    const observed = observedCircuit ? circuitIRDiagram(observedCircuit) : null;
    if (observed) {
      return {
        seed: {
          key,
          artifactIdentity,
          qubitCount: observed.qubitCount,
          steps: observed.steps,
          customGates: observed.customGates,
          readOnly: observed.readOnly,
          readOnlyReasons: observed.readOnlyReasons,
          operationCount: observed.operationCount,
        },
        note: observed.readOnly
          ? observed.readOnlyReasons.includes("truncated")
            ? copy.circuitReadOnlyTruncated(observed.steps.length, observed.operationCount)
            : copy.circuitReadOnly
          : copy.circuitRestored,
      };
    }
    // Fallback: reconstruct a diagram from the stored interchange QASM
    // (or wider builder-shaped source). LLM-run artifacts store Qiskit qasm3
    // output — richer gates, a `meas` register, per-qubit measurement, and often
    // more than six qubits — which the editable parser rejects, so before this
    // fallback those artifacts opened to an empty canvas and showed no circuit
    // at all. The interchange reader draws the standard-gate subset up to the
    // operation budget. Width is unbounded and every successfully reconstructed
    // circuit is editable. A decomposition past the operation budget still
    // declines honestly rather than opening a misleading partial canvas.
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
      : candidates.map((candidate) => parseCircuitSource(candidate.code, candidate.framework)).find(Boolean) ?? null;
    const reconstructed = interchange?.kind === "ok"
      ? interchange.circuit
      : fallback && fallback.steps.length <= MAX_VIEWABLE_STEPS
        ? fallback
        : null;
    if (reconstructed) {
      return {
        seed: {
          key,
          artifactIdentity,
          qubitCount: reconstructed.qubitCount,
          steps: reconstructed.steps,
          customGates: [],
          readOnly: false,
          readOnlyReasons: [],
          operationCount: reconstructed.steps.length,
        },
        note: copy.circuitRestored,
      };
    }
    const tooLargeToDraw = interchange?.kind === "too_large" || (fallback !== null && fallback.steps.length > MAX_VIEWABLE_STEPS);
    return { seed: { key, ...EMPTY_SEED, artifactIdentity }, note: hasOwnCode ? (tooLargeToDraw ? copy.circuitTooLargeToDraw : copy.circuitNotRebuildable) : null };
  }

  function applyArtifact(next: LibraryArtifact | null) {
    setArtifactHydration("ready");
    setShowEditor(true);
    setArtifact(next);
    setTitle(next?.title ?? copy.untitledCircuit);
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

  /** Load a worked example as a fresh, editable draft — the "start from a
   * known circuit" gallery and `?example=` both go through this. Ids are
   * cloned (cloneWorkedExampleDraft) since the registry's are deterministic,
   * which is right for a static list and wrong for a live draft. */
  function applyExample(example: WorkedExample) {
    setArtifactHydration("ready");
    setShowEditor(true);
    setArtifact(null);
    setTitle(locale === "ja" ? example.title.ja : example.title.en);
    const draft = cloneWorkedExampleDraft(example);
    const generated = generateBuilderCode(draft.steps, draft.qubitCount, draft.customGates);
    setDrafts(generated);
    setDraftNotes({});
    setDraftFallbacks({});
    setFramework("qiskit");
    setCode(generated.qiskit);
    selectPanel("visual");
    setRunId(null);
    setVerificationStale(false);
    // The canvas draws `draft.steps` (fresh, cloned ids), not `example.steps`
    // (the registry's deterministic ones) — the notes panel must compare
    // against the same ids the diagram and playhead use, so it carries the
    // draft's remapped notes, not the example's original ones.
    setActiveExample({ ...example, notes: draft.notes });
    setAskChangeSummary(null);
    setAskBackup(null);
    seedCounter.current += 1;
    seedBuilder({
      key: `example-${example.id}-${seedCounter.current}`,
      artifactIdentity: null,
      qubitCount: draft.qubitCount,
      steps: draft.steps,
      customGates: draft.customGates,
      readOnly: false,
      readOnlyReasons: [],
      operationCount: draft.steps.length,
    });
    setMessage(null);
  }

  /** The gallery's own entry point: confirms before replacing a draft that
   * already has something drawn on it. A fresh `?example=` mount has nothing
   * to lose and calls `applyExample` directly instead of this. */
  function requestLoadExample(example: WorkedExample) {
    if (canvasCircuit.steps.length > 0 && !window.confirm(copy.unsavedChangesConfirm)) return;
    applyExample(example);
    setShowGallery(false);
  }

  /** Ask Leona saved a revised version: load it in place (no navigation),
   * keeping a one-shot backup of everything about to be replaced so "go
   * back" can restore it, and diff the circuit that was open against the one
   * the new version parses to for the "gates added/removed" summary. */
  async function handleAskSaved(artifactId: string) {
    // The canvas as it stands NOW, not `builderSeed`. The seed is what the canvas
    // was last loaded from; every gate placed since lives only in the builder and
    // its mirror, `canvasCircuit`. Backing up the seed meant "go back" restored the
    // latest code beside a canvas from before the reader's own edits — and the next
    // canvas edit then regenerated the code from that older circuit.
    const liveSeed: BuilderSeed = {
      ...builderSeed,
      qubitCount: canvasCircuit.qubitCount,
      steps: canvasCircuit.steps,
      customGates: canvasCircuit.customGates,
      operationCount: canvasCircuit.steps.length,
    };
    const backup = { artifact, builderSeed: liveSeed, title, drafts, framework, activeExample };
    const beforeSteps = canvasCircuit.steps;
    try {
      const loaded = await loadArtifact(artifactId);
      if (!loaded) {
        setMessage(copy.selectedUnavailable);
        return;
      }
      setAskBackup(backup);
      applyArtifact(loaded);
      setActiveExample(null);
      const afterFramework = normalizeFramework(loaded.framework) ?? framework;
      const afterParsed = loaded.code ? parseCircuitSource(loaded.code, afterFramework) : null;
      setAskChangeSummary(afterParsed ? circuitChangeSummary(beforeSteps, afterParsed.steps) : null);
    } catch {
      setMessage(copy.selectedUnavailable);
    }
  }

  /** The one-shot undo for handleAskSaved — restores exactly what that
   * captured, then clears the backup so a second "go back" has nothing left
   * to do (matching "one undo step" rather than a multi-level history). */
  function handleAskGoBack() {
    if (!askBackup) return;
    setArtifact(askBackup.artifact);
    setTitle(askBackup.title);
    setDrafts(askBackup.drafts);
    setFramework(askBackup.framework);
    setCode(askBackup.drafts[askBackup.framework]);
    setActiveExample(askBackup.activeExample);
    // A fresh key, so the builder remounts on the restored circuit even when the
    // backup's seed shares a key with the one Ask Leona's version was loaded under.
    seedCounter.current += 1;
    seedBuilder({ ...askBackup.builderSeed, key: `ask-back-${seedCounter.current}` });
    setAskBackup(null);
    setAskChangeSummary(null);
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
      readOnly: false,
      readOnlyReasons: [],
      operationCount: parsed.steps.length,
    });
    setMessage(copy.rebuiltFromCode);
  }

  const filteredArtifacts = filterDiscoveryArtifacts(artifacts, {
    query,
    filter: projectFilter,
    projects: artifactProjects,
  });
  const projectTabs = discoveryTabs(artifacts, artifactProjects);

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

  async function startCpuSimulation(confirmRerun = false) {
    if (cpuRuns.busy()) return;
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

    const ticket = cpuRuns.begin(artifact.id);
    if (!ticket) return;
    setBusy("simulation");
    try {
      // The checks (eligibility, shots, this browser's pacing, the seed) run
      // here, as they always did; only the simulation itself, a second or
      // more of work at the 20-qubit tier, goes to the simulator worker, so
      // "Starting…" paints and the page keeps answering while it runs. The
      // worker samples with the same kernel and seeded generator
      // (`sampleCircuitCounts`), so a seed reproduces the counts it always did.
      const plan = planCpuSimulation({
        artifactId: artifact.id,
        artifactVersionId: artifact.currentVersionId,
        code,
        framework: sourceFramework,
        qasm: artifact.code === code ? artifact.qasm : null,
        shots: parsedShots,
        seed: parsedSeed,
      }, limits);
      const outcome = await simulator.run(STUDIO_CPU_RUN, { kind: "cpu_counts", circuit: plan.circuit, shots: plan.shots, seed: plan.seed });
      // Everything below changes the page: the record, the list, the rerun
      // prompt, the message. It happens only for the run that still owns the
      // artifact on screen. An abandoned run saves nothing either; it
      // belonged to an artifact the reader has left.
      if (outcome.status === "superseded" || !cpuRuns.owns(ticket, shownArtifactId.current)) return;
      if (outcome.status === "timed_out") {
        setMessage(copy.cpuSimulationTimedOut);
        return;
      }
      if (outcome.status === "failed") throw new Error(outcome.error);
      const record = cpuSimulationRecord(plan, outcome.result);
      if (!saveCpuSimulationRecord(record)) {
        setMessage(copy.simulationPersistenceUnavailable);
        return;
      }
      setSimulationRecords((current) => [record, ...current.filter((item) => item.id !== record.id)]);
      setRerunPending(false);
      setMessage(copy.cpuSimulationRecorded);
    } catch (cause) {
      // Reached before the answer (the plan's own checks) or from a run that
      // still owns the page (a job that threw), never from an abandoned run.
      setMessage(cause instanceof Error ? cause.message : copy.simulationFailed);
    } finally {
      // Only the run that still holds the slot releases Run: an abandoned
      // run's cleanup must not unlock a run started since on another artifact.
      if (cpuRuns.end(ticket)) setBusy(null);
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
      const payload = (await response.json()) as unknown;
      const runId = submittedId(payload);
      if (!response.ok || !runId) {
        throw new Error(refusalSentence(payload) ?? `Run submission failed (${response.status})`);
      }
      setRunId(runId);
      setMessage(copy.verificationStarted);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.submissionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function startQapp() {
    if (!code.trim() || busy || !isExecutableCircuitFramework(sourceFramework)) return;
    setBusy("qapp");
    setMessage(null);
    setRunId(null);
    try {
      const customPrompt = qappPrompt.trim();
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: customPrompt || (locale === "ja"
            ? `量子回路「${title}」を、回路の意味を保ったまま操作しやすいQappにしてください。入力、説明、結果の可視化をこの回路に合わせて設計してください。`
            : `Turn the quantum circuit “${title}” into an interactive Qapp. Preserve its semantics and design inputs, explanation, and result visualization for this circuit.`),
          mode: "qapp",
          framework: sourceFramework,
          source_code: code,
          response_locale: locale,
          ...(artifact?.currentVersionId ? { artifact_version_id: artifact.currentVersionId } : {}),
        }),
      });
      const payload = (await response.json()) as unknown;
      const submitted = submittedId(payload);
      if (!response.ok || !submitted) {
        throw new Error(refusalSentence(payload) ?? `Qapp submission failed (${response.status})`);
      }
      setRunId(submitted);
      setMessage(locale === "ja" ? "Qappの生成を開始しました。Runへ移動します。" : "Qapp generation started. Opening Run.");
      router.push(`/run/${encodeURIComponent(submitted)}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : locale === "ja" ? "Qappを開始できませんでした。" : "Could not start the Qapp.");
    } finally {
      setBusy(null);
    }
  }

  /** File a circuit the user already has, without spending an agent run.
   *
   * The pipeline would plan it, review it, and hand back the same bytes it was
   * given — two model calls and their tokens for source that needed neither.
   * This is the other door: it stores what was typed and says plainly that
   * nothing was executed. Verify & save is still there when evidence is wanted.
   *
   * Every refusal comes from the control plane and is rendered, not re-decided
   * here: the source binding neither name, the framework contract, the artifact
   * cap. A client-side copy of any of those becomes the real gate the moment
   * the server's rule moves.
   */
  async function bringYourOwnCircuit() {
    if (!code.trim() || busy || !isExecutableCircuitFramework(sourceFramework)) return;
    setBusy("bring");
    setMessage(null);
    try {
      const response = await fetch("/api/artifacts/import-source", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          // sourceFramework for the same reason startRun uses it: the editor's
          // text belongs to the framework it was written in, not to whichever
          // tab happens to be selected.
          framework: sourceFramework,
          code,
        }),
      });
      const payload = (await response.json()) as unknown;
      const importedId = submittedId(payload);
      if (!response.ok || !importedId) {
        // `diagnostics` is a SIBLING of `title`, not nested — see api-error.ts.
        const named = refusalStrings(payload, "diagnostics");
        const diagnostics = named.length ? ` (${named.join("; ")})` : "";
        throw new Error(`${refusalSentence(payload) ?? copy.broughtInFailed}${diagnostics}`);
      }
      setMessage(copy.broughtInSaved);
      router.push(`/library/${importedId}`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : copy.broughtInFailed);
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
                  <label className="sr-only" htmlFor="studio-title">{copy.workingCircuit}</label>
                  <input id="studio-title" className="mj-studio-title-input" value={title} onChange={(event) => setTitle(event.target.value)} spellCheck={false} />
                  {/* One line about the circuit (UX pass 6): framework, version,
                      shape, and whether the newest CPU run still describes this
                      code. It replaced "Editing version 019f7f2f · qiskit". The
                      shape is only printed while the diagram matches the code —
                      an undrawable artifact is not "2 qubits · 0 operations". */}
                  <ul className="mj-studio-meta">
                    <li className="mj-studio-meta-framework">{frameworkLabel(sourceFramework)}</li>
                    <li>{artifact?.currentVersionId ? copy.metaSavedVersion(artifact.currentVersionId.slice(0, 8)) : copy.newDraft}</li>
                    {canvasSync.kind === "in_sync" ? (
                      <li>
                        {copy.metaQubits(canvasCircuit.qubitCount)} · {copy.metaOperations(builderSeed.readOnly ? builderSeed.operationCount : canvasMetrics.operations)}
                        {builderSeed.readOnly ? null : ` · ${copy.metaDepth(canvasMetrics.depth)}`}
                      </li>
                    ) : null}
                    <li>
                      <button type="button" className="mj-studio-meta-run" data-state={cpuRunState} onClick={openSimulation} data-tour="studio-cpu-run">
                        <span className="mj-studio-meta-dot" aria-hidden="true" />
                        {cpuRunState === "none"
                          ? copy.metaNoCpuRun
                          : cpuRunState === "current" && latestRecord
                            ? copy.metaCpuRun(relativeTime(latestRecord.createdAt, locale, copy))
                            : copy.metaCpuRunStale}
                      </button>
                    </li>
                  </ul>
                </div>
                {/* Simulate and Copy code used to sit here as full-size buttons
                    beside a tab bar that already contained both — three ways to
                    reach two places. Each now lives once, inside the tab that
                    owns it (Owner Inbox 2026-07-31). */}
                <div className="mj-studio-actions">
                  {/* The chip is a shortcut to the evidence panel. On the tab
                      that already renders that panel it would just be the same
                      sentence twice — so it is hidden there, not unmounted.
                      Unmounting it let the row reflow every time you moved on
                      or off Summary, and Download export / Verify & save jumped
                      sideways under the pointer on a plain tab change. Hidden
                      with `visibility`, so it keeps its box, takes no clicks and
                      leaves the tab order. */}
                  <span
                    className="mj-studio-verdict-slot"
                    data-hidden={panel === "summary" ? "true" : undefined}
                    aria-hidden={panel === "summary" ? true : undefined}
                  >
                    <StudioVerdictChip
                      summary={artifact?.verificationSummary ?? null}
                      state={verificationDisplayState}
                      onOpen={() => selectPanel("summary")}
                      copy={copy}
                      locale={locale}
                      inert={panel === "summary"}
                    />
                  </span>
                  {/* The Qapp request was a full-width disclosure between this
                      header and the tabs, drawing a second rule 30px above the
                      tab strip. It is a popover off the action row now. */}
                  <details
                    className="leona-studio-qapp-disclosure"
                    onKeyDown={(event) => {
                      if (event.key === "Escape") event.currentTarget.open = false;
                    }}
                  >
                    <summary className="mj-secondary-button">{copy.qappTitle}</summary>
                    <form
                      className="mj-studio-qapp-request"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void startQapp();
                      }}
                    >
                      <label className="mj-studio-qapp-field" htmlFor="studio-qapp-prompt">
                        <span>{copy.qappPrompt}</span>
                        <textarea
                          id="studio-qapp-prompt"
                          value={qappPrompt}
                          onChange={(event) => setQappPrompt(event.target.value)}
                          disabled={busy !== null}
                          placeholder={copy.qappPlaceholder}
                        />
                      </label>
                      <div className="mj-studio-qapp-submit">
                        <p id="studio-qapp-help">
                          {copy.qappHelp}
                        </p>
                        <button
                          className="mj-secondary-button"
                          type="submit"
                          aria-describedby="studio-qapp-help"
                          disabled={!code.trim() || busy !== null || !isExecutableCircuitFramework(sourceFramework)}
                        >
                          {busy === "qapp" ? locale === "ja" ? "Qappを生成中…" : "Creating Qapp…" : locale === "ja" ? "Qappにする" : "Create Qapp"}
                        </button>
                      </div>
                    </form>
                  </details>
                  <button className="mj-secondary-button" type="button" onClick={() => setShowGallery(true)}>{copy.galleryOpen}</button>
                  {artifact ? <button className="mj-secondary-button" type="button" onClick={downloadDraft} data-tour="studio-download-export">{copy.downloadExport}</button> : null}
                  {!artifact ? (
                    <button
                      className="mj-secondary-button"
                      type="button"
                      disabled={!code.trim() || busy !== null || !isExecutableCircuitFramework(sourceFramework)}
                      onClick={() => void bringYourOwnCircuit()}
                    >
                      {busy === "bring" ? copy.bringingYourOwn : copy.bringYourOwn}
                    </button>
                  ) : null}
                  <button className="mj-primary-button" type="button" disabled={!code.trim() || busy !== null || !isExecutableCircuitFramework(framework) || !isExecutableCircuitFramework(sourceFramework)} onClick={() => void startRun()} data-tour="studio-verify-save">{busy === "save" ? copy.starting : copy.verifySave}</button>
                  <button
                    className="mj-icon-button mj-studio-shortcuts-button"
                    data-tour="studio-shortcuts"
                    type="button"
                    aria-label={copy.shortcutsOpen}
                    title={`${copy.shortcutsOpen} · ?`}
                    aria-keyshortcuts="?"
                    onClick={() => setShortcutsOpen(true)}
                  >
                    <span aria-hidden="true">⌘</span>
                  </button>
                </div>
              </div>

              <AskLeonaBox
                code={code}
                framework={sourceFramework}
                artifactVersionId={artifact?.currentVersionId}
                onSaved={(id) => void handleAskSaved(id)}
                changeSummary={askChangeSummary}
                canGoBack={askBackup !== null}
                onGoBack={handleAskGoBack}
                copy={copy}
              />

              <div className="mj-studio-tabbar">
                <PanelTabs
                  panels={STUDIO_PANELS}
                  active={panel}
                  onSelect={selectPanel}
                  label={copy.view}
                  labelFor={(item) => (item === "code" ? copy.code : item === "simulation" ? copy.simulation : item === "visual" ? copy.visual : copy.summary)}
                  idPrefix="studio"
                />
                <div className="mj-studio-tabbar-tools">
                  {panel === "visual" ? (
                    <button
                      className={`mj-studio-split-toggle${split ? " is-active" : ""}`}
                      data-tour="studio-split"
                      type="button"
                      aria-pressed={split}
                      aria-keyshortcuts="\"
                      title={`${copy.shortcutRows.split} · \\`}
                      onClick={() => setSplit((current) => !current)}
                    >
                      {copy.splitShow}
                    </button>
                  ) : null}
                </div>
              </div>

              {(artifactId || atlasSlug) && !newDraft && artifactHydration !== "ready" ? (
                <div className="mj-studio-empty" role={artifactHydration === "error" ? "alert" : "status"}>
                  {artifactHydration === "loading"
                    ? atlasSlug ? copy.atlasImporting : copy.loadingArtifacts
                    : atlasSlug ? copy.atlasImportFailed : copy.selectedUnavailable}
                  {artifactHydration === "error" ? <button className="mj-secondary-button" type="button" onClick={() => setLoadAttempt((value) => value + 1)}>{locale === "ja" ? "再試行" : "Retry"}</button> : null}
                </div>
              ) : (
                <div className={`mj-studio-panels${splitOn ? " is-split" : ""}`}>
                  {/* Before the builder in the tree so the split view reads code
                      then diagram. A null slot here in the other tabs keeps the
                      builder's position stable, so it never remounts on a tab
                      change and loses its selection or playhead. */}
                  {panel === "code" || splitOn ? (
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
                      region={splitOn ? undefined : panelRegion("studio", "code")}
                      onTogglePopout={() => setPopout((current) => (current === "code" ? null : "code"))}
                      copy={copy}
                      locale={locale}
                    />
                  ) : null}
                  <CircuitBuilder
                    key={builderSeed.key}
                    liveSync={liveSync}
                    keyboardActive={!shortcutsOpen}
                    onLiveApply={(codes) => {
                      if (codes[framework] === code) return;
                      setDrafts(codes);
                      setDraftNotes({});
                      setDraftFallbacks({});
                      setCode(codes[framework]);
                      setVerificationStale(Boolean(artifact));
                      setMessage(copy.codeFollowedDiagram);
                    }}
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
                    activeExample={activeExample}
                    locale={locale}
                  />
                  {panel === "simulation" ? (
                    <SimulationPanel
                      artifact={artifact}
                      eligibility={cpuEligibility}
                      circuit={canvasCircuit}
                      synchronized={canvasSync.kind === "in_sync"}
                      complete={!builderSeed.readOnlyReasons.includes("truncated")}
                      sourceCode={code}
                      onOpenVisual={() => selectPanel("visual")}
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
                      locale={locale}
                      limits={limits}
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
                </div>
              )}

              <footer className="mj-studio-footer" aria-live="polite" data-tone={message ? "message" : undefined}>
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
            <label className="mj-studio-search">
              <SearchIcon size={17} />
              <span className="sr-only">{copy.search}</span>
              {/* `id` and `name`. The accessible name was never missing — the
                  wrapping label and its sr-only span supply it. What was missing
                  is the pair that makes a browser treat this as a FIELD, which
                  Chrome reports as an issue on every load of the page. Same
                  defect and same fix as the Atlas search box (leona PR 653); that
                  one was found by reading the production console, and this one
                  and the Library's were found by grepping for the shape rather
                  than waiting to read a second console. */}
              <input
                id="studio-search"
                name="q"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.searchPlaceholder}
              />
            </label>
            {/* No tabs at all until the workspace has a project — a lone "All"
                is a control that does nothing, and this pane looked exactly as
                it does now for everybody who has never made one. */}
            {projectTabs.length ? (
              <div className="mj-studio-projects" role="group" aria-label={copy.projectFilterLabel}>
                {projectTabs.map((tab) => {
                  const label =
                    tab.filter.kind === "all"
                      ? copy.projectAll
                      : tab.filter.kind === "ungrouped"
                        ? copy.projectUngrouped
                        : tab.name;
                  const active = sameFilter(tab.filter, projectFilter);
                  return (
                    <button
                      key={`${tab.filter.kind}:${tab.filter.kind === "project" ? tab.filter.id : ""}`}
                      type="button"
                      className={`mj-studio-project-tab${active ? " is-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => setProjectFilter(tab.filter)}
                    >
                      {label}
                      <span className="mj-studio-project-count">{tab.count}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {/* How many rows the list below actually holds. A list you have
                just filtered should say what the filter left, and this is the
                one number that used to be reachable only by counting cards.

                Rendered unconditionally, with the sentence conditional inside
                it: the server paints before local storage has been read, so a
                line that only exists once there are rows appears after
                hydration and pushes the whole list down. The element reserves
                its own height (globals.css) whether or not it has anything to
                say. */}
            <p className="mj-studio-discovery-count">
              {filteredArtifacts.length ? copy.countCircuits(filteredArtifacts.length) : null}
            </p>
            {/* The sync failure used to render in `.mj-studio-empty`, the same
                muted 12px the "nothing here yet" sentence uses — so a workspace
                that could not reach the control plane looked exactly like an
                empty one, and the difference between "you have nothing" and "we
                could not read what you have" was invisible. It has its own tone
                now.

                It sits directly above the list rather than above the search
                field, because it appears only after the fetch has failed: any
                higher and it pushes the search box down under whoever is
                already typing in it. Here the only thing it moves is the list
                it qualifies. */}
            {artifactSyncError ? <div className="mj-studio-notice leona-workspace-retry" data-tone="warn" role="alert"><span>{copy.remoteSyncUnavailable}</span><button type="button" className="mj-secondary-button" onClick={() => setLoadAttempt((value) => value + 1)}>{locale === "ja" ? "再試行" : "Retry"}</button></div> : null}
            <div className="mj-studio-discovery-list">
              {filteredArtifacts.length ? filteredArtifacts.map((item) => {
                // Named on the card only under "All". Repeating one project's
                // name down a list already filtered to it is noise, and the
                // tab above the list has just said it.
                const project = projectFilter.kind === "all" ? projectOf(item, artifactProjects) : null;
                return (
                <article className="mj-studio-discovery-card" key={item.id}>
                  <button type="button" onClick={() => void selectArtifact(item.id)}>
                    <span className="mj-studio-card-body">
                      <strong>{item.title}</strong>
                      <em>{item.description}</em>
                      <small>
                        <span className="mj-studio-card-framework">{item.framework}</span>
                        <span>{item.family}</span>
                        <span>{formatDiscoveryDate(item.updatedAt, locale)}</span>
                        {project ? <span className="mj-studio-card-project">{project.name}</span> : null}
                      </small>
                    </span>
                  </button>
                  {/* The verdict, in the same words and tone the rest of the
                      product uses for it. The mark this replaces was one grey
                      ring whose glyph was "✓" for verified and "–" for
                      everything else — so a FAILED artifact and a structurally
                      verified one were the same picture, in the same colour
                      (`.mj-studio-artifact-mark` is hard-coded to `--ok`). It
                      is the first thing anybody opens this list to learn. */}
                  <span className="mj-studio-card-side">
                    <StudioStatusPill status={item.status} locale={locale} />
                    <a className="mj-secondary-button" href={`/run?artifact=${encodeURIComponent(item.id)}`}>{copy.openRun}</a>
                  </span>
                </article>
                );
              }) : artifactsLoading ? (
                <div className="leona-workspace-state" role="status"><span>{locale === "ja" ? "回路を読み込み中…" : "Loading circuits…"}</span></div>
              ) : artifactSyncError ? null : (
                <p className="mj-studio-empty">
                  {/* Four different nothings. An empty project told the reader
                      "no results match your search" while the search box was
                      blank, which reads as the filter being broken — and
                      Ungrouped is not a project, so it cannot borrow that
                      sentence either. It is reachable: the tab is dropped once
                      everything is filed, but the selection is not, so the last
                      artifact leaving the bucket lands here. */}
                  {!artifacts.length
                    ? copy.empty
                    : query.trim()
                      ? copy.noSearchResults
                      : projectFilter.kind === "ungrouped"
                        ? copy.ungroupedEmpty
                        : copy.projectEmpty}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
      {showEditor && shortcutsOpen ? <ShortcutSheet onClose={closeShortcuts} copy={copy} /> : null}
      {showGallery ? (
        <ExampleGallery locale={locale} onLoad={requestLoadExample} onClose={() => setShowGallery(false)} copy={copy} />
      ) : null}
    </div>
  );
}

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

/** "just now", "3 minutes ago", "昨日" — for the header's CPU run line. */
function relativeTime(iso: string, locale: PublicLocale, copy: StudioCopy): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return copy.justNow;
  const format = new Intl.RelativeTimeFormat(locale === "ja" ? "ja" : "en", { numeric: "auto" });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return format.format(-minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return format.format(-hours, "hour");
  return format.format(-Math.round(hours / 24), "day");
}

/** A record's time as a reader wants it; the ISO string stays in `dateTime`. */
function formatRecordTime(iso: string, locale: PublicLocale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return date.toLocaleString(locale === "ja" ? "ja-JP" : "en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

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
  locale,
  inert = false,
}: {
  summary: Parameters<typeof verificationHeadline>[0];
  state: Parameters<typeof verificationHeadline>[1];
  onOpen: () => void;
  copy: StudioCopy;
  locale: PublicLocale;
  /** Rendered only to hold its width open; not reachable and not announced. */
  inert?: boolean;
}) {
  const headline = verificationHeadline(summary, state, locale);
  return (
    <button
      className="mj-studio-verdict-chip"
      type="button"
      data-tone={headline.tone}
      onClick={onOpen}
      title={copy.openSummary}
      tabIndex={inert ? -1 : undefined}
    >
      <span aria-hidden="true">{headline.glyph}</span>
      {headline.title}
      <span className="sr-only">— {copy.openSummary}</span>
    </button>
  );
}

/**
 * One artifact's verdict on a discovery card: glyph, word, tone.
 *
 * Deliberately reuses `.mj-library-status`, the vocabulary the retired Vault
 * list already had, rather than inventing a second one — the tone mapping
 * (verified → ok, failed → err, everything else → warn) and the glyph pairing
 * that keeps it off hue alone both live in that ruleset. The words come from
 * `library`, not `studio`, for the same reason: one artifact status has one
 * name, and a second copy of it in another section is a string that drifts.
 */
function StudioStatusPill({ status, locale }: { status: LibraryArtifact["status"]; locale: PublicLocale }) {
  const copy = WORKSPACE_COPY[locale].library;
  const label =
    status === "verified"
      ? copy.verified
      : status === "structural"
        ? copy.structural
        : status === "verified_caveats"
          ? copy.caveats
          : status === "inconclusive"
            ? copy.inconclusive
            : status === "legacy_unknown"
              ? copy.legacyUnknown
              : status === "stale"
                ? copy.stale
                : copy.failed;
  return (
    <span className={`mj-library-status mj-studio-card-status mj-library-status--${status}`}>
      <span aria-hidden="true">{status === "failed" ? "×" : status === "verified" ? "✓" : "–"}</span>
      {label}
    </span>
  );
}


// Exported so the block-edit panel (studio-edit-block-panel.tsx) can offer
// the same angle choices and gate groupings, rather than a second hand-kept copy.
export const ANGLE_OPTIONS = ["pi/8", "pi/4", "pi/2", "pi", "3*pi/2", "2*pi"];

/** CP, RZZ and CCX are `entangler`-family by `gateFamily` (for diagram/CSS
 * purposes), but dumping them into "twoQubit" would both mislabel CCX (three
 * wires, not two) and make "Pick CX, CZ or SWAP" a lie. They get their own
 * compact overflow group instead; SDG/TDG (still `clifford`) and P (still
 * `rotation`) fold into their existing, still-accurate groups automatically. */
export const MORE_PALETTE_GATES: BuiltinBuilderGate[] = ["CP", "RZZ", "CCX"];

/** The palette in five labelled groups, derived from the gate list so a new
 * gate cannot silently fall out of the palette. */
export const PALETTE_GROUPS: Array<{ id: "oneQubit" | "rotations" | "twoQubit" | "measure" | "more"; family: GateFamily | null; gates: BuiltinBuilderGate[] }> = [
  ...(
    [["oneQubit", "clifford"], ["rotations", "rotation"], ["twoQubit", "entangler"], ["measure", "measure"]] as const
  ).map(([id, family]) => ({
    id,
    family,
    gates: BUILDER_GATES.filter((gate) => gateFamily(gate) === family && !MORE_PALETTE_GATES.includes(gate)),
  })),
  { id: "more" as const, family: null, gates: MORE_PALETTE_GATES },
];

// Exported for the focused CircuitBuilder form tests. The custom-gate <form>
// inside it had never been submitted by any check before ai-ops issue 123.
// Not part of the module's public surface otherwise; StudioWorkspace is.
export function CircuitBuilder({ seed, framework, selectedGate, onSelectGate, onApply, onCircuitChange, hidden, popout, onTogglePopout, region, copy, syncState, onRebuildFromCode, sourceCode, liveSync = false, onLiveApply, keyboardActive = true, activeExample = null, locale = "en" }: { seed: BuilderSeed; framework: StudioFramework; selectedGate: string; onSelectGate: (gate: string) => void; onApply: (codes: BuilderCodeVariants) => void; onCircuitChange?: (circuit: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }) => void; hidden: boolean; popout: boolean; onTogglePopout: () => void; region?: Record<string, string>; copy: StudioCopy; syncState: CircuitSyncState; onRebuildFromCode: () => void; sourceCode: string; liveSync?: boolean; onLiveApply?: (codes: BuilderCodeVariants) => void; keyboardActive?: boolean; activeExample?: WorkedExample | null; locale?: PublicLocale }) {
  const [qubitCount, setQubitCount] = useState(seed.qubitCount);
  const [steps, setSteps] = useState<BuilderStep[]>(seed.steps);
  const [pendingQubits, setPendingQubits] = useState<number[]>([]);
  const [angle, setAngle] = useState("pi/2");
  const [selectedStepIds, setSelectedStepIds] = useState<string[]>([]);
  const [customGates, setCustomGates] = useState<CustomGateDefinition[]>(seed.customGates);
  const [history, setHistory] = useState<StudioHistorySnapshot[]>([]);
  // View state only: which block instances are drawn open. Never touches
  // `steps`/`customGates`, so code generation, sync signatures, simulation
  // and saved drafts are unchanged by opening or closing a block.
  const [openStepIds, setOpenStepIds] = useState<ReadonlySet<string>>(new Set());
  const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
  const [showBlocksPanel, setShowBlocksPanel] = useState(false);
  const [showCustomGateForm, setShowCustomGateForm] = useState(false);
  const [customGateName, setCustomGateName] = useState("");
  const [builderMessage, setBuilderMessage] = useState<string | null>(null);
  const [applyConfirmPending, setApplyConfirmPending] = useState(false);
  const [compressionStrategy, setCompressionStrategy] = useState<CircuitCompressionStrategy>("balanced");
  const [compressionConfirmPending, setCompressionConfirmPending] = useState(false);
  const [compressionSnapshot, setCompressionSnapshot] = useState<{ before: BuilderStep[]; afterSignature: string } | null>(null);
  const [externalCompiler, setExternalCompiler] = useState<ExternalCircuitCompiler>("qiskit");
  const [externalLevel, setExternalLevel] = useState(2);
  const [externalBusy, setExternalBusy] = useState(false);
  const [externalRunId, setExternalRunId] = useState<string | null>(null);
  const [externalResult, setExternalResult] = useState<CircuitOptimizationResult | null>(null);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [externalConfirmPending, setExternalConfirmPending] = useState(false);
  const externalStreamRef = useRef<EventSource | null>(null);
  // `runExternalCompression` awaits a POST before it opens its stream, so the
  // unmount cleanup below can run while that request is still in flight. An
  // `EventSource` constructed after that point is held by nothing that will
  // ever close it. This ref is how the continuation learns it is too late.
  const mountedRef = useRef(true);
  // The other way that continuation can be too late, and it is the one a user
  // actually hits: edit the circuit — or switch compiler, or change level —
  // while the POST is in flight. The effect below tears down the current run,
  // but it cannot reach into an awaited `fetch`, so without this the
  // continuation still opens a stream and stores a result measured against a
  // circuit that no longer exists, under a `before` the panel then shows
  // beside the new one. Bumped by that same effect, captured before the
  // request, compared after it.
  const externalRunSeqRef = useRef(0);

  // Targeted synthesis (proposal 3): a second, target-aware entry point into
  // the same trusted compiler lane the external-compression state above
  // drives — same shape (busy/runId/result/error/confirm/snapshot, a stream
  // ref and a run-seq ref to retire a stale in-flight request), because it
  // is the same class of action: run something heavier than an in-browser
  // rewrite, then optionally replace the whole circuit with one candidate.
  const [synthesisTargetMode, setSynthesisTargetMode] = useState<"generic" | "device">("generic");
  const [synthesisConnectivity, setSynthesisConnectivity] = useState<SynthesisConnectivity>("all_to_all");
  const [synthesisDeviceId, setSynthesisDeviceId] = useState<string | null>(null);
  const [synthesisObjective, setSynthesisObjective] = useState<SynthesisObjective>("depth");
  const [synthesisDevices, setSynthesisDevices] = useState<QpuBackendInfo[] | null>(null);
  const [synthesisDevicesFailed, setSynthesisDevicesFailed] = useState(false);
  const [synthesisBusy, setSynthesisBusy] = useState(false);
  const [synthesisRunId, setSynthesisRunId] = useState<string | null>(null);
  const [synthesisResult, setSynthesisResult] = useState<SynthesisResult | null>(null);
  const [synthesisError, setSynthesisError] = useState<string | null>(null);
  // Which candidate's apply button is armed for a second click — a compiler
  // value, or null. Per-candidate rather than one boolean (externalConfirmPending's
  // shape) because a row of candidates has more than one apply button.
  const [synthesisConfirmPending, setSynthesisConfirmPending] = useState<string | null>(null);
  // No separate snapshot state: applying a candidate writes into the SAME
  // `compressionSnapshot` `applyExternalCompression` already uses, so one
  // Undo (`undoCompression`, `canUndoCompression`) covers every full-circuit
  // replacement this component makes — in-browser compression, one external
  // compiler, or a synthesis candidate — rather than three parallel undo
  // slots a user would have to know to look for separately.
  const synthesisStreamRef = useRef<EventSource | null>(null);
  const synthesisRunSeqRef = useRef(0);

  // Loaded the first time a reader picks "device" as the target, not on every
  // Studio open: most sessions never use it, and an eager request on mount
  // was one more call on a page that already makes several.
  const synthesisDevicesRequested = synthesisTargetMode === "device";
  useEffect(() => {
    if (!synthesisDevicesRequested) return;
    let cancelled = false;
    fetchQpuBackends()
      .then((backends) => { if (!cancelled) setSynthesisDevices(backends); })
      .catch(() => { if (!cancelled) setSynthesisDevicesFailed(true); });
    return () => { cancelled = true; };
  }, [synthesisDevicesRequested]);

  const synthesisTarget: SynthesisTarget = useMemo(
    () => synthesisTargetMode === "device" && synthesisDeviceId
      ? { device_id: synthesisDeviceId, connectivity: null }
      : { device_id: null, connectivity: synthesisConnectivity },
    [synthesisTargetMode, synthesisDeviceId, synthesisConnectivity],
  );

  /** The gate under the pointer or focus, explained in a card (UX pass 6). */
  const [inspection, setInspection] = useState<CircuitDiagramInspection | null>(null);
  /** "end" follows the circuit as gates are placed; a number pins a moment. */
  const [playhead, setPlayhead] = useState<number | "end">("end");

  // A pending confirmation describes one specific pair of a diagram and a
  // source. If either side moves — the code is edited again, the canvas is
  // changed, or the two come back into agreement — the armed button would be
  // consenting to something the user was never shown, so disarm it.
  //
  // **`externalCompiler` and `externalLevel` are in here because the choice of
  // compiler moves one side of that pair.** They were in the dep array of the
  // effect below, which clears the RESULT, and not in this one, which disarms
  // the CONSENT — so the two halves of the same fact were kept by different
  // lists. Arm the external apply on one compiler, switch compilers, run the
  // new one, and the guard in `applyExternalCompression` sees a pending
  // confirmation that was granted against a different compiler's output: one
  // click then runs `setSteps` and `onApply`, overwriting edited source with a
  // result the user was never asked about. Disarming here is the safe
  // direction — the worst it costs is a second click.
  useEffect(() => {
    setApplyConfirmPending(false);
    setCompressionConfirmPending(false);
    setExternalConfirmPending(false);
    setSynthesisConfirmPending(null);
  }, [
    syncState.kind,
    sourceCode,
    steps,
    qubitCount,
    customGates,
    compressionStrategy,
    externalCompiler,
    externalLevel,
    synthesisTarget,
    synthesisObjective,
  ]);

  useEffect(() => {
    // Set on mount as well as cleared on unmount. A cleanup-only effect left
    // this false for good under React's dev-mode double mount (mount, cleanup,
    // mount), so every compiler and synthesis run on a dev server stayed on
    // "Running…" forever: the handlers bail when this is false.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      externalStreamRef.current?.close();
      synthesisStreamRef.current?.close();
    };
  }, []);

  useEffect(() => {
    // Retires every run in flight for the previous circuit/compiler/level, the
    // awaited ones included — see `externalRunSeqRef`. Closing the stream only
    // reaches a run that got as far as opening one.
    externalRunSeqRef.current += 1;
    externalStreamRef.current?.close();
    externalStreamRef.current = null;
    setExternalBusy(false);
    setExternalResult(null);
    setExternalError(null);
    setExternalRunId(null);
  }, [steps, qubitCount, externalCompiler, externalLevel]);

  useEffect(() => {
    // Same reasoning as the external-compression effect above, for the
    // synthesis lane's own in-flight run.
    synthesisRunSeqRef.current += 1;
    synthesisStreamRef.current?.close();
    synthesisStreamRef.current = null;
    setSynthesisBusy(false);
    setSynthesisResult(null);
    setSynthesisError(null);
    setSynthesisRunId(null);
  }, [steps, qubitCount, synthesisTarget, synthesisObjective]);

  const compression = useMemo(
    () => compressCircuit(steps, compressionStrategy),
    [steps, compressionStrategy],
  );
  const externalCompiledSteps = useMemo(
    () => externalResult ? builderStepsFromExternalResult(externalResult) : null,
    [externalResult],
  );
  const canUndoCompression = Boolean(
    compressionSnapshot
    && compressionSnapshot.afterSignature === circuitStepSignature(steps)
    && syncState.kind === "in_sync",
  );
  const compressionOptions: { value: CircuitCompressionStrategy; label: string; description: string }[] = [
    { value: "balanced", label: copy.compressionBalanced, description: copy.compressionBalancedDescription },
    { value: "inverse_cancellation", label: copy.compressionInverse, description: copy.compressionInverseDescription },
    { value: "rotation_folding", label: copy.compressionRotations, description: copy.compressionRotationsDescription },
    { value: "pattern_rewrite", label: copy.compressionPatterns, description: copy.compressionPatternsDescription },
  ];
  const externalCompilerOptions: { value: ExternalCircuitCompiler; label: string; recommended?: boolean }[] = [
    { value: "qiskit", label: copy.externalQiskit, recommended: true },
    { value: "cirq", label: copy.externalCirq },
    { value: "pytket", label: copy.externalPytket },
    { value: "pennylane", label: copy.externalPennyLane },
    { value: "pyzx", label: copy.externalPyZX },
    { value: "bqskit", label: copy.externalBqskit },
  ];

  const onCircuitChangeRef = useRef(onCircuitChange);
  onCircuitChangeRef.current = onCircuitChange;
  // Read at the moment of the edit, so it is the eligibility of the circuit
  // BEFORE the edit: the parent has not re-rendered with the new canvas yet.
  const liveSyncRef = useRef(liveSync);
  liveSyncRef.current = liveSync;
  const onLiveApplyRef = useRef(onLiveApply);
  onLiveApplyRef.current = onLiveApply;
  const reportedEditRef = useRef(false);
  useEffect(() => {
    if (seed.readOnly) return;
    // The untouched seed is not re-persisted; only user edits are reported.
    // Reference equality is the signal: any edit replaces these arrays, while
    // StrictMode's double-invoked mount effect still sees the seed values.
    //
    // "Untouched" stops being true for good at the first edit, though. Undo
    // restores a snapshot, and the snapshot of a never-edited canvas IS the seed's
    // own arrays — so undoing back to where you started matched this test and was
    // never reported. The page's mirror, the stored draft and the code kept the
    // edit the canvas had just taken back. The ref resets with the builder, which
    // remounts on every new seed key.
    const atSeed = qubitCount === seed.qubitCount && steps === seed.steps && customGates === seed.customGates;
    if (atSeed && !reportedEditRef.current) return;
    reportedEditRef.current = true;
    onCircuitChangeRef.current?.({ qubitCount, steps, customGates });
    if (liveSyncRef.current) onLiveApplyRef.current?.(generateBuilderCode(steps, qubitCount, customGates));
  }, [qubitCount, steps, customGates, seed]);

  const armedCustomId = selectedGate.startsWith("custom:") ? selectedGate.slice("custom:".length) : null;
  const armedCustom = armedCustomId ? customGates.find((gate) => gate.id === armedCustomId) ?? null : null;
  const armed: BuilderGate = (BUILDER_GATES as string[]).includes(selectedGate) ? selectedGate as BuilderGate : armedCustom ? "CUSTOM" : "H";
  const requiredQubits = armedCustom?.qubitCount ?? builderGateArity(armed as BuiltinBuilderGate);
  const selectedLabel = armed === "CUSTOM" ? armedCustom?.name ?? copy.customGateLabel : armed;
  const moments = useMemo(() => circuitMoments(qubitCount, steps), [qubitCount, steps]);
  const playheadMoment = playhead === "end" ? moments.count : Math.min(playhead, moments.count);
  const rotationArmed = ANGLE_GATES.includes(armed as (typeof ANGLE_GATES)[number]);
  // Which palette row shows the shared angle picker: CP/RZZ live in "more",
  // everything else that takes an angle lives in "rotations". Defaults to
  // "rotations" when nothing angle-carrying is armed, matching prior behavior.
  const angleGroupId: "rotations" | "more" = MORE_PALETTE_GATES.includes(armed as BuiltinBuilderGate) ? "more" : "rotations";

  // A card describing a gate that was just deleted, or a tab that just closed,
  // would float over whatever is on screen now.
  useEffect(() => {
    setInspection(null);
  }, [steps, hidden]);

  function armGate(gate: string) {
    onSelectGate(gate);
    setPendingQubits([]);
    setBuilderMessage(null);
  }

  function undoLast() {
    const popped = popStudioHistory(history);
    if (!popped) return;
    setHistory(popped.past);
    setQubitCount(popped.snapshot.qubitCount);
    setSteps(popped.snapshot.steps);
    setCustomGates(popped.snapshot.customGates);
    setSelectedStepIds([]);
    setPendingQubits([]);
  }

  /** Snapshot the current state onto the undo stack, immediately before a
   * mutation that should be undoable — a gate placement, creating a custom
   * gate, saving an edited block definition, ungrouping an instance, and since
   * 2026-09-20 every removal: deleting a step or a selection, Clear, and a
   * "Remove qubit" that takes gates with it. See lib/studio-history.ts for why
   * this replaced the old placed-step-id-only mechanism. */
  function pushHistory() {
    setHistory((current) => pushStudioHistory(current, { qubitCount, steps, customGates }));
  }

  function stepPlayhead(delta: -1 | 1) {
    const next = playheadMoment + delta;
    setPlayhead(next >= moments.count ? "end" : Math.max(0, next));
  }

  // Gate, undo, delete and playhead keys, only while this diagram is on screen
  // and the shortcut sheet is closed. A focused gate's own Delete handler runs
  // first and prevents default, so a key is never applied twice.
  const keyboardRef = useRef({ armGate, undoLast, deleteSelected, stepPlayhead, hasSelection: false, active: false });
  // Suspended while the block-edit panel is open — it is a separate overlay
  // with its own focused-element handlers, and this listener is global
  // (window-level), so both firing on the same keypress would edit the
  // canvas underneath while the user believes they are only editing the block.
  keyboardRef.current = { armGate, undoLast, deleteSelected, stepPlayhead, hasSelection: selectedStepIds.length > 0, active: keyboardActive && !hidden && !editingBlockId };
  useEffect(() => {
    if (seed.readOnly) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      const keyboard = keyboardRef.current;
      if (!keyboard.active || event.defaultPrevented) return;
      const shortcut = studioShortcut(event, { panel: "visual", typing: isTypingTarget(event.target), visualShown: true });
      if (!shortcut) return;
      if (shortcut.kind === "gate") keyboard.armGate(shortcut.gate);
      else if (shortcut.kind === "undo") keyboard.undoLast();
      else if (shortcut.kind === "step") keyboard.stepPlayhead(shortcut.delta);
      else if (shortcut.kind === "delete" && keyboard.hasSelection) keyboard.deleteSelected();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [seed.readOnly]);

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
        // CP and RZZ are multi-qubit but still angle-carrying, unlike CX/CZ/SWAP/CCX.
        : { id: createBuilderStepId(), gate: armed, qubits: nextQubits, ...(ANGLE_GATES.includes(armed as (typeof ANGLE_GATES)[number]) ? { param: angle } : {}) };
      place(nextStep);
      setPendingQubits([]);
      return;
    }
    place({ id: createBuilderStepId(), gate: armed, qubits: [qubit], ...(ANGLE_GATES.includes(armed as (typeof ANGLE_GATES)[number]) ? { param: angle } : {}) });
    setBuilderMessage(null);
  }

  function place(step: BuilderStep) {
    pushHistory();
    setSteps((current) => insertBeforeTrailingMeasurements(current, step));
  }

  function changeQubitCount(delta: number) {
    // Bounded by what can be drawn, not by the editor's old six-wire grid:
    // without a ceiling here, holding "Add qubit" walks the canvas straight past
    // any width a browser will lay out.
    const next = Math.min(MAX_VIEWABLE_QUBITS, Math.max(1, qubitCount + delta));
    if (next === qubitCount) return;
    // Removing a wire also removes every gate that touches it, including a
    // two-qubit gate whose OTHER wire stays on the canvas. That used to happen
    // without a word and without an undo entry, so `CX(q0, q7)` vanished when q7
    // went and nothing on screen said why. It is now one undo step and a sentence.
    const dropped = next < qubitCount ? steps.filter((step) => step.qubits.some((q) => q >= next)).length : 0;
    // Every change of width is an undo step, not only the ones that drop gates:
    // otherwise Undo after removing an EMPTY wire skips it and takes back whatever
    // came before, which reads as Undo having done the wrong thing. (Sourcery, PR 928.)
    pushHistory();
    setQubitCount(next);
    setPendingQubits((current) => current.filter((qubit) => qubit < next));
    if (next < qubitCount) setSteps((current) => current.filter((step) => step.qubits.every((q) => q < next)));
    setBuilderMessage(dropped > 0 ? copy.qubitRemovedWithGates(dropped) : null);
  }

  function clearAll() {
    if (!steps.length) return;
    pushHistory();
    const count = steps.length;
    setSteps([]);
    setSelectedStepIds([]);
    setPendingQubits([]);
    setBuilderMessage(copy.clearedUndo(count));
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
    pushHistory();
    setSteps((current) => current.filter((step) => !selected.has(step.id)));
    setSelectedStepIds([]);
    setBuilderMessage(null);
  }

  function deleteStep(stepId: string) {
    pushHistory();
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
    pushHistory();
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

  /** Toggle one block instance open or closed, by its view-path id — pure
   * view state, see the `openStepIds` declaration above. */
  function toggleOpenStep(viewId: string) {
    setOpenStepIds((current) => {
      const next = new Set(current);
      if (next.has(viewId)) next.delete(viewId);
      else next.add(viewId);
      return next;
    });
  }

  const singleSelectedCustomStep = selectedStepIds.length === 1
    ? steps.find((step) => step.id === selectedStepIds[0] && step.gate === "CUSTOM")
    : undefined;
  const editingDefinition = singleSelectedCustomStep
    ? customGates.find((gate) => gate.id === singleSelectedCustomStep.customGateId) ?? null
    : null;

  /** Save updates the definition, so every instance changes — reflected in
   * `copy.editBlockUses` inside the panel before this ever runs. Routed
   * through the same history stack as a placement, so it is one ⌘Z away. */
  function saveEditedBlock(definitionId: string, newSteps: BuilderStep[]) {
    pushHistory();
    setCustomGates((current) => current.map((gate) => gate.id === definitionId ? { ...gate, steps: newSteps } : gate));
    setEditingBlockId(null);
    const name = customGates.find((gate) => gate.id === definitionId)?.name ?? "";
    setBuilderMessage(copy.blockSaved(name, customGateUsageCount(definitionId, steps, customGates)));
  }

  function ungroupSelected() {
    if (!singleSelectedCustomStep) return;
    const result = ungroupCustomGateStep(steps, singleSelectedCustomStep.id, customGates);
    if (!result) return;
    pushHistory();
    setSteps(result);
    setSelectedStepIds([]);
    setOpenStepIds((current) => {
      if (!current.has(singleSelectedCustomStep.id)) return current;
      const next = new Set(current);
      next.delete(singleSelectedCustomStep.id);
      return next;
    });
    const name = editingDefinition?.name ?? "";
    setBuilderMessage(copy.ungrouped(name));
  }

  /** Insert a block from the library at `startQubit`, through the same
   * `instantiateBlock` every nested block in circuit-blocks.ts already uses
   * for id-safe composition, as one undo step. The panel already refused a
   * register too narrow to hold it; this is the one place that actually
   * writes the new step, so it re-checks rather than trusting the caller. */
  function insertBlock(template: BlockTemplate, params: BlockParams, startQubit: number, requiredQubits: number) {
    if (startQubit + requiredQubits > qubitCount) return;
    const qubits = Array.from({ length: requiredQubits }, (_, index) => startQubit + index);
    let built: ReturnType<BlockTemplate["build"]>;
    try {
      built = template.build(params);
    } catch {
      return;
    }
    const instance = instantiateBlock(built, qubits, createBuilderStepId(`block-${template.key}`));
    pushHistory();
    setCustomGates((current) => [...current, ...instance.customGates]);
    setSteps((current) => insertBeforeTrailingMeasurements(current, instance.step));
    setShowBlocksPanel(false);
    setSelectedStepIds([instance.step.id]);
    setBuilderMessage(copy.blockInserted(template.name));
  }

  function growQubitsForBlock(by: number) {
    if (by <= 0) return;
    changeQubitCount(by);
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

  function applyCompression() {
    if (!compression.changed) return;
    if (syncState.kind !== "in_sync" && !compressionConfirmPending) {
      setCompressionConfirmPending(true);
      setBuilderMessage(copy.compressionOverwrite);
      return;
    }
    // Keep a distinct array even when `steps` is still the original seed. The
    // builder deliberately suppresses persistence for the untouched seed by
    // reference identity; an undo is a real edit and must not be mistaken for
    // that untouched mount state.
    const before = [...steps];
    const compressed = compression.steps;
    setSteps(compressed);
    setSelectedStepIds([]);
    setPendingQubits([]);
    setCompressionConfirmPending(false);
    setApplyConfirmPending(false);
    setCompressionSnapshot({ before, afterSignature: circuitStepSignature(compressed) });
    onApply(generateBuilderCode(compressed, qubitCount, customGates));
    setBuilderMessage(copy.compressionApplied(
      compression.removedOperations,
      compression.before.depth,
      compression.after.depth,
    ));
  }

  function undoCompression() {
    if (!compressionSnapshot || !canUndoCompression) return;
    const restored = compressionSnapshot.before;
    setSteps(restored);
    setSelectedStepIds([]);
    setPendingQubits([]);
    setCompressionSnapshot(null);
    onApply(generateBuilderCode(restored, qubitCount, customGates));
    setBuilderMessage(copy.compressionUndone);
  }

  async function runExternalCompression() {
    externalStreamRef.current?.close();
    setExternalResult(null);
    setExternalError(null);
    setExternalRunId(null);
    let request;
    try {
      request = circuitOptimizationRequest(externalCompiler, qubitCount, steps, externalLevel);
    } catch (cause) {
      setExternalError(cause instanceof Error ? cause.message : copy.externalFailed);
      return;
    }
    setExternalBusy(true);
    const seq = externalRunSeqRef.current;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: `Compile the bounded Studio circuit with ${externalCompiler}.`,
          mode: "execute",
          framework: "qiskit",
          circuit_optimization: request,
        }),
      });
      const payload = (await response.json()) as unknown;
      // Too late, in either of the two ways. Unmounted: the cleanup that closes
      // the stream has already run, so anything opened here is unreachable, and
      // there is no panel to report an error to. Superseded: the circuit,
      // compiler or level moved while this was in flight, so a result from it
      // would be measured against something the user is no longer looking at.
      // Either way, stop before opening a stream.
      if (!mountedRef.current || externalRunSeqRef.current !== seq) return;
      const submittedRunId = submittedId(payload);
      if (!response.ok || !submittedRunId) {
        throw new Error(refusalSentence(payload) ?? copy.externalFailed);
      }
      setExternalRunId(submittedRunId);
      const stream = new EventSource(`/api/runs/${encodeURIComponent(submittedRunId)}/events/stream`);
      externalStreamRef.current = stream;
      stream.addEventListener("compilation.result", (event) => {
        const wire = parseCompilerEvent(event);
        const result = externalOptimizationResultFromEvent(wire);
        if (result) {
          setExternalResult(result);
          setExternalError(null);
        } else {
          setExternalError(compilerEventReason(wire) ?? copy.externalFailed);
        }
        setExternalBusy(false);
        stream.close();
        externalStreamRef.current = null;
      });
      stream.addEventListener("run.error", (event) => {
        const wire = parseCompilerEvent(event);
        setExternalError(compilerEventReason(wire) ?? copy.externalFailed);
        setExternalBusy(false);
        stream.close();
        externalStreamRef.current = null;
      });
      stream.onerror = () => {
        setExternalError(copy.externalConnectionLost);
        setExternalBusy(false);
        stream.close();
        externalStreamRef.current = null;
      };
    } catch (cause) {
      // Same two ways of being too late. A refusal earned by the previous
      // circuit must not surface as a failure of the one now on screen.
      if (!mountedRef.current || externalRunSeqRef.current !== seq) return;
      setExternalError(cause instanceof Error ? cause.message : copy.externalFailed);
      setExternalBusy(false);
    }
  }

  function applyExternalCompression() {
    if (!externalResult || !externalCompiledSteps) return;
    const compiled = externalCompiledSteps;
    if (circuitStepSignature(compiled) === circuitStepSignature(steps)) return;
    if (syncState.kind !== "in_sync" && !externalConfirmPending) {
      setExternalConfirmPending(true);
      setBuilderMessage(copy.compressionOverwrite);
      return;
    }
    const before = [...steps];
    setSteps(compiled);
    setSelectedStepIds([]);
    setPendingQubits([]);
    setExternalConfirmPending(false);
    setApplyConfirmPending(false);
    setCompressionSnapshot({ before, afterSignature: circuitStepSignature(compiled) });
    onApply(generateBuilderCode(compiled, qubitCount, customGates));
    setBuilderMessage(copy.externalApplied(
      externalCompilerName(externalResult.compiler),
      externalResult.before.gate_count ?? 0,
      externalResult.after.gate_count ?? 0,
    ));
  }

  async function runSynthesis() {
    synthesisStreamRef.current?.close();
    setSynthesisResult(null);
    setSynthesisError(null);
    setSynthesisRunId(null);
    let request;
    try {
      request = synthesisRequest(qubitCount, steps, synthesisTarget, synthesisObjective);
    } catch (cause) {
      setSynthesisError(cause instanceof Error ? cause.message : copy.synthesisFailed);
      return;
    }
    setSynthesisBusy(true);
    const seq = synthesisRunSeqRef.current;
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          task_prompt: "Synthesize the bounded Studio circuit against a target.",
          mode: "execute",
          framework: "qiskit",
          circuit_synthesis: request,
        }),
      });
      const payload = (await response.json()) as unknown;
      // Same two ways of being too late `runExternalCompression` guards
      // against: unmounted, or superseded by an edit while the POST was in
      // flight. See that function's comment for the full reasoning.
      if (!mountedRef.current || synthesisRunSeqRef.current !== seq) return;
      const submittedRunId = submittedId(payload);
      if (!response.ok || !submittedRunId) {
        throw new Error(refusalSentence(payload) ?? copy.synthesisFailed);
      }
      setSynthesisRunId(submittedRunId);
      const stream = new EventSource(`/api/runs/${encodeURIComponent(submittedRunId)}/events/stream`);
      synthesisStreamRef.current = stream;
      stream.addEventListener("synthesis.result", (event) => {
        const wire = parseCompilerEvent(event);
        const parsed = synthesisResultEventFromEvent(wire);
        if (parsed?.accepted && parsed.result) {
          setSynthesisResult(parsed.result);
          setSynthesisError(null);
        } else {
          setSynthesisError(parsed?.reason ?? compilerEventReason(wire) ?? copy.synthesisFailed);
        }
        setSynthesisBusy(false);
        stream.close();
        synthesisStreamRef.current = null;
      });
      stream.addEventListener("run.error", (event) => {
        const wire = parseCompilerEvent(event);
        setSynthesisError(compilerEventReason(wire) ?? copy.synthesisFailed);
        setSynthesisBusy(false);
        stream.close();
        synthesisStreamRef.current = null;
      });
      stream.onerror = () => {
        setSynthesisError(copy.synthesisConnectionLost);
        setSynthesisBusy(false);
        stream.close();
        synthesisStreamRef.current = null;
      };
    } catch (cause) {
      if (!mountedRef.current || synthesisRunSeqRef.current !== seq) return;
      setSynthesisError(cause instanceof Error ? cause.message : copy.synthesisFailed);
      setSynthesisBusy(false);
    }
  }

  function applySynthesisCandidate(candidate: SynthesisCandidate) {
    if (!isSynthesisCandidateApplicable(candidate)) return;
    const compiled = builderStepsFromSynthesisCandidate(candidate);
    if (!compiled.length || circuitStepSignature(compiled) === circuitStepSignature(steps)) return;
    if (syncState.kind !== "in_sync" && synthesisConfirmPending !== candidate.compiler) {
      setSynthesisConfirmPending(candidate.compiler);
      setBuilderMessage(copy.compressionOverwrite);
      return;
    }
    const before = [...steps];
    setSteps(compiled);
    setSelectedStepIds([]);
    setPendingQubits([]);
    setSynthesisConfirmPending(null);
    setApplyConfirmPending(false);
    setExternalConfirmPending(false);
    setCompressionSnapshot({ before, afterSignature: circuitStepSignature(compiled) });
    onApply(generateBuilderCode(compiled, qubitCount, customGates));
    setBuilderMessage(copy.synthesisApplied(externalCompilerName(candidate.compiler)));
  }

  return (
    <StudioPanelSurface
      className="mj-studio-canvas"
      label={copy.canvasLabel}
      heading={copy.generatedPreview}
      meta={(
        <>
          {liveSync ? <span className="mj-studio-live-pill" title={copy.liveSyncHint}>{copy.liveSync}</span> : null}
          <span className="mj-mono-muted">
            {frameworkLabel(framework)} · {qubitCount}q · {seed.readOnly ? seed.operationCount : steps.length} ops
            {seed.readOnly ? ` · ${copy.readOnly}` : ""}
          </span>
        </>
      )}
      popout={popout}
      onTogglePopout={onTogglePopout}
      copy={copy}
      hidden={hidden}
      region={region}
    >
      {/* One toolbar above the diagram: the palette in labelled groups, then
          the edits you make while building. The edit row used to sit below the
          whole compression section, ~800px from the wires it acted on. */}
      {seed.readOnly ? null : (
        <div className="mj-studio-canvas-toolbar">
          <div className="mj-builder-palette" role="toolbar" aria-label={copy.palette} data-tour="studio-builder">
            {PALETTE_GROUPS.map((group) => (
              <div className="mj-builder-palette-group" role="group" aria-label={copy.paletteGroups[group.id]} key={group.id}>
                <span className="mj-builder-palette-label" aria-hidden="true">{copy.paletteGroups[group.id]}</span>
                <div className="mj-builder-palette-gates">
                  {group.gates.map((gate) => {
                    const key = gateShortcutKey(gate);
                    return (
                      <button
                        key={gate}
                        type="button"
                        className={`mj-builder-gate${armed === gate ? " is-active" : ""}`}
                        data-family={group.family}
                        aria-pressed={armed === gate}
                        aria-keyshortcuts={key ?? undefined}
                        title={`${copy.gateNames[gate] ?? gate}${key ? ` · ${key}` : ""}`}
                        onClick={() => armGate(gate)}
                      >
                        {gate}
                      </button>
                    );
                  })}
                  {group.id === angleGroupId ? (
                    // CP and RZZ need the same angle input rotations do, but
                    // live in "more" (so that group's label stays accurate for
                    // CX/CZ/SWAP). Rather than duplicating the control in both
                    // rows, it follows whichever group the armed gate is in.
                    <label className="mj-builder-angle" data-armed={rotationArmed ? "true" : undefined}>
                      <span className="sr-only">{copy.angleLabel}</span>
                      <select value={angle} onChange={(event) => setAngle(event.target.value)} disabled={!rotationArmed} title={copy.angleLabel}>
                        {ANGLE_OPTIONS.map((option) => <option key={option} value={option}>{option.replace("pi", "π").replace("*", "")}</option>)}
                      </select>
                    </label>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
          <div className="mj-builder-controls">
            <button className="mj-secondary-button" type="button" onClick={undoLast} disabled={!history.length} title={`${copy.undo} · ⌘/Ctrl Z`}>{copy.undo}</button>
            <button className="mj-secondary-button" type="button" onClick={deleteSelected} disabled={!selectedStepIds.length}>{copy.deleteSelected}</button>
            {selectedStepIds.length >= 2 ? <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(true)}>{copy.groupSelected}</button> : null}
            {singleSelectedCustomStep && editingDefinition && !editingDefinition.opaque ? (
              <button className="mj-secondary-button" type="button" onClick={() => setEditingBlockId(singleSelectedCustomStep.customGateId ?? null)}>{copy.editBlock}</button>
            ) : null}
            {singleSelectedCustomStep && editingDefinition && !editingDefinition.opaque ? (
              <button className="mj-secondary-button" type="button" onClick={ungroupSelected}>{copy.ungroupBlock}</button>
            ) : null}
            <button className="mj-secondary-button" type="button" onClick={() => setShowBlocksPanel(true)}>{copy.blocksPanelOpen}</button>
            <button className="mj-secondary-button" type="button" onClick={clearAll} disabled={!steps.length}>{copy.clearAll}</button>
            <span className="mj-builder-controls-divider" aria-hidden="true" />
            <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(-1)} disabled={qubitCount <= 1}>{copy.removeQubit}</button>
            <button className="mj-secondary-button" type="button" onClick={() => changeQubitCount(1)} disabled={qubitCount >= MAX_VIEWABLE_QUBITS}>{copy.addQubit}</button>
            <span className="mj-builder-controls-spacer" aria-hidden="true" />
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
        </div>
      )}

      {!seed.readOnly && customGates.length ? (
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

      {seed.readOnly ? (
        <div className="mj-circuit-sync mj-circuit-sync--unrepresentable" role="status">
          <span>
            {seed.readOnlyReasons.includes("truncated")
              ? copy.circuitReadOnlyTruncated(steps.length, seed.operationCount)
              : copy.circuitReadOnly}
          </span>
        </div>
      ) : syncState.kind === "in_sync" ? null : (
        <div className={`mj-circuit-sync mj-circuit-sync--${syncState.kind}`} role="status">
          <span>{syncState.kind === "diverged" ? copy.canvasOutOfDate : copy.canvasBeyondBuilder}</span>
          {syncState.kind === "diverged" ? (
            <button className="mj-secondary-button" type="button" onClick={onRebuildFromCode}>{copy.rebuildFromCode}</button>
          ) : null}
        </div>
      )}

      {!seed.readOnly && showCustomGateForm ? (
        <form className="mj-builder-custom-form" onSubmit={(event) => { event.preventDefault(); createCustomGate(); }}>
          <label>
            <span>{copy.customGates}</span>
            <input autoFocus value={customGateName} onChange={(event) => setCustomGateName(event.target.value)} placeholder={copy.customGatePlaceholder} />
          </label>
          <button className="mj-primary-button" type="submit">{copy.createCustomGate}</button>
          <button className="mj-secondary-button" type="button" onClick={() => setShowCustomGateForm(false)}>{copy.cancelCustomGate}</button>
        </form>
      ) : null}

      <div className={`mj-circuit-workbench${seed.readOnly ? " is-readonly" : ""}`}>
        <CircuitDiagram
          qubitCount={qubitCount}
          steps={steps}
          customGates={customGates}
          ariaLabel={copy.circuitAria(frameworkLabel(framework))}
          interaction={seed.readOnly ? undefined : {
            selectedStepIds,
            pendingQubits,
            selectedLabel,
            onPlaceOnQubit: placeOnQubit,
            onSelectStep: selectStep,
            onStepKeyDown: handleStepKeyDown,
            openStepIds,
            onToggleOpen: toggleOpenStep,
            closeBlockLabel: copy.closeBlock,
          }}
          playhead={seed.readOnly ? null : playheadMoment}
          onInspect={setInspection}
        />
        {seed.readOnly ? null : (
          <PlayheadPanel
            qubitCount={qubitCount}
            steps={steps}
            customGates={customGates}
            columns={moments.columns}
            count={moments.count}
            moment={playheadMoment}
            onMoment={setPlayhead}
            copy={copy}
            locale={locale}
          />
        )}
      </div>
      {!seed.readOnly && activeExample ? (
        <ExampleNotesPanel
          example={activeExample}
          steps={steps}
          columns={moments.columns}
          qubitCount={qubitCount}
          customGates={customGates}
          moment={playheadMoment}
          atEnd={playheadMoment >= moments.count}
          locale={locale}
          copy={copy}
        />
      ) : null}
      {inspection && !hidden ? <GateInspectorCard inspection={inspection} customGates={customGates} copy={copy} /> : null}
      {showBlocksPanel ? (
        <BlocksPanel
          qubitCount={qubitCount}
          onInsert={insertBlock}
          onGrowQubits={growQubitsForBlock}
          onClose={() => setShowBlocksPanel(false)}
          copy={copy}
        />
      ) : null}
      {editingBlockId ? (() => {
        const definition = customGates.find((gate) => gate.id === editingBlockId);
        return definition ? (
          <EditBlockPanel
            definition={definition}
            topLevelSteps={steps}
            customGates={customGates}
            copy={copy}
            onSave={(newSteps) => saveEditedBlock(definition.id, newSteps)}
            onCancel={() => setEditingBlockId(null)}
          />
        ) : null;
      })() : null}

      <div className="mj-studio-canvas-footer" aria-live="polite">
        <span>{seed.readOnly ? copy.readOnlyHint : builderMessage ?? (pendingQubits.length ? copy.pickTarget : selectedStepIds.length ? copy.selectedCount(selectedStepIds.length) : steps.length ? copy.builderHint : copy.builderEmpty)}</span>
        <span className="mj-mono-muted">{steps.length ? (steps.length <= 40 ? steps.map((step) => builderStepLabel(step, customGates)).join(" → ") : `${steps.slice(0, 20).map((step) => builderStepLabel(step, customGates)).join(" → ")} → … (${steps.length} ops)`) : "—"}</span>
      </div>

      {seed.readOnly ? null : (
        <section className="mj-studio-optimizer" aria-labelledby="studio-optimizer-heading" data-tour="studio-compress">
          <header className="mj-studio-optimizer-head">
            <div>
              <h3 id="studio-optimizer-heading">{copy.compression}</h3>
              <p>{copy.compressionIntro}</p>
            </div>
          </header>

          <div className="mj-studio-optimizer-panel">
            <span className="mj-section-label">{copy.optimizationLocal}</span>
            <fieldset className="mj-studio-compression-strategies">
              <legend className="mj-section-label">{copy.compressionStrategy}</legend>
              <div>
                {compressionOptions.map((option) => (
                  <label key={option.value} data-selected={compressionStrategy === option.value ? "true" : undefined}>
                    <input
                      type="radio"
                      name="studio-compression-strategy"
                      value={option.value}
                      checked={compressionStrategy === option.value}
                      onChange={() => setCompressionStrategy(option.value)}
                    />
                    <span><strong>{option.label}</strong><small>{option.description}</small></span>
                  </label>
                ))}
              </div>
            </fieldset>

            <dl className="mj-studio-compression-metrics" aria-live="polite">
              <CompressionMetric label={copy.compressionOperations} before={compression.before.operations} after={compression.after.operations} />
              <CompressionMetric label={copy.compressionDepth} before={compression.before.depth} after={compression.after.depth} />
              <CompressionMetric label={copy.compressionTwoQubit} before={compression.before.twoQubitOperations} after={compression.after.twoQubitOperations} />
            </dl>

            <p className="mj-studio-compression-boundary">{copy.compressionBoundary}</p>
            {!compression.changed ? <p className="mj-studio-compression-empty" role="status">{copy.compressionNoChange}</p> : null}
            <div className="mj-studio-compression-actions">
              <button className="mj-primary-button" type="button" onClick={applyCompression} disabled={!compression.changed}>
                {compressionConfirmPending ? copy.compressionConfirmApply : copy.compressionApply}
              </button>
              {compressionConfirmPending ? (
                <button className="mj-secondary-button" type="button" onClick={() => { setCompressionConfirmPending(false); setBuilderMessage(null); }}>{copy.cancel}</button>
              ) : null}
              {canUndoCompression ? <button className="mj-secondary-button" type="button" onClick={undoCompression}>{copy.compressionUndo}</button> : null}
            </div>
          </div>

          {/* Folded by default: a compiler run is a deliberate, heavier detour
              from the quick in-browser rewrites above, not a second front-door
              choice. Closed keeps the fast path the thing everyone sees first. */}
          <details className="mj-sim-details">
            <summary>{copy.optimizationExternal}</summary>
            <div className="mj-studio-optimizer-panel">
              <div className="mj-studio-external-compression-head">
                <div>
                  <h4>{copy.externalCompilation}</h4>
                  <p>{copy.externalIntro}</p>
                </div>
                <label>
                  <span>{copy.externalLevel}</span>
                  <select value={externalLevel} onChange={(event) => setExternalLevel(Number(event.target.value))} disabled={externalBusy}>
                    {[1, 2, 3].map((level) => <option key={level} value={level}>{copy.externalLevelOption(level)}</option>)}
                  </select>
                  <small>{copy.externalLevelHelp}</small>
                </label>
              </div>
              <fieldset className="mj-studio-compression-strategies mj-studio-compiler-grid">
                <legend className="mj-section-label">{copy.externalCompiler}</legend>
                <div>
                  {externalCompilerOptions.map((option) => (
                    <label key={option.value} data-selected={externalCompiler === option.value ? "true" : undefined}>
                      <input
                        type="radio"
                        name="studio-external-compiler"
                        value={option.value}
                        checked={externalCompiler === option.value}
                        disabled={externalBusy}
                        onChange={() => setExternalCompiler(option.value)}
                      />
                      <span className="mj-studio-compiler-name">
                        <strong>{option.label}</strong>
                        {option.recommended ? <em>{copy.externalRecommended}</em> : null}
                      </span>
                      <i aria-hidden="true">✓</i>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="mj-studio-compression-boundary">{copy.externalBoundary}</p>
              <div className="mj-studio-compression-actions">
                <button className="mj-primary-button" type="button" disabled={externalBusy || !steps.length} onClick={() => void runExternalCompression()}>
                  {externalBusy ? copy.externalRunning : copy.externalRunSelected(externalCompilerName(externalCompiler))}
                </button>
                {externalRunId ? <a href={`/run/${externalRunId}`}>{copy.externalOpenRun} →</a> : null}
              </div>
              {externalError ? <p className="mj-studio-external-error" role="alert">{externalError}</p> : null}
              {externalResult ? (
                <div className="mj-studio-external-result" role="status">
                  <div className="mj-studio-external-result-head">
                    <strong>{copy.externalPreview(externalCompilerName(externalResult.compiler), externalResult.compiler_version)}</strong>
                    <span className="mj-mono-muted">{externalResult.before.gate_count ?? 0} → {externalResult.after.gate_count ?? 0} gates</span>
                  </div>
                  <dl className="mj-studio-compression-metrics">
                    <CompressionMetric label={copy.compressionOperations} before={externalResult.before.gate_count ?? 0} after={externalResult.after.gate_count ?? 0} />
                    <CompressionMetric label={copy.compressionDepth} before={externalResult.before.depth ?? 0} after={externalResult.after.depth ?? 0} />
                    <CompressionMetric label={copy.compressionTwoQubit} before={externalResult.before.two_qubit_gate_count ?? 0} after={externalResult.after.two_qubit_gate_count ?? 0} />
                  </dl>
                  <p>{copy.externalUnverified}</p>
                  {(externalResult.warnings ?? []).length ? (
                    <ul>{(externalResult.warnings ?? []).map((warning) => <li key={warning}>{warning}</li>)}</ul>
                  ) : null}
                  <div className="mj-studio-compression-actions">
                    <button
                      className="mj-primary-button"
                      type="button"
                      disabled={externalCompiledSteps === null || circuitStepSignature(externalCompiledSteps) === circuitStepSignature(steps)}
                      onClick={applyExternalCompression}
                    >
                      {externalConfirmPending ? copy.externalConfirmApply : copy.externalApply}
                    </button>
                    {externalConfirmPending ? (
                      <button className="mj-secondary-button" type="button" onClick={() => { setExternalConfirmPending(false); setBuilderMessage(null); }}>{copy.cancel}</button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </details>

          {/* Proposal 3: a second, target-aware entry point into the same
              compiler lane above. Folded by default for the same reason. */}
          <details className="mj-sim-details">
            <summary>{copy.synthesisHeading}</summary>
            <div className="mj-studio-optimizer-panel">
              <div className="mj-studio-external-compression-head">
                <div>
                  <h4>{copy.synthesisHeading}</h4>
                  <p>{copy.synthesisIntro}</p>
                </div>
              </div>

              <fieldset className="mj-studio-compression-strategies">
                <legend className="mj-section-label">{copy.synthesisTargetLabel}</legend>
                <div>
                  <label data-selected={synthesisTargetMode === "generic" ? "true" : undefined}>
                    <input
                      type="radio"
                      name="studio-synthesis-target-mode"
                      checked={synthesisTargetMode === "generic"}
                      disabled={synthesisBusy}
                      onChange={() => setSynthesisTargetMode("generic")}
                    />
                    <span>{copy.synthesisTargetGeneric}</span>
                  </label>
                  <label data-selected={synthesisTargetMode === "device" ? "true" : undefined}>
                    <input
                      type="radio"
                      name="studio-synthesis-target-mode"
                      checked={synthesisTargetMode === "device"}
                      disabled={synthesisBusy || synthesisDevicesFailed || synthesisDevices?.length === 0}
                      onChange={() => setSynthesisTargetMode("device")}
                    />
                    <span>{copy.synthesisTargetDevice}</span>
                  </label>
                </div>
              </fieldset>

              {synthesisTargetMode === "generic" ? (
                <label>
                  <span>{copy.synthesisTargetGeneric}</span>
                  <select
                    value={synthesisConnectivity}
                    disabled={synthesisBusy}
                    onChange={(event) => setSynthesisConnectivity(event.target.value as SynthesisConnectivity)}
                  >
                    {SYNTHESIS_CONNECTIVITIES.map((connectivity) => (
                      <option key={connectivity} value={connectivity}>
                        {synthesisConnectivityLabel(connectivity, copy)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label>
                  <span>{copy.synthesisTargetDevice}</span>
                  {synthesisDevicesFailed || synthesisDevices?.length === 0 ? <small>{copy.synthesisDeviceUnavailable}</small> : null}
                  {synthesisDevices === null && !synthesisDevicesFailed ? <small>{copy.synthesisDeviceLoading}</small> : null}
                  {synthesisDevices?.length ? (
                    <select
                      value={synthesisDeviceId ?? ""}
                      disabled={synthesisBusy}
                      onChange={(event) => setSynthesisDeviceId(event.target.value || null)}
                    >
                      <option value="" disabled>—</option>
                      {synthesisDevices.map((device) => (
                        <option key={device.device_id} value={device.device_id}>{device.display_name}</option>
                      ))}
                    </select>
                  ) : null}
                </label>
              )}

              <label>
                <span>{copy.synthesisObjectiveLabel}</span>
                <select
                  value={synthesisObjective}
                  disabled={synthesisBusy}
                  onChange={(event) => setSynthesisObjective(event.target.value as SynthesisObjective)}
                >
                  {SYNTHESIS_OBJECTIVES.map((objective) => (
                    <option key={objective} value={objective}>{synthesisObjectiveLabel(objective, copy)}</option>
                  ))}
                </select>
              </label>

              <div className="mj-studio-compression-actions">
                <button
                  className="mj-primary-button"
                  type="button"
                  disabled={synthesisBusy || !steps.length || (synthesisTargetMode === "device" && !synthesisDeviceId)}
                  onClick={() => void runSynthesis()}
                >
                  {synthesisBusy ? copy.synthesisRunning : copy.synthesisRun}
                </button>
                {synthesisRunId ? <a href={`/run/${synthesisRunId}`}>{copy.synthesisOpenRun} →</a> : null}
              </div>
              {synthesisError ? <p className="mj-studio-external-error" role="alert">{synthesisError}</p> : null}

              {synthesisResult ? (
                <div className="mj-studio-external-result" role="status">
                  <p className="mj-mono-muted">{synthesisResult.resolved_note}</p>
                  <table>
                    <thead>
                      <tr>
                        <th>{copy.synthesisColumnCompiler}</th>
                        <th>{copy.synthesisColumnStatus}</th>
                        <th>{copy.synthesisColumnGates}</th>
                        <th>{copy.synthesisColumnDepth}</th>
                        <th>{copy.synthesisColumnTwoQubit}</th>
                        <th>{copy.synthesisColumnTCount}</th>
                        <th>{copy.synthesisColumnEquivalence}</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {synthesisResult.candidates.map((candidate) => {
                        const best = synthesisResult.best_candidate_compiler === candidate.compiler;
                        const applicable = isSynthesisCandidateApplicable(candidate);
                        const succeeded = candidate.status === "succeeded";
                        return (
                          <tr key={candidate.compiler} data-best={best ? "true" : undefined}>
                            <td>
                              {externalCompilerName(candidate.compiler)}
                              {best ? <strong className="mj-mono-muted"> · {copy.synthesisBest}</strong> : null}
                            </td>
                            <td>{synthesisStatusLabel(candidate, copy)}</td>
                            {succeeded ? (
                              <>
                                <td>{candidate.after?.gate_count}</td>
                                <td>{candidate.after?.depth}</td>
                                <td>{candidate.after?.two_qubit_gate_count}</td>
                                <td>{candidate.after?.t_count}</td>
                                <td>{synthesisEquivalenceLabel(candidate.equivalence, copy)}</td>
                              </>
                            ) : (
                              <td colSpan={5} className="mj-mono-muted">{candidate.reason}</td>
                            )}
                            <td>
                              {applicable ? (
                                <button
                                  className="mj-secondary-button"
                                  type="button"
                                  onClick={() => applySynthesisCandidate(candidate)}
                                >
                                  {synthesisConfirmPending === candidate.compiler ? copy.synthesisConfirmUse : copy.synthesisUse}
                                </button>
                              ) : succeeded ? (
                                <span className="mj-mono-muted" title={candidate.equivalence?.detail}>
                                  {copy.synthesisCannotApply}
                                </span>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {synthesisConfirmPending ? (
                    <button
                      className="mj-secondary-button"
                      type="button"
                      onClick={() => { setSynthesisConfirmPending(null); setBuilderMessage(null); }}
                    >
                      {copy.cancel}
                    </button>
                  ) : null}
                  {canUndoCompression ? (
                    <div className="mj-studio-compression-actions">
                      <button className="mj-secondary-button" type="button" onClick={undoCompression}>{copy.synthesisUndo}</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </details>
        </section>
      )}

    </StudioPanelSurface>
  );
}

function CompressionMetric({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div data-improved={after < before ? "true" : undefined}>
      <dt>{label}</dt>
      <dd><span>{before}</span><span aria-hidden="true">→</span><strong>{after}</strong></dd>
    </div>
  );
}

function parseCompilerEvent(event: Event): unknown {
  const data = (event as MessageEvent).data;
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function compilerEventReason(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.reason === "string") return record.reason;
  if (typeof record.message === "string") return record.message;
  return null;
}

function externalCompilerName(compiler: ExternalCircuitCompiler): string {
  if (compiler === "qiskit") return "Qiskit";
  if (compiler === "cirq") return "Cirq";
  if (compiler === "pytket") return "pytket";
  if (compiler === "pennylane") return "PennyLane";
  if (compiler === "pyzx") return "PyZX";
  return "BQSKit";
}

function synthesisConnectivityLabel(connectivity: SynthesisConnectivity, copy: StudioCopy): string {
  if (connectivity === "all_to_all") return copy.synthesisConnectivityAllToAll;
  if (connectivity === "line") return copy.synthesisConnectivityLine;
  if (connectivity === "grid") return copy.synthesisConnectivityGrid;
  return copy.synthesisConnectivityHeavyHex;
}

function synthesisObjectiveLabel(objective: SynthesisObjective, copy: StudioCopy): string {
  if (objective === "depth") return copy.synthesisObjectiveDepth;
  if (objective === "two_qubit_count") return copy.synthesisObjectiveTwoQubit;
  return copy.synthesisObjectiveTCount;
}

function synthesisStatusLabel(candidate: SynthesisCandidate, copy: StudioCopy): string {
  if (candidate.status === "succeeded") return copy.synthesisStatusSucceeded;
  if (candidate.status === "unsupported") return copy.synthesisStatusUnsupported;
  return copy.synthesisStatusFailed;
}

function synthesisEquivalenceLabel(equivalence: SynthesisCandidate["equivalence"], copy: StudioCopy): string {
  if (!equivalence) return "";
  if (!equivalence.checked) return copy.synthesisNotChecked;
  return equivalence.equivalent ? copy.synthesisEquivalent : copy.synthesisNotEquivalent;
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
      heading={heading}
      popout={popout}
      onTogglePopout={onTogglePopout}
      region={region}
      copy={copy}
      controls={
        <>
          {/* The framework picker lived in the inspector, one panel away from
              the code it retargets, which is why the conversions read as absent
              (Owner Inbox 2026-07-31). All ten are offered here; the seven that
              cannot be executed say so in the option itself. */}
          <label className="mj-studio-framework-select" data-tour="studio-framework">
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
        </details>
      </div>
    </StudioPanelSurface>
  );
}

/**
 * The chrome every Studio tab shares: a heading, its own controls, and a
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
      {/* One title per card: the tab strip above already names the section, so the
          head says only what the tab does not — which framework, which circuit. */}
      <div className="mj-studio-surface-head">
        <div>
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
  circuit,
  synchronized,
  complete,
  sourceCode,
  onOpenVisual,
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
  locale,
  limits,
}: {
  artifact: LibraryArtifact | null;
  eligibility: CpuSimulationEligibility;
  circuit: ParsedBuilderCircuit;
  synchronized: boolean;
  complete: boolean;
  sourceCode: string;
  onOpenVisual: () => void;
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
  locale: PublicLocale;
  limits: CpuSimulationLimits;
}) {
  const currentRecords = eligibility.eligible
    ? records.filter((record) => (
      record.sourceFingerprint === eligibility.sourceFingerprint
      && record.interchangeFingerprint === eligibility.interchangeFingerprint
    ))
    : [];
  return (
    <section className="mj-studio-surface mj-studio-simulation-panel" data-tour="studio-simulation-panel" aria-label={copy.simulation} {...panelRegion("studio", "simulation")}>
      <div className="mj-studio-surface-head">
        <div>
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
            <span className="mj-studio-lane-status" data-tone={eligibility.eligible ? "ok" : "warn"}>{eligibility.eligible ? copy.laneReady : copy.cpuUnavailableShort}</span>
          </div>
        <p className="mj-studio-simulation-boundary">{copy.simulationBoundary}</p>

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
            // Wrapped so the button sizes to its label. The lane is a grid, and
            // a bare button in it stretched to the full panel width — the
            // loudest object on the tab was a control for the weakest of the
            // three lanes.
            <div className="mj-studio-lane-action">
              <button className="mj-primary-button" type="button" disabled={busy} onClick={onRun} title="⌘/Ctrl ↵">
                {busy ? copy.starting : currentRecords.length ? copy.rerunCpuSimulation : copy.runCpuSimulation}
              </button>
            </div>
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

        {/* A heading, a count of zero and a sentence saying the count is zero
            took a whole band of the tab to say one thing three times. With no
            records the section is the sentence; the heading and the counter
            come back the moment there is something to count. */}
        <section className="mj-studio-simulation-records" data-empty={records.length ? undefined : "true"} aria-label={copy.simulationResults}>
          {records.length ? (
            <>
              <div className="mj-studio-simulation-records-head"><span className="mj-section-label">{copy.simulationResults}</span><span className="mj-mono-muted">{records.length}</span></div>
              {records.map((record, index) => <SimulationRecordCard record={record} family={artifact?.family ?? null} copy={copy} locale={locale} latest={index === 0} key={record.id} />)}
            </>
          ) : (
            <p className="mj-studio-empty">{copy.simulationNoRecords}</p>
          )}
        </section>

        <StudioParameterSweep circuit={circuit} synchronized={synchronized} complete={complete} sourceCode={sourceCode} locale={locale} onOpenVisual={onOpenVisual} />

        {/* After the CPU records, not between the run button and its result:
            you run, then you read, then you consider hardware (UX pass 6). */}
        <div className="mj-studio-lane">
          <QpuLane artifact={artifact} shots={shots} copy={copy} limits={limits} workingOut={WORKSPACE_COPY[locale].hardwareRuns.workingOut} />
        </div>
      </div>
    </section>
  );
}

function SimulationRecordCard({ record, family, copy, locale, latest = false }: { record: CpuSimulationRecord; family: string | null; copy: StudioCopy; locale: PublicLocale; latest?: boolean }) {
  const data = simulationChartData(record.counts, record.shots);
  const reading = data ? simulationReading(family, data) : null;
  return (
    <article className="mj-studio-simulation-record" data-latest={latest ? "true" : undefined}>
      <div className="mj-studio-simulation-record-head">
        <strong>{copy.simulationRecord}{latest ? <span className="mj-studio-record-badge">{copy.latestRecord}</span> : null}</strong>
        <time className="mj-mono-muted" dateTime={record.createdAt} title={record.createdAt}>{formatRecordTime(record.createdAt, locale)}</time>
      </div>
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

/**
 * The sentence a refused hardware submission puts on screen.
 *
 * Keyed on the refusal's `reason` rather than on its message, because the
 * control plane writes English and this lane renders Japanese too — the code is
 * the only part of a refusal a locale can translate. Anything without a reason
 * this lane knows falls back to the server's own sentence, which is still far
 * better than what was there before the client learned to read the problem
 * document at all: every refusal, whatever it said, arrived as its status code.
 *
 * A $0 ceiling gets its own sentence. "0 of your $0 weekly budget is used" is
 * arithmetic, not an explanation — what a free account needs to be told is that
 * billed hardware is not in the plan and the free queue still is.
 */
function hardwareRefusalText(cause: unknown, copy: StudioCopy): string {
  if (!(cause instanceof QpuSubmissionRefused)) {
    return cause instanceof Error ? cause.message : copy.hardwareEstimateFailed;
  }
  if (cause.reason === "qpu_spend_exhausted" && cause.estimateUsd !== null && cause.limitUsd !== null) {
    return cause.limitUsd === 0
      ? copy.hardwareSpendFreeTier(formatUsd(cause.estimateUsd))
      : copy.hardwareSpendExhausted(
          formatUsd(cause.estimateUsd),
          formatUsd(cause.limitUsd),
          formatUsd(cause.spentUsd ?? 0),
        );
  }
  if (cause.reason) return copy.hardwareBlockedReason(cause.reason);
  return cause.message;
}

function QpuLane({ artifact, shots, copy, limits, workingOut }: { artifact: LibraryArtifact | null; shots: string; copy: StudioCopy; limits: CpuSimulationLimits; workingOut: string }) {
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
  // Zero-noise extrapolation, off by default: it sends three circuits and uses
  // about three times the provider allowance, which the panel says before the
  // box can be ticked (proposal 5, increment 4).
  const [zne, setZne] = useState(false);

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

  const selectedBackend = backends?.find((item) => item.device_id === selected) ?? null;
  // Only a device Leona can submit to offers ZNE, and a box ticked on one device
  // does not carry over to a priced-only one.
  const zneOn = zne && selectedBackend !== null && !isPricedOnly(selectedBackend);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setEstimating(true);
    setEstimateError(false);
    fetchQpuEstimate(selected, shotCount, { zne: zneOn })
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
  }, [selected, shotCount, zneOn]);

  const backend = selectedBackend;
  const verified = artifact?.status === "verified" || artifact?.status === "verified_caveats";
  // Only a stored interchange program is submittable: the qasm field also
  // carries human-readable availability notes for artifacts without one.
  const submittableQasm = artifact?.qasm && looksLikeOpenQasm3(artifact.qasm) ? artifact.qasm : null;
  const pricedOnly = backend !== null && isPricedOnly(backend);
  const circuitFingerprint = submittableQasm ? sourceFingerprint(submittableQasm) : null;
  // The run the panel shows and polls: only ever one of the circuit on screen.
  // `qpuRun` can hold another circuit's run (a lookup, poll or submission that
  // answered after the reader switched artifacts); `runForCircuit` is what keeps
  // that from being displayed or polled. See its doc comment.
  const shownRun = runForCircuit(qpuRun, circuitFingerprint);
  const canSubmit = Boolean(
    gate?.submission_available && verified && submittableQasm && selected && !pricedOnly && !submitting,
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
      zne: zneOn,
    })
      .then(setQpuRun)
      .catch((cause: unknown) => {
        setSubmitError(hardwareRefusalText(cause, copy));
      })
      .finally(() => setSubmitting(false));
  }

  // Bring back the latest run of THIS circuit: after a reload (review finding on
  // PR 957: a finished run used to vanish with the tab's memory), and after the
  // reader switches to another circuit. Matched on the same fingerprint the
  // submission sent, so it can only restore a run of the exact program on
  // screen, never a neighbour's.
  //
  // A leftover run of the previous circuit is cleared first, which also stops
  // its polling (the poll below follows `shownRun`, which is already null for
  // it). The lookup's answer goes through `afterRestore`: a run of this circuit
  // that arrived meanwhile wins, and switching again cancels this lookup
  // before it can write. A failed lookup changes nothing, since a history that
  // could not be read says nothing about whether a run exists.
  useEffect(() => {
    if (shownRun) return;
    setQpuRun((current) => (current && current.source_fingerprint !== circuitFingerprint ? null : current));
    if (!circuitFingerprint) return;
    let cancelled = false;
    fetchLatestQpuRunFor(circuitFingerprint)
      .then((latest) => {
        if (!cancelled) setQpuRun((current) => afterRestore(current, latest, circuitFingerprint));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [circuitFingerprint, shownRun]);

  // A submitted job settles on the provider's schedule; poll the durable
  // record until it reports a terminal state. Follows `shownRun`, so switching
  // circuits stops it, and an answer that lands after the switch (or after the
  // record was replaced) is dropped rather than written over the new state.
  useEffect(() => {
    if (!shownRun || !isUnfinishedRun(shownRun)) return;
    const polledId = shownRun.id;
    let cancelled = false;
    const timer = window.setInterval(() => {
      fetchQpuRun(polledId)
        .then((next) => {
          if (!cancelled) setQpuRun((current) => (current && current.id === polledId ? next : current));
        })
        .catch(() => undefined);
    }, QPU_RUN_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [shownRun]);

  return (
    <div className="mj-qpu-lane" data-tour="studio-qpu">
      {/* Was a permanently disabled button, sitting directly above the device
          picker and submit control that DO work — so the lane read as switched
          off while its real flow was live underneath. It was only ever a label;
          it is one now. */}
      <span className="mj-qpu-lane-title">{copy.qpuExecution}</span>
      {/* The whole record, across circuits and machines. Here as well as in the
          sidebar because this panel is where someone who just ran a job looks
          for the rest of them. */}
      <p className="mj-qpu-history-link"><a href="/studio/hardware">{copy.hardwareRunHistory}</a></p>
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
                      {/* Every shot the provider runs, which with ZNE is three circuits' worth. */}
                      <div><dt>{copy.hardwareShotFees((estimate.total_shots ?? estimate.shots).toLocaleString("en-US"))}</dt><dd>{estimate.shot_fees_usd !== null ? formatUsd(estimate.shot_fees_usd) : "—"}</dd></div>
                      <div><dt>{copy.hardwareEstimatedTotal}</dt><dd><strong>{estimate.total_usd !== null ? formatUsd(estimate.total_usd) : "—"}</strong></dd></div>
                    </dl>
                    {(estimate.circuits ?? 1) > 1 ? (
                      <p className="mj-qpu-note">
                        {copy.hardwareZnePriced(String(estimate.circuits), (estimate.total_shots ?? estimate.shots).toLocaleString("en-US"))}
                      </p>
                    ) : null}
                    <p className="mj-qpu-disclaimer">{estimate.disclaimer}</p>
                  </>
                ) : (
                  <p className="mj-qpu-disclaimer">{estimate.allowance_note}</p>
                )
              ) : null}
              <p className="mj-qpu-source"><a href={backend.rate_source} target="_blank" rel="noreferrer">{copy.hardwareRateSource} ↗</a></p>
            </div>
          ) : null}
          {/* Before submitting: what the device's published error figures predict
              for the exact program that would be sent (lib/qpu-noise.ts). */}
          {backend && submittableQasm ? (
            <QpuNoisyPreview backend={backend} qasm={submittableQasm} shots={shotCount} limits={limits} copy={copy} />
          ) : null}
          {backend && !pricedOnly ? (
            // The cost is stated beside the box, before it is ticked: what is
            // sent, how many shots that is, and what it does to the allowance.
            <label className="mj-qpu-zne-toggle">
              <input type="checkbox" checked={zne} disabled={submitting} onChange={(event) => setZne(event.target.checked)} />
              <span>
                <strong>{copy.hardwareZneOption}</strong>
                <small>
                  {copy.hardwareZneCost(
                    String(ZNE_SCALE_FACTORS.length),
                    (shotCount * ZNE_SCALE_FACTORS.length).toLocaleString("en-US"),
                    shotCount.toLocaleString("en-US"),
                  )}
                </small>
              </span>
            </label>
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
          {pricedOnly ? <p className="mj-qpu-note">{copy.hardwarePricedOnly}</p> : null}
          {gate && !gate.submission_available ? <p className="mj-qpu-note">{copy.hardwareBlockedReason(gate.blocked_reason ?? "")}</p> : null}
          {submitError ? <p className="mj-qpu-note" role="alert">{submitError}</p> : null}
          {shownRun ? (
            <div className="mj-qpu-record" role="status">
              <dl className="mj-studio-contract">
                <div><dt>{copy.hardwareJobStatus}</dt><dd>{shownRun.status}</dd></div>
                {shownRun.provider_job_id ? <div><dt>{copy.hardwareJobId}</dt><dd>{shownRun.provider_job_id}</dd></div> : null}
                {backendNameOf(shownRun) ? <div><dt>{copy.hardwareMachine}</dt><dd><code>{backendNameOf(shownRun)}</code></dd></div> : null}
                {shownRun.error ? <div><dt>{copy.hardwareJobError}</dt><dd>{shownRun.error}</dd></div> : null}
              </dl>
              {shownRun.raw_counts ? (
                <div className="mj-studio-simulation-counts">
                  <span className="mj-section-label">{copy.hardwareRawCounts}</span>
                  <code>{Object.entries(shownRun.raw_counts).sort(([, left], [, right]) => right - left).map(([bitstring, count]) => `${bitstring}: ${count}`).join("\n")}</code>
                </div>
              ) : null}
              {shownRun.status === "done" && shownRun.raw_counts ? (
                <QpuMeasuredVsIdeal
                  qasm={submittableQasm ?? ""}
                  submittedFingerprint={shownRun.source_fingerprint}
                  counts={shownRun.raw_counts}
                  mitigation={shownRun.mitigation}
                  limits={limits}
                  copy={copy}
                  workingOut={workingOut}
                />
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
        {data.bars.map((bar, index) => (
          <div
            // The stagger index for the bars' entrance (ux-studio.css).
            style={{ "--i": index } as CSSProperties}
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
 * current version is trustworthy, and until now that meant leaving Studio for
 * the artifact detail screen. The run contract came from the inspector for the same reason — it
 * describes what the next Verify & save will do, which is a fact about this
 * artifact's evidence, not a control.
 *
 * `checks` is populated when a version has been opened before; absent is
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
  const summaryChecks = artifact?.verificationSummary?.checks ?? [];
  // Only the checks the typed summary did NOT already account for. The panel
  // above groups every check the summary carries into passed / failed /
  // unavailable, and this list used to print the same methods again underneath
  // it — the same four rows, twice, in two different shapes. What is left here
  // is the legacy-metadata case: an artifact whose checks arrived on the older
  // `metadata` path and have no typed summary to be grouped into.
  const checks: VerificationCheck[] = summaryChecks.length ? [] : artifact?.checks ?? [];
  const facts = artifact ? summaryFacts(artifact, locale, copy) : [];
  return (
    <section className="mj-studio-surface mj-studio-version-panel" aria-label={copy.summary} {...panelRegion("studio", "summary")}>
      <div className="mj-studio-surface-head">
        <div>
          <h2>{artifact ? artifact.title : copy.newDraftSource}</h2>
        </div>
        <span className="mj-mono-muted">{artifact?.framework ?? ""}</span>
      </div>

      {/* What the circuit IS, before what was proved about it. The evidence
          panel below opens with a machine reason code and an evidence-strength
          enum, which is the vocabulary of the verifier rather than of the
          person reading it — the width, the depth and the version this verdict
          belongs to were not on this tab at all. */}
      {facts.length > 1 ? (
        <dl className="mj-studio-fact-row">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mj-studio-summary-section">
        <span className="mj-section-label">{copy.evidence}</span>
        <VerificationSummaryPanel summary={artifact?.verificationSummary ?? null} state={state} locale={locale} />
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
          ) : null
        ) : null}
        {/* One way in, not two. When no checks had loaded, this section printed
            "Open the full record to load this version's checks." directly above
            a link reading "Open the full verification record" — the same
            instruction, twice, one of them not clickable. The sentence is the
            link's context now. */}
        {artifact?.id ? (
          <p className="mj-studio-record-link">
            <a href={`/library/${encodeURIComponent(artifact.id)}`}>{copy.openFullRecord}</a>
            {!summaryChecks.length && !checks.length ? <span className="mj-mono-muted">{copy.evidenceNotLoaded}</span> : null}
          </p>
        ) : null}
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

      {/* The workspace's comments on this saved circuit (proposal 9). Only a
          circuit the server holds: one that lives only in this browser has no
          row for anyone else to read a comment on. */}
      {artifact && isCommentableId(artifact.id) ? (
        <div className="mj-studio-summary-section">
          <CommentsPanel targetType="artifact" targetId={artifact.id} locale={locale} />
        </div>
      ) : null}

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

/**
 * The handful of numbers a saved circuit is opened for, in a fixed order.
 *
 * Drawn from `resourceRows`, which the artifact already carried and which no
 * Studio tab rendered — the Summary tab opened on a reason code and an evidence
 * enum instead. Capped at four so this stays a header strip rather than
 * becoming the resource table it is a summary of; a circuit with more rows than
 * that has them in the run record, which the link below this reaches.
 *
 * The caller drops the strip below two entries. A version with no stored
 * estimates leaves only the date, and one labelled cell across the panel is
 * exactly the kind of row this change exists to remove.
 */
function summaryFacts(artifact: LibraryArtifact, locale: PublicLocale, copy: StudioCopy): Array<{ label: string; value: string }> {
  const facts = artifact.resourceRows.slice(0, 4).map(({ label, value }) => ({ label, value }));
  const updated = formatDiscoveryDate(artifact.updatedAt, locale);
  if (updated) facts.push({ label: copy.updated, value: updated });
  return facts;
}

function originLabel(origin: VersionOrigin, copy: StudioCopy): string {
  if (origin === "agent_run") return copy.versionOriginAgentRun;
  if (origin === "studio_draft") return copy.versionOriginStudioDraft;
  if (origin === "imported_reference") return copy.versionOriginImportedReference;
  if (origin === "user_import") return copy.versionOriginUserImport;
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
                {row.isCurrent ? <span className="mj-studio-version-badge">{copy.versionCurrentBadge}</span> : null}
                <span className="mj-studio-version-origin">{originLabel(row.origin, copy)}</span>
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
 * the retired artifact list was fixed for, and Studio must not reintroduce it. */
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
    artifact.circuitIr = circuitIRFromMetadata(version.metadata);
    artifact.currentVersionId = payload.current_version_id;
    artifact.resourceRows = resourceRowsFromRemote(version.resource_estimates);
    // The Versions panel is only useful if the checks arrive with the artifact.
    // Without this the panel could only ever show evidence for an artifact this
    // browser had already opened once before — i.e. almost never, which would
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
    circuitIr: artifact.circuitIr,
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
