// Story list rendered to static HTML by scripts/render.mjs. Each story is a single real
// @majorana/ui component instance in a known state; the a11y test asserts each is free of
// WCAG violations. Coverage target (spec §5 step 2): every StageRail state in both the
// interactive (button rows) and non-interactive (div rows) paths, every VerdictBanner
// verdict, EmptyState with and without an action, and the composed RunView across the
// verified / mid-run / failed / queued fixtures.
import type { ReactNode } from "react";
import {
  EmptyState,
  RunOutcome,
  RunProgress,
  RunView,
  StageRail,
  VerdictBanner,
  VerificationSummaryPanel,
  type RailStage,
} from "@majorana/ui";
import { RUN_FIXTURES } from "./run-fixtures";

export interface Story {
  /** Stable slug → dist/<name>.html and the axe test title. */
  name: string;
  /** Human label for the test report. */
  title: string;
  node: ReactNode;
}

const MID_RUN: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "2.1 s" },
  { id: "generate", name: "Generate", state: "pass", elapsed: "8.4 s" },
  { id: "verify", name: "Verify", state: "running", elapsed: "3.0 s" },
  { id: "analyze", name: "Analysis", state: "pending" },
];

const ALL_PASS: RailStage[] = MID_RUN.map((s) => ({
  id: s.id,
  name: s.name,
  state: "pass",
  elapsed: s.elapsed ?? "0.3 s",
}));

const ALL_PENDING: RailStage[] = MID_RUN.map((s) => ({ id: s.id, name: s.name, state: "pending" }));

const RUN_PROGRESS_ITEMS = [
  { id: "plan", title: "Plan", detail: "Bell · qiskit · 2 qubits", state: "done" as const },
  { id: "generate", title: "Generate", detail: "Revision 1 ready", state: "done" as const },
  { id: "execute", title: "Execute", detail: "Sandbox completed in 1.2 s", state: "done" as const },
  { id: "review", title: "Review", detail: "Check request, code, and result alignment", state: "active" as const },
  { id: "save", title: "Save", detail: "Package the private artifact and optional OpenQASM", state: "waiting" as const },
];

// One rail exercising every state at once (pass / running / skipped / fail / pending).
const ALL_STATES: RailStage[] = [
  { id: "plan", name: "Plan", state: "pass", elapsed: "1.8 s" },
  { id: "generate", name: "Generate", state: "running", elapsed: "2.0 s" },
  {
    id: "verify",
    name: "Verify",
    state: "fail",
    elapsed: "1.1 s",
    errorSummary: "Statistical check failed: TVD 0.21 > δ 0.05 (seed 42, 4096 shots)",
  },
  { id: "analyze", name: "Analysis", state: "skipped", skipReason: "waiting for verification" },
];

const PASS_SUMMARY = {
  decision: "pass" as const, evidence_strength: "physical" as const,
  reason_code: "all_required_checks_passed", candidate_defect_observed: false,
  failure_class: null, retry_target: "none" as const, semantic_review_decision: "ready" as const,
  checks: [{ method: "bell_state_property" as const, result: "pass" as const }], unverified_claims: [],
};
const FAIL_SUMMARY = {
  decision: "fail" as const, evidence_strength: null, reason_code: "physical_property_mismatch",
  candidate_defect_observed: true, failure_class: "candidate_defect" as const,
  retry_target: "code_generation" as const, semantic_review_decision: "code_repair" as const,
  checks: [{ method: "bell_state_property" as const, result: "fail" as const }], unverified_claims: [],
};
const INCONCLUSIVE_SUMMARY = {
  decision: "inconclusive" as const, evidence_strength: null, reason_code: "required_check_unavailable",
  candidate_defect_observed: false, failure_class: "capability_limit" as const,
  retry_target: "none" as const, semantic_review_decision: "ready" as const,
  checks: [
    { method: "return_contract" as const, result: "pass" as const },
    { method: "statistical" as const, result: "unavailable" as const },
    { method: "statistical_reproducibility" as const, result: "error" as const },
  ],
  unverified_claims: ["Expected Bell-state distribution", "Relative phase"],
};

