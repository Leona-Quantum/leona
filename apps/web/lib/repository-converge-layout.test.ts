// The convergence layout, and the one property the whole picture rests on.
//
// D96.2 replaced the old rule with: **two process lines may share space only at
// a state circle they both genuinely touch, and nowhere else.** That is asserted
// here numerically over sampled points rather than argued in a comment, and it
// is mutation-tested — a straight-line layout and a layout whose bows are not a
// one-parameter family both have to fail it, or the assertion is decorative.
//
// D90.8's bar applies and is the reason this file samples: a layout test that
// passes is not evidence until something known-broken fails it.
import assert from "node:assert/strict";
import test from "node:test";

import {
  CONVERGE_DEPTH_MAX,
  CONVERGE_METRICS,
  CONVERGE_OPEN_MAX,
  resolveOpenIds,
  convergingSlots,
  crossingsAt,
  drawableSlots,
  allocateBows,
  allocateBowsAroundSpine,
  chainColumnNeed,
  laneOffsets,
  reservedHalfHeight,
  tendonRunFor,
  runAcross,
  layoutConverge,
  legendMark,
  type ConvergeDiagram,
  type ConvergeLane,
} from "./repository/converge-layout.ts";
import type { LayerGraph } from "./repository/layers.ts";
import { PATH_LIMITS, expansionOf, methodFanOf } from "./repository/state-graph.ts";
import { estimateTextWidth } from "./repository/process-layout.ts";
import {
  isCapability,
  layerNode,
  methodsRealizing,
  rootCapabilities,
  type LayerCapability,
} from "./repository/layers.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import type { StateVocabulary } from "./repository/states.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import type { PublicLocale } from "./public-locale.ts";

const M = CONVERGE_METRICS;
const EPS = 1e-6;

function diagramFor(id: string, locale: PublicLocale = "en"): ConvergeDiagram {
  const node = layerNode(LAYER_GRAPH, id);
  assert.ok(node && isCapability(node), `${id} is not a capability`);
  return layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus: node,
    locale,
  });
}

/**
 * Lanes grouped by the pair of circles they run between **and their depth**.
 *
 * The depth is not fussiness. An odd fan puts one child straight through the
 * middle of the strand it came out of — the owner's *"the original process line
 * should be faint but remain in the middle"* — so a parent's spine and that
 * child's spine are the same curve on purpose. Comparing them would fail the
 * separation claim for the one reason the picture is right. Siblings share a
 * span and a depth, and siblings are what must stay apart.
 */
function siblingsOf(diagram: ConvergeDiagram): ConvergeLane[][] {
  const buckets = new Map<string, ConvergeLane[]>();
  for (const lane of diagram.lanes) {
    const key = `${lane.x0}>${lane.x1}#${lane.depth}`;
    const list = buckets.get(key) ?? [];
    list.push(lane);
    buckets.set(key, list);
  }
  return [...buckets.values()];
}

/** Lanes grouped by the pair of circles they run between. */
function bundlesOf(diagram: ConvergeDiagram): ConvergeLane[][] {
  const bySpan = new Map<string, ConvergeLane[]>();
  for (const lane of diagram.lanes) {
    const key = `${lane.x0}>${lane.x1}`;
    const list = bySpan.get(key) ?? [];
    list.push(lane);
    bySpan.set(key, list);
  }
  return [...bySpan.values()];
}

// --- the convergence itself -------------------------------------------------

test("a state on several routes is ONE circle, not one per route", () => {
  // The whole point. The old canvas drew `nonlinear-ivp` four times,
  // `linear-ivp` three times and `solution-answer` three times on this exact
  // figure — read off the live page 2026-08-08.
  const diagram = diagramFor("nonlinear-ode-solve");
  // Scoped to the figure's own level, because there is now a second level.
  //
  // A circle at depth 0 is an object of the *figure*: every way across passes
  // through it, and drawing it twice would be the exact defect this surface was
  // built to fix. A circle deeper than that is an object inside one particular
  // way across — the thing one step of that route hands to the next — and it is
  // no more a duplicate of anything than a step is a duplicate of the lane it is
  // a step of. The claim is therefore about depth 0, and it is stronger stated
  // that way than it was when depth 0 was all there was.
  const outer = diagram.states.filter((state) => state.depth === 0).map((state) => state.stateId);
  assert.deepEqual(
    outer,
    ["nonlinear-ivp", "linear-ivp", "solution-answer"],
    "three circles, one per state in the denominator chain",
  );
  assert.equal(new Set(outer).size, outer.length, "no state is drawn twice");
  // And the deeper one that does appear is the object inside the run of two
  // hops, which this figure draws as a chain because it is one.
  const inner = diagram.states.filter((state) => state.depth > 0);
  assert.deepEqual(
    inner.map((state) => state.stateId),
    ["linear-system"],
    "the run of two hops names the object it hands on halfway",
  );
  for (const state of inner) {
    assert.ok(state.r < CONVERGE_METRICS.stateRadius, "an inner object is drawn smaller");
  }
});

test("the shared circle is the one everything converges on, and it says so", () => {
  const diagram = diagramFor("nonlinear-ode-solve");
  const shared = diagram.states.find((state) => state.stateId === "linear-ivp");
  assert.ok(shared);
  assert.equal(shared.terminal, false);
  assert.ok(shared.arriving >= 2, `only ${shared.arriving} lanes arrive`);
  assert.ok(shared.leaving >= 2, `only ${shared.leaving} lanes leave`);
});

/**
 * The endpoints of the path that is actually drawn, read out of `d`.
 *
 * Not `lane.x0`/`lane.x1`. Those are the layout's *intent*; `d` is what the
 * renderer puts on the page, and a mutation that dog-legged the path 12px out of
 * the hub passed every assertion in this file until this parser existed — the
 * fields still said the lane started on the circle while the drawn curve did
 * not. A geometric test that measures the metadata instead of the geometry
 * cannot see a renderer drift away from it.
 */
interface Segment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Absent on a straight `L` — the belly, and the two joins of an outline. */
  controls?: [number, number, number, number];
}

/**
 * The emitted `d`, parsed into segments.
 *
 * **A ribbon, not a cubic, since R14**: `M … C … L … C …`. The old parser
 * demanded a single cubic and asserted on anything else, which is the right
 * shape of parser to have had — it would have failed loudly rather than
 * silently measuring the wrong thing.
 *
 * This is a second, independent reading of the emitter, and it stays that way on
 * purpose. `repository-strand-geometry.test.ts` has its own; the two are not
 * shared, because a parser shipped beside the thing it parses goes wrong with it,
 * and a test that measures with the code under test measures nothing. Both know
 * only that path data is commands and numbers.
 */
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
      out.push({ x0: at[0], y0: at[1], x1: next[0], y1: next[1], controls: [c1x, c1y, c2x, c2y] });
      at = next;
    } else if (command === "Z") {
      // Closes an outline; contributes no span to sample.
    } else {
      assert.fail(`unexpected path command "${command}" in ${d}`);
    }
  }
  assert.ok(out.length > 0, `empty path: ${d}`);
  return out;
}

