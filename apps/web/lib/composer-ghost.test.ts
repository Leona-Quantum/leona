import assert from "node:assert/strict";
import test from "node:test";
import { ghostFrame } from "./composer-ghost.ts";

const PROMPTS = ["Build a Bell state", "Explain Grover"];

test("no suggestions means no ghost rather than an empty placeholder", () => {
  assert.equal(ghostFrame(0, []), null);
  assert.equal(ghostFrame(0, ["", "   "]), null);
});

test("the first frame is empty and the prompt types in", () => {
  assert.equal(ghostFrame(0, PROMPTS)?.text, "");
  const early = ghostFrame(220, PROMPTS);
  assert.equal(early?.text, "Buil");
  assert.equal(early?.suggestion, PROMPTS[0]);
});

test("Tab always accepts the whole prompt, never the characters on screen", () => {
  // The one thing this must not do is insert a truncated question because the
  // user pressed Tab mid-type.
  for (const elapsed of [0, 100, 400, 1500, 3000, 4000]) {
    const frame = ghostFrame(elapsed, PROMPTS);
    assert.ok(frame);
    assert.ok(PROMPTS.includes(frame.suggestion), `${frame.suggestion} is not a real prompt`);
  }
});

test("the prompt is held whole before it is deleted", () => {
  const typed = PROMPTS[0].length * 55;
  assert.equal(ghostFrame(typed + 500, PROMPTS)?.text, PROMPTS[0]);
  assert.equal(ghostFrame(typed + 2100, PROMPTS)?.text, PROMPTS[0]);
});

test("deletion runs backwards to empty", () => {
  const typed = PROMPTS[0].length * 55;
  const deleting = typed + 2200;
  const midway = ghostFrame(deleting + 100, PROMPTS);
  assert.ok(midway);
  assert.ok(midway.text.length < PROMPTS[0].length, "nothing was deleted");
  assert.ok(PROMPTS[0].startsWith(midway.text), "deletion left something that was never typed");
});

test("the cycle advances to the next prompt and wraps", () => {
  const firstCycle = PROMPTS[0].length * 55 + 2200 + PROMPTS[0].length * 22 + 420;
  assert.equal(ghostFrame(firstCycle + 220, PROMPTS)?.index, 1);
  const secondCycle = PROMPTS[1].length * 55 + 2200 + PROMPTS[1].length * 22 + 420;
  assert.equal(ghostFrame(firstCycle + secondCycle + 220, PROMPTS)?.index, 0);
});

test("a negative or absurd timestamp still lands inside the cycle", () => {
  // rAF timestamps are monotonic, but a clock the caller derives some other way
  // need not be, and a ghost that returns undefined text would render "undefined".
  for (const elapsed of [-5000, 0, 10 ** 9]) {
    const frame = ghostFrame(elapsed, PROMPTS);
    assert.ok(frame);
    assert.equal(typeof frame.text, "string");
    assert.ok(frame.suggestion.startsWith(frame.text));
  }
});
