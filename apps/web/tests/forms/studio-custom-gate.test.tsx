// Real submission coverage for the Studio "group as custom gate" form
// (ai-ops issue 123). apps/web/app/(app)/studio/studio-workspace.tsx's
// `CircuitBuilder` — a large, unexported component; exported for this test
// only (see the comment above its `export`).
//
// Unlike every other form in this suite, this one has no server round trip —
// `createCustomGate()` is pure client state (grouping selected canvas steps
// into a reusable gate). What "submitting" means here is: select two circuit
// steps on the canvas, open the form, submit a name, and see the custom gate
// actually land in `customGates` — observed through `onCircuitChange`, the
// one channel CircuitBuilder reports its state through.
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
  { id: "s-x1", gate: "X", qubits: [1] },
  { id: "s-m1", gate: "M", qubits: [1] },
];

function seedFor(steps: BuilderStep[]) {
  return {
    key: "test-seed",
    artifactIdentity: null,
    qubitCount: 2,
    steps,
    customGates: [] as CustomGateDefinition[],
    readOnly: false,
    readOnlyReasons: [],
    operationCount: steps.length,
  };
}

function renderBuilder(steps: BuilderStep[] = STEPS) {
  const changes: { qubitCount: number; steps: BuilderStep[]; customGates: CustomGateDefinition[] }[] = [];
  const view = render(
    <CircuitBuilder
      seed={seedFor(steps)}
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
  return { ...view, changes };
}

test("studio custom gate: selecting two unitary steps and submitting a name adds a custom gate", async () => {
  const { container, getByRole, getByLabelText, getByText, changes } = renderBuilder();

  fireEvent.click(getByRole("button", { name: "H on q0" }));
  fireEvent.click(getByRole("button", { name: "X on q1" }), { shiftKey: true });

  fireEvent.click(getByRole("button", { name: copy.groupSelected }));
  const nameField = getByLabelText(copy.customGates) as HTMLInputElement;
  fireEvent.change(nameField, { target: { value: "Bell prep" } });

  const form = nameField.closest("form");
  assert.ok(form, "no <form> around the custom-gate name field");
  fireEvent.submit(form!);

  // The real contract: the grouped gate actually lands in customGates, the
  // form closes, and the new gate is what got selected — not just "nothing
  // threw".
  await waitFor(() => assert.ok(changes.some((c) => c.customGates.length === 1)));
  const created = changes.find((c) => c.customGates.length === 1)!;
  assert.equal(created.customGates[0].name, "Bell prep");
  assert.equal(created.customGates[0].qubitCount, 2);
  // The two original steps are replaced by one CUSTOM step referencing the
  // new gate definition.
  assert.equal(created.steps.length, 2); // the untouched M step + the new CUSTOM step
  assert.ok(created.steps.some((step) => step.gate === "CUSTOM" && step.customGateId === created.customGates[0].id));

  await waitFor(() => assert.ok(getByText(copy.customGateCreated("Bell prep"))));
  // Creating closes the form — it must not still be sitting open, ready to
  // create a second gate from the same (now regrouped) selection. Checked by
  // class, not by `aria-label`: the palette's "Custom gates" LIST carries the
  // same label text as the form did, and now that a gate exists, that list
  // is what would falsely satisfy a `queryByLabelText` check.
  assert.equal(
    container.querySelector("form.mj-builder-custom-form"),
    null,
    "the custom-gate form should have closed on success",
  );
});

test("studio custom gate: an empty name falls back to a generated 'Custom gate N' name", async () => {
  const { getByRole, getByLabelText, changes } = renderBuilder();

  fireEvent.click(getByRole("button", { name: "H on q0" }));
  fireEvent.click(getByRole("button", { name: "X on q1" }), { shiftKey: true });
  fireEvent.click(getByRole("button", { name: copy.groupSelected }));

  const form = (getByLabelText(copy.customGates) as HTMLInputElement).closest("form")!;
  fireEvent.submit(form); // no name typed

  await waitFor(() => assert.ok(changes.some((c) => c.customGates.length === 1)));
  assert.equal(changes.find((c) => c.customGates.length === 1)!.customGates[0].name, "Custom gate 1");
});

test("studio custom gate: grouping a selection that includes a measurement is refused, with the real validation message, and nothing is created", async () => {
  const { getByRole, getByLabelText, queryByText } = renderBuilder();

  // X on q1, then M on q1 — two steps selected, but grouping a measurement is
  // refused by createCustomGate()'s own rule.
  fireEvent.click(getByRole("button", { name: "X on q1" }));
  fireEvent.click(getByRole("button", { name: "M on q1" }), { shiftKey: true });
  fireEvent.click(getByRole("button", { name: copy.groupSelected }));

  const form = (getByLabelText(copy.customGates) as HTMLInputElement).closest("form")!;
  fireEvent.submit(form);

  await waitFor(() => assert.ok(queryByText(copy.customGateCannotGroup)));
  // The form stays open (nothing was created) rather than silently closing.
  assert.ok(getByLabelText(copy.customGates));
});