/** y of the drawn path at x. Bisected in t, direction-aware — see the outline. */
function drawnYAt(segments: readonly Segment[], x: number): number {
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

/** The drawn curve, ready to sample. Parse the artifact, sample the artifact. */
function drawn(d: string): { segments: Segment[]; x0: number; x1: number } {
  const segments = parsePath(d);
  return { segments, x0: segments[0]!.x0, x1: segments[segments.length - 1]!.x1 };
}

/**
 * A point on the drawn path at `t` — the fraction of the way **along x**.
 *
 * The same parameterisation the old cubic sampler had, and for a reason rather
 * than for convenience: a lane's x controls sat at exact thirds, so `x(t)` was
 * linear and the Bézier parameter *was* the fraction along x. A ribbon's x is
 * piecewise but still monotone and still spans the same range, so every call
 * site that asked for "the point a quarter of the way across" still gets it.
 */
function pointOn(path: ReturnType<typeof drawn>, t: number): [number, number] {
  const x = path.x0 + (path.x1 - path.x0) * t;
  return [x, drawnYAt(path.segments, x)];
}

/** Two numbers that must be the same number, not merely near each other. */
function close(actual: number, expected: number, why: string, tol = 0.02): void {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${why}: expected ${expected}, got ${actual} (Δ ${Math.abs(actual - expected).toFixed(4)})`,
  );
}

function drawnEnds(d: string): { sx: number; sy: number; ex: number; ey: number } {
  const path = drawn(d);
  const first = path.segments[0]!;
  const last = path.segments[path.segments.length - 1]!;
  return { sx: first.x0, sy: first.y0, ex: last.x1, ey: last.y1 };
}

test("every number a lane reports is the number it draws", () => {
  // The fields and the emitter are two expressions of one shape, and they have
  // drifted before — by a factor of 4/3, for two sessions, agreeing with
  // themselves the whole time. So every number a lane *reports* is checked
  // against the path it *draws*, on **every** lane at every depth. That is
  // stronger than the check this replaced, which had to skip nested lanes:
  // a nested strand used to sit on a parent's curve, whose law `bowAt` did not
  // describe. A ribbon's base is level all the way down, so there is no longer
  // a case this cannot reach.
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const lane of diagramFor(focus.id).lanes) {
      const path = drawn(lane.d);
      const ends = drawnEnds(lane.d);
      close(ends.sx, lane.x0, `${lane.key}: drawn start x against x0`);
      close(ends.ex, lane.x1, `${lane.key}: drawn end x against x1`);
      close(ends.sy, lane.yc, `${lane.key}: drawn start y against yc`);
      close(ends.ey, lane.yc, `${lane.key}: drawn end y against yc`);
      close(lane.bellyX0, lane.x0 + lane.run, `${lane.key}: bellyX0 against x0 + run`);
      close(lane.bellyX1, lane.x1 - lane.run, `${lane.key}: bellyX1 against x1 − run`);
      close(lane.bellyY, lane.yc + lane.bow, `${lane.key}: bellyY against yc + bow`);
      // The belly is level, at exactly `bow` off the base, over its whole run.
      // This is the property the owner asked the shape for and the one every
      // label placement on this canvas now assumes.
      for (let step = 0; step <= 20; step += 1) {
        const x = lane.bellyX0 + ((lane.bellyX1 - lane.bellyX0) * step) / 20;
        close(
          drawnYAt(path.segments, x),
          lane.bellyY,
          `${lane.key}: the belly is not level at x=${x}`,
          0.05,
        );
      }
    }
  }
});

test("a belly sits exactly `bow` off the base, and the canvas reserves that much", () => {
  // Two claims, and the second is the one a bigger fan would break first.
  //
  // `controlHeight` exists so the drawn peak equals `bow` rather than 3/4 of it.
  // And `halfHeight` must reserve from that true peak: it read `(tallest*3)/4`
  // while the emitter already scaled by 4/3. On today's two-lane fans the 34px
  // margin absorbed the shortfall, so nothing left the canvas and the sampling
  // test could not see it — the reservation has to be asserted directly, or the
  // defect waits for the first fan wide enough to expose it.
  const M2 = CONVERGE_METRICS;
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const lane of diagram.lanes) {
      // Every depth now, where this had to skip nested lanes: a ribbon's base
      // is level all the way down, so the middle of a lane's drawn belly is
      // comparable with `yc + bow` whatever it is nested inside.
      const middle = pointOn(drawn(lane.d), 0.5)[1] - lane.yc;
      assert.ok(
        Math.abs(middle - lane.bow) < 0.05,
        `${lane.key}: bow is ${lane.bow} but the drawn belly sits at ${middle}`,
      );
    }
    const tallest = Math.max(
      ...diagram.lanes.filter((lane) => lane.depth === 0).map((lane) => Math.abs(lane.bow)),
      0,
    );
    assert.ok(
      reservedHalfHeight(tallest) >= tallest + M2.labelLift + M2.laneFont + M2.stateRadius,
      "the reservation must start from the true peak, not a fraction of it",
    );
    const need = tallest + M2.labelLift + M2.laneFont + M2.stateRadius;
    const yc = diagram.lanes.find((lane) => lane.depth === 0)?.yc ?? 0;
    assert.ok(yc >= need, `${focus.id}: reserved ${yc} above the spine, the fan needs ${need}`);
    assert.ok(
      diagram.height - yc >= need,
      `${focus.id}: reserved ${diagram.height - yc} below the spine, the fan needs ${need}`,
    );
  }
});

test("the canvas reserves the height the fan actually reaches", () => {
  // `halfHeight` reserved (tallest*3)/4 while the emitter already scaled by 4/3,
  // so the outermost lane overshot its own canvas.
  for (const locale of ["en", "ja"] as const) {
    for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      const diagram = diagramFor(focus.id, locale);
      for (const lane of diagram.lanes) {
        const cubic = drawn(lane.d);
        for (let step = 0; step <= 40; step += 1) {
          const [x, y] = pointOn(cubic, step / 40);
          assert.ok(y >= 0 && y <= diagram.height, `${lane.key} leaves the canvas at y=${y}`);
          assert.ok(x >= 0 && x <= diagram.width, `${lane.key} leaves the canvas at x=${x}`);
        }
      }
    }
  }
});

test("every lane's DRAWN path begins and ends exactly on a circle centre", () => {
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    const centres = new Set(diagram.states.map((state) => `${state.cx},${state.cy}`));
    for (const lane of diagram.lanes) {
      // A lane of the figure's own bundles runs circle to circle. A nested one
      // runs from a point on its parent to another point on its parent, which is
      // the next test — and which is what makes a step drawn inside a lane sit
      // *on* that lane rather than beside it.
      if (lane.depth > 0) continue;
      // The declared endpoints must be circle centres...
      assert.ok(
        centres.has(`${lane.x0},${lane.yc}`),
        `${focus.id}/${lane.key} starts off-circle at ${lane.x0},${lane.yc}`,
      );
      assert.ok(centres.has(`${lane.x1},${lane.yc}`), `${focus.id}/${lane.key} ends off-circle`);

      // ...and the path that gets rendered must agree with them.
      const ends = drawnEnds(lane.d);
      assert.ok(
        Math.abs(ends.sx - lane.x0) < 0.01 && Math.abs(ends.sy - lane.yc) < 0.01,
        `${focus.id}/${lane.key}: drawn start (${ends.sx},${ends.sy}) is not the hub (${lane.x0},${lane.yc})`,
      );
      assert.ok(
        Math.abs(ends.ex - lane.x1) < 0.01 && Math.abs(ends.ey - lane.yc) < 0.01,
        `${focus.id}/${lane.key}: drawn end (${ends.ex},${ends.ey}) is not the hub (${lane.x1},${lane.yc})`,
      );
      assert.ok(centres.has(`${ends.sx},${ends.sy}`), `${lane.key}: drawn start is not a circle`);
      assert.ok(centres.has(`${ends.ex},${ends.ey}`), `${lane.key}: drawn end is not a circle`);
    }
  }
});

// --- the crossing-free property ---------------------------------------------

test("two lanes of one bundle touch at both ends and are apart everywhere between", () => {
  // The invariant, sampled. Separation must be exactly zero at t=0 and t=1 —
  // that is the shared circle, the one sanctioned contact — and strictly
  // positive at every interior sample.
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const bundle of bundlesOf(diagram)) {
      for (let i = 0; i < bundle.length; i += 1) {
        for (let j = i + 1; j < bundle.length; j += 1) {
          const a = bundle[i]!;
          const b = bundle[j]!;
          const ca = drawn(a.d);
          const cb = drawn(b.d);
          assert.equal(pointOn(ca, 0)[1], pointOn(cb, 0)[1], "must meet at the start");
          assert.equal(pointOn(ca, 1)[1], pointOn(cb, 1)[1], "must meet at the end");
          for (let step = 1; step < 40; step += 1) {
            const t = step / 40;
            const gap = Math.abs(pointOn(ca, t)[1] - pointOn(cb, t)[1]);
            assert.ok(
              gap > EPS,
              `${focus.id}: ${a.key} and ${b.key} meet at t=${t} (gap ${gap}) — ` +
                `contact away from a shared circle`,
            );
          }
        }
      }
    }
  }
});

test("lanes in different bundles share no horizontal space but the circle between them", () => {
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    // Depth 0 only, and for a reason rather than for convenience: a nested lane
    // occupies a *sub-range* of its parent's span by construction, so it shares
    // horizontal space with its parent on purpose. The claim being made here is
    // about the figure's own bundles, which tile the width and must not overlap.
    const outer = diagram.lanes.filter((lane) => lane.depth === 0);
    for (const lane of outer) {
      for (const other of outer) {
        if (lane.key === other.key) continue;
        if (lane.x0 === other.x0 && lane.x1 === other.x1) continue; // same bundle
        const overlap = Math.min(lane.x1, other.x1) - Math.max(lane.x0, other.x0);
        assert.ok(
          overlap <= EPS,
          `${focus.id}: ${lane.key} and ${other.key} overlap by ${overlap} across bundles`,
        );
      }
    }
  }
});

test("no lane crosses the spine it bows around, except at the two shared circles", () => {
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const lane of diagram.lanes) {
      if (lane.bow === 0) continue; // the straight middle lane IS the spine
      for (let step = 1; step < 20; step += 1) {
        const t = step / 20;
        const offset = pointOn(drawn(lane.d), t)[1] - lane.yc;
        assert.ok(
          Math.sign(offset) === Math.sign(lane.bow),
          `${lane.key} changes side of the spine at t=${t}`,
        );
      }
    }
  }
});

// --- the fan's shape --------------------------------------------------------

test("a fan wide enough to matter still fits, at any size the graph could grow to", () => {
  // The reservation is linear in the peak, so it holds for fans far wider than
  // anything drawn today. Asserted over sizes the method-level fan-out will
  // reach, because the current two-lane figures cannot expose an error here —
  // the margin covers a shortfall of `tallest / 4` until about ten lanes.
  const M2 = CONVERGE_METRICS;
  for (const n of [2, 4, 7, 10, 16, 24]) {
    const tallest = Math.max(...laneOffsets(n).map(Math.abs));
    const reserved = reservedHalfHeight(tallest);
    assert.ok(
      reserved >= tallest + M2.labelLift + M2.laneFont + M2.stateRadius,
      `a fan of ${n} reserves ${reserved} for a peak of ${tallest}`,
    );
  }
});

test("an odd fan runs one lane straight through the middle; an even fan straddles", () => {
  // The owner: "every other process expanded from it should be around it, even
  // an odd number".
  assert.deepEqual(laneOffsets(1), [0]);
  assert.equal(laneOffsets(3).filter((offset) => offset === 0).length, 1);
  assert.equal(laneOffsets(5).filter((offset) => offset === 0).length, 1);
  assert.equal(laneOffsets(2).filter((offset) => offset === 0).length, 0);
  assert.equal(laneOffsets(4).filter((offset) => offset === 0).length, 0);

  for (const n of [1, 2, 3, 4, 5, 7]) {
    const offsets = laneOffsets(n);
    assert.equal(offsets.length, n);
    const sum = offsets.reduce((total, value) => total + value, 0);
    assert.ok(Math.abs(sum) < EPS, `a fan of ${n} is not centred on the spine`);
    const sorted = [...offsets].sort((x, y) => x - y);
    assert.deepEqual(offsets, sorted, "lanes are ordered, so their curves nest");
  }
});

test("laneOffsets is empty for an empty fan rather than drawing one lane", () => {
  assert.deepEqual(laneOffsets(0), []);
});

test("no branch of a fan enters the band the opened line reserved for itself", () => {
  // The property `allocateBowsAroundSpine` exists for, asserted on the numbers
  // it returns rather than on the arrangement it was meant to produce.
  //
  // Failable: restoring the first version — insert `spineHalf` as a virtual
  // member and centre the whole row with `allocateBows` — fails this on the
  // first case. A fan of one gets `[20, 22]`, which centres the child at
  // `centre - 27` where its band reaches `centre - 7`, 15px inside a band of
  // 22. That case is not exotic: 23 of the 29 decomposed routes are a fan of
  // one, so it was the majority of the drawing.
  const spineHalf = 22;
  const gap = 10;
  for (const halves of [
    [20],
    [20, 20],
    [20, 20, 20],
    [20, 20, 20, 20],
    [20, 20, 20, 20, 20],
    // Uneven bands, which is what a fan with one member opened looks like.
    [140, 20],
    [20, 140, 20],
    [20, 20, 140],
    [9, 200, 31, 12],
  ]) {
    const offsets = allocateBowsAroundSpine(halves, 0, gap, spineHalf);
    assert.equal(offsets.length, halves.length);
    for (const [index, offset] of offsets.entries()) {
      const half = halves[index]!;
      const near = Math.abs(offset) - half;
      assert.ok(
        near >= spineHalf + gap - EPS,
        `fan ${JSON.stringify(halves)}: member ${index} at ${offset} with half ${half} reaches ` +
          `${near} from the bone, inside the ${spineHalf} the bone reserved`,
      );
    }
    // Ordered, so the curves still nest, and no two members overlap each other.
    const sorted = [...offsets].sort((x, y) => x - y);
    assert.deepEqual(offsets, sorted, `fan ${JSON.stringify(halves)} is out of order`);
    for (let index = 1; index < offsets.length; index += 1) {
      const clearance =
        offsets[index]! - halves[index]! - (offsets[index - 1]! + halves[index - 1]!);
      assert.ok(
        clearance >= -EPS,
        `fan ${JSON.stringify(halves)}: members ${index - 1} and ${index} overlap by ${-clearance}`,
      );
    }
  }
  assert.deepEqual(allocateBowsAroundSpine([], 0, gap, spineHalf), []);
});

test("a fan reserves the band its own branches reach, not half of a summed row", () => {
  // The measurement half of the same bug. `measure` used to return
  // `spread / 2`, which is the true half-band only when the two groups mirror
  // each other — and `mid` is a ceil, so for an odd fan they never do.
  //
  // Failable: `spread / 2 + labelBand` for the first case below is 47 against a
  // drawing that reaches 72, so the parent reserved a band its own child
  // overflowed by 25px and the siblings it was packed against never knew.
  for (const halves of [[20], [20, 20, 20], [140, 20, 20]]) {
    const offsets = allocateBowsAroundSpine(halves, 0, M.laneGap, M.spineBand);
    const reach = Math.max(...offsets.map((offset, index) => Math.abs(offset) + halves[index]!));
    const spread =
      halves.reduce((sum, half) => sum + half * 2, 0) + M.spineBand * 2 + M.laneGap * halves.length;
    assert.ok(
      reach > spread / 2 + EPS,
      `fan ${JSON.stringify(halves)} reaches ${reach}, which the old closed form ${spread / 2} ` +
        `would have covered — this case can no longer tell the two apart`,
    );
  }
  // An even fan is the case where the two agree, and it must keep agreeing —
  // otherwise the fix moved every figure, not just the odd ones.
  for (const halves of [[20, 20], [20, 20, 20, 20], [140, 20, 20, 140]]) {
    const offsets = allocateBowsAroundSpine(halves, 0, M.laneGap, M.spineBand);
    const reach = Math.max(...offsets.map((offset, index) => Math.abs(offset) + halves[index]!));
    const spread =
      halves.reduce((sum, half) => sum + half * 2, 0) + M.spineBand * 2 + M.laneGap * halves.length;
    assert.ok(
      Math.abs(reach - spread / 2) < EPS,
      `a mirrored fan ${JSON.stringify(halves)} reaches ${reach} against ${spread / 2}`,
    );
  }
});

// --- text, which is where the old canvas's collisions actually lived ---------

test("every lane label stays inside the canvas", () => {
  // Three of the four collisions the old canvas shipped were <text> against
  // <text>, and every invariant it had was about lines and circles.
  for (const locale of ["en", "ja"] as const) {
    for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      const diagram = diagramFor(focus.id, locale);
      for (const lane of diagram.lanes) {
        const half = estimateTextWidth(lane.label, M.laneFont) / 2;
        assert.ok(lane.labelX - half >= 0, `${locale}/${lane.key} label off the left edge`);
        assert.ok(
          lane.labelX + half <= diagram.width,
          `${locale}/${lane.key} label off the right edge`,
        );
        assert.ok(lane.labelY - M.laneFont >= 0, `${locale}/${lane.key} label above the canvas`);
        assert.ok(lane.labelY <= diagram.height, `${locale}/${lane.key} label below the canvas`);
      }
    }
  }
});

test("two lane labels never overlap", () => {
  for (const locale of ["en", "ja"] as const) {
    for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      const diagram = diagramFor(focus.id, locale);
      const boxes = diagram.lanes.map((lane) => ({
        key: lane.key,
        x0: lane.labelX - estimateTextWidth(lane.label, M.laneFont) / 2,
        x1: lane.labelX + estimateTextWidth(lane.label, M.laneFont) / 2,
        y0: lane.labelY - M.laneFont,
        y1: lane.labelY,
      }));
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const hit = a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
          assert.ok(!hit, `${locale}: labels of ${a.key} and ${b.key} overlap`);
        }
      }
    }
  }
});

test("a name's click target covers the name, and is no greedier than the one it replaced", () => {
  // The target was a fixed **120×15** rect under text whose median drawn width is
  // 235px: measured over every figure in both locales, shut and fully opened,
  // only **85 of 780** names fitted inside their own click target. A reader
  // aiming at the middle of a long name hit nothing.
  //
  // Sizing it to the label fixes that — 780 of 780 — and the risk it introduces
  // is the opposite one, a rect wide enough to steal its neighbour's clicks on a
  // canvas where lanes sit `laneGap: 10` apart at the peak. So both halves are
  // asserted, and the second is asserted **against the rect it replaced** rather
  // than against zero: 44 pairs of targets already overlapped at 120px wide,
  // because what makes them overlap is the 15px height on a crowded opened
  // figure, not the width. Measured after: still 44. The change is free.
  //
  // `labelWidth` is the engine's own measurement of the drawn string, carried
  // rather than recomputed here — a second derivation of a width is what clipped
  // the widest label in a column built for it, twice.
  const overlapping = (rects: { x0: number; x1: number; y0: number; y1: number }[]) => {
    let n = 0;
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const b = rects[j]!;
        if (a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS) n += 1;
      }
    }
    return n;
  };
  let boxes = 0;
  let mine = 0;
  let fixed = 0;
  for (const locale of ["en", "ja"] as const) {
    for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      for (const open of [new Set<string>(), new Set(openableAddresses(focus.id))]) {
        const drawn = openDiagram(focus.id, open, locale).lanes.filter((lane) => lane.label !== "");
        boxes += drawn.length;
        for (const lane of drawn) {
          assert.ok(
            lane.labelWidth + 8 >= estimateTextWidth(lane.label, M.laneFont) - EPS,
            `${lane.key}: the target is narrower than the name it is for`,
          );
        }
        // Exactly the rect `repository-converge-map.tsx` emits, and the one it
        // replaced, on the same geometry.
        mine += overlapping(
          drawn.map((lane) => ({
            x0: lane.labelX - lane.labelWidth / 2 - 4,
            x1: lane.labelX + lane.labelWidth / 2 + 4,
            y0: lane.labelY - 12,
            y1: lane.labelY + 3,
          })),
        );
        fixed += overlapping(
          drawn.map((lane) => ({
            x0: lane.labelX - 60,
            x1: lane.labelX + 60,
            y0: lane.labelY - 12,
            y1: lane.labelY + 3,
          })),
        );
      }
    }
  }
  // 630 since session 104, down from over 700. The drop is exactly the remainder
  // hops: they no longer draw the method's name a second time, so they no longer
  // carry a name click target either. That pairing is the point — a name that is
  // not drawn must not leave an invisible band behind claiming it, which is what
  // `check-invisible-hit-targets.mjs` exists to catch.
  assert.ok(boxes > 600, `only ${boxes} click targets checked`);
  assert.ok(
    mine <= fixed,
    `label-sized targets overlap ${mine} times, the fixed 120px ones ${fixed} — sizing to the name made targeting worse`,
  );
});

test("no lane label sits on a lane", () => {
  // The other text invariant, and the one the old canvas did not have: three of
  // the four collisions it shipped were <text> against <text>, so a label-vs-
  // label check went in and a label-vs-*line* check did not. A name with a curve
  // running through it is just as unreadable, and on this surface every label
  // sits next to a curve by construction.
  for (const locale of ["en", "ja"] as const) {
    for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      const diagram = diagramFor(focus.id, locale);
      for (const lane of diagram.lanes) {
        const half = estimateTextWidth(lane.label, M.laneFont) / 2;
        const box = {
          x0: lane.labelX - half,
          x1: lane.labelX + half,
          y0: lane.labelY - M.laneFont,
          y1: lane.labelY,
        };
        for (const other of diagram.lanes) {
          // Sampled off the PARSED path. A parallel formula here is what let the
          // 4/3 drift hide: the check ran against a curve 3/4 as tall as the one
          // a reader sees, so it had 25% more clearance than the page does.
          const cubic = drawn(other.d);
          for (let step = 0; step <= 120; step += 1) {
            const [x, y] = pointOn(cubic, step / 120);
            const inside = x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
            assert.ok(
              !inside,
              `${locale}/${focus.id}: the curve of ${other.key} passes through ` +
                `the label of ${lane.key} at (${x.toFixed(1)}, ${y.toFixed(1)})`,
            );
          }
        }
      }
    }
  }
});

test("a truncated label is strictly shorter than the whole one and says so", () => {
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const lane of diagramFor(focus.id, locale).lanes) {
        if (lane.label === "") {
          // Only an opened strand may be nameless, and it must be: its name has
          // nowhere collision-free to go while its children fill its band. See
          // the comment in `place`.
          assert.ok(lane.open, `${lane.key} draws no name but is not open`);
          assert.equal(lane.labelTruncated, false, "a nameless lane is not a truncated one");
          continue;
        }
        if (lane.labelTruncated) {
          assert.ok(lane.label.endsWith("…"));
          assert.ok([...lane.label].length < [...lane.fullLabel].length);
        } else {
          // Drawn whole — but "whole" means the authored short form when the
          // node has one, not the full label. The full label still has to be
          // sitting in `fullLabel`, because that is what the `<title>` reads,
          // and the assertion below is the one that keeps a short form from
          // quietly being written there instead.
          assert.equal(lane.label, lane.shortLabel ?? lane.fullLabel);
          if (lane.shortLabel !== null) {
            assert.notEqual(
              lane.shortLabel,
              lane.fullLabel,
              `${lane.key}: the short form reached fullLabel, so the hover text lost the full name`,
            );
          }
        }
      }
    }
  }
});

// --- addresses --------------------------------------------------------------

test("every shape is a link", () => {
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const state of diagram.states) assert.ok(state.href.startsWith("/repository/layers/"));
    for (const lane of diagram.lanes) assert.ok(lane.href.startsWith("/repository/layers/"));
  }
});

// --- coverage: every slot draws -------------------------------------------
//
// These replace one test that asserted the opposite — *"a slot with nothing
// finer draws nothing rather than an empty frame"*, which pinned
// `time-discretization` to `empty: true`. That was the intended behaviour when
// it was written and it is not any more: `expansionOf`'s own doc comment had
// promised since session 92 that an atomic slot *"can only fan out the four
// methods that fill it, which is what the surface does instead"*, and the
// surface never did. 16 of 18 slots rendered one sentence and no figure. The
// replacement is deliberately stronger than the test it retires: it asserts the
// fan exists for **every** slot rather than that one slot draws nothing, and it
// keeps a case pinning what `empty` still means.

test("every capability draws a figure — not just the two that converge", () => {
  const capabilities = LAYER_GRAPH.nodes.filter(isCapability);
  assert.equal(capabilities.length, 19, "the graph's slot count changed; update these figures");

  for (const focus of capabilities) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = diagramFor(focus.id, locale);
      assert.equal(diagram.empty, false, `${focus.id} (${locale}) draws nothing`);
      assert.ok(diagram.lanes.length > 0, `${focus.id} (${locale}) has no lanes`);
      assert.ok(diagram.states.length >= 2, `${focus.id} (${locale}) has fewer than two circles`);
    }
  }

  // The split is measured, not assumed: 2 slots have interior states and the
  // other 17 are method fans. If a future edit gives a method its own contract
  // this number moves, and moving it should be a deliberate edit here.
  // 16 → 17 in session 106: `hamiltonian-recasting`'s two methods are both
  // atomic, so it fans them rather than drawing a chain.
  const byGrain = capabilities.map((focus) => diagramFor(focus.id).grain);
  assert.equal(byGrain.filter((grain) => grain === "states").length, 2);
  assert.equal(byGrain.filter((grain) => grain === "methods").length, 17);
});

test("`drawableSlots` is the list of slots that actually draw", () => {
  // The navigation list and the renderer must not be two opinions about what
  // exists. This is the defect that shipped: `convergingSlots` offered 2 while
  // the page was reachable for all 18, so 16 focus values rendered a blank.
  const offered = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map((slot) => slot.id);
  const draws = LAYER_GRAPH.nodes
    .filter(isCapability)
    .filter((focus) => !diagramFor(focus.id).empty)
    .map((focus) => focus.id);
  assert.deepEqual(offered, draws);
  assert.equal(offered.length, 19);

  // And it is still a strict superset of the convergence claim, which is a
  // different and narrower statement.
  const converging = convergingSlots(LAYER_GRAPH, STATE_VOCABULARY).map((slot) => slot.id);
  assert.equal(converging.length, 2);
  for (const id of converging) assert.ok(offered.includes(id));

  // The filled/unfilled branch has to be REACHED to be tested. Every slot on the
  // authored graph has 2 to 7 fillers, so against `LAYER_GRAPH` alone the two
  // lists agree whatever `drawableSlots` does with an unfilled slot — a mutation
  // replacing that check with `return true` passed the assertions above. An
  // atomic slot with nothing filling it is the only case that separates them.
  const stripped = {
    ...LAYER_GRAPH,
    nodes: LAYER_GRAPH.nodes.filter(
      (node) => isCapability(node) || node.realizes !== "time-discretization",
    ),
  };
  const strippedOffer = drawableSlots(stripped, STATE_VOCABULARY).map((slot) => slot.id);
  assert.ok(
    !strippedOffer.includes("time-discretization"),
    "a slot nothing fills is still being offered as a figure",
  );
  assert.equal(strippedOffer.length, 18);
  // …and the two lists still agree on that graph, which is the actual contract.
  const strippedDraws = stripped.nodes
    .filter(isCapability)
    .filter(
      (focus) =>
        !layoutConverge({ graph: stripped, vocabulary: STATE_VOCABULARY, focus, locale: "en" })
          .empty,
    )
    .map((focus) => focus.id);
  assert.deepEqual(strippedOffer, strippedDraws);
});

test("a method fan is the slot's own two states, one lane per filler", () => {
  const focus = layerNode(LAYER_GRAPH, "time-discretization");
  assert.ok(focus && isCapability(focus));
  const diagram = diagramFor("time-discretization");

  assert.equal(diagram.grain, "methods");
  assert.deepEqual(
    diagram.states.map((state) => state.stateId),
    [focus.contract.from, focus.contract.to],
  );

  const fillers = methodsRealizing(LAYER_GRAPH, "time-discretization");
  assert.equal(diagram.lanes.length, fillers.length);
  assert.deepEqual(
    diagram.lanes.map((lane) => lane.href).sort(),
    fillers.map((method) => `/repository/layers/${method.id}`).sort(),
  );

  // Every lane of a fan is `recorded`, and that is read off the same fact that
  // put the node in the graph — a method with no citation fails validation. A
  // fan may never manufacture the dashed "nobody published this" line, which is
  // a claim about a *composition*.
  for (const lane of diagram.lanes) assert.equal(lane.standing, "recorded");
  assert.equal(diagram.unpublishedCount, 0);

  // `ways` counts alternatives across this slot, and a method has none — its
  // steps are its inside. Rendering a step count here would read as "3 ways
  // through" on a lane that is one way.
  for (const lane of diagram.lanes) assert.equal(lane.ways, 0);
});

test("`empty` still means a slot nothing fills, and the fan is what stops it", () => {
  // `empty` has not been retired, it has been narrowed: no interior states AND
  // no filler. Constructed rather than found, because the authored graph has no
  // unfilled slot today (the range is 2 to 7 methods) — so without this the
  // branch would be unreachable and `empty` would be dead code that reads as a
  // guard.
  const focus = layerNode(LAYER_GRAPH, "time-discretization");
  assert.ok(focus && isCapability(focus));
  const withoutFillers = {
    ...LAYER_GRAPH,
    nodes: LAYER_GRAPH.nodes.filter(
      (node) => isCapability(node) || node.realizes !== "time-discretization",
    ),
  };
  assert.equal(methodsRealizing(withoutFillers, "time-discretization").length, 0);

  const diagram = layoutConverge({
    graph: withoutFillers,
    vocabulary: STATE_VOCABULARY,
    focus,
    locale: "en",
  });
  assert.equal(diagram.empty, true);
  assert.deepEqual(diagram.states, []);
  assert.deepEqual(diagram.lanes, []);
  assert.equal(methodFanOf(withoutFillers, focus), null);
});

test("no figure clips a label the column was sized to hold", () => {
  // The column span is `widest + labelPad*2`, so the widest label fits by
  // construction — unless the fit budget is recovered by subtracting that
  // padding back off, which is not exact in binary floating point. Measured
  // before the fix: 12 of 18 figures clipped, and the one clipped label was
  // always the widest one. `nonlinear-ode-solve` read
  // "…propagator approximation → Quantum linear sol…" in a column built for it.
  for (const focus of LAYER_GRAPH.nodes.filter(isCapability)) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = diagramFor(focus.id, locale);
      for (const lane of diagram.lanes) {
        assert.equal(
          lane.labelTruncated,
          false,
          `${focus.id} (${locale}) clipped "${lane.fullLabel}" into "${lane.label}"`,
        );
        // Opened strands used to be exempt here because they drew no name at
        // all. They draw one now, fitted against the same budget as every other.
        // Exactly one lane is still nameless and it is the run of named hops,
        // whose `fullLabel` is `A → B` — the coined composite the owner refused.
        // Asserted by *kind*, not by "if the label is empty, skip": that shape of
        // exemption is how 128 nameless lanes went unnoticed here for two
        // sessions.
        if (lane.composite) {
          assert.equal(lane.label, "", `${lane.key} drew the composite name "${lane.label}"`);
          continue;
        }
        assert.equal(lane.label, lane.shortLabel ?? lane.fullLabel);
      }
    }
  }
});

test("a cap that bites is reported rather than read as a slot with nothing finer", () => {
  // `Expansion` has reported `truncated` and `chainConsistent` since session 96
  // and nothing read either one. That is not cosmetic: when `maxHops` bites,
  // `expansionOf` returns `atomicAtThisLevel: true`, which this surface now
  // draws as a method fan — indistinguishable from a slot the literature really
  // has nothing finer for. The fields ride on the diagram so the page can say
  // which it is.
  for (const focus of LAYER_GRAPH.nodes.filter(isCapability)) {
    const diagram = diagramFor(focus.id);
    assert.equal(diagram.truncated, false, `${focus.id} truncated on today's graph`);
    assert.equal(diagram.chainConsistent, true, `${focus.id} has an inconsistent chain`);
  }

  // And the carrying is real rather than a field wired to a constant.
  //
  // The first draft of this assertion spread an unchanged capability and
  // asserted `truncated === false` under a comment claiming it proved a biting
  // cap did the opposite. It proved nothing — it repeated the loop above. A
  // comment saying a thing is checked is not a check, so the cap is made to bite
  // on a graph built for it: a chain of `maxHops + 2` slots between the ends,
  // which no walk can cross inside the budget.
  const hops = PATH_LIMITS.maxHops + 2;
  const ids = Array.from({ length: hops + 1 }, (unused, at) => `synthetic-state-${at}`);
  const vocabulary: StateVocabulary = {
    states: ids.map((id) => ({
      id,
      label: id,
      labelJa: id,
      summary: id,
      summaryJa: id,
      specializes: [],
    })),
  };
  const link = (at: number): LayerCapability => ({
    kind: "capability",
    id: `synthetic-slot-${at}`,
    label: `synthetic-slot-${at}`,
    labelJa: `synthetic-slot-${at}`,
    summary: "",
    summaryJa: "",
    whyALayer: "",
    whyALayerJa: "",
    contract: {
      from: ids[at]!,
      to: ids[at + 1]!,
      takes: "",
      takesJa: "",
      returns: "",
      returnsJa: "",
    },
  });
  const spanning: LayerCapability = {
    ...link(0),
    id: "synthetic-span",
    label: "synthetic-span",
    labelJa: "synthetic-span",
    contract: { ...link(0).contract, from: ids[0]!, to: ids[hops]! },
  };
  const chain = {
    nodes: [...Array.from({ length: hops }, (unused, at) => link(at)), spanning],
  } as unknown as typeof LAYER_GRAPH;

  const capped = expansionOf(chain, vocabulary, spanning);
  assert.equal(capped.truncated, true, "a walk past maxHops must report the cap");
  // …and this is the failure mode the field exists to make visible: the cap
  // biting is reported as "nothing finer is recorded", which is what an
  // genuinely atomic slot returns too.
  assert.equal(capped.atomicAtThisLevel, true);
});

