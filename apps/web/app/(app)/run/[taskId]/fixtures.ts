// Fixture RunEvent logs for the canonical pipeline. These stand in for the persisted
// event stream until the BFF glue lands; the page is a pure renderer of whichever log
// it receives. Prefixes of VERIFIED model refreshes during a live run.
import type { RunEvent } from "@majorana/ui";

const RUN = "1f8e2a10-0000-4000-8000-000000000001";
const ART = "a7c1b0d2-0000-4000-8000-0000000000aa";
const CANDIDATE = "c7c1b0d2-0000-4000-8000-0000000000cc";
const EXECUTION = "e7c1b0d2-0000-4000-8000-0000000000ee";
const REVIEW = "b7c1b0d2-0000-4000-8000-0000000000bb";

function ts(sec: number): string {
  return new Date(Date.UTC(2026, 6, 12, 12, 0, sec)).toISOString();
}

const SAMPLE_CODE = `from qiskit import QuantumCircuit
from qiskit_aer import AerSimulator

qc = QuantumCircuit(5)
qc.h(range(5))
# QAOA layer (p=1) for MaxCut on a 5-node ring
for a, b in [(0, 1), (1, 2), (2, 3), (3, 4), (4, 0)]:
    qc.cx(a, b)
    qc.rz(0.8, b)
    qc.cx(a, b)
qc.measure_all()
FINAL_CIRCUIT = qc

result = AerSimulator().run(qc, shots=4096, seed_simulator=42).result()
counts = result.get_counts()
print({"cut_value": 4, "bitstring": max(counts, key=counts.get)})`;

const METRICS = {
  qubits: 5,
  depth: 16,
  gate_count: 32,
  two_qubit_gate_count: 15,
  measurement_count: 5,
  estimated_runtime_ms: 40,
};
const COMPILED_METRICS = { ...METRICS, depth: 14, gate_count: 30 };
const QASM = {
  epilogue_applied: true,
  source: "sandbox_epilogue" as const,
  available: true,
  epilogue_error: null,
};
const PASS_SUMMARY = {
  decision: "pass" as const,
  evidence_strength: "physical" as const,
  reason_code: "all_required_checks_passed",
  candidate_defect_observed: false,
  failure_class: null,
  retry_target: "none" as const,
  semantic_review_decision: "ready" as const,
  checks: [{ method: "statistical" as const, result: "pass" as const }],
  unverified_claims: [],
};
const FAIL_SUMMARY = {
  decision: "fail" as const,
  evidence_strength: null,
  reason_code: "statistical_mismatch",
  candidate_defect_observed: true,
  failure_class: "candidate_defect" as const,
  retry_target: "code_generation" as const,
  semantic_review_decision: "code_repair" as const,
  checks: [{ method: "statistical" as const, result: "fail" as const }],
  unverified_claims: [],
};
const INCONCLUSIVE_SUMMARY = {
  decision: "inconclusive" as const,
  evidence_strength: null,
  reason_code: "required_check_unavailable",
  candidate_defect_observed: false,
  failure_class: "capability_limit" as const,
  retry_target: "none" as const,
  semantic_review_decision: "ready" as const,
  checks: [
    { method: "return_contract" as const, result: "pass" as const },
    { method: "statistical" as const, result: "unavailable" as const },
  ],
  unverified_claims: ["Expected physical distribution"],
};
const AI_REVIEWED_SUMMARY = {
  decision: "inconclusive" as const,
  evidence_strength: "structural" as const,
  reason_code: "ai_review_aligned",
  candidate_defect_observed: false,
  failure_class: "evidence_gap" as const,
  retry_target: "none" as const,
  semantic_review_decision: "ready" as const,
  checks: [
    { method: "structural" as const, result: "pass" as const },
    { method: "return_contract" as const, result: "pass" as const },
    { method: "success_criteria" as const, result: "pass" as const },
  ],
  unverified_claims: ["quantum correctness", "physical fidelity", "optimality"],
};

