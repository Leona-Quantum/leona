// The map's figure arrangement, and the two numbers it exists to move.
//
// D90.8's bar applies: a layout test that passes is not evidence until
// something known-broken fails it. So the assertions here are two-sided —
// overlap is checked by intersecting every pair of boxes, and the *win* is
// checked against the single-column height rather than only against itself,
// because a packer that quietly returned the single column would satisfy every
// no-overlap invariant perfectly.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  FIGURE_GAP,
  MAX_COLUMNS,
  PACK_TARGETS,
  SEARCH_CEILING,
  packBoxVars,
  packFigures,
  packTiers,
  packVarsFor,
  type FigurePack,
  type FigureSize,
} from "./repository/figure-pack.ts";

/**
 * The eight root figures the unfocused map actually draws, read off
 * production's `viewBox` attributes at 1440×900 on 2026-08-24, after leona 721
 * and 732. Pinned as literals rather than laid out here on purpose: this file
 * is about the arrangement, and re-deriving the sizes would make it fail for
 * reasons that have nothing to do with packing.
 */
const LIVE: readonly FigureSize[] = [
  { width: 748.81, height: 258.96 },
  { width: 327.4, height: 73 },
  { width: 408.55, height: 73 },
  { width: 271.36, height: 153.4 },
  { width: 356.91, height: 115 },
  { width: 295.74, height: 379 },
  { width: 208, height: 73 },
  { width: 214, height: 73 },
];

const stackedHeight = (sizes: readonly FigureSize[]) =>
  sizes.reduce((total, size) => total + size.height, 0);

function overlaps(
  sizes: readonly FigureSize[],
  pack: FigurePack,
): { a: number; b: number } | null {
  for (let a = 0; a < sizes.length; a += 1) {
    for (let b = a + 1; b < sizes.length; b += 1) {
      const pa = pack.places[a]!;
      const pb = pack.places[b]!;
      const apart =
        pa.x + sizes[a]!.width <= pb.x ||
        pb.x + sizes[b]!.width <= pa.x ||
        pa.y + sizes[a]!.height <= pb.y ||
        pb.y + sizes[b]!.height <= pa.y;
      if (!apart) return { a, b };
    }
  }
  return null;
}

test("no two figures share a pixel, at either tier", () => {
  for (const target of PACK_TARGETS) {
    const pack = packFigures(LIVE, target);
    assert.equal(
      overlaps(LIVE, pack),
      null,
      `figures overlap in the ${target}px pack`,
    );
  }
  // Mutation check — the invariant above is worth nothing if a layout that
  // stacks everything at the origin also passes it.
  const collapsed: FigurePack = {
    columns: 2,
    width: 749,
    height: 259,
    places: LIVE.map(() => ({ x: 0, y: 0, column: 0 })),
  };
  assert.notEqual(overlaps(LIVE, collapsed), null);
});

test("every figure is inside the box the pack reports", () => {
  for (const target of PACK_TARGETS) {
    const pack = packFigures(LIVE, target);
    for (let i = 0; i < LIVE.length; i += 1) {
      const at = pack.places[i]!;
      assert.ok(at.x >= 0 && at.y >= 0, `figure ${i} placed outside the origin`);
      assert.ok(
        at.x + LIVE[i]!.width <= pack.width + 0.01,
        `figure ${i} runs past the pack's right edge`,
      );
      assert.ok(
        at.y + LIVE[i]!.height <= pack.height + 0.01,
        `figure ${i} runs past the pack's bottom edge`,
      );
    }
  }
});

test("no pack is wider than the target it was fitted to", () => {
  // The whole reason two packs ship instead of one. A pack that overflows its
  // own target hands a reader on that screen a canvas they must pan sideways
  // to finish reading, which is a worse failure than not packing at all.
  for (const target of PACK_TARGETS) {
    const pack = packFigures(LIVE, target);
    assert.ok(
      pack.width <= target,
      `the ${target}px pack came out ${pack.width}px wide`,
    );
  }
});

