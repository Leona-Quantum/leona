import assert from "node:assert/strict";
import test from "node:test";

import {
  capRows,
  DEFAULT_ROW_LIMIT,
  MAX_ROW_LIMIT,
  resolveRowLimit,
  splitCapped,
  ROW_LIMIT_GROWTH,
} from "./repository/browse-page.ts";

/** A row list of `n` distinguishable rows. */
function rows(n: number): string[] {
  return Array.from({ length: n }, (_, index) => `row-${index}`);
}

test("an absent ?rows= is the default cap", () => {
  assert.equal(resolveRowLimit(undefined), DEFAULT_ROW_LIMIT);
});

test("?rows=all is every row", () => {
  assert.equal(resolveRowLimit("all"), "all");
  assert.equal(resolveRowLimit("  all  "), "all");
});

test("a positive integer is the cap it names", () => {
  assert.equal(resolveRowLimit("1"), 1);
  assert.equal(resolveRowLimit("48"), 48);
  assert.equal(resolveRowLimit(" 12 "), 12);
});

test("a cap above the ceiling is clamped rather than honoured", () => {
  assert.equal(resolveRowLimit("999999999"), MAX_ROW_LIMIT);
});

// The whole point of the module's rule. Each of these produced an EMPTY list
// under a control labelled "show more" before `resolveRowLimit` existed.
for (const raw of ["", " ", "0", "-5", "banana", "12.5", "1e9", "all-of-them", "NaN", "Infinity"]) {
  test(`an unrecognised ?rows=${JSON.stringify(raw)} falls back to the default, never to nothing`, () => {
    const limit = resolveRowLimit(raw);
    assert.equal(limit, DEFAULT_ROW_LIMIT);
    assert.ok(capRows(rows(50), limit).shown.length > 0);
  });
}

test("a list shorter than the cap is shown whole and offers nothing more", () => {
  const capped = capRows(rows(5), 24);
  assert.equal(capped.shown.length, 5);
  assert.equal(capped.hidden, 0);
  assert.equal(capped.next, null);
});

test("a list exactly the length of the cap offers nothing more", () => {
  // The off-by-one that shows "show more · 0 hidden".
  const capped = capRows(rows(24), 24);
  assert.equal(capped.shown.length, 24);
  assert.equal(capped.hidden, 0);
  assert.equal(capped.next, null);
});

test('"all" shows every row and offers nothing more', () => {
  const capped = capRows(rows(176), "all");
  assert.equal(capped.shown.length, 176);
  assert.equal(capped.hidden, 0);
  assert.equal(capped.next, null);
});

test("the cap keeps the first rows in order, so the ranking survives it", () => {
  const capped = capRows(rows(100), 3);
  assert.deepEqual(capped.shown, ["row-0", "row-1", "row-2"]);
});

test("shown + hidden is always the whole list", () => {
  for (const total of [0, 1, 23, 24, 25, 47, 48, 176, 283]) {
    for (const limit of [1, 24, 48, 200, "all" as const]) {
      const capped = capRows(rows(total), limit);
      assert.equal(
        capped.shown.length + capped.hidden,
        total,
        `${total} rows at cap ${String(limit)} lost or invented a row`,
      );
    }
  }
});

test("a long remainder doubles the cap", () => {
  // 176 rows at 24: 152 hidden, far more than the 24 a doubling would add, so
  // the next stop is 48 rather than everything.
  const capped = capRows(rows(176), DEFAULT_ROW_LIMIT);
  assert.equal(capped.hidden, 152);
  assert.equal(capped.next, DEFAULT_ROW_LIMIT * ROW_LIMIT_GROWTH);
});

test("a remainder a doubling would cover lands on all rather than on another click", () => {
  // Doubling would land exactly on the end.
  assert.equal(capRows(rows(48), 24).next, "all");
  // Less than that left — the case that used to leave a control that revealed
  // two cards and then had to be pressed again.
  assert.equal(capRows(rows(26), 24).next, "all");
});

