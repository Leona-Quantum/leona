"use client";

// Pipeline view (S3 + S4). The event log still contains the detailed internal
// choreography, but the customer-facing rail deliberately projects it to four
// stages: Plan, Generate, Verify, and Analysis.
//
// `reduceRunEvents` is a PURE fold of the typed RunEvent log. It reads no wall
// clock and holds no state, so replaying a stored run or a mid-run prefix gives
// the same view every time.
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { components } from "@majorana/contracts-gen";
import { SyntaxHighlightedCode } from "./code-block";
import { StageRail, type RailStage } from "./stage-rail";
import { VerdictBanner, type Verdict } from "./verdict-banner";

type Schemas = components["schemas"];
export type RunEvent = Schemas["RunEvent"];
type Stage = Schemas["Stage"];
type VerificationMethod = Schemas["VerificationMethod"];
type RailStageId = "plan" | "generate" | "verify" | "analyze";

const RAIL_STAGE_ORDER: readonly RailStageId[] = ["plan", "generate", "verify", "analyze"];
const RAIL_STAGE_LABEL: Record<RailStageId, string> = {
  plan: "Plan",
  generate: "Generate",
  verify: "Verify",
  analyze: "Analysis",
};

// Internal stages remain in the event contract because they are useful evidence;
// this map controls only what the user sees on the rail.
const RAIL_GROUP: Record<Stage, RailStageId> = {
  plan: "plan",
  generate: "generate",
  screen: "generate",
  resource_estimate: "generate",
  verify: "verify",
  compile: "verify",
  compiled_resource_estimate: "verify",
  finalize: "verify",
  final_execute: "verify",
  baseline: "analyze",
  analyze: "analyze",
  save: "analyze",
  simulate: "verify",
  export: "verify",
};
const INTERNAL_STAGE_ORDER: readonly Stage[] = [
  "plan",
  "generate",
  "screen",
  "resource_estimate",
  "verify",
  "compile",
  "compiled_resource_estimate",
  "finalize",
  "final_execute",
  "baseline",
  "analyze",
  "save",
];
const INTERNAL_STAGE_LABEL: Record<Stage, string> = {
  plan: "Plan",
  generate: "Generate",
  screen: "Screen",
  resource_estimate: "Resource estimate",
  verify: "Verify",
  compile: "Compilation",
  compiled_resource_estimate: "Compiled resource estimate",
  finalize: "Finalize",
  final_execute: "Final simulation / QPU",
  baseline: "Baseline",
  analyze: "Analysis",
  save: "Save",
  simulate: "Simulate",
  export: "Export",
};
const INTERNAL_STAGE_GROUPS: Record<RailStageId, readonly Stage[]> = {
  plan: ["plan"],
  generate: ["generate", "screen", "resource_estimate"],
  verify: [
    "verify",
    "compile",
    "compiled_resource_estimate",
    "finalize",
    "final_execute",
    "simulate",
    "export",
  ],
  analyze: ["baseline", "analyze", "save"],
};

const METHOD_LABEL: Record<VerificationMethod, string> = {
  exact: "exact",
  statistical: "statistical",
  brute_force: "brute-force",
  exact_diag: "exact diagonalization",
  return_contract: "return-contract",
  qasm_parse: "QASM-parse",
};
const NUMERIC_METHODS: ReadonlySet<VerificationMethod> = new Set<VerificationMethod>([
  "exact",
  "statistical",
  "brute_force",
  "exact_diag",
]);

export interface KeyNumber {
  label: string;
  value: string;
}
export interface ModelActivity {
  stage: Stage;
  kind: "reasoning" | "output";
  text: string;
}
export interface LiveOutput {
  thoughts: string | null;
  narrative: string | null;
}
export interface AnswerView {
  summary: string;
  interpretation: string;
  comparison: KeyNumber[];
  residualRisks: string | null;
}
export interface VerificationRow {
  method: string;
  result: Schemas["VerificationResult"]["result"];
  detail: string;
}
export interface CodeView {
  filename: string;
  language: string;
  code: string;
}
export interface CodeQualityView {
  checks: KeyNumber[];
  diagnostics: string[];
}
export interface ResourceEstimateView {
  phase: string;
  rows: KeyNumber[];
  notes: string[];
}
export interface CompilationView {
  accepted: boolean;
  mode: string;
  reason: string | null;
  before: KeyNumber[];
  after: KeyNumber[];
}
export interface SimulationView {
  ok: boolean;
  duration: string;
  exitCode: number;
  memory: string | null;
  qasmAvailable: boolean;
  // Raw captured program output. NOT result data — see buildSimulation.
  output: string | null;
  outputTruncated: boolean;
}
export interface SourceView {
  query: string;
  sources: Schemas["ResearchCitation"][];
  error: string | null;
}
/** The closest a budget-exhausted run got. Never an artifact: see RunBestEffort. */
export interface BestEffortView {
  code: CodeView;
  revision: number;
  candidatesConsidered: number;
  exhaustedBudget: string | null;
  failedChecks: string[];
  criticSummary: string | null;
  residualRisks: string[];
}
export interface ResultView {
  verdict: { verdict: Verdict; detail: string } | null;
  answer: AnswerView | null;
  generatedCode: CodeView | null;
  codeQuality: CodeQualityView | null;
  resourceEstimates: ResourceEstimateView[];
  verification: VerificationRow[];
  compilation: CompilationView | null;
  finalCode: CodeView | null;
  finalCodeVariants: CodeView[];
  finalSimulation: SimulationView | null;
  sources: SourceView | null;
  keyNumbers: KeyNumber[];
  bestEffort: BestEffortView | null;
  baseline: { title: string; rows: KeyNumber[]; notApplicable: string | null } | null;
  export: { label: string; tone: "ok" | "warn" | "err" | "neutral"; qasmAvailable: boolean } | null;
  libraryHref: string | null;
}
export interface RunViewModel {
  mode: Schemas["RunMode"] | null;
  stages: RailStage[];
  result: ResultView;
  modelActivity: ModelActivity[];
  liveOutput: LiveOutput;
  status: Schemas["RunStatus"] | null;
  /** True once evidence or a terminal result exists. */
  hasResult: boolean;
}

