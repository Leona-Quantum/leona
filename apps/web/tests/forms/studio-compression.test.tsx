import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { CircuitBuilder } from "../../app/(app)/studio/studio-workspace.tsx";
import type { BuilderCodeVariants, BuilderStep, CustomGateDefinition } from "../../lib/studio-builder.ts";
import { WORKSPACE_COPY } from "../../lib/workspace-locale.ts";

const copy = WORKSPACE_COPY.en.studio;

const REDUNDANT_STEPS: BuilderStep[] = [
  { id: "h-a", gate: "H", qubits: [0] },
  { id: "x", gate: "X", qubits: [1] },
  { id: "h-b", gate: "H", qubits: [0] },
];

function renderCompressionBuilder(steps = REDUNDANT_STEPS, syncState: { kind: "in_sync" | "diverged" | "unrepresentable" } = { kind: "in_sync" }) {
  const changes: { steps: BuilderStep[] }[] = [];
  const applied: BuilderCodeVariants[] = [];
  const view = render(
    <CircuitBuilder
      seed={{
        key: "compression-seed",
        artifactIdentity: null,
        qubitCount: 2,
        steps,
        customGates: [] as CustomGateDefinition[],
        readOnly: false,
        readOnlyReasons: [],
        operationCount: steps.length,
      }}
      framework="qiskit"
      selectedGate="H"
      onSelectGate={() => {}}
      onApply={(codes) => applied.push(codes)}
      onCircuitChange={(circuit) => changes.push(circuit)}
      hidden={false}
      popout={false}
      onTogglePopout={() => {}}
      copy={copy}
      syncState={syncState}
      onRebuildFromCode={() => {}}
      sourceCode=""
    />,
  );
  const details = view.container.querySelector("details.mj-studio-compression") as HTMLDetailsElement | null;
  assert.ok(details);
  details.open = true;
  return { ...view, changes, applied };
}

test("Studio compression previews, applies to every framework draft, and can be undone", async () => {
  const view = renderCompressionBuilder();

  assert.ok(view.getByRole("radio", { name: new RegExp(copy.compressionBalanced) }).hasAttribute("checked"));
  fireEvent.click(view.getByRole("button", { name: copy.compressionApply }));

  await waitFor(() => assert.ok(view.changes.some((change) => change.steps.length === 1)));
  assert.deepEqual(view.changes.find((change) => change.steps.length === 1)!.steps, [
    { id: "x", gate: "X", qubits: [1] },
  ]);
  assert.equal(view.applied.length, 1);
  assert.match(view.applied[0].qiskit, /qc\.x\(1\)/);
  assert.doesNotMatch(view.applied[0].qiskit, /qc\.h\(/);
  assert.ok(view.getByText(copy.compressionApplied(2, 2, 1)));

  fireEvent.click(view.getByRole("button", { name: copy.compressionUndo }));
  await waitFor(() => assert.equal(view.applied.length, 2));
  await waitFor(() => assert.ok(view.changes.some((change) => change.steps.length === 3)));
  assert.match(view.applied[1].qiskit, /qc\.h\(0\)/);
  assert.match(view.applied[1].qiskit, /qc\.x\(1\)/);
  assert.ok(view.getByText(copy.compressionUndone));
});

test("Studio compression disables application when the selected strategy has no exact rewrite", () => {
  const view = renderCompressionBuilder([
    { id: "h", gate: "H", qubits: [0] },
    { id: "x", gate: "X", qubits: [0] },
  ]);

  assert.ok(view.getByText(copy.compressionNoChange));
  assert.equal((view.getByRole("button", { name: copy.compressionApply }) as HTMLButtonElement).disabled, true);
});

test("Studio compression confirms before replacing code that no longer matches the diagram", () => {
  const view = renderCompressionBuilder(REDUNDANT_STEPS, { kind: "diverged" });

  fireEvent.click(view.getByRole("button", { name: copy.compressionApply }));
  assert.equal(view.applied.length, 0);
  assert.ok(view.getByText(copy.compressionOverwrite));

  fireEvent.click(view.getByRole("button", { name: copy.compressionConfirmApply }));
  assert.equal(view.applied.length, 1);
  assert.match(view.applied[0].qiskit, /qc\.x\(1\)/);
});