// ---- canonical successful run -----------------------------------------------------------
const VERIFIED: RunEvent[] = [
  { type: "run.queued", run_id: RUN, seq: 0, ts: ts(0), framework: "qiskit", mode: "execute" },
  { type: "run.started", run_id: RUN, seq: 1, ts: ts(1) },

  { type: "stage.started", run_id: RUN, seq: 2, ts: ts(2), stage: "plan" },
  {
    type: "plan.produced",
    run_id: RUN,
    seq: 3,
    ts: ts(3),
    plan: {
      algorithm: "QAOA",
      algorithm_rationale: "QAOA at depth p=1 fits this small MaxCut instance.",
      artifact_contract: null,
      domain: "optimization",
      expected_output_keys: ["cut_value", "bitstring"],
      expected_runtime_sec: 5,
      framework: "qiskit",
      parameters: { custom: null, max_iterations: 50, optimizer: "COBYLA", seed: null, shots: 4096 },
      problem_summary: "MaxCut on a 5-node ring graph.",
      qubits_estimate: 5,
      success_criteria: { additional_notes: null, expected_range: null, primary_metric: "cut_value" },
      verification_plan: null,
    },
  },
  { type: "stage.finished", run_id: RUN, seq: 4, ts: ts(4), stage: "plan", ok: true, duration_ms: 2100 },

  { type: "stage.started", run_id: RUN, seq: 5, ts: ts(5), stage: "generate" },
  { type: "code.generated", run_id: RUN, seq: 6, ts: ts(6), code: SAMPLE_CODE, language: "python", revision: 1 },
  { type: "stage.finished", run_id: RUN, seq: 7, ts: ts(13), stage: "generate", ok: true, duration_ms: 8400 },

  { type: "stage.started", run_id: RUN, seq: 8, ts: ts(14), stage: "screen" },
  { type: "screen.result", run_id: RUN, seq: 9, ts: ts(15), lint_ok: true, typecheck_ok: true, diagnostics: [] },
  { type: "stage.finished", run_id: RUN, seq: 10, ts: ts(16), stage: "screen", ok: true, duration_ms: 180 },

  { type: "stage.started", run_id: RUN, seq: 11, ts: ts(17), stage: "resource_estimate" },
  {
    type: "resource.estimate",
    run_id: RUN,
    seq: 12,
    ts: ts(18),
    phase: "pre_verify",
    source: "plan_static",
    metrics: METRICS,
    notes: [],
  },
  { type: "stage.finished", run_id: RUN, seq: 13, ts: ts(19), stage: "resource_estimate", ok: true, duration_ms: 40 },

  { type: "stage.started", run_id: RUN, seq: 14, ts: ts(20), stage: "verify" },
  {
    type: "sandbox.result",
    run_id: RUN,
    seq: 15,
    ts: ts(21),
    phase: "verification",
    duration_ms: 4520,
    exit_code: 0,
    memory_mb: 128,
    result: {
      counts: { "01010": 2184, "10101": 1912 },
      cut_value: 4,
      bitstring: "01010",
    },
    stderr: "",
    stdout: '{"cut_value": 4, "bitstring": "01010"}',
    truncated: false,
    qasm_emission: QASM,
  },
  {
    type: "verification.result",
    run_id: RUN,
    seq: 16,
    ts: ts(22),
    method: "statistical",
    result: "pass",
    attempt_id: null, attempt_seq: null, candidate_id: null, check_index: null, source_fingerprint: null,
    details: { metric: "TVD", metric_value: 0.0088, threshold: 0.05, seed: 42, shots: 4096 },
  },
  { type: "stage.finished", run_id: RUN, seq: 17, ts: ts(23), stage: "verify", ok: true, duration_ms: 5620 },

  { type: "stage.started", run_id: RUN, seq: 18, ts: ts(24), stage: "compile" },
  {
    type: "compilation.result",
    run_id: RUN,
    seq: 19,
    ts: ts(25),
    accepted: true,
    mode: "compressed",
    target: "qiskit",
    source_fingerprint: "sha256:source",
    compiled_fingerprint: "sha256:compressed",
    before: METRICS,
    after: COMPILED_METRICS,
    compatibility: { qiskit: "lossless", openqasm2: "lossless", pennylane: "lossless" },
    reason: "Adjacent self-inverse gates removed without worsening resources.",
  },
  { type: "stage.finished", run_id: RUN, seq: 20, ts: ts(26), stage: "compile", ok: true, duration_ms: 90 },

  { type: "stage.started", run_id: RUN, seq: 21, ts: ts(27), stage: "compiled_resource_estimate" },
  {
    type: "resource.estimate",
    run_id: RUN,
    seq: 22,
    ts: ts(28),
    phase: "compiled",
    source: "compiler",
    metrics: COMPILED_METRICS,
    notes: [],
  },
  { type: "stage.finished", run_id: RUN, seq: 23, ts: ts(29), stage: "compiled_resource_estimate", ok: true, duration_ms: 35 },

  { type: "stage.started", run_id: RUN, seq: 24, ts: ts(30), stage: "finalize" },
  { type: "export.classified", run_id: RUN, seq: 25, ts: ts(31), status: "lossless", reason: null, qasm_available: true },
  {
    type: "code.finalized",
    run_id: RUN,
    seq: 26,
    ts: ts(32),
    language: "python",
    code: SAMPLE_CODE,
    revision: 1,
    compilation_applied: false,
    simulation_plausible: true,
    qpu_available: false,
    conversion_options: ["openqasm2", "qiskit", "pennylane"],
    execution_options: ["simulate"],
    export_status: "lossless",
    export_reason: null,
    finalization_reason: null,
  },
  { type: "stage.finished", run_id: RUN, seq: 27, ts: ts(33), stage: "finalize", ok: true, duration_ms: 120 },

  { type: "stage.started", run_id: RUN, seq: 28, ts: ts(34), stage: "final_execute" },
  {
    type: "sandbox.result",
    run_id: RUN,
    seq: 29,
    ts: ts(35),
    phase: "final",
    duration_ms: 4480,
    exit_code: 0,
    memory_mb: 128,
    result: {
      counts: { "01010": 2184, "10101": 1912 },
      cut_value: 4,
      bitstring: "01010",
    },
    stderr: "",
    stdout: '{"cut_value": 4, "bitstring": "01010"}',
    truncated: false,
    qasm_emission: QASM,
  },
  { type: "stage.finished", run_id: RUN, seq: 30, ts: ts(36), stage: "final_execute", ok: true, duration_ms: 4480 },

  { type: "stage.started", run_id: RUN, seq: 31, ts: ts(37), stage: "baseline" },
  {
    type: "baseline.result",
    run_id: RUN,
    seq: 32,
    ts: ts(38),
    kind: "maxcut",
    not_applicable_reason: null,
    result: { classical_cut: 4, quantum_cut: 4, approx_ratio: 1.0 },
  },
  { type: "stage.finished", run_id: RUN, seq: 33, ts: ts(39), stage: "baseline", ok: true, duration_ms: 300 },

  { type: "stage.started", run_id: RUN, seq: 34, ts: ts(40), stage: "analyze" },
  {
    type: "run.analysis",
    run_id: RUN,
    seq: 35,
    ts: ts(41),
    summary: "Final simulation reproduced the verified MaxCut result.",
    interpretation: "The result matches the classical optimum for this sampled ring instance. You can inspect the measured bitstring and reuse the generated circuit above; hardware behavior remains untested.",
    results: { cut_value: 4, bitstring: "01010" },
    comparison: { baseline_cut: 4, final_cut: 4, compilation_mode: "compressed" },
    residual_risks: "Simulation only; no QPU execution was requested.",
  },
  { type: "stage.finished", run_id: RUN, seq: 36, ts: ts(42), stage: "analyze", ok: true, duration_ms: 20 },

  { type: "stage.started", run_id: RUN, seq: 37, ts: ts(43), stage: "save" },
  { type: "artifact.saved", run_id: RUN, seq: 38, ts: ts(44), artifact_id: ART, version_id: `${ART}-v1`, version_seq: 1 },
  { type: "stage.finished", run_id: RUN, seq: 39, ts: ts(45), stage: "save", ok: true, duration_ms: 210 },
  {
    type: "research.completed",
    run_id: RUN,
    seq: 40,
    ts: ts(46),
    query: "MaxCut on a 5-node ring",
    sources: [
      {
        title: "Qiskit MaxCut tutorial",
        url: "https://qiskit.qotlabs.org/learning/courses/quantum-approximate-optimization-algorithm",
        excerpt: "QAOA is a variational method for approximate combinatorial optimization.",
      },
    ],
    error: null,
  },
  { type: "run.finished", run_id: RUN, seq: 41, ts: ts(47), status: "succeeded", verifier_decision: "pass", evidence_strength: "physical", reason_code: "all_required_checks_passed", residual_risks: "Simulation only; no QPU execution was requested.", verification_summary: PASS_SUMMARY },
];

