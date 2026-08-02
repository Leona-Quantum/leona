import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  describeNextSlot,
  formatTokens,
  formatUsd,
  isMetered,
  parseUsage,
} from "./usage-summary.ts";

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

/**
 * The two blocks the API had been sending for weeks with nothing reading them.
 *
 * Both are additive in the same sense `spend` is: an older control plane sends
 * neither, and the allowances above them must still render. The difference from
 * `spend` is what a wrong answer costs — `shared_projects` is a cap somebody
 * plans around, and `hardware_spend` is money.
 */
const HARDWARE_UNLIMITED = {
  used_usd: 3.4,
  limit_usd: null,
  remaining_usd: null,
  exhausted: false,
  window_days: 7,
};

describe("parseUsage — shared projects", () => {
  it("reads the allowance, counted per account from both directions", () => {
    const summary = parseUsage({ ...FULL, shared_projects: { used: 2, limit: 4, remaining: 2, exhausted: false } });
    assert.ok(summary);
    // `pressure` is defaulted rather than parsed here: this payload omits it,
    // which is what an API older than 2026-08-03 sends, and the parser must
    // read that as "no warning" rather than as a broken response.
    assert.deepEqual(summary.sharedProjects, {
      used: 2,
      limit: 4,
      remaining: 2,
      exhausted: false,
      pressure: "ok",
    });
  });

  it("reads a null limit as unlimited, the same as every other allowance", () => {
    const summary = parseUsage({
      ...FULL,
      shared_projects: { used: 9, limit: null, remaining: null, exhausted: false },
    });
    assert.equal(summary?.sharedProjects?.limit, null);
  });

  // Free's shared_projects is 0 and that is a real tier value, not a missing
  // one. It has to survive the parse so the panel can say "not part of your
  // plan" rather than printing "0 of 0 used".
  it("keeps a zero limit, which is what a tier that cannot share sends", () => {
    const summary = parseUsage({
      ...FULL,
      shared_projects: { used: 0, limit: 0, remaining: 0, exhausted: true },
    });
    assert.equal(summary?.sharedProjects?.limit, 0);
    assert.equal(summary?.sharedProjects?.exhausted, true);
  });

  it("keeps the allowances when an older API sends no shared_projects at all", () => {
    const summary = parseUsage(FULL);
    assert.ok(summary);
    assert.equal(summary.sharedProjects, null);
    assert.equal(summary.runs.remaining, 3, "the allowances still parsed");
  });

  // Same trap as the runs allowance: a missing `limit` key and an explicit
  // null are the same `undefined`, and one of them means "no cap".
  it("drops the block rather than reading an absent limit as unlimited", () => {
    const summary = parseUsage({ ...FULL, shared_projects: { used: 2, remaining: 2, exhausted: false } });
    assert.ok(summary, "a bad shared_projects must not blank the whole panel");
    assert.equal(summary.sharedProjects, null);
  });
});

describe("parseUsage — hardware spend", () => {
  it("reads the unlimited case, which is what every tier now sends", () => {
    const summary = parseUsage({ ...FULL, hardware_spend: HARDWARE_UNLIMITED });
    assert.ok(summary?.hardwareSpend);
    assert.equal(summary.hardwareSpend.usedUsd, 3.4);
    assert.equal(summary.hardwareSpend.limitUsd, null);
    assert.equal(summary.hardwareSpend.remainingUsd, null);
    assert.equal(summary.hardwareSpend.exhausted, false);
    assert.equal(summary.hardwareSpend.windowDays, 7);
  });

  it("reads a bounded ceiling, because the field stays in the contract", () => {
    const summary = parseUsage({
      ...FULL,
      hardware_spend: { used_usd: 3.4, limit_usd: 25, remaining_usd: 21.6, exhausted: false, window_days: 7 },
    });
    assert.equal(summary?.hardwareSpend?.limitUsd, 25);
    assert.equal(summary?.hardwareSpend?.remainingUsd, 21.6);
  });

  // A zero ceiling is NOT a hardware ban — the API's own docstring says so.
  // Free-queue submissions estimate nothing, count as 0.0 and are never
  // refused on it, so the value has to reach the panel intact.
  it("keeps a zero ceiling, which means free queues only", () => {
    const summary = parseUsage({
      ...FULL,
      hardware_spend: { used_usd: 0, limit_usd: 0, remaining_usd: 0, exhausted: true, window_days: 7 },
    });
    assert.equal(summary?.hardwareSpend?.limitUsd, 0);
    assert.equal(summary?.hardwareSpend?.usedUsd, 0);
  });

  it("keeps the allowances when an older API sends no hardware_spend at all", () => {
    const summary = parseUsage(FULL);
    assert.ok(summary);
    assert.equal(summary.hardwareSpend, null);
    assert.equal(summary.artifacts.limit, 25, "the allowances still parsed");
  });

  it("drops only the block when it is malformed, never the allowances", () => {
    for (const broken of [null, "none", [], { used_usd: 3.4 }, { ...HARDWARE_UNLIMITED, exhausted: "no" }]) {
      const summary = parseUsage({ ...FULL, hardware_spend: broken });
      assert.ok(summary, `a bad hardware_spend must not fail the payload: ${JSON.stringify(broken)}`);
      assert.equal(summary.hardwareSpend, null);
      assert.equal(summary.runs.limit, 5);
    }
  });

  it("drops the block rather than reading an absent limit_usd as unlimited", () => {
    const summary = parseUsage({
      ...FULL,
      hardware_spend: { used_usd: 3.4, remaining_usd: null, exhausted: false, window_days: 7 },
    });
    assert.equal(summary?.hardwareSpend, null);
  });

  // "Unlimited" on one field and a number on the other is not a state the API
  // can produce, and it is exactly what a half-applied deploy would produce.
  it("refuses a limit and a remaining that disagree about being unlimited", () => {
    const half = { ...HARDWARE_UNLIMITED, limit_usd: 25 };
    assert.equal(parseUsage({ ...FULL, hardware_spend: half })?.hardwareSpend, null);
    const other = { ...HARDWARE_UNLIMITED, remaining_usd: 21.6 };
    assert.equal(parseUsage({ ...FULL, hardware_spend: other })?.hardwareSpend, null);
  });

  it("refuses a remaining that is not what the limit minus the spend comes to", () => {
    const drifted = { used_usd: 3.4, limit_usd: 25, remaining_usd: 90, exhausted: false, window_days: 7 };
    assert.equal(parseUsage({ ...FULL, hardware_spend: drifted })?.hardwareSpend, null);
  });

  // The panel prints both figures, and these are floats read back from a
  // Numeric column: 25 - 21.6 is 3.4000000000000004 in IEEE754. A strict
  // equality here would reject every real response.
  it("tolerates the float noise a Numeric column reads back", () => {
    const noisy = {
      used_usd: 25 - 21.6,
      limit_usd: 25,
      remaining_usd: 21.6,
      exhausted: false,
      window_days: 7,
    };
    assert.ok(parseUsage({ ...FULL, hardware_spend: noisy })?.hardwareSpend);
  });

  it("clamps at zero the way the API does, so an overspend still parses", () => {
    const over = { used_usd: 30, limit_usd: 25, remaining_usd: 0, exhausted: true, window_days: 7 };
    assert.equal(parseUsage({ ...FULL, hardware_spend: over })?.hardwareSpend?.remainingUsd, 0);
  });
});

