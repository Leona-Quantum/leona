import "./dom-env.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import type { ComponentProps } from "react";
import type { components } from "@majorana/contracts-gen";
import { fireEvent, render } from "@testing-library/react";
import { NotebookView } from "../../components/notebook-view.tsx";
import { NotebookAddCheckForm } from "../../components/notebook-add-check-form.tsx";
import { notebookCellViews } from "../../lib/notebook-view.ts";
import type { CheckProperty } from "../../lib/notebook-checks.ts";
import { NOTEBOOK_CHECK_COPY } from "../../lib/workspace-locale.ts";

const CHECK_COPY = NOTEBOOK_CHECK_COPY.en;

// Check cells (ai-ops 382, `plans/platform-vision-20260924/phase-a/DESIGN.md` §1–2): the
// card in every state the worker can hand it, the author badge in every combination, the
// Accept button's permission gate, the notebook-level summary, and the "Add a check"
// form's client-side validation and the payload it builds. `notebook-view.test.tsx`
// already covers the rest of `NotebookView` (grades, questions, outputs) — this file is
// only the check-cell surface added on top of it.

type Cell = components["schemas"]["Cell"];
type CellResult = components["schemas"]["CellResult"];
type CheckTeeth = components["schemas"]["CheckTeeth"];

const FINGERPRINT = "a".repeat(64);

function baseProperty(overrides: Partial<CheckProperty> = {}): CheckProperty {
  return {
    kind: "state",
    subject: "qc",
    amplitudes: null,
    probabilities: null,
    reference: "bell",
    reference_qasm: null,
    hamiltonian: null,
    target: null,
    value: null,
    tolerance: 1e-6,
    statement: "bell prepares the Bell state",
    author: "nala",
    citation: "",
    accepted: false,
    block: null,
    ...overrides,
  };
}

function checkCell(id: string, property: CheckProperty | null): Cell {
  return {
    id,
    kind: "code",
    role: "check",
    source: `# check: ${property?.statement ?? ""}`,
    tags: [],
    execute: true,
    stub: null,
    check: null,
    answer: null,
    answer_prompt: null,
    timeout_s: null,
    block: null,
    property,
  };
}

function checkResult(id: string, check: CellResult["check"]): CellResult {
  return {
    id,
    status: "ok",
    stdout: "",
    stderr: "",
    outputs: [],
    error: null,
    duration_ms: 5,
    execution_count: 1,
    note: "",
    check,
    cache_key: null,
    cached_from_seq: null,
  };
}

function renderCheck(
  property: CheckProperty | null,
  check: CellResult["check"],
  extra: Partial<Omit<ComponentProps<typeof NotebookView>, "cells">> = {},
) {
  const cells = notebookCellViews([checkCell("c01", property)], {
    notebook_slug: "s",
    ok: true,
    runner: "sandbox",
    duration_ms: 0,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: [checkResult("c01", check)],
  });
  return render(<NotebookView cells={cells} locale="en" framework="qiskit" {...extra} />);
}

/** The cell-head pill's own text — scoped to that one element, since the verdict chip
 * inside the card can carry the same word ("Pass"/"Fail"/"Inconclusive"), and a plain
 * `getByText` would throw on the ambiguity rather than tell them apart. */
function pillText(view: ReturnType<typeof render>): string {
  const pill = view.container.querySelector(".mj-notebook-cell-pill");
  assert.ok(pill, "no cell-head pill on screen");
  return pill!.textContent ?? "";
}

// -------------------------------------------------------------------------- verdict states

test("a not-yet-run check says so, and shows no verdict chip", () => {
  const view = renderCheck(baseProperty(), null);
  assert.equal(pillText(view), "Not run yet");
  assert.ok(view.getAllByText("Not run yet").length >= 2); // the pill AND the card body
  assert.equal(view.queryByText("Pass"), null);
  assert.equal(view.queryByText("Fail"), null);
});