test("the arrangement is the win it was built for", () => {
  // Complaint (a), as two numbers. Read on production before this landed: the
  // eight figures stacked to 1,198px in a 749px strip against a ~705px canvas.
  // These are floors, not equalities — a figure growing by a pixel must not
  // fail this — but they are close enough to the measured 672 and 495 that a
  // packer which silently degraded to one column cannot pass.
  const stacked = stackedHeight(LIVE);
  assert.ok(stacked > 1190 && stacked < 1210, `figure list changed: ${stacked}`);

  const [narrow, wide] = PACK_TARGETS.map((t) => packFigures(LIVE, t));

  assert.equal(narrow!.columns, 2);
  assert.ok(narrow!.height < stacked * 0.6, `narrow tier only reached ${narrow!.height}`);

  assert.equal(wide!.columns, 3);
  assert.ok(wide!.height < stacked * 0.45, `wide tier only reached ${wide!.height}`);
  // The point of the exercise: one screenful. The canvas is ~705px tall at
  // 900px of browser with the overlay band reserved.
  assert.ok(wide!.height < 705, `the wide pack still scrolls: ${wide!.height}`);
  // And it uses the width it was given rather than leaving two thirds empty.
  assert.ok(wide!.width > 1200, `the wide pack is still a strip: ${wide!.width}`);
});

test("a wider target is never a worse pack", () => {
  // `measure` charges no width and no gap to a column nothing landed in, which
  // is what lets a 3-column search represent the 2-column answer. Without that
  // the wide tier can come back taller than the narrow one — a wider screen
  // getting a worse arrangement, which is the bug this pins.
  let previous = Infinity;
  for (const target of PACK_TARGETS) {
    const pack = packFigures(LIVE, target);
    assert.ok(pack.height <= previous + 0.01, `${target}px regressed to ${pack.height}`);
    previous = pack.height;
  }
});

test("figures in one column keep the graph's order, top to bottom", () => {
  // What survives packing, and it is the half the owner's answer cares about:
  // a column reads downward in the order the graph produced. What is NOT
  // promised — and must not be asserted — is that figure 3 sits right of
  // figure 2; that would be a row wrapper.
  for (const target of PACK_TARGETS) {
    const pack = packFigures(LIVE, target);
    const lastY = new Map<number, number>();
    pack.places.forEach((at, i) => {
      const previousY = lastY.get(at.column);
      if (previousY !== undefined) {
        assert.ok(at.y > previousY, `figure ${i} sits above an earlier figure in its column`);
      }
      lastY.set(at.column, at.y);
    });
  }
});

test("columns are separated by exactly one gap, and so are neighbours in a column", () => {
  const pack = packFigures(LIVE, PACK_TARGETS[1]!);
  const byColumn = new Map<number, number[]>();
  pack.places.forEach((at, i) => {
    const list = byColumn.get(at.column) ?? [];
    list.push(i);
    byColumn.set(at.column, list);
  });
  for (const indices of byColumn.values()) {
    for (let k = 1; k < indices.length; k += 1) {
      const above = indices[k - 1]!;
      const below = indices[k]!;
      const seam = pack.places[below]!.y - (pack.places[above]!.y + LIVE[above]!.height);
      assert.ok(
        Math.abs(seam - FIGURE_GAP) < 0.01,
        `${seam}px between figures ${above} and ${below}, expected ${FIGURE_GAP}`,
      );
    }
  }
  // Columns: each origin is the previous origin plus that column's widest
  // figure plus one gap.
  const originOf = new Map<number, number>();
  const widestOf = new Map<number, number>();
  pack.places.forEach((at, i) => {
    originOf.set(at.column, at.x);
    widestOf.set(at.column, Math.max(widestOf.get(at.column) ?? 0, LIVE[i]!.width));
  });
  const columns = [...originOf.keys()].sort((a, b) => a - b);
  assert.equal(originOf.get(columns[0]!), 0);
  for (let k = 1; k < columns.length; k += 1) {
    const expected = originOf.get(columns[k - 1]!)! + widestOf.get(columns[k - 1]!)! + FIGURE_GAP;
    assert.ok(
      Math.abs(originOf.get(columns[k]!)! - expected) < 0.01,
      `column ${columns[k]} starts at ${originOf.get(columns[k]!)}, expected ${expected}`,
    );
  }
});