const MODEL_ACTIVITY_MAX_CHARS = 12_000;
const PROSE_TYPE_SPEED_MS = 12;
const THOUGHT_TYPE_SPEED_MS = 5;

/**
 * Reveal live natural-language output a few characters at a time. This is
 * intentionally presentation-only: the event reducer remains a pure fold and
 * replay still receives the same complete target strings.
 */
function useTypedText(target: string, enabled: boolean, speedMs: number): string {
  const [visible, setVisible] = useState(() => (enabled ? "" : target));
  const visibleRef = useRef(visible);

  useEffect(() => {
    if (!enabled) {
      visibleRef.current = target;
      setVisible(target);
      return;
    }
    if (!target) {
      visibleRef.current = "";
      setVisible("");
      return;
    }
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      visibleRef.current = target;
      setVisible(target);
      return;
    }

    let index = target.startsWith(visibleRef.current) ? visibleRef.current.length : 0;
    if (index === 0 && visibleRef.current !== "") {
      visibleRef.current = "";
      setVisible("");
    }

    // Keep very long model traces moving without making the user wait minutes
    // for a verbose reasoning stream to catch up.
    const charsPerTick = Math.max(1, Math.ceil(target.length / 2400));
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const advance = () => {
      if (cancelled) return;
      index = Math.min(target.length, index + charsPerTick);
      const next = target.slice(0, index);
      visibleRef.current = next;
      setVisible(next);
      if (index < target.length) timer = setTimeout(advance, speedMs);
    };

    if (index < target.length) timer = setTimeout(advance, speedMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, speedMs, target]);

  return visible;
}

function TypedText({
  text,
  enabled,
  speedMs = PROSE_TYPE_SPEED_MS,
}: {
  text: string;
  enabled: boolean;
  speedMs?: number;
}): ReactNode {
  const visible = useTypedText(text, enabled, speedMs);
  if (!enabled) return text;
  return (
    <span aria-label={text} data-typing={visible.length < text.length ? "active" : "complete"}>
      <span aria-hidden="true">{visible}</span>
    </span>
  );
}

// ---- formatting -------------------------------------------------------------------------
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}

function elapsedBetween(startTs: string, endTs: string): string | undefined {
  const start = Date.parse(startTs);
  const end = Date.parse(endTs);
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) return undefined;
  return formatDuration(end - start);
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function filenameFor(language: string): string {
  const lang = language.toLowerCase();
  if (lang.startsWith("py")) return "circuit.py";
  if (lang.includes("qasm")) return "circuit.qasm";
  // The framework names are what run.best_effort carries — it reports the
  // candidate's Framework enum value, not the "python" that code.generated uses.
  // All three frameworks are Python libraries, so they are Python files.
  if (["qiskit", "cirq", "pennylane"].includes(lang)) return "circuit.py";
  return "circuit.txt";
}

