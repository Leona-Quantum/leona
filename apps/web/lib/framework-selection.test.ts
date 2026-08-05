import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPOSER_FRAMEWORKS,
  canSubmitAfterArtifactHydration,
  hydrateArtifactFramework,
  hydrateConversationFramework,
  frameworkValue,
} from "./framework-selection.ts";

test("the run composer offers every executable agent framework", () => {
  assert.deepEqual(COMPOSER_FRAMEWORKS, [
    { key: "qiskit", label: "Qiskit" },
    { key: "cirq", label: "Cirq" },
    { key: "pennylane", label: "PennyLane" },
    { key: "braket", label: "Amazon Braket" },
    { key: "qibo", label: "Qibo" },
    { key: "qulacs", label: "Qulacs" },
  ]);
});

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

test("Amazon Braket values hydrate without falling back to Qiskit", () => {
  assert.equal(frameworkValue("braket"), "braket");
  assert.equal(frameworkValue("Amazon Braket"), "braket");
  assert.deepEqual(hydrateArtifactFramework("qiskit", false, "Amazon Braket"), {
    framework: "braket",
    error: null,
  });
});

test("Qibo and Qulacs values hydrate without falling back to Qiskit", () => {
  assert.equal(frameworkValue("Qibo"), "qibo");
  assert.equal(frameworkValue("qulacs"), "qulacs");
  assert.deepEqual(hydrateArtifactFramework("qiskit", false, "Qibo"), {
    framework: "qibo",
    error: null,
  });
  assert.deepEqual(hydrateArtifactFramework("qiskit", false, "Qulacs"), {
    framework: "qulacs",
    error: null,
  });
});

test("a follow-up keeps the persisted framework unless the user changed it", () => {
  assert.equal(hydrateConversationFramework("qiskit", false, "braket"), "braket");
  assert.equal(hydrateConversationFramework("cirq", true, "braket"), "cirq");
  assert.equal(hydrateConversationFramework("pennylane", false, "unknown-sdk"), "pennylane");
});

test("unsupported framework is surfaced and never rewritten as Qiskit", () => {
  assert.equal(frameworkValue("unknown-sdk"), null);
  assert.deepEqual(hydrateArtifactFramework("cirq", false, "unknown-sdk"), {
    framework: "cirq",
    error: "Unsupported artifact framework: unknown-sdk",
  });
});

test("submission stays blocked until artifact framework hydration succeeds", () => {
  assert.equal(canSubmitAfterArtifactHydration("checking"), false);
  assert.equal(canSubmitAfterArtifactHydration("loading"), false);
  assert.equal(canSubmitAfterArtifactHydration("error"), false);
  assert.equal(canSubmitAfterArtifactHydration("ready"), true);
  assert.equal(canSubmitAfterArtifactHydration("idle"), true);
});
