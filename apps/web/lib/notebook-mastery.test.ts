import assert from "node:assert/strict";
import test from "node:test";

import { hasMasteryToShow, notebookMastery } from "./notebook-mastery.ts";

type CellRole =
  | "setup" | "objective" | "concept" | "predict" | "run" | "observe" | "explain" | "modify"
  | "checkpoint" | "figure" | "exercise" | "hint" | "solution" | "question" | "answer"
  | "summary" | "references" | "note";

function cell(id: string, role: CellRole | null, kind: "markdown" | "code" = "code") {
  return { id, kind, role, source: "", tags: [] as string[], execute: true, stub: null as string | null, check: null as string | null, answer: null, answer_prompt: null, timeout_s: null as number | null };
}

function result(id: string, status: "ok" | "error" | "skipped" | "not_run") {
  return {
    id,
    status,
    stdout: "",
    stderr: "",
    outputs: [],
    error: status === "error" ? { ename: "AssertionError", evalue: "nope", traceback: [] } : null,
    duration_ms: 1,
    execution_count: 1,
    note: "",
  };
}

const baseReport = {
  notebook_slug: "s",
  ok: true,
  runner: "sandbox" as const,
  duration_ms: 0,
  environment: {},
  dropped_bytes: 0,
  note: "",
};

test("counts checkpoints passed vs total, exercises, and errored cells", () => {
  const cells = [
    cell("m1", "objective", "markdown"),
    cell("c1", "checkpoint"),
    cell("c2", "checkpoint"),
    cell("c3", "exercise"),
    cell("c4", "exercise"),
    cell("c5", "run"),
  ];
  const report = {
    ...baseReport,
    cells: [
      result("c1", "ok"),
      result("c2", "error"),
      result("c5", "error"),
    ],
  };
  const mastery = notebookMastery(cells, report);
  assert.deepEqual(mastery, {
    checkpointsTotal: 2,
    checkpointsPassed: 1,
    exercisesTotal: 2,
    cellsErrored: 2,
  });
});

test("a notebook with no cells yields the all-zero result", () => {
  assert.deepEqual(notebookMastery([], null), {
    checkpointsTotal: 0,
    checkpointsPassed: 0,
    exercisesTotal: 0,
    cellsErrored: 0,
  });
  assert.deepEqual(notebookMastery(null, null), {
    checkpointsTotal: 0,
    checkpointsPassed: 0,
    exercisesTotal: 0,
    cellsErrored: 0,
  });
});

test("a checkpoint with no result yet counts toward the total but not as passed", () => {
  const cells = [cell("c1", "checkpoint")];
  const mastery = notebookMastery(cells, null);
  assert.equal(mastery.checkpointsTotal, 1);
  assert.equal(mastery.checkpointsPassed, 0);
});

test("hasMasteryToShow is false only when there is nothing to report", () => {
  assert.equal(hasMasteryToShow({ checkpointsTotal: 0, checkpointsPassed: 0, exercisesTotal: 0, cellsErrored: 0 }), false);
  assert.equal(hasMasteryToShow({ checkpointsTotal: 1, checkpointsPassed: 0, exercisesTotal: 0, cellsErrored: 0 }), true);
  assert.equal(hasMasteryToShow({ checkpointsTotal: 0, checkpointsPassed: 0, exercisesTotal: 1, cellsErrored: 0 }), true);
  assert.equal(hasMasteryToShow({ checkpointsTotal: 0, checkpointsPassed: 0, exercisesTotal: 0, cellsErrored: 1 }), true);
});
