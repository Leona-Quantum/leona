// The arithmetic the whole convergence canvas rests on.
//
// These are not "does it render" tests. Every claim the drawing makes — lines
// meet only at circles they both touch, a strand pinches to a point at each end
// and stands at a constant thickness across its belly, a step drawn inside a lane
// sits *on* that lane — is a statement about the handful of functions here, and
// each one is checked against the law it is supposed to obey rather than against
// a stored string. A stored string would pass a mutation that changed the law and
// the emitter together, which is exactly the failure `bowAt` shipped with for two
// sessions.
//
// **The subject changed with R14 and the method did not.** The canvas draws
// ribbons now — tendon, level belly, tendon — rather than plain cubic bows, so
// the shared shape `φ` is a ramp rather than `4t(1−t)`. The three properties
// every invariant on this surface is built from are the same three, and they are
// what this file drives: φ is 0 at both ends, φ ≥ 0 in between, and every line
// over one base uses the *same* φ.
import test from "node:test";
import assert from "node:assert/strict";

import {
  bandOf,
  bandsOverlap,
  bellyOf,
  levelSlices,
  ribbonOutline,
  ribbonPath,
  ribbonY,
  tendonProfile,
  tendonSlope,
  type Level,
  type Ribbon,
} from "./repository/strand-geometry.ts";

/** Half of the hundredth the path emitter rounds to — the most a number may differ by. */
const ROUNDING = 0.005;

const BASE: Level = { x0: 20, x1: 320, y: 100 };

function ribbon(bow: number, run = 40, base: Level = BASE): Ribbon {
  return { x0: base.x0, x1: base.x1, y: base.y, bow, run };
}

/** Sample x's, including both ends, because both ends are where the claims bite. */
function xs(r: Ribbon, count = 60): number[] {
  return Array.from({ length: count + 1 }, (_, i) => r.x0 + ((r.x1 - r.x0) * i) / count);
}