test("the crossings at a shared circle count methods, and count each one once", () => {
  const node = layerNode(LAYER_GRAPH, "nonlinear-ode-solve");
  assert.ok(node && isCapability(node));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, node);
  const census = crossingsAt(LAYER_GRAPH, STATE_VOCABULARY, expansion, "linear-ivp", "en");
  assert.ok(census);

  // Six embeddings, not seven. The Koopman-von Neumann lift fills the broad lane
  // AND is the sole filler of its own narrowed lane, so counting lanes instead
  // of methods reported it twice — measured before the dedupe went in, this said
  // 5 ways in against 4 methods, 40 crossings, and listed KvN →
  // Schrödingerisation twice. The dedupe is what this number is defending, and
  // it is still one apart from the lane count.
  //
  // Was 4 until session 103, when the owner's Koopman ruling added
  // `koopman-linearization` and `carleman-fourier-linearization` as fillers of
  // this same slot. The `refines` edge between Carleman and its parent adds no
  // lane — nothing in the layout engine reads that field — so the +2 here is the
  // two new nodes and nothing else.
  assert.equal(census.waysIn, 6, "one entry per embedding method, however many lanes reach it");
  assert.equal(census.total, census.waysIn * census.waysOut);
  assert.equal(census.recorded + census.unpinned + census.unpublished, census.total);

  const seen = new Set(census.examples.map((crossing) => crossing.key));
  assert.equal(seen.size, census.examples.length, "a combination is listed once");
});

test("the examples cap is reported rather than applied silently", () => {
  const node = layerNode(LAYER_GRAPH, "nonlinear-ode-solve");
  assert.ok(node && isCapability(node));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, node);

  const capped = crossingsAt(LAYER_GRAPH, STATE_VOCABULARY, expansion, "linear-ivp", "en", 3);
  assert.ok(capped);
  assert.equal(capped.examples.length, 3);
  assert.equal(capped.examplesTruncated, true, "a shortened list must say it is shortened");

  const whole = crossingsAt(LAYER_GRAPH, STATE_VOCABULARY, expansion, "linear-ivp", "en", 500);
  assert.ok(whole);
  assert.equal(whole.examples.length, whole.unpublished);
  assert.equal(whole.examplesTruncated, false);
});

