import assert from "node:assert/strict";
import test from "node:test";
import { nextRevealed, safeCut } from "./stream-smoothing.ts";

const FRAME_MS = 16;

/** Reveal `total` characters from scratch, reporting the frame count and the
 * largest single-frame jump — the two things "chunky" and "slow" actually mean. */
function drain(total: number, settled: boolean): { frames: number; biggestJump: number } {
  let revealed = 0;
  let frames = 0;
  let biggestJump = 0;
  while (revealed < total && frames < 5000) {
    const next = nextRevealed({ revealed, total, deltaMs: FRAME_MS, settled });
    biggestJump = Math.max(biggestJump, next - revealed);
    revealed = next;
    frames += 1;
  }
  return { frames, biggestJump };
}

test("nothing waiting means nothing moves", () => {
  assert.equal(nextRevealed({ revealed: 40, total: 40, deltaMs: FRAME_MS, settled: false }), 40);
});

test("a target that shrank is a replacement, not a rewind", () => {
  // chat.completed carries the provider's final text, which can be shorter than
  // the concatenated deltas. Snapping is the only correct answer here.
  assert.equal(nextRevealed({ revealed: 200, total: 120, deltaMs: FRAME_MS, settled: true }), 120);
});

test("a frame with no elapsed time still advances", () => {
  // Otherwise a browser that coalesces two callbacks onto the same timestamp
  // stalls the reveal permanently.
  assert.equal(nextRevealed({ revealed: 0, total: 10, deltaMs: 0, settled: false }), 1);
});

test("the reveal never runs past the text received", () => {
  assert.equal(nextRevealed({ revealed: 9, total: 10, deltaMs: 5000, settled: false }), 10);
});

test("one worker chunk lands as typing, not as a paragraph appearing", () => {
  // The worker emits 160 characters at a time and that lump is the whole
  // complaint. Both halves matter: it has to take long enough to read as
  // typing, and no single frame may deliver a visible slab of it.
  const { frames, biggestJump } = drain(160, false);
  const seconds = (frames * FRAME_MS) / 1000;
  assert.ok(seconds > 0.3, `too fast to read as typing: ${seconds}s`);
  assert.ok(seconds < 0.9, `too slow: ${seconds}s`);
  assert.ok(biggestJump <= 16, `one frame delivered ${biggestJump} characters`);
});

test("the lag settles at the drain window whatever the model's rate", () => {
  // This is the property a fixed characters-per-second reveal does not have.
  // 900 chars/second is faster than any provider streams; the standing backlog
  // must still converge to roughly LIVE_DRAIN_SECONDS' worth of text.
  const arrivalPerFrame = (900 * FRAME_MS) / 1000;
  let revealed = 0;
  let total = 0;
  for (let frame = 0; frame < 200; frame += 1) {
    total += arrivalPerFrame;
    revealed = nextRevealed({ revealed, total: Math.floor(total), deltaMs: FRAME_MS, settled: false });
  }
  const lagSeconds = (total - revealed) / 900;
  assert.ok(lagSeconds < 0.5, `lag grew to ${lagSeconds}s`);
});

test("a settled answer catches up without making anyone wait", () => {
  // A 20,000-character answer whose stream has closed must not spend seconds
  // animating: the text is known and the reveal is only cosmetic by then.
  const { frames } = drain(20_000, true);
  assert.ok((frames * FRAME_MS) / 1000 < 0.5, `settled reveal took ${frames} frames`);
});

test("a settled answer reveals faster than a live one", () => {
  const live = nextRevealed({ revealed: 0, total: 200, deltaMs: FRAME_MS, settled: false });
  const settled = nextRevealed({ revealed: 0, total: 200, deltaMs: FRAME_MS, settled: true });
  assert.ok(settled > live, `settled ${settled} should outpace live ${live}`);
});

test("the cut backs up to a word boundary rather than splitting a token", () => {
  assert.equal(safeCut("measure the Bell state", 15), "measure the ");
});

test("an unbroken token still advances rather than waiting for a space", () => {
  const blob = "a".repeat(400);
  assert.equal(safeCut(blob, 100).length, 100);
});

test("a fully revealed string is returned whole", () => {
  assert.equal(safeCut("done", 4), "done");
  assert.equal(safeCut("done", 9), "done");
  assert.equal(safeCut("done", 0), "");
});