function labelize(value: string): string {
  return value
    .replace(/_ms$/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function metricValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string") return value;
  if (key === "qubits") return `${value} qubits`;
  if (key === "depth") return `${value} layers`;
  if (key === "gate_count") return `${value} gates`;
  if (key === "two_qubit_gate_count") return `${value} two-qubit gates`;
  if (key === "measurement_count") return `${value} measurements`;
  if (key === "estimated_runtime_ms") return `${value} ms`;
  return String(value);
}

function metricRows(metrics: Record<string, unknown> | null | undefined): KeyNumber[] {
  if (!metrics) return [];
  return Object.entries(metrics).flatMap(([key, value]) => {
    const formatted = metricValue(key, value);
    return formatted === null ? [] : [{ label: labelize(key), value: formatted }];
  });
}

function formatVerdictDetail(
  verdict: Verdict,
  primary: Schemas["VerificationResult"] | null,
): string {
  if (verdict === "not_verified" || !primary) {
    return "No verification method applies to this task class";
  }
  const details = (primary.details ?? {}) as Record<string, unknown>;
  const method = METHOD_LABEL[primary.method];
  const metric = str(details.metric) ?? str(details.metric_label);
  const value = num(details.metric_value) ?? num(details.tvd);
  const threshold = num(details.threshold) ?? num(details.delta);
  const seed = num(details.seed);
  const shots = num(details.shots);
  const tail =
    (seed !== null ? `, seed ${seed}` : "") + (shots !== null ? `, ${shots} shots` : "");

  if (verdict === "failed") {
    if (metric && value !== null && threshold !== null) {
      return `${method} check failed: ${metric} ${value} > delta ${threshold}${tail}`;
    }
    return `${method} check failed${tail}`;
  }
  if (verdict === "verified_caveats") {
    return `Contract checks passed; numeric check skipped${tail}`;
  }
  if (metric && value !== null && threshold !== null) {
    return `Verified - ${method} (${metric} ${value} <= delta ${threshold}${tail})`;
  }
  return `Verified - ${method}${tail}`;
}

// ---- event reduction --------------------------------------------------------------------
export function reduceRunEvents(events: readonly RunEvent[]): RunViewModel {
  const started = new Map<Stage, string>();
  const finished = new Map<Stage, { ok: boolean; durationMs: number }>();
  const stageError = new Map<Stage, string>();

  let plan: Schemas["Plan"] | null = null;
  let generatedCode: Schemas["CodeGenerated"] | null = null;
  let screen: Schemas["ScreenResult"] | null = null;
  const resourceEstimates = new Map<"pre_verify" | "compiled", Schemas["ResourceEstimateResult"]>();
  let verificationSandbox: Schemas["SandboxResult"] | null = null;
  let finalSimulation: Schemas["SandboxResult"] | null = null;
  const verifyResults: Schemas["VerificationResult"][] = [];
  let compilation: Schemas["CompilationResult"] | null = null;
  let finalizedCode: Schemas["CodeFinalized"] | null = null;
  let baseline: Schemas["BaselineResult"] | null = null;
  // Deliberately not cleared by clearFrom(): a restart replays the pipeline, and
  // the attempt a previous exhaustion produced is still the honest record of it.
  let bestEffort: Schemas["RunBestEffort"] | null = null;
  let exportEv: Schemas["ExportClassified"] | null = null;
  let saved: Schemas["ArtifactSaved"] | null = null;
  let analysis: Schemas["RunAnalysis"] | null = null;
  let research: Schemas["ResearchCompleted"] | null = null;
  let finishedRun: Schemas["RunFinished"] | null = null;
  let mode: Schemas["RunMode"] | null = null;
  let status: Schemas["RunStatus"] | null = null;
  const modelActivity = new Map<string, ModelActivity>();
  let lastTs: string | null = null;

  function clearStageData(stage: Stage): void {
    switch (stage) {
      case "plan":
        plan = null;
        research = null;
        break;
      case "generate":
        generatedCode = null;
        break;
      case "screen":
        screen = null;
        break;
      case "resource_estimate":
        resourceEstimates.delete("pre_verify");
        break;
      case "verify":
        verificationSandbox = null;
        verifyResults.length = 0;
        break;
      case "compile":
        compilation = null;
        break;
      case "compiled_resource_estimate":
        resourceEstimates.delete("compiled");
        break;
      case "finalize":
        finalizedCode = null;
        exportEv = null;
        break;
      case "final_execute":
        finalSimulation = null;
        break;
      case "baseline":
        baseline = null;
        break;
      case "analyze":
        analysis = null;
        break;
      case "save":
        saved = null;
        break;
      case "simulate":
        verificationSandbox = null;
        break;
      case "export":
        exportEv = null;
        break;
    }
  }

  function clearFrom(stage: Stage): void {
    const index = INTERNAL_STAGE_ORDER.indexOf(stage);
    if (index < 0) return;
    for (const current of INTERNAL_STAGE_ORDER.slice(index)) {
      started.delete(current);
      finished.delete(current);
      stageError.delete(current);
      clearStageData(current);
    }
    modelActivity.clear();
    finishedRun = null;
  }

  for (const ev of events) {
    if ("ts" in ev && typeof ev.ts === "string") lastTs = ev.ts;
    switch (ev.type) {
      case "run.queued":
        mode = ev.mode;
        status = "queued";
        break;
      case "run.started":
        status = "running";
        break;
      case "run.mode_resolved":
        // run.queued reports the mode that was *asked for*, which is "auto" for
        // anything from the composer. Overwrite it with what the run is really
        // doing, or the header labels every routed run "auto".
        mode = ev.resolved;
        break;
      case "run.restarted":
        clearFrom(ev.from_stage);
        status = "running";
        break;
      case "stage.started":
        started.set(ev.stage, ev.ts);
        finished.delete(ev.stage);
        stageError.delete(ev.stage);
        clearStageData(ev.stage);
        break;
      case "stage.finished":
        finished.set(ev.stage, { ok: ev.ok, durationMs: ev.duration_ms });
        break;
      case "plan.produced":
        plan = ev.plan;
        break;
      case "code.generated":
        if (!generatedCode || ev.revision >= generatedCode.revision) generatedCode = ev;
        break;
      case "screen.result":
        screen = ev;
        break;
      case "resource.estimate":
        resourceEstimates.set(ev.phase, ev);
        break;
      case "sandbox.result":
        if (ev.phase === "final") finalSimulation = ev;
        else verificationSandbox = ev;
        break;
      case "verification.result":
        verifyResults.push(ev);
        break;
      case "compilation.result":
        compilation = ev;
        break;
      case "code.finalized":
        finalizedCode = ev;
        break;
      case "baseline.result":
        baseline = ev;
        break;
      case "export.classified":
        exportEv = ev;
        break;
      case "artifact.saved":
        saved = ev;
        break;
      case "run.analysis":
        analysis = ev;
        break;
      case "research.completed":
        research = ev;
        break;
      case "llm.delta": {
        const kind = ev.kind ?? "output";
        const key = `${ev.stage}:${kind}`;
        const previous = modelActivity.get(key);
        const text = `${previous?.text ?? ""}${ev.text}`.slice(-MODEL_ACTIVITY_MAX_CHARS);
        modelActivity.set(key, { stage: ev.stage, kind, text });
        break;
      }
      case "run.best_effort":
        bestEffort = ev;
        break;
      case "run.error":
        if (ev.stage) stageError.set(ev.stage, ev.message);
        break;
      case "run.diagnosed":
        stageError.set(ev.failed_stage, ev.message);
        break;
      case "run.finished":
        finishedRun = ev;
        status = ev.status;
        break;
      // llm.call is telemetry; its token counts are not user-facing evidence.
    }
  }

  const stages = buildRailStages(started, finished, stageError, verifyResults, lastTs);
  const verdict = deriveVerdict(finishedRun, verifyResults);
  const result: ResultView = {
    verdict: verdict
      ? { verdict, detail: formatVerdictDetail(verdict, primaryVerify(verifyResults, verdict)) }
      : null,
    answer: buildAnswer(analysis, finishedRun),
    generatedCode: generatedCode ? buildCodeView(generatedCode.language, generatedCode.code) : null,
    codeQuality: buildCodeQuality(screen),
    resourceEstimates: Array.from(resourceEstimates.values()).map(buildResourceEstimate),
    verification: buildVerificationRows(verifyResults),
    compilation: buildCompilation(compilation),
    finalCode: finalizedCode ? buildCodeView(finalizedCode.language, finalizedCode.code) : null,
    finalCodeVariants: finalizedCode
      ? Object.entries(finalizedCode.framework_variants ?? {})
          .filter(([framework]) => framework !== finalizedCode?.language)
          .map(([framework, variant]) => buildCodeView(variant.language || framework, variant.code))
      : [],
    finalSimulation: finalSimulation ? buildSimulation(finalSimulation) : null,
    sources: buildSources(research),
    keyNumbers: buildKeyNumbers(plan, verificationSandbox, finalSimulation, verifyResults),
    bestEffort: buildBestEffort(bestEffort),
    baseline: buildBaseline(baseline),
    export: exportEv ? buildExportBadge(exportEv) : null,
    libraryHref: saved ? `/library/${saved.artifact_id}` : null,
  };
  const liveOutput: LiveOutput = {
    thoughts: modelActivity.get("plan:reasoning")?.text ?? null,
    narrative: plan ? buildPlanNarrative(plan) : null,
  };
  const hasResult =
    result.verdict !== null ||
    result.answer !== null ||
    result.generatedCode !== null ||
    result.codeQuality !== null ||
    result.resourceEstimates.length > 0 ||
    result.verification.length > 0 ||
    result.compilation !== null ||
    result.finalCode !== null ||
    result.finalSimulation !== null ||
    result.sources !== null ||
    result.keyNumbers.length > 0 ||
    result.bestEffort !== null ||
    result.baseline !== null ||
    result.export !== null ||
    result.libraryHref !== null;

  return {
    mode,
    stages,
    result,
    modelActivity: Array.from(modelActivity.values()),
    liveOutput,
    status,
    hasResult,
  };
}

function buildRailStages(
  started: Map<Stage, string>,
  finished: Map<Stage, { ok: boolean; durationMs: number }>,
  stageError: Map<Stage, string>,
  verifyResults: Schemas["VerificationResult"][],
  lastTs: string | null,
): RailStage[] {
  return RAIL_STAGE_ORDER.map((id) => {
    const name = RAIL_STAGE_LABEL[id];
    const members = INTERNAL_STAGE_GROUPS[id];
    const active = members.find((stage) => started.has(stage) && !finished.has(stage));
    const failures = members.filter((stage) => finished.get(stage)?.ok === false);
    const errors = members.flatMap((stage) => {
      const error = stageError.get(stage);
      return error ? [error] : [];
    });
    const observed = members.some((stage) => started.has(stage) || finished.has(stage) || stageError.has(stage));
    const durations = members.reduce((sum, stage) => sum + (finished.get(stage)?.durationMs ?? 0), 0);
    const elapsed = durations > 0 ? formatDuration(durations) : undefined;

    if (active) {
      return {
        id,
        name,
        state: "running",
        elapsed: lastTs ? elapsedBetween(started.get(active) ?? lastTs, lastTs) : undefined,
      } satisfies RailStage;
    }
    if (failures.length || errors.length) {
      const detail =
        errors[0] ??
        (id === "verify" && verifyResults.some((result) => result.result === "fail")
          ? formatVerdictDetail("failed", lastFailingVerify(verifyResults))
          : `${name} failed`);
      return { id, name, state: "fail", elapsed, errorSummary: detail } satisfies RailStage;
    }
    if (observed) return { id, name, state: "pass", elapsed } satisfies RailStage;
    return { id, name, state: "pending" } satisfies RailStage;
  });
}

function buildPlanNarrative(plan: Schemas["Plan"]): string {
  return `I will use ${plan.algorithm} in ${plan.framework} for ${plan.problem_summary}. ${plan.algorithm_rationale}`;
}

function buildCodeView(language: string, code: string): CodeView {
  return { filename: filenameFor(language), language, code };
}

function buildCodeQuality(screen: Schemas["ScreenResult"] | null): CodeQualityView | null {
  if (!screen) return null;
  return {
    checks: [
      { label: "Lint", value: screen.lint_ok ? "passed" : "failed" },
      { label: "Type and safety screen", value: screen.typecheck_ok ? "passed" : "failed" },
    ],
    diagnostics: screen.diagnostics ?? [],
  };
}

function buildResourceEstimate(ev: Schemas["ResourceEstimateResult"]): ResourceEstimateView {
  return {
    phase: ev.phase === "pre_verify" ? "Before verification" : "After compilation",
    rows: metricRows(ev.metrics as Record<string, unknown>),
    notes: ev.notes ?? [],
  };
}

function buildCompilation(ev: Schemas["CompilationResult"] | null): CompilationView | null {
  if (!ev) return null;
  return {
    accepted: ev.accepted,
    mode: ev.mode,
    reason: ev.reason,
    before: metricRows((ev.before ?? {}) as Record<string, unknown>),
    after: metricRows((ev.after ?? {}) as Record<string, unknown>),
  };
}

// stdout was formerly parsed as JSON and rendered as the run's result metrics. That
// was inert only because the emitter hardcoded stdout to "" — as of 2026-07-20 it
// carries real output from generated code, and promoting anything that code prints
// into the "Final Simulation Results" panel would present untrusted text as verified
// findings. The trusted result is RESULT, verified separately. Show the output as
// what it is: a log.
function buildSimulation(ev: Schemas["SandboxResult"]): SimulationView {
  const combined = [ev.stdout, ev.stderr].filter((part) => part.trim().length > 0).join("\n");
  return {
    ok: ev.exit_code === 0,
    duration: formatDuration(ev.duration_ms),
    exitCode: ev.exit_code,
    memory: ev.memory_mb === null ? null : `${ev.memory_mb} MB`,
    qasmAvailable: ev.qasm_emission?.available ?? false,
    output: combined.length > 0 ? combined : null,
    outputTruncated: ev.truncated,
  };
}

function lastFailingVerify(
  results: Schemas["VerificationResult"][],
): Schemas["VerificationResult"] | null {
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index].result === "fail") return results[index];
  }
  return null;
}