test("following next repeatedly terminates, and in few enough presses to be worth it", () => {
  let limit = resolveRowLimit(undefined);
  const total = 176;
  const seen: RowLimitStep[] = [];
  for (let guard = 0; guard < 50; guard += 1) {
    const capped = capRows(rows(total), limit);
    seen.push({ limit, hidden: capped.hidden });
    if (capped.next === null) break;
    limit = capped.next;
  }
  const last = seen[seen.length - 1];
  assert.equal(last.hidden, 0, "the chain never reached a view with nothing held back");
  assert.equal(limit, "all");
  // 24 → 48 → 96 → all: four views, so three presses to everything on today's
  // 176-row corpus. `seen` records the view the reader is looking at, and the
  // last of them is the one where nothing is held back.
  //
  // Pinned because this is the number that decides whether the cap helps or
  // taxes — a fixed 24-row step needed seven, which is worse than the scroll it
  // replaced, and nothing but this assertion would have said so.
  assert.deepEqual(seen.map((step) => step.limit), [24, 48, 96, "all"]);
  assert.ok(seen.length - 1 <= 3, `${seen.length - 1} presses to see the whole list is too many`);
});

interface RowLimitStep {
  limit: number | "all";
  hidden: number;
}

test("the default cap is a real cut against the measured corpus", () => {
  // 176 rows was the finding. This is the assertion that the module did its job
  // at all — a default of 176 would pass every test above and change nothing.
  const capped = capRows(rows(176), DEFAULT_ROW_LIMIT);
  assert.ok(
    capped.shown.length <= 32,
    `default cap shows ${capped.shown.length} rows, which is not a short page`,
  );
  assert.equal(capped.hidden, 176 - DEFAULT_ROW_LIMIT);
});

// ---------------------------------------------------------------------------
// splitCapped — the wiring defect, not the arithmetic one.
//
// The first draft capped the ranked list and rendered the held-out tail in full
// underneath it. `capRows` was correct throughout; what was wrong was that only
// half the page went through it. These pin the half that CI could not see,
// because the corpus holds nothing back today and the section is empty.
// ---------------------------------------------------------------------------

test("a cut inside the first section leaves the second empty, not negative", () => {
  // `slice(-n)` is the bug this guards: a negative take silently returns the
  // LAST rows of the first section, so the tail would render rows that belong
  // to the list above it.
  const { first, second } = splitCapped(rows(10), 24);
  assert.equal(first.length, 10);
  assert.deepEqual(second, []);
});

test("a cut past the first section fills the second with the remainder", () => {
  const shown = rows(30);
  const { first, second } = splitCapped(shown, 24);
  assert.equal(first.length, 24);
  assert.equal(second.length, 6);
  assert.deepEqual([...first, ...second], shown);
});

test("every row is in exactly one section, at every cut point", () => {
  const shown = rows(24);
  for (let firstLength = 0; firstLength <= 40; firstLength += 1) {
    const { first, second } = splitCapped(shown, firstLength);
    assert.deepEqual([...first, ...second], shown, `cut at ${firstLength} lost or reordered a row`);
    assert.equal(
      new Set([...first, ...second]).size,
      shown.length,
      `cut at ${firstLength} rendered a row twice`,
    );
  }
});

test("the two sections together are what the cap governs", () => {
  // The end-to-end shape: ranked + unranked capped as ONE sequence. 20 ranked
  // and 30 unranked at a cap of 24 must show 24 cards, not 24 + 30.
  const ranked = rows(20);
  const unranked = rows(30).map((r) => `un-${r}`);
  const capped = capRows([...ranked, ...unranked], DEFAULT_ROW_LIMIT);
  const { first, second } = splitCapped(capped.shown, ranked.length);
  assert.equal(first.length + second.length, DEFAULT_ROW_LIMIT);
  assert.equal(first.length, 20, "the whole ranked list fits under the cap");
  assert.equal(second.length, 4, "the tail gets only what is left");
  assert.equal(capped.hidden, 26);
  assert.notEqual(capped.next, null, "26 rows are held back, so there must be a way to reach them");
});
