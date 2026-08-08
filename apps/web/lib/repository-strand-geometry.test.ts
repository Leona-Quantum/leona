// The arithmetic the whole convergence canvas rests on.
//
// These are not "does it render" tests. Every claim the drawing makes — lines
// meet only at circles they both touch, a strand pinches to a point at each end,
// a step drawn inside a lane sits *on* that lane — is a statement about these
// six functions, and each one is checked here against the law it is supposed to
// obey rather than against a stored string. A stored string would pass a
// mutation that changed the law and the emitter together, which is exactly the
// failure `bowAt` shipped with for two sessions.
import test from "node:test";
import assert from "node:assert/strict";

import {
  bandOf,
  bandsOverlap,
  bowDisplacement,
  controlHeight,
  cubicX,
  cubicY,
  cubicPath,
  levelCubic,
  offsetCubic,
  peakOf,
  pointOn,
  splitCubic,
  splitCubicEven,
  strandOutline,
  type Cubic,
} from "./repository/strand-geometry.ts";

/** Half of the hundredth `cubicPath` rounds to — the most an emitted number may differ by. */
const ROUNDING = 0.005;

/** A deliberately *un*-level base: the case the old inline geometry could not express. */
const SLANTED: Cubic = { x0: 10, y0: 40, x1: 70, y1: 12, x2: 150, y2: 96, x3: 210, y3: 65 };
const LEVEL = levelCubic(20, 320, 100);

/** Parameters to sample at. Includes both ends, because both ends are where the claims bite. */
const TS = [0, 0.05, 0.17, 0.25, 0.33, 0.5, 0.6, 0.75, 0.91, 1];