function primaryVerify(
  results: Schemas["VerificationResult"][],
  verdict: Verdict,
): Schemas["VerificationResult"] | null {
  if (verdict === "failed") return lastFailingVerify(results);
  return results.length ? results[results.length - 1] : null;
}

function deriveVerdict(
  finishedRun: Schemas["RunFinished"] | null,
  verifyResults: Schemas["VerificationResult"][],
): Verdict | null {
  if (!finishedRun) return null;
  const decision = finishedRun.verifier_decision;
  if (finishedRun.status === "failed" || decision === "fail") return "failed";
  if (decision === "inconclusive") return "not_verified";
  if (decision === "pass") {
    // The worker grades this from the checks the published candidate actually
    // passed, which is stricter than what the event stream shows: a verification.result
    // can be emitted for a candidate that was later repaired and replaced. Scanning
    // the stream is the fallback for runs finished before 2026-07-20.
    if (finishedRun.evidence_strength) {
      return finishedRun.evidence_strength === "physical" ? "verified" : "structural_only";
    }
    return verifyResults.some((result) => NUMERIC_METHODS.has(result.method))
      ? "verified"
      : "structural_only";
  }
  if (finishedRun.status === "succeeded") return "verified_caveats";
  return null;
}

function buildKeyNumbers(
  plan: Schemas["Plan"] | null,
  verificationSandbox: Schemas["SandboxResult"] | null,
  finalSimulation: Schemas["SandboxResult"] | null,
  verifyResults: Schemas["VerificationResult"][],
): KeyNumber[] {
  const rows: KeyNumber[] = [];
  if (plan) {
    rows.push({ label: "Qubits", value: `${plan.qubits_estimate} qubits` });
    const shots = plan.parameters.shots;
    if (shots !== null) rows.push({ label: "Shots", value: `${shots} shots` });
  }
  const simulation = finalSimulation ?? verificationSandbox;
  if (simulation) rows.push({ label: "Simulation time", value: formatDuration(simulation.duration_ms) });
  const primary = verifyResults.length ? verifyResults[verifyResults.length - 1] : null;
  if (primary) {
    const details = (primary.details ?? {}) as Record<string, unknown>;
    const metric = str(details.metric);
    const value = num(details.metric_value) ?? num(details.tvd);
    if (metric && value !== null) rows.push({ label: metric, value: String(value) });
  }
  return rows;
}

