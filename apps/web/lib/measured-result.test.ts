import assert from "node:assert/strict";
import { test } from "node:test";
import { measuredResultFromMetadata } from "./measured-result.ts";

test("reads the counts and shots a run stored on its artifact", () => {
  const result = measuredResultFromMetadata({
    measured_result: { counts: { "00": 529, "11": 495 }, shots: 1024, outcome_count: 2, truncated: false },
  });

  assert.deepEqual(result?.counts, { "00": 529, "11": 495 });
  assert.equal(result?.shots, 1024);
  assert.equal(result?.outcomeCount, 2);
  assert.equal(result?.truncated, false);
});

test("an artifact with no measurement reads as null, not an empty chart", () => {
  assert.equal(measuredResultFromMetadata(null), null);
  assert.equal(measuredResultFromMetadata({}), null);
  assert.equal(measuredResultFromMetadata({ measured_result: {} }), null);
  assert.equal(measuredResultFromMetadata({ measured_result: { counts: {} } }), null);
});

test("scalar values survive on their own", () => {
  const result = measuredResultFromMetadata({ measured_result: { values: { ground_energy: -1.137 } } });

  assert.deepEqual(result?.values, [{ label: "ground energy", value: -1.137 }]);
  assert.equal(result?.counts, null);
});

test("shots describe the whole distribution, not the stored slice", () => {
  const result = measuredResultFromMetadata({
    measured_result: { counts: { "00": 10, "01": 8 }, shots: 4096, outcome_count: 300, truncated: true },
  });

  assert.equal(result?.shots, 4096);
  assert.equal(result?.outcomeCount, 300);
  assert.equal(result?.truncated, true);
});

test("a histogram with outcomes missing is truncated however it was labelled", () => {
  const result = measuredResultFromMetadata({
    measured_result: { counts: { "00": 10 }, shots: 100, outcome_count: 7, truncated: false },
  });

  assert.equal(result?.truncated, true, "7 outcomes recorded, 1 stored");
});

test("never reports fewer shots than the visible bars add up to", () => {
  const result = measuredResultFromMetadata({
    measured_result: { counts: { "00": 500, "11": 500 }, shots: 3 },
  });

  assert.equal(result?.shots, 1000);
});

test("non-numeric and negative counts are dropped", () => {
  const result = measuredResultFromMetadata({
    measured_result: { counts: { "00": 5, "01": "many", "10": -2, "11": null } },
  });

  assert.deepEqual(result?.counts, { "00": 5 });
});

test("infinities never reach the chart", () => {
  const result = measuredResultFromMetadata({
    measured_result: { values: { a: Number.POSITIVE_INFINITY, b: Number.NaN, c: 2 } },
  });

  assert.deepEqual(result?.values, [{ label: "c", value: 2 }]);
});

test("a malformed stored blob does not throw", () => {
  assert.equal(measuredResultFromMetadata({ measured_result: "counts: lots" }), null);
  assert.equal(measuredResultFromMetadata({ measured_result: { counts: "00" } }), null);
  assert.equal(measuredResultFromMetadata("nope"), null);
});

test("re-applies the worker's bounds on a blob that arrives unbounded", () => {
  const counts = Object.fromEntries(
    Array.from({ length: 300 }, (_, index) => [index.toString(2).padStart(12, "0"), index + 1]),
  );
  const values = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`m${index}`, index]));

  const result = measuredResultFromMetadata({ measured_result: { counts, values } });

  assert.equal(Object.keys(result!.counts!).length, 64, "histogram is capped");
  assert.equal(result?.values.length, 16, "value list is capped");
  assert.equal(result?.truncated, true);
});

test("a capped histogram still reports how many outcomes there really were", () => {
  const counts = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [index.toString(2).padStart(12, "0"), index + 1]),
  );

  // No outcome_count stored — the parser must not report its own cap as the truth.
  const result = measuredResultFromMetadata({ measured_result: { counts } });

  assert.equal(result?.outcomeCount, 100);
  assert.equal(result?.truncated, true);
});

test("the capped histogram keeps the heaviest outcomes", () => {
  const counts = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [`s${index}`, index + 1]),
  );

  const result = measuredResultFromMetadata({ measured_result: { counts } });

  assert.ok("s99" in result!.counts!, "heaviest kept");
  assert.ok(!("s0" in result!.counts!), "lightest dropped");
});

test("overlong keys are rejected, never truncated into a collision", () => {
  const shared = "1".repeat(64);
  const result = measuredResultFromMetadata({
    measured_result: { counts: { [`${shared}0`]: 400, [`${shared}1`]: 600, "01": 7 } },
  });

  assert.deepEqual(result?.counts, { "01": 7 });
});

test("arrays are not records", () => {
  assert.equal(measuredResultFromMetadata({ measured_result: [1, 2, 3] }), null);
  assert.equal(measuredResultFromMetadata({ measured_result: { counts: [1, 2] } }), null);
});
