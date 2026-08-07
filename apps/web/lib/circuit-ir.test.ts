import assert from "node:assert/strict";
import test from "node:test";

import {
  CIRCUIT_IR_SCHEMA,
  CIRCUIT_IR_VERSION,
  circuitIRDiagram,
  circuitIRFromMetadata,
  parseCircuitIR,
  validateCircuitIR,
} from "./circuit-ir.ts";
import { generateBuilderCode } from "./studio-builder.ts";

function operation(
  id: string,
  name: string,
  qubits: number[],
  options: { clbits?: number[]; parameters?: string[]; editable?: boolean; displayName?: string } = {},
) {
  return {
    id,
    name,
    display_name: options.displayName ?? name,
    qubits,
    clbits: options.clbits ?? [],
    parameters: options.parameters ?? [],
    editable: options.editable ?? true,
  };
}

function ir(overrides: Record<string, unknown> = {}) {
  const operations = [
    operation("op-0", "h", [0]),
    operation("op-1", "cx", [0, 1]),
    operation("op-2", "measure", [0], { clbits: [0] }),
    operation("op-3", "measure", [1], { clbits: [1] }),
  ];
  return {
    schema: CIRCUIT_IR_SCHEMA,
    version: CIRCUIT_IR_VERSION,
    framework: "qiskit",
    qubit_count: 2,
    clbit_count: 2,
    operation_count: operations.length,
    operations,
    truncated: false,
    global_phase: null,
    ...overrides,
  };
}

test("a flat circuit IR remains editable and generates framework code", () => {
  const parsed = parseCircuitIR(ir());
  assert.ok(parsed);
  const diagram = circuitIRDiagram(parsed);

  assert.equal(diagram.readOnly, false);
  assert.deepEqual(diagram.readOnlyReasons, []);
  assert.deepEqual(diagram.steps.map((step) => step.gate), ["H", "CX", "M", "M"]);
  assert.match(generateBuilderCode(diagram.steps, diagram.qubitCount).qiskit, /qc\.cx\(0, 1\)/);
});

test("DiagonalGate stays one honest read-only block instead of 501 editable gates", () => {
  const operations = [
    operation("op-0", "h", [0]),
    operation("op-1", "diagonal", [0, 1, 2, 3, 4, 5, 6, 7], {
      parameters: ["256 values"],
      editable: false,
      displayName: "Diagonal",
    }),
    operation("op-2", "rx", [0], { parameters: ["0.5"] }),
  ];
  const parsed = circuitIRFromMetadata({
    circuit_ir: ir({
      qubit_count: 8,
      clbit_count: 0,
      operation_count: operations.length,
      operations,
    }),
  });
  assert.ok(parsed);
  const diagram = circuitIRDiagram(parsed);

  assert.equal(diagram.qubitCount, 8);
  assert.equal(diagram.operationCount, 3);
  assert.equal(diagram.readOnly, true);
  assert.deepEqual(diagram.readOnlyReasons, ["opaque_operations"]);
  assert.deepEqual(diagram.steps.map((step) => step.gate), ["H", "CUSTOM", "RX"]);
  assert.equal(diagram.customGates[0].name, "Diagonal · 256 values");
  assert.equal(diagram.customGates[0].opaque, true);
  assert.throws(
    () => generateBuilderCode(diagram.steps, diagram.qubitCount, diagram.customGates),
    /cannot generate source for opaque circuit operation/,
  );
});

test("Amazon Braket circuit IR reaches Studio as an honest read-only diagram", () => {
  const operations = [
    operation("op-0", "h", [0], { editable: false, displayName: "H" }),
    operation("op-1", "cx", [0, 1], { editable: false, displayName: "CNot" }),
  ];
  const parsed = parseCircuitIR(ir({
    framework: "braket",
    clbit_count: 0,
    operation_count: operations.length,
    operations,
  }));
  assert.ok(parsed);
  const diagram = circuitIRDiagram(parsed);

  assert.equal(parsed.framework, "braket");
  assert.deepEqual(diagram.steps.map((step) => step.gate), ["CUSTOM", "CUSTOM"]);
  assert.equal(diagram.readOnly, true);
  assert.deepEqual(diagram.readOnlyReasons, ["opaque_operations"]);
});

test("Qibo and Qulacs circuit IR reach Studio without pretending to round-trip", () => {
  for (const framework of ["qibo", "qulacs"] as const) {
    const operations = [operation("op-0", "h", [0], { editable: false, displayName: "H" })];
    const parsed = parseCircuitIR(ir({
      framework,
      qubit_count: 1,
      clbit_count: 0,
      operation_count: operations.length,
      operations,
    }));
    assert.ok(parsed);
    const diagram = circuitIRDiagram(parsed);

    assert.equal(parsed.framework, framework);
    assert.deepEqual(diagram.steps.map((step) => step.gate), ["CUSTOM"]);
    assert.equal(diagram.readOnly, true);
    assert.deepEqual(diagram.readOnlyReasons, ["opaque_operations"]);
  }
});

test("truncation and global phase make even standard operations read-only", () => {
  const truncated = parseCircuitIR(ir({ operation_count: 5, truncated: true }));
  assert.ok(truncated);
  assert.deepEqual(circuitIRDiagram(truncated).readOnlyReasons, ["truncated"]);

  const phased = parseCircuitIR(ir({ global_phase: "0.25" }));
  assert.ok(phased);
  assert.deepEqual(circuitIRDiagram(phased).readOnlyReasons, ["global_phase"]);
});

test("malformed metadata never reaches the canvas", () => {
  assert.equal(parseCircuitIR({ ...ir(), schema: "invented" }), null);
  assert.equal(parseCircuitIR({ ...ir(), operation_count: 3 }), null);
  assert.equal(parseCircuitIR({ ...ir(), operations: [operation("op-0", "h", [2])] }), null);
  assert.equal(parseCircuitIR({
    ...ir(),
    operations: [operation("op-0", "h", [0]), operation("op-0", "x", [1])],
    operation_count: 2,
  }), null);
  assert.equal(parseCircuitIR({
    ...ir(),
    operations: [operation("op-0", "h", [0], { displayName: "bad\nlabel" })],
    operation_count: 1,
  }), null);
});

test("oversized metadata cannot consume the Studio display budget", () => {
  const parameters = Array.from({ length: 8 }, () => "p".repeat(160));
  const operations = Array.from({ length: 400 }, (_, index) => (
    operation(`op-${index}`, "custom", [0], { parameters, editable: false })
  ));
  assert.equal(parseCircuitIR(ir({
    qubit_count: 1,
    clbit_count: 0,
    operations,
    operation_count: operations.length,
  })), null);
});

test("permuted classical measurement is visible but cannot claim a lossless edit", () => {
  const operations = [operation("op-0", "measure", [0], { clbits: [1], editable: false })];
  const parsed = parseCircuitIR(ir({ operations, operation_count: 1 }));
  assert.ok(parsed);
  const diagram = circuitIRDiagram(parsed);

  assert.deepEqual(diagram.steps.map((step) => step.gate), ["M"]);
  assert.equal(diagram.readOnly, true);
  assert.deepEqual(diagram.readOnlyReasons, ["opaque_operations"]);
});

test("browser-restored IR is revalidated before it can seed Studio", () => {
  const parsed = parseCircuitIR(ir());
  assert.ok(parsed);
  assert.deepEqual(validateCircuitIR(parsed), parsed);
  assert.equal(validateCircuitIR({ ...parsed, operationCount: 3 }), null);
});