test("the owner's own research direction is on the page", () => {
  // Carleman + Schrödingerisation: it composes through `linear-ivp`, no source
  // puts the two together, and the whole point of this surface is that a reader
  // can see it. If it stops appearing, the surface has stopped doing its job.
  const node = layerNode(LAYER_GRAPH, "nonlinear-ode-solve");
  assert.ok(node && isCapability(node));
  const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, node);
  const census = crossingsAt(LAYER_GRAPH, STATE_VOCABULARY, expansion, "linear-ivp", "en");
  assert.ok(census);
  const found = census.examples.some(
    (crossing) =>
      crossing.inHref.endsWith("/carleman-linearization") &&
      crossing.outHref.endsWith("/schrodingerisation"),
  );
  assert.ok(found, "Carleman → Schrödingerisation is not listed as unpublished");
});

test("the narrowed lane is named after its filler, not after the slot four routes share", () => {
  const diagram = diagramFor("nonlinear-ode-solve");
  const kvn = diagram.lanes.find((lane) => lane.href.includes("koopman-von-neumann-lift"));
  assert.ok(kvn, "the Koopman-von Neumann landing has its own lane");
  assert.ok(
    !kvn.fullLabel.startsWith("Embed a nonlinear system"),
    "naming it after the slot would say four routes take it when one does",
  );
});

// --- opening a line, in place -----------------------------------------------
//
// The claims below are the reason nesting was worth building at all, and they
// are the ones a reader would notice breaking: open a line and the picture must
// still be a picture — nothing overlapping, nothing off the canvas, every new
// shape still an address. They are asserted over **every openable line on every
// figure**, one at a time and then all at once, rather than over a chosen
// example, because a layout that survives one expansion and folds on two is the
// normal way this fails.

/**
 * Every **address** on a figure that a reader could click open.
 *
 * Addresses, not node ids, because that is what the canvas now emits and so what
 * a reader's URL actually contains. Sweeping the id form instead would run every
 * opened-state test below against a path readers no longer take — and the id form
 * opens *more* lanes per value, so it is not even the harder case for the ones
 * that count things. The id path keeps its own test.
 */
/** Every address `id`'s figure can open, to saturation. `graph` so a fixture
 *  graph can be saturated too — the cap's own test needs that. */
function openableAddresses(id: string, graph: LayerGraph = LAYER_GRAPH): string[] {
  const seen = new Set<string>();
  const walk = (open: ReadonlySet<string>) => {
    const node = layerNode(graph, id);
    assert.ok(node && isCapability(node));
    const diagram = layoutConverge({
      graph,
      vocabulary: STATE_VOCABULARY,
      focus: node,
      locale: "en",
      open,
    });
    let grew = false;
    for (const lane of diagram.lanes) {
      if (lane.openHref === null) continue;
      if (seen.has(lane.address)) continue;
      seen.add(lane.address);
      grew = true;
    }
    if (grew) walk(new Set(seen));
  };
  walk(new Set());
  return [...seen];
}

function openDiagram(id: string, open: Iterable<string>, locale: PublicLocale = "en"): ConvergeDiagram {
  const node = layerNode(LAYER_GRAPH, id);
  assert.ok(node && isCapability(node), `${id} is not a capability`);
  return layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus: node,
    locale,
    open: new Set(open),
  });
}

/** Every way a figure can be opened that is worth checking: each id alone, then all of them. */
function openings(id: string): Set<string>[] {
  const ids = openableAddresses(id);
  return [...ids.map((one) => new Set([one])), new Set(ids)];
}

// --- the cap, against what a reader can actually reach -----------------------
//
// `CONVERGE_OPEN_MAX` had no test, and the comment beside it named one: *"the
// cap's own test needs that"*, on `openableAddresses`'s `graph` parameter. It
// was never written, and in its absence the constant drifted twice — the prose
// said twenty-four while the value said 64, and 64 was already below the graph.
//
// The claim asserted below is deliberately **not** arithmetic on the constant.
// A test comparing 128 to 74 passes whether or not the saturation walk found
// anything, and the way this fails is the walk going quiet, not the subtraction
// going wrong. So the widest figure's whole address set is pushed through the
// real parser and the reader's own path is the assertion: every address a
// reader could click survives `resolveOpenIds`, and nothing is dropped.

/**
 * Every address the overview can open, across all four roots at once.
 *
 * The unfocused surface draws four figures and hands **one** `?open=` set to
 * every one of them, so the number the cap has to clear is the union and not
 * the widest figure. Addresses carry their subject's id as a prefix, so the
 * four sets are disjoint by construction — asserted rather than assumed, since
 * a prefix that stopped being unique would make this count too small and the
 * cap look safer than it is.
 */
function overviewAddresses(): string[] {
  const all = new Set<string>();
  let summed = 0;
  for (const root of rootCapabilities(LAYER_GRAPH)) {
    const addresses = openableAddresses(root.id);
    summed += addresses.length;
    for (const address of addresses) all.add(address);
  }
  assert.equal(all.size, summed, "two roots emitted the same address — the subject prefix is not unique");
  return [...all];
}

test("the cap is above what a reader can reach by clicking", () => {
  const perFigure = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)
    .map((slot) => ({ id: slot.id, addresses: openableAddresses(slot.id) }))
    .sort((a, b) => b.addresses.length - a.addresses.length);
  const widest = perFigure[0];
  const overview = overviewAddresses();

  // The denominator, printed. A run that reports "0 of 0 dropped" is the shape
  // this test exists to catch, so the numbers it measured are on the record
  // beside the verdict rather than only inside a passing assertion.
  console.log(
    `open cap ${CONVERGE_OPEN_MAX}: widest figure ${widest.id} reaches ${widest.addresses.length}, `
      + `the four-root overview reaches ${overview.length}, over ${perFigure.length} figures`,
  );

  // Not vacuous. If the saturation walk ever returns nothing, every assertion
  // below passes while measuring an empty map — which is exactly how a cap test
  // goes green over a cap that is too small.
  assert.ok(widest.addresses.length >= 20, `the widest figure reaches only ${widest.addresses.length} addresses`);
  assert.ok(
    overview.length >= widest.addresses.length,
    "the overview draws the widest figure, so it cannot reach fewer addresses than it does",
  );

  // The reader's own path, through the real parser, on the hardest case there
  // is. This is what fails when the cap falls behind the graph: at 64 the
  // widest figure alone dropped 2 and the overview dropped 9.
  for (const [what, addresses] of [
    [widest.id, widest.addresses],
    ["the overview", overview],
  ] as const) {
    const resolved = resolveOpenIds(addresses, (id) => layerNode(LAYER_GRAPH, id) !== null);
    assert.equal(resolved.dropped, 0, `${what}: the cap dropped ${resolved.dropped} of ${addresses.length} clicks`);
    assert.equal(resolved.open.size, addresses.length, `${what}: ${addresses.length - resolved.open.size} addresses did not survive`);
  }

  // And with the slot a method's own page reserves for itself spoken for. That
  // page draws its slot with the method already open, so the reader arrives
  // with one of the cap's places gone before any of their own ids are counted.
  const reserved = resolveOpenIds(overview, (id) => layerNode(LAYER_GRAPH, id) !== null, 1);
  assert.equal(reserved.dropped, 0, "a method's page reserves one slot, and the overview no longer fits beside it");
});

test("`?open=` is parsed the same way wherever it is read", () => {
  const known = (id: string) => layerNode(LAYER_GRAPH, id) !== null;
  const real = openableAddresses("nonlinear-ode-solve")[0];
  assert.ok(real, "the widest figure opens nothing");

  // An address needs no lookup — the graph is not consulted for it — and a bare
  // node id is still honoured so that links written before addresses existed
  // keep opening what they always did.
  assert.deepEqual([...resolveOpenIds([real], () => false).open], [real]);
  assert.deepEqual([...resolveOpenIds(["hhl-qpe-inversion"], known).open], ["hhl-qpe-inversion"]);

  // Skipped, not rejected: a URL naming four things, one of which has since
  // been renamed, opens the other three.
  const forgiving = resolveOpenIds([real, "no-such-node", "not an address"], known);
  assert.deepEqual([...forgiving.open], [real]);
  assert.equal(forgiving.dropped, 0, "an unknown value is not a value the cap dropped");

  // A repeat is one thing opened, not two places spent.
  assert.equal(resolveOpenIds([real, real], known).open.size, 1);

  // Past the cap, counted rather than silent — and `reserved` narrows the cap
  // by exactly what it claims, which is the only thing the method page passes.
  const many = Array.from({ length: CONVERGE_OPEN_MAX + 3 }, (_, i) => `x:0.${i}`);
  const over = resolveOpenIds(many, known);
  assert.equal(over.open.size, CONVERGE_OPEN_MAX);
  assert.equal(over.dropped, 3);
  const withReserved = resolveOpenIds(many, known, 1);
  assert.equal(withReserved.open.size, CONVERGE_OPEN_MAX - 1);
  assert.equal(withReserved.dropped, 4);
});

test("a line that opens into something says so, and a line that does not is not a link", () => {
  // The half of this that matters is the second one. A line whose click
  // navigates when the reader expected it to expand teaches the wrong rule
  // about every other line on the canvas, so a leaf carries no `openHref` at
  // all — its body is inert and only its name is a link.
  let openable = 0;
  let leaves = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const lane of diagramFor(focus.id).lanes) {
      if (lane.openHref === null) {
        // Two shapes have no open link, and only one of them is a leaf. A run of
        // named hops is drawn open from the start — its identity is the
        // sequence, so there is no id for `?open=` to name it by, and the
        // alternative was a label reading `A → B`: a string describing a picture
        // instead of the picture.
        if (lane.open) continue;
        leaves += 1;
        assert.equal(lane.inside, 0, `${lane.key} has ${lane.inside} inside but cannot be opened`);
        assert.equal(lane.opensInto, null);
      } else {
        openable += 1;
        assert.ok(lane.inside > 0, `${lane.key} opens into nothing`);
        assert.ok(lane.opensInto === "ways" || lane.opensInto === "steps");
        assert.ok(lane.openHref.startsWith("/repository/layers?"));
        // The address, not the node id. A node holds up to twelve positions on
        // one figure and naming it by id opened all of them.
        //
        // Parsed, not `includes`. An address is a prefix of its own descendants'
        // addresses and `encodeURIComponent` leaves it unchanged, so a substring
        // test passes on `open=<subject>:1.0` whenever the href carries
        // `open=<subject>:1.0.3` — which is exactly the href an *open* lane
        // emits, since shutting it drops its own address and keeps the
        // descendant. The assertion would have held while the control did the
        // opposite of what it claims. Caught in review.
        assert.ok(
          new URL(lane.openHref, "https://example.invalid").searchParams
            .getAll("open")
            .includes(lane.address),
          `${lane.key} does not offer its own address`,
        );
      }
      // Both halves of the two-target rule are always present: the name always
      // goes to the thing's own page, whether or not the line opens.
      assert.ok(lane.href.startsWith("/repository/layers/"));
    }
  }
  // The measurement that decided the design, pinned so a regression in the graph
  // or in `routeOf` shows up as a number rather than as a quiet loss of
  // affordance — which is exactly how it showed up while this was being built:
  // requiring two route segments to open made twelve methods inert, and the
  // count here was 15 rather than 24.
  // 55 until session 103. The Koopman ruling added two atomic fillers to
  // `nonlinear-linear-embedding`, so both land in `leaves` — they are lines with
  // nothing finer recorded, which is the honest state for a framework node whose
  // instances are its children rather than its steps.
  // 57 until session 106. `hamiltonian-recasting` brought a nineteenth figure
  // carrying its two atomic methods, and both land in `leaves` — the openable
  // count did not move, because `lchs-route` and `schrodingerisation` already
  // opened into their steps and gaining a second step did not change that.
  assert.equal(openable + leaves + 1, 59, "the nineteen figures draw 59 lines between them");
  assert.equal(openable, 24, "24 of them open into something recorded");
  assert.equal(leaves, 34, "34 are leaves — nothing finer is recorded for them");
});

test("opening a line keeps every line apart — the crossing-free claim, with things open", () => {
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const bundle of siblingsOf(diagram)) {
        for (let i = 0; i < bundle.length; i += 1) {
          for (let j = i + 1; j < bundle.length; j += 1) {
            const a = drawn(bundle[i]!.d);
            const b = drawn(bundle[j]!.d);
            for (let step = 1; step < 40; step += 1) {
              const t = step / 40;
              const gap = Math.abs(pointOn(a, t)[1] - pointOn(b, t)[1]);
              assert.ok(
                gap > EPS,
                `${focus.id} with ${[...open].join("+")}: ${bundle[i]!.key} and ` +
                  `${bundle[j]!.key} meet at t=${t}`,
              );
            }
          }
        }
      }
    }
  }
});

test("a step drawn inside a lane sits ON that lane, at both of its ends", () => {
  // The property `splitCubicEven` exists for. If a nested piece started near
  // its parent rather than on it, the drawing would say the route leaves the
  // line it is a decomposition of — and it would look like a rendering artefact
  // rather than the false claim it is.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      const byKey = new Map(diagram.lanes.map((lane) => [lane.key, lane]));
      for (const lane of diagram.lanes) {
        if (lane.depth === 0) continue;
        assert.ok(lane.parentKey, `${lane.key} is nested but names no parent`);
        const parent = byKey.get(lane.parentKey);
        assert.ok(parent, `${lane.key} names a parent ${lane.parentKey} that is not drawn`);
        const on = drawn(parent.d);
        const ends = drawnEnds(lane.d);
        // A minimum distance over a fine sweep, not a per-sample box.
        //
        // The first draft asked whether any of 401 samples landed within 1.2px
        // in both axes. On a span of 1,400px consecutive samples are 3.5px
        // apart, so a point exactly on the curve could fall between two of them
        // and be reported off it — a test failing for its own resolution rather
        // than for the thing it is checking.
        //
        // Refined around the best coarse sample rather than sampled harder,
        // because a fixed sample count is a resolution that depends on how wide
        // the figure happens to be — and the figure got wider the moment lanes
        // were given room to stay flat, which reintroduced exactly the artefact
        // this comment was written about. Refining makes the tolerance mean the
        // same thing on a 400px figure and a 10,000px one.
        const distanceTo = (x: number, y: number) => {
          const at = (t: number) => {
            const [px, py] = pointOn(on, t);
            return Math.hypot(px - x, py - y);
          };
          const COARSE = 4000;
          let bestT = 0;
          let best = Infinity;
          for (let step = 0; step <= COARSE; step += 1) {
            const t = step / COARSE;
            const distance = at(t);
            if (distance < best) {
              best = distance;
              bestT = t;
            }
          }
          let lo = Math.max(0, bestT - 1 / COARSE);
          let hi = Math.min(1, bestT + 1 / COARSE);
          for (let round = 0; round < 60; round += 1) {
            const a = lo + (hi - lo) / 3;
            const b = hi - (hi - lo) / 3;
            if (at(a) < at(b)) hi = b;
            else lo = a;
          }
          return Math.min(best, at((lo + hi) / 2));
        };
        const near = (x: number, y: number) => distanceTo(x, y) < 0.6;
        assert.ok(
          near(ends.sx, ends.sy),
          `${focus.id}: ${lane.key} starts at (${ends.sx},${ends.sy}), off ${parent.key}`,
        );
        assert.ok(near(ends.ex, ends.ey), `${focus.id}: ${lane.key} ends off ${parent.key}`);
      }
    }
  }
});

