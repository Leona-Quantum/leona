import assert from "node:assert/strict";
import test from "node:test";
import {
  hasAtlasCircuit,
  layoutAtlasCircuit,
  type AtlasCircuitLayout,
  type AtlasCircuitSource,
} from "./repository/atlas-circuit-layout.ts";

const grover = {
  wires: ["q[0]", "q[1]"],
  operations: [
    { label: "H×2", qubits: [0, 1], tone: "accent" as const },
    { label: "Oracle", qubits: [0, 1], tone: "warn" as const },
    { label: "Diffusion", qubits: [0, 1], tone: "ok" as const },
  ],
};

// The record behind /repository/layers/hardware-efficient-ansatz, as the corpus
// holds it: "update θ" acts on wires 0 and 2 and not on 1 — the case that drew
// an empty box on the classical-update wire.
const hardwareEfficientVqe: AtlasCircuitSource = {
  wires: ["hybrid objective", "quantum circuit", "classical update"],
  operations: [
    { label: "prepare", qubits: [1], tone: "accent" },
    { label: "measure H", qubits: [0, 1], tone: "warn" },
    { label: "update θ", qubits: [0, 2], tone: "ok" },
  ],
};

/**
 * Every box the figure draws, as the component draws them: `step.box`, one per
 * step, named by `step.label`. There is no other box in the layout to draw.
 */
function boxes(layout: AtlasCircuitLayout) {
  return layout.steps.map((step) => ({ box: step.box, label: step.label, step }));
}

test("one column per operation, in the record's own order", () => {
  const layout = layoutAtlasCircuit(grover);
  assert.deepEqual(
    layout.steps.map((step) => step.label),
    ["H×2", "Oracle", "Diffusion"],
  );
  assert.deepEqual(layout.steps.map((step) => step.index), [0, 1, 2]);
  for (let i = 1; i < layout.steps.length; i += 1) {
    const previous = layout.steps[i - 1].box;
    assert.ok(layout.steps[i].box.x > previous.x + previous.width - 1, "columns never overlap");
  }
  assert.equal(layout.skipped, 0);
  assert.equal(layout.unnamed, 0);
  assert.equal(layout.hidden, 0);
});

test("a longer label gets a wider column, never a clipped one", () => {
  const layout = layoutAtlasCircuit(grover);
  assert.ok(layout.steps[2].box.width > layout.steps[0].box.width);
  assert.ok(layout.width >= layout.steps[2].box.x + layout.steps[2].box.width);
});

test("no box renders without a label — a gate across non-adjacent wires is one named box, the wire it skips passes behind", () => {
  for (const density of ["hero", "thumb"] as const) {
    const layout = layoutAtlasCircuit(hardwareEfficientVqe, density);
    assert.equal(boxes(layout).length, hardwareEfficientVqe.operations.length, `${density}: one box per operation`);
    for (const { label } of boxes(layout)) {
      assert.notEqual(label.trim(), "", `${density}: every box carries its step's name`);
    }
    const update = layout.steps.find((step) => step.label === "update θ");
    assert.ok(update, `${density}: update θ is drawn`);
    assert.deepEqual(update.wires, [0, 2]);
    assert.deepEqual(update.passes, [1], `${density}: the quantum-circuit wire passes behind, not through a second box`);
    assert.ok(update.box.y < layout.wireY[0], `${density}: the box reaches above its first wire`);
    assert.ok(update.box.y + update.box.height > layout.wireY[2], `${density}: and below its last`);
    for (const step of layout.steps) {
      assert.ok(step.labelY > step.box.y && step.labelY < step.box.y + step.box.height, `${density}: ${step.label} is named inside its box`);
      for (const wire of step.passes) {
        assert.notEqual(step.labelY, layout.wireY[wire], `${density}: ${step.label}'s name does not cover the wire passing behind it`);
      }
    }
    assert.equal(update.labelY, layout.wireY[0], `${density}: update θ is named on its first wire`);
    const measure = layout.steps.find((step) => step.label === "measure H");
    assert.deepEqual(measure?.passes, [], `${density}: adjacent wires pass nothing`);
    assert.equal(measure?.labelY, (measure!.box.y * 2 + measure!.box.height) / 2, `${density}: a step with nothing passing is named at its middle`);
  }
});

test("a wire the step does act on is never listed as passing behind it", () => {
  const layout = layoutAtlasCircuit({
    wires: ["a", "b", "c", "d", "e"],
    operations: [{ label: "W", qubits: [4, 0, 2], tone: "accent" }],
  });
  const [step] = layout.steps;
  assert.deepEqual(step.wires, [0, 2, 4]);
  assert.deepEqual(step.passes, [1, 3]);
});

test("an operation with a blank name is counted, not drawn as an empty box", () => {
  const layout = layoutAtlasCircuit({
    wires: ["a", "b"],
    operations: [
      { label: "  ", qubits: [0, 1], tone: "neutral" },
      { label: "V", qubits: [1], tone: "ok" },
    ],
  });
  assert.equal(layout.steps.length, 1);
  assert.equal(layout.unnamed, 1);
  assert.equal(layout.skipped, 0);
  assert.equal(layout.steps[0].index, 1, "the caption still names the record's own position");
  assert.equal(hasAtlasCircuit({ wires: ["a"], operations: [{ label: "", qubits: [0], tone: "ok" }] }), false);
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
  assert.deepEqual(layout.steps[0].passes, [1]);
  assert.deepEqual(layout.steps[1].passes, []);
  assert.equal(layout.steps[1].index, 2, "the caption still names the record's own position");
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