function dictToRows(data: Record<string, unknown>): KeyNumber[] {
  return Object.entries(data).flatMap(([label, value]) => {
    if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") {
      return [{ label, value: String(value) }];
    }
    return [];
  });
}

function buildAnswer(
  analysis: Schemas["RunAnalysis"] | null,
  finishedRun: Schemas["RunFinished"] | null,
): AnswerView | null {
  if (!analysis) return null;
  return {
    summary: analysis.summary,
    interpretation: analysis.interpretation,
    comparison: dictToRows((analysis.comparison ?? {}) as Record<string, unknown>),
    residualRisks: str(analysis.residual_risks) ?? str(finishedRun?.residual_risks),
  };
}

function buildSources(research: Schemas["ResearchCompleted"] | null): SourceView | null {
  if (!research) return null;
  return { query: research.query, sources: research.sources ?? [], error: research.error };
}

function buildVerificationRows(results: Schemas["VerificationResult"][]): VerificationRow[] {
  return results.map((result) => {
    const details = (result.details ?? {}) as Record<string, unknown>;
    const metric = str(details.metric) ?? str(details.metric_label);
    const value = num(details.metric_value) ?? num(details.tvd);
    const threshold = num(details.threshold) ?? num(details.delta);
    const seed = num(details.seed);
    const shots = num(details.shots);
    const tail =
      (seed !== null ? `, seed ${seed}` : "") + (shots !== null ? `, ${shots} shots` : "");
    let detail: string;
    if (metric && value !== null && threshold !== null) {
      detail = `${metric} ${value} ${result.result === "fail" ? ">" : "<="} delta ${threshold}${tail}`;
    } else if (metric && value !== null) {
      detail = `${metric} ${value}${tail}`;
    } else {
      detail = (str(details.note) ?? "structural check") + tail;
    }
    return { method: METHOD_LABEL[result.method], result: result.result, detail };
  });
}

