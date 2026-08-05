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
import {
  resultVisualizationFromResult,
  type ResultDistributionView,
  type ResultTraceView,
  type ResultValueView,
} from "./result-visualization.ts";
import {
  verificationSummaryFromValue,
  type VerificationSummary,
} from "./verification-record.ts";

export type RunResultValue = ResultValueView;

export interface RunResultView {
  summary: string;
  /** Short, honest trust marker. Never the headline. */
  trust: { label: string; tone: "ok" | "warn" };
  saved: boolean;
  distribution: ResultDistributionView | null;
  traces: ResultTraceView[];
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
  const visualization = resultVisualizationFromResult(
    result,
    plan?.expected_output_keys ?? [],
  );
  const shots = visualization.distribution?.kind === "counts"
    ? visualization.distribution.total
    : 0;

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
    distribution: visualization.distribution,
    traces: visualization.traces,
    values: visualization.values,
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