describe("formatUsd", () => {
  // The reason this function exists. `used_usd` is a SUM of floats read back
  // from a Numeric column, and 25.000000000000004 is an ordinary value for it,
  // not a pathological one.
  it("never puts float noise on the screen", () => {
    assert.equal(formatUsd(25.000000000000004, "en"), "$25.00");
    assert.equal(formatUsd(3.4000000000000004, "en"), "$3.40");
  });

  it("always shows two decimals, in both directions", () => {
    assert.equal(formatUsd(3.4, "en"), "$3.40");
    assert.equal(formatUsd(25, "en"), "$25.00");
    assert.equal(formatUsd(0, "en"), "$0.00");
    assert.equal(formatUsd(1234.567, "en"), "$1,234.57");
  });

  // A `remaining` that is really zero can arrive a hair under it. "-$0.00" is
  // not a number anybody should have to interpret.
  it("does not print a negative zero", () => {
    assert.equal(formatUsd(-0.000000001, "en"), "$0.00");
    assert.equal(formatUsd(-0, "en"), "$0.00");
  });

  it("stays in dollars for a Japanese reader, because the charge is in dollars", () => {
    assert.equal(formatUsd(1234.5, "ja"), "$1,234.50");
  });

  // The figure that made the hardware allowance exist: $96,006.30 authorized by
  // a free account before anything compared the estimate to a ceiling.
  it("groups a large figure rather than abbreviating it", () => {
    assert.equal(formatUsd(96006.3, "en"), "$96,006.30");
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

describe("parseUsage — pressure", () => {
  it("carries the server's word through untouched", () => {
    for (const word of ["ok", "approaching", "critical", "exhausted"] as const) {
      const summary = parseUsage({
        ...FULL,
        artifacts: { used: 8, limit: 10, remaining: 2, exhausted: false, pressure: word },
      });
      assert.equal(summary?.artifacts.pressure, word, word);
    }
  });

  // The deploy-window case. Vercel and Cloud Run ship independently, so this app
  // is newer than the control plane for a few minutes on every release. Failing
  // the parse there would blank the whole usage panel; defaulting loses only a
  // warning that did not exist the day before.
  it("defaults to ok when the API is older than the field", () => {
    const summary = parseUsage(FULL);
    assert.ok(summary);
    assert.equal(summary.artifacts.pressure, "ok");
    assert.equal(summary.workspaces.pressure, "ok");
  });

  // A word this app has never heard of has no styling and no sentence, so
  // rendering it would produce an unstyled state rather than a warning.
  it("treats an unrecognised level as absent rather than passing it through", () => {
    const summary = parseUsage({
      ...FULL,
      artifacts: { used: 8, limit: 10, remaining: 2, exhausted: false, pressure: "catastrophic" },
    });
    assert.equal(summary?.artifacts.pressure, "ok");
  });

  it("does not invent a level from used and limit", () => {
    // 95% spent, and the server said nothing. This app must not decide for it:
    // the thresholds live in one place and this is not that place.
    const summary = parseUsage({
      ...FULL,
      artifacts: { used: 95, limit: 100, remaining: 5, exhausted: false },
    });
    assert.equal(summary?.artifacts.pressure, "ok");
  });
});