test("a column is as wide as its own widest figure, not as the canvas's", () => {
  // Uniform columns — what CSS multi-column would give — cannot fit three
  // columns here at all, because 3 × 749 is 2,247px. This is the property that
  // makes the wide tier possible, so it is asserted rather than assumed.
  const pack = packFigures(LIVE, PACK_TARGETS[1]!);
  const widest = Math.max(...LIVE.map((s) => s.width));
  assert.ok(pack.width < widest * pack.columns, "columns came out uniform-width");
});

test("degenerate inputs return the single column rather than throwing", () => {
  assert.deepEqual(packFigures([], 1440), { columns: 1, width: 0, height: 0, places: [] });

  const one = packFigures([{ width: 300, height: 100 }], 1440);
  assert.equal(one.columns, 1);
  assert.deepEqual(one.places, [{ x: 0, y: 0, column: 0 }]);

  // Wider than the target on its own. Every multi-column candidate overflows,
  // so the single column is the only pack left and it is returned as-is —
  // which is exactly what the CSS falls back to below the breakpoint anyway.
  const huge = packFigures(
    [
      { width: 2000, height: 100 },
      { width: 2000, height: 100 },
    ],
    1440,
  );
  assert.equal(huge.columns, 1);
  assert.equal(huge.width, 2000);
  assert.equal(huge.height, 224);
});

test("the search is exhaustive at the map's size and greedy past the ceiling", () => {
  // The map draws 8 figures, so 3 ** 8 = 6,561 and 4 ** 8 = 65,536 — both
  // inside the ceiling, which is what makes the live answer provably optimal
  // rather than approximately so.
  assert.ok(MAX_COLUMNS ** LIVE.length < SEARCH_CEILING);

  // Past the ceiling the greedy path has to produce a *valid* pack, not just
  // any pack. 20 figures at 4 columns is 1.1e12 candidates, so this exercises
  // the fallback and nothing else.
  const many: FigureSize[] = Array.from({ length: 20 }, (_, i) => ({
    width: 120 + (i % 5) * 30,
    height: 60 + (i % 7) * 20,
  }));
  assert.ok(MAX_COLUMNS ** many.length > SEARCH_CEILING);
  const pack = packFigures(many, 1440);
  assert.equal(overlaps(many, pack), null);
  assert.ok(pack.width <= 1440);
  assert.ok(pack.columns > 1, "the greedy fallback declined to pack at all");
  assert.ok(pack.height < stackedHeight(many));
});

test("the optimum beats the greedy it falls back to", () => {
  // If these two agreed on every input the exhaustive search would be dead
  // weight. On the live figure list at two columns they do not: greedy sends
  // the 379px figure into whichever column is shortest when it arrives, and
  // that is not where it belongs.
  //
  // Reconstructed rather than exported: the pack under test is the optimum, so
  // the comparison is against the greedy assignment computed here by hand.
  const columns = 2;
  const filled = [0, 0];
  const counts = [0, 0];
  const assignment: number[] = [];
  for (const size of LIVE) {
    const best = filled[1]! < filled[0]! ? 1 : 0;
    assignment.push(best);
    filled[best] = filled[best]! + size.height + (counts[best]! > 0 ? FIGURE_GAP : 0);
    counts[best] = counts[best]! + 1;
  }
  const greedyHeight = Math.max(filled[0]!, filled[1]!);
  const optimal = packFigures(LIVE, PACK_TARGETS[0]!);
  assert.equal(optimal.columns, 2);
  assert.ok(
    optimal.height < greedyHeight,
    `optimum ${optimal.height} did not beat greedy ${greedyHeight}`,
  );
});

