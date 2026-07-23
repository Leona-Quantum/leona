// Verdict banner (S4) — full-width strip, never truncated. Copy per docs/ui/copy.md:
// "Verified" / "Structurally verified" / "Verified with caveats" / "Not verified" /
// "Failed" — never "Success!".
// The detail line names the concrete verification method, e.g.
// "Verified — statistical (TVD 0.0088 ≤ δ) · seed 42 · 4096 shots".
import type { ReactNode } from "react";

export type Verdict = "verified" | "structural_only" | "verified_caveats" | "not_verified" | "failed" | "legacy_unknown";

const VERDICT_COPY: Record<Verdict, { label: string; tone: "ok" | "warn" | "err" }> = {
  verified: { label: "Verified", tone: "ok" },
  // A pass whose evidence was contract checks only — nothing compared the circuit
  // against what the physics should do. Distinct from "with caveats", which means a
  // physical check ran and left something unresolved. See
  // plans/evidence-strength-labelling.md.
  structural_only: { label: "Structurally verified", tone: "warn" },
  verified_caveats: { label: "Verified with caveats", tone: "warn" },
  not_verified: { label: "Not verified", tone: "warn" },
  failed: { label: "Failed", tone: "err" },
  legacy_unknown: { label: "Legacy evidence unknown", tone: "warn" },
};

export function VerdictBanner({
  verdict,
  detail,
}: {
  verdict: Verdict;
  /** Method + parameters, always with units/tolerances. */
  detail?: string;
}): ReactNode {
  const { label, tone } = VERDICT_COPY[verdict];
  return (
    <div className="mj-verdict" data-tone={tone} role="status">
      {label}
      {detail ? <span className="mj-verdict-detail">{detail}</span> : null}
    </div>
  );
}
