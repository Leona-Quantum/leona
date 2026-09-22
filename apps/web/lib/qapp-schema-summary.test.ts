import assert from "node:assert/strict";
import test from "node:test";
import { summarizeQappSchema } from "./qapp-schema-summary.ts";

test("a scalar field reports its type and honours a schema description", () => {
  const summary = summarizeQappSchema(
    {
      type: "object",
      properties: {
        shots: { type: "integer", description: "How many times to run the circuit." },
        angle: { type: "number" },
        use_noise: { type: "boolean" },
        label: { type: "string" },
      },
    },
    "en",
  );
  assert.deepEqual(summary, [
    { name: "shots", label: "Shots", type: "whole number", description: "How many times to run the circuit." },
    { name: "angle", label: "Angle", type: "number" },
    { name: "use_noise", label: "Use noise", type: "yes/no" },
    { name: "label", label: "Label", type: "text" },
  ]);
});

test("the four documented shapes (prompts.py) each get a distinct label", () => {
  const summary = summarizeQappSchema(
    {
      type: "object",
      properties: {
        // Scalar.
        n_qubits: { type: "integer" },
        // Array of one scalar type.
        angles: { type: "array", items: { type: "number" } },
        // Map of scalars (measurement counts, e.g. {"00": 512}).
        counts: { type: "object", additionalProperties: { type: "integer" } },
        // Array of flat records.
        rows: { type: "array", items: { type: "object", properties: { x: { type: "number" } } } },
      },
    },
    "en",
  );
  const byName = Object.fromEntries(summary.map((field) => [field.name, field.type]));
  assert.equal(byName.n_qubits, "whole number");
  assert.equal(byName.angles, "list of number");
  assert.equal(byName.counts, "map of whole number");
  assert.equal(byName.rows, "list of records");
});

test("a schema's own title wins over the humanized property name", () => {
  const summary = summarizeQappSchema(
    { properties: { n_qubits: { type: "integer", title: "Number of qubits" } } },
    "en",
  );
  assert.equal(summary[0]?.label, "Number of qubits");
});

test("a property name with no title is humanized from snake_case and camelCase", () => {
  const summary = summarizeQappSchema(
    { properties: { n_qubits: { type: "integer" }, shotsCount: { type: "integer" } } },
    "en",
  );
  assert.equal(summary[0]?.label, "N qubits");
  // camelCase preserves each word's own casing across the split — "Count" was
  // already capitalized in the source name, and this function only decides
  // the case of the FIRST character of the whole label, not every word.
  assert.equal(summary[1]?.label, "Shots Count");
});

test("field order follows declaration order, not alphabetical", () => {
  const summary = summarizeQappSchema(
    { properties: { zeta: { type: "string" }, alpha: { type: "string" } } },
    "en",
  );
  assert.deepEqual(summary.map((field) => field.name), ["zeta", "alpha"]);
});

test("every locale produces a real, distinct translation — not the English string reused", () => {
  const schema = {
    properties: {
      shots: { type: "integer" },
      angles: { type: "array", items: { type: "number" } },
      counts: { type: "object", additionalProperties: { type: "string" } },
      rows: { type: "array", items: { type: "object", properties: {} } },
      flag: { type: "boolean" },
    },
  };
  const en = summarizeQappSchema(schema, "en");
  const ja = summarizeQappSchema(schema, "ja");
  for (let i = 0; i < en.length; i += 1) {
    assert.notEqual(ja[i]?.type, en[i]?.type, `${en[i]?.name}'s ja type reused the English string`);
  }
  assert.equal(ja.find((f) => f.name === "shots")?.type, "整数");
  assert.equal(ja.find((f) => f.name === "flag")?.type, "はい/いいえ");
  assert.equal(ja.find((f) => f.name === "counts")?.type, "テキストのマップ");
  assert.equal(ja.find((f) => f.name === "rows")?.type, "レコードのリスト");
});

test("a malformed or absent schema returns no fields rather than throwing", () => {
  assert.deepEqual(summarizeQappSchema(null, "en"), []);
  assert.deepEqual(summarizeQappSchema(undefined, "en"), []);
  assert.deepEqual(summarizeQappSchema({}, "en"), []);
  assert.deepEqual(summarizeQappSchema({ properties: "not an object" } as never, "en"), []);
  assert.deepEqual(summarizeQappSchema({ properties: { odd: null } } as never, "en"), [
    { name: "odd", label: "Odd", type: "value" },
  ]);
});

test("an unrecognised property type falls back to a generic label instead of throwing", () => {
  const summary = summarizeQappSchema({ properties: { mystery: { type: "tuple" } } }, "en");
  assert.equal(summary[0]?.type, "value");
});
