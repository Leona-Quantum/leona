import assert from "node:assert/strict";
import test from "node:test";

import {
  courseHasGradableNotebook,
  gradebookColumns,
  gradebookCsvFilename,
  gradebookEntry,
  gradebookMemberName,
  gradebookTotalsPending,
} from "./course-gradebook.ts";
import type { GradebookEntry } from "./course-types.ts";

function entry(moduleId: string, passed: number): GradebookEntry {
  return {
    module_id: moduleId,
    passed,
    failed: 2 - passed,
    attempted: 2,
    graded_cells: 2,
    version_seq: 1,
    stale: false,
    run_id: "run-1",
    graded_at: "2026-09-20T10:00:00Z",
    late: false,
  };
}

test("a member is named the way the members page names them: display name, else email", () => {
  assert.equal(gradebookMemberName({ display_name: "Ana", email: "ana@example.test" }), "Ana");
  assert.equal(gradebookMemberName({ display_name: null, email: "bo@example.test" }), "bo@example.test");
  // A name of only spaces is no name; showing a blank cell would hide who the row is.
  assert.equal(gradebookMemberName({ display_name: "   ", email: "cy@example.test" }), "cy@example.test");
});

test("columns come out in course order whatever order they arrived in", () => {
  const columns = gradebookColumns({
    modules: [
      { id: "b", seq: 2, slug: "b", title: "B", notebook_id: null, graded_cells: null, due_at: null },
      { id: "a", seq: 1, slug: "a", title: "A", notebook_id: "nb", graded_cells: 2, due_at: null },
    ],
  });
  assert.deepEqual(columns.map((column) => column.id), ["a", "b"]);
});

test("a module the member has not been graded on is null, not a zero score", () => {
  const row = { entries: [entry("m1", 0)] };
  assert.equal(gradebookEntry(row, "m1")?.passed, 0);
  assert.equal(gradebookEntry(row, "m2"), null);
  assert.equal(gradebookEntry({ entries: undefined }, "m1"), null);
});

test("the gradebook is offered only once some module has a notebook", () => {
  assert.equal(courseHasGradableNotebook([]), false);
  assert.equal(courseHasGradableNotebook([{ notebook_id: null }, {}]), false);
  assert.equal(courseHasGradableNotebook([{ notebook_id: null }, { notebook_id: "nb-1" }]), true);
});

test("the CSV is saved under the name the control plane gives it", () => {
  assert.equal(gradebookCsvFilename("qiskit-study-group-ab12cd34"), "qiskit-study-group-ab12cd34-gradebook.csv");
});

test("totals pending: a module still generating, one with no notebook, or nothing pending", () => {
  const row = (total: number | null) => ({
    user_id: "u",
    email: "u@example.test",
    display_name: null,
    cohort_name: null,
    entries: [],
    total_passed: 0,
    total_graded_cells: total,
    last_graded_at: null,
  });
  const ready = { id: "a", seq: 1, slug: "a", title: "A", notebook_id: "nb-a", graded_cells: 2, due_at: null };
  const generating = { id: "b", seq: 2, slug: "b", title: "B", notebook_id: "nb-b", graded_cells: null, due_at: null };
  const planned = { id: "c", seq: 3, slug: "c", title: "C", notebook_id: null, graded_cells: null, due_at: null };

  assert.equal(gradebookTotalsPending({ modules: [ready], rows: [row(2)] }), false);
  // "Still being generated" only when a module HAS a notebook that is not ready.
  assert.equal(gradebookTotalsPending({ modules: [ready, generating, planned], rows: [row(null)] }), true);
  // A module nobody has generated is not "being generated".
  assert.equal(gradebookTotalsPending({ modules: [ready, planned], rows: [row(null)] }), true);
  // Every total known (each member was graded on the unknown module): nothing to say.
  assert.equal(gradebookTotalsPending({ modules: [ready, generating], rows: [row(4)] }), false);
});