test("nothing an opened figure draws leaves the canvas", () => {
  // Bottom-up sizing is the whole reason opening pushes neighbours apart rather
  // than drawing over them; this is the assertion that says the reservation is
  // real. Sampled off the parsed paths, not off the declared bows.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const lane of diagram.lanes) {
        const cubic = drawn(lane.d);
        for (let step = 0; step <= 40; step += 1) {
          const [x, y] = pointOn(cubic, step / 40);
          assert.ok(
            y > 0 && y < diagram.height,
            `${focus.id} with ${[...open].join("+")}: ${lane.key} reaches y=${y.toFixed(1)} ` +
              `on a canvas ${diagram.height} tall`,
          );
          assert.ok(x >= 0 && x <= diagram.width, `${lane.key} reaches x=${x}`);
        }
      }
      for (const state of diagram.states) {
        assert.ok(
          state.cy - state.r > 0 && state.cy + state.r < diagram.height,
          `${focus.id}: circle ${state.key} at ${state.cy} is off a canvas ${diagram.height} tall`,
        );
      }
    }
  }
});

test("an opened figure still names every drawn label without clipping it", () => {
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        for (const lane of openDiagram(focus.id, open, locale).lanes) {
          // Two lanes draw nothing, for opposite reasons, and both are
          // **declared** rather than inferred:
          //   `composite` — the run of named hops, whose own name would be
          //                 `A → B`, the coined composite the owner refused;
          //   `nameless`  — the remainder hop, the part of a route the method
          //                 performs itself. Its name is the method's, and the
          //                 method writes it once, on the bone above it.
          // Before session 104 the remainder hop drew the method's name a
          // second time, one level down, which is what the owner saw as
          // *"time marching expands into propagation then itself"*.
          //
          // Checked both ways round, which is what makes it a check rather than
          // a restatement: `lane.open` was here first and is not the predicate —
          // an ordinary opened lane that lost its name would have passed.
          const declaredSilent = lane.composite || lane.nameless;
          if (lane.label === "") {
            assert.ok(
              declaredSilent,
              `${lane.key} draws no name and is neither a composite run nor a remainder hop`,
            );
            continue;
          }
          assert.ok(
            !declaredSilent,
            `${lane.key} declares itself silent (composite=${lane.composite} ` +
              `nameless=${lane.nameless}) yet draws "${lane.label}"`,
          );
          assert.ok(lane.fullLabel !== "", `${lane.key} has a drawn name but no full one`);
          assert.equal(
            lane.labelTruncated,
            false,
            `${focus.id} (${locale}) clipped "${lane.fullLabel}" into "${lane.label}"`,
          );
        }
      }
    }
  }
});

test("opening is a toggle, and toggling twice is where you started", () => {
  // `?open=` is a set and the line's own link adds or removes exactly itself.
  // The alternative — one id at a time — is the surface session 92 shipped and
  // the one the owner rejected: opening a second thing shut the first.
  const focus = "nonlinear-ode-solve";
  const first = diagramFor(focus).lanes.find((lane) => lane.openHref !== null);
  assert.ok(first, "this figure has a line that opens");
  const opened = openDiagram(focus, [first.nodeId!]);
  const same = opened.lanes.find((lane) => lane.nodeId === first.nodeId);
  assert.ok(same?.open, "the line the URL names is drawn open");
  assert.equal(
    same.openHref,
    `/repository/layers?focus=${focus}`,
    "an open line's own link shuts it again and leaves the rest alone",
  );
  assert.ok(opened.lanes.length > diagramFor(focus).lanes.length, "opening draws more, not less");
  // Everything else stays open when a second line is opened beside it.
  const second = opened.lanes.find(
    (lane) => lane.openHref !== null && lane.nodeId && lane.nodeId !== first.nodeId,
  );
  assert.ok(second, "there is a second line to open");
  const both = openDiagram(focus, [first.nodeId!, second.nodeId!]);
  assert.ok(
    both.lanes.find((lane) => lane.nodeId === first.nodeId)?.open,
    "the first line is still open once a second one is",
  );
});

test("a shut line says what is inside it, and the figure counts them", () => {
  // A cap or a fold a reader cannot see is a map quietly missing something.
  //
  // **Swept at saturation as well as shut, and that is where this was wrong.**
  // With nothing open the two counts are indistinguishable from the one they
  // replace, because every shut line still has a click waiting on it. The
  // defect only exists on a figure a reader has finished opening: 33 lines on
  // `nonlinear-ode-solve` sat at `CONVERGE_DEPTH_MAX` with something inside and
  // no way in, and all 33 were counted as clicks the reader had not made.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of [new Set<string>(), new Set(openableAddresses(focus.id))]) {
      const diagram = openDiagram(focus.id, open);
      const shut = diagram.lanes.filter((lane) => !lane.open && lane.inside > 0);
      const clickable = shut.filter((lane) => lane.openHref !== null).length;

      // The count is the thing counted, and it is only the clickable half.
      assert.equal(
        diagram.collapsedCount,
        clickable,
        `${focus.id}: the count must be the thing counted`,
      );
      // Nothing falls between them. The two arms partition the old number, so a
      // third state — a lane that is shut with something inside and neither
      // counted nor excused — cannot appear without this failing.
      assert.equal(
        diagram.collapsedCount + diagram.cappedCount,
        shut.length,
        `${focus.id}: ${shut.length} shut lines, ${diagram.collapsedCount} counted, ${diagram.cappedCount} excused`,
      );
    }
  }
});

test("a figure the reader has finished opening says so", () => {
  // The sentence `collapsedCount` exists to earn. Three of the nineteen figures
  // could never reach it: they carry lines at the depth ceiling, those lines
  // have something inside, and the count did not ask whether they could be
  // opened — so the figure went on reporting unmade clicks after the reader had
  // made every one there was.
  let reachedTheEnd = 0;
  let capped = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = openDiagram(focus.id, openableAddresses(focus.id));
    assert.equal(
      diagram.collapsedCount,
      0,
      `${focus.id}: ${diagram.collapsedCount} lines still counted as unopened with every address open`,
    );
    reachedTheEnd += 1;
    capped += diagram.cappedCount;
  }
  console.log(`${reachedTheEnd} figures reach "everything that opens is open", holding ${capped} capped lines`);
  // Not vacuous: the capped lines have to still exist somewhere, or this passes
  // because the layout stopped drawing them rather than because the count
  // learned to tell the two apart.
  assert.ok(capped > 0, "no figure has a line it will not open — the second count is measuring nothing");
});

test("a line this figure will not open is not a line at the depth ceiling by definition", () => {
  // `cappedCount` asks `openable`, and `openable` is false for two reasons: the
  // depth cap, and the walk having already drawn this node further up. Today
  // every one of them is the first reason, and the note is worded for depth on
  // the strength of that measurement rather than on the strength of the
  // predicate — so the measurement is on the record and will say when it stops
  // holding.
  let atCeiling = 0;
  let elsewhere = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = openDiagram(focus.id, openableAddresses(focus.id));
    for (const lane of diagram.lanes) {
      if (lane.open || lane.inside === 0 || lane.openHref !== null) continue;
      // Depth off the address: `subject:1.0.3` is three levels below the root.
      const depth = lane.address.split(":")[1].split(".").length - 1;
      if (depth >= CONVERGE_DEPTH_MAX) atCeiling += 1;
      else elsewhere += 1;
    }
  }
  console.log(`lines this figure will not open: ${atCeiling} at the depth ceiling, ${elsewhere} for another reason`);
  assert.ok(atCeiling > 0, "nothing sits at the depth ceiling — the sweep found no capped lines at all");
  assert.equal(
    elsewhere,
    0,
    `${elsewhere} lines are unopenable for a reason that is not depth — the note's wording needs revisiting`,
  );
});

test("allocateBows reproduces laneOffsets exactly when every sibling is a leaf", () => {
  // Two writers of one spacing. `laneOffsets` is the shut case in closed form —
  // the one a reader can check by looking — and `allocateBows` is what the
  // layout actually calls. They have to agree, and `laneBow` is the number that
  // makes them agree, so a change to `strandHalf`, `labelBand` or `laneGap` that
  // forgets `laneBow` fails here rather than drifting the picture.
  const leaf = M.strandHalf + M.labelBand;
  assert.equal(leaf * 2 + M.laneGap, M.laneBow, "laneBow is not an independent number");
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const closed = laneOffsets(count);
    const allocated = allocateBows(new Array(count).fill(leaf), 0, M.laneGap);
    for (let index = 0; index < count; index += 1) {
      assert.ok(
        Math.abs(closed[index]! - allocated[index]!) < 1e-9,
        `${count} lanes, index ${index}: closed form ${closed[index]}, allocator ${allocated[index]}`,
      );
    }
  }
});

/**
 * The two edges of a closed outline, as samplers in x.
 *
 * The outline is emitted as the upper edge forwards and the lower edge backwards
 * so the shape closes without a winding rule, which is what makes the split
 * findable: it is the first segment whose x decreases.
 */
function outlineEdges(d: string): { upper: (x: number) => number; lower: (x: number) => number } {
  const segments = parsePath(d);
  const turn = segments.findIndex((segment, index) => index > 0 && segment.x1 < segment.x0);
  assert.ok(turn > 0, `an outline that never turns back: ${d}`);
  return {
    upper: (x: number) => drawnYAt(segments.slice(0, turn), x),
    lower: (x: number) => drawnYAt(segments.slice(turn), x),
  };
}

test("every strand pinches to a point at both circles and stands 2·half across its belly", () => {
  // The taper is not decoration: a line of constant width arriving at a circle
  // says "this ends here", and a strand pinching to a point says "this and the
  // others become one thing here", which is what a convergence is. Read off the
  // emitted outline, because that is the shape a reader sees.
  //
  // **A ribbon since R14, and the claim got sharper rather than weaker.** The
  // old shape was a lens — thickest at one point and thinning everywhere else —
  // and the check that matched it counted the numbers in the path string, which
  // is a check on the *arity* of the emitter rather than on the shape. The
  // muscle is a taper, a constant belly, and a taper, so all three are asserted
  // against samples of the drawn edges.
  let checked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const lane of diagram.lanes) {
      assert.ok(lane.outline.endsWith("Z"), `${lane.key}: an outline is closed`);
      assert.ok(lane.half > 0, `${lane.key}: a strand with no thickness`);
      const edges = outlineEdges(lane.outline);
      checked += 1;
      // Sampled at the ends the OUTLINE draws, not at `lane.x0`/`lane.x1`. The
      // emitter rounds to a hundredth and the layout's own numbers are exact, so
      // a sample taken at the exact end can fall a thousandth outside the drawn
      // range — where a sampler has to guess, and this one guesses by falling
      // back to the last segment. That returned the far end of the shape and
      // read as a 7px gap at a pinch that is exact.
      const ends = drawnEnds(lane.outline);
      close(edges.upper(ends.sx), edges.lower(ends.sx), `${lane.key}: not pinched at its start`, 0.05);
      close(edges.upper(ends.ex), edges.lower(ends.ex), `${lane.key}: not pinched at its end`, 0.05);
      close(edges.upper(ends.sx), lane.yc, `${lane.key}: the pinch is off the base`, 0.05);
      // Constant across the belly, at exactly the thickness the lane reports.
      for (let step = 1; step < 20; step += 1) {
        const x = lane.bellyX0 + ((lane.bellyX1 - lane.bellyX0) * step) / 20;
        close(
          edges.lower(x) - edges.upper(x),
          2 * lane.half,
          `${lane.key}: thickness across the belly at x=${x}`,
          0.05,
        );
      }
      // And it tapers rather than stepping: halfway up a tendon the shape is
      // thinner than the belly and thicker than the pinch.
      if (lane.run > 1) {
        const mid = lane.x0 + lane.run / 2;
        const thickness = edges.lower(mid) - edges.upper(mid);
        assert.ok(
          thickness > 0.02 && thickness < 2 * lane.half - 0.02,
          `${lane.key}: the tendon is ${thickness.toFixed(2)} thick against a belly of ` +
            `${(2 * lane.half).toFixed(2)} — it steps rather than tapers`,
        );
      }
    }
  }
  assert.ok(checked > 50, `only ${checked} outlines checked`);
});

test("the key's swatch is the same kind of shape the canvas draws", () => {
  // **A legend drifts by staying still.** The key's mark was the literal lens the
  // canvas drew before R14 and it stayed that lens through the tendons — three
  // swatches, on every focused page, describing a shape nothing on the figure
  // beside them had. Read on production after the deploy, not caught by anything:
  // the layout tests measure the layout and the render tests render the canvas
  // without its key.
  //
  // Command sequence, not coordinates. The mark is at legend scale and always
  // will be; what must not diverge is the *kind* of shape. A ribbon outline is
  // `M C L C L C L C Z`; the lens it replaced was `M C C Z`, so the old literal
  // fails this and any future change to the drawn shape fails it too.
  const commands = (d: string) => d.trim().split(/[\s,]+/).filter((token) => /^[A-Za-z]$/.test(token)).join("");
  const lane = diagramFor("quantum-linear-solve").lanes[0]!;
  const mark = legendMark();
  assert.equal(
    commands(mark.outline),
    commands(lane.outline),
    "the key's filled swatch is not the shape a strand is drawn as",
  );
  assert.equal(
    commands(mark.spine),
    commands(lane.d),
    "the key's opened-line swatch is not the shape an opened line is drawn as",
  );
});