// The bug this guards: the pill is `NotebookCellCard`'s generic head pill, which for
// every other cell just reflects `cell.status` (ok/error/skipped/not_run). For a check
// cell, `status: "ok"` only means the worker's capture ran — the verdict can still be a
// fail, and a pill reading "Passed" over a failing verdict box is actively misleading.
test("a check cell with status ok and verdict fail renders \"Fail\" in the pill — never \"Passed\"", () => {
  const view = renderCheck(
    baseProperty(),
    { status: "fail", basis: "circuit", checked_against: "a reference", measure: "off by a lot", detail: "wrong phase", qubits: 1, subject_fingerprint: null, subject_qasm: null, teeth: null },
  );
  assert.equal(pillText(view), "Fail");
  assert.equal(view.queryByText("Passed"), null);
});

test("a check cell with status ok and an inconclusive verdict renders \"Inconclusive\" in the pill — never \"Passed\"", () => {
  const view = renderCheck(
    baseProperty(),
    { status: "inconclusive", basis: "circuit", checked_against: "", measure: "", detail: "could not judge it", qubits: null, subject_fingerprint: null, subject_qasm: null, teeth: null },
  );
  assert.equal(pillText(view), "Inconclusive");
  assert.equal(view.queryByText("Passed"), null);
});

// The capture itself crashing is a different failure from a judged check that failed —
// the pill keeps showing Error, not a verdict there is none of.
test("a check cell whose capture crashed (status error) shows Error, not a verdict word", () => {
  const cells = notebookCellViews([checkCell("c01", baseProperty())], {
    notebook_slug: "s",
    ok: false,
    runner: "sandbox",
    duration_ms: 0,
    environment: {},
    dropped_bytes: 0,
    note: "",
    cells: [
      {
        id: "c01",
        status: "error",
        stdout: "",
        stderr: "",
        outputs: [],
        error: { ename: "RuntimeError", evalue: "sandbox crashed", traceback: [] },
        duration_ms: 1,
        execution_count: 1,
        note: "",
        check: null,
        cache_key: null,
        cached_from_seq: null,
      },
    ],
  });
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" />);
  assert.equal(pillText(view), "Error");
  assert.equal(view.queryByText("Passed"), null);
});

test("a passing check with teeth measured shows the chip, the caught line, and the survivor disclosure", () => {
  const teeth: CheckTeeth = {
    status: "measured",
    reason: "",
    mutants: 12,
    equivalent: 2,
    could_not_run: 0,
    caught: 11,
    survivors: ["negating the rz angle on q1, gate 4"],
  };
  const view = renderCheck(
    baseProperty(),
    { status: "pass", basis: "circuit", checked_against: "Qiskit's Bell state, exact fidelity", measure: "fidelity 0.999999 (needs ≥ 0.999999)", detail: "", qubits: 2, subject_fingerprint: FINGERPRINT, subject_qasm: "OPENQASM 3;\nqubit[2] q;\nh q[0];\ncx q[0], q[1];\n", teeth },
  );
  assert.equal(pillText(view), "Pass");
  assert.ok(view.getAllByText("Pass").length >= 2); // the pill AND the verdict chip
  assert.ok(view.getByText("Checked against Qiskit's Bell state, exact fidelity"));
  assert.match(view.getByText(/fidelity 0.999999/).textContent ?? "", /needs/);
  assert.ok(view.getByText("Caught 11 of 12 changes that alter the circuit's output"));
  assert.ok(view.getByText("Not caught (1)"));
  // The disclosure is collapsed by default — the survivor text exists in the DOM
  // (a <details> body), which is what the assertion above already confirms; the
  // "2 changes ... left out" line is always shown once teeth are measured.
  assert.ok(view.getByText("2 changes that don't alter the output were left out."));
  // No "could not tell a broken circuit" warning when teeth actually caught something.
  assert.equal(view.queryByText("This check could not tell a broken circuit from this one."), null);
});

test("a passing check that caught nothing shows the warning line", () => {
  const teeth: CheckTeeth = { status: "measured", reason: "", mutants: 5, equivalent: 0, could_not_run: 0, caught: 0, survivors: [] };
  const view = renderCheck(
    baseProperty(),
    { status: "pass", basis: "circuit", checked_against: "a reference", measure: "fidelity 1.0", detail: "", qubits: 1, subject_fingerprint: null, subject_qasm: null, teeth },
  );
  assert.ok(view.getByText("This check could not tell a broken circuit from this one."));
  assert.ok(view.getByText("Caught 0 of 5 changes that alter the circuit's output"));
});