function close(actual: number, expected: number, why: string, tol = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${why}: expected ${expected}, got ${actual} (Δ ${Math.abs(actual - expected)})`,
  );
}

test("controlHeight is the 4/3 that makes a cubic peak at the bow it was asked for", () => {
  for (const bow of [-90, -12.5, 0, 1, 33, 210]) {
    close(controlHeight(bow), (bow * 4) / 3, `controlHeight(${bow})`);
    // The property the constant exists for, stated independently of the constant.
    close(bowDisplacement(bow, 0.5), bow, `peak displacement for bow ${bow}`);
  }
});

test("offsetCubic displaces by 3k·t(1−t) and by nothing at either end", () => {
  for (const base of [LEVEL, SLANTED]) {
    for (const bow of [-64, -7, 0, 21, 88]) {
      const moved = offsetCubic(base, bow);
      for (const t of TS) {
        const delta = cubicY(moved, t) - cubicY(base, t);
        close(delta, bowDisplacement(bow, t), `displacement at t=${t}, bow=${bow}`);
      }
      // x is untouched, which is what lets two lanes be compared at one x.
      for (const t of TS) close(cubicX(moved, t), cubicX(base, t), `x at t=${t}`);
      close(cubicY(moved, 0), cubicY(base, 0), "start pinned");
      close(cubicY(moved, 1), cubicY(base, 1), "end pinned");
    }
  }
});

test("two offsets of one base meet at the ends and nowhere between — the crossing-free claim", () => {
  const bows = [-54, -18, 0, 18, 54];
  for (const base of [LEVEL, SLANTED]) {
    for (let a = 0; a < bows.length; a += 1) {
      for (let b = a + 1; b < bows.length; b += 1) {
        const one = offsetCubic(base, bows[a]!);
        const two = offsetCubic(base, bows[b]!);
        close(cubicY(one, 0), cubicY(two, 0), "shared start");
        close(cubicY(one, 1), cubicY(two, 1), "shared end");
        for (const t of TS) {
          if (t === 0 || t === 1) continue;
          const gap = cubicY(one, t) - cubicY(two, t);
          assert.ok(
            Math.abs(gap) > 1e-9,
            `bows ${bows[a]} and ${bows[b]} touch at t=${t} — they must not`,
          );
          // Strictly ordered, so the fan never folds over itself either.
          assert.ok(gap < 0, `bow ${bows[a]} must stay above bow ${bows[b]} at t=${t}`);
        }
      }
    }
  }
});

test("splitCubic is exact: each half reproduces the parent over its own parameter range", () => {
  for (const base of [LEVEL, SLANTED]) {
    for (const at of [0.2, 0.5, 0.77]) {
      const [head, tail] = splitCubic(base, at);
      for (const s of TS) {
        close(cubicX(head, s), cubicX(base, s * at), `head x at s=${s}, split ${at}`, 1e-8);
        close(cubicY(head, s), cubicY(base, s * at), `head y at s=${s}, split ${at}`, 1e-8);
        const global = at + s * (1 - at);
        close(cubicX(tail, s), cubicX(base, global), `tail x at s=${s}, split ${at}`, 1e-8);
        close(cubicY(tail, s), cubicY(base, global), `tail y at s=${s}, split ${at}`, 1e-8);
      }
      // The two halves meet, which is what stops a step chain showing a seam.
      close(head.x3, tail.x0, "halves meet in x");
      close(head.y3, tail.y0, "halves meet in y");
    }
  }
});

test("splitCubicEven cuts at i/count — the renormalisation the tail split needs", () => {
  for (const base of [LEVEL, SLANTED]) {
    for (const count of [1, 2, 3, 4, 7]) {
      const pieces = splitCubicEven(base, count);
      assert.equal(pieces.length, count, `count ${count}`);
      for (const [index, piece] of pieces.entries()) {
        const from = index / count;
        const to = (index + 1) / count;
        close(piece.x0, cubicX(base, from), `piece ${index} starts at ${from}`, 1e-8);
        close(piece.y0, cubicY(base, from), `piece ${index} starts at ${from}`, 1e-8);
        close(piece.x3, cubicX(base, to), `piece ${index} ends at ${to}`, 1e-8);
        close(piece.y3, cubicY(base, to), `piece ${index} ends at ${to}`, 1e-8);
      }
      // Consecutive pieces share a point exactly, not nearly.
      for (let index = 0; index + 1 < pieces.length; index += 1) {
        assert.equal(pieces[index]!.x3, pieces[index + 1]!.x0, `seam ${index} in x`);
        assert.equal(pieces[index]!.y3, pieces[index + 1]!.y0, `seam ${index} in y`);
      }
    }
  }
});

test("splitCubicEven pieces are not bunched — a straight base gives equal x steps", () => {
  // The renormalisation bug does not break the seams; it moves them. A straight
  // level base makes the intended positions obvious, so this is the test that
  // fails if the tail parameter is taken as absolute rather than local.
  const pieces = splitCubicEven(levelCubic(0, 300, 50), 3);
  close(pieces[0]!.x3, 100, "first cut at a third");
  close(pieces[1]!.x3, 200, "second cut at two thirds");
});

test("pointOn agrees with the boundary the split puts there", () => {
  const bow = 37;
  const spine = offsetCubic(SLANTED, bow);
  const pieces = splitCubicEven(spine, 4);
  for (const [index, piece] of pieces.entries()) {
    const at = pointOn(SLANTED, bow, index / 4);
    close(piece.x0, at.x, `circle ${index} sits on the lane in x`, 1e-8);
    close(piece.y0, at.y, `circle ${index} sits on the lane in y`, 1e-8);
  }
});

test("strandOutline pinches to a point at both ends and is thickest at the middle", () => {
  const bow = 24;
  const half = 9;
  const upper = offsetCubic(SLANTED, bow - half);
  const lower = offsetCubic(SLANTED, bow + half);
  // Both edges start and end on the base's own endpoints — that is the pinch.
  close(cubicY(upper, 0), cubicY(lower, 0), "pinched at the start");
  close(cubicY(upper, 1), cubicY(lower, 1), "pinched at the end");
  close(cubicY(lower, 0.5) - cubicY(upper, 0.5), 2 * half, "thickness at the peak");
  for (const t of [0.1, 0.3, 0.7, 0.9]) {
    const thickness = cubicY(lower, t) - cubicY(upper, t);
    assert.ok(thickness > 0, `thickness stays positive at t=${t}`);
    assert.ok(thickness < 2 * half, `thickness tapers away from the peak at t=${t}`);
  }

  const d = strandOutline(SLANTED, bow, half);
  assert.ok(d.startsWith("M "), "outline starts with a move");
  assert.ok(d.endsWith("Z"), "outline is closed");
  assert.equal(d.split("C").length - 1, 2, "outline is exactly two cubics");

  // Parsed back out of the emitted string, not recomputed beside it.
  //
  // The first draft of this test asserted against `offsetCubic` results it had
  // built itself, and a mutation replacing one of the two edges with the
  // untapered spine survived it untouched: every number the test looked at was
  // still right, because the test never looked at the path. A layout assertion
  // that does not read the drawn `d` cannot see what was drawn.
  const emitted = parsePath(d);
  const upperEdge = offsetCubic(SLANTED, bow - half);
  const lowerEdge = offsetCubic(SLANTED, bow + half);
  close(emitted.move.y, upperEdge.y0, "outline leaves the shared start", ROUNDING);
  close(emitted.curves[0]!.c1y, upperEdge.y1, "upper edge control 1 carries −half", ROUNDING);
  close(emitted.curves[0]!.c2y, upperEdge.y2, "upper edge control 2 carries −half", ROUNDING);
  close(emitted.curves[0]!.ey, upperEdge.y3, "upper edge reaches the shared end", ROUNDING);
  // The return edge is emitted reversed, so its controls appear in the other
  // order — that is what makes the outline one continuous subpath.
  close(emitted.curves[1]!.c1y, lowerEdge.y2, "lower edge control 2 comes first", ROUNDING);
  close(emitted.curves[1]!.c2y, lowerEdge.y1, "lower edge control 1 comes second", ROUNDING);
  close(emitted.curves[1]!.ey, lowerEdge.y0, "outline closes back on the shared start", ROUNDING);
  assert.notEqual(
    Math.round(emitted.curves[0]!.c1y * 100),
    Math.round(emitted.curves[1]!.c2y * 100),
    "the two edges must not be the same curve — that is a line, not a strand",
  );
});

/**
 * The emitted path, read back as numbers.
 *
 * Deliberately strict about the shape it accepts: it is checking a string this
 * module produced, and a looser parser would quietly tolerate an outline that
 * had stopped being `M … C … C … Z`.
 */
function parsePath(d: string): {
  move: { x: number; y: number };
  curves: { c1x: number; c1y: number; c2x: number; c2y: number; ex: number; ey: number }[];
} {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  assert.equal(numbers.length, 14, `expected 2 + 6 + 6 numbers, got ${numbers.length} in ${d}`);
  return {
    move: { x: numbers[0]!, y: numbers[1]! },
    curves: [
      { c1x: numbers[2]!, c1y: numbers[3]!, c2x: numbers[4]!, c2y: numbers[5]!, ex: numbers[6]!, ey: numbers[7]! },
      { c1x: numbers[8]!, c1y: numbers[9]!, c2x: numbers[10]!, c2y: numbers[11]!, ex: numbers[12]!, ey: numbers[13]! },
    ],
  };
}

test("peakOf is the point strandOutline is thickest at", () => {
  const at = peakOf(SLANTED, 31);
  close(at.x, cubicX(SLANTED, 0.5), "peak x");
  close(at.y, cubicY(SLANTED, 0.5) + 31, "peak y is the base plus the bow");
});

test("cubicPath rounds to a hundredth and names all four points", () => {
  const d = cubicPath({ x0: 1.234, y0: 2, x1: 3, y1: 4, x2: 5, y2: 6, x3: 7, y3: 8 });
  assert.equal(d, "M 1.23 2 C 3 4, 5 6, 7 8");
});

test("bands overlap in their interiors only — touching is allowed", () => {
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(10, 5)), false, "abutting bands do not overlap");
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(9, 5)), true, "one pixel of shared interior counts");
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(0, 1)), true, "a band inside another overlaps it");
  assert.deepEqual(bandOf(12, 4), { lo: 8, hi: 16 });
});
