import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";

import { consumeLandingPromptHandoff, writeLandingPromptHandoff } from "./landing-prompt-handoff.ts";

const STORAGE_KEY = "majorana.landing-prompt-handoff.v1";
const THIRTY_ONE_MINUTES_MS = 31 * 60 * 1000;

class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { sessionStorage: storage };
});

test("a written prompt is read back once, then gone", () => {
  writeLandingPromptHandoff("Split 6 suppliers into two groups, cutting the fewest links.");
  assert.equal(
    consumeLandingPromptHandoff(),
    "Split 6 suppliers into two groups, cutting the fewest links.",
  );
  assert.equal(consumeLandingPromptHandoff(), null, "a second read must not see the same prompt again");
});

test("blank and whitespace-only input carries nothing", () => {
  writeLandingPromptHandoff("   \n\t  ");
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("blank input clears a prior write rather than leaving it stranded", () => {
  writeLandingPromptHandoff("Pick 8 stocks for the best return at a fixed risk.");
  writeLandingPromptHandoff("   ");
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("a second write overwrites the first outright — no appending, no merge", () => {
  writeLandingPromptHandoff("Build a Bell state and verify the measured distribution.");
  writeLandingPromptHandoff("Use QAOA to solve MaxCut on a five-node ring.");
  assert.equal(consumeLandingPromptHandoff(), "Use QAOA to solve MaxCut on a five-node ring.");
});

test("input longer than the defensive cap is truncated, not rejected", () => {
  writeLandingPromptHandoff("x".repeat(5000));
  const consumed = consumeLandingPromptHandoff();
  assert.ok(consumed);
  assert.equal(consumed!.length, 4000);
});

test("an entry older than the TTL is discarded — the same-tab, long-dormant case", () => {
  // Written directly rather than through writeLandingPromptHandoff, which
  // always stamps `ts` as now — this is exactly the shape a stale write left
  // in sessionStorage from much earlier in the same tab would have.
  storage.setItem(STORAGE_KEY, JSON.stringify({
    text: "Schedule 6 jobs on 3 machines to finish soonest.",
    ts: Date.now() - THIRTY_ONE_MINUTES_MS,
  }));
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("an entry inside the TTL is still returned", () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    text: "Schedule 6 jobs on 3 machines to finish soonest.",
    ts: Date.now() - 1000,
  }));
  assert.equal(consumeLandingPromptHandoff(), "Schedule 6 jobs on 3 machines to finish soonest.");
});

test("consuming an expired entry still clears it — no second chance on a later read", () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({
    text: "stale",
    ts: Date.now() - THIRTY_ONE_MINUTES_MS,
  }));
  assert.equal(consumeLandingPromptHandoff(), null);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("malformed stored JSON reads as absent rather than throwing", () => {
  storage.setItem(STORAGE_KEY, "{not json");
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("a payload missing its shape reads as absent", () => {
  storage.setItem(STORAGE_KEY, JSON.stringify({ text: "no timestamp" }));
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("nothing stored reads as null, not an empty string", () => {
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("storage unavailable (no window) degrades to null/no-op rather than throwing", () => {
  delete (globalThis as { window?: unknown }).window;
  assert.doesNotThrow(() => writeLandingPromptHandoff("anything"));
  assert.equal(consumeLandingPromptHandoff(), null);
});

test("a storage that throws on access is treated as unavailable", () => {
  (globalThis as { window?: unknown }).window = {
    get sessionStorage(): never {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => writeLandingPromptHandoff("anything"));
  assert.equal(consumeLandingPromptHandoff(), null);
});
