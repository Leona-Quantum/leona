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
import type { PublicLocale } from "./public-locale.ts";

export type RunResultValue = ResultValueView;

/**
 * Fixed-label run metadata — algorithm, framework, revision, shots. Authored here
 * rather than read off a result, so it carries no result key.
 */
export interface RunResultFact {
  label: string;
  value: string;
}

export interface RunResultView {
  summary: string;
  /** Short, honest trust marker. Never the headline. */
  trust: { label: string; tone: "ok" | "warn" };
  saved: boolean;
  distribution: ResultDistributionView | null;
  traces: ResultTraceView[];
  values: RunResultValue[];
  facts: RunResultFact[];
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

const JAPANESE_LIMITATION: Record<string, string> = {
  intent_alignment: "意図との整合性",
  optimality: "最適性",
  quantum_correctness: "量子的な正しさ",
};

function humanize(value: string, locale: PublicLocale): string {
  if (locale === "ja" && JAPANESE_LIMITATION[value.toLowerCase()]) {
    return JAPANESE_LIMITATION[value.toLowerCase()];
  }
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function userFacingExplanation({
  analysis,
  failed,
  reviewAccepted,
  distribution,
  values,
  locale,
}: {
  analysis?: unknown;
  failed: boolean;
  reviewAccepted: boolean;
  distribution: ResultDistributionView | null;
  values: ResultValueView[];
  locale: PublicLocale;
}): string {
  if (typeof analysis === "string" && analysis.trim()) return analysis.trim();
  const primary = values[0];
  const peak = distribution?.data.peak;
  const measuredFacts = [
    ...(primary
      ? [locale === "ja"
          ? `主な結果として「${primary.label}」は${primary.value}でした。`
          : `The main reported result is ${primary.label}: ${primary.value}.`]
      : []),
    ...(peak
      ? [locale === "ja"
          ? `測定で最も多かった状態は${peak.bitstring}（${peak.share.toLocaleString("ja-JP", { style: "percent", maximumFractionDigits: 1 })}）です。`
          : `The most frequent measured state is ${peak.bitstring} (${peak.share.toLocaleString("en-US", { style: "percent", maximumFractionDigits: 1 })}).`]
      : []),
  ].join(locale === "ja" ? "" : " ");
  const lead = measuredFacts ? `${measuredFacts}${locale === "ja" ? "" : " "}` : "";
  if (failed) {
    return locale === "ja"
      ? `${lead}最終検証には合格しませんでしたが、確認可能な最良の成果物を残しました。上の数値やコードは参考として利用し、注意点を解消するまでは確定結果として扱わないでください。`
      : `${lead}The run did not pass final verification, but the best available deliverable has been preserved. You can use the values and code above as a reference; do not treat them as final until the listed concerns are resolved.`;
  }
  if (!reviewAccepted) {
    return locale === "ja"
      ? `${lead}ご依頼に基づく成果物を生成し、実行しました。上の成果物で結果とコードを確認できますが、未確認の点が残っているため、注意点もあわせて確認してください。`
      : `${lead}The requested deliverable was generated and executed. You can review the result and code above, but some points remain unverified, so please check the listed limitations as well.`;
  }
  return locale === "ja"
    ? `${lead}ご依頼に基づく成果物を生成し、実行しました。上の成果物で結果と生成コードを確認でき、コードは再実行や追加調整にも利用できます。検証の範囲は表示されている状態と注意点から確認できます。`
    : `${lead}The requested deliverable was generated and executed. You can review the result and generated code above, and reuse the code for further runs or adjustments. The displayed status and limitations show the scope of verification.`;
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
  locale: PublicLocale = "en",
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
    locale,
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
    ...(summary?.unverified_claims ?? []).map((claim) => humanize(claim, locale)),
    ...bestRisks,
    ...eventRisks,
  ].filter((value, index, all) => Boolean(value.trim()) && all.indexOf(value) === index);
  const failure = failed ? lastEvent(events, "run.error") : null;
  const failureDescription = failure
    ? friendlyFailure(failure.message, failure.stage, failure.code, locale)
    : null;
  const noticeParts = failed
    ? [best?.critic_summary, failureDescription]
      .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
      .filter((value, index, all) => all.indexOf(value) === index)
    : [];

  return {
    summary: userFacingExplanation({
      analysis: lastEvent(events, "run.analysis")?.interpretation,
      failed,
      reviewAccepted,
      distribution: visualization.distribution,
      values: visualization.values,
      locale,
    }),
    trust: failed
      ? {
          label: best
            ? locale === "ja" ? "利用可能な最良結果・未検証" : "Best available · not verified"
            : locale === "ja" ? "実行済み・検証失敗" : "Executed · verification failed",
          tone: "warn",
        }
      : reviewAccepted
        ? { label: locale === "ja" ? "実行済み" : "Executed", tone: "ok" }
        : { label: locale === "ja" ? "実行済み・要確認" : "Executed · needs attention", tone: "warn" },
    saved: Boolean(lastEvent(events, "artifact.saved")),
    distribution: visualization.distribution,
    traces: visualization.traces,
    values: visualization.values,
    facts: [
      ...(plan?.algorithm ? [{ label: locale === "ja" ? "アルゴリズム" : "Algorithm", value: plan.algorithm }] : []),
      ...(plan?.framework ? [{ label: locale === "ja" ? "フレームワーク" : "Framework", value: plan.framework }] : []),
      ...(source?.revision !== undefined
        ? [{ label: locale === "ja" ? "リビジョン" : "Revision", value: String(source.revision) }]
        : []),
      ...(shots ? [{ label: locale === "ja" ? "ショット数" : "Shots", value: shots.toLocaleString(locale === "ja" ? "ja-JP" : "en-US") }] : []),
    ],
    code: source?.code
      ? {
          label: failed
            ? locale === "ja" ? "利用可能な最良コード" : "Best available code"
            : locale === "ja" ? "最終コード" : "Final code",
          language: source.language ?? plan?.framework ?? "python",
          source: source.code,
        }
      : null,
    limitations,
    notice: noticeParts.length
      ? {
          title: best
            ? locale === "ja" ? "この結果が採用されなかった理由" : "Why this result was not accepted"
            : locale === "ja" ? "検証が停止した理由" : "Why verification stopped",
          body: noticeParts.join(" "),
        }
      : null,
  };
}
