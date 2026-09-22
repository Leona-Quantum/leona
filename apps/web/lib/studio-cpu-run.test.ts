import assert from "node:assert/strict";
import test from "node:test";

import { CpuRunSlot } from "./studio-cpu-run.ts";

test("one run at a time: a second start while one is running gets no ticket", () => {
  const slot = new CpuRunSlot();
  const first = slot.begin("artifact-a");
  assert.ok(first);
  assert.equal(slot.busy(), true);
  assert.equal(slot.begin("artifact-a"), null, "a second press of Run starts nothing");
  assert.equal(slot.end(first), true);
  assert.equal(slot.busy(), false);
  assert.ok(slot.begin("artifact-a"), "the slot is free again once the run ends");
});

test("an answer lands only while its run holds the slot and its artifact is on screen", () => {
  const slot = new CpuRunSlot();
  const ticket = slot.begin("artifact-a")!;
  assert.equal(slot.owns(ticket, "artifact-a"), true);
  // Rendered the new artifact, effects not run yet: the answer must not land.
  assert.equal(slot.owns(ticket, "artifact-b"), false);
  assert.equal(slot.owns(ticket, null), false);
});

test("showing another artifact abandons the old run: it owns nothing, and ending it frees nothing", () => {
  const slot = new CpuRunSlot();
  const old = slot.begin("artifact-a")!;
  const abandoned = slot.show("artifact-b");
  assert.equal(abandoned, old, "the caller is told which run to withdraw");
  assert.equal(slot.busy(), false, "the new artifact can be run at once");
  // The old run's answer comes back later, even for the artifact it started on.
  assert.equal(slot.owns(old, "artifact-a"), false);
  assert.equal(slot.owns(old, "artifact-b"), false);

  const fresh = slot.begin("artifact-b")!;
  assert.equal(slot.end(old), false, "the old run's cleanup must not release the new run's busy state");
  assert.equal(slot.busy(), true);
  assert.equal(slot.owns(fresh, "artifact-b"), true);
});

test("showing the same artifact again, or with nothing running, abandons nothing", () => {
  const slot = new CpuRunSlot();
  assert.equal(slot.show("artifact-a"), null);
  const ticket = slot.begin("artifact-a")!;
  assert.equal(slot.show("artifact-a"), null, "a re-render or refresh of the same artifact keeps the run");
  assert.equal(slot.owns(ticket, "artifact-a"), true);
});

test("Studio going away (nothing shown) abandons the run in flight", () => {
  const slot = new CpuRunSlot();
  const ticket = slot.begin("artifact-a")!;
  assert.equal(slot.show(null), ticket);
  assert.equal(slot.owns(ticket, "artifact-a"), false);
});

test("tickets are distinct even for the same artifact, so a finished run's ticket never owns a later run", () => {
  const slot = new CpuRunSlot();
  const first = slot.begin("artifact-a")!;
  slot.end(first);
  const second = slot.begin("artifact-a")!;
  assert.notEqual(first.id, second.id);
  assert.equal(slot.owns(first, "artifact-a"), false);
  assert.equal(slot.end(first), false);
  assert.equal(slot.owns(second, "artifact-a"), true);
});
