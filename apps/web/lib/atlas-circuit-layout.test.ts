import assert from "node:assert/strict";
import test from "node:test";
import { hasAtlasCircuit, layoutAtlasCircuit } from "./repository/atlas-circuit-layout.ts";

const grover = {
  wires: ["q[0]", "q[1]"],
  operations: [
    { label: "H×2", qubits: [0, 1], tone: "accent" as const },
    { label: "Oracle", qubits: [0, 1], tone: "warn" as const },
    { label: "Diffusion", qubits: [0, 1], tone: "ok" as const },
  ],
};

test("one column per operation, in the record's own order", () => {
  const layout = layoutAtlasCircuit(grover);
  assert.deepEqual(
    layout.steps.map((step) => step.label),
    ["H×2", "Oracle", "Diffusion"],
  );
  assert.deepEqual(layout.steps.map((step) => step.index), [0, 1, 2]);
  for (let i = 1; i < layout.steps.length; i += 1) {
    assert.ok(layout.steps[i].x > layout.steps[i - 1].x + layout.steps[i - 1].width - 1, "columns never overlap");
  }
  assert.equal(layout.skipped, 0);
  assert.equal(layout.hidden, 0);
});

test("a longer label gets a wider column, never a clipped one", () => {
  const layout = layoutAtlasCircuit(grover);
  assert.ok(layout.steps[2].width > layout.steps[0].width);
  assert.ok(layout.width >= layout.steps[2].x + layout.steps[2].width);
});

test("wires the record does not draw are dropped, and an operation on none is counted, not drawn", () => {
  const layout = layoutAtlasCircuit({
    wires: ["a", "b", "c"],
    operations: [
      { label: "U", qubits: [0, 2, 2, 7], tone: "neutral" },
      { label: "ghost", qubits: [5], tone: "warn" },
      { label: "V", qubits: [1, 2], tone: "ok" },
    ],
  });
  assert.equal(layout.steps.length, 2);
  assert.equal(layout.skipped, 1);
  assert.deepEqual(layout.steps[0].wires, [0, 2]);
  assert.equal(layout.steps[0].contiguous, false);
  assert.equal(layout.steps[1].contiguous, true);
  assert.equal(layout.steps[1].index, 2, "the caption still names the record's own position");
});

test("a box spans from its first wire to its last", () => {
  const layout = layoutAtlasCircuit({ wires: ["a", "b", "c"], operations: [{ label: "W", qubits: [2, 0], tone: "accent" }] });
  const [step] = layout.steps;
  assert.ok(step.top < layout.wireY[0]);
  assert.ok(step.bottom > layout.wireY[2]);
});

test("a thumbnail caps its columns and says how many it left out", () => {
  const operations = Array.from({ length: 80 }, (_, index) => ({
    label: `g${index}`,
    qubits: [index % 16],
    tone: "neutral" as const,
  }));
  const layout = layoutAtlasCircuit({ wires: Array.from({ length: 16 }, (_, i) => `q${i}`), operations }, "thumb");
  assert.equal(layout.steps.length + layout.hidden, 80);
  assert.ok(layout.hidden > 0);
  const hero = layoutAtlasCircuit({ wires: Array.from({ length: 16 }, (_, i) => `q${i}`), operations }, "hero");
  assert.equal(hero.steps.length, 80, "a hero draws every step");
  assert.equal(hero.hidden, 0);
});

test("hasAtlasCircuit is false for no wires, no operations, or operations on no drawn wire", () => {
  assert.equal(hasAtlasCircuit(grover), true);
  assert.equal(hasAtlasCircuit(null), false);
  assert.equal(hasAtlasCircuit({ wires: [], operations: grover.operations }), false);
  assert.equal(hasAtlasCircuit({ wires: ["a"], operations: [] }), false);
  assert.equal(hasAtlasCircuit({ wires: ["a"], operations: [{ label: "x", qubits: [3], tone: "ok" }] }), false);
});
