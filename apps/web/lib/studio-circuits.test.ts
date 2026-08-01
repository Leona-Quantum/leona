import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { loadStoredCircuit, saveStoredCircuit } from "./studio-circuits.ts";
import { MAX_VIEWABLE_QUBITS } from "./studio-parse.ts";
import { resetStorageScopeForTests, setStorageScope } from "./user-storage.ts";

class MemoryStorage {
  private readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  raw(): Map<string, string> {
    return this.map;
  }
}

const STORAGE_KEY = "majorana.studio-circuits.v2";
let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage };
  resetStorageScopeForTests();
  setStorageScope(null);
});

function writeRaw(circuit: Record<string, unknown>): void {
  storage.setItem(STORAGE_KEY, JSON.stringify({ "artifact-1": circuit }));
}

function circuit(qubitCount: number): Record<string, unknown> {
  return {
    artifactIdentity: "artifact-1",
    qubitCount,
    steps: [{ id: "s1", gate: "H", qubits: [0] }],
    customGates: [],
    updatedAt: new Date(0).toISOString(),
  };
}

test("a stored circuit round-trips at a width the diagram can draw", () => {
  assert.equal(
    saveStoredCircuit("artifact-1", {
      artifactIdentity: "artifact-1",
      qubitCount: 40,
      steps: [{ id: "s1", gate: "H", qubits: [0] }],
      customGates: [],
    }),
    true,
  );
  assert.equal(loadStoredCircuit("artifact-1")?.qubitCount, 40);
});

test("the widest drawable circuit is still accepted", () => {
  writeRaw(circuit(MAX_VIEWABLE_QUBITS));
  assert.equal(loadStoredCircuit("artifact-1")?.qubitCount, MAX_VIEWABLE_QUBITS);
});

test("a stored width past the drawing ceiling is rejected, not seeded onto the canvas", () => {
  // Storage is the one place a qubitCount arrives without having passed a
  // parser. A hand-edited or corrupted entry claiming millions of wires would
  // seed a canvas whose SVG is tens of millions of pixels tall — which does not
  // render, so the panel is simply blank. Rejecting it here falls back to
  // reconstruction from the source, which declines honestly instead.
  writeRaw(circuit(MAX_VIEWABLE_QUBITS + 1));
  assert.equal(loadStoredCircuit("artifact-1"), null);

  writeRaw(circuit(1_000_000));
  assert.equal(loadStoredCircuit("artifact-1"), null);
});

test("a stored width that is not a positive whole number is rejected", () => {
  for (const bad of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "6", null]) {
    writeRaw(circuit(bad as number));
    assert.equal(loadStoredCircuit("artifact-1"), null, `qubitCount=${String(bad)}`);
  }
});