function StudioEvidenceFixture({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mj-studio-surface mj-studio-version-panel" style={{ maxWidth: "760px" }}><div className="mj-studio-surface-head"><div><span className="mj-section-label">Version history</span><h2>{title}</h2></div><span className="mj-mono-muted">Studio</span></div><div className="mj-studio-version-evidence" style={{ margin: "var(--sp-4)" }}>{children}</div></section>;
}

export const STORIES: Story[] = [
  {
    name: "run-outcome-reviewed",
    title: "RunOutcome — executed saved result",
    node: (
      <RunOutcome
        outcome={{
          tone: "warn",
          eyebrow: "Executed result",
          title: "The circuit executed and matched the request",
          description: "Bell state preparation with Qiskit.",
          badges: [
            { label: "Executed", tone: "warn" },
            { label: "Saved to Vault", tone: "neutral" },
          ],
          facts: [
            { label: "Algorithm", value: "Bell" },
            { label: "Framework", value: "qiskit" },
            { label: "Revision", value: "1" },
          ],
          callout: {
            title: "Strict verification was not run",
            body: "Not established: quantum correctness, physical fidelity, optimality.",
          },
          checks: [
            { label: "Structural", state: "pass" },
            { label: "Return Contract", state: "pass" },
            { label: "Success Criteria", state: "pass" },
          ],
          code: {
            label: "Generated code · revision 1",
            language: "python",
            source: "from qiskit import QuantumCircuit\n\nqc = QuantumCircuit(2)\nqc.h(0)\nqc.cx(0, 1)",
          },
        }}
      />
    ),
  },
  {
    name: "run-outcome-failed",
    title: "RunOutcome — failed with best candidate",
    node: (
      <RunOutcome
        outcome={{
          tone: "err",
          eyebrow: "Run incomplete",
          title: "No accepted result was produced",
          description: "The closest candidate is available for inspection, but it did not complete the workflow.",
          badges: [
            { label: "Unverified", tone: "err" },
            { label: "Not saved", tone: "warn" },
          ],
          facts: [
            { label: "Framework", value: "qiskit" },
            { label: "Revision", value: "3" },
          ],
          callout: {
            title: "Starting point only",
            body: "The measured distribution does not match the requested Bell state.",
          },
          checks: [{ label: "Statistical", state: "fail" }],
        }}
      />
    ),
  },
  {
    name: "run-progress-active",
    title: "RunProgress — review active",
    node: <RunProgress progress={{ label: "Run in progress", headline: "Check request, code, and result alignment", items: RUN_PROGRESS_ITEMS }} />,
  },
  {
    name: "run-progress-complete",
    title: "RunProgress — complete",
    node: <RunProgress progress={{ label: "Run complete", headline: "Circuit generated, executed, reviewed, and saved", items: RUN_PROGRESS_ITEMS.map((item) => ({ ...item, state: "done" as const })) }} />,
  },
  {
    name: "run-progress-error",
    title: "RunProgress — generation error",
    node: <RunProgress progress={{ label: "Run needs attention", headline: "Generation provider unavailable", items: RUN_PROGRESS_ITEMS.map((item) => item.id === "generate" ? { ...item, detail: "Provider rate limit reached", state: "error" as const } : item.id === "plan" ? item : { ...item, state: "waiting" as const }) }} />,
  },
  { name: "studio-verification-pass", title: "Studio — PASS artifact", node: <StudioEvidenceFixture title="Bell state"><VerificationSummaryPanel summary={PASS_SUMMARY} /></StudioEvidenceFixture> },
  { name: "studio-verification-fail", title: "Studio — FAIL evidence", node: <StudioEvidenceFixture title="Bell state candidate"><VerificationSummaryPanel summary={FAIL_SUMMARY} /></StudioEvidenceFixture> },
  { name: "studio-verification-inconclusive", title: "Studio — INCONCLUSIVE artifact", node: <StudioEvidenceFixture title="Dynamic circuit"><VerificationSummaryPanel summary={INCONCLUSIVE_SUMMARY} /></StudioEvidenceFixture> },
  { name: "studio-verification-legacy", title: "Studio — legacy evidence unknown", node: <StudioEvidenceFixture title="Historical artifact"><VerificationSummaryPanel summary={null} state="legacy" /></StudioEvidenceFixture> },
  { name: "studio-verification-stale", title: "Studio — edited formerly-PASS artifact", node: <StudioEvidenceFixture title="Bell state draft"><VerificationSummaryPanel summary={PASS_SUMMARY} state="stale" /></StudioEvidenceFixture> },
  { name: "studio-verification-loading", title: "Studio — verification loading", node: <StudioEvidenceFixture title="Loading artifact"><VerificationSummaryPanel summary={null} state="loading" /></StudioEvidenceFixture> },
  { name: "studio-verification-empty", title: "Studio — no verification record", node: <StudioEvidenceFixture title="New draft"><VerificationSummaryPanel summary={null} state="empty" /></StudioEvidenceFixture> },
  { name: "studio-verification-error", title: "Studio — verification load error", node: <StudioEvidenceFixture title="Unavailable artifact"><VerificationSummaryPanel summary={null} state="error" /></StudioEvidenceFixture> },
  // ---- StageRail (6): all states × interactive/non-interactive ----
  {
    name: "rail-mid-run",
    title: "StageRail — mid-run (pass / running / pending), interactive",
    node: <StageRail stages={MID_RUN} onSelect={() => {}} />,
  },
  {
    name: "rail-all-states",
    title: "StageRail — every state (pass / running / skipped / fail / pending) + retry",
    node: <StageRail stages={ALL_STATES} onSelect={() => {}} onRetry={() => {}} />,
  },
  {
    name: "rail-all-pass",
    title: "StageRail — all stages passed",
    node: <StageRail stages={ALL_PASS} onSelect={() => {}} />,
  },
  {
    name: "rail-all-pending",
    title: "StageRail — all stages pending",
    node: <StageRail stages={ALL_PENDING} onSelect={() => {}} />,
  },
  {
    name: "rail-noninteractive",
    title: "StageRail — non-interactive (div rows, no content panel)",
    node: <StageRail stages={ALL_STATES} />,
  },
  {
    name: "rail-single-fail",
    title: "StageRail — isolated fail row with retry",
    node: (
      <StageRail
        stages={[
          {
            id: "verify",
            name: "Verify",
            state: "fail",
            elapsed: "1.1 s",
            errorSummary: "QASM-parse failed: no parseable OpenQASM 2 on stdout",
          },
        ]}
        onSelect={() => {}}
        onRetry={() => {}}
      />
    ),
  },

  // ---- VerdictBanner (4) ----
  {
    name: "verdict-verified",
    title: "VerdictBanner — verified",
    node: (
      <VerdictBanner
        verdict="verified"
        detail="Verified — statistical (TVD 0.0088 ≤ δ 0.05) · seed 42 · 4096 shots"
      />
    ),
  },
  {
    name: "verdict-verified-caveats",
    title: "VerdictBanner — verified with caveats",
    node: (
      <VerdictBanner
        verdict="verified_caveats"
        detail="Contract checks passed; statistical check skipped — statevector output"
      />
    ),
  },
  {
    name: "verdict-not-verified",
    title: "VerdictBanner — not verified",
    node: (
      <VerdictBanner
        verdict="not_verified"
        detail="No verification method applies to this task class"
      />
    ),
  },
  {
    name: "verdict-failed",
    title: "VerdictBanner — failed",
    node: (
      <VerdictBanner
        verdict="failed"
        detail="Statistical check failed: TVD 0.21 > δ 0.05 · seed 42 · 4096 shots"
      />
    ),
  },

  // ---- EmptyState (2) ----
  {
    name: "empty-with-action",
    title: "EmptyState — message + action",
    node: (
      <EmptyState
        message="Nothing verified yet. Your first verified run will appear here."
        action={{ label: "Start a run", href: "/run" }}
      />
    ),
  },
  {
    name: "empty-no-action",
    title: "EmptyState — message only",
    node: <EmptyState message="No runs match this filter." />,
  },

  // ---- RunView (4): composed S3+S4 across the fixtures ----
  {
    name: "runview-verified",
    title: "RunView — verified run (full result panel)",
    node: <RunView events={RUN_FIXTURES.verified} />,
  },
  {
    name: "runview-model-activity",
    title: "RunView — live plan output",
    node: <RunView events={RUN_FIXTURES["model-activity"]} />,
  },
  {
    name: "runview-failed",
    title: "RunView — failed verification",
    node: <RunView events={RUN_FIXTURES.failed} />,
  },
  {
    name: "runview-midrun",
    title: "RunView — mid-run (verify)",
    node: <RunView events={RUN_FIXTURES.midrun} />,
  },
  {
    name: "runview-queued",
    title: "RunView — queued (waiting)",
    node: <RunView events={RUN_FIXTURES.queued} />,
  },
];
