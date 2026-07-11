// Fixture RunEvent logs for the pipeline view. These stand in for the persisted event
// stream until the BFF glue lands; the page is a pure renderer of whichever log it's given
// (07 §6). MID_RUN / QUEUED are strict PREFIXES of VERIFIED — reducing a prefix is exactly
// what a mid-run refresh does, so "prefix renders identical partial state" is demonstrable
// here without a server. Types are checked against the generated contract.
import type { RunEvent } from "@majorana/ui";

const RUN = "1f8e2a10-0000-4000-8000-000000000001";
const ART = "a7c1b0d2-0000-4000-8000-0000000000aa";

// Deterministic ISO timestamps, 1 s apart from a fixed epoch (no wall clock).
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

// ---- the canonical successful run (seq 0..23) --------------------------------------------
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
      baseline_plan: { kind: "maxcut", reason: "MaxCut has a standard classical baseline." },
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
    duration_ms: 4520,
    exit_code: 0,
    memory_mb: 128,
    stderr: "",
    stdout: '{"cut_value": 4, "bitstring": "01010"}',
    truncated: false,
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

  { type: "run.finished", run_id: RUN, seq: 23, ts: ts(32), status: "succeeded", verifier_decision: "pass", residual_risks: null },
];

// ---- a run that fails verification (fail state + retry; run ends) -------------------------
const FAILED: RunEvent[] = [
  ...VERIFIED.slice(0, 11), // through stage.started verify (seq 0..10 pass, verify starts)
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
  { type: "run.finished", run_id: RUN, seq: 14, ts: ts(23), status: "failed", verifier_decision: "fail", residual_risks: null },
];

// Prefixes of VERIFIED = exactly what a refresh at that moment replays.
const MID_RUN: RunEvent[] = VERIFIED.slice(0, 10); // simulate running (sandbox in, not finished)
const QUEUED: RunEvent[] = VERIFIED.slice(0, 2); // queued/started only → waiting panel

export const RUN_FIXTURES: Record<string, RunEvent[]> = {
  "demo-verified": VERIFIED,
  "demo-failed": FAILED,
  "demo-midrun": MID_RUN,
  "demo-queued": QUEUED,
};

export const RUN_FIXTURE_META: { id: string; label: string }[] = [
  { id: "demo-verified", label: "Verified run (full pipeline)" },
  { id: "demo-failed", label: "Failed verification" },
  { id: "demo-midrun", label: "Mid-run (simulate)" },
  { id: "demo-queued", label: "Queued (waiting)" },
];
