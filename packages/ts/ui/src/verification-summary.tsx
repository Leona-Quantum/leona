import type { components } from "@majorana/contracts-gen";
import type { ReactNode } from "react";

type VerificationSummary = components["schemas"]["VerificationSummary"];
type EvidenceStrength = components["schemas"]["EvidenceStrength"];
type ResultKind = components["schemas"]["VerificationResultKind"];
type DisplayState = "ready" | "loading" | "empty" | "legacy" | "error" | "stale";
export type VerificationLocale = "en" | "ja";

/** Every word this panel and its chips can say, in both languages.
 *
 * One table, because the Japanese vocabulary for a verdict already existed in
 * two hand-written copies — `verdictChip` on the artifact page and this panel's
 * English — and a verdict that reads "Executed" on one screen and 実行済み on
 * another is the same conflation `verificationHeadline` was extracted to undo.
 * A new verdict word goes here or it goes nowhere. */
const COPY: Record<VerificationLocale, {
  titles: Record<"failed" | "executedWithReference" | "executed" | "unavailable" | "verified" | "structural", string>;
  states: Record<Exclude<DisplayState, "ready">, { title: string; body: string }>;
  nextAction: Record<VerificationSummary["retry_target"], string>;
  warnings: Record<"reference" | "advisory" | "inconclusive", string>;
  actions: Record<"advisory" | "none", string>;
  evidence: Record<EvidenceStrength, string>;
  results: Record<ResultKind, string>;
  /** `unverified_claims` is a free-string list the API writes. The five below
   * are the fixed vocabulary an artifact-only run emits, so they translate. A
   * claim the reviewer wrote in prose falls through in the language the model
   * wrote it — a lookup cannot translate an open string, and inventing one
   * would mean showing a Japanese sentence the record does not contain. */
  claims: Record<string, string>;
  reason: string;
  evidenceStrength: string;
  notEstablished: string;
  passedChecks: string;
  failedChecks: string;
  unresolvedChecks: string;
  unverifiedClaims: string;
  recommendedNextAction: string;
}> = {
  en: {
    titles: {
      failed: "Failed",
      executedWithReference: "Executed · reference check passed",
      executed: "Executed",
      unavailable: "Verification unavailable",
      verified: "Verified",
      structural: "Structurally verified",
    },
    states: {
      loading: { title: "Loading verification", body: "Verification evidence is being loaded from the control plane." },
      empty: { title: "No verification record", body: "No verification evidence is attached to this artifact." },
      legacy: { title: "Legacy evidence unknown", body: "This record predates typed verification summaries. It is not treated as Verified." },
      error: { title: "Verification evidence unavailable", body: "The evidence could not be loaded. Retry before relying on this artifact." },
      stale: { title: "Verification stale", body: "The source has changed. Previous evidence does not apply to this draft." },
    },
    nextAction: {
      code_generation: "Repair the candidate source and run verification again.",
      planning: "Review the request and plan before generating another candidate.",
      simulation: "Collect the missing execution evidence with the same candidate revision.",
      verification: "Retry verification with the same candidate revision.",
      none: "Review the evidence before relying on this artifact.",
    },
    warnings: {
      reference: "The generated code ran, its basic result contract passed, and its reported value matched the reference the plan declared. No other quantum property was checked.",
      advisory: "The generated code ran and its basic result contract passed. Strict quantum correctness was not verified.",
      inconclusive: "Verification unavailable — correctness has not been confirmed.",
    },
    actions: {
      advisory: "Treat this private artifact as unverified.",
      none: "No verification action is required.",
    },
    // The English side renders the contract's own words, exactly as it did
    // before this table existed. Only Japanese needed inventing.
    evidence: { physical: "physical", structural: "structural" },
    results: { pass: "pass", fail: "fail", skipped: "skipped", unavailable: "unavailable", error: "error" },
    claims: {},
    reason: "Reason",
    evidenceStrength: "Evidence strength",
    notEstablished: "Not established",
    passedChecks: "Passed checks",
    failedChecks: "Failed checks",
    unresolvedChecks: "Checks that did not establish anything",
    unverifiedClaims: "Unverified claims",
    recommendedNextAction: "Recommended next action",
  },
  ja: {
    titles: {
      failed: "検証失敗",
      executedWithReference: "実行済み・参照値と一致",
      executed: "実行済み",
      unavailable: "検証結果なし",
      verified: "検証済み",
      structural: "構造のみ検証",
    },
    states: {
      loading: { title: "検証結果を読み込み中", body: "サーバーから検証結果を読み込んでいます。" },
      empty: { title: "検証記録なし", body: "この回路には検証結果が保存されていません。" },
      legacy: { title: "旧形式・検証記録なし", body: "検証結果の保存形式が追加される前の記録です。検証済みとしては扱いません。" },
      error: { title: "検証結果を取得できません", body: "検証結果を読み込めませんでした。この回路を根拠にする前に、もう一度お試しください。" },
      stale: { title: "要再検証", body: "ソースコードが変更されています。以前の検証結果はこの下書きには適用されません。" },
    },
    nextAction: {
      code_generation: "生成されたソースコードを修正して、もう一度検証してください。",
      planning: "リクエストと計画を見直してから、もう一度生成してください。",
      simulation: "同じソースコードのまま、不足している実行結果を取得してください。",
      verification: "同じソースコードのまま、検証をもう一度実行してください。",
      none: "この回路を根拠にする前に、検証結果を確認してください。",
    },
    warnings: {
      reference: "生成されたコードが実行され、基本的な出力形式の確認に合格し、報告された値が計画で宣言した参照値と一致しました。それ以外の量子的な性質は確認していません。",
      advisory: "生成されたコードが実行され、基本的な出力形式の確認に合格しました。量子計算としての正しさは検証していません。",
      inconclusive: "検証結果なし — 正しさは確認できていません。",
    },
    actions: {
      advisory: "この回路は未検証として扱ってください。",
      none: "対応は不要です。",
    },
    evidence: { physical: "物理量まで確認", structural: "構造のみ" },
    results: { pass: "合格", fail: "不合格", skipped: "対象外", unavailable: "実施できず", error: "エラー" },
    claims: {
      "reported output": "出力値",
      "quantum correctness": "量子計算としての正しさ",
      "physical fidelity": "物理的な忠実度",
      "optimality": "最適性",
      "intent alignment": "リクエストとの一致",
    },
    reason: "判定理由",
    evidenceStrength: "根拠の強さ",
    notEstablished: "未確立",
    passedChecks: "合格した確認項目",
    failedChecks: "不合格の確認項目",
    unresolvedChecks: "判定できなかった確認項目",
    unverifiedClaims: "未検証の項目",
    recommendedNextAction: "次にすべきこと",
  },
};

