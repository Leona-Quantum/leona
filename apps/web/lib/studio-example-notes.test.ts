import assert from "node:assert/strict";
import test from "node:test";

import { activeExampleNoteStepId } from "./studio-example-notes.ts";
import { circuitMoments } from "./circuit-moments.ts";
import { WORKED_EXAMPLES, workedExample } from "./worked-examples.ts";

test("before anything has run, no note is current", () => {
  const example = workedExample("bell-pair")!;
  const { columns } = circuitMoments(example.qubitCount, example.steps);
  assert.equal(activeExampleNoteStepId(example.steps, columns, 0), null);
});

test("the note advances with the playhead, ending on the last step at the end", () => {
  const example = workedExample("bell-pair")!;
  const { columns, count } = circuitMoments(example.qubitCount, example.steps);
  assert.equal(activeExampleNoteStepId(example.steps, columns, 1), example.steps[0].id);
  assert.equal(activeExampleNoteStepId(example.steps, columns, count), example.steps[1].id);
});

test("every worked example resolves a note step id for every moment from 1 to the end", () => {
  for (const example of WORKED_EXAMPLES) {
    const { columns, count } = circuitMoments(example.qubitCount, example.steps);
    for (let moment = 1; moment <= count; moment += 1) {
      const stepId = activeExampleNoteStepId(example.steps, columns, moment);
      assert.ok(stepId, `${example.id} at moment ${moment} resolved no step`);
      assert.ok(example.notes.some((note) => note.stepId === stepId), `${example.id} at moment ${moment}: step ${stepId} has no note`);
    }
  }
});
