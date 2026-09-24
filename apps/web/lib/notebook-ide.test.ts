import assert from "node:assert/strict";
import test from "node:test";

import { cellDomId, cellRunChip, notebookOutline, raisedCellIds } from "./notebook-ide.ts";

test("a code cell's chip follows its last result, and an edit since then outranks it", () => {
  const code = { kind: "code" as const, execute: true };
  assert.equal(cellRunChip({ ...code, status: "ok" }), "ran");
  assert.equal(cellRunChip({ ...code, status: "error" }), "raised");
  assert.equal(cellRunChip({ ...code, status: "not_run" }), "not_run");
  assert.equal(cellRunChip({ ...code, status: "ok", edited: true }), "edited");
  assert.equal(cellRunChip({ ...code, status: "error", edited: true }), "edited");
  // Nothing ran, so an edit changes nothing about what the chip can honestly say.
  assert.equal(cellRunChip({ ...code, status: "not_run", edited: true }), "not_run");
  assert.equal(cellRunChip({ ...code, status: "ok", running: true }), "running");
  assert.equal(cellRunChip({ kind: "code", execute: false, status: "skipped" }), "skipped");
  assert.equal(cellRunChip({ kind: "markdown", execute: true, status: "skipped" }), null);
});

test("raised cells come back in notebook order", () => {
  assert.deepEqual(
    raisedCellIds([
      { id: "c3", status: "error" },
      { id: "c1", status: "ok" },
      { id: "c2", status: "error" },
    ]),
    ["c3", "c2"],
  );
  assert.deepEqual(raisedCellIds([]), []);
});

test("cell dom ids are stable and distinct", () => {
  assert.equal(cellDomId("c01"), "mj-notebook-cell-c01");
  assert.notEqual(cellDomId("c01"), cellDomId("c02"));
});

test("the outline reads h1 to h3 from markdown cells only, in order", () => {
  const outline = notebookOutline([
    { id: "m1", kind: "markdown", source: "# Bell states\nIntro text.\n## Why **entanglement** matters" },
    { id: "c1", kind: "code", source: "# Not a heading: this is Python\nqc = QuantumCircuit(2)" },
    { id: "m2", kind: "markdown", source: "### The [Hadamard](https://example.org) gate\n#### Too deep\n####### not a heading" },
    { id: "m3", kind: "markdown", source: "Setext title\n===\n\nSecond part\n---\n" },
  ]);
  assert.deepEqual(outline, [
    { cellId: "m1", level: 1, text: "Bell states" },
    { cellId: "m1", level: 2, text: "Why entanglement matters" },
    { cellId: "m2", level: 3, text: "The Hadamard gate" },
    { cellId: "m3", level: 1, text: "Setext title" },
    { cellId: "m3", level: 2, text: "Second part" },
  ]);
});

test("a heading-shaped line inside a fenced block is code, not a section", () => {
  const outline = notebookOutline([
    { id: "m1", kind: "markdown", source: "## Setup\n```python\n# install qiskit\nx = 1\n```\n## Run it" },
  ]);
  assert.deepEqual(
    outline.map((entry) => entry.text),
    ["Setup", "Run it"],
  );
});

test("heading text keeps underscores inside names and drops closing hashes", () => {
  const outline = notebookOutline([{ id: "m1", kind: "markdown", source: "## Calling `qc_h_gate` twice ##\n# _Emphasis_" }]);
  assert.deepEqual(
    outline.map((entry) => entry.text),
    ["Calling qc_h_gate twice", "Emphasis"],
  );
});

test("a thematic break after a blank line is not a heading", () => {
  assert.deepEqual(notebookOutline([{ id: "m1", kind: "markdown", source: "Text\n\n---\nMore" }]), []);
});
