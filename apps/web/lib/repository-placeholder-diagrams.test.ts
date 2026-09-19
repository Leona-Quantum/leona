import assert from "node:assert/strict";
import test from "node:test";

import { isPlaceholderDiagram } from "./repository/placeholder-diagrams.ts";

// The three stock signatures, transcribed from the batches that generate them
// (`zooEntry`/`classiqEntry` in entries-zoo-parity.ts/entries-classiq-parity.ts,
// `operatorEntry` and `vqeEntry` in entries-literature-expansion.ts) rather than
// imported from the corpus — the corpus barrel reaches its entry modules with
// extensionless specifiers, which `node --test`'s native TS loader cannot
// resolve (see repository-families.test.ts for the same note). The corpus-wide
// count is asserted instead by scripts/check-placeholder-diagram-census.mjs,
// which bundles with esbuild.

const ZOO_CLASSIQ_PLACEHOLDER = {
  wires: ["problem", "algorithm", "readout"],
  operations: [
    { label: "encode", qubits: [0], tone: "neutral" as const },
    { label: "transform", qubits: [0, 1], tone: "accent" as const },
    { label: "measure", qubits: [1, 2], tone: "warn" as const },
  ],
};

const OPERATOR_PLACEHOLDER = {
  wires: ["definition", "mapping", "measurement"],
  operations: [
    { label: "specify", qubits: [0], tone: "neutral" as const },
    { label: "map", qubits: [0, 1], tone: "accent" as const },
    { label: "group", qubits: [1, 2], tone: "warn" as const },
  ],
};

const VQE_PLACEHOLDER = {
  wires: ["hybrid objective", "quantum circuit", "classical update"],
  operations: [
    { label: "prepare", qubits: [1], tone: "accent" as const },
    { label: "measure H", qubits: [0, 1], tone: "warn" as const },
    { label: "update θ", qubits: [0, 2], tone: "ok" as const },
  ],
};

// A real gate-level record (quantum-fourier-transform, entries-algorithms.ts):
// distinct wires, distinct op labels, non-empty outcomes.
const QFT_REAL = {
  wires: ["q[0]", "q[1]", "q[2]"],
  operations: [
    { label: "H×3", qubits: [0, 1, 2], tone: "accent" as const },
    { label: "Controlled phases", qubits: [0, 1, 2], tone: "warn" as const },
    { label: "Swap (reversal)", qubits: [0, 2], tone: "ok" as const },
  ],
  outcomes: [
    { label: "Uniform across 8 outcomes (|0⟩ input)", probability: 0.125 },
    { label: "8th-root-of-unity phase pattern (|1⟩ input)", probability: 0.125 },
  ],
};

// A schematic record with its own drawing (hhl-linear-systems, entries-legacy.ts):
// three steps, but named for what they are, not a generic placeholder.
const HHL_SCHEMATIC = {
  wires: ["|b⟩", "phase register", "solution ancilla"],
  operations: [
    { label: "QPE(A)", qubits: [0, 1], tone: "accent" as const },
    { label: "λ⁻¹", qubits: [1, 2], tone: "warn" as const },
    { label: "Uncompute", qubits: [0, 1], tone: "ok" as const },
  ],
  outcomes: [{ label: "Observable of x", probability: 0.7 }],
};

test("matches all three known placeholder signatures", () => {
  assert.equal(isPlaceholderDiagram(ZOO_CLASSIQ_PLACEHOLDER), true);
  assert.equal(isPlaceholderDiagram(OPERATOR_PLACEHOLDER), true);
  assert.equal(isPlaceholderDiagram(VQE_PLACEHOLDER), true);
});

test("never matches a real gate-level or schematic record", () => {
  assert.equal(isPlaceholderDiagram(QFT_REAL), false);
  assert.equal(isPlaceholderDiagram(HHL_SCHEMATIC), false);
});

const WIRES_ONLY_MATCH = {
  wires: ["problem", "algorithm", "readout"],
  operations: [
    { label: "H", qubits: [0], tone: "accent" as const },
    { label: "CX", qubits: [0, 1], tone: "accent" as const },
    { label: "measure", qubits: [1], tone: "warn" as const },
  ],
};

const LABELS_ONLY_MATCH = {
  wires: ["q0", "q1", "q2"],
  operations: [
    { label: "encode", qubits: [0], tone: "neutral" as const },
    { label: "transform", qubits: [0, 1], tone: "accent" as const },
    { label: "measure", qubits: [1, 2], tone: "warn" as const },
  ],
};

const REORDERED_SIGNATURE = {
  wires: ["problem", "algorithm", "readout"],
  operations: [
    { label: "measure", qubits: [1, 2], tone: "warn" as const },
    { label: "transform", qubits: [0, 1], tone: "accent" as const },
    { label: "encode", qubits: [0], tone: "neutral" as const },
  ],
};

test("does not match on a partial signature — wires alone, or labels alone", () => {
  assert.equal(
    isPlaceholderDiagram(WIRES_ONLY_MATCH),
    false,
    "the wire names alone, with different operations, is not a placeholder",
  );
  assert.equal(
    isPlaceholderDiagram(LABELS_ONLY_MATCH),
    false,
    "the operation labels alone, with different wires, is not a placeholder",
  );
});

test("order matters — the same labels in a different order do not match", () => {
  assert.equal(
    isPlaceholderDiagram(REORDERED_SIGNATURE),
    false,
  );
});

test("degrades to false rather than throwing on an absent or empty visualization", () => {
  assert.equal(isPlaceholderDiagram(null), false);
  assert.equal(isPlaceholderDiagram(undefined), false);
  assert.equal(isPlaceholderDiagram({ wires: [], operations: [] }), false);
});
