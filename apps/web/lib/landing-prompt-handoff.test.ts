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
/**
 * A decoy, and the point of it: `sessionStorage` is per-tab, so writing the
 * handoff there loses it the moment a signup's verification email opens a new
 * tab — the case this whole feature exists for (ai-ops 102). Every test runs
 * with both stubbed, and the two below fail if the module ever reads this one.
 */
let perTabStorage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  perTabStorage = new MemoryStorage();
  (globalThis as { window?: unknown }).window = { localStorage: storage, sessionStorage: perTabStorage };
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
    get localStorage(): never {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => writeLandingPromptHandoff("anything"));
  assert.equal(consumeLandingPromptHandoff(), null);
});

// ── ai-ops 102: the new-user case this feature was built for ──────────────
//
// The first version of this shipped on `sessionStorage` and every test above
// passed, because they all ran inside one simulated tab. A brand-new signup is
// sent a verification email, and a link clicked in a mail client opens a NEW
// browsing context with its own empty `sessionStorage` — so the returning-user
// path worked and the new-user path silently lost the prompt. These two pin the
// storage choice itself, which is the only thing that was ever wrong.

test("the prompt survives into a NEW tab — the verification-email path", () => {
  writeLandingPromptHandoff("Build a 3-qubit GHZ state and measure it.");

  // A second tab of the same browser: a fresh window with a fresh, empty
  // sessionStorage, but the SAME localStorage instance — which is exactly how
  // the two differ in a real browser.
  (globalThis as { window?: unknown }).window = {
    localStorage: storage,
    sessionStorage: new MemoryStorage(),
  };

  assert.equal(
    consumeLandingPromptHandoff(),
    "Build a 3-qubit GHZ state and measure it.",
    "a prompt typed before signup must reach the workspace even when the tab it was typed in is not the tab that returns",
  );
});

test("nothing is written to per-tab storage — that is what broke the new-user case", () => {
  writeLandingPromptHandoff("Use QAOA to solve MaxCut on a five-node ring.");
  assert.equal(
    perTabStorage.getItem(STORAGE_KEY),
    null,
    "the handoff must not live in sessionStorage; a new tab cannot see it there",
  );
  assert.ok(storage.getItem(STORAGE_KEY), "the handoff should be in localStorage");
});