function buildBestEffort(ev: Schemas["RunBestEffort"] | null): BestEffortView | null {
  if (!ev) return null;
  return {
    code: buildCodeView(ev.language, ev.code),
    revision: ev.revision,
    candidatesConsidered: ev.candidates_considered,
    exhaustedBudget: str(ev.exhausted_budget),
    failedChecks: ev.failed_checks ?? [],
    criticSummary: str(ev.critic_summary),
    residualRisks: ev.residual_risks ?? [],
  };
}

function buildBaseline(baseline: Schemas["BaselineResult"] | null): ResultView["baseline"] {
  if (!baseline) return null;
  if (baseline.not_applicable_reason) {
    return { title: "Classical baseline", rows: [], notApplicable: baseline.not_applicable_reason };
  }
  return {
    title: `Baseline - ${baseline.kind}`,
    rows: dictToRows((baseline.result ?? {}) as Record<string, unknown>),
    notApplicable: null,
  };
}

function buildExportBadge(ev: Schemas["ExportClassified"]): NonNullable<ResultView["export"]> {
  switch (ev.status) {
    case "lossless":
      return { label: "Lossless", tone: "ok", qasmAvailable: ev.qasm_available };
    case "lossy_with_reason":
      return {
        label: ev.reason ? `Lossy - ${ev.reason}` : "Lossy",
        tone: "warn",
        qasmAvailable: ev.qasm_available,
      };
    case "download_only":
      return { label: "Download only", tone: "neutral", qasmAvailable: ev.qasm_available };
    case "unsupported":
      return { label: "Not supported", tone: "err", qasmAvailable: ev.qasm_available };
  }
}

// ---- composition ------------------------------------------------------------------------
const STAGE_TO_ANCHOR: Record<RailStageId, string> = {
  plan: "mj-live-output",
  generate: "mj-result-generate-code",
  verify: "mj-result-verification",
  analyze: "mj-result-answer",
};

