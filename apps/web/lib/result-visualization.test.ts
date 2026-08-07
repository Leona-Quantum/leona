import assert from "node:assert/strict";
import { test } from "node:test";

import {
  distributionFromResult,
  humanizeResultKey,
  resultVisualizationFromResult,
  tracesFromResult,
  valuesFromResult,
} from "./result-visualization.ts";

test("finds measured distributions by shape instead of one result key", () => {
  const distribution = distributionFromResult({
    metadata: { seed: 42 },
    measurement_counts: { "000": 900, "111": 100 },
  });

  assert.equal(distribution?.kind, "counts");
  assert.equal(distribution?.total, 1000);
  assert.equal(distribution?.data.peak.bitstring, "000");
});

test("renders probabilities without inventing a shot count", () => {
  const distribution = distributionFromResult({
    probabilities: { "00": 0.49, "11": 0.51 },
  });

  assert.equal(distribution?.kind, "probabilities");
  assert.equal(distribution?.total, 1);
  assert.equal(distribution?.data.peak.bitstring, "11");
  assert.equal(distribution?.data.peak.share, 0.51);
});

test("prefers measured counts when a result also includes exact probabilities", () => {
  const distribution = distributionFromResult({
    probabilities: [0.5, 0, 0, 0.5],
    counts: { "00": 520, "11": 504 },
  });

  assert.equal(distribution?.kind, "counts");
  assert.equal(distribution?.total, 1024);
});

test("derives basis probabilities from JSON-safe complex amplitudes", () => {
  const distribution = distributionFromResult({
    statevector: [[Math.SQRT1_2, 0], [0, 0], [0, 0], [Math.SQRT1_2, 0]],
  });

  assert.equal(distribution?.kind, "probabilities");
  assert.match(distribution?.label ?? "", /derived from amplitudes/i);
  assert.deepEqual(
    distribution?.data.bars.filter((bar) => bar.share > 0).map((bar) => bar.bitstring),
    ["00", "11"],
  );
});

test("extracts generic optimization traces and preserves extrema when sampling", () => {
  const history = Array.from({ length: 180 }, (_, index) => 10 - index / 20);
  history[137] = -12;
  const [trace] = tracesFromResult({ optimization_history: history });

  assert.equal(trace.label, "Optimization History");
  assert.equal(trace.pointCount, 180);
  assert.equal(trace.minimum, -12);
  assert.ok(trace.points.some((point) => point.index === 137 && point.value === -12));
  assert.ok(trace.points.length <= 96);
});

test("does not mistake a parameter vector for an iteration trace", () => {
  const visualization = resultVisualizationFromResult({
    parameters: [0.2, 0.7],
    energy: -1.137,
  });

  assert.deepEqual(visualization.traces, []);
  assert.deepEqual(visualization.values, [
    { key: "parameters", label: "Parameters", value: "0.2, 0.7" },
    { key: "energy", label: "Energy", value: "-1.137" },
  ]);
});

test("rejects malformed distributions without hiding valid scalar output", () => {
  const visualization = resultVisualizationFromResult({
    counts: { "00": 10, bad: -1 },
    fidelity: 0.998,
  });

  assert.equal(visualization.distribution, null);
  assert.deepEqual(visualization.values, [{ key: "fidelity", label: "Fidelity", value: "0.998" }]);
});

test("localizes presentation labels without changing result keys or values", () => {
  const result = {
    measurement_counts: { "00": 700, "11": 300 },
    energy_Ha: -1.137,
    optimization_history: [-0.5, -1, -1.137],
  };
  const visualization = resultVisualizationFromResult(result, ["energy_Ha"], "ja");

  assert.equal(visualization.distribution?.label, "測定分布");
  assert.deepEqual(visualization.values, [
    { key: "energy_Ha", label: "エネルギー (Ha)", value: "-1.137" },
  ]);
  assert.equal(visualization.traces[0]?.label, "最適化履歴");
  assert.ok("energy_Ha" in result);
});

test("rows carry the result key, because two keys can humanize to one label", () => {
  // The collision is real in both locales: `_` becomes a space and the Japanese
  // table is keyed on a lowercased value, so case alone does not separate them.
  assert.equal(humanizeResultKey("energy_Ha"), humanizeResultKey("energy_ha"));
  assert.equal(humanizeResultKey("energy_Ha", "ja"), humanizeResultKey("energy_ha", "ja"));

  const values = valuesFromResult({ energy_Ha: -1.1, energy_ha: -1.2 });

  assert.deepEqual(values.map((value) => value.label), ["Energy Ha", "Energy Ha"]);
  assert.deepEqual(values.map((value) => value.key), ["energy_Ha", "energy_ha"]);
  assert.equal(new Set(values.map((value) => value.key)).size, values.length);
});

test("a plan that names the same expected key twice reports it once", () => {
  // `expected_output_keys` is model-authored and its contract does not require
  // uniqueness, so the duplicate has to be dropped here.
  const values = valuesFromResult({ counts: 5, energy: -1 }, ["counts", "counts"]);

  assert.deepEqual(values.map((value) => value.key), ["counts", "energy"]);
});

test("traces carry their result key too", () => {
  const traces = tracesFromResult({
    loss_history: [1, 0.5, 0.2, 0.1],
    "loss history": [2, 1, 0.4, 0.2],
  });

  assert.deepEqual(traces.map((trace) => trace.label), ["Loss History", "Loss History"]);
  assert.deepEqual(traces.map((trace) => trace.key), ["loss_history", "loss history"]);
});