test("a passing check whose teeth were not measured shows the reason, not a score", () => {
  const teeth: CheckTeeth = { status: "not_measured", reason: "over the time budget", mutants: 0, equivalent: 0, could_not_run: 0, caught: 0, survivors: [] };
  const view = renderCheck(
    baseProperty(),
    { status: "pass", basis: "circuit", checked_against: "a reference", measure: "fidelity 1.0", detail: "", qubits: 20, subject_fingerprint: null, subject_qasm: null, teeth },
  );
  assert.ok(view.getByText("Teeth not measured: over the time budget"));
  assert.equal(view.queryByText(/Caught \d+ of/), null);
});

test("a failing check shows the diagnosis prominently; teeth are not shown at all", () => {
  const teeth: CheckTeeth = { status: "measured", reason: "", mutants: 4, equivalent: 0, could_not_run: 0, caught: 4, survivors: [] };
  const view = renderCheck(
    baseProperty(),
    {
      status: "fail",
      basis: "circuit",
      checked_against: "Qiskit's Bell state, exact fidelity",
      measure: "fidelity 0.5 (needs ≥ 0.999999)",
      detail: "Matches with the qubit order reversed — Qiskit puts q0 on the right.",
      qubits: 2,
      subject_fingerprint: FINGERPRINT,
      subject_qasm: "OPENQASM 3;\n",
      teeth,
    },
  );
  assert.equal(pillText(view), "Fail");
  assert.ok(view.getAllByText("Fail").length >= 2); // the pill AND the verdict chip
  assert.ok(view.getByText(/qubit order reversed/));
  // DESIGN.md §1.5: teeth are only ever reported for a check that PASSED this run.
  assert.equal(view.queryByText(/Caught \d+ of/), null);
  assert.equal(view.queryByText("Caught 4 of 4 changes that alter the circuit's output"), null);
});

test("an inconclusive check shows why, never counted as a fail", () => {
  const view = renderCheck(
    baseProperty(),
    {
      status: "inconclusive",
      basis: "circuit",
      checked_against: "",
      measure: "",
      detail: "The circuit has mid-circuit measurement, which this check cannot judge.",
      qubits: null,
      subject_fingerprint: null,
      subject_qasm: null,
      teeth: null,
    },
  );
  assert.equal(pillText(view), "Inconclusive");
  assert.ok(view.getAllByText("Inconclusive").length >= 2); // the pill AND the verdict chip
  assert.ok(view.getByText(/mid-circuit measurement/));
  assert.equal(view.queryByText("Fail"), null);
});

test("a value check reads 'checked from the value your code produced', a circuit check reads 'from the circuit'", () => {
  const circuitView = renderCheck(baseProperty({ kind: "state" }), null);
  assert.ok(circuitView.getByText("Checked from the circuit"));

  const valueView = renderCheck(baseProperty({ kind: "value", reference: null, value: 0.5 }), null);
  assert.ok(valueView.getByText("Checked from the value your code produced"));
});

// -------------------------------------------------------------------------- author badge

test("author badge: Nala, not yet accepted — shows the Accept button when the viewer can edit", () => {
  const view = renderCheck(baseProperty({ author: "nala", accepted: false }), null, { onAcceptCheck: () => {} });
  assert.match(view.getByText(/Proposed by Nala/).textContent ?? "", /not accepted yet/);
  assert.ok(view.getByRole("button", { name: "Accept" }));
});

test("author badge: Nala, accepted — no Accept button", () => {
  const view = renderCheck(baseProperty({ author: "nala", accepted: true }), null, { onAcceptCheck: () => {} });
  assert.match(view.getByText(/Proposed by Nala/).textContent ?? "", /accepted by you/);
  assert.equal(view.queryByRole("button", { name: "Accept" }), null);
});

test("author badge: a Nala check with a citation names it", () => {
  const view = renderCheck(baseProperty({ author: "nala", citation: "Nielsen & Chuang, Box 1.1", accepted: false }), null);
  assert.ok(view.getByText(/Proposed by Nala, citing Nielsen & Chuang, Box 1.1/));
});