test("no two shapes on one figure share a key", () => {
  // Found by accident, which is how a duplicate key is usually found: a test
  // looking up a lane's parent kept getting the wrong one. A nested key was
  // built from the node's id rather than from its parent's key, so a method
  // filling two slots on one drawing produced the same key twice — and every
  // map built from these, React's included, silently kept the last.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      const keys = [
        ...diagram.lanes.map((lane) => lane.key),
        ...diagram.states.map((state) => state.key),
        ...diagram.feeds.map((feed) => feed.key),
      ];
      assert.equal(
        new Set(keys).size,
        keys.length,
        `${focus.id} with ${[...open].join("+")} draws two shapes under one key`,
      );
    }
  }
});

test("an ingredient is drawn only inside an opened strand, and always as an address", () => {
  // 27 ingredients across 20 of the 29 decomposed methods. Before they were
  // drawn, opening `hhl-qpe-inversion` showed nothing at all — all three of its
  // steps are things it needs rather than stages it passes through, so
  // `routeOf` returned one segment and the method read as having no recorded
  // structure at all.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    assert.equal(diagramFor(focus.id).feeds.length, 0, `${focus.id} draws ingredients unopened`);
  }
  let drawn = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const feed of diagram.feeds) {
        drawn += 1;
        assert.ok(feed.href.startsWith("/repository/layers/"), `${feed.key} is not an address`);
        assert.ok(feed.fullLabel.length > 0, `${feed.key} has no name`);
        assert.notEqual(feed.y0, feed.y1, `${feed.key} is a stub of no length`);
        assert.ok(
          feed.y1 > 0 && feed.y1 < diagram.height,
          `${feed.key} hangs off the canvas at ${feed.y1} of ${diagram.height}`,
        );
        // It must hang the way its strand bows, never back through the figure.
        assert.equal(
          Math.sign(feed.y1 - feed.y0),
          feed.outward,
          `${feed.key} hangs against its own direction`,
        );
      }
    }
  }
  assert.ok(drawn > 0, "no ingredient was drawn on any opening — the feature is inert");
});

test("a chain's column is wide enough for its widest step, taken once per step", () => {
  // The rule `place` depends on: a chain of k steps divides the column into k
  // equal shares, so the column must hold `k × widest`. The authored graph has
  // no chain long-named enough to make this bite — mutating the rule to plain
  // `max` left every figure green — so it is asserted here as the arithmetic it
  // is, against the property rather than against a figure.
  for (const needs of [[10], [10, 300, 20], [140, 140, 140], [5, 5], [0, 900, 1]]) {
    const column = chainColumnNeed(needs);
    for (const need of needs) {
      assert.ok(
        column / needs.length >= need,
        `${JSON.stringify(needs)}: a share of ${column / needs.length} cannot hold ${need}`,
      );
    }
  }
  assert.equal(chainColumnNeed([]), 0, "no steps need no column");
  assert.equal(chainColumnNeed([10, 300, 20]), 900);
  // Summing is the wrong answer and is wrong in the direction that clips.
  assert.ok(chainColumnNeed([10, 300, 20]) > 330, "the sum is not enough for an equal division");
});

test("on the overview, opening a line comes back to the overview", () => {
  // The four-root overview draws four figures at once, and each one's open
  // links are links to this same page. Built from the drawn subject they said
  // `focus=<that root>`, so a reader who asked to see inside one line lost the
  // other three drawings — the href was well-formed and landed on a perfectly
  // good page that was not the one they were on. Only following it could catch
  // that, so the shape of the link is pinned here.
  const node = layerNode(LAYER_GRAPH, "nonlinear-ode-solve");
  assert.ok(node && isCapability(node));
  const overview = layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus: node,
    locale: "en",
    focusParam: null,
  });
  for (const lane of overview.lanes) {
    if (!lane.openHref) continue;
    assert.ok(
      !lane.openHref.includes("focus="),
      `${lane.key} drags the reader to one figure: ${lane.openHref}`,
    );
    assert.ok(lane.openHref.startsWith("/repository/layers?open="));
  }
  // …and a focused figure keeps its focus, which is the same rule read the
  // other way: the link goes back to the page the reader is on.
  const focused = layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus: node,
    locale: "en",
  });
  for (const lane of focused.lanes) {
    if (!lane.openHref) continue;
    assert.ok(
      lane.openHref.includes("focus=nonlinear-ode-solve"),
      `${lane.key} loses the focus it is on: ${lane.openHref}`,
    );
  }
});

test("an ingredient's name stays on the canvas", () => {
  // A lane name is centred in a column sized to hold it, so it cannot escape. An
  // ingredient's name is drawn from its stub *rightwards* and had no such
  // guarantee: read on production, `Amplify a success branc` — clipped by the
  // viewport, with no ellipsis to say it had been cut, which is the
  // silent-truncation failure in its smallest form.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        const diagram = openDiagram(focus.id, open, locale);
        for (const feed of diagram.feeds) {
          const right = feed.x + 4 + estimateTextWidth(feed.label, M.laneFont);
          assert.ok(
            right <= diagram.width,
            `${focus.id} (${locale}): "${feed.label}" reaches ${right.toFixed(1)} ` +
              `on a canvas ${diagram.width} wide`,
          );
        }
      }
    }
  }
});

/**
 * The box a lane's name occupies, in the units the canvas draws in.
 *
 * `text-anchor="middle"` at `(labelX, labelY)`, so it is centred in x and sits on
 * its baseline in y. The 0.8 is the same ascent fraction `place` uses to lift a
 * name clear of the strand below it — one number, one place it came from.
 */
function nameBox(lane: ConvergeLane): { x0: number; x1: number; y0: number; y1: number } {
  const w = estimateTextWidth(lane.label, M.laneFont);
  return {
    x0: lane.labelX - w / 2,
    x1: lane.labelX + w / 2,
    y0: lane.labelY - M.laneFont * 0.8,
    y1: lane.labelY,
  };
}

/**
 * Does a lane's drawn body pass through this box?
 *
 * Sampled off the spine and inflated by the lane's own half-thickness rather than
 * parsed out of `outline`: the outline is a closed two-cubic path and a taper, so
 * inflating by the maximum half is the conservative reading — it can call a near
 * miss a hit but never the other way round.
 */
function laneEnters(lane: ConvergeLane, box: ReturnType<typeof nameBox>): boolean {
  const c = drawn(lane.d);
  const pad = lane.open ? 1 : lane.half;
  for (let i = 0; i <= 400; i += 1) {
    const [x, y] = pointOn(c, i / 400);
    if (x >= box.x0 && x <= box.x1 && y >= box.y0 - pad && y <= box.y1 + pad) return true;
  }
  return false;
}

test("an opened line draws its name, and the name is not worse placed than a shut one's", () => {
  // **The measurement that reversed a decision.** An opened lane used to draw no
  // name — `strand.open ? "" : fitLabel(...)` — and the comment above it recorded
  // a real collision: the name has to sit at the edge of its whole band, which is
  // where its neighbour's band begins, and `linear-ode-solve`'s curve ran through
  // it. That was measured two PRs before the angle cap existed, and the cap
  // multiplied the summed figure width by 7.5x. Re-measured with the pre-cap
  // geometry reconstructed: 68 of 128 opened names collided then, 6 do now.
  //
  // Meanwhile 128 of 337 lines drew nothing, so names appeared and vanished as
  // the reader clicked — the owner's *"labels that show up randomly"*.
  //
  // The bar here is deliberately **relative**, because an absolute one would be
  // stricter than the drawing it is defending: 33 of 209 *shut* names already
  // overlap something on a fully-opened figure. So the rule is that restoring the
  // opened names does not make the picture worse than it already is, plus a hard
  // ceiling so "worse" cannot creep up on both sides at once.
  //
  // Failable, which is the point: putting the name back at `half` (the thin spine
  // an opened lane draws) instead of `size.vHalf` (the band its children fill)
  // takes the opened collision rate past the shut one and this fails.
  let openedNamed = 0;
  let openedHit = 0;
  let shutNamed = 0;
  let shutHit = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const open = new Set(openableAddresses(focus.id));
    const diagram = openDiagram(focus.id, open);
    for (const lane of diagram.lanes) {
      if (lane.label === "") continue;
      const box = nameBox(lane);
      // Everything drawn on the figure except this lane's own centre line, which
      // its name is deliberately placed clear of and above.
      const hit = diagram.lanes.some((other) => other.key !== lane.key && laneEnters(other, box));
      if (lane.open) {
        openedNamed += 1;
        if (hit) openedHit += 1;
      } else {
        shutNamed += 1;
        if (hit) shutHit += 1;
      }
    }
  }
  assert.ok(openedNamed > 100, `only ${openedNamed} opened lanes drew a name`);
  assert.ok(shutNamed > 100, `only ${shutNamed} shut lanes drew a name`);
  const openedRate = openedHit / openedNamed;
  const shutRate = shutHit / shutNamed;
  // **The bar was `openedRate <= shutRate` and that turned out to punish an
  // improvement.** Authoring short forms narrowed the columns and took the shut
  // collisions from 28/209 to 23/209 while the opened ones stayed at 15/127 —
  // five fewer collisions on the figure in total, and the relative bar went red,
  // because the side that got better was the one the other was being compared
  // against. A guard that fails when the drawing improves is measuring the wrong
  // thing, and loosening it to `<= shutRate + something` would just be picking a
  // number that makes today pass.
  //
  // So: two absolute bars, both pinned to a measurement, which between them say
  // what the relative one was reaching for. An opened name is not systematically
  // worse placed than a shut one (the ceiling, which sits just above the shut
  // rate as measured before the opened names were ever restored), and the
  // picture as a whole does not get busier (the total). The failable case is
  // unchanged and is still checked by hand: putting the name back at `half` —
  // the thin spine an opened lane draws — instead of `size.vHalf`, the band its
  // children fill, takes opened collisions from 15 to 41 and trips both bars.
  // **The opened-name bar is gone, deliberately — read this before restoring it.**
  //
  // It asserted `openedRate < 0.134`, and its own comment above names the
  // failable case: *"putting the name back at `half` — the thin spine an opened
  // lane draws — instead of `size.vHalf`, the band its children fill, takes
  // opened collisions from 15 to 41 and trips both bars."* That is exactly what
  // the owner asked for in session 104: *"the name of the process line resides
  // there not in some surrounding area."* This bar was defending the placement
  // the owner has now rejected, so it cannot be the thing that decides it.
  //
  // It is not simply dropped. What changed underneath it is that a line crossing
  // an opened name **no longer makes the name unreadable**: an opened name is
  // drawn on an opaque plate (`.mj-converge-name-plate`) that rubs out the lines
  // behind the text. The crossing is structural and no reserved band removes it
  // — every child of an opened fan converges to its parent's spine at both ends,
  // so it enters the name's band near the ends of the span whatever room is left.
  // Measured on the curve: children clear the middle **76%** of the span and
  // cross the rest, and fitting the name to 76% of the column would machine-cut
  // exactly the names the owner asked not to be cut.
  //
  // **The hole this leaves, stated rather than papered over.** The plate lives in
  // `repository-converge-map.tsx`; this file measures the *layout* and cannot see
  // it. So nothing here proves the plate is drawn or that it covers the text.
  // Delete the plate today and every opened name goes illegible with **no test
  // going red**. That is owed work, and it is written up in NEXT.md rather than
  // left as a comment nobody counts.
  //
  // What survives is the half this file can see, plus a new test below for the
  // property that keeps the plate small enough to be honest.
  // **Both bars are now zero, and that is the tendons rather than a tightening
  // for its own sake.**
  //
  // They were `shutRate < 0.134` and `shutHit <= 28`, pinned to what the drawing
  // measured when a lane was a bow: every line converged to a point at both
  // circles, so it entered its neighbours' label bands near the ends of the span
  // whatever room was reserved. That is what the owner meant by *"labels and
  // lines don't cross structurally"* being the thing tendons would fix — and
  // measured over all 19 figures × both locales at saturation, they fix it
  // completely: **11 opened and 34 shut crossings before, 0 and 0 after.**
  //
  // So the bar is 0. A bar of 28 against a truth of 0 is a guard that has stopped
  // guarding: it would let twenty-eight crossings back in without a word, and the
  // whole reason this measurement exists is that a name with a line through it is
  // the defect the owner reported. If a graph change or a placement change puts
  // one back, that is a regression now, not a fact of the medium.
  //
  // The sweep is not vacuous — `openedNamed`/`shutNamed` are floored above, and a
  // positive control was run by hand: inflating the name box by 30px finds 128
  // names with a line nearby, so the detector sees lines. It is the crossings
  // that are gone.
  assert.equal(
    shutHit,
    0,
    `${shutHit}/${shutNamed} shut names have a line through them. This was 34 before the ` +
      `tendons and 0 after: a belly is level and its neighbours' bellies are level too, so a ` +
      `name is only crossed if something moved it off its own belly`,
  );
  assert.equal(
    openedHit,
    0,
    `${openedHit}/${openedNamed} opened names have a line through them. The plate is a backstop ` +
      `for this, not a licence for it`,
  );
  assert.ok(shutRate === 0 && openedRate === 0, "the two rates must follow the two counts");
});
test("a name on the bone stays inside the band the layout reserved for it", () => {
  // The half of the opened-name guard that survives in the layout, and the thing
  // that keeps `.mj-converge-name-plate` honest: a plate is only acceptable
  // because it is *small*.
  //
  // **The other half is `packages/ts/ui-visual/tests/converge-plate.spec.ts`**,
  // and it has to be somewhere else because this file cannot reach it: everything
  // here is a number the layout computed, and whether the plate is drawn at all —
  // or is opaque, or is painted before its own text — is a fact about the
  // renderer. That file also records the part neither half can gate on, which is
  // the ink: the app's face is loaded at build time by Next and is Latin-only, so
  // Japanese names fall back in production to the reader's own font.
  //
  // If an opened name drifted outside `spineBand` the
  // plate would be rubbing out whole branches rather than the few crossings near
  // the ends of the span, and "the name is readable" would have been bought by
  // erasing the drawing.
  //
  // Failable, checked by hand two ways: setting `labelY` back to
  // `peak.y - bandHalf - labelLift` (where an opened name sat before session 104)
  // puts every one of them a full fan-height clear of the bone and the first
  // assertion fails on the first figure; setting it to `peak.y` exactly — the
  // first attempt at "on the bone" — trips the second.
  let checked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = openDiagram(focus.id, new Set(openableAddresses(focus.id)));
    for (const lane of diagram.lanes) {
      // Fans only — `opensInto: "ways"`. A slot opens **across** into its
      // methods and keeps a clear middle to write in; a method opens **along**
      // into a chain whose steps sit *on* the spine (`place` hands them bow 0),
      // so there is no middle left and its name still sits outside the run. That
      // is the case the exoskeleton is for, and until it is drawn a chain's name
      // stays where it was. R12.3 is the same distinction.
      if (!lane.bone || lane.label === "") continue;
      // The bone read off its own drawn path, never rebuilt from `yc`/`bow`. The
      // helper that used to be reached for here assumed a flat base while a
      // nested strand sat on a piece of its parent's curve, and reconstructing
      // it that way put the bone at 519.7 for a name at 68 — the second
      // derivation this file's own comments keep warning about. A ribbon's base
      // *is* flat now, which removes the trap and not the reason for the rule.
      const [, spineY] = pointOn(drawn(lane.d), 0.5);
      const top = lane.labelY - M.laneFont * 0.8;
      const bottom = lane.labelY + M.laneFont * 0.2;
      assert.ok(
        top >= spineY - M.spineBand && bottom <= spineY + M.spineBand,
        `${lane.key}: name spans ${top.toFixed(1)}..${bottom.toFixed(1)} against a bone at ` +
          `${spineY.toFixed(1)} ±${M.spineBand} — a name on the bone left the bone's own band`,
      );
      // Above the stroke, not on it. The plate hides other lines; it must not
      // have to hide the line the name belongs to.
      assert.ok(
        bottom <= spineY - M.spineStroke / 2,
        `${lane.key}: name bottom ${bottom.toFixed(1)} sits on its own ${M.spineStroke}px stroke ` +
          `at ${spineY.toFixed(1)}`,
      );
      checked += 1;
    }
  }
  // 43 across all 18 figures fully opened — one per slot a reader can open into
  // its methods. Pinned just under the measurement so the sweep cannot quietly
  // become vacuous, which is a failure this repository has shipped before: a
  // guard whose subject list empties passes for everything.
  assert.ok(checked >= 40, `only ${checked} names on a bone checked`);
});

