// Clear and "Remove qubit" were the two most destructive buttons on the Studio
// canvas and the only two Undo could not take back: Clear emptied the circuit on
// one click, and removing a wire silently deleted every gate touching it —
// including a two-qubit gate whose other wire stayed. Both now push an undo
// snapshot and say what happened in the status line. State is observed the way
// the custom-gate test observes it: through `onCircuitChange`.
import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { CircuitBuilder } from "../../app/(app)/studio/studio-workspace.tsx";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";
import type { BuilderStep, CustomGateDefinition } from "../../lib/studio-builder.ts";

const copy = WORKSPACE_COPY.en.studio;

const STEPS: BuilderStep[] = [
  { id: "s-h0", gate: "H", qubits: [0] },
  { id: "s-cx", gate: "CX", qubits: [0, 2] },
  { id: "s-x1", gate: "X", qubits: [1] },
];

function renderBuilder() {
  const changes: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }[] = [];
  const view = render(
    <CircuitBuilder
      seed={{ key: "test-seed", artifactIdentity: null, qubitCount: 3, steps: STEPS, customGates: [], readOnly: false, readOnlyReasons: [], operationCount: STEPS.length }}
      framework="qiskit"
      selectedGate="H"
      onSelectGate={() => {}}
      onApply={() => {}}
      onCircuitChange={(circuit) => changes.push(circuit)}
      hidden={false}
      popout={false}
      onTogglePopout={() => {}}
      copy={copy}
      syncState={{ kind: "in_sync" }}
      onRebuildFromCode={() => {}}
      sourceCode=""
    />,
  );
  const latest = () => changes[changes.length - 1];
  return { ...view, latest };
}

const ids = (steps: BuilderStep[]) => steps.map((step) => step.id);

test("studio: Clear is one undo step and says so", async () => {
  const { getByRole, getByText, latest } = renderBuilder();
  // Nothing has changed yet, so the builder has reported nothing and Undo has nothing to take back.
  assert.equal(latest(), undefined);
  assert.equal((getByRole("button", { name: copy.undo }) as HTMLButtonElement).disabled, true);

  fireEvent.click(getByRole("button", { name: copy.clearAll }));
  await waitFor(() => assert.deepEqual(latest()?.steps, []));
  assert.ok(getByText(copy.clearedUndo(3)));

  fireEvent.click(getByRole("button", { name: copy.undo }));
  await waitFor(() => assert.deepEqual(ids(latest().steps), ["s-h0", "s-cx", "s-x1"]));
});

test("studio: removing a wire names the gates it took, and Undo returns the wire and the gates", async () => {
  const { getByRole, getByText, latest } = renderBuilder();

  // q2 goes, and CX(q0, q2) goes with it although q0 stays. H(q0) and X(q1) are untouched.
  fireEvent.click(getByRole("button", { name: copy.removeQubit }));
  await waitFor(() => assert.equal(latest()?.qubitCount, 2));
  assert.deepEqual(ids(latest().steps), ["s-h0", "s-x1"]);
  assert.ok(getByText(copy.qubitRemovedWithGates(1)));

  fireEvent.click(getByRole("button", { name: copy.undo }));
  await waitFor(() => assert.equal(latest().qubitCount, 3));
  assert.deepEqual(ids(latest().steps), ["s-h0", "s-cx", "s-x1"]);
});

test("studio: deleting a selected gate can be undone", async () => {
  const { getByRole, latest } = renderBuilder();
  fireEvent.click(getByRole("button", { name: "X on q1" }));
  fireEvent.keyDown(document, { key: "Delete" });
  await waitFor(() => assert.deepEqual(ids(latest()?.steps ?? []), ["s-h0", "s-cx"]));
  fireEvent.click(getByRole("button", { name: copy.undo }));
  await waitFor(() => assert.deepEqual(ids(latest().steps), ["s-h0", "s-cx", "s-x1"]));
});

test("studio: removing an empty wire is its own undo step", async () => {
  const { getByRole, latest } = renderBuilder();
  // q3 is added empty, then removed again: no gate is involved either time.
  fireEvent.click(getByRole("button", { name: copy.addQubit }));
  await waitFor(() => assert.equal(latest()?.qubitCount, 4));
  fireEvent.click(getByRole("button", { name: copy.removeQubit }));
  await waitFor(() => assert.equal(latest()?.qubitCount, 3));
  // Undo gives the wire back; it does not reach past it to the step before.
  fireEvent.click(getByRole("button", { name: copy.undo }));
  await waitFor(() => assert.equal(latest()?.qubitCount, 4));
  assert.deepEqual(ids(latest()?.steps ?? []), ["s-h0", "s-cx", "s-x1"]);
});