function close(actual: number, expected: number, why: string, tol = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${why}: expected ${expected}, got ${actual} (Δ ${Math.abs(actual - expected)})`,
  );
}

test("φ is zero at both ends, one across the belly, and never leaves [0,1]", () => {
  // The three properties every other claim on this canvas is derived from. Stated
  // here against the profile itself so that nothing downstream has to re-derive
  // them from a drawing.
  for (const run of [0, 1, 16, 40, 110, 150]) {
    const r = ribbon(64, run);
    close(tendonProfile(r, r.x0), 0, `φ at the left circle (run ${run})`);
    close(tendonProfile(r, r.x1), 0, `φ at the right circle (run ${run})`);
    for (const x of xs(r)) {
      const phi = tendonProfile(r, x);
      assert.ok(phi >= 0 && phi <= 1, `φ(${x}) = ${phi} left [0,1] at run ${run}`);
    }
    if (run > 0 && 2 * run < r.x1 - r.x0) {
      close(tendonProfile(r, r.x0 + run), 1, `φ at the left anchor (run ${run})`);
      close(tendonProfile(r, r.x1 - run), 1, `φ at the right anchor (run ${run})`);
      // Flat in between — the whole point of the shape, and the property the
      // owner asked for: *"everything with content horizontal"*.
      for (let i = 0; i <= 20; i += 1) {
        const x = r.x0 + run + ((r.x1 - r.x0 - 2 * run) * i) / 20;
        close(tendonProfile(r, x), 1, `φ inside the belly at ${x} (run ${run})`);
      }
    }
  }
});

test("a belly is level, and it is the only part of a ribbon that is", () => {
  const r = ribbon(70);
  const belly = bellyOf(r);
  assert.equal(belly.y, r.y + r.bow, "the belly sits exactly `bow` off the base");
  assert.equal(belly.x0, r.x0 + r.run);
  assert.equal(belly.x1, r.x1 - r.run);
  for (let i = 0; i <= 20; i += 1) {
    const x = belly.x0 + ((belly.x1 - belly.x0) * i) / 20;
    close(ribbonY(r, x), belly.y, `the belly is level at ${x}`);
  }
  // And the tendons genuinely move: a ribbon that were level throughout would
  // pass every assertion above and be the wrong shape.
  assert.ok(
    Math.abs(ribbonY(r, r.x0 + r.run / 2) - belly.y) > 1,
    "the tendon does not move — the ribbon is flat where it should be climbing",
  );
});

test("two ribbons over one base meet at the ends and nowhere between — the crossing-free claim", () => {
  // D96.2, and the reason nesting needed no new proof. Stated over the ramp,
  // where it was previously stated over `4t(1−t)`: the law does not care which φ
  // it is, only that both lines share one.
  const run = 40;
  for (const [a, b] of [
    [-60, 20],
    [0, 45],
    [12, 13],
    [-8, -7.5],
  ] as const) {
    const ra = ribbon(a, run);
    const rb = ribbon(b, run);
    for (const x of xs(ra, 400)) {
      const gap = ribbonY(rb, x) - ribbonY(ra, x);
      const atEnd = x === ra.x0 || x === ra.x1;
      if (atEnd) close(gap, 0, `two lines must meet at ${x}`);
      else
        assert.ok(
          gap > 0,
          `bows ${a} and ${b} are ${gap} apart at x=${x} — they touch away from a circle`,
        );
    }
  }
});

test("two ribbons with DIFFERENT runs are not a one-parameter family — the reason a row shares one", () => {
  // The failable case behind `runAcross`. Give two siblings their own runs and
  // the separation is no longer `(b₁ − b₂)·φ`: the smaller bow can climb past the
  // larger one inside its own tendon, which is a crossing between two lines that
  // do not touch a circle there. This is what would happen if each lane picked a
  // run from its own bow, which is the obvious implementation.
  const near = { x0: 0, x1: 300, y: 0, bow: 20, run: 10 } satisfies Ribbon;
  const far = { x0: 0, x1: 300, y: 0, bow: 60, run: 120 } satisfies Ribbon;
  const crossed = xs(near, 600).some((x) => ribbonY(near, x) > ribbonY(far, x) + 1e-9);
  assert.ok(
    crossed,
    "two ribbons with different runs stayed ordered — the shared-run rule would then be unnecessary",
  );
});

test("the emitted path is the curve the profile describes", () => {
  // The failure this file exists to prevent, and it has happened: a helper
  // describing a curve three quarters the height of the emitted one, agreeing
  // with itself for two sessions. So the *string* is parsed and sampled, and
  // compared against `tendonProfile`, which is what every invariant elsewhere
  // measures against.
  for (const bow of [-88, -21, 0, 33, 96]) {
    for (const run of [16, 40, 110]) {
      const r = ribbon(bow, run);
      const path = ribbonPath(r);
      const drawn = sampleRibbonPath(path);
      for (const x of xs(r, 120)) {
        close(
          drawn(x),
          ribbonY(r, x),
          `emitted path at x=${x} (bow ${bow}, run ${run})`,
          ROUNDING * 3,
        );
      }
    }
  }
});

test("the outline pinches to a point at both circles and is 2·half thick across the belly", () => {
  // The taper is not drawn on top of the ribbon; it *is* the same φ applied at
  // `bow ± half`. So this is a check that the outline was built from the law
  // rather than from a second shape that resembles it — which is what the strand
  // canvas's bespoke `lensPath` was.
  const half = 9;
  for (const bow of [-40, 0, 55]) {
    const r = ribbon(bow, 40);
    const edges = sampleOutline(ribbonOutline(r, half));
    const belly = bellyOf(r);
    close(edges.upper(r.x0), edges.lower(r.x0), "pinched at the left circle", ROUNDING * 4);
    close(edges.upper(r.x1), edges.lower(r.x1), "pinched at the right circle", ROUNDING * 4);
    for (let i = 1; i < 20; i += 1) {
      const x = belly.x0 + ((belly.x1 - belly.x0) * i) / 20;
      close(
        edges.lower(x) - edges.upper(x),
        2 * half,
        `thickness across the belly at ${x} (bow ${bow})`,
        ROUNDING * 4,
      );
    }
    // Halfway up a tendon the shape is thinner than the belly and thicker than
    // the pinch — a taper, not a step.
    const mid = edges.lower(r.x0 + r.run / 2) - edges.upper(r.x0 + r.run / 2);
    assert.ok(
      mid > 0.05 && mid < 2 * half - 0.05,
      `the tendon is ${mid} thick against a belly of ${2 * half} — it is not tapering`,
    );
  }
});

test("tendonSlope is the steepest the tendon actually gets", () => {
  // `3u² − 2u³` has max derivative 1.5 at u = ½, so the steepest tangent is
  // `1.5·|bow| / run`. Reported rather than capped (R14), which makes it the
  // number the layout's own tendon invariant is written against — so it has to be
  // the truth about the drawn curve and not a convenient formula.
  for (const bow of [-120, -30, 0, 18, 200]) {
    for (const run of [16, 40, 110]) {
      const r = ribbon(bow, run);
      let steepest = 0;
      const step = run / 400;
      for (let x = r.x0; x < r.x0 + run; x += step) {
        steepest = Math.max(steepest, Math.abs(ribbonY(r, x + step) - ribbonY(r, x)) / step);
      }
      const claimed = tendonSlope(r);
      assert.ok(
        steepest <= claimed + 1e-6,
        `bow ${bow} over run ${run} reaches slope ${steepest}, past the claimed ${claimed}`,
      );
      assert.ok(
        steepest >= claimed - 0.02 * Math.max(1, claimed),
        `bow ${bow} over run ${run} claims slope ${claimed} and never gets past ${steepest} — ` +
          `the claim is not the maximum, so an invariant written against it is slack`,
      );
    }
  }
});

test("levelSlices cuts a level range into equal, consecutive, gapless pieces", () => {
  const level: Level = { x0: 40, x1: 340, y: 77 };
  for (const count of [1, 2, 3, 5, 8]) {
    const pieces = levelSlices(level, count);
    assert.equal(pieces.length, count);
    assert.equal(pieces[0]!.x0, level.x0, "the first piece starts where the range does");
    close(pieces[count - 1]!.x1, level.x1, "the last piece ends where the range does");
    for (const [index, piece] of pieces.entries()) {
      assert.equal(piece.y, level.y, "a slice of a level range is level");
      close(
        piece.x1 - piece.x0,
        (level.x1 - level.x0) / count,
        `piece ${index} is not its equal share`,
      );
      if (index > 0) close(piece.x0, pieces[index - 1]!.x1, `piece ${index} leaves a gap`);
    }
  }
});

test("bands overlap in their interiors only — touching is allowed", () => {
  // Two neighbouring strands may share a boundary value without either drawing
  // inside the other, and treating that as a collision would forbid the tightest
  // packing the layout is allowed to use.
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(10, 5)), false, "touching at 5 is not overlap");
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(9.9, 5)), true, "0.1 of interior IS overlap");
  assert.equal(bandsOverlap(bandOf(0, 5), bandOf(0, 1)), true, "contained is overlap");
});

// ---------------------------------------------------------------------------
// Reading the emitted path back, which is the only honest way to check it.
// ---------------------------------------------------------------------------

/**
 * Parse `M … C … L … C …` and return a sampler in x.
 *
 * Written here rather than imported, deliberately: a parser shipped beside the
 * emitter would go wrong with it. This one knows only that SVG path data is
 * commands and numbers, and evaluates the cubics from the definition.
 */
function sampleRibbonPath(d: string): (x: number) => number {
  const segments = parsePath(d);
  return (x: number) => evaluateAt(segments, x);
}

interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Absent on a straight `L`. */
  controls?: [number, number, number, number];
}

function parsePath(d: string): Segment[] {
  const tokens = d.trim().split(/[\s,]+/);
  const out: Segment[] = [];
  let at: [number, number] = [0, 0];
  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index++]!;
    const take = (): number => {
      const value = Number(tokens[index++]);
      assert.ok(Number.isFinite(value), `not a number in path data: ${d}`);
      return value;
    };
    if (command === "M") {
      at = [take(), take()];
    } else if (command === "L") {
      const next: [number, number] = [take(), take()];
      out.push({ x0: at[0], y0: at[1], x1: next[0], y1: next[1] });
      at = next;
    } else if (command === "C") {
      const c1x = take();
      const c1y = take();
      const c2x = take();
      const c2y = take();
      const next: [number, number] = [take(), take()];
      out.push({
        x0: at[0],
        y0: at[1],
        x1: next[0],
        y1: next[1],
        controls: [c1x, c1y, c2x, c2y],
      });
      at = next;
    } else if (command === "Z") {
      // Closes the outline; contributes no sampled span.
    } else {
      assert.fail(`unexpected path command "${command}" in ${d}`);
    }
  }
  return out;
}

/** y of the segment covering `x`. Bisected in t, because x is monotone on each. */
function evaluateAt(segments: readonly Segment[], x: number): number {
  const segment =
    segments.find((s) => x >= Math.min(s.x0, s.x1) && x <= Math.max(s.x0, s.x1)) ??
    segments[segments.length - 1]!;
  if (!segment.controls) {
    const span = segment.x1 - segment.x0;
    const t = span === 0 ? 0 : (x - segment.x0) / span;
    return segment.y0 + (segment.y1 - segment.y0) * t;
  }
  const [c1x, c1y, c2x, c2y] = segment.controls;
  const bez = (a: number, b: number, c: number, d: number, t: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
  // **Direction-aware**, because half of an outline is walked backwards: the
  // lower edge is emitted right-to-left so the shape closes without a winding
  // rule, and a bisection that assumes increasing x converges to the wrong end of
  // those segments. It does so silently — it returns the endpoint's y, which is a
  // real y on the curve — and the first version of this parser reported a 31px
  // gap at a pinch that is exact.
  const rising = segment.x1 >= segment.x0;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 60; step += 1) {
    const mid = (lo + hi) / 2;
    const here = bez(segment.x0, c1x, c2x, segment.x1, mid);
    if (rising ? here < x : here > x) lo = mid;
    else hi = mid;
  }
  return bez(segment.y0, c1y, c2y, segment.y1, (lo + hi) / 2);
}

/**
 * The two edges of a closed outline, as samplers.
 *
 * The outline is emitted as the upper edge forwards then the lower edge
 * backwards, so it splits at the point where x stops increasing.
 */
function sampleOutline(d: string): { upper: (x: number) => number; lower: (x: number) => number } {
  const segments = parsePath(d);
  const turn = segments.findIndex((s, i) => i > 0 && s.x1 < s.x0);
  assert.ok(turn > 0, `outline never turns back: ${d}`);
  const upper = segments.slice(0, turn);
  const lower = segments.slice(turn);
  return {
    upper: (x: number) => evaluateAt(upper, x),
    lower: (x: number) => evaluateAt(lower, x),
  };
}
