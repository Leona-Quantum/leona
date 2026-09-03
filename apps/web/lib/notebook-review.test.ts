import assert from "node:assert/strict";
import test from "node:test";

import { notebookReviewView } from "./notebook-review.ts";

test("no review maps to null, not an empty placeholder", () => {
  assert.equal(notebookReviewView(null), null);
  assert.equal(notebookReviewView(undefined), null);
});

test("findings are mapped with cell_id normalized to cellId, and suggestion defaulted", () => {
  const review = {
    verdict: "needs-attention" as const,
    findings: [
      { cell_id: "c02", severity: "blocker" as const, category: "safety" as const, finding: "unsafe import", suggestion: "remove os.system" },
      { cell_id: null, severity: "nit" as const, category: "style" as const, finding: "inconsistent spacing", suggestion: "" },
    ],
    what_this_notebook_does_not_establish: ["Does not establish hardware behavior."],
  };
  const view = notebookReviewView(review);
  assert.ok(view);
  assert.equal(view?.verdict, "needs-attention");
  assert.equal(view?.findings[0].cellId, "c02");
  assert.equal(view?.findings[0].suggestion, "remove os.system");
  // The second finding has no cell_id (a notebook-wide finding) and no suggestion.
  assert.equal(view?.findings[1].cellId, null);
  assert.equal(view?.findings[1].suggestion, "");
  assert.deepEqual(view?.notEstablished, ["Does not establish hardware behavior."]);
});

test("severityCounts tallies every finding by severity, including zero counts", () => {
  const review = {
    verdict: "ready" as const,
    findings: [
      { cell_id: null, severity: "should-fix" as const, category: "pedagogy" as const, finding: "a", suggestion: "" },
      { cell_id: null, severity: "should-fix" as const, category: "code" as const, finding: "b", suggestion: "" },
      { cell_id: null, severity: "nit" as const, category: "style" as const, finding: "c", suggestion: "" },
    ],
    what_this_notebook_does_not_establish: [],
  };
  const view = notebookReviewView(review);
  assert.deepEqual(view?.severityCounts, { blocker: 0, "should-fix": 2, nit: 1 });
});

test("a review with no findings still returns a view (ready, nothing to show)", () => {
  const review = { verdict: "ready" as const, findings: [], what_this_notebook_does_not_establish: [] };
  const view = notebookReviewView(review);
  assert.ok(view);
  assert.equal(view?.findings.length, 0);
  assert.deepEqual(view?.severityCounts, { blocker: 0, "should-fix": 0, nit: 0 });
});