// ---- a run that fails verification -------------------------------------------------------
const FAILED: RunEvent[] = [
  ...VERIFIED.slice(0, 15), // through sandbox result in verification
  {
    type: "verification.result",
    run_id: RUN,
    seq: 16,
    ts: ts(22),
    method: "statistical",
    result: "fail",
    attempt_id: null, attempt_seq: null, candidate_id: null, check_index: null, source_fingerprint: null,
    details: { metric: "TVD", metric_value: 0.21, threshold: 0.05, seed: 42, shots: 4096 },
  },
  { type: "stage.finished", run_id: RUN, seq: 17, ts: ts(23), stage: "verify", ok: false, duration_ms: 1100 },
  {
    type: "run.diagnosed",
    run_id: RUN,
    seq: 18,
    ts: ts(24),
    failed_stage: "verify",
    restart_from: "generate",
    code: "verification_failed",
    message: "Statistical mismatch exceeds tolerance; regenerate before retrying.",
    attempt: 1,
  },
  { type: "run.finished", run_id: RUN, seq: 19, ts: ts(25), status: "failed", verifier_decision: "fail", evidence_strength: null, reason_code: "statistical_mismatch", residual_risks: "Verification failed; no final execution was attempted.", verification_summary: FAIL_SUMMARY },
];

