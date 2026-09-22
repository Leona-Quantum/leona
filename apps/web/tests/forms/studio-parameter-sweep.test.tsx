import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StudioParameterSweep } from "../../app/(app)/studio/studio-parameter-sweep.tsx";
import type { ParsedBuilderCircuit } from "../../lib/studio-parse.ts";

const CIRCUIT: ParsedBuilderCircuit = { qubitCount: 1, steps: [{ id: "turn", gate: "RY", qubits: [0], param: "pi/4" }] };

test("a Studio user can run an angle sweep, read the table, and see stale results withdrawn after an edit", async () => {
  const props = { circuit: CIRCUIT, synchronized: true, sourceCode: "ry(pi/4)", locale: "en" as const, onOpenVisual: () => {} };
  const view = render(<StudioParameterSweep {...props} />);
  fireEvent.click(screen.getByText("Parameter sweep"));
  fireEvent.change(screen.getByLabelText("Points"), { target: { value: "3" } });
  fireEvent.change(screen.getByLabelText("To (°)"), { target: { value: "180" } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => assert.ok(screen.getByRole("table")));
  const rows = [...view.container.querySelectorAll("tbody tr")];
  assert.equal(rows.length, 3);
  assert.match(rows[1].textContent ?? "", /0\.500000/);
  assert.ok(screen.getByRole("button", { name: "Download CSV" }));
  assert.ok(screen.getByRole("button", { name: "Download reproducible JSON" }));

  view.rerender(<StudioParameterSweep {...props} circuit={{ qubitCount: 1, steps: [{ ...CIRCUIT.steps[0], gate: "RX" }] }} />);
  assert.equal(view.container.querySelector("tbody"), null, "old circuit results must not appear beneath the new circuit");
});

test("an unsynchronized diagram cannot be swept as if it were the code", () => {
  const view = render(<StudioParameterSweep circuit={CIRCUIT} synchronized={false} sourceCode="different code" locale="en" onOpenVisual={() => {}} />);
  fireEvent.click(screen.getByText("Parameter sweep"));
  assert.match(view.container.textContent ?? "", /diagram differs from the source code/);
  assert.equal(view.container.querySelector("form"), null);
});