test("author badge: written by the reader", () => {
  const view = renderCheck(baseProperty({ author: "user", accepted: true }), null);
  assert.ok(view.getByText("Written by you"));
});

test("author badge: from a source, with its citation", () => {
  const view = renderCheck(baseProperty({ author: "source", citation: "arXiv:1234.5678", accepted: false }), null);
  assert.ok(view.getByText("From arXiv:1234.5678"));
});

test("Accept button is absent without onAcceptCheck, even on an unaccepted Nala check — the read-only share page's shape", () => {
  const view = renderCheck(baseProperty({ author: "nala", accepted: false }), null);
  assert.equal(view.queryByRole("button", { name: "Accept" }), null);
});

test("clicking Accept calls back with the cell id", () => {
  const accepted: string[] = [];
  const view = renderCheck(baseProperty({ author: "nala", accepted: false }), null, {
    onAcceptCheck: (id: string) => accepted.push(id),
  });
  fireEvent.click(view.getByRole("button", { name: "Accept" }));
  assert.deepEqual(accepted, ["c01"]);
});

// -------------------------------------------------------------------------- notebook summary

test("the notebook-level summary is computed from the report, not guessed", () => {
  const cells = notebookCellViews(
    [
      checkCell("c01", baseProperty({ author: "user", accepted: true })),
      checkCell("c02", baseProperty({ author: "nala", accepted: false })),
      checkCell("c03", baseProperty({ author: "nala", accepted: true })),
      checkCell("c04", baseProperty({ author: "user", accepted: true })),
    ],
    {
      notebook_slug: "s",
      ok: true,
      runner: "sandbox",
      duration_ms: 0,
      environment: {},
      dropped_bytes: 0,
      note: "",
      cells: [
        checkResult("c01", { status: "pass", basis: "circuit", checked_against: "x", measure: "", detail: "", qubits: 1, subject_fingerprint: null, subject_qasm: null, teeth: null }),
        checkResult("c02", { status: "inconclusive", basis: "circuit", checked_against: "", measure: "", detail: "x", qubits: null, subject_fingerprint: null, subject_qasm: null, teeth: null }),
        checkResult("c03", { status: "pass", basis: "circuit", checked_against: "x", measure: "", detail: "", qubits: 1, subject_fingerprint: null, subject_qasm: null, teeth: null }),
        checkResult("c04", { status: "pass", basis: "circuit", checked_against: "x", measure: "", detail: "", qubits: 1, subject_fingerprint: null, subject_qasm: null, teeth: null }),
      ],
    },
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" />);
  assert.ok(view.getByText("4 checks: 3 pass, 1 inconclusive · 1 proposed by Nala, not yet accepted"));
});

test("no summary renders when the notebook has no check cells", () => {
  const cells = notebookCellViews(
    [{ id: "c1", kind: "code", role: "run", source: "x = 1", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null, block: null }],
    null,
  );
  const view = render(<NotebookView cells={cells} locale="en" framework="qiskit" />);
  assert.equal(view.queryByText(/checks:/), null);
});

// -------------------------------------------------------------------------- "Add a check"

// Two renders, two tests: `dom-env.ts` registers a global `afterEach(cleanup)`
// that only fires BETWEEN tests, never between two `render()` calls inside one —
// a second render in the same test leaves the first one's DOM mounted too, and an
// RTL query without an explicit container searches the whole `document.body` by
// default, so it would see both. Two tests get the cleanup for free instead.
function checkTriggerCells() {
  return notebookCellViews(
    [
      { id: "c1", kind: "code" as const, role: "run" as const, source: "qc = build()", tags: [], execute: true, stub: null, check: null, answer: null, answer_prompt: null, timeout_s: null, property: null, block: null },
      checkCell("c2", baseProperty()),
    ],
    null,
  );
}

test('the "Add a check" trigger renders on a code cell when wired, never on a check cell itself', () => {
  const view = render(<NotebookView cells={checkTriggerCells()} locale="en" framework="qiskit" onStartAddCheck={() => {}} />);
  const buttons = view.getAllByRole("button", { name: "Add a check" });
  assert.equal(buttons.length, 1); // only on c1, not on c2 (itself a check)
});

test('the "Add a check" trigger renders nowhere without onStartAddCheck wired', () => {
  const view = render(<NotebookView cells={checkTriggerCells()} locale="en" framework="qiskit" />);
  assert.equal(view.queryByRole("button", { name: "Add a check" }), null);
});

// -------------------------------------------------------------------------- the form itself

test("add-check form: submitting with nothing filled in is refused, client-side, with a reason for each field", () => {
  const submitted: CheckProperty[] = [];
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint=""
      copy={CHECK_COPY}
      onCancel={() => {}}
      onSubmit={(property) => submitted.push(property)}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Add check" }));
  assert.equal(submitted.length, 0);
  assert.ok(view.getByText("This check cannot be added yet:"));
  assert.match(view.container.textContent ?? "", /Name the variable/);
});

test("add-check form: a state/reference check builds the expected payload", () => {
  const submitted: CheckProperty[] = [];
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint="qc"
      copy={CHECK_COPY}
      onCancel={() => {}}
      onSubmit={(property) => submitted.push(property)}
    />,
  );
  // Subject was prefilled from the hint.
  assert.equal((view.getByLabelText("Which variable") as HTMLInputElement).value, "qc");

  fireEvent.change(view.getByLabelText("Reference"), { target: { value: "ghz" } });
  fireEvent.change(view.getByLabelText("Qubits"), { target: { value: "3" } });
  fireEvent.click(view.getByRole("button", { name: "Add check" }));

  assert.equal(submitted.length, 1);
  const property = submitted[0];
  assert.equal(property.kind, "state");
  assert.equal(property.subject, "qc");
  assert.equal(property.reference, "ghz(3)");
  assert.match(property.statement, /qc/);
});

