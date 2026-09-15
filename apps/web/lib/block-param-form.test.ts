import assert from "node:assert/strict";
import test from "node:test";

import {
  blockParamsFromForm,
  defaultBlockParamFormValues,
  edgesToText,
  parseBlockParamField,
} from "./block-param-form.ts";
import { blockTemplate, validateBlockParams } from "./circuit-blocks.ts";
import type { BlockParamSpec } from "./circuit-blocks.ts";

test("defaultBlockParamFormValues stringifies every spec kind, edges as text", () => {
  const params: BlockParamSpec[] = [
    { key: "n", label: "Qubits", kind: "int", min: 1, max: 10, default: 3 },
    { key: "angle", label: "Angle", kind: "angle", default: "pi/4" },
    { key: "bits", label: "Bits", kind: "bitstring", minLength: 1, maxLength: 6, default: "101" },
    { key: "edges", label: "Edges", kind: "edges", default: [[0, 1], [1, 2]] },
  ];
  assert.deepEqual(defaultBlockParamFormValues(params), { n: "3", angle: "pi/4", bits: "101", edges: "0-1,1-2" });
});

test("parseBlockParamField: int accepts a whole number, rejects anything else with the field's label", () => {
  const spec: BlockParamSpec = { key: "n", label: "Qubits", kind: "int", min: 1, max: 10, default: 3 };
  assert.deepEqual(parseBlockParamField(spec, "5"), { ok: true, value: 5 });
  assert.deepEqual(parseBlockParamField(spec, " -2 "), { ok: true, value: -2 });
  const failed = parseBlockParamField(spec, "abc");
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok && failed.reason.includes("Qubits"));
  assert.equal(parseBlockParamField(spec, "3.5").ok, false);
});

test("parseBlockParamField: angle and bitstring pass the raw (trimmed) text through for validateBlockParams to judge", () => {
  const angle: BlockParamSpec = { key: "a", label: "Angle", kind: "angle", default: "pi/4" };
  assert.deepEqual(parseBlockParamField(angle, "  pi/2  "), { ok: true, value: "pi/2" });
  const bits: BlockParamSpec = { key: "b", label: "Bits", kind: "bitstring", minLength: 1, maxLength: 6, default: "1" };
  assert.deepEqual(parseBlockParamField(bits, "1011"), { ok: true, value: "1011" });
});

test("parseBlockParamField: edges parses a-b pairs, empty text is zero edges, malformed text fails with the label", () => {
  const spec: BlockParamSpec = { key: "e", label: "Graph edges", kind: "edges", default: [] };
  assert.deepEqual(parseBlockParamField(spec, "0-1,1-2,2-3"), { ok: true, value: [[0, 1], [1, 2], [2, 3]] });
  assert.deepEqual(parseBlockParamField(spec, ""), { ok: true, value: [] });
  assert.deepEqual(parseBlockParamField(spec, "   "), { ok: true, value: [] });
  const failed = parseBlockParamField(spec, "0-1,not-an-edge");
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok && failed.reason.includes("Graph edges"));
});

test("edgesToText and the edges parser round-trip", () => {
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const text = edgesToText(edges);
  const parsed = parseBlockParamField({ key: "e", label: "Edges", kind: "edges", default: [] }, text);
  assert.deepEqual(parsed, { ok: true, value: edges });
});

test("blockParamsFromForm stops at the first field that fails to parse", () => {
  const params: BlockParamSpec[] = [
    { key: "n", label: "Qubits", kind: "int", min: 1, max: 10, default: 3 },
    { key: "a", label: "Angle", kind: "angle", default: "pi/4" },
  ];
  const result = blockParamsFromForm(params, { n: "not a number", a: "pi/2" });
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.includes("Qubits"));
});

test("a real template's default form values parse and pass validateBlockParams", () => {
  for (const key of ["bell", "ghz", "qft", "phase_oracle", "qaoa_maxcut_layer", "swap_test"]) {
    const template = blockTemplate(key)!;
    assert.ok(template, key);
    const values = defaultBlockParamFormValues(template.params);
    const result = blockParamsFromForm(template.params, values);
    assert.equal(result.ok, true, `${key}: ${!result.ok ? result.reason : ""}`);
    if (result.ok) assert.equal(validateBlockParams(template, result.params), null, key);
  }
});

test("a live form error (int field left blank) reads as a plain, field-specific sentence", () => {
  const template = blockTemplate("ghz")!;
  const values = defaultBlockParamFormValues(template.params);
  values.n = "";
  const result = blockParamsFromForm(template.params, values);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.reason.length > 0);
});

test("a value that parses but is out of range is caught by validateBlockParams, not the form parser", () => {
  const template = blockTemplate("ghz")!;
  const values = defaultBlockParamFormValues(template.params);
  values.n = "999";
  const parsed = blockParamsFromForm(template.params, values);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    const reason = validateBlockParams(template, parsed.params);
    assert.ok(reason && reason.includes("between"));
  }
});
