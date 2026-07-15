import assert from "node:assert/strict";
import test from "node:test";

import { hydrateArtifactFramework, frameworkValue } from "./framework-selection.ts";

test("delayed artifact hydration preserves an intervening framework selection", () => {
  const hydrated = hydrateArtifactFramework("pennylane", true, "Cirq");

  assert.deepEqual(hydrated, { framework: "pennylane", error: null });
});

test("artifact hydration applies a supported framework while untouched", () => {
  assert.deepEqual(hydrateArtifactFramework("qiskit", false, "Cirq"), {
    framework: "cirq",
    error: null,
  });
});

test("unsupported framework is surfaced and never rewritten as Qiskit", () => {
  assert.equal(frameworkValue("unknown-sdk"), null);
  assert.deepEqual(hydrateArtifactFramework("cirq", false, "unknown-sdk"), {
    framework: "cirq",
    error: "Unsupported artifact framework: unknown-sdk",
  });
});