test("the custom properties carry one pair per tier and match the packs", () => {
  const packs = packTiers(LIVE);
  assert.equal(packs.length, PACK_TARGETS.length);

  const box = packBoxVars(packs);
  packs.forEach((pack, tier) => {
    assert.equal(box[`--pw${tier}`], `${pack.width}px`);
    assert.equal(box[`--ph${tier}`], `${pack.height}px`);
  });

  for (let i = 0; i < LIVE.length; i += 1) {
    const vars = packVarsFor(packs, i);
    assert.equal(Object.keys(vars).length, packs.length * 2);
    packs.forEach((pack, tier) => {
      assert.equal(vars[`--fx${tier}`], `${pack.places[i]!.x}px`);
      assert.equal(vars[`--fy${tier}`], `${pack.places[i]!.y}px`);
    });
  }

  // An index the pack does not hold emits nothing rather than `undefinedpx`.
  assert.deepEqual(packVarsFor(packs, LIVE.length + 3), {});
});

test("the tiers are ordered narrow to wide", () => {
  // `styles.css` writes one media query per tier and relies on the later,
  // wider rule overriding the earlier one. Reversing this array would silently
  // apply the narrow pack on wide screens.
  for (let i = 1; i < PACK_TARGETS.length; i += 1) {
    assert.ok(PACK_TARGETS[i]! > PACK_TARGETS[i - 1]!);
  }
});

test("each tier's breakpoint is wider than the pack it turns on", () => {
  // The one thing that can silently un-do this work: a pack fitted to 1440px
  // applied at 1400px hands the reader a canvas 40px wider than their screen,
  // and it looks fine on the machine it was written on. The breakpoints live
  // in `styles.css` — a media query cannot read a custom property — so the
  // relationship is asserted across the two files rather than trusted.
  //
  // jsdom does no layout, so there is no way to check this by rendering; the
  // same reasoning as `repository-map-overlay-band.test.ts`, which reads the
  // stylesheet for exactly this reason.
  const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const repoRoot = dirname(dirname(webRoot));
  const styles = readFileSync(join(repoRoot, "packages", "ts", "ui", "styles.css"), "utf8");

  // Every media block that positions a packed figure, with the tier it drives
  // taken from the custom property it actually reads rather than from its
  // position in the file — which is what would make this pass after someone
  // reorders the blocks.
  //
  // Brace-matched rather than matched with one regex. A lazy `[\\s\\S]*?` run up
  // to the first `.mj-figure-pack` happily starts at some *earlier* `@media`
  // and swallows everything in between, which is not a hypothetical: it is
  // what the first version of this test did, and it reported the wrong
  // min-width rather than failing.
  const seen = new Set<number>();
  const blocks: { width: number; body: string }[] = [];
  const opener = /@media\s*\(min-width:\s*(\d+)px\)\s*\{/g;
  for (let m = opener.exec(styles); m; m = opener.exec(styles)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < styles.length && depth > 0; i += 1) {
      if (styles[i] === "{") depth += 1;
      else if (styles[i] === "}") depth -= 1;
    }
    assert.equal(depth, 0, "styles.css: unbalanced braces after a media query");
    const body = styles.slice(m.index + m[0].length, i - 1);
    if (body.includes(".mj-figure-pack")) blocks.push({ width: Number(m[1]), body });
  }
  assert.ok(blocks.length > 0, "styles.css: no media block positions .mj-figure-pack");

  for (const { width, body } of blocks) {
    const tier = body.match(/var\(--fx(\d+)\s*[,)]/);
    assert.ok(tier, `a .mj-figure-pack media block reads no --fx<tier>:\n${body}`);
    const index = Number(tier[1]);
    const target = PACK_TARGETS[index];
    assert.ok(target !== undefined, `styles.css drives tier ${index}, which does not exist`);
    assert.ok(
      width > target,
      `tier ${index} is fitted to ${target}px but applies from ${width}px`,
    );
    // And the block must size the container from the same tier, or the figures
    // land in a box built for a different arrangement.
    assert.ok(
      new RegExp(`var\\(--pw${index}\\s*[,)]`).test(body) &&
        new RegExp(`var\\(--ph${index}\\s*[,)]`).test(body),
      `tier ${index}'s media block positions figures it does not size the box for`,
    );
    seen.add(index);
  }
  assert.equal(
    seen.size,
    PACK_TARGETS.length,
    `${PACK_TARGETS.length} tiers are computed, ${seen.size} are applied`,
  );
});
