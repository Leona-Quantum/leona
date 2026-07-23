import assert from "node:assert/strict";
import test from "node:test";
import { formatShare, simulationChartData, simulationReading } from "./simulation-visual.ts";

test("chart data sorts by count, marks the peak, and aggregates the tail", () => {
  const counts = Object.fromEntries(
    Array.from({ length: 15 }, (_, index) => [index.toString(2).padStart(4, "0"), 5] as const),
  );
  counts["1100"] = 950; // index 12 sits inside the generated range; make it the peak
  counts["1111"] = 5; // keep 16 distinct states in play
  const data = simulationChartData(counts, 1025);
  assert.ok(data);
  assert.equal(data.bars.length, 12);
  assert.equal(data.bars[0].bitstring, "1100");
  assert.equal(data.bars[0].peak, true);
  assert.ok(data.bars.slice(1).every((bar) => !bar.peak));
  assert.equal(data.distinctStates, 16);
  assert.equal(data.otherStates, 4);
  assert.equal(data.otherShots, 20);
  // Ties resolve by bitstring so reruns of the same record render identically.
  assert.deepEqual(
    data.bars.slice(1, 4).map((bar) => bar.bitstring),
    ["0000", "0001", "0010"],
  );
  const total = data.bars.reduce((sum, bar) => sum + bar.count, 0) + data.otherShots;
  assert.equal(total, 1025);
});

test("chart data refuses empty or invalid counts", () => {
  assert.equal(simulationChartData({}, 100), null);
  assert.equal(simulationChartData({ "00": 4 }, 0), null);
});

test("a search family leads with the dominant state", () => {
  const data = simulationChartData({ "1100": 96, "0011": 4 }, 100);
  assert.ok(data);
  const reading = simulationReading("Grover", data);
  assert.equal(reading.kind, "concentrated");
  assert.equal(reading.kind === "concentrated" && reading.peak.bitstring, "1100");
});

test("an entangled-pair family leads with the top two outcomes", () => {
  const data = simulationChartData({ "00": 52, "11": 48 }, 100);
  assert.ok(data);
  const reading = simulationReading("Bell", data);
  assert.equal(reading.kind, "paired");
  assert.ok(reading.kind === "paired" && Math.abs(reading.combinedShare - 1) < 1e-9);
});

test("an unknown family is described by the sample's own shape", () => {
  const uniform = simulationChartData(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [index.toString(2).padStart(3, "0"), 16])), 128);
  assert.ok(uniform);
  const spread = simulationReading("QFT", uniform);
  assert.equal(spread.kind, "spread");
  assert.equal(spread.kind === "spread" && spread.distinctStates, 8);

  const dominant = simulationChartData({ "000": 90, "001": 10 }, 100);
  assert.ok(dominant);
  assert.equal(simulationReading(null, dominant).kind, "concentrated");
});

test("share formatting stays compact and locale-aware", () => {
  assert.equal(formatShare(0.9268, "en"), "92.7%");
  assert.equal(formatShare(0.0625, "en"), "6.25%");
  assert.equal(formatShare(1, "en"), "100%");
});
