"use client";

// Pipeline view (S3 + S4) — the run page's body. Spec: plans/roadmap/04-ui-specifications.md
// §2 (rail) + §3 (result-panel order) and plans/rebuild/07-ui-product.md §6 (replay rule).
//
// `reduceRunEvents` is a PURE fold of the typed RunEvent log into the view model the
// presentational components consume. It reads no wall clock and holds no state: the same
// event array always yields the same view, so replaying a stored run (or a mid-run prefix,
// on refresh) renders byte-identical DOM. That is the S3 acceptance test — keep this pure.
import type { ReactNode } from "react";
import type { components } from "@majorana/contracts-gen";
import { StageRail, type RailStage } from "./stage-rail";
import { VerdictBanner, type Verdict } from "./verdict-banner";

type Schemas = components["schemas"];
export type RunEvent = Schemas["RunEvent"];
type Stage = Schemas["Stage"];
type VerificationMethod = Schemas["VerificationMethod"];

// Execution order + display labels. Legacy simulate/export values remain readable in
// stored events but are intentionally absent from new-run choreography.
const STAGE_ORDER: readonly Stage[] = [
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
] as const;
const STAGE_LABEL: Record<Stage, string> = {
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
  simulate: "Simulate (legacy)",
  export: "Export (legacy)",
};

// Human method names — P1: name what was checked, never "IR".
const METHOD_LABEL: Record<VerificationMethod, string> = {
  exact: "exact",
  statistical: "statistical",
  brute_force: "brute-force",
  exact_diag: "exact diagonalization",
  return_contract: "return-contract",
  qasm_parse: "QASM-parse",
};
// Methods that check numbers, not just structure — a pass on only the structural ones is
// "Verified with caveats", not fully "Verified".
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
export interface ResultView {
  verdict: { verdict: Verdict; detail: string } | null;
  keyNumbers: KeyNumber[];
  code: { filename: string; language: string; code: string } | null;
  baseline: { title: string; rows: KeyNumber[]; notApplicable: string | null } | null;
  export: { label: string; tone: "ok" | "warn" | "err" | "neutral"; qasmAvailable: boolean } | null;
  libraryHref: string | null;
}
export interface RunViewModel {
  stages: RailStage[];
  result: ResultView;
  status: Schemas["RunStatus"] | null;
  /** True once any result-panel content exists (verdict/code/baseline/export/save). */
  hasResult: boolean;
}