test("a name past the cap is cut, and the full text survives in the title", () => {
  // **The cap bites nothing on the authored graph, which is the intended state
  // and the reason this test exists.** Every label is either short enough or has
  // an authored `shortLabel`, so `labelCap` is a backstop against the next long
  // name somebody writes rather than a tool doing work today. A backstop nothing
  // has ever driven is a backstop nobody has tested — this repository has shipped
  // that shape of guard before — so the cap is driven here with a fixture instead
  // of waiting for the graph to grow into it.
  const long = "A".repeat(200);
  const graph: LayerGraph = {
    nodes: LAYER_GRAPH.nodes.map((node) =>
      node.id === "quantum-linear-solve"
        ? { ...node, label: long, labelJa: long, shortLabel: undefined, shortLabelJa: undefined }
        : node,
    ),
  };
  // Swept rather than aimed at one figure: which figures draw a given node as a
  // lane depends on the route walk, and a test that guessed wrong would report
  // "the cap does not bite" when what actually happened is that the name was
  // never on screen. That reads identically to a working cap.
  //
  // **Shut and saturated, because only one of the two ever reaches the cap.** A
  // column's `fit` is the widest thing in that column, and an opened chain
  // stacks its steps' widths into it — so a capped name sharing a column with an
  // opened run was fitted against the run's width rather than against the cap.
  // With every figure shut, no column on this graph is wide enough for that to
  // show, and this sweep ran shut-only while `fitLabel` took the raw column
  // width. It measured **445px against a 300px cap** the first time a nineteenth
  // slot widened one (session 106). Saturating is what makes the cap the
  // assertion rather than the column.
  const lanesOn = (slotId: string, open: ReadonlySet<string>) => {
    const focus = layerNode(graph, slotId);
    assert.ok(focus && isCapability(focus));
    return layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus, locale: "en", open }).lanes;
  };
  const drawn = drawableSlots(graph, STATE_VOCABULARY)
    .flatMap((slot) => [
      ...lanesOn(slot.id, new Set()),
      ...lanesOn(slot.id, new Set(openableAddresses(slot.id, graph))),
    ])
    .filter((lane) => lane.fullLabel === long);
  assert.ok(drawn.length > 0, "the fixture's long name is drawn on no figure at all");
  for (const lane of drawn) {
    assert.equal(lane.labelTruncated, true, "a 1272px name was not cut by a 300px cap");
    assert.ok(lane.label.endsWith("…"));
    // The cut respects the cap it was sized against, and the column did not grow
    // to fit the uncapped name — that second half is the part that would silently
    // stop being true if the cap were applied at `fitLabel` instead of at the
    // demand `measure` reports.
    assert.ok(
      estimateTextWidth(lane.label, M.laneFont) <= M.labelCap,
      `cut name is ${estimateTextWidth(lane.label, M.laneFont)}px, past the ${M.labelCap}px cap`,
    );
    // And the whole point: nothing was lost from the page. The `<title>` reads
    // `fullLabel`, so the reader still gets every character on hover.
    assert.equal(lane.fullLabel, long);
    assert.equal(lane.shortLabel, null, "a machine cut is not an authored short form");
  }
});

test("two ingredient names never overlap", () => {
  // **A latent defect the tendons made visible, and the reason it was latent.**
  //
  // `placeFeeds` spreads stubs at `(i+1)/(n+1)` along their strand and writes
  // each name from its own stub *rightwards*. `measure` asked the column for the
  // **widest single** stub name and never for `n` of them side by side, so a
  // method with three ingredients could always have written one over another —
  // it just happened not to while a strand's whole span was available. A belly is
  // shorter than the span it sits in, so the same spacing rule over a shorter run
  // brought it out: read on the rendered page at `hhl-qpe-inversion`,
  // *"Simulate Hamiltonian evolutiAmplify a success branch"*.
  //
  // Failable: deleting the `feedSpread` term from `measure`'s chain arm brings
  // that overlap straight back on this figure.
  let checked = 0;
  // **Every opening, not just saturation.** Saturation is the *widest* a column
  // ever gets, so it is the state least likely to show this: measured, the
  // overlap is 0 there and 8 across the partial openings. A sweep that only ever
  // fully opens a figure would have gone green over the defect that was on the
  // screen — which is what it did, until this loop was widened.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open, locale);
      // Grouped by the strand they hang off, because two stubs on two different
      // strands are at two different heights and a shared x means nothing.
      const rows = new Map<string, typeof diagram.feeds[number][]>();
      for (const feed of diagram.feeds) {
        const key = `${feed.y1}|${feed.outward}`;
        rows.set(key, [...(rows.get(key) ?? []), feed]);
      }
      for (const row of rows.values()) {
        const boxes = row
          .filter((feed) => feed.label !== "")
          .map((feed) => ({
            label: feed.label,
            x0: feed.x + 4,
            x1: feed.x + 4 + estimateTextWidth(feed.label, M.laneFont),
          }))
          .sort((a, b) => a.x0 - b.x0);
        for (let index = 1; index < boxes.length; index += 1) {
          checked += 1;
          assert.ok(
            boxes[index]!.x0 >= boxes[index - 1]!.x1,
            `${focus.id} (${locale}): "${boxes[index - 1]!.label}" runs into ` +
              `"${boxes[index]!.label}" — the belly is too short to stand ${boxes.length} ` +
              `ingredient names side by side`,
          );
        }
      }
      }
    }
  }
  // A guard over an empty set passes for the wrong reason: 117 stub instances
  // across the graph, most of them on methods with more than one.
  assert.ok(checked > 40, `only ${checked} adjacent ingredient pairs checked`);
});

test("no two names overlap on an opened figure either", () => {
  // **This used to be a budget. It is now zero, and the zero was not bought.**
  //
  // `two lane labels never overlap` above is absolute but only ever ran on
  // figures with **nothing open**. At full saturation the picture used to carry
  // 20 overlapping pairs: 8 shut-against-shut that predated the opened names, and
  // 12 more that came in with them. They were pinned by kind and shipped, because
  // the only fix measured at the time — widening the reserved label band from
  // 13px to 17px — removed 4 of the 20 and cost 16% more width and 14% more
  // height on every figure.
  //
  // All 20 are gone, and none of that was the cause. Two sessions removed them
  // for unrelated reasons: the remainder hop stopped printing a method's name a
  // second time (8 → 4, half of them were a name overlapping a *duplicate* of
  // another name), and then the fan allocator stopped centring a row that
  // contained the virtual spine. The second one is why the rest went: an odd
  // fan's half-band was measured as half a mirrored row it is not, so a parent
  // reserved less room than its own branches occupy and packed its siblings into
  // the shortfall. Correcting the measurement separated them.
  //
  // Pinned at 0 by kind rather than relaxed to a bound, so any of the three
  // kinds coming back is red and stays attributable.
  let openNames = 0;
  let shutNames = 0;
  const kinds = { shutShut: 0, openShut: 0, openOpen: 0 };
  for (const locale of ["en", "ja"] as const) {
    for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      const diagram = openDiagram(focus.id, openableAddresses(focus.id), locale);
      const drawn = diagram.lanes.filter((lane) => lane.label !== "");
      for (const lane of drawn) if (lane.open) openNames += 1;
        else shutNames += 1;
      for (let i = 0; i < drawn.length; i += 1) {
        for (let j = i + 1; j < drawn.length; j += 1) {
          const a = nameBox(drawn[i]!);
          const b = nameBox(drawn[j]!);
          if (!(a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS))
            continue;
          const openCount = Number(drawn[i]!.open) + Number(drawn[j]!.open);
          if (openCount === 2) kinds.openOpen += 1;
          else if (openCount === 1) kinds.openShut += 1;
          else kinds.shutShut += 1;
        }
      }
    }
  }
  // 254 opened / 264 shut since session 104. The shut side fell from over 300
  // because the remainder hops are shut lanes that stopped drawing a duplicate
  // name; the sweep still covers both sides heavily enough not to be vacuous.
  assert.ok(
    openNames > 200 && shutNames > 250,
    `${openNames} opened / ${shutNames} shut names drawn`,
  );
  assert.deepEqual(
    kinds,
    { shutShut: 0, openShut: 0, openOpen: 0 },
    `names overlap on a fully opened figure: ${kinds.shutShut} shut-against-shut, ` +
      `${kinds.openShut} opened-against-shut, ${kinds.openOpen} opened-against-opened. ` +
      `All three were 0 once the fan allocator stopped centring a row containing the spine`,
  );
});

/** The steepest the drawn path gets, as a slope. Sampled off `d`, never rebuilt. */
function steepestSlope(d: string): number {
  const path = drawn(d);
  // Sampled densely rather than evaluated where the steepest point is *supposed*
  // to be. "The steepest point is the middle of the tendon" is a property of this
  // family of curves, and asserting it against a formula that assumes it would be
  // the test agreeing with the emitter about the thing in question.
  const steps = 2000;
  const width = path.x1 - path.x0;
  if (width <= 0) return 0;
  let worst = 0;
  for (let i = 0; i < steps; i += 1) {
    const a = path.x0 + (width * i) / steps;
    const b = path.x0 + (width * (i + 1)) / steps;
    worst = Math.max(worst, Math.abs(drawnYAt(path.segments, b) - drawnYAt(path.segments, a)) / (b - a));
  }
  return worst;
}

test("every belly is level, and every rise happens inside a tendon", () => {
  // **What replaced the angle cap, and why it is not simply its removal.**
  //
  // `maxLaneAngleDeg` existed because *"no branch should be at such a steep angle
  // that it becomes weird to look at"*, and it bought that by widening the column
  // — `span ≥ 4·|bow|`, which is why a saturated figure measured 87,449px wide.
  // R14 says a tendon is not a branch: it carries no name, no destination and no
  // claim, so the reason for the cap does not reach it. What the cap was reaching
  // for is asserted directly here instead, and it is a stronger claim than an
  // angle: **the part of a line that carries anything is horizontal.** A name, a
  // fan of methods, a run of steps — all of it sits on a level belly.
  //
  // Failable, checked by hand three ways: emitting the belly as a `C` with any
  // bow in it fails the flatness sweep on the first figure; setting `run` to half
  // the span (so the belly is a point) fails the "a tendon is not the whole line"
  // arm; and letting each lane pick its own run from its own bow fails the shared
  // -run test below.
  let checked = 0;
  let steepest = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        const diagram = openDiagram(focus.id, open, locale);
        for (const lane of diagram.lanes) {
          const path = drawn(lane.d);
          checked += 1;
          // The belly is flat, at exactly `bellyY`, over its whole length.
          for (let step = 0; step <= 24; step += 1) {
            const x = lane.bellyX0 + ((lane.bellyX1 - lane.bellyX0) * step) / 24;
            close(
              drawnYAt(path.segments, x),
              lane.bellyY,
              `${focus.id} (${locale}) ${lane.key}: the belly is not level`,
              0.05,
            );
          }
          // And the belly is a real part of the line rather than a formality: a
          // ribbon that were all tendon would pass the sweep above vacuously.
          assert.ok(
            lane.bellyX1 - lane.bellyX0 >= 1,
            `${focus.id} (${locale}) ${lane.key}: belly is ${(lane.bellyX1 - lane.bellyX0).toFixed(1)}px ` +
              `long against a span of ${(lane.x1 - lane.x0).toFixed(1)} — the tendons ate the line`,
          );
          // The steepest the drawn curve gets is the slope the layout claims for
          // its tendon. Reported rather than capped (R14) — but it must be the
          // truth about the drawing, or the bound below is measured against
          // nothing.
          const drawnSlope = steepestSlope(lane.d);
          steepest = Math.max(steepest, drawnSlope);
          const claimed =
            lane.run <= 0 ? drawnSlope : (1.5 * Math.abs(lane.bow)) / lane.run;
          assert.ok(
            drawnSlope <= claimed + 0.02,
            `${focus.id} (${locale}) ${lane.key}: drawn slope ${drawnSlope.toFixed(3)} past the ` +
              `${claimed.toFixed(3)} its bow and run imply`,
          );
        }
      }
    }
  }
  // A guard over an empty set passes for the wrong reason.
  assert.ok(checked > 300, `only ${checked} lanes checked`);
  // Printed, not barred. A tendon is *allowed* past 45°, and the number is worth
  // having in the log because it is the thing the owner traded readability of the
  // whole figure for. Measured at saturation across every figure and both
  // locales.
  assert.ok(
    steepest >= 0,
    `steepest tendon on any figure: ${(Math.atan(steepest) * 180 / Math.PI).toFixed(1)}deg`,
  );
});

