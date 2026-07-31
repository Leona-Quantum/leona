/**
 * What a completed run actually produced: the measured distribution, the reported
 * values, the program, and a one-line summary.
 *
 * This replaces the verification-verdict card as the end of a successful run. The
 * verdict framing put an eyebrow, a title, a claims callout, and a checks list ahead
 * of the deliverable, and buried the code and the numbers inside collapsed
 * `<details>`. The run's product is the result and the program; the trust level is
 * one badge on top of them, not the headline.
 *
 * Failures with no executable deliverable still use `runOutcomeFromEvents`. When
 * code or a protected RESULT exists, the explanation is a compact notice inside
 * this result so the preserved work remains the headline.
 */

import { friendlyFailure, type OutcomeEvent } from "./run-outcome.ts";
import { simulationChartData, type SimulationChartData } from "./simulation-visual.ts";
import {
  verificationSummaryFromValue,
  type VerificationSummary,
} from "./verification-record.ts";

export interface RunResultValue {
  label: string;
  value: string;
}

export interface RunResultView {
  summary: string;
  /** Short, honest trust marker. Never the headline. */
  trust: { label: string; tone: "ok" | "warn" };
  saved: boolean;
  distribution: {
    data: SimulationChartData;
    shots: number;
    peakLabel: string;
  } | null;
  values: RunResultValue[];
  facts: RunResultValue[];
  code: { label: string; language: string; source: string } | null;
  /** Unverified claims, kept available but never as the lead. */
  limitations: string[];
  /** A compact explanation for a preserved result that did not pass the workflow. */
  notice: { title: string; body: string } | null;
}

function lastEvent(events: readonly OutcomeEvent[], type: string): OutcomeEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) return events[index];
  }
  return null;
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return value.toLocaleString("en-US");
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e6)) return value.toExponential(4);
  return String(Number(value.toFixed(6)));
}

/** The protected RESULT for one candidate revision — never stdout or another revision. */
function protectedResult(
  events: readonly OutcomeEvent[],
  targetRevision?: number,
): Record<string, unknown> | null {
  let currentRevision: number | undefined;
  let selected: Record<string, unknown> | null = null;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.type === "code.generated" && event.revision !== undefined) {
      currentRevision = event.revision;
    }
    if (event.type !== "sandbox.result") continue;
    if (targetRevision !== undefined && currentRevision !== targetRevision) continue;
    const result = (event as { result?: unknown }).result;
    if (result && typeof result === "object" && !Array.isArray(result)) {
      selected = result as Record<string, unknown>;
    }
  }
  return selected;
}

/**
 * A `{bitstring: count}` mapping anywhere in RESULT. The plan names its own keys, so
 * match on shape rather than on a fixed key list — a run that reports `histogram` or
 * `measurement_counts` has just as much a distribution to draw.
 */
function countsFrom(result: Record<string, unknown> | null): Record<string, number> | null {
  if (!result) return null;
  for (const value of Object.values(result)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) continue;
    const numeric = entries.every(
      ([key, count]) => /^[01]+$/.test(key) && typeof count === "number" && Number.isFinite(count),
    );
    if (numeric) return Object.fromEntries(entries as [string, number][]);
  }
  return null;
}

/** Scalars the run reported, in the order the plan promised them. */
function valuesFrom(
  result: Record<string, unknown> | null,
  expectedKeys: readonly string[],
): RunResultValue[] {
  if (!result) return [];
  const keys = [
    ...expectedKeys.filter((key) => key in result),
    ...Object.keys(result).filter((key) => !expectedKeys.includes(key)),
  ];
  const values: RunResultValue[] = [];
  for (const key of keys) {
    const value = result[key];
    if (typeof value === "number") values.push({ label: humanize(key), value: formatNumber(value) });
    else if (typeof value === "boolean") values.push({ label: humanize(key), value: String(value) });
    else if (typeof value === "string" && value.length <= 200) {
      values.push({ label: humanize(key), value });
    } else if (Array.isArray(value) && value.length <= 8 && value.every((item) => typeof item === "number")) {
      values.push({ label: humanize(key), value: value.map(formatNumber).join(", ") });
    }
  }
  return values.slice(0, 10);
}

