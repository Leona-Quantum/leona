import assert from "node:assert/strict";
import test from "node:test";
import { thinkingSeed, thinkingWord, thinkingWordCount } from "./thinking-words.ts";

test("the word changes as the wait goes on", () => {
  const first = thinkingWord(0);
  const later = thinkingWord(3000);
  assert.notEqual(first, later);
});

test("every rotating word is reachable and none repeats inside one pass", () => {
  const rotating = thinkingWordCount() - 1;
  const seen = new Set<string>();
  for (let step = 0; step < rotating; step += 1) seen.add(thinkingWord(step * 2600));
  assert.equal(seen.size, rotating);
});

test("a long wait settles on the terminus instead of looping back to the start", () => {
  // Cycling back to "Thinking" after a minute reads as the turn having restarted.
  const terminus = thinkingWord(10 * 60 * 1000);
  assert.equal(thinkingWord(60 * 60 * 1000), terminus);
  assert.notEqual(terminus, thinkingWord(0));
});

test("the seed moves the starting word without escaping the list", () => {
  const words = new Set<string>();
  for (let seed = 0; seed < 40; seed += 1) words.add(thinkingWord(0, "en", seed));
  assert.ok(words.size > 1, "the seed did nothing");
  assert.ok(words.size <= thinkingWordCount() - 1);
});

test("a seed does not skip a turn straight to the terminus", () => {
  // An earlier draft added the seed before clamping, so a high seed printed
  // "Still thinking" on a turn that had just started.
  const terminus = thinkingWord(10 * 60 * 1000);
  for (let seed = 0; seed < 200; seed += 1) {
    assert.notEqual(thinkingWord(0, "en", seed), terminus, `seed ${seed} started at the terminus`);
  }
});

test("Japanese has its own words, not the English ones", () => {
  const ja = thinkingWord(0, "ja");
  assert.notEqual(ja, thinkingWord(0, "en"));
  assert.ok(!/[A-Za-z]/.test(ja), `${ja} is not localised`);
  assert.equal(thinkingWordCount("ja"), thinkingWordCount("en"));
});

test("negative elapsed time is treated as the start", () => {
  assert.equal(thinkingWord(-1), thinkingWord(0));
});

test("the seed is stable and varies between turns", () => {
  assert.equal(thinkingSeed("run-a"), thinkingSeed("run-a"));
  assert.notEqual(thinkingSeed("run-a"), thinkingSeed("run-b"));
  assert.equal(thinkingSeed(null), 0);
});