test("a row of siblings shares one run — the crossing-free precondition", () => {
  // The whole geometry is `base + bow·φ(x)` for **one** φ per row, and φ is built
  // from the run. Two siblings with different runs are not a one-parameter family
  // and can cross between their bellies without touching a circle;
  // `repository-strand-geometry.test.ts` drives exactly that case with two
  // ribbons and shows the ordering break.
  //
  // So this is the layout-side half: the obvious implementation — each lane takes
  // `tendonRunFor(its own bow)` — is what it forbids.
  let rows = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open, "en");
      const byRow = new Map<string, ConvergeLane[]>();
      for (const lane of diagram.lanes) {
        const key = `${lane.parentKey ?? "-"}#${lane.x0}>${lane.x1}`;
        byRow.set(key, [...(byRow.get(key) ?? []), lane]);
      }
      for (const [key, row] of byRow) {
        if (row.length < 2) continue;
        rows += 1;
        const runs = new Set(row.map((lane) => lane.run));
        assert.equal(
          runs.size,
          1,
          `${focus.id} row ${key}: ${[...runs].join(", ")} — siblings drew different runs, ` +
            `so they are no longer offsets of one shape and may cross between their bellies`,
        );
      }
    }
  }
  assert.ok(rows > 100, `only ${rows} sibling rows checked`);
});

test("a tendon's run is bounded, and every strand gets one", () => {
  // The number that replaced `span ≥ 4·|bow|`, checked as arithmetic so it does
  // not depend on the graph happening to contain a big enough fan.
  assert.equal(tendonRunFor(0), M.minTendonRun, "a straight strand still tapers");
  assert.equal(tendonRunFor(-137), tendonRunFor(137), "sign-blind: up costs what down costs");
  // Monotone up to the ceiling, then flat — and the ceiling is the point. Under
  // the old law a bow of 2300 demanded a 9200px column; here it demands 220.
  let previous = -1;
  for (const bow of [0, 10, 55, 120, 400, 2300]) {
    const run = tendonRunFor(bow);
    assert.ok(run >= previous, `tendonRunFor(${bow}) = ${run} went backwards`);
    assert.ok(run <= M.maxTendonRun, `tendonRunFor(${bow}) = ${run} passed the ceiling`);
    previous = run;
  }
  assert.equal(tendonRunFor(2300), M.maxTendonRun, "the ceiling must actually be reached");
  // `runAcross` takes the row's widest demand, and clamps so a belly cannot
  // invert.
  assert.equal(runAcross([0, 40, -900], Number.POSITIVE_INFINITY), M.maxTendonRun);
  assert.equal(runAcross([0, 0], 20), 10, "a short range clamps the run to half of it");
  // And on the drawing: no lane anywhere is drawn past the ceiling.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      for (const lane of openDiagram(focus.id, open, "en").lanes) {
        assert.ok(
          lane.run <= M.maxTendonRun + 1e-9,
          `${focus.id} ${lane.key}: run ${lane.run} past the ${M.maxTendonRun} ceiling`,
        );
      }
    }
  }
  // And the figure still grows when a fan opens, which is the owner's other
  // request — *"distances between states should increase as branches between
  // them are opened out"* — and the behaviour that was missing entirely before
  // the angle cap: a seven-method fan used to add 322px of height and exactly
  // 0px of width.
  const shut = openDiagram("nonlinear-ode-solve", []);
  const opened = openDiagram("nonlinear-ode-solve", ["linear-ode-solve"]);
  assert.ok(
    opened.width > shut.width,
    `opening a 7-method fan left the figure ${opened.width} wide, was ${shut.width}`,
  );
});

test("every belly is long enough to hold the name written on it", () => {
  // The invariant that says `runAcross`'s clamp never bites. The column is sized
  // with the runs already in it (`Measure.hRun`), so a belly should always be at
  // least as long as the name centred on it; if the sizing ever forgot a level of
  // recursion, the clamp would quietly shorten the run instead and the name would
  // hang off both ends of its own belly.
  //
  // Failable by hand: dropping the `2 * minTendonRun` from the chain arm of
  // `hRun` fails this on a nested chain, and dropping the run term from the
  // column's `span` fails it on the first figure with a wide fan.
  let checked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = openDiagram(focus.id, openableAddresses(focus.id), locale);
      for (const lane of diagram.lanes) {
        if (lane.label === "") continue;
        checked += 1;
        assert.ok(
          lane.bellyX1 - lane.bellyX0 >= lane.labelWidth - 0.01,
          `${focus.id} (${locale}) ${lane.key}: "${lane.label}" is ${lane.labelWidth.toFixed(1)}px ` +
            `wide on a belly ${(lane.bellyX1 - lane.bellyX0).toFixed(1)}px long`,
        );
      }
    }
  }
  assert.ok(checked > 300, `only ${checked} named lanes checked`);
});

test("every address a figure emits keeps the reader where they were standing", () => {
  // Measured on production before this: of 83 links to `/repository/layers*` on
  // the overview, 5 carried `at=` — and all 5 were the size rungs, which set
  // their own. So every "open this line in place" click threw the reader's pan
  // and zoom away and re-rendered them at the origin at 100%. The figure stayed
  // put; the reader did not, and that is most of what "it does not feel like one
  // continuous surface" was.
  const AT = "120,-40,1.5";
  let checked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const node = layerNode(LAYER_GRAPH, focus.id);
    assert.ok(node && isCapability(node));
    for (const open of openings(focus.id)) {
      const carried = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus: node,
        locale: "en",
        open,
        at: AT,
      });
      const addresses = [
        ...carried.lanes.flatMap((lane) => [lane.href, lane.openHref]),
        ...carried.states.map((state) => state.href),
        ...carried.feeds.map((feed) => feed.href),
      ].filter((href): href is string => typeof href === "string");
      assert.ok(addresses.length > 0, `${focus.id} emitted no addresses`);
      for (const href of addresses) {
        checked += 1;
        assert.ok(
          href.includes(`at=${encodeURIComponent(AT)}`),
          `${focus.id}: ${href} dropped the viewport`,
        );
      }
      // And what the reader had open, on the addresses that go to a node's own
      // page. This half shipped broken once: the node page was taught to honour
      // `?open=` and nothing sent it, so 0 of 16 node links carried one and the
      // set still died on every name click. It was "verified" by hand-writing
      // the URL the page receives, which tests the receiving half and nothing
      // else — a link is not verified until something has followed it.
      if (open.size > 0) {
        const toNodePages = [
          ...carried.lanes.map((lane) => lane.href),
          ...carried.states.map((state) => state.href),
          ...carried.feeds.map((feed) => feed.href),
        ].filter((href) => href.startsWith("/repository/layers/"));
        for (const href of toNodePages) {
          for (const id of open) {
            assert.ok(
              href.includes(`open=${encodeURIComponent(id)}`),
              `${focus.id}: ${href} dropped ${id} from what the reader had open`,
            );
          }
        }
      }
      // And the default stays clean — stamping `at=0,0,1` onto every link would
      // make a bare address impossible to produce.
      const bare = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus: node,
        locale: "en",
        open,
      });
      for (const lane of bare.lanes) {
        assert.ok(!lane.href.includes("at="), `${focus.id}: ${lane.href} invented a viewport`);
      }
    }
  }
  assert.ok(checked > 200, `only ${checked} addresses checked`);
});

test("a line never offers a click it will not honour", () => {
  // Measured before this: 39 lines advertised "opens into N", carried a live
  // open link, had their id in `?open=` — and rendered shut, all 39 stopped by
  // the depth cap, 27 of them on one figure. `inside` was set unconditionally
  // from the child count while opening was gated on the cap, so the two
  // disagreed at the ceiling. A control that does nothing does not read as a
  // limit; it reads as a broken surface.
  let offered = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const node = layerNode(LAYER_GRAPH, focus.id);
    assert.ok(node && isCapability(node));
    // Everything the surface will let a reader open, which is how a reader
    // reaches the ceiling in the first place.
    const open = new Set(openableAddresses(focus.id));
    const diagram = layoutConverge({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      focus: node,
      locale: "en",
      open,
    });
    for (const lane of diagram.lanes) {
      if (lane.openHref === null) continue;
      offered += 1;
      // The link is honoured if following it changes the drawing: either it is
      // open now and the link shuts it, or it is shut and the link opens it.
      if (lane.open) continue;
      assert.ok(
        !open.has(lane.address),
        `${focus.id}: ${lane.key} is named in ?open=, is drawn shut, and still offers a click`,
      );
    }
  }
  assert.ok(offered > 50, `only ${offered} open links seen`);
});

test("shutting a lane removes every form that was holding it open", () => {
  // `?open=` is user-supplied and shareable, so it can carry the address **and**
  // the legacy node id for the same lane — a state no click can produce and a
  // hand-edited or forwarded URL can. The first version of `toggleHref` was an
  // if/else-if: it dropped the address, the id went on holding the lane open,
  // and the shut control did nothing. That is the dead-control failure this
  // canvas has now produced twice, and no test covered it — the mutation that
  // restores the if/else-if passed the whole suite. Caught in review.
  const shut = openDiagram("nonlinear-ode-solve", []);
  const lane = shut.lanes.find((one) => one.openHref !== null && one.nodeId);
  assert.ok(lane?.nodeId, "no openable lane with a node id");

  const both = new Set([lane.address, lane.nodeId]);
  const opened = openDiagram("nonlinear-ode-solve", both);
  const drawn = opened.lanes.find((one) => one.key === lane.key);
  assert.ok(drawn?.open, "the lane is not open under both forms, so the case is not being tested");
  assert.ok(drawn.openHref, "an open lane offers no shut control");

  const after = new URL(drawn.openHref, "https://example.invalid").searchParams.getAll("open");
  assert.ok(!after.includes(lane.address), "the shut link still names the address");
  assert.ok(!after.includes(lane.nodeId), "the shut link still names the node id");
  // And the drawing agrees, which is the part the reader sees.
  const reopened = openDiagram("nonlinear-ode-solve", after);
  assert.equal(
    reopened.lanes.find((one) => one.key === lane.key)?.open,
    false,
    "following the shut link leaves the lane open",
  );
});

test("one address opens a lane on one figure, even when four are drawn at once", () => {
  // **The defect this test exists for shipped to a preview deployment.**
  //
  // A root address was `${bundleIndex}.${laneIndex}` — a position with no
  // figure in it. The unfocused surface draws all four roots and hands every one
  // of them the same `?open=` set, so `?open=0.0` opened a lane on **three of
  // the four**: the exact multi-open defect addresses were introduced to kill,
  // reintroduced one level up where the per-figure tests could not see it.
  //
  // Every test around this one builds a single figure, which is why none of them
  // could fail on it. This one draws the surface the way the page does.
  const roots = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).slice(0, 4);
  assert.ok(roots.length >= 3, "need several figures to check for a collision between them");

  const addressesByFigure = roots.map((root) => {
    const shut = openDiagram(root.id, []);
    return {
      id: root.id,
      addresses: shut.lanes.filter((lane) => lane.openHref !== null).map((lane) => lane.address),
    };
  });

  // No two figures share an address at all — the property, asserted directly.
  const owner = new Map<string, string>();
  for (const figure of addressesByFigure) {
    for (const address of figure.addresses) {
      const already = owner.get(address);
      assert.ok(
        already === undefined || already === figure.id,
        `${address} is a lane on both ${already} and ${figure.id}, so one ?open= opens both`,
      );
      owner.set(address, figure.id);
    }
  }

  // And the consequence, measured the way the page produces it: one address in
  // the set, every figure drawn, exactly one lane newly open across all of them.
  const probe = addressesByFigure.find((figure) => figure.addresses.length > 0);
  assert.ok(probe, "no figure offers an open control");
  const address = probe.addresses[0]!;
  let openedBefore = 0;
  let openedAfter = 0;
  for (const root of roots) {
    openedBefore += openDiagram(root.id, []).lanes.filter((lane) => lane.open).length;
    openedAfter += openDiagram(root.id, [address]).lanes.filter((lane) => lane.open).length;
  }
  assert.equal(
    openedAfter - openedBefore,
    1,
    `?open=${address} opened ${openedAfter - openedBefore} lanes across ${roots.length} figures`,
  );
});

test("a node id in ?open= still opens what it always opened", () => {
  // The back-compatible half of the re-keying, and the half a sweep over
  // addresses cannot reach. Links to this surface are already written down — in
  // the owner's notes, in whatever has been shared — and every one of them names
  // a node. They must keep working, and an id must keep meaning what it meant:
  // *every* lane that node is drawn on, which is why it was the wrong key.
  const FOCUS = "nonlinear-ode-solve";
  const openedBy = (d: ConvergeDiagram) => d.lanes.filter((one) => one.open).length;

  // Every openable lane on the shut figure keeps opening under its id.
  const shut = openDiagram(FOCUS, []);
  let checked = 0;
  for (const lane of shut.lanes) {
    if (lane.openHref === null || !lane.nodeId) continue;
    checked += 1;
    assert.ok(
      openedBy(openDiagram(FOCUS, [lane.nodeId])) > openedBy(shut),
      `?open=${lane.nodeId} opened nothing, so an already-written link is now dead`,
    );
  }
  assert.ok(checked > 0, "no openable lane with a node id to check");

  // And the id form still does the thing the address form was built to stop. A
  // node only holds several positions *below* the figure's own level, so this
  // has to walk down to a state where one does — from the shut figure, every id
  // names exactly one lane and the two forms are indistinguishable, which is how
  // the first draft of this test passed while proving nothing.
  const ancestors: string[] = [];
  let found: { id: string; address: string } | null = null;
  for (let step = 0; step < 6 && !found; step += 1) {
    const diagram = openDiagram(FOCUS, ancestors);
    const positions = new Map<string, string[]>();
    for (const lane of diagram.lanes) {
      if (lane.openHref === null || !lane.nodeId || lane.open) continue;
      positions.set(lane.nodeId, [...(positions.get(lane.nodeId) ?? []), lane.address]);
    }
    for (const [id, addresses] of positions) {
      if (addresses.length > 1) {
        found = { id, address: addresses[0]! };
        break;
      }
    }
    if (found) break;
    for (const lane of diagram.lanes) {
      if (lane.openHref !== null && !lane.open) ancestors.push(lane.address);
    }
  }
  assert.ok(found, "no node holds two shut openable positions — is the id path still distinct?");
  const byId = openedBy(openDiagram(FOCUS, [...ancestors, found.id]));
  const byAddress = openedBy(openDiagram(FOCUS, [...ancestors, found.address]));
  assert.ok(
    byId > byAddress,
    `${found.id} opens ${byId} lanes and its address opens ${byAddress} — the two forms have become one`,
  );
});
