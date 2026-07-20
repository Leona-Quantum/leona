// RunEvent fixture logs for the RunView stories. Deliberately a self-contained copy of the
// canonical logs in apps/web/app/(app)/run/[taskId]/fixtures.ts so this a11y harness does
// not reach across the app boundary; both are typechecked against @majorana/contracts-gen
// via the RunEvent type, so a contract change breaks the build rather than drifting silently.
// MID_RUN / QUEUED are strict PREFIXES of VERIFIED (a mid-run refresh replays a prefix).
import type { RunEvent } from "@majorana/ui";

const RUN = "1f8e2a10-0000-4000-8000-000000000001";
const ART = "a7c1b0d2-0000-4000-8000-0000000000aa";

// Deterministic ISO timestamps, fixed epoch (no wall clock → byte-identical renders).
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

result = AerSimulator().run(qc, shots=4096, seed_simulator=42).result()
counts = result.get_counts()
print({"cut_value": 4, "bitstring": max(counts, key=counts.get)})`;

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
      parameters: { custom: null, max_iterations: 50, optimizer: "COBYLA", shots: 4096 },
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

  { type: "stage.started", run_id: RUN, seq: 8, ts: ts(14), stage: "simulate" },
  {
    type: "sandbox.result",
    run_id: RUN,
    seq: 9,
    ts: ts(18),
    phase: "verification",
    duration_ms: 4520,
    exit_code: 0,
    memory_mb: 128,
    stderr: "",
    stdout: '{"cut_value": 4, "bitstring": "01010"}',
    truncated: false,
    qasm_emission: {
      epilogue_applied: true,
      source: "sandbox_epilogue" as const,
      available: true,
      epilogue_error: null,
    },
  },
  { type: "stage.finished", run_id: RUN, seq: 10, ts: ts(19), stage: "simulate", ok: true, duration_ms: 4520 },

  { type: "stage.started", run_id: RUN, seq: 11, ts: ts(20), stage: "verify" },
  {
    type: "verification.result",
    run_id: RUN,
    seq: 12,
    ts: ts(21),
    method: "statistical",
    result: "pass",
    details: { metric: "TVD", metric_value: 0.0088, threshold: 0.05, seed: 42, shots: 4096 },
  },
  { type: "stage.finished", run_id: RUN, seq: 13, ts: ts(22), stage: "verify", ok: true, duration_ms: 1100 },

  { type: "stage.started", run_id: RUN, seq: 14, ts: ts(23), stage: "baseline" },
  {
    type: "baseline.result",
    run_id: RUN,
    seq: 15,
    ts: ts(24),
    kind: "maxcut",
    not_applicable_reason: null,
    result: { classical_cut: 4, quantum_cut: 4, approx_ratio: 1.0 },
  },
  { type: "stage.finished", run_id: RUN, seq: 16, ts: ts(25), stage: "baseline", ok: true, duration_ms: 300 },

  { type: "stage.started", run_id: RUN, seq: 17, ts: ts(26), stage: "export" },
  { type: "export.classified", run_id: RUN, seq: 18, ts: ts(27), status: "lossless", reason: null, qasm_available: true },
  { type: "stage.finished", run_id: RUN, seq: 19, ts: ts(28), stage: "export", ok: true, duration_ms: 120 },

  { type: "stage.started", run_id: RUN, seq: 20, ts: ts(29), stage: "save" },
  { type: "artifact.saved", run_id: RUN, seq: 21, ts: ts(30), artifact_id: ART, version_id: `${ART}-v1`, version_seq: 1 },
  { type: "stage.finished", run_id: RUN, seq: 22, ts: ts(31), stage: "save", ok: true, duration_ms: 210 },

  { type: "stage.started", run_id: RUN, seq: 23, ts: ts(32), stage: "analyze" },
  {
    type: "run.analysis",
    run_id: RUN,
    seq: 24,
    ts: ts(33),
    summary: "Final simulation reproduced the verified MaxCut result.",
    interpretation: "The circuit reaches the expected cut value of 4 on the sampled 5-node ring.",
    results: { cut_value: 4, bitstring: "01010" },
    comparison: { baseline_cut: 4, final_cut: 4 },
    residual_risks: "Simulation only; no QPU execution was requested.",
  },
  { type: "stage.finished", run_id: RUN, seq: 25, ts: ts(34), stage: "analyze", ok: true, duration_ms: 20 },

  {
    type: "research.completed",
    run_id: RUN,
    seq: 26,
    ts: ts(35),
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
  { type: "run.finished", run_id: RUN, seq: 27, ts: ts(36), status: "succeeded", verifier_decision: "pass", evidence_strength: "physical", residual_risks: null },
];

const FAILED: RunEvent[] = [
  ...VERIFIED.slice(0, 12),
  {
    type: "verification.result",
    run_id: RUN,
    seq: 12,
    ts: ts(21),
    method: "statistical",
    result: "fail",
    details: { metric: "TVD", metric_value: 0.21, threshold: 0.05, seed: 42, shots: 4096 },
  },
  { type: "stage.finished", run_id: RUN, seq: 13, ts: ts(22), stage: "verify", ok: false, duration_ms: 1100 },
  { type: "run.finished", run_id: RUN, seq: 14, ts: ts(23), status: "failed", verifier_decision: "fail", evidence_strength: null, residual_risks: null },
];

// Tail fragments exercise the organic plan output against the same replay reducer and
// typed event union. The provider's internal Plan JSON is intentionally not rendered.
const WITH_MODEL_ACTIVITY: RunEvent[] = [
  ...VERIFIED,
  {
    type: "llm.delta",
    run_id: RUN,
    seq: 28,
    ts: ts(37),
    stage: "plan",
    kind: "reasoning",
    text: "I am checking the requested graph size and the strongest independent check before implementation.",
  },
];

const MID_RUN: RunEvent[] = VERIFIED.slice(0, 10); // simulate running (sandbox in, not finished)
const QUEUED: RunEvent[] = VERIFIED.slice(0, 2); // queued/started only → waiting panel

export const RUN_FIXTURES: Record<string, RunEvent[]> = {
  verified: VERIFIED,
  "model-activity": WITH_MODEL_ACTIVITY,
  failed: FAILED,
  midrun: MID_RUN,
  queued: QUEUED,
};
