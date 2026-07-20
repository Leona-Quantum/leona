import assert from "node:assert/strict";
import { test } from "node:test";

import { sampling } from "./studio-run-request.ts";

// `shots` has reached the plan since PR 110 and `seed` since PR 115, and the run
// API has validated both all along. Studio sent neither, so every circuit edited
// there ran at the planner's default shot count with no reproducible seed.

test("a filled form sends both fields", () => {
  assert.deepEqual(sampling("4096", "1729"), { shots: 4096, seed: 1729 });
});

test("a blank seed is omitted, not sent as zero", () => {
  // Zero is a valid seed. Sending it for an empty field would make Studio the
  // thing that invented the value, and the run would report a seed the user
  // never chose.
  assert.deepEqual(sampling("4096", ""), { shots: 4096 });
  assert.deepEqual(sampling("4096", "   "), { shots: 4096 });
});

test("seed zero is sent when it is actually typed", () => {
  assert.deepEqual(sampling("1024", "0"), { shots: 1024, seed: 0 });
});

test("nonsense is omitted rather than sent as NaN", () => {
  assert.deepEqual(sampling("abc", "xyz"), {});
  assert.deepEqual(sampling("12.5", "3.5"), {});
  assert.deepEqual(sampling("-4", "-1"), {});
});

test("a blank shots field lets the planner choose", () => {
  assert.deepEqual(sampling("", "7"), { seed: 7 });
});