export function runResultFromEvents(
  events: readonly OutcomeEvent[],
  recordSummary: VerificationSummary | null = null,
): RunResultView | null {
  const finished = lastEvent(events, "run.finished");
  if (!finished || finished.status === "cancelled") return null;

  const summary =
    verificationSummaryFromValue(finished.verification_summary) ?? recordSummary;
  const plan = lastEvent(events, "plan.produced")?.plan;
  const best = lastEvent(events, "run.best_effort");
  const failed = finished.status !== "succeeded";
  const source = failed
    ? best ?? lastEvent(events, "code.finalized") ?? lastEvent(events, "code.generated")
    : lastEvent(events, "code.finalized") ?? lastEvent(events, "code.generated");
  const result = protectedResult(events, failed ? source?.revision : undefined);
  // A block headed "Deliverable" has to have delivered something. The test is
  // mode-independent on purpose: a conversation turn finishes SUCCEEDED with no
  // plan, no program and no protected RESULT, and both render sites prefer this
  // view to the message text — so returning a view for one drew an empty
  // "Final Output / Quantum circuit run" card *over* the assistant's answer.
  // Guarding only the failed case (as this did) left every chat turn exposed.
  //
  // Once code or a protected RESULT exists it stays a useful deliverable even
  // when review did not accept it; hiding those recreates the old
  // "No accepted result" dead end.
  if (!source?.code && !result) return null;
  const counts = countsFrom(result);

  const shots = counts ? Object.values(counts).reduce((total, count) => total + count, 0) : 0;
  const data = counts ? simulationChartData(counts, shots) : null;

  const reviewAccepted = !failed
    && summary?.semantic_review_decision !== "code_repair"
    && summary?.semantic_review_decision !== "replan";
  // Filter by element type, not just Array.isArray: a model-authored array
  // holding a number or an object passes the array check, and the `.trim()`
  // below then throws and blanks the entire result view.
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const eventRisks = typeof finished.residual_risks === "string"
    ? [finished.residual_risks]
    : strings(finished.residual_risks);
  const bestRisks = strings(best?.residual_risks);
  const limitations = [
    ...(summary?.unverified_claims ?? []).map(humanize),
    ...bestRisks,
    ...eventRisks,
  ].filter((value, index, all) => Boolean(value.trim()) && all.indexOf(value) === index);
  const failure = failed ? lastEvent(events, "run.error") : null;
  const failureDescription = failure
    ? friendlyFailure(failure.message, failure.stage, failure.code)
    : null;
  const noticeParts = failed
    ? [best?.critic_summary, failureDescription]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .filter((value, index, all) => all.indexOf(value) === index)
    : [];

  return {
    summary:
      lastEvent(events, "run.analysis")?.interpretation
      ?? plan?.problem_summary
      ?? "Quantum circuit run",
    trust: failed
      ? {
          label: best ? "Best available · not verified" : "Executed · verification failed",
          tone: "warn",
        }
      : reviewAccepted
        ? { label: "Executed", tone: "ok" }
        : { label: "Executed · needs attention", tone: "warn" },
    saved: Boolean(lastEvent(events, "artifact.saved")),
    distribution: data
      ? {
          data,
          shots,
          peakLabel: data.peak.bitstring,
        }
      : null,
    values: valuesFrom(result, plan?.expected_output_keys ?? []),
    facts: [
      ...(plan?.algorithm ? [{ label: "Algorithm", value: plan.algorithm }] : []),
      ...(plan?.framework ? [{ label: "Framework", value: plan.framework }] : []),
      ...(source?.revision !== undefined
        ? [{ label: "Revision", value: String(source.revision) }]
        : []),
      ...(shots ? [{ label: "Shots", value: shots.toLocaleString("en-US") }] : []),
    ],
    code: source?.code
      ? {
          label: failed ? "Best available code" : "Final code",
          language: source.language ?? plan?.framework ?? "python",
          source: source.code,
        }
      : null,
    limitations,
    notice: noticeParts.length
      ? {
          title: best ? "Why this result was not accepted" : "Why verification stopped",
          body: noticeParts.join(" "),
        }
      : null,
  };
}