export function RunView({
  events,
  emptyMessage = "This run has no events yet.",
  animateText = false,
}: {
  events: readonly RunEvent[];
  emptyMessage?: string;
  animateText?: boolean;
}): ReactNode {
  const view = reduceRunEvents(events);

  const onSelect = (stageId: string) => {
    const anchor = STAGE_TO_ANCHOR[stageId as RailStageId];
    const element = anchor ? document.getElementById(anchor) : null;
    (element ?? document.getElementById("mj-run-panel"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className={`mj-run${view.mode === "execute" ? " mj-run--execute" : " mj-run--conversation"}`}>
      {view.mode === "execute" ? <StageRail stages={view.stages} onSelect={onSelect} /> : null}
      <div className="mj-run-panel" id="mj-run-panel">
        {view.liveOutput.thoughts || view.liveOutput.narrative ? (
          <LiveOutput output={view.liveOutput} animateText={animateText} />
        ) : null}
        {view.hasResult ? (
          <ResultPanel result={view.result} animateText={animateText} />
        ) : !view.liveOutput.thoughts && !view.liveOutput.narrative ? (
          <p className="mj-run-waiting">{emptyMessage}</p>
        ) : null}
      </div>
    </div>
  );
}

function LiveOutput({ output, animateText }: { output: LiveOutput; animateText: boolean }): ReactNode {
  return (
    <div className="mj-live-output" id="mj-live-output" aria-live={animateText ? "off" : "polite"}>
      {output.thoughts ? (
        <p className="mj-live-thought">
          <TypedText text={output.thoughts} enabled={animateText} speedMs={THOUGHT_TYPE_SPEED_MS} />
        </p>
      ) : null}
      {output.narrative ? (
        <p className="mj-live-narrative">
          <TypedText text={output.narrative} enabled={animateText} />
        </p>
      ) : null}
    </div>
  );
}

function CodeBlock({ code, id }: { code: CodeView; id?: string }): ReactNode {
  const [copied, setCopied] = useState(false);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(code.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mj-code" id={id}>
      <div className="mj-code-head">
        <span className="mj-code-file">{code.filename}</span>
        <button className="mj-code-copy" type="button" onClick={() => void copyCode()}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre
        className="mj-code-body"
        tabIndex={0}
        role="region"
        aria-label={`${code.filename} source`}
      >
        <SyntaxHighlightedCode code={code.code} language={code.language} />
      </pre>
    </div>
  );
}

function KeyNumbers({ rows }: { rows: KeyNumber[] }): ReactNode {
  if (!rows.length) return null;
  return (
    <table className="mj-keynums">
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.label}-${index}`}>
            <th scope="row">{row.label}</th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultPanel({ result, animateText }: { result: ResultView; animateText: boolean }): ReactNode {
  return (
    <div className="mj-result">
      {result.generatedCode || result.codeQuality || result.resourceEstimates.length ? (
        <section className="mj-result-section" id="mj-result-generate">
          {result.generatedCode ? (
            <section className="mj-result-section" id="mj-result-generate-code">
              <h2 className="mj-result-h">Code</h2>
              <CodeBlock code={result.generatedCode} />
            </section>
          ) : null}
          {result.codeQuality ? (
            <section className="mj-result-section" id="mj-result-code-quality">
              <h2 className="mj-result-h">Code Quality</h2>
              <KeyNumbers rows={result.codeQuality.checks} />
              {result.codeQuality.diagnostics.length ? (
                <ul className="mj-evidence-list">
                  {result.codeQuality.diagnostics.map((diagnostic) => (
                    <li key={diagnostic}>
                      <TypedText text={diagnostic} enabled={animateText} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {result.resourceEstimates.map((estimate) => (
            <section className="mj-result-section" key={estimate.phase}>
              <h2 className="mj-result-h">Resource Estimation - {estimate.phase}</h2>
              <KeyNumbers rows={estimate.rows} />
              {estimate.notes.map((note) => (
                <p className="mj-result-note" key={note}>
                  <TypedText text={note} enabled={animateText} />
                </p>
              ))}
            </section>
          ))}
        </section>
      ) : null}

      {result.bestEffort ? (
        <section className="mj-result-section" id="mj-result-best-effort">
          <h2 className="mj-result-h">Closest attempt — not verified</h2>
          <p className="mj-result-note">
            <TypedText
              text={`This run tried ${result.bestEffort.candidatesConsidered} ${
                result.bestEffort.candidatesConsidered === 1 ? "candidate" : "candidates"
              } and ran out of budget before one passed verification. Revision ${
                result.bestEffort.revision
              } got the furthest. It has not been verified and was not saved to your vault — read it as a starting point, not a result.`}
              enabled={animateText}
            />
          </p>
          {result.bestEffort.criticSummary ? (
            <p className="mj-result-note">
              <TypedText text={result.bestEffort.criticSummary} enabled={animateText} />
            </p>
          ) : null}
          {result.bestEffort.failedChecks.length ? (
            <ul className="mj-evidence-list">
              {result.bestEffort.failedChecks.map((check) => (
                <li key={check}>
                  <TypedText text={`Failed: ${check}`} enabled={animateText} />
                </li>
              ))}
            </ul>
          ) : null}
          {result.bestEffort.residualRisks.length ? (
            <ul className="mj-evidence-list">
              {result.bestEffort.residualRisks.map((risk) => (
                <li key={risk}>
                  <TypedText text={risk} enabled={animateText} />
                </li>
              ))}
            </ul>
          ) : null}
          <CodeBlock code={result.bestEffort.code} />
        </section>
      ) : null}

      {result.verification.length || result.compilation || result.finalCode || result.finalSimulation ? (
        <section className="mj-result-section" id="mj-result-verify">
          {result.verification.length ? (
            <section className="mj-result-section" id="mj-result-verification">
              <h2 className="mj-result-h">Verification Results</h2>
              <ul className="mj-verify">
                {result.verification.map((verification, index) => (
                  <li
                    key={`${verification.method}-${index}`}
                    className="mj-verify-row"
                    data-result={verification.result}
                  >
                    <span className="mj-verify-method">{verification.method}</span>
                    <span className="mj-verify-detail">{verification.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.compilation ? (
            <section className="mj-result-section" id="mj-result-compilation">
              <h2 className="mj-result-h">Compilation Results</h2>
              <KeyNumbers
                rows={[{ label: "Status", value: result.compilation.accepted ? "accepted" : "not accepted" }]}
              />
              <p className="mj-result-note">
                <TypedText text={`Mode - ${result.compilation.mode}`} enabled={animateText} />
              </p>
              {result.compilation.reason ? (
                <p className="mj-result-note">
                  <TypedText text={result.compilation.reason} enabled={animateText} />
                </p>
              ) : null}
              {result.compilation.before.length ? (
                <div>
                  <p className="mj-result-subh">Before</p>
                  <KeyNumbers rows={result.compilation.before} />
                </div>
              ) : null}
              {result.compilation.after.length ? (
                <div>
                  <p className="mj-result-subh">After</p>
                  <KeyNumbers rows={result.compilation.after} />
                </div>
              ) : null}
            </section>
          ) : null}

          {result.finalCode ? (
            <section className="mj-result-section" id="mj-result-final-code">
              <h2 className="mj-result-h">Final Code</h2>
              <CodeBlock code={result.finalCode} />
              {result.finalCodeVariants.length ? (
                <div className="mj-result-variants">
                  <h3 className="mj-result-subh">Framework variants</h3>
                  <p className="mj-result-note">Copyable native renderings of the verified circuit.</p>
                  {result.finalCodeVariants.map((variant) => <CodeBlock key={variant.filename} code={variant} />)}
                </div>
              ) : null}
            </section>
          ) : null}

          {result.finalSimulation ? (
            <section className="mj-result-section" id="mj-result-final-simulation">
              <h2 className="mj-result-h">Final Simulation Results</h2>
              <KeyNumbers
                rows={[
                  { label: "Execution", value: result.finalSimulation.ok ? "completed" : "failed" },
                  { label: "Duration", value: result.finalSimulation.duration },
                  ...(result.finalSimulation.memory
                    ? [{ label: "Memory", value: result.finalSimulation.memory }]
                    : []),
                ]}
              />
              {result.finalSimulation.output ? (
                <>
                  <p className="mj-result-note">
                    Program output, exactly as the generated code printed it. It is not
                    verified and no value here was checked
                    {result.finalSimulation.outputTruncated ? "; the start was truncated" : ""}.
                  </p>
                  <pre className="mj-result-output">{result.finalSimulation.output}</pre>
                </>
              ) : (
                <p className="mj-result-note">
                  <TypedText text="The program printed nothing." enabled={animateText} />
                </p>
              )}
            </section>
          ) : null}
        </section>
      ) : null}

      {result.verdict ? (
        <section className="mj-result-section" id="mj-result-verdict">
          <VerdictBanner verdict={result.verdict.verdict} detail={result.verdict.detail} />
        </section>
      ) : null}

      {result.answer ? (
        <section className="mj-result-section" id="mj-result-answer">
          <h2 className="mj-result-h">Answer</h2>
          <p className="mj-answer-lead">
            <TypedText text={result.answer.interpretation} enabled={animateText} />
          </p>
          {result.answer.summary && result.answer.summary !== result.answer.interpretation ? (
            <p className="mj-result-note">
              <TypedText text={result.answer.summary} enabled={animateText} />
            </p>
          ) : null}
          <KeyNumbers rows={result.answer.comparison} />
          {result.answer.residualRisks ? (
            <p className="mj-result-note">
              <TypedText text={`Caveat - ${result.answer.residualRisks}`} enabled={animateText} />
            </p>
          ) : null}
        </section>
      ) : null}

      {result.sources ? (
        <section className="mj-result-section" id="mj-result-sources">
          <h2 className="mj-result-h">Sources</h2>
          <p className="mj-result-note">
            <TypedText text={`Research query - ${result.sources.query}`} enabled={animateText} />
          </p>
          {result.sources.sources.length ? (
            <ul className="mj-source-list">
              {result.sources.sources.map((source) => (
                <li key={source.url}>
                  <a className="mj-result-link" href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                  <p className="mj-result-note">
                    <TypedText text={source.excerpt} enabled={animateText} />
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mj-result-note">
              <TypedText
                text={
                  result.sources.error
                    ? `Research unavailable - ${result.sources.error}`
                    : "No usable public sources were found."
                }
                enabled={animateText}
              />
            </p>
          )}
        </section>
      ) : null}

      {result.keyNumbers.length ? (
        <section className="mj-result-section" id="mj-result-keynums">
          <KeyNumbers rows={result.keyNumbers} />
        </section>
      ) : null}

      {result.baseline ? (
        <section className="mj-result-section" id="mj-result-baseline">
          <h2 className="mj-result-h">{result.baseline.title}</h2>
          {result.baseline.notApplicable ? (
            <p className="mj-result-note">
              <TypedText
                text={`Not applicable - ${result.baseline.notApplicable}`}
                enabled={animateText}
              />
            </p>
          ) : (
            <KeyNumbers rows={result.baseline.rows} />
          )}
        </section>
      ) : null}

      {result.export ? (
        <section className="mj-result-section" id="mj-result-export">
          <div className="mj-badges">
            <span className="mj-badge" data-tone={result.export.tone}>
              {result.export.label}
            </span>
            <span className="mj-badge" data-tone={result.export.qasmAvailable ? "ok" : "neutral"}>
              {result.export.qasmAvailable ? "OpenQASM 3 available" : "No native QASM export"}
            </span>
          </div>
        </section>
      ) : null}

      {result.libraryHref ? (
        <section className="mj-result-section" id="mj-result-library">
          <a className="mj-result-link" href={result.libraryHref}>
            Open in Vault -&gt;
          </a>
        </section>
      ) : null}
    </div>
  );
}