// A run that spent its whole budget without a passing candidate. Before
// run.best_effort the user's entire answer was "the run did not complete
// successfully" — this fixture is how that path is inspected without paying for
// four live model calls to reproduce it.
const EXHAUSTED: RunEvent[] = [
  ...FAILED.slice(0, FAILED.length - 1),
  {
    type: "run.best_effort",
    run_id: RUN,
    seq: 19,
    ts: ts(26),
    verified: false,
    language: "qiskit",
    code: SAMPLE_CODE,
    revision: 3,
    candidates_considered: 4,
    exhausted_budget: "candidate_budget_exhausted",
    failed_checks: ["statistical", "success_criteria"],
    critic_summary: "The measured distribution does not match the requested Bell state.",
    residual_risks: ["Qubit ordering was never confirmed against the plan."],
  },
  {
    type: "run.error",
    run_id: RUN,
    seq: 20,
    ts: ts(27),
    stage: null,
    code: "agent_failed",
    message: "agent tool loop failed (candidate_budget_exhausted) — failing checks: statistical",
  },
  {
    type: "run.finished",
    run_id: RUN,
    seq: 21,
    ts: ts(28),
    status: "failed",
    verifier_decision: "fail",
    evidence_strength: null,
    reason_code: "candidate_budget_exhausted",
    residual_risks: null,
    verification_summary: FAIL_SUMMARY,
  },
];

