import type { components } from "@majorana/contracts-gen";
import type { ReactNode } from "react";

type VerificationSummary = components["schemas"]["VerificationSummary"];
type DisplayState = "ready" | "loading" | "empty" | "legacy" | "error" | "stale";

const NEXT_ACTION: Record<VerificationSummary["retry_target"], string> = {
  code_generation: "Repair the candidate source and run verification again.",
  planning: "Review the request and plan before generating another candidate.",
  simulation: "Collect the missing execution evidence with the same candidate revision.",
  verification: "Retry verification with the same candidate revision.",
  none: "Review the evidence before relying on this artifact.",
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

function titleFor(summary: VerificationSummary): string {
  if (summary.decision === "fail") return "Failed";
  if (hasReferenceEvidence(summary)) return "Executed · reference check passed";
  if (isAdvisoryOutcome(summary)) return "Executed";
  if (summary.decision === "inconclusive") return "Verification unavailable";
  return summary.evidence_strength === "physical" ? "Verified" : "Structurally verified";
}

function toneFor(summary: VerificationSummary): "ok" | "warn" | "err" {
  if (summary.decision === "fail") return "err";
  return summary.decision === "pass" && summary.evidence_strength === "physical" ? "ok" : "warn";
}

function stateMessage(state: Exclude<DisplayState, "ready">): { title: string; body: string; tone: "warn" | "err" | "neutral" } {
  switch (state) {
    case "loading": return { title: "Loading verification", body: "Verification evidence is being loaded from the control plane.", tone: "neutral" };
    case "empty": return { title: "No verification record", body: "No verification evidence is attached to this artifact.", tone: "neutral" };
    case "legacy": return { title: "Legacy evidence unknown", body: "This record predates typed verification summaries. It is not treated as Verified.", tone: "warn" };
    case "error": return { title: "Verification evidence unavailable", body: "The evidence could not be loaded. Retry before relying on this artifact.", tone: "err" };
    case "stale": return { title: "Verification stale", body: "The source has changed. Previous evidence does not apply to this draft.", tone: "warn" };
  }
}

/** The one-line version of this panel: the same words, without the evidence.
 *
 * Exported so a compact status chip elsewhere cannot invent its own vocabulary.
 * A second implementation of "what does this artifact's evidence amount to" is
 * exactly how a structural pass ends up reading as "Verified" on one screen and
 * not another — the conflation `verdictChip` in the Vault was written to undo.
 * The glyph is carried alongside the tone so status never rides on hue alone. */
export function verificationHeadline(
  summary: VerificationSummary | null,
  state: DisplayState = summary ? "ready" : "legacy",
): { title: string; tone: "ok" | "warn" | "err" | "neutral"; glyph: string } {
  if (state !== "ready" || !summary) {
    const display = stateMessage(state === "ready" ? "legacy" : state);
    return { title: display.title, tone: display.tone, glyph: display.tone === "err" ? "×" : "–" };
  }
  const tone = toneFor(summary);
  return { title: titleFor(summary), tone, glyph: tone === "ok" ? "✓" : tone === "err" ? "×" : "–" };
}

/** Pure renderer for the API-owned verification state. It never derives a verdict
 * from RunStatus, source kind, local storage, or missing data. */
export function VerificationSummaryPanel({
  summary,
  state = summary ? "ready" : "legacy",
}: {
  summary: VerificationSummary | null;
  state?: DisplayState;
}): ReactNode {
  if (state !== "ready" || !summary) {
    const display = stateMessage(state === "ready" ? "legacy" : state);
    return (
      <section className="mj-trust-summary" data-tone={display.tone} role={state === "error" ? "alert" : "status"} aria-label={`${display.title}. ${display.body}`}>
        <strong>{display.title}</strong>
        <p>{display.body}</p>
      </section>
    );
  }

  const title = titleFor(summary);
  const passed = summary.checks?.filter((check) => check.result === "pass") ?? [];
  const unresolved = summary.checks?.filter((check) => check.result === "unavailable" || check.result === "error") ?? [];
  const failed = summary.checks?.filter((check) => check.result === "fail") ?? [];
  const claims = summary.unverified_claims ?? [];
  const advisoryOutcome = isAdvisoryOutcome(summary);
  const warning = hasReferenceEvidence(summary)
    ? "The generated code ran, its basic result contract passed, and its reported value matched the reference the plan declared. No other quantum property was checked."
    : advisoryOutcome
      ? "The generated code ran and its basic result contract passed. Strict quantum correctness was not verified."
      : summary.decision === "inconclusive"
        ? "Verification unavailable — correctness has not been confirmed."
        : null;
  const action = advisoryOutcome
    ? "Treat this private artifact as unverified."
    : summary.retry_target === "none" && summary.decision === "pass"
      ? "No verification action is required."
      : NEXT_ACTION[summary.retry_target];
  const aria = [title, warning, `Reason ${summary.reason_code}`, `Evidence strength ${summary.evidence_strength ?? "not established"}`, action]
    .filter(Boolean)
    .join(". ");

  return (
    <section className="mj-trust-summary" data-tone={toneFor(summary)} role="status" aria-label={aria}>
      <strong>{title}</strong>
      {warning ? <p className="mj-trust-summary-warning">{warning}</p> : null}
      <dl>
        <div><dt>Reason</dt><dd><code>{summary.reason_code}</code></dd></div>
        <div><dt>Evidence strength</dt><dd>{summary.evidence_strength ?? "Not established"}</dd></div>
      </dl>
      {passed.length ? <CheckGroup title="Passed checks" checks={passed} /> : null}
      {failed.length ? <CheckGroup title="Failed checks" checks={failed} /> : null}
      {unresolved.length ? <CheckGroup title="Unavailable or errored checks" checks={unresolved} /> : null}
      {claims.length ? <div><h3>Unverified claims</h3><ul>{claims.map((claim) => <li key={claim}>{claim}</li>)}</ul></div> : null}
      <p><strong>Recommended next action</strong><br />{action}</p>
    </section>
  );
}

function CheckGroup({ title, checks }: { title: string; checks: NonNullable<VerificationSummary["checks"]> }): ReactNode {
  return <div><h3>{title}</h3><ul>{checks.map((check, index) => <li key={`${check.method}-${index}`}><code>{check.method}</code> — {check.result}</li>)}</ul></div>;
}
