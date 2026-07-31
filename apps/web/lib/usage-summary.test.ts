import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeNextSlot, isMetered, parseUsage } from "./usage-summary.ts";

const FULL = {
  tier: "free",
  runs: {
    used: 2,
    limit: 5,
    remaining: 3,
    exhausted: false,
    window_days: 7,
    next_slot_at: "2026-08-03T09:00:00Z",
  },
  artifacts: { used: 4, limit: 25, remaining: 21, exhausted: false },
  workspaces: { used: 1, limit: 3, remaining: 2, exhausted: false },
};

function without(path: [keyof typeof FULL, string]) {
  const clone = structuredClone(FULL) as unknown as Record<string, Record<string, unknown>>;
  delete clone[path[0] as string][path[1]];
  return clone;
}

describe("parseUsage", () => {
  it("reads a well-formed payload", () => {
    const summary = parseUsage(FULL);
    assert.ok(summary);
    assert.equal(summary.tier, "free");
    assert.equal(summary.runs.remaining, 3);
    assert.equal(summary.runs.windowDays, 7);
    assert.equal(summary.runs.nextSlotAt, "2026-08-03T09:00:00Z");
    assert.equal(summary.artifacts.limit, 25);
    assert.equal(summary.workspaces.used, 1);
  });

  it("reads an explicit null limit as unlimited", () => {
    const unmetered = {
      ...FULL,
      tier: "developer",
      runs: {
        used: 40,
        limit: null,
        remaining: null,
        exhausted: false,
        window_days: 7,
        next_slot_at: null,
      },
      artifacts: { used: 900, limit: null, remaining: null, exhausted: false },
      workspaces: { used: 9, limit: null, remaining: null, exhausted: false },
    };
    const summary = parseUsage(unmetered);
    assert.ok(summary);
    assert.equal(summary.runs.limit, null);
    assert.equal(isMetered(summary), false);
  });

  // The point of the file. A missing key and an explicit null are the same
  // `undefined` to a naive read, and one of them means "you have no cap".
  it("refuses a payload whose limit is absent rather than calling it unlimited", () => {
    assert.equal(parseUsage(without(["runs", "limit"])), null);
    assert.equal(parseUsage(without(["artifacts", "limit"])), null);
    assert.equal(parseUsage(without(["workspaces", "limit"])), null);
  });

  it("refuses a payload missing any other field it would have to invent", () => {
    for (const key of ["used", "remaining", "exhausted", "window_days"]) {
      assert.equal(parseUsage(without(["runs", key])), null, `runs.${key} should be required`);
    }
    assert.equal(parseUsage({ ...FULL, tier: 7 }), null);
    assert.equal(parseUsage({ ...FULL, runs: undefined }), null);
  });

  it("refuses non-objects, arrays and error bodies served with a 200", () => {
    assert.equal(parseUsage(null), null);
    assert.equal(parseUsage("free"), null);
    assert.equal(parseUsage([FULL]), null);
    assert.equal(parseUsage({ detail: "Not authenticated" }), null);
  });

  it("refuses a next_slot_at that is not a date", () => {
    const broken = structuredClone(FULL);
    broken.runs.next_slot_at = "soon";
    assert.equal(parseUsage(broken), null);
  });

  it("accepts next_slot_at: null, which is what an unspent allowance sends", () => {
    const unspent = structuredClone(FULL);
    unspent.runs.next_slot_at = null as unknown as string;
    unspent.runs.used = 0;
    unspent.runs.remaining = 5;
    const summary = parseUsage(unspent);
    assert.ok(summary);
    assert.equal(summary.runs.nextSlotAt, null);
  });

  it("refuses NaN and Infinity, which JSON.parse will not produce but a proxy can", () => {
    const nan = structuredClone(FULL) as unknown as Record<string, Record<string, unknown>>;
    nan.runs.used = Number.NaN;
    assert.equal(parseUsage(nan), null);
  });
});

describe("describeNextSlot", () => {
  const NOW = new Date("2026-08-01T12:00:00Z");
  const UTC = "UTC";

  it("names today and tomorrow instead of dating them", () => {
    assert.deepEqual(describeNextSlot("2026-08-01T23:00:00Z", "en", NOW, UTC), {
      relative: true,
      text: "today",
    });
    assert.deepEqual(describeNextSlot("2026-08-02T01:00:00Z", "en", NOW, UTC), {
      relative: true,
      text: "tomorrow",
    });
    assert.equal(describeNextSlot("2026-08-01T23:00:00Z", "ja", NOW, UTC)?.text, "今日");
    assert.equal(describeNextSlot("2026-08-02T01:00:00Z", "ja", NOW, UTC)?.text, "明日");
  });

  it("dates anything further out, and flags it as needing a preposition", () => {
    assert.deepEqual(describeNextSlot("2026-08-05T09:00:00Z", "en", NOW, UTC), {
      relative: false,
      text: "Aug 5",
    });
    assert.deepEqual(describeNextSlot("2026-08-05T09:00:00Z", "ja", NOW, UTC), {
      relative: false,
      text: "8月5日",
    });
  });

  // Two moments 90 minutes apart can be different days; "today" is a calendar
  // question in the reader's zone, not an arithmetic one about elapsed hours.
  it("compares calendar days rather than elapsed hours", () => {
    const lateNight = new Date("2026-08-01T23:30:00Z");
    assert.equal(describeNextSlot("2026-08-02T01:00:00Z", "en", lateNight, UTC)?.text, "tomorrow");
    assert.equal(describeNextSlot("2026-08-01T23:59:00Z", "en", lateNight, UTC)?.text, "today");
  });

  it("returns null for an unparseable date rather than 'Invalid Date'", () => {
    assert.equal(describeNextSlot("not-a-date", "en", NOW, UTC), null);
  });
});
