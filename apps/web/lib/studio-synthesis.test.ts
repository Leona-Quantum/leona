import assert from "node:assert/strict";
import test from "node:test";

import type { BuilderStep } from "./studio-builder.ts";
import {
  builderStepsFromSynthesisCandidate,
  isApplicable,
  objectiveMetric,
  synthesisRequest,
  synthesisResultEventFromEvent,
  type SynthesisCandidate,
} from "./studio-synthesis.ts";

const BELL_STEPS: BuilderStep[] = [
  { id: "h", gate: "H", qubits: [0] },
  { id: "cx", gate: "CX", qubits: [0, 1] },
];

function metrics(overrides: Partial<Record<string, number | null>> = {}) {
  return {
    qubits: 2,
    depth: 2,
    gate_count: 2,
    two_qubit_gate_count: 1,
    t_count: 0,
    measurement_count: 0,
    estimated_runtime_ms: null,
    ...overrides,
  };
}

function succeededCandidate(overrides: Partial<SynthesisCandidate> = {}): SynthesisCandidate {
  return {
    compiler: "qiskit",
    status: "succeeded",
    reason: null,
    compiler_version: "2.5.2",
    operations: [
      { gate: "H", qubits: [0], angle_radians: null },
      { gate: "CX", qubits: [0, 1], angle_radians: null },
    ],
    before: metrics(),
    after: metrics(),
    equivalence: { checked: true, equivalent: true, method: "exact_unitary_statevector", width_limit: 12, detail: "equivalent" },
    warnings: [],
    ...overrides,
  } as SynthesisCandidate;
}

test("synthesisRequest wires the target and objective and validates the circuit", () => {
  const request = synthesisRequest(2, [...BELL_STEPS], { device_id: null, connectivity: "line" }, "two_qubit_count");

  assert.equal(request.qubit_count, 2);
  assert.deepEqual(request.target, { device_id: null, connectivity: "line" });
  assert.equal(request.objective, "two_qubit_count");
  assert.equal(request.operations.length, 2);
  assert.equal(request.operations[1].gate, "CX");
});

test("synthesisRequest refuses an empty circuit the same way circuitOptimizationRequest does", () => {
  assert.throws(
    () => synthesisRequest(1, [], { device_id: null, connectivity: "all_to_all" }, "depth"),
    /circuit is empty/,
  );
});

test("objectiveMetric reads the field the objective names", () => {
  const m = metrics({ depth: 5, two_qubit_gate_count: 3, t_count: 7 });
  assert.equal(objectiveMetric(m, "depth"), 5);
  assert.equal(objectiveMetric(m, "two_qubit_count"), 3);
  assert.equal(objectiveMetric(m, "t_count"), 7);
  assert.equal(objectiveMetric(null, "depth"), null);
});

test("isApplicable requires succeeded status AND a checked, equivalent verdict", () => {
  assert.equal(isApplicable(succeededCandidate()), true);
  assert.equal(
    isApplicable(succeededCandidate({ equivalence: { checked: true, equivalent: false, method: "exact_unitary_statevector", width_limit: 12, detail: "NOT equivalent" } })),
    false,
    "a proven-wrong candidate is never applicable",
  );
  assert.equal(
    isApplicable(succeededCandidate({ equivalence: { checked: false, equivalent: null, method: "exact_unitary_statevector", width_limit: 12, detail: "not checked (too wide)" } })),
    false,
    "an unchecked candidate is never applicable, even if it compiled",
  );
  assert.equal(
    isApplicable({ compiler: "cirq", status: "unsupported", reason: "does not support this target", compiler_version: null, operations: null, before: null, after: null, equivalence: null, warnings: [] }),
    false,
  );
  assert.equal(
    isApplicable({ compiler: "pyzx", status: "failed", reason: "internal error", compiler_version: null, operations: null, before: null, after: null, equivalence: null, warnings: [] }),
    false,
  );
});

test("builderStepsFromSynthesisCandidate rebuilds editable steps with bound angles", () => {
  const candidate = succeededCandidate({
    operations: [
      { gate: "RX", qubits: [0], angle_radians: Math.PI / 2 },
      { gate: "CX", qubits: [0, 1], angle_radians: null },
    ],
  });

  const steps = builderStepsFromSynthesisCandidate(candidate);

  assert.equal(steps.length, 2);
  assert.equal(steps[0].gate, "RX");
  assert.equal(steps[0].param, String(Number((Math.PI / 2).toPrecision(12))));
  assert.equal(steps[1].gate, "CX");
  assert.equal("param" in steps[1], false);
});

test("synthesisResultEventFromEvent accepts a well-formed accepted result", () => {
  const parsed = synthesisResultEventFromEvent({
    type: "synthesis.result",
    accepted: true,
    reason: null,
    result: {
      qubit_count: 2,
      target: { device_id: null, connectivity: "line" },
      resolved_connectivity: "line",
      resolved_note: "generic line connectivity, as requested.",
      objective: "two_qubit_count",
      input_fingerprint: "a".repeat(64),
      candidates: [succeededCandidate()],
      best_candidate_compiler: "qiskit",
    },
  });

  assert.ok(parsed);
  assert.equal(parsed?.accepted, true);
  assert.equal(parsed?.result?.candidates.length, 1);
  assert.equal(parsed?.result?.best_candidate_compiler, "qiskit");
});

test("synthesisResultEventFromEvent accepts a request-level refusal with no result", () => {
  const parsed = synthesisResultEventFromEvent({
    type: "synthesis.result",
    accepted: false,
    reason: "'not.a.device' is not a known device.",
    result: null,
  });

  assert.ok(parsed);
  assert.equal(parsed?.accepted, false);
  assert.equal(parsed?.result, null);
  assert.match(parsed?.reason ?? "", /not a known device/);
});

test("synthesisResultEventFromEvent rejects the wrong event type", () => {
  assert.equal(synthesisResultEventFromEvent({ type: "compilation.result", accepted: true }), null);
});

test("synthesisResultEventFromEvent rejects a succeeded candidate missing its equivalence verdict", () => {
  const parsed = synthesisResultEventFromEvent({
    type: "synthesis.result",
    accepted: true,
    reason: null,
    result: {
      qubit_count: 2,
      target: { device_id: null, connectivity: "all_to_all" },
      resolved_connectivity: "all_to_all",
      resolved_note: "generic all_to_all connectivity, as requested.",
      objective: "depth",
      input_fingerprint: "a".repeat(64),
      candidates: [succeededCandidate({ equivalence: null })],
      best_candidate_compiler: null,
    },
  });

  assert.equal(parsed, null, "a succeeded candidate without an equivalence verdict is malformed, not trusted");
});

test("synthesisResultEventFromEvent rejects a non-succeeded candidate carrying no reason", () => {
  const parsed = synthesisResultEventFromEvent({
    type: "synthesis.result",
    accepted: true,
    reason: null,
    result: {
      qubit_count: 1,
      target: { device_id: "ibm.open_plan", connectivity: null },
      resolved_connectivity: "heavy_hex",
      resolved_note: "IBM Quantum is routed onto IBM's published heavy-hex architecture.",
      objective: "depth",
      input_fingerprint: "a".repeat(64),
      candidates: [
        { compiler: "pyzx", status: "unsupported", reason: "", compiler_version: null, operations: null, before: null, after: null, equivalence: null, warnings: [] },
      ],
      best_candidate_compiler: null,
    },
  });

  assert.equal(parsed, null, "a compiler shown as unsupported/failed must say why");
});