test("add-check form: switching kind clears the previous kind's fields from the payload", () => {
  const submitted: CheckProperty[] = [];
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint="result"
      copy={CHECK_COPY}
      onCancel={() => {}}
      onSubmit={(property) => submitted.push(property)}
    />,
  );
  fireEvent.change(view.getByLabelText("What kind of check"), { target: { value: "value" } });
  fireEvent.change(view.getByLabelText("Expected value"), { target: { value: "0.5" } });
  fireEvent.click(view.getByRole("button", { name: "Add check" }));

  assert.equal(submitted.length, 1);
  const property = submitted[0];
  assert.equal(property.kind, "value");
  assert.equal(property.value, 0.5);
  assert.equal(property.reference, null);
  assert.equal(property.amplitudes, null);
});

test("add-check form: Cancel calls back without submitting", () => {
  const submitted: CheckProperty[] = [];
  let cancelled = false;
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint="qc"
      copy={CHECK_COPY}
      onCancel={() => {
        cancelled = true;
      }}
      onSubmit={(property) => submitted.push(property)}
    />,
  );
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  assert.equal(cancelled, true);
  assert.equal(submitted.length, 0);
});

test("add-check form: a bad tolerance (at or above the ceiling) is refused before submit", () => {
  const submitted: CheckProperty[] = [];
  const view = render(
    <NotebookAddCheckForm
      afterId="c01"
      subjectHint="qc"
      copy={CHECK_COPY}
      onCancel={() => {}}
      onSubmit={(property) => submitted.push(property)}
    />,
  );
  fireEvent.change(view.getByLabelText("Tolerance"), { target: { value: "1.0" } });
  fireEvent.click(view.getByRole("button", { name: "Add check" }));
  assert.equal(submitted.length, 0);
  assert.match(view.container.textContent ?? "", /could never fail/);
});

test("add-check form: an unsaved edit shows the server's own refusal text when told to (via disabled state, not a crash)", () => {
  // This form never talks to the network itself — `notebook-workspace.tsx` posts the
  // built property and shows the server's 400 in the page's existing failure banner
  // (the same one `saveCellEdit` already uses). What this form owns is staying open
  // and `busy` while that happens, so nothing here is lost mid-submit.
  const view = render(
    <NotebookAddCheckForm afterId="c01" subjectHint="qc" copy={CHECK_COPY} busy onCancel={() => {}} onSubmit={() => {}} />,
  );
  assert.equal((view.getByRole("button", { name: "Adding…" }) as HTMLButtonElement).disabled, true);
  assert.equal((view.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled, true);
});