const MID_RUN: RunEvent[] = VERIFIED.slice(0, 16); // verification running; verifier pending
const QUEUED: RunEvent[] = VERIFIED.slice(0, 2); // queued/started only

const PROVIDER_FAILURE: RunEvent[] = [
  { type: "run.queued", run_id: RUN, seq: 0, ts: ts(0), framework: "qiskit", mode: "execute" },
  { type: "run.started", run_id: RUN, seq: 1, ts: ts(1) },
  { type: "stage.started", run_id: RUN, seq: 2, ts: ts(2), stage: "plan" },
  {
    type: "run.error",
    run_id: RUN,
    seq: 3,
    ts: ts(3),
    stage: "plan",
    code: "provider_rate_limited",
    message: "planner provider call failed (rate_limited, HTTP 429)",
  },
  {
    type: "run.finished",
    run_id: RUN,
    seq: 4,
    ts: ts(4),
    status: "failed",
    verifier_decision: null,
    evidence_strength: null,
    reason_code: "provider_rate_limited",
    residual_risks: null,
    verification_summary: null,
  },
];

const AI_REVIEWED: RunEvent[] = [
  ...VERIFIED.slice(0, 16),
  {
    type: "verification.result",
    run_id: RUN,
    seq: 16,
    ts: ts(22),
    method: "structural",
    result: "pass",
    attempt_id: null,
    attempt_seq: null,
    candidate_id: CANDIDATE,
    check_index: 0,
    source_fingerprint: "sha256:source",
    details: { note: "framework-native circuit and RESULT contract are present" },
  },
  {
    type: "verification.result",
    run_id: RUN,
    seq: 17,
    ts: ts(23),
    method: "return_contract",
    result: "pass",
    attempt_id: null,
    attempt_seq: null,
    candidate_id: CANDIDATE,
    check_index: 1,
    source_fingerprint: "sha256:source",
    details: { note: "expected output keys were returned" },
  },
  {
    type: "verification.semantic_review",
    run_id: RUN,
    seq: 18,
    ts: ts(24),
    review_id: REVIEW,
    candidate_id: CANDIDATE,
    execution_id: EXECUTION,
    attempt_seq: 1,
    source_fingerprint: "sha256:source",
    decision: "ready",
    reason_code: "intent_aligned",
    failure_class: null,
    retry_target: "none",
    confidence: "high",
    severity: "none",
    feedback: {
      critic: {
        decision: "ready",
        confidence: "high",
        severity: "none",
        summary: "The generated circuit, execution result, and request are aligned.",
        mismatches: [],
        repair_instructions: [],
        residual_risks: ["AI intent review is advisory; strict physical verification was not run."],
      },
    },
  },
  { type: "artifact.saved", run_id: RUN, seq: 19, ts: ts(25), artifact_id: ART, version_id: `${ART}-v3`, version_seq: 3 },
  {
    type: "run.finished",
    run_id: RUN,
    seq: 20,
    ts: ts(26),
    status: "succeeded",
    verifier_decision: "inconclusive",
    evidence_strength: "structural",
    reason_code: "ai_review_aligned",
    residual_risks: "AI intent review is advisory; strict physical verification was not run.",
    verification_summary: AI_REVIEWED_SUMMARY,
  },
];

