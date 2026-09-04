import assert from "node:assert/strict";
import test from "node:test";

import { notebookProgressFromEvents, type NotebookProgressEvent } from "./notebook-progress.ts";

test("no stage events yet yields an empty list, not a guess", () => {
  const events: NotebookProgressEvent[] = [{ type: "run.queued" }];
  assert.deepEqual(notebookProgressFromEvents(events), []);
});

test("stages appear in first-seen order and carry an elapsed time once finished", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "outline" },
    { type: "stage.finished", stage: "outline", duration_ms: 1500 },
    { type: "stage.started", stage: "draft" },
  ];
  const stages = notebookProgressFromEvents(events);
  assert.deepEqual(stages.map((stage) => stage.id), ["outline", "draft"]);
  assert.equal(stages[0].state, "pass");
  assert.equal(stages[0].elapsed, "1.5 s");
  assert.equal(stages[1].state, "running");
  assert.equal(stages[1].elapsed, undefined);
});

test("sub-second durations render in milliseconds, always with a unit", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "compose" },
    { type: "stage.finished", stage: "compose", duration_ms: 420 },
  ];
  assert.equal(notebookProgressFromEvents(events)[0].elapsed, "420 ms");
});

test("a run that errors mid-stage marks the still-open stage failed", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "outline" },
    { type: "stage.finished", stage: "outline", duration_ms: 100 },
    { type: "stage.started", stage: "sandbox" },
    { type: "run.error" },
  ];
  const stages = notebookProgressFromEvents(events);
  assert.equal(stages.find((stage) => stage.id === "outline")?.state, "pass");
  assert.equal(stages.find((stage) => stage.id === "sandbox")?.state, "fail");
});

test("run.finished with a non-succeeded status also fails the open stage", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "repair" },
    { type: "run.finished", status: "failed" },
  ];
  assert.equal(notebookProgressFromEvents(events)[0].state, "fail");
});

test("a clean run.finished leaves a completed stage passed, not reopened", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "review" },
    { type: "stage.finished", stage: "review", duration_ms: 10 },
    { type: "run.finished", status: "succeeded" },
  ];
  assert.equal(notebookProgressFromEvents(events)[0].state, "pass");
});

test("a repeated stage.started (repair loop) keeps the stage's place in the order", () => {
  const events: NotebookProgressEvent[] = [
    { type: "stage.started", stage: "sandbox" },
    { type: "stage.finished", stage: "sandbox", duration_ms: 200 },
    { type: "stage.started", stage: "repair" },
    { type: "stage.finished", stage: "repair", duration_ms: 300 },
    { type: "stage.started", stage: "sandbox" },
  ];
  const stages = notebookProgressFromEvents(events);
  assert.deepEqual(stages.map((stage) => stage.id), ["sandbox", "repair"]);
  assert.equal(stages[0].state, "running");
});
