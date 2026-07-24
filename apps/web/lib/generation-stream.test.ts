import assert from "node:assert/strict";
import test from "node:test";

import { sourcePrefixFromGenerationJson } from "./generation-stream.ts";

test("recovers Python source from an incomplete generated-source JSON stream", () => {
  assert.equal(
    sourcePrefixFromGenerationJson('{"source":"from qiskit import QuantumCircuit\\nqc = QuantumCircuit(2)'),
    "from qiskit import QuantumCircuit\nqc = QuantumCircuit(2)",
  );
});

test("stops before an incomplete escape and decodes completed unicode escapes", () => {
  assert.equal(sourcePrefixFromGenerationJson('{"source":"# \\u91cf\\u5b50\\nq'), "# 量子\nq");
  assert.equal(sourcePrefixFromGenerationJson('{"source":"print(\\'), "print(");
});

test("does not expose non-source JSON fields as code", () => {
  assert.equal(sourcePrefixFromGenerationJson('{"reason":"working"}'), null);
});
