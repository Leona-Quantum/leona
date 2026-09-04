import assert from "node:assert/strict";
import test from "node:test";

import { notebookExportFilename } from "./notebook-export.ts";

test("builds slug-vN.ipynb from a valid slug and sequence", () => {
  assert.equal(notebookExportFilename("bell-state-intro", 3), "bell-state-intro-v3.ipynb");
});

test("falls back to a safe default slug when missing or malformed", () => {
  assert.equal(notebookExportFilename(null, 1), "notebook-v1.ipynb");
  assert.equal(notebookExportFilename("", 1), "notebook-v1.ipynb");
  assert.equal(notebookExportFilename("Not Safe!", 1), "notebook-v1.ipynb");
});

test("falls back to version 1 for a missing or non-positive sequence", () => {
  assert.equal(notebookExportFilename("qaoa-lab", null), "qaoa-lab-v1.ipynb");
  assert.equal(notebookExportFilename("qaoa-lab", 0), "qaoa-lab-v1.ipynb");
  assert.equal(notebookExportFilename("qaoa-lab", -2), "qaoa-lab-v1.ipynb");
});

test("truncates a non-integer sequence rather than embedding a decimal", () => {
  assert.equal(notebookExportFilename("lesson", 2.9), "lesson-v2.ipynb");
});
