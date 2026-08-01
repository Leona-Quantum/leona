import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeNextSlot, formatTokens, isMetered, parseUsage } from "./usage-summary.ts";

/**
 * Copied from an actual `GET /v1/usage` response, not composed by hand — three
 * ledger rows through the real route against real Postgres. A fixture written
 * from the type would agree with the parser and with nothing else.
 */
const SPEND = {
  window_days: 7,
  total: { tokens: 7000, calls: 3 },
  chat: { tokens: 2000, calls: 2 },
  runs: { tokens: 5000, calls: 1 },
  by_model: [
    { tokens: 5000, calls: 1, model: "deepseek-reasoner" },
    { tokens: 2000, calls: 2, model: "deepseek-chat" },
  ],
};

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

describe("parseUsage — the spend block", () => {
  const withSpend = (spend: unknown) => parseUsage({ ...FULL, spend });

  it("reads a real response", () => {
    const summary = withSpend(SPEND);
    assert.ok(summary?.spend);
    assert.equal(summary.spend.total.tokens, 7000);
    assert.equal(summary.spend.chat.calls, 2);
    assert.equal(summary.spend.runs.tokens, 5000);
    assert.equal(summary.spend.windowDays, 7);
    assert.deepEqual(
      summary.spend.byModel.map((entry) => entry.model),
      ["deepseek-reasoner", "deepseek-chat"],
    );
  });

  // The asymmetry that makes this block different from every other field in
  // the payload: the allowances shipped first, and a web deploy that lands
  // before the API's must not blank them.
  it("keeps the allowances when the API sends no spend at all", () => {
    const summary = parseUsage(FULL);
    assert.ok(summary);
    assert.equal(summary.spend, null);
    assert.equal(summary.runs.remaining, 3, "the allowances still parsed");
  });

  it("drops only the spend block when it is malformed, never the allowances", () => {
    for (const broken of [null, "none", [], { total: SPEND.total }]) {
      const summary = withSpend(broken);
      assert.ok(summary, `a bad spend must not fail the whole payload: ${JSON.stringify(broken)}`);
      assert.equal(summary.spend, null);
      assert.equal(summary.artifacts.limit, 25);
    }
  });

  // The panel prints total, chat and runs within a few centimetres of each
  // other. A reader adds them up by eye; if they do not agree the page reads as
  // broken, not the block.
  it("refuses a total that is not the sum of the two lines under it", () => {
    const drifted = structuredClone(SPEND);
    drifted.chat.tokens = 1999;
    assert.equal(withSpend(drifted)?.spend, null);
  });

  it("refuses a call count that does not add up either", () => {
    const drifted = structuredClone(SPEND);
    drifted.runs.calls = 4;
    assert.equal(withSpend(drifted)?.spend, null);
  });

  it("refuses a per-model list that has lost tokens on the way", () => {
    const truncated = structuredClone(SPEND);
    truncated.by_model = [truncated.by_model[0]];
    assert.equal(withSpend(truncated)?.spend, null);
  });

  it("accepts the unattributed row, whose model is the empty string", () => {
    const summary = withSpend({
      window_days: 7,
      total: { tokens: 64, calls: 1 },
      chat: { tokens: 0, calls: 0 },
      runs: { tokens: 64, calls: 1 },
      by_model: [{ tokens: 64, calls: 1, model: "" }],
    });
    assert.equal(summary?.spend?.byModel[0].model, "");
  });

  it("refuses a model entry that is not named", () => {
    const unnamed = structuredClone(SPEND) as unknown as {
      by_model: Record<string, unknown>[];
    };
    delete unnamed.by_model[0].model;
    assert.equal(withSpend(unnamed)?.spend, null);
  });

  it("reports a workspace that has spent nothing as zeroes, not as absent", () => {
    const summary = withSpend({
      window_days: 7,
      total: { tokens: 0, calls: 0 },
      chat: { tokens: 0, calls: 0 },
      runs: { tokens: 0, calls: 0 },
      by_model: [],
    });
    assert.ok(summary?.spend);
    assert.equal(summary.spend.total.tokens, 0);
    assert.deepEqual(summary.spend.byModel, []);
  });
});

describe("formatTokens", () => {
  it("groups rather than abbreviates, so the figure stays comparable", () => {
    assert.equal(formatTokens(1234567, "en"), "1,234,567");
    assert.equal(formatTokens(0, "en"), "0");
  });

  it("uses the reader's locale", () => {
    assert.equal(formatTokens(1234567, "ja"), "1,234,567");
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