// ---- formatting (deterministic; no locale, no wall clock) --------------------------------
function formatDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms)} ms`;
}
function elapsedBetween(startTs: string, endTs: string): string | undefined {
  const start = Date.parse(startTs);
  const end = Date.parse(endTs);
  // end <= start ⇒ the stage only just started (no later event yet); show no timer rather
  // than a premature "0 ms".
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
  if (lang === "qasm" || lang === "openqasm") return "circuit.qasm";
  return "circuit.txt";
}

// Detail line under the verdict. Tolerant of the free-form `details` dict: it reads a small
// set of optional keys (metric/value/threshold/comparator/seed/shots) and degrades to the
// method name if they're absent — the UI still names the method (spec §3, P1).
function buildVerdictDetail(
  verdict: Verdict,
  primary: Schemas["VerificationResult"] | null,
): string {
  if (verdict === "not_verified" || !primary) {
    return "No verification method applies to this task class";
  }
  const d = (primary.details ?? {}) as Record<string, unknown>;
  const method = METHOD_LABEL[primary.method];
  const metric = str(d.metric) ?? str(d.metric_label);
  const value = num(d.metric_value) ?? num(d.tvd);
  const threshold = num(d.threshold) ?? num(d.delta);
  const seed = num(d.seed);
  const shots = num(d.shots);
  const tail =
    (seed !== null ? ` · seed ${seed}` : "") + (shots !== null ? ` · ${shots} shots` : "");

  if (verdict === "failed") {
    const cap = method.charAt(0).toUpperCase() + method.slice(1);
    if (metric && value !== null && threshold !== null) {
      return `${cap} check failed: ${metric} ${value} > δ ${threshold}${tail}`;
    }
    return `${cap} check failed${tail}`;
  }
  // verified / verified_caveats
  if (verdict === "verified_caveats") {
    return `Contract checks passed; numeric check skipped${tail ? " ·" + tail.slice(2) : ""}`;
  }
  if (metric && value !== null && threshold !== null) {
    return `Verified — ${method} (${metric} ${value} ≤ δ ${threshold})${tail}`;
  }
  return `Verified — ${method}${tail}`;
}

// ---- the pure reducer --------------------------------------------------------------------
export function reduceRunEvents(events: readonly RunEvent[]): RunViewModel {
  // Per-stage accumulators from stage.started / stage.finished.
  const started = new Map<Stage, string>();
  const finished = new Map<Stage, { ok: boolean; durationMs: number }>();

  let plan: Schemas["Plan"] | null = null;
  let code: Schemas["CodeGenerated"] | null = null;
  let finalizedCode: Schemas["CodeFinalized"] | null = null;
  let sandbox: Schemas["SandboxResult"] | null = null;
  const verifyResults: Schemas["VerificationResult"][] = [];
  let baseline: Schemas["BaselineResult"] | null = null;
  let exportEv: Schemas["ExportClassified"] | null = null;
  let saved: Schemas["ArtifactSaved"] | null = null;
  let finishedRun: Schemas["RunFinished"] | null = null;
  let status: Schemas["RunStatus"] | null = null;
  const stageError = new Map<Stage, string>();
  let lastTs: string | null = null;

  for (const ev of events) {
    if ("ts" in ev && typeof ev.ts === "string") lastTs = ev.ts;
    switch (ev.type) {
      case "run.queued":
        status = "queued";
        break;
      case "run.started":
        status = "running";
        break;
      case "stage.started":
        started.set(ev.stage, ev.ts);
        break;
      case "stage.finished":
        finished.set(ev.stage, { ok: ev.ok, durationMs: ev.duration_ms });
        break;
      case "plan.produced":
        plan = ev.plan;
        break;
      case "code.generated":
        // Keep the highest revision (repairs supersede earlier code).
        if (!code || ev.revision >= code.revision) code = ev;
        break;
      case "code.finalized":
        finalizedCode = ev;
        break;
      case "sandbox.result":
        sandbox = ev;
        break;
      case "verification.result":
        verifyResults.push(ev);
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
      // llm.call / llm.delta carry no view state here.
    }
  }

  // ---- rail stages ----
  const stages: RailStage[] = STAGE_ORDER.map((stage) => {
    const name = STAGE_LABEL[stage];
    const fin = finished.get(stage);
    const start = started.get(stage);
    if (fin) {
      const elapsed = formatDuration(fin.durationMs);
      // Baseline that reports "not applicable" reads as skipped-with-reason, not pass.
      if (stage === "baseline" && baseline?.not_applicable_reason) {
        return { id: stage, name, state: "skipped", skipReason: baseline.not_applicable_reason };
      }
      if (fin.ok) return { id: stage, name, state: "pass", elapsed };
      const summary =
        stageError.get(stage) ??
        (stage === "verify" && verifyResults.some((v) => v.result === "fail")
          ? buildVerdictDetail("failed", lastFailingVerify(verifyResults))
          : `${name} failed`);
      return { id: stage, name, state: "fail", elapsed, errorSummary: summary };
    }
    if (start) {
      const elapsed = lastTs ? elapsedBetween(start, lastTs) : undefined;
      return { id: stage, name, state: "running", elapsed };
    }
    return { id: stage, name, state: "pending" };
  });

  // ---- result panel ----
  const verdict = deriveVerdict(finishedRun, verifyResults);
  const result: ResultView = {
    verdict: verdict ? { verdict, detail: buildVerdictDetail(verdict, primaryVerify(verifyResults, verdict)) } : null,
    keyNumbers: buildKeyNumbers(plan, sandbox, verifyResults),
    code: finalizedCode
      ? {
          filename: filenameFor(finalizedCode.language),
          language: finalizedCode.language,
          code: finalizedCode.code,
        }
      : code
        ? { filename: filenameFor(code.language), language: code.language, code: code.code }
        : null,
    baseline: buildBaseline(baseline),
    export: exportEv ? buildExportBadge(exportEv) : null,
    libraryHref: saved ? `/library/${saved.artifact_id}` : null,
  };

  const hasResult =
    result.verdict !== null ||
    result.code !== null ||
    result.baseline !== null ||
    result.export !== null ||
    result.libraryHref !== null;

  return { stages, result, status, hasResult };
}

function lastFailingVerify(
  results: Schemas["VerificationResult"][],
): Schemas["VerificationResult"] | null {
  for (let i = results.length - 1; i >= 0; i--) if (results[i].result === "fail") return results[i];
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
    const hasNumeric = verifyResults.some((v) => NUMERIC_METHODS.has(v.method));
    return hasNumeric ? "verified" : "verified_caveats";
  }
  // succeeded with no explicit decision → treat as caveated pass.
  if (finishedRun.status === "succeeded") return "verified_caveats";
  return null;
}

function buildKeyNumbers(
  plan: Schemas["Plan"] | null,
  sandbox: Schemas["SandboxResult"] | null,
  verifyResults: Schemas["VerificationResult"][],
): KeyNumber[] {
  const rows: KeyNumber[] = [];
  if (plan) {
    rows.push({ label: "Qubits", value: String(plan.qubits_estimate) });
    const shots = plan.parameters.shots;
    if (shots !== null) rows.push({ label: "Shots", value: String(shots) });
  }
  if (sandbox) rows.push({ label: "Sim time", value: formatDuration(sandbox.duration_ms) });
  // The verification distance (e.g. TVD) — labelled with its OWN metric name, never the
  // plan's primary_metric (that's a different quantity: the distance ≠ the result value).
  const primary = verifyResults.length ? verifyResults[verifyResults.length - 1] : null;
  if (primary) {
    const d = (primary.details ?? {}) as Record<string, unknown>;
    const metric = str(d.metric);
    const value = num(d.metric_value) ?? num(d.tvd);
    if (metric && value !== null) rows.push({ label: metric, value: String(value) });
  }
  return rows;
}

function buildBaseline(baseline: Schemas["BaselineResult"] | null): ResultView["baseline"] {
  if (!baseline) return null;
  if (baseline.not_applicable_reason) {
    return { title: "Classical baseline", rows: [], notApplicable: baseline.not_applicable_reason };
  }
  const rows: KeyNumber[] = [];
  const res = (baseline.result ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(res)) {
    if (typeof v === "number" || typeof v === "string") rows.push({ label: k, value: String(v) });
  }
  return { title: `Baseline — ${baseline.kind}`, rows, notApplicable: null };
}

function buildExportBadge(ev: Schemas["ExportClassified"]): NonNullable<ResultView["export"]> {
  switch (ev.status) {
    case "lossless":
      return { label: "Lossless", tone: "ok", qasmAvailable: ev.qasm_available };
    case "lossy_with_reason":
      return {
        label: ev.reason ? `Lossy — ${ev.reason}` : "Lossy",
        tone: "warn",
        qasmAvailable: ev.qasm_available,
      };
    case "download_only":
      return { label: "Download only", tone: "neutral", qasmAvailable: ev.qasm_available };
    case "unsupported":
      return { label: "Not supported", tone: "err", qasmAvailable: ev.qasm_available };
  }
}

// ---- presentational composition ----------------------------------------------------------
// Maps a rail stage to the panel section it should scroll to (best-effort; spec §2).
const STAGE_TO_ANCHOR: Partial<Record<Stage, string>> = {
  generate: "mj-result-code",
  screen: "mj-result-code",
  verify: "mj-result-verdict",
  finalize: "mj-result-code",
  baseline: "mj-result-baseline",
  analyze: "mj-result-verdict",
  save: "mj-result-library",
};

export function RunView({
  events,
  emptyMessage = "This run has no events yet.",
}: {
  events: readonly RunEvent[];
  emptyMessage?: string;
}): ReactNode {
  const view = reduceRunEvents(events);

  const onSelect = (stageId: string) => {
    const anchor = STAGE_TO_ANCHOR[stageId as Stage];
    const el = anchor ? document.getElementById(anchor) : null;
    (el ?? document.getElementById("mj-run-panel"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="mj-run">
      <StageRail stages={view.stages} onSelect={onSelect} />
      <div className="mj-run-panel" id="mj-run-panel">
        {view.hasResult ? (
          <ResultPanel result={view.result} />
        ) : (
          <p className="mj-run-waiting">{emptyMessage}</p>
        )}
      </div>
    </div>
  );
}

// Result panel — order is FIXED (spec §3): verdict → key numbers → code → baseline →
// export badges → Library link. Sections render only when their data exists.
function ResultPanel({ result }: { result: ResultView }): ReactNode {
  return (
    <div className="mj-result">
      {result.verdict ? (
        <section id="mj-result-verdict">
          <VerdictBanner verdict={result.verdict.verdict} detail={result.verdict.detail} />
        </section>
      ) : null}

      {result.keyNumbers.length ? (
        <section className="mj-result-section" id="mj-result-keynums">
          <table className="mj-keynums">
            <tbody>
              {result.keyNumbers.map((n) => (
                <tr key={n.label}>
                  <th scope="row">{n.label}</th>
                  <td>{n.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {result.code ? (
        <section className="mj-result-section" id="mj-result-code">
          <div className="mj-code">
            <div className="mj-code-head">
              <span className="mj-code-file">{result.code.filename}</span>
            </div>
            <pre className="mj-code-body">
              <code>{result.code.code}</code>
            </pre>
          </div>
        </section>
      ) : null}

      {result.baseline ? (
        <section className="mj-result-section" id="mj-result-baseline">
          <h2 className="mj-result-h">{result.baseline.title}</h2>
          {result.baseline.notApplicable ? (
            <p className="mj-result-note">Not applicable — {result.baseline.notApplicable}</p>
          ) : (
            <table className="mj-keynums">
              <tbody>
                {result.baseline.rows.map((n) => (
                  <tr key={n.label}>
                    <th scope="row">{n.label}</th>
                    <td>{n.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
              {result.export.qasmAvailable ? "QASM available" : "No QASM"}
            </span>
          </div>
        </section>
      ) : null}

      {result.libraryHref ? (
        <section className="mj-result-section" id="mj-result-library">
          <a className="mj-result-link" href={result.libraryHref}>
            Open in Library →
          </a>
        </section>
      ) : null}
    </div>
  );
}