/** Reason codes the fixed pipeline emits for a run that finished on its own
 * trusted evidence. Matching them by prefix rather than by one exact string is
 * deliberate: keying on `ai_review_aligned` alone made the STRONGER outcome
 * render worse than the weaker one, because a run whose plan-declared
 * `exact_diag`/`brute_force` reference actually passed reports
 * `ai_review_aligned_with_reference_check` and fell through to the generic
 * "Verification unavailable" branch. See ADR-0023 Amendment 1. */
const ADVISORY_REASON_PREFIX = "ai_review_aligned";
const TRUSTED_EVIDENCE_REASON = "trusted_evidence_without_review_acceptance";

function isAdvisoryOutcome(summary: VerificationSummary): boolean {
  return summary.reason_code.startsWith(ADVISORY_REASON_PREFIX)
    || summary.reason_code === TRUSTED_EVIDENCE_REASON;
}

/** A reference check ran and passed, so one number really was compared against
 * what the physics should do. The overall decision stays INCONCLUSIVE — that
 * split is exactly what EvidenceStrength exists to express. */
function hasReferenceEvidence(summary: VerificationSummary): boolean {
  return isAdvisoryOutcome(summary) && summary.evidence_strength === "physical";
}

function titleFor(summary: VerificationSummary, locale: VerificationLocale): string {
  const titles = COPY[locale].titles;
  if (summary.decision === "fail") return titles.failed;
  if (hasReferenceEvidence(summary)) return titles.executedWithReference;
  if (isAdvisoryOutcome(summary)) return titles.executed;
  if (summary.decision === "inconclusive") return titles.unavailable;
  return summary.evidence_strength === "physical" ? titles.verified : titles.structural;
}

function toneFor(summary: VerificationSummary): "ok" | "warn" | "err" {
  if (summary.decision === "fail") return "err";
  return summary.decision === "pass" && summary.evidence_strength === "physical" ? "ok" : "warn";
}

function stateMessage(
  state: Exclude<DisplayState, "ready">,
  locale: VerificationLocale,
): { title: string; body: string; tone: "warn" | "err" | "neutral" } {
  const tone = state === "error" ? "err" : state === "legacy" || state === "stale" ? "warn" : "neutral";
  return { ...COPY[locale].states[state], tone };
}

/** The verdict words on their own, for a surface that shows a label without the
 * evidence beneath it. Exported so no screen has to retype them in either
 * language. */
export function verificationVocabulary(locale: VerificationLocale): Readonly<Record<
  "failed" | "executedWithReference" | "executed" | "unavailable" | "verified" | "structural" | "stale" | "legacy",
  string
>> {
  const copy = COPY[locale];
  return {
    ...copy.titles,
    stale: copy.states.stale.title,
    legacy: copy.states.legacy.title,
  };
}

