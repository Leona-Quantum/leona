import assert from "node:assert/strict";
import test from "node:test";

import { cloneWorkedExampleDraft } from "./studio-example-draft.ts";
import { WORKED_EXAMPLES, workedExample } from "./worked-examples.ts";

function allIds(draft: ReturnType<typeof cloneWorkedExampleDraft>): string[] {
  const ids = draft.steps.map((step) => step.id);
  for (const definition of draft.customGates) {
    ids.push(definition.id);
    ids.push(...definition.steps.map((step) => step.id));
  }
  return ids;
}

test("cloning regenerates every id, and two clones of the same example never collide", () => {
  const example = workedExample("ghz-4")!;
  const first = cloneWorkedExampleDraft(example);
  const second = cloneWorkedExampleDraft(example);

  const originalIds = new Set([
    ...example.steps.map((step) => step.id),
    ...example.customGates.flatMap((definition) => [definition.id, ...definition.steps.map((step) => step.id)]),
  ]);
  for (const id of allIds(first)) assert.ok(!originalIds.has(id), `clone reused the example's own id: ${id}`);

  const firstIds = new Set(allIds(first));
  for (const id of allIds(second)) assert.ok(!firstIds.has(id), `two clones of the same example shared an id: ${id}`);
});

test("cloning preserves structure — gate, qubits, param, qubitCount — and only changes ids", () => {
  const example = workedExample("bell-pair")!;
  const draft = cloneWorkedExampleDraft(example);
  assert.equal(draft.qubitCount, example.qubitCount);
  assert.deepEqual(
    draft.steps.map((step) => ({ gate: step.gate, qubits: step.qubits, param: step.param })),
    example.steps.map((step) => ({ gate: step.gate, qubits: step.qubits, param: step.param })),
  );
});

test("notes are remapped onto the cloned top-level steps, in the same order and count", () => {
  for (const example of WORKED_EXAMPLES) {
    const draft = cloneWorkedExampleDraft(example);
    assert.equal(draft.notes.length, example.notes.length, example.id);
    const clonedStepIds = new Set(draft.steps.map((step) => step.id));
    draft.notes.forEach((entry, index) => {
      assert.ok(clonedStepIds.has(entry.stepId), `${example.id}: note ${index} points at a step not in the cloned draft`);
      assert.deepEqual(entry.text, example.notes[index].text, example.id);
    });
  }
});

test("a CUSTOM step's customGateId always resolves inside the same clone, including nested definitions", () => {
  for (const example of WORKED_EXAMPLES) {
    const draft = cloneWorkedExampleDraft(example);
    const definedIds = new Set(draft.customGates.map((definition) => definition.id));
    const checkSteps = (steps: typeof draft.steps, where: string) => {
      for (const step of steps) {
        if (step.gate !== "CUSTOM") continue;
        assert.ok(step.customGateId && definedIds.has(step.customGateId), `${example.id} (${where}): dangling customGateId ${step.customGateId}`);
      }
    };
    checkSteps(draft.steps, "top-level");
    for (const definition of draft.customGates) checkSteps(definition.steps, `inside ${definition.id}`);
  }
});