// The production-run-019f7e46-d688 shape after the incapacity fix: the statistical
// check could not evaluate a feed-forward circuit, said so as `skipped`, and
// stopped blocking. The run passes on structural evidence only, and the banner
// says what was not checked.
const STRUCTURAL_SKIP: RunEvent[] = [
  ...VERIFIED.slice(0, 15),
  {
    type: "verification.result",
    run_id: RUN,
    seq: 16,
    ts: ts(22),
    method: "statistical",
    result: "skipped",
    attempt_id: null, attempt_seq: null, candidate_id: null, check_index: null, source_fingerprint: null,
    details: {
      skip_reason: "statevector_incapable",
      error:
        "circuit is not unitary up to its final measurements: 'if_else' requires mid-circuit measurement or classical control flow, which the statevector path cannot simulate",
    },
  },
  {
    type: "verification.result",
    run_id: RUN,
    seq: 17,
    ts: ts(22),
    method: "return_contract",
    result: "pass",
    attempt_id: null, attempt_seq: null, candidate_id: null, check_index: null, source_fingerprint: null,
    details: { note: "result keys matched the plan contract" },
  },
  { type: "stage.finished", run_id: RUN, seq: 18, ts: ts(23), stage: "verify", ok: true, duration_ms: 900 },
  {
    type: "run.finished",
    run_id: RUN,
    seq: 19,
    ts: ts(24),
    status: "succeeded",
    verifier_decision: "pass",
    evidence_strength: "structural",
    reason_code: "structural_claims_only",
    residual_risks: "The statistical check cannot simulate feed-forward circuits; no physical check ran.",
    verification_summary: { ...PASS_SUMMARY, evidence_strength: "structural", reason_code: "structural_claims_only", checks: [{ method: "return_contract", result: "pass" }] },
  },
];

const INCONCLUSIVE: RunEvent[] = [
  ...VERIFIED.slice(0, 15),
  { type: "verification.result", run_id: RUN, seq: 16, ts: ts(22), method: "statistical", result: "unavailable", attempt_id: null, attempt_seq: null, candidate_id: null, check_index: null, source_fingerprint: null, details: { note: "dynamic circuit unsupported" } },
  { type: "stage.finished", run_id: RUN, seq: 17, ts: ts(23), stage: "verify", ok: true, duration_ms: 900 },
  { type: "artifact.saved", run_id: RUN, seq: 18, ts: ts(24), artifact_id: ART, version_id: `${ART}-v2`, version_seq: 2 },
  { type: "run.finished", run_id: RUN, seq: 19, ts: ts(25), status: "succeeded", verifier_decision: "inconclusive", evidence_strength: null, reason_code: "required_check_unavailable", residual_risks: "Expected physical distribution was not verified.", verification_summary: INCONCLUSIVE_SUMMARY },
];

// One deterministic fixture that exercises the generic result visuals together:
// a measured distribution, reported business metrics, and an iterative objective
// trace. Production uses the same event projection; this exists only so visual QA
// does not need a paid model call or sandbox execution.
const VISUALIZED: RunEvent[] = VERIFIED.map((event): RunEvent => {
  if (event.type !== "sandbox.result") return event;
  return {
    ...event,
    result: {
      ...event.result,
      objective_history: [3.8, 3.12, 2.66, 2.31, 2.14, 2.04, 2.01],
    },
  };
});

export const RUN_FIXTURES: Record<string, RunEvent[]> = {
  "demo-visualized": VISUALIZED,
  "demo-verified": VERIFIED,
  "demo-failed": FAILED,
  "demo-exhausted": EXHAUSTED,
  "demo-skipped": STRUCTURAL_SKIP,
  "demo-inconclusive": INCONCLUSIVE,
  "demo-midrun": MID_RUN,
  "demo-queued": QUEUED,
  "demo-provider-error": PROVIDER_FAILURE,
  "demo-reviewed": AI_REVIEWED,
};

export const RUN_FIXTURE_META: { id: string; label: string }[] = [
  { id: "demo-visualized", label: "Visualized simulation and optimization" },
  { id: "demo-verified", label: "Verified run (full pipeline)" },
  { id: "demo-failed", label: "Failed verification" },
  { id: "demo-exhausted", label: "Budget exhausted (best effort)" },
  { id: "demo-skipped", label: "Statistical check skipped (structural pass)" },
  { id: "demo-inconclusive", label: "Verification unavailable (private artifact)" },
  { id: "demo-midrun", label: "Mid-run (verify)" },
  { id: "demo-queued", label: "Queued (waiting)" },
  { id: "demo-provider-error", label: "Provider failure (normalized)" },
  { id: "demo-reviewed", label: "Executed simple pipeline" },
];
