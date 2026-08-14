import assert from "node:assert/strict";
import { test } from "node:test";

import {
  chartsFromResult,
  distributionFromResult,
  humanizeResultKey,
  resultVisualizationFromResult,
  tracesFromResult,
  valuesFromResult,
} from "./result-visualization.ts";

test("parses bounded model-authored line, scatter, and bar charts", () => {
  const charts = chartsFromResult({
    visualizations: [
      {
        type: "line",
        title: "Energy convergence",
        x_label: "Iteration",
        y_label: "Energy (Ha)",
        series: [
          { label: "COBYLA", x: [0, 1, 2], y: [-0.5, -1.0, -1.13] },
          { label: "SPSA", x: [0, 1, 2], y: [-0.4, -0.9, -1.08] },
        ],
      },
      {
        type: "scatter",
        title: "Accuracy and runtime",
        series: [{ label: "Trials", x: [2.1, 3.4], y: [0.98, 0.99] }],
      },
      {
        type: "bar",
        title: "Success rate",
        x_label: "Framework",
        series: [{ label: "Pass rate", x: ["Qiskit", "Qibo"], y: [0.9, 0.7] }],
      },
    ],
  });

  assert.deepEqual(charts.map((chart) => chart.kind), ["line", "scatter", "bar"]);
  assert.equal(charts[0]?.series[1]?.points[2]?.y, -1.08);
  assert.deepEqual(charts[2]?.series[0]?.points[0], { x: "Qiskit", y: 0.9 });
});

test("rejects malformed or non-finite chart data instead of partially drawing it", () => {
  const charts = chartsFromResult({
    visualizations: [
      {
        type: "line",
        title: "Mismatched arrays",
        series: [{ label: "Energy", x: [0, 1], y: [-1] }],
      },
      {
        type: "scatter",
        title: "Categorical scatter",
        series: [{ label: "Invalid", x: ["first"], y: [1] }],
      },
      {
        type: "bar",
        title: "One bad series invalidates the chart",
        series: [
          { label: "Valid", x: ["A"], y: [1] },
          { label: "Invalid", x: ["A"], y: [Number.NaN] },
        ],
      },
      {
        type: "line",
        title: "Unsafe numeric magnitude",
        series: [{ label: "Overflow", x: [0, 1e200], y: [0, 1] }],
      },
    ],
  });

  assert.deepEqual(charts, []);
});

test("caps categorical bar charts before rendering unreadable labels", () => {
  assert.deepEqual(chartsFromResult({
    visualizations: [{
      type: "bar",
      title: "Too many categories",
      series: [{
        label: "Values",
        x: Array.from({ length: 25 }, (_, index) => `category-${index}`),
        y: Array.from({ length: 25 }, (_, index) => index),
      }],
    }],
  }), []);
});

test("caps chart count, series count, and point count", () => {
  const valid = (index: number) => ({
    type: "line",
    title: `Chart ${index}`,
    series: [{ label: "Series", x: [0, 1], y: [index, index + 1] }],
  });
  assert.equal(chartsFromResult({ visualizations: [0, 1, 2, 3, 4].map(valid) }).length, 4);
  assert.deepEqual(chartsFromResult({
    visualizations: [{
      type: "line",
      title: "Too many series",
      series: Array.from({ length: 5 }, (_, index) => ({ label: `${index}`, x: [0], y: [0] })),
    }],
  }), []);
  assert.deepEqual(chartsFromResult({
    visualizations: [{
      type: "line",
      title: "Too many points",
      series: [{
        label: "Series",
        x: Array.from({ length: 97 }, (_, index) => index),
        y: Array.from({ length: 97 }, (_, index) => index),
      }],
    }],
  }), []);
});

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
