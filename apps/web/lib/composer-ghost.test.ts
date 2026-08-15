import assert from "node:assert/strict";
import test from "node:test";
import {
  DELETE_MS_PER_CHARACTER,
  GAP_MS,
  HOLD_MS,
  TYPE_MS_PER_CHARACTER,
  ghostFrame,
} from "./composer-ghost.ts";

const PROMPTS = ["Build a Bell state", "Explain Grover"];

test("no suggestions means no ghost rather than an empty placeholder", () => {
  assert.equal(ghostFrame(0, []), null);
  assert.equal(ghostFrame(0, ["", "   "]), null);
});

// Pins the actual tuning (owner, ai-ops 108: "faster... pause a bit... quick
// deletion... very short pause"). Every other test below derives its expected
// offsets from these same constants, so a retune moves them in lockstep and
// only THIS test catches an accidental change to one of the four numbers.
test("the four timing constants are what the PR body reports", () => {
  assert.equal(TYPE_MS_PER_CHARACTER, 30);
  assert.equal(DELETE_MS_PER_CHARACTER, 12);
  assert.equal(HOLD_MS, 1400);
  assert.equal(GAP_MS, 140);
});

// The qualitative shape the owner asked for, independent of the exact
// numbers: deletion reads as "quick" only if it is meaningfully faster than
// typing, and the gap before the next prompt only reads as "very short" if it
// is meaningfully shorter than the hold on a finished sentence.
test("deletion is faster than typing, and the gap is shorter than the hold", () => {
  assert.ok(DELETE_MS_PER_CHARACTER < TYPE_MS_PER_CHARACTER, "deletion should be quicker than typing");
  assert.ok(GAP_MS < HOLD_MS, "the gap before the next prompt should be shorter than the hold");
});

test("the first frame is empty and the prompt types in", () => {
  assert.equal(ghostFrame(0, PROMPTS)?.text, "");
  const early = ghostFrame(TYPE_MS_PER_CHARACTER * 4, PROMPTS);
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
  const typed = PROMPTS[0].length * TYPE_MS_PER_CHARACTER;
  assert.equal(ghostFrame(typed + 10, PROMPTS)?.text, PROMPTS[0]);
  assert.equal(ghostFrame(typed + HOLD_MS - 10, PROMPTS)?.text, PROMPTS[0]);
});

test("deletion runs backwards to empty", () => {
  const typed = PROMPTS[0].length * TYPE_MS_PER_CHARACTER;
  const deleting = typed + HOLD_MS;
  const midway = ghostFrame(deleting + DELETE_MS_PER_CHARACTER, PROMPTS);
  assert.ok(midway);
  assert.ok(midway.text.length < PROMPTS[0].length, "nothing was deleted");
  assert.ok(PROMPTS[0].startsWith(midway.text), "deletion left something that was never typed");
});

test("phase reports typing, holding, deleting and gap in that order", () => {
  const typing = PROMPTS[0].length * TYPE_MS_PER_CHARACTER;
  const holding = typing + HOLD_MS;
  const deleting = holding + PROMPTS[0].length * DELETE_MS_PER_CHARACTER;
  assert.equal(ghostFrame(10, PROMPTS)?.phase, "typing");
  assert.equal(ghostFrame(typing + 10, PROMPTS)?.phase, "holding");
  assert.equal(ghostFrame(holding + 10, PROMPTS)?.phase, "deleting");
  assert.equal(ghostFrame(deleting + 10, PROMPTS)?.phase, "gap");
});

// This is the whole bug behind ai-ops 108/#94: a caller that falls back to a
// static string whenever `text` is falsy (`ghost?.text || fallback`)
// resurrects exactly the interstitial text the owner asked to have removed,
// because `""` is falsy in JS. The contract here is that `""` IS the correct
// frame during the gap — callers must render it verbatim, not substitute
// anything for it.
test("the gap between prompts is truly empty, not a fallback string", () => {
  const typing = PROMPTS[0].length * TYPE_MS_PER_CHARACTER;
  const deleting = typing + HOLD_MS + PROMPTS[0].length * DELETE_MS_PER_CHARACTER;
  const frame = ghostFrame(deleting + 10, PROMPTS);
  assert.equal(frame?.text, "");
  assert.equal(frame?.phase, "gap");
  assert.equal(frame?.suggestion, PROMPTS[0], "Tab should still accept the prompt that just finished");
});

test("the cycle advances to the next prompt and wraps", () => {
  const cycleMs = (suggestion: string) =>
    suggestion.length * TYPE_MS_PER_CHARACTER + HOLD_MS + suggestion.length * DELETE_MS_PER_CHARACTER + GAP_MS;
  const firstCycle = cycleMs(PROMPTS[0]!);
  assert.equal(ghostFrame(firstCycle + 10, PROMPTS)?.index, 1);
  const secondCycle = cycleMs(PROMPTS[1]!);
  assert.equal(ghostFrame(firstCycle + secondCycle + 10, PROMPTS)?.index, 0);
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