/** The one-line version of this panel: the same words, without the evidence.
 *
 * Exported so a compact status chip elsewhere cannot invent its own vocabulary.
 * A second implementation of "what does this artifact's evidence amount to" is
 * exactly how a structural pass ends up reading as "Verified" on one screen and
 * not another — the conflation `verdictChip` on the artifact page was written to undo.
 * The glyph is carried alongside the tone so status never rides on hue alone. */
export function verificationHeadline(
  summary: VerificationSummary | null,
  state: DisplayState = summary ? "ready" : "legacy",
  locale: VerificationLocale = "en",
): { title: string; tone: "ok" | "warn" | "err" | "neutral"; glyph: string } {
  if (state !== "ready" || !summary) {
    const display = stateMessage(state === "ready" ? "legacy" : state, locale);
    return { title: display.title, tone: display.tone, glyph: display.tone === "err" ? "×" : "–" };
  }
  const tone = toneFor(summary);
  return { title: titleFor(summary, locale), tone, glyph: tone === "ok" ? "✓" : tone === "err" ? "×" : "–" };
}

/** Pure renderer for the API-owned verification state. It never derives a verdict
 * from RunStatus, source kind, local storage, or missing data. */
export function VerificationSummaryPanel({
  summary,
  state = summary ? "ready" : "legacy",
  locale = "en",
}: {
  summary: VerificationSummary | null;
  state?: DisplayState;
  locale?: VerificationLocale;
}): ReactNode {
  const copy = COPY[locale];
  if (state !== "ready" || !summary) {
    const display = stateMessage(state === "ready" ? "legacy" : state, locale);
    return (
      <section className="mj-trust-summary" data-tone={display.tone} role={state === "error" ? "alert" : "status"} aria-label={`${display.title}. ${display.body}`}>
        <strong>{display.title}</strong>
        <p>{display.body}</p>
      </section>
    );
  }

  const title = titleFor(summary, locale);
  const passed = summary.checks?.filter((check) => check.result === "pass") ?? [];
  // `skipped` belonged to no group, so a check that did not apply rendered
  // nowhere at all — indistinguishable, to anyone counting what was examined,
  // from a check that passed. The simple pipeline records exactly that for
  // `return_contract` when the platform derived the result rather than the
  // program returning one, so this is a real row, not a defensive branch.
  const unresolved = summary.checks?.filter((check) => check.result === "unavailable" || check.result === "error" || check.result === "skipped") ?? [];
  const failed = summary.checks?.filter((check) => check.result === "fail") ?? [];
  const claims = summary.unverified_claims ?? [];
  const advisoryOutcome = isAdvisoryOutcome(summary);
  const warning = hasReferenceEvidence(summary)
    ? copy.warnings.reference
    : advisoryOutcome
      ? copy.warnings.advisory
      : summary.decision === "inconclusive"
        ? copy.warnings.inconclusive
        : null;
  const action = advisoryOutcome
    ? copy.actions.advisory
    : summary.retry_target === "none" && summary.decision === "pass"
      ? copy.actions.none
      : copy.nextAction[summary.retry_target];
  const strength = summary.evidence_strength ? copy.evidence[summary.evidence_strength] : copy.notEstablished;
  const aria = [title, warning, `${copy.reason} ${summary.reason_code}`, `${copy.evidenceStrength} ${strength}`, action]
    .filter(Boolean)
    .join(". ");

  return (
    <section className="mj-trust-summary" data-tone={toneFor(summary)} role="status" aria-label={aria}>
      <strong>{title}</strong>
      {warning ? <p className="mj-trust-summary-warning">{warning}</p> : null}
      <dl>
        <div><dt>{copy.reason}</dt><dd><code>{summary.reason_code}</code></dd></div>
        <div><dt>{copy.evidenceStrength}</dt><dd>{strength}</dd></div>
      </dl>
      {passed.length ? <CheckGroup title={copy.passedChecks} checks={passed} locale={locale} /> : null}
      {failed.length ? <CheckGroup title={copy.failedChecks} checks={failed} locale={locale} /> : null}
      {unresolved.length ? <CheckGroup title={copy.unresolvedChecks} checks={unresolved} locale={locale} /> : null}
      {claims.length ? <div><h3>{copy.unverifiedClaims}</h3><ul>{claims.map((claim) => <li key={claim}>{copy.claims[claim] ?? claim}</li>)}</ul></div> : null}
      <p><strong>{copy.recommendedNextAction}</strong><br />{action}</p>
    </section>
  );
}

function CheckGroup({ title, checks, locale }: { title: string; checks: NonNullable<VerificationSummary["checks"]>; locale: VerificationLocale }): ReactNode {
  const results = COPY[locale].results;
  return <div><h3>{title}</h3><ul>{checks.map((check, index) => <li key={`${check.method}-${index}`}><code>{check.method}</code> — {results[check.result] ?? check.result}</li>)}</ul></div>;
}
