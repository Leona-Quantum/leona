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
  besideNameReach,
  chainColumnNeed,
  laneOffsets,
  reservedHalfHeight,
  tendonRunFor,
  runAcross,
  firstOrderRun,
  layoutConverge,
  layoutConvergeForMethod,
  legendMark,
  loopAllowance,
  ownStepName,
  openableAddresses as saturatedOpen,
  spokenName,
  type ConvergeDiagram,
  type ConvergeLane,
} from "./repository/converge-layout.ts";
import type { LayerGraph } from "./repository/layers.ts";
import { PATH_LIMITS, expansionOf, methodFanOf } from "./repository/state-graph.ts";
import {
  estimateTextWidth,
  NAME_ASCENT_RATIO,
  NAME_DESCENT_RATIO,
} from "./repository/process-layout.ts";
import { levelShares, ribbonY } from "./repository/strand-geometry.ts";
import {
  isCapability,
  isMethod,
  layerNode,
  methodsRealizing,
  REFINES_MARK_MAX,
  REPEAT_MARK_MAX,
  rootCapabilities,
  routeOf,
  type LayerCapability,
  type LayerMethod,
} from "./repository/layers.ts";
import { cardFor, ownCardId } from "./repository/card-content.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { stateSatisfies, type StateVocabulary } from "./repository/states.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import type { PublicLocale } from "./public-locale.ts";

const M = CONVERGE_METRICS;
const EPS = 1e-6;

/**
 * What `cardFor` needs, with an empty corpus.
 *
 * Empty because no assertion in this file reads the *Records* section — the
 * join to the repository is `repository-map-card.test.ts`'s subject. Declared
 * up here rather than beside the card block because two sections now build
 * cards: that one, and the guard that ingredients left the canvas for one.
 */
const CARD_INPUT = {
  graph: LAYER_GRAPH,
  vocabulary: STATE_VOCABULARY,
  corpus: [],
  locale: "en",
  register: PAPER_REGISTER,
} as const;

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

/**
 * Lanes grouped by the pair of circles they run between.
 *
 * Keyed by parent **and** span, not span alone. The span was only ever a proxy
 * for "between the same two circles", and W14 broke the proxy: the nonlinear
 * figure now holds two parallel runs of hops between the same outer circles
 * (simulate → estimate beside discretize → linear-solve), whose interior lanes
 * share an x-range while living inside different ways across. `parentKey` is
 * carried on the lane for exactly this — grouping by recovered structure is the
 * mistake this file has already paid for once.
 */
function bundlesOf(diagram: ConvergeDiagram): ConvergeLane[][] {
  const bySpan = new Map<string, ConvergeLane[]>();
  for (const lane of diagram.lanes) {
    const key = `${lane.parentKey ?? "figure"}#${lane.x0}>${lane.x1}`;
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
  // And the deeper ones that do appear are the objects inside the runs of two
  // hops, which this figure draws as chains because they are chains. Two since
  // W14: discretize → linear-solve hands on `linear-system`, and the KvN
  // wiring's simulate → estimate hands on `runnable-evolution` — each drawn
  // once, which is the same claim the depth-0 assertion makes one level up.
  const inner = diagram.states.filter((state) => state.depth > 0);
  assert.deepEqual(
    inner.map((state) => state.stateId),
    ["linear-system", "runnable-evolution"],
    "each run of two hops names the object it hands on halfway",
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
  // ONE arriving lane since session 119, and that is the dedup rather than a
  // loss: the second was the Koopman-von Neumann narrowing drawn beside the
  // embedding lane whose fan already contains it — the same route listed
  // twice. At slot grain one embedding arrives; the several ways in are its
  // fillers, which is what `crossingsAt` counts at the grain where "several"
  // is true.
  assert.equal(shared.arriving, 1, `${shared.arriving} lanes arrive`);
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
  // **Driven with even bands on purpose.** This test and the next are about the
  // allocator's odd/even packing, which predates the one-sided name band and did
  // not change with it; `even` keeps them asking their own question. What the
  // asymmetry does is a separate test below, so that a regression in one is not
  // mistakable for a regression in the other.
  const even = (half: number) => ({ above: half, below: half });
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
    const offsets = allocateBowsAroundSpine(halves.map(even), 0, gap, even(spineHalf));
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
  assert.deepEqual(allocateBowsAroundSpine([], 0, gap, even(spineHalf)), []);
});

test("a fan reserves the band its own branches reach, not half of a summed row", () => {
  // The measurement half of the same bug. `measure` used to return
  // `spread / 2`, which is the true half-band only when the two groups mirror
  // each other — and `mid` is a ceil, so for an odd fan they never do.
  //
  // Failable: `spread / 2 + labelBand` for the first case below is 47 against a
  // drawing that reaches 72, so the parent reserved a band its own child
  // overflowed by 25px and the siblings it was packed against never knew.
  const even = (half: number) => ({ above: half, below: half });
  for (const halves of [[20], [20, 20, 20], [140, 20, 20]]) {
    const offsets = allocateBowsAroundSpine(halves.map(even), 0, M.laneGap, even(M.spineBand));
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
    const offsets = allocateBowsAroundSpine(halves.map(even), 0, M.laneGap, even(M.spineBand));
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

/**
 * Every shut figure the canvas draws, for the two name sweeps below: the map's
 * slot figures and every method's own page (the D119.1 population — a method's
 * page fans a slot the map may keep as a state chain, so the pages are whole
 * figures no slot sweep contains).
 *
 * `drawableSlots`, not `convergingSlots`: the sweeps read the latter for years,
 * and it holds exactly ONE capability — so the slot half of each "sweep" was a
 * single figure per locale. Per-source floors rather than one total, so a
 * refactor of either list cannot quietly empty it while the other keeps the
 * count respectable. Measured: 19 slot figures, 63 method pages, none empty.
 */
function shutFigures(locale: PublicLocale): [string, ConvergeDiagram][] {
  const slots: [string, ConvergeDiagram][] = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map(
    (focus) => [focus.id, diagramFor(focus.id, locale)],
  );
  const pages: [string, ConvergeDiagram][] = [];
  for (const id of METHOD_IDS) {
    const diagram = pageFigure(id, locale);
    if (!diagram.empty) pages.push([`${id} (page)`, diagram]);
  }
  assert.ok(slots.length >= 15, `only ${slots.length} slot figures swept`);
  assert.ok(pages.length >= 60, `only ${pages.length} method pages swept`);
  return [...slots, ...pages];
}

test("every lane label stays inside the canvas", () => {
  // Three of the four collisions the old canvas shipped were <text> against
  // <text>, and every invariant it had was about lines and circles. Nameless
  // lanes are excluded for the same reason the overlap sweep excludes them:
  // the subject is a drawn name, and a nameless lane draws none.
  for (const locale of ["en", "ja"] as const) {
    for (const [name, diagram] of shutFigures(locale)) {
      for (const lane of diagram.lanes) {
        if (lane.label === "") continue;
        const half = estimateTextWidth(lane.label, M.laneFont) / 2;
        assert.ok(lane.labelX - half >= 0, `${locale}/${name}/${lane.key} label off the left edge`);
        assert.ok(
          lane.labelX + half <= diagram.width,
          `${locale}/${name}/${lane.key} label off the right edge`,
        );
        assert.ok(
          lane.labelY - M.laneFont >= 0,
          `${locale}/${name}/${lane.key} label above the canvas`,
        );
        assert.ok(
          lane.labelY <= diagram.height,
          `${locale}/${name}/${lane.key} label below the canvas`,
        );
      }
    }
  }
});

test("two lane labels never overlap", () => {
  for (const locale of ["en", "ja"] as const) {
    // Both surfaces that draw this canvas, not just the map — see `shutFigures`
    // for the population and D119.1 for why the method pages are load-bearing.
    for (const [name, diagram] of shutFigures(locale)) {
      // `label !== ""` is the subject, not a soft spot: a nameless lane draws
      // no name to collide, and its box would be a point that could sit inside
      // a real name's box and report a collision no reader can see. Same rule
      // as `no two names overlap on an opened figure either`.
      // `nameBox`, not a fourth inlined copy of it. This test carried its own
      // `[labelY − laneFont, labelY]`, the opened twin carried
      // `[labelY − laneFont·0.8, labelY]`, and the click-target test a third
      // shape again — three boxes for one piece of text, and the two that
      // mattered were both short by a descender. See `nameBox`.
      const boxes = diagram.lanes
        .filter((lane) => lane.label !== "")
        .map((lane) => ({ key: lane.key, ...nameInkBox(lane) }));
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          const hit = a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS;
          assert.ok(!hit, `${locale}: labels of ${a.key} and ${b.key} overlap on ${name}`);
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
          // A leaf's name sits IN its own line by design (owner, session 119)
          // — the lozenge plate is what keeps it readable there, exactly as on
          // a bone. Every OTHER lane's curve must still stay out of it.
          if (lane.labelInside && other.key === lane.key) continue;
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
  // 22 since W21 — the variational region added `ground-state-energy`,
  // `ansatz-construction` and `parameter-optimization`, and this assertion is
  // exactly the tripwire that made their three new figures get looked at.
  // **23 since W21-E**, which added `excited-state-energy`, and the tripwire did
  // its job a second time: its figure is the one that pushed the four-root
  // overview past `CONVERGE_OPEN_MAX` (see that constant's own note).
  assert.equal(capabilities.length, 23, "the graph's slot count changed; update these figures");

  for (const focus of capabilities) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = diagramFor(focus.id, locale);
      assert.equal(diagram.empty, false, `${focus.id} (${locale}) draws nothing`);
      assert.ok(diagram.lanes.length > 0, `${focus.id} (${locale}) has no lanes`);
      assert.ok(diagram.states.length >= 2, `${focus.id} (${locale}) has fewer than two circles`);
    }
  }

  // The split is measured, not assumed: 1 slot has an interior chain every
  // filler walks and the other 18 are method fans. If a future edit gives a
  // method its own contract this number moves, and moving it should be a
  // deliberate edit here.
  // 16 → 17 in session 106: `hamiltonian-recasting`'s two methods are both
  // atomic, so it fans them rather than drawing a chain.
  // 17 → 18 in session 119: `linear-ode-solve`'s chain was refuted by three
  // of its own methods' `bypasses`, so it fans (`drawsAsStateChain`).
  // 18 → 21 in W21: the variational region's three slots all fan. Worth stating
  // why none of them draws a chain, since `ground-state-energy` looks like it
  // should — its three fillers walk different interiors (VQE has three hops,
  // variational imaginary time has two, QITE is undecomposed), so there is no
  // one chain every filler walks, which is exactly the condition for a fan.
  // 21 → 22 in W21-E: `excited-state-energy` fans too, for the same reason its
  // ground-state sibling does — its seven fillers walk different interiors (four
  // take VQE's three hops, two close the whole stretch themselves off a
  // ground-state ingredient, and the deflation route does both), so there is no
  // one chain every filler walks.
  const byGrain = capabilities.map((focus) => diagramFor(focus.id).grain);
  assert.equal(byGrain.filter((grain) => grain === "states").length, 1);
  assert.equal(byGrain.filter((grain) => grain === "methods").length, 22);
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
  // 22 since W21, 23 since W21-E — the same new slots the figure test above
  // pins, and the point of asserting the length beside the deepEqual is that two
  // empty lists are also deep-equal.
  assert.equal(offered.length, 23);

  // And it is still a strict superset of the convergence claim, which is a
  // different and narrower statement — narrower by one since session 119,
  // when `linear-ode-solve` stopped qualifying (`drawsAsStateChain`).
  const converging = convergingSlots(LAYER_GRAPH, STATE_VOCABULARY).map((slot) => slot.id);
  assert.equal(converging.length, 1);
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
  // 22 slots less the one this fixture empties. Written as the arithmetic it is,
  // so the two numbers cannot drift apart the next time a region is added.
  assert.equal(strippedOffer.length, offered.length - 1);
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
        // Not truncated means the whole drawn string reached the canvas — the
        // name **and** whatever is marked on it. Re-derived here rather than
        // read from `drawnName`, which is the function this is checking: a
        // shared helper would agree with itself no matter what it composed.
        //
        // The `⊂ <mark>` suffix is deliberately absent from this derivation
        // (W13): a refinement is drawn by *nesting* now — under its parent,
        // inside the bracket — and its drawn name is just its name. The
        // relation still reaches a reader through `spokenName`, which the
        // refinement census asserts.
        assert.equal(
          lane.label,
          `${lane.shortLabel ?? lane.fullLabel}${
            lane.repeatMark === null ? "" : ` ${lane.repeatMark}`
          }`,
        );
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

// The narrowed-lane NAMING test that stood here retired with its subject in
// session 119: the single-edge narrowed lane it read was the duplicate the
// dedup in `expansionOf` removes, so on this corpus the naming branch of
// `laneName` has no drawn instance left ("a narrowing is not a second lane
// beside the slot whose fan already contains it", below, is what replaced the
// drawing). The branch itself stays — a narrowing with NO plain sibling still
// draws, named after its filler — and the fixture below is its witness.

test("a narrowing with no plain sibling still draws, named after its filler", () => {
  // Built, because the corpus cannot reach the branch any more: every
  // narrowing the authored graph records has a plain sibling, and the
  // session-119 dedup removes exactly those. The branch survives for the
  // other shape — a plain edge that completes no path while the narrowed
  // landing does — so this graph is that shape. `fx-encode` promises the
  // broad form and nothing departs from the broad form, so the plain edge is
  // a dead end and never becomes a lane; the only way across is `fx-route`,
  // whose `through` lands the encoding on the sharp form and whose `via` pins
  // `fx-sharp-lift` as the filler that does it.
  const vocabulary: StateVocabulary = {
    states: [
      { id: "fx-problem", label: "fx-problem", labelJa: "fx-problem", summary: "", summaryJa: "" },
      {
        id: "fx-broad-form",
        label: "fx-broad-form",
        labelJa: "fx-broad-form",
        summary: "",
        summaryJa: "",
      },
      {
        id: "fx-sharp-form",
        label: "fx-sharp-form",
        labelJa: "fx-sharp-form",
        summary: "",
        summaryJa: "",
        specializes: ["fx-broad-form"],
      },
      { id: "fx-answer", label: "fx-answer", labelJa: "fx-answer", summary: "", summaryJa: "" },
    ],
  };
  const slot = (id: string, label: string, from: string, to: string): LayerCapability => ({
    kind: "capability",
    id,
    label,
    labelJa: `${label} (ja)`,
    summary: "",
    summaryJa: "",
    whyALayer: "",
    whyALayerJa: "",
    contract: { from, to, takes: "", takesJa: "", returns: "", returnsJa: "" },
  });
  const routeBase = {
    kind: "method",
    id: "fx-route",
    label: "The whole route",
    labelJa: "The whole route (ja)",
    summary: "",
    summaryJa: "",
    realizes: "fx-solve",
    steps: ["fx-encode", "fx-finish"],
    through: { "fx-encode": "fx-sharp-form" },
  } as const;
  const shared = [
    slot("fx-solve", "Solve the fixture problem", "fx-problem", "fx-answer"),
    slot("fx-encode", "Encode into the broad form", "fx-problem", "fx-broad-form"),
    slot("fx-finish", "Finish from the sharp form", "fx-sharp-form", "fx-answer"),
    {
      kind: "method",
      id: "fx-sharp-lift",
      label: "The sharp lift",
      labelJa: "The sharp lift (ja)",
      summary: "",
      summaryJa: "",
      realizes: "fx-encode",
      steps: [],
      atomic: true,
    },
  ] as const;
  const graph: LayerGraph = {
    nodes: [...shared, { ...routeBase, via: { "fx-encode": "fx-sharp-lift" } }],
  };
  const focus = layerNode(graph, "fx-solve");
  assert.ok(focus && isCapability(focus));

  // The precondition, pinned so a later edit cannot quietly turn this into a
  // slot-lane test: the walk admits exactly one way across the first bundle,
  // it is a single-edge narrowing, and it SURVIVES the dedup because no plain
  // sibling exists to absorb it.
  const expansion = expansionOf(graph, vocabulary, focus);
  assert.equal(expansion.atomicAtThisLevel, false);
  assert.deepEqual(expansion.chain, ["fx-problem", "fx-sharp-form", "fx-answer"]);
  const bundle = expansion.bundles[0]!;
  assert.equal(bundle.lanes.length, 1, "the narrowing must be the bundle's only lane");
  assert.equal(bundle.lanes[0]!.edges.length, 1, "the drawn lane must be a single edge");
  assert.equal(bundle.lanes[0]!.edges[0]!.narrowedBy, "fx-sharp-lift");

  // The behaviour the retired test pinned on the corpus, now pinned here: the
  // lane is the filler's own line — its name, its page — and the slot's name
  // is nowhere on the figure, because naming it after the slot would say the
  // broad landing is on a path when no path takes it.
  for (const locale of ["en", "ja"] as const) {
    const diagram = layoutConverge({ graph, vocabulary, focus, locale });
    assert.equal(diagram.grain, "states");
    const wanted = locale === "en" ? "The sharp lift" : "The sharp lift (ja)";
    const named = diagram.lanes.filter((lane) => lane.fullLabel === wanted);
    assert.equal(
      named.length,
      1,
      `${locale}: the filler's name is drawn ${named.length} times, expected exactly once`,
    );
    assert.ok(
      named[0]!.href === "/repository/layers/fx-sharp-lift" ||
        named[0]!.href.startsWith("/repository/layers/fx-sharp-lift?"),
      `${locale}: the narrowed lane's name points at ${named[0]!.href}, not at its filler's page`,
    );
    assert.equal(named[0]!.draws, "fx-sharp-lift");
    assert.deepEqual(
      diagram.lanes
        .filter((lane) => lane.fullLabel.startsWith("Encode into the broad form"))
        .map((lane) => lane.fullLabel),
      [],
      `${locale}: a narrowing with no plain sibling must not be named after its slot`,
    );
  }

  // And the branch's own string, through the one consumer that reads it
  // verbatim rather than re-deriving it from the filler node: `crossingsAt`
  // names a filler-less way by what `laneName` returned. A narrowing pinned by
  // no `via` is that shape — `narrowedBy` falls back to the route that
  // recorded it, which realizes the focus slot rather than the narrowed one,
  // so `laneFillers` finds nothing and the census prints the branch's text.
  // The alternative way out that no route walks is what makes the combination
  // unpublished, which is what puts it in `examples`. Without this arm, a
  // mutation of the branch's `text` alone survives every drawn-figure
  // assertion above, because `planForNarrowed` re-derives the drawn name from
  // the filler — measured while this test was built.
  const unpinned: LayerGraph = {
    nodes: [...shared, routeBase, slot("fx-alt-finish", "Finish another way", "fx-sharp-form", "fx-answer")],
  };
  const unpinnedFocus = layerNode(unpinned, "fx-solve");
  assert.ok(unpinnedFocus && isCapability(unpinnedFocus));
  const census = crossingsAt(
    unpinned,
    vocabulary,
    expansionOf(unpinned, vocabulary, unpinnedFocus),
    "fx-sharp-form",
    "en",
  );
  assert.ok(census, "the sharp form must be a shared circle with ways in and out");
  assert.equal(census.waysIn, 1, "the narrowing is still the only way in");
  const discovery = census.examples.find((crossing) => crossing.outHref.endsWith("/fx-alt-finish"));
  assert.ok(discovery, "the unwalked way out is listed as a discovery");
  assert.equal(discovery.inLabel, "The whole route");
  assert.equal(discovery.inHref, "/repository/layers/fx-route");
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
 *  graph can be saturated too — the cap's own test needs that.
 *
 *  A thin wrapper now, and that is the point (ai-ops#22). This walk lived here
 *  as the cap's measuring stick until the map grew an **open everything**
 *  control that has to emit the same set; a second copy would mean the cap is
 *  asserted against one set while the overlay mints another, and the day they
 *  drift is the day the control emits an address the page drops on arrival.
 *  `lanesSeeNoFurther` below is the independent check that the shared function
 *  really does saturate — the one claim that a delegating wrapper cannot make
 *  about itself. */
function openableAddresses(id: string, graph: LayerGraph = LAYER_GRAPH): string[] {
  const node = layerNode(graph, id);
  assert.ok(node && isCapability(node));
  return [...saturatedOpen({ graph, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" })];
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

/**
 * The id-shaped tokens in a strand key, for matching a node id **whole**.
 *
 * A key is `run:…/0/slot:x/method:y~` and a node id is kebab-case, so splitting
 * on everything an id cannot contain leaves exactly the ids. `key.includes(id)`
 * is the tempting version and it is wrong on this corpus rather than in theory:
 * `lightsabre-routing` ends with the whole of `sabre-routing`.
 */
function keyNames(key: string): Set<string> {
  return new Set(key.split(/[^a-z0-9-]+/u).filter((token) => token !== ""));
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
  //
  // The widest figure is no longer on the overview: since session 119 it is
  // `linear-ode-solve`'s fan, and that slot is a step inside the nonlinear
  // routes rather than a root. So there is no ordering to assert between the
  // two — each is checked against the cap on its own, below, which is the
  // property the old ordering was standing in for.
  assert.ok(widest.addresses.length >= 20, `the widest figure reaches only ${widest.addresses.length} addresses`);
  assert.ok(overview.length >= 20, `the overview reaches only ${overview.length} addresses`);

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

// --- fully open, fully closed (ai-ops#22) ------------------------------------
//
// > *"it would be nice to have a fully open / fully close option somewhere on
// > the map."* — owner
//
// The map's overlay control emits `openableAddresses` verbatim. Three things
// have to be true of that set for the control to be honest, and none of them
// follows from the walk terminating:
//
//   1. it **saturates** — laying the figure out under it leaves no further
//      control unbanked, so "fully open" is fully open and not one rung of it;
//   2. it **lands on the collapse state** — `collapsedCount` goes to 0, which
//      is the number the button's own two states are read from and the number
//      the clipped reading and the information box already speak from;
//   3. it is **empty exactly where the control must not render**, because a
//      control that opens nothing is the dead control R12.2 refuses, and since
//      issue 16 that is not a corner case — it is most of the figures.
//
// Each is asserted with the census printed beside it, so a run that goes green
// over an empty sweep says so on the record instead of in a passing assertion.

test("`openableAddresses` saturates: opening everything leaves nothing to open", () => {
  const figures = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY);
  let banked = 0;
  let withInterior = 0;
  for (const slot of figures) {
    const addresses = new Set(openableAddresses(slot.id));
    banked += addresses.size;
    if (addresses.size > 0) withInterior += 1;
    const node = layerNode(LAYER_GRAPH, slot.id);
    assert.ok(node && isCapability(node));
    const opened = layoutConverge({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      focus: node,
      locale: "en",
      open: addresses,
    });

    // (1) The fixed point, checked from the other side. Every control the
    // opened drawing still shows is either one of the banked addresses or a
    // W15 jump — which is a link to where the interior IS drawn, not an open
    // control, and putting its address in `?open=` opens nothing because
    // `openable` is false on it.
    for (const lane of opened.lanes) {
      if (lane.openHref === null || lane.sharedWith !== null) continue;
      assert.ok(
        addresses.has(lane.address),
        `${slot.id}: ${lane.address} still offers a control the saturation walk never banked`,
      );
    }

    // (2) The state the button reads. `collapsedCount` is shut-and-openable by
    // construction, so 0 is exactly *"everything on this figure that opens is
    // open"* — the sentence the copy has claimed since before there was a
    // control that could produce it.
    assert.equal(
      opened.collapsedCount,
      0,
      `${slot.id}: ${opened.collapsedCount} lines still shut after opening everything`,
    );
  }
  console.log(
    `open everything: ${banked} addresses over ${figures.length} figures; `
      + `${withInterior} have an interior, ${figures.length - withInterior} open nothing at all`,
  );

  // Not vacuous, and deliberately two claims rather than one sum. A walk that
  // went quiet on every figure would satisfy (1) and (2) on all 23 of them.
  assert.ok(banked >= 20, `the whole corpus banked only ${banked} addresses`);
  assert.ok(withInterior >= 4, `only ${withInterior} figures have anything to open`);
});

test("the figures that open nothing offer no control to open them", () => {
  // (3) The control's absence. Where `openableAddresses` is empty the shut
  // drawing must show no open control either — otherwise "there is nothing to
  // expand" and "here is a thing to click" are on screen together.
  //
  // **This is where issue 16 landed, and it is worth having the number.**
  // `methodHasInterior` is `segments.length >= 2` since ingredients came off
  // the canvas; twelve one-segment methods that used to open into their
  // ingredients now hold nothing this canvas can draw, and the figures whose
  // methods are all one-segment therefore hold nothing at all.
  const barren: string[] = [];
  for (const slot of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    if (openableAddresses(slot.id).length > 0) continue;
    barren.push(slot.id);
    const shut = openDiagram(slot.id, []);
    const controls = shut.lanes.filter((lane) => lane.openHref !== null);
    assert.equal(
      controls.length,
      0,
      `${slot.id} opens nothing, yet draws ${controls.length} open controls`,
    );
    assert.equal(shut.collapsedCount, 0, `${slot.id} opens nothing, yet reports lines to open`);
  }
  console.log(`figures with no expandable interior at all: ${barren.length} — ${barren.join(", ")}`);
  assert.ok(barren.length > 0, "no figure is barren — the ingredient ruling would have to have been reverted");
});

test("open everything means the same thing in both locales", () => {
  // The overlay's label is translated; its href must not be. A set that
  // differed by locale would mean a Japanese reader's "open everything" opened
  // a different figure from an English reader's, and the two would be sharing
  // links that do not reproduce.
  for (const slot of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const node = layerNode(LAYER_GRAPH, slot.id);
    assert.ok(node && isCapability(node));
    const en = saturatedOpen({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "en" });
    const ja = saturatedOpen({ graph: LAYER_GRAPH, vocabulary: STATE_VOCABULARY, focus: node, locale: "ja" });
    assert.deepEqual([...en].sort(), [...ja].sort(), `${slot.id} opens a different set in ja`);
  }
});

test("the overview's open-everything set is one query the cap and a proxy both take", () => {
  // What the control actually puts in the address bar on the four-root
  // overview, measured rather than assumed. Two ceilings sit above it and the
  // second is not in this codebase: `CONVERGE_OPEN_MAX`, and the ~8KB request
  // line common proxies default to — see the comment on the constant, which
  // says past 256 the answer is a different address scheme rather than another
  // power of two. Before this control the saturated URL was something a reader
  // could only reach by clicking sixty-nine times; now it is one click, so the
  // number belongs on the record.
  const overview = overviewAddresses();
  const query = new URLSearchParams();
  for (const address of [...overview].sort()) query.append("open", address);
  const href = `/repository/layers?${query.toString()}`;
  console.log(`open everything, four-root overview: ${overview.length} addresses, ${href.length} bytes of URL`);

  const resolved = resolveOpenIds(overview, (id) => layerNode(LAYER_GRAPH, id) !== null);
  assert.equal(resolved.dropped, 0, `the control emits ${resolved.dropped} addresses the page would drop`);
  assert.ok(href.length < 4_000, `the overview's open-everything URL is ${href.length} bytes`);
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
  // 59 until session 107. `truncated-dyson-series` was authored so that
  // `dyson-all-at-once` had something to pin its discretization to, and it is a
  // fifth filler of `time-discretization` — one more lane on that figure, and a
  // leaf, because Berry and Costa's construction has nothing finer recorded
  // under it. `openable` again did not move: these counts are taken on the
  // **shut** figures, where every lane is a top-level filler of the focused
  // slot, and pinning changes what is drawn one level *inside* an opened method.
  // 24/35 until session 118, when the owner ruled that an iterator must not draw
  // a solver as an ingredient — *"Crank-nicholson needing quantum linear solve as
  // an ingredient doesn't make sense at all"*. `backward-euler` and
  // `trapezoidal-rule` were openable only because of that one feed, so both moved
  // from `openable` to `leaves` and the total is unchanged. **The drop is a
  // picture removed, not affordance quietly lost**, and this note is here because
  // those two are indistinguishable from the number alone.
  // 60 until session 119, and the +4 is two decisions in one session:
  // `linear-ode-solve`'s refuted chain became the fan of its seven methods
  // (−2 slot lanes, +7 method lanes, all seven openable into their routes),
  // and the Koopman-von Neumann narrowing stopped being drawn beside the
  // embedding lane whose fan contains it (−1 leaf).
  // 64 until session 120. The W14 wiring gave the KvN route its readout, so the
  // shut nonlinear figure's walk gained the simulate → estimate run: two slot
  // lanes between the linear-ivp and solution-answer circles that no way across
  // drew before, both real, both sourced (Joseph §V C).
  // 66 until session 121 (W17). The owner's refinement-folding ruling took three
  // variant lanes off the shut figures — `krovi-linear-ode` and
  // `lchs-improved-kernel` (both openable) and `lightsabre-routing` (a leaf) —
  // because a refinement with `sameInternalsAsParent` lives in its parent
  // card's Refinements section rather than as a lane. **The drop is three
  // pictures removed on purpose, not affordance quietly lost**: each of the
  // three still draws on its own page, where the planner unfolds its subject.
  // 63 until W21, across nineteen figures. The variational region's three slots
  // draw eleven more lanes between them — six ansatz families, three ways to a
  // ground-state energy, two ways through the optimisation slot — and every one
  // is a method this PR authored from a paper it fetched.
  // 74 until W21-E, across twenty-two figures. `excited-state-energy` draws
  // seven more lanes — one per method in the slot — and every one is a method
  // this PR authored from a paper it fetched: deflation, subspace search,
  // subspace expansion, the equation-of-motion route, folded spectrum, the
  // penalty route and the contracted multistate route.
  // 83 since B5 unit 3: `variance-objective` and `measurement-grouped-readout`, one lane each.
  // 86 since B5's leaf anchors: `particle-hole-ansatz` and `orbital-optimized-ansatz`
  // under `ansatz-construction`, `symmetry-verification` under `error-mitigation`.
  // 88 still: the folded refinement draws NO lane of its own, which is the whole point
  // of the fold — its node exists, its page draws, and the slot figure is unchanged.
  // 41/46 until issue 16 took ingredients off the canvas. **The total does not
  // move and the split does, by exactly fourteen.** Fourteen methods record one
  // route segment and at least one ingredient, so the ingredients were the whole
  // of what opening them drew: the three QLS/LCU leaves, the four readouts, the
  // three adaptive ansätze, the analytic-gradient optimiser and the two
  // matrix-element excited-state routes. With those on the card there is nothing
  // left for the canvas to expand and all fourteen move to `leaves` — a name in
  // the line, one click to a card that lists what they need.
  //
  // **A picture removed, not affordance quietly lost**, the same distinction
  // session 118's note above draws, and the reason both numbers are named: 27
  // alone is indistinguishable from a graph that stopped recording routes.
  // 89 since `layerwise-training`, and it lands as a **leaf** rather than as an
  // openable line — which is the opposite of what this same node would have been
  // one commit earlier, and worth writing down because the reason is issue 16
  // rather than anything about the node. It records one route segment and one
  // ingredient (`ansatz-construction`), so it is precisely the shape of the
  // fourteen described above: the ingredient was the whole of what opening it
  // would have drawn, that ingredient is now on the card, and the canvas has
  // nothing left to expand. `leaves` 60 → 61, `openable` unchanged at 27.
  //
  // And one more openable line in session 129: `berry-multistep` is a seventh
  // top-level route on `linear-ode-solve`, and unlike `layerwise-training` it
  // DOES open — the two hops it delegates are named route segments, not
  // ingredients, so the canvas still has something to expand.
  //
  // Two more in session 130, and they land on opposite sides, which is why the
  // total moves by 2 while neither sub-count moves by 2. `childs-liu-spectral`
  // is an eighth top-level route on `linear-ode-solve` and OPENS, for Berry's
  // reason: both of its hops are named route segments. The
  // `chebyshev-pseudospectral-collocation` it pins is a LEAF — atomic, like
  // every other member of `time-discretization` except the two propagator
  // series. `openable` 28 → 29, `leaves` 61 → 62.
  // Five more in session 15's map-growth pass, splitting 1 openable / 4 leaves, and the
  // split is the honest shape of new work rather than an accident. Only
  // `phase-estimation-ground-state` opens: it walks `state-preparation` and
  // `hamiltonian-simulation` as named route segments, so the canvas has something to
  // expand. The other four are leaves for two different reasons worth keeping apart —
  // `generalized-excitation-ansatz` and `spsa-optimization` are genuinely undecomposed
  // (nobody has recorded an interior, which is the honest state of a method just
  // authored), while `batched-adapt-ansatz` and `thc-block-encoding` each declare a step
  // that hangs as an INGREDIENT rather than as a segment, so there is nothing on the
  // spine to open. A method with a step that still draws a leaf is the ingredient shape,
  // not a miscount — the same distinction `layerwise-training` is annotated for above.
  // `openable` 29 → 30, `leaves` 62 → 66.
  assert.equal(openable + leaves + 1, 97, "the twenty-three figures draw 97 lines between them");
  assert.equal(openable, 30, "30 of them open into something the canvas draws");
  assert.equal(leaves, 66, "66 are leaves — the canvas records nothing finer for them");

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
  //
  // **Total over every nested lane, with no exception left.** An ingredient's
  // fan used to be one: it hung off the side at the end of a stub rather than
  // lying on the line it was drawn under, so it was checked against the stub
  // instead. Issue 16 took ingredients off this canvas, so every nested lane on
  // the figure is now a decomposition of the one above it and the second arm
  // has no subject. A denominator is carried, because an invariant that
  // silently checks nothing is the failure this file has a whole section of
  // comments about.
  let onParent = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      const byKey = new Map(diagram.lanes.map((lane) => [lane.key, lane]));
      for (const lane of diagram.lanes) {
        if (lane.depth === 0) continue;
        assert.ok(lane.parentKey, `${lane.key} is nested but names no parent`);
        const parent = byKey.get(lane.parentKey);
        assert.ok(parent, `${lane.key} names a parent ${lane.parentKey} that is not drawn`);
        onParent += 1;
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
  // **The floors below fell with issue 16, and the drawing fell further.** A
  // floor exists so a sweep that has gone quiet cannot pass; it is not a claim
  // about how big the corpus is. Taking ingredients off the canvas removed a
  // whole level of nesting from every method that consumed one, so the
  // saturated population these sweep is genuinely smaller — measured, not
  // guessed — and a floor left at the old number would be a bar the ruling
  // cannot clear rather than a guard against silence.
  console.log(`[nested lanes] ${onParent} checked against a parent line`);
  assert.ok(onParent > 350, `only ${onParent} nested lanes checked against a parent line`);
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
          // Two kinds of lane suppress their NAME, and both are **declared**
          // rather than inferred:
          //   `composite` — the run of named hops, whose own name would be
          //                 `A → B`, the coined composite the owner refused.
          //                 Draws nothing, ever.
          //   `nameless`  — a lane whose real name something else on the canvas
          //                 already draws. Its remainder-hop case (`own`) draws
          //                 the standing PHRASE since W19 — `ownStepName`, not
          //                 the method's name, so the session-104 duplicate
          //                 ("time marching expands into propagation then
          //                 itself") stays impossible while the session-113
          //                 blank ("i would like them labeled") is finally
          //                 paid. The other nameless case (an open feed's fan
          //                 base, session 118) still draws nothing: its name is
          //                 on the stub one shape above.
          //
          // Checked both ways round, which is what makes it a check rather than
          // a restatement: `lane.open` was here first and is not the predicate —
          // an ordinary opened lane that lost its name would have passed.
          const declaredSilent = lane.composite || (lane.nameless && lane.own === null);
          if (lane.label === "") {
            assert.ok(
              declaredSilent,
              `${lane.key} draws no name and is neither a composite run nor a borrowed-name lane`,
            );
            continue;
          }
          assert.ok(
            !declaredSilent,
            `${lane.key} declares itself silent (composite=${lane.composite} ` +
              `nameless=${lane.nameless}) yet draws "${lane.label}"`,
          );
          if (lane.own !== null) {
            assert.equal(
              lane.label,
              ownStepName(locale),
              `${lane.key} is a remainder hop but draws "${lane.label}", not the standing phrase`,
            );
          }
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
      // Shared lanes (W15) are outside the partition: their interior is not
      // hidden — it is drawn at `sharedWith` on this same figure — so they are
      // neither a click owed nor a thing the map is missing. Their control is
      // the jump, asserted by its own test.
      const shut = diagram.lanes.filter(
        (lane) => !lane.open && lane.inside > 0 && lane.sharedWith === null,
      );
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
  // makes them agree, so a change to `strandHalf`, `besideNameReach` or
  // `laneGap` that forgets `laneBow` fails here rather than drifting the picture.
  //
  // **`besideNameReach()`, not a literal, and not `labelBand` which is gone.**
  // A leaf that writes its name beside itself reserves its own thickness plus
  // the room that name takes, and this test's whole job is that `laneBow` keeps
  // describing *that* band. Written as a literal it would have gone on passing
  // while `laneOffsets` described a fan the layout no longer draws, which is
  // exactly what it did do until the band was corrected.
  const leaf = M.strandHalf + Math.max(besideNameReach().above, besideNameReach().below);
  assert.equal(leaf * 2 + M.laneGap, M.laneBow, "laneBow is not an independent number");
  for (const count of [1, 2, 3, 4, 5, 7]) {
    const closed = laneOffsets(count);
    const allocated = allocateBows(new Array(count).fill({ above: leaf, below: leaf }), 0, M.laneGap);
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

test("every strand is a thin tendon, a body around its own name, and a thin tendon", () => {
  // **R15, and this test used to assert the opposite.** It read *"every strand
  // pinches to a point at both circles and stands 2·half across its belly"*, and
  // its own comment defended the taper: *"a strand pinching to a point says 'this
  // and the others become one thing here', which is what a convergence is."* The
  // owner disagreed, in as many words:
  //
  // > *"i don't like how lines taper off — just keep thin tendon lines and the
  // > same short line bodies around labels rather than this taper."* — ai-ops#64
  //
  // So the shape is now thin / thick / thin with a step between, and the three
  // things this asserts are the three parts. Read off the emitted outline,
  // because that is the shape a reader sees, and because the fields and the path
  // have come apart on this canvas before.
  //
  // **The `belly` sample moved to `body`, and that is the whole of the second
  // ask.** A check that walked the belly would now pass on a strand drawn thick
  // from tendon to tendon — which is exactly the shape being removed. It walks
  // the body, and then walks the *rest of the belly* asserting it is thin.
  let checked = 0;
  let bodies = 0;
  let padded = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const lane of diagram.lanes) {
      assert.ok(lane.outline.endsWith("Z"), `${lane.key}: an outline is closed`);
      assert.ok(lane.half > 0, `${lane.key}: a strand with no thickness`);
      const edges = outlineEdges(lane.outline);
      const thin = 2 * Math.min(M.tendonHalf, lane.half);
      checked += 1;
      // Sampled at the ends the OUTLINE draws, not at `lane.x0`/`lane.x1`. The
      // emitter rounds to a hundredth and the layout's own numbers are exact, so
      // a sample taken at the exact end can fall a thousandth outside the drawn
      // range — where a sampler has to guess, and this one guesses by falling
      // back to the last segment. That returned the far end of the shape and
      // read as a 7px gap at a pinch that is exact.
      const ends = drawnEnds(lane.outline);
      close(
        edges.lower(ends.sx) - edges.upper(ends.sx),
        thin,
        `${lane.key}: the start is not the tendon's own thickness`,
        0.05,
      );
      close(
        edges.lower(ends.ex) - edges.upper(ends.ex),
        thin,
        `${lane.key}: the end is not the tendon's own thickness`,
        0.05,
      );
      // The thin line is centred on the base, where the point used to be.
      close(
        (edges.upper(ends.sx) + edges.lower(ends.sx)) / 2,
        lane.yc,
        `${lane.key}: the end of the line is off the base`,
        0.05,
      );

      // **The body is the rule, re-derived from the label rather than read back
      // off the lane.** `bodyX0`/`bodyX1` are what `place` decided; this is what
      // the rule says it should have decided, computed from the drawn string and
      // the two constants. Reading the fields back and comparing them to
      // themselves is the derived-cannot-verify-self mistake this file has paid
      // for twice.
      const ink = lane.label === "" ? 0 : estimateTextWidth(lane.label, M.laneFont);
      const wanted = Math.min(
        Math.max(M.minBody, ink + 2 * M.labelPad),
        lane.bellyX1 - lane.bellyX0,
      );
      close(lane.bodyX1 - lane.bodyX0, wanted, `${lane.key}: the body is not the rule`, 0.01);
      assert.ok(
        lane.bodyX0 >= lane.bellyX0 - 0.01 && lane.bodyX1 <= lane.bellyX1 + 0.01,
        `${lane.key}: the body [${lane.bodyX0}, ${lane.bodyX1}] leaves its belly ` +
          `[${lane.bellyX0}, ${lane.bellyX1}]`,
      );
      // A named body holds its own name — the failure the rule must not produce.
      if (ink > 0 && lane.bellyX1 - lane.bellyX0 >= ink) {
        assert.ok(
          lane.bodyX1 - lane.bodyX0 >= ink - 0.01,
          `${lane.key}: a ${ink.toFixed(1)}px name on a ${(lane.bodyX1 - lane.bodyX0).toFixed(1)}px body`,
        );
      }

      // Full thickness across the body...
      if (lane.bodyX1 - lane.bodyX0 > 1) {
        bodies += 1;
        for (let step = 1; step < 20; step += 1) {
          const x = lane.bodyX0 + ((lane.bodyX1 - lane.bodyX0) * step) / 20;
          close(
            edges.lower(x) - edges.upper(x),
            2 * lane.half,
            `${lane.key}: thickness across the body at x=${x}`,
            0.05,
          );
        }
      }
      // ...and thin off it, on the belly as much as on the tendon. This is the
      // sample that fails if the taper — or a body sized to the whole belly —
      // comes back, and it only exists on a lane whose belly is longer than its
      // body, which is 62% of them and every one the owner was complaining about.
      const slack = lane.bodyX0 - lane.bellyX0;
      if (slack > 2) {
        padded += 1;
        close(
          edges.lower(lane.bodyX0 - 1) - edges.upper(lane.bodyX0 - 1),
          thin,
          `${lane.key}: the belly is thick ${slack.toFixed(1)}px off its own body`,
          0.05,
        );
      }
      if (lane.run > 1) {
        const mid = lane.x0 + lane.run / 2;
        close(
          edges.lower(mid) - edges.upper(mid),
          thin,
          `${lane.key}: the tendon tapers rather than running thin`,
          0.05,
        );
      }
    }
  }
  assert.ok(checked > 50, `only ${checked} outlines checked`);
  assert.ok(bodies > 50, `only ${bodies} bodies sampled`);
  // A floor on the population the second half of the rule is about. Without it a
  // future change that made every body fill its belly would leave this test green
  // by having nothing left to check — the empty-for-the-wrong-reason failure.
  assert.ok(padded > 20, `only ${padded} lanes have belly to spare — is the body still short?`);
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
      ];
      assert.equal(
        new Set(keys).size,
        keys.length,
        `${focus.id} with ${[...open].join("+")} draws two shapes under one key`,
      );
    }
  }
});

test("no ingredient is drawn on the canvas, and every one of them is on a card", () => {
  // **The owner's ruling, issue 16**, and the only place it is checkable
  // against the whole corpus at once:
  //
  // > *"i think ingredients don't belong on the map visual. i think any
  // > method/process that has ingredients should have a section in their card
  // > for them."*
  //
  // Three tests stood here and all three were about the stub and the fan the
  // canvas used to draw — that they hung the way their strand bowed, that an
  // open one was named once rather than twice, that a lane's ingredients were
  // its own and not its descendants'. Their subject is gone, so they are gone,
  // and this is what replaces them: the same fact stated as the two halves the
  // ruling actually has.
  //
  // Both halves matter and only together. Deleting the drawing and stopping
  // there would take the ingredient off the page entirely, which is not what he
  // asked for — the card is where it went.
  const withIngredients = LAYER_GRAPH.nodes.filter(
    (node): node is LayerMethod =>
      isMethod(node) && routeOf(LAYER_GRAPH, STATE_VOCABULARY, node).feeds.length > 0,
  );
  // Not vacuous: 20 of the 63 methods consume something. If the corpus ever
  // stops recording ingredients at all, this says so instead of passing.
  assert.ok(
    withIngredients.length >= 15,
    `only ${withIngredients.length} methods record an ingredient — this guard has nothing to check`,
  );

  // Half one: the canvas. Swept saturated, because the stub was only ever drawn
  // inside an opened strand — a shut sweep would pass over a figure that never
  // had one.
  let lanes = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const saturated = openDiagram(focus.id, openableAddresses(focus.id));
    lanes += saturated.lanes.length;
    const ids = new Set(saturated.lanes.map((lane) => lane.draws).filter((id) => id !== null));
    for (const method of withIngredients) {
      if (!ids.has(method.id)) continue;
      for (const id of routeOf(LAYER_GRAPH, STATE_VOCABULARY, method).feeds) {
        // An ingredient may still appear as a **slot of its own** somewhere else
        // on the figure — `state-preparation` is a step of one route and an
        // ingredient of another, and the first is a hop that moves the route
        // along. What must not exist is a lane drawn *under* the method that
        // consumes it, which is what a stub's fan was.
        const under = saturated.lanes.filter(
          (lane) =>
            lane.draws === id &&
            lane.parentKey !== null &&
            (saturated.lanes.find((parent) => parent.key === lane.parentKey)?.draws ?? null) ===
              method.id,
        );
        assert.equal(
          under.length,
          0,
          `${focus.id}: ${method.id} draws its ingredient ${id} on the canvas (${under
            .map((lane) => lane.key)
            .join(", ")})`,
        );
      }
    }
  }
  console.log(`[ingredient ruling] ${lanes} lanes swept saturated`);
  assert.ok(lanes > 220, `only ${lanes} lanes swept`);

  // Half two: the card. `Requires` is held for every method that consumes
  // anything, and it names the same ids `routeOf` classified as feeds — so what
  // left the drawing arrived somewhere a reader can still reach.
  for (const method of withIngredients) {
    const card = cardFor(CARD_INPUT, method.id);
    assert.ok(card && card.kind === "method", `${method.id} builds no method card`);
    assert.ok(
      card.ingredients.held,
      `${method.id} consumes an ingredient and its card's Requires section is empty`,
    );
    assert.deepEqual(
      card.ingredients.value.map((item) => item.link.id),
      [...routeOf(LAYER_GRAPH, STATE_VOCABULARY, method).feeds],
      `${method.id}: the card's Requires list is not the route's ingredients`,
    );
  }
});

test("a chain's column holds every step's own demand, and each step is cut the piece it paid for", () => {
  // The pair `place` depends on: `chainColumnNeed` sums the demands, and
  // `levelShares` divides a belly at least that long **in proportion to those
  // same demands**. Their safety property is one line of arithmetic — allocate
  // `L ≥ Σd` in proportion to `d` and every piece is at least its own `d` — and
  // it is asserted here as arithmetic, against the property rather than against
  // a figure, because a figure that happens not to exercise it proves nothing.
  const CASES = [[10], [10, 300, 20], [140, 140, 140], [5, 5], [0, 900, 1], [7, 0]];
  for (const needs of CASES) {
    const column = chainColumnNeed(needs);
    // Exactly the sum bought — and then cut with nothing spare, the tightest
    // case, since a longer belly only ever makes every piece bigger.
    const pieces = levelShares({ x0: 0, x1: Math.max(column, 1), y: 0 }, needs);
    assert.equal(pieces.length, needs.length, `${JSON.stringify(needs)}: lost a step in the cut`);
    for (const [index, need] of needs.entries()) {
      const piece = pieces[index]!;
      assert.ok(
        piece.x1 - piece.x0 >= need - 1e-9,
        `${JSON.stringify(needs)}: step ${index} was cut ${piece.x1 - piece.x0} for a demand of ${need}`,
      );
    }
    // The pieces tile the belly: no gap between two steps, and the last one
    // closes on the end, which is where the final circle is drawn.
    for (let index = 1; index < pieces.length; index += 1) {
      assert.equal(pieces[index]!.x0, pieces[index - 1]!.x1, `${JSON.stringify(needs)}: a seam moved`);
    }
    assert.equal(pieces.at(-1)!.x1, Math.max(column, 1), `${JSON.stringify(needs)}: the chain stops short of its own end`);
  }

  assert.equal(chainColumnNeed([]), 0, "no steps need no column");
  assert.equal(chainColumnNeed([10, 300, 20]), 330);
  // **The control, and it is the rule this replaced.** Until W18+ the column was
  // `k × widest` because the cut was into equal slices — 900px for this chain
  // against the 330px its steps actually ask for. A regression to that rule
  // fails here, and so does any "safety" multiplier quietly reintroduced.
  assert.ok(
    chainColumnNeed([10, 300, 20]) < 3 * 300,
    "the column is back to paying for the widest step once per step",
  );
});

test("a state is never given a drawn name — only a hover tooltip", () => {
  // > *"states never have visible labels, only hover tooltips."*
  // > — owner, issue 17
  //
  // Two tests stood here and both were about the caption W19 PR-2 drew over a
  // shared circle: one held a floor at 75 of 88 eligible circles, the other
  // pinned the text, the anchor and the plate's fit. The ruling reverses their
  // subject, so this replaces both — and it is the shape of guard those two
  // asked for, because the failure they were built around is a feature leaving
  // the page in silence. A caption that comes back has a field to come back
  // on, and the field is what this refuses.
  //
  // **The name itself is not gone**, which is the half that would be a
  // regression rather than the ruling: every state still carries its authored
  // label, and `Hub` writes it into the `<title>` and the `aria-label`. So
  // this checks both — nothing drawn, and the string still there to hover.
  let states = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = openDiagram(focus.id, openableAddresses(focus.id), locale);
      for (const state of diagram.states) {
        states += 1;
        // A drawn caption needed five fields to place it. Reading them off the
        // object is what a re-introduction cannot do quietly: a caption is a
        // string with an x, a y, an anchor and a width, and none of the five
        // exists.
        for (const gone of ["caption", "captionX", "captionY", "captionAnchor", "captionWidth"]) {
          assert.ok(
            !(gone in state),
            `${focus.id} (${locale}): ${state.stateId} carries ${gone} — a state is drawing a name again`,
          );
        }
        assert.ok(
          state.label.length > 0,
          `${focus.id} (${locale}): ${state.stateId} has no label to hover`,
        );
      }
    }
  }
  // Not vacuous, and the shared circles are the population that had captions.
  assert.ok(states >= 100, `only ${states} circles swept`);
});

test("a name written inside its own line is not given a second band beside it", () => {
  // The vertical half of `5314ca`, measured on the drawing.
  //
  // `labelBand` is *"room beside a strand for its own name"*, and `measureCore`
  // reserved it on **both** sides of every lane — including the lanes whose name
  // is not beside them at all. Measured on `nonlinear-ode-solve` (en),
  // saturated, before this: the drawn strands were 10.1% of the figure's
  // 5,645.5px, and two adjacent shut leaves sat **exactly 36px apart edge to
  // edge** — `2·labelBand + laneGap` — with a 12px name that was inside one of
  // the two lines rather than in that gap.
  //
  // So the bar has two sides and both are failable:
  //   · **at or above `laneGap`** — the layout still owes two siblings the gap
  //     it promises them, so a crush that packed them tighter fails here rather
  //     than being discovered on the page;
  //   · **below the old `2·labelBand + laneGap`** — restoring the reservation
  //     puts every one of these pairs back at exactly 36 and fails here.
  //
  // The names themselves are guarded elsewhere and deliberately not restated:
  // `no two names overlap on an opened figure either` is what says the text
  // still clears, and it is the invariant this compaction was tightened against.
  // A **historical** number, and a literal on purpose: 13 was `labelBand`, which
  // this canvas no longer has (see its note in `CONVERGE_METRICS`). The bar is
  // "tighter than the reservation this compaction removed", so it has to keep
  // meaning the number that was removed rather than tracking whatever replaced
  // it — a bar that moves with the thing it is measuring is not a bar.
  const OLD_RESERVATION = 2 * 13 + CONVERGE_METRICS.laneGap;
  const gaps: number[] = [];
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = openDiagram(focus.id, openableAddresses(focus.id), locale);
      const parents = new Set(
        diagram.lanes.map((lane) => lane.parentKey).filter((key): key is string => key !== null),
      );
      const byParent = new Map<string, ConvergeLane[]>();
      for (const lane of diagram.lanes) {
        if (lane.parentKey === null) continue;
        byParent.set(lane.parentKey, [...(byParent.get(lane.parentKey) ?? []), lane]);
      }
      for (const [, siblings] of byParent) {
        // **Neighbours in the row, not merely both leaves.** Sorting the leaves
        // and pairing those is the version this test had first, and it reported
        // a 507.3px "gap" between two leaves with an opened sibling drawn
        // between them — the space was that sibling's interior, which is not
        // slack and not this test's subject. So the row is walked whole and a
        // pair counts only when the two are genuinely consecutive in it.
        const row = [...siblings].sort((a, b) => a.bellyY - b.bellyY);
        const isSubject = (lane: ConvergeLane) => !parents.has(lane.key) && lane.label !== "";
        for (let index = 1; index < row.length; index += 1) {
          const below = row[index - 1]!;
          const above = row[index]!;
          if (!isSubject(below) || !isSubject(above)) continue;
          // **Not across the bone.** Two siblings on opposite sides of their
          // parent's spine have `spineBand` reserved between them each way,
          // plus the opened parent's own name written on the bone in that very
          // space — `allocateBowsAroundSpine` exists to keep a child off it.
          // That is a band with something in it, so it is not this test's
          // subject; measured, it is every pair here wider than 40px (65.6,
          // 68.6, 72.9, 90.0 on `nonlinear-ode-solve` en) and each one is a
          // `−bow` paired with a `+bow`.
          if (below.bow < 0 && above.bow > 0) continue;
          // Adjacent in y **and** overlapping in x, or they are not sharing a gap.
          if (Math.min(below.bellyX1, above.bellyX1) - Math.max(below.bellyX0, above.bellyX0) <= 0) continue;
          const gap = Math.abs(above.bellyY - below.bellyY) - below.half - above.half;
          gaps.push(gap);
          assert.ok(
            gap >= CONVERGE_METRICS.laneGap - 0.01,
            `${focus.id} (${locale}): "${below.label}" and "${above.label}" are ${gap.toFixed(1)}px apart, `
              + `inside the ${CONVERGE_METRICS.laneGap}px every two siblings are owed`,
          );
        }
      }
    }
  }
  // **The median, not the maximum, and the reason is a measurement.** A pair can
  // legitimately be far apart when the layout has reserved something between
  // them that this test cannot see from two lanes alone — a variant row's
  // bracket is the case that remains, at 87.8px on `ansatz-construction`'s
  // `adapt-ansatz`. Barring the maximum would therefore be barring the bracket.
  // The median is the statistic the reservation actually moved: under the old
  // rule EVERY ordinary pair sat at exactly `2·labelBand + laneGap`, so a median
  // below it cannot be produced by the old geometry at all.
  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  console.log(
    `[inside names] ${gaps.length} adjacent shut-leaf pairs: gap min ${sorted[0]!.toFixed(1)}px `
      + `median ${median.toFixed(1)}px max ${sorted.at(-1)!.toFixed(1)}px, `
      + `against the ${OLD_RESERVATION}px two label bands used to buy`,
  );
  assert.ok(gaps.length > 0, "no adjacent shut leaves on the corpus — this measured nothing");
  // **`− 1`, and it is float slack rather than a softened bar.** Checked by
  // hand against the pre-change geometry: it puts this median at 35.999…px,
  // which a strict `< 36` lets through by a rounding error. With the margin the
  // control fails as it must, and today's 18.9px clears it by 16px.
  assert.ok(
    median < OLD_RESERVATION - 1,
    `the median gap between two adjacent shut leaves is ${median.toFixed(3)}px, at the `
      + `${OLD_RESERVATION}px a label band on each side used to buy — the reservation is back`,
  );
});

test("two shut steps of one chain are drawn in proportion to their own names", () => {
  // The compaction, measured on the drawing rather than restated from the code.
  //
  // A chain's steps tile their parent's belly, so the belly is cut somewhere;
  // the question this asks is *where*. Under the equal-slice rule every step of
  // a chain came out the same length whatever it held — a 129px name and a
  // whole opened fan were handed the same 2,776px — and the answer here is that
  // two SHUT steps of one chain now differ in length exactly as their names do.
  //
  // **Failable by hand, and that is the point**: restoring `levelSlices(belly,
  // k)` in `place`'s chain arm makes every ratio below equal and this fails on
  // the first pair whose names differ. Restoring `k × widest` in
  // `chainColumnNeed` alone does not fail it — it inflates the belly without
  // changing the proportions — which is why `a chain's column holds every
  // step's own demand` pins that half as arithmetic.
  //
  // Chains are recovered from the DRAWING (siblings whose x-ranges tile), not
  // from a layout flag, so the check cannot be satisfied by a lane that says it
  // is a step without being drawn as one.
  const MIN = CONVERGE_METRICS.minTendonRun;
  let pairs = 0;
  let worst = { at: "", spread: 0 };
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = openDiagram(focus.id, openableAddresses(focus.id), locale);
      const parents = new Set(
        diagram.lanes.map((lane) => lane.parentKey).filter((key): key is string => key !== null),
      );
      const byParent = new Map<string, ConvergeLane[]>();
      for (const lane of diagram.lanes) {
        if (lane.parentKey === null) continue;
        byParent.set(lane.parentKey, [...(byParent.get(lane.parentKey) ?? []), lane]);
      }
      for (const [, siblings] of byParent) {
        if (siblings.length < 2) continue;
        const row = [...siblings].sort((a, b) => a.x0 - b.x0);
        // A chain, as drawn: each step starts where the previous one ended.
        const tiles = row.every((lane, index) => index === 0 || Math.abs(lane.x0 - row[index - 1]!.x1) < 0.02);
        if (!tiles) continue;
        // Only steps that hold nothing but their own name: an opened step's
        // demand is its interior, which this test cannot see, and a step with
        // an ingredient buys room for the stub as well.
        const shut = row.filter(
          (lane) => !parents.has(lane.key) && !lane.labelTruncated && lane.label !== "",
        );
        if (shut.length < 2) continue;
        const ratios = shut.map((lane) => ({
          lane,
          ratio: (lane.x1 - lane.x0) / (lane.labelWidth + loopAllowance(lane) + 2 * MIN),
        }));
        // Every step is the same multiple of its own demand — that multiple is
        // the belly's surplus over the summed demands, shared out.
        const lo = Math.min(...ratios.map((r) => r.ratio));
        const hi = Math.max(...ratios.map((r) => r.ratio));
        const spread = hi / lo;
        if (spread > worst.spread) {
          worst = { at: `${focus.id} (${locale}) ${ratios[0]!.lane.parentKey ?? "?"}`, spread };
        }
        // Only pairs whose names actually differ are evidence: two equal names
        // are drawn equally under either rule.
        const widths = new Set(shut.map((lane) => Math.round(lane.labelWidth)));
        if (widths.size > 1) pairs += 1;
        assert.ok(
          spread <= 1.01,
          `${focus.id} (${locale}): steps of one chain are drawn ${spread.toFixed(2)}× apart `
            + `relative to their own demands — `
            + ratios.map((r) => `${r.lane.label}: ${Math.round(r.lane.x1 - r.lane.x0)}px for ${Math.round(r.lane.labelWidth)}px`).join("; "),
        );
      }
    }
  }
  console.log(`[chain proportions] ${pairs} chains carry two shut steps with different names, worst spread ${worst.spread.toFixed(3)} (${worst.at})`);
  // Not vacuous: a sweep that found no chain with two differently-named shut
  // steps would pass every assertion above without measuring anything.
  assert.ok(pairs > 0, "no chain on the corpus has two shut steps with different names — this measured nothing");
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

test("every recorded multiplicity is drawn on the lane that walks it, on the route that walks it", () => {
  // **The map's one silent relation, measured in `W12-what-the-map-cannot-say.md`.**
  // `repeats` is on 9 methods — nearly twice as many as `refines` — and neither
  // the canvas nor the card said a word about it. A reader looking at a lane into
  // `quantum-linear-solve` had no way to learn it is walked T/h times, and two
  // methods filling one slot at wildly different prices drew the same stroke.
  //
  // The subject here is **which lane** carries it, because the mark is a fact
  // about an occurrence and the layout draws one node on many lanes: the same
  // `quantum-linear-solve` is walked once by `taylor-all-at-once` and T/h times
  // by `backward-euler`. A lookup keyed on the node id would put one route's
  // count on the other's line, and the picture would read as a claim no source
  // makes. So the expected set is read off the graph, per (method, step) pair.
  // **Partitioned on where the step is drawn, and the partition is the point.**
  // 7 of the corpus's 10 records key a step `routeOf` files as an *ingredient*
  // — the three readouts' ε^-2 and HHL's two κ's — and an ingredient is card
  // content since issue 16. So a mark keyed to one of those is not owed a lane
  // and never can have one; it is owed a row in that method's Requires
  // section. This test used to demand every record reach a figure, which was
  // right while the stub was drawn and would now be a demand the drawing cannot
  // meet.
  //
  // Both halves are checked, and that is what stops the ruling from quietly
  // losing the most expensive numbers on this map: a record that reaches
  // neither surface still fails.
  const expected = new Map<string, string>();
  const onCard = new Map<string, string>();
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.repeats === undefined) continue;
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, node);
    for (const [stepId, repetition] of Object.entries(node.repeats)) {
      const key = `${node.id}|${stepId}`;
      if (route.feeds.includes(stepId)) onCard.set(key, repetition.count);
      else expected.set(key, repetition.mark);
    }
  }
  assert.ok(expected.size > 0, "no multiplicity is recorded at all — this test measures nothing");
  assert.ok(
    onCard.size > 0,
    "no multiplicity keys an ingredient — the card half below is checking nothing",
  );
  const drawn = new Set<string>();
  let marked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        const diagram = openDiagram(focus.id, open, locale);
        for (const lane of diagram.lanes) {
          if (lane.repeatMark === null) continue;
          marked += 1;
          // **A nameless lane draws no label, so a mark on one would be drawn
          // nowhere.** There was a shape this happened to — the base an open
          // ingredient's fan hung from, whose name the stub above it carried —
          // and it left the canvas with the ingredients. Asserted rather than
          // assumed: if a second nameless shape ever picks up a count, the mark
          // vanishes from the figure in silence, which is exactly how this
          // relation was invisible for nine sessions.
          assert.ok(
            !lane.nameless,
            `${lane.key} carries ${lane.repeatMark} and draws no name, so the count is drawn nowhere`,
          );
          // The mark is at the end of what is drawn, whether or not the name in
          // front of it was cut. This is the invariant the whole placement is
          // for: a name is legible from the figure's other lanes, and the count
          // is not.
          assert.ok(
            lane.label.endsWith(` ${lane.repeatMark}`),
            `${lane.key} carries ${lane.repeatMark} and draws "${lane.label}"`,
          );
          assert.ok(
            [...lane.repeatMark].length <= REPEAT_MARK_MAX,
            `${lane.key}: ${lane.repeatMark} is longer than a mark may be`,
          );
        }
      }
    }
  }
  // The same two invariants on every method's own page — the surface the slot
  // sweep above cannot see (the D119.1 lesson, applied here in session 120 when
  // the KvN ×4K mark's only drawing surface turned out to be the method page:
  // no map figure draws that route's interior, by the bundle dedup's design).
  for (const method of LAYER_GRAPH.nodes) {
    if (!isMethod(method) || method.repeats === undefined) continue;
    for (const locale of ["en", "ja"] as const) {
      const diagram = pageFigure(method.id, locale);
      for (const lane of diagram.lanes) {
        if (lane.repeatMark === null || lane.nameless) continue;
        marked += 1;
        assert.ok(
          lane.label.endsWith(` ${lane.repeatMark}`),
          `${method.id} page: ${lane.key} carries ${lane.repeatMark} and draws "${lane.label}"`,
        );
      }
    }
  }
  // Which pairs actually reached a drawing, checked against the graph. A record
  // that reaches no figure is the failure this shape allows: nothing renders, no
  // gate fires, and the map goes on being silent about the most expensive lane
  // on it.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      for (const method of LAYER_GRAPH.nodes) {
        if (!isMethod(method) || method.repeats === undefined) continue;
        const diagram = openDiagram(focus.id, open);
        for (const [stepId] of Object.entries(method.repeats)) {
          const key = `${method.id}|${stepId}`;
          // Whole-id, not substring — the same correction the refinement census
          // needed, applied here because it is the same idiom and the same
          // corpus: `lightsabre-routing` ends with the whole of `sabre-routing`.
          if (!expected.has(key)) continue;
          const onLane = diagram.lanes.some(
            (lane) => lane.repeatMark === expected.get(key) && keyNames(lane.key).has(method.id),
          );
          if (onLane) drawn.add(key);
        }
      }
    }
  }
  // A method's own page reaches its record too — for the KvN wiring it is the
  // only surface that does, and "drawn somewhere a reader lands" is the claim.
  for (const method of LAYER_GRAPH.nodes) {
    if (!isMethod(method) || method.repeats === undefined) continue;
    const diagram = pageFigure(method.id);
    for (const [stepId] of Object.entries(method.repeats)) {
      const key = `${method.id}|${stepId}`;
      if (drawn.has(key)) continue;
      const onLane = diagram.lanes.some(
        (lane) => lane.repeatMark === expected.get(key) && keyNames(lane.key).has(method.id),
      );
      if (onLane) drawn.add(key);
    }
  }
  assert.deepEqual(
    [...expected.keys()].filter((key) => !drawn.has(key)),
    [],
    "a recorded multiplicity that keys a hop reaches no figure at all",
  );
  // The other half: a multiplicity that keys an ingredient reaches the card of
  // the method that walks it, with the count the graph recorded.
  for (const [key, count] of onCard) {
    const [methodId, stepId] = key.split("|") as [string, string];
    const card = cardFor(CARD_INPUT, methodId);
    assert.ok(card && card.kind === "method", `${methodId} builds no method card`);
    assert.ok(card.ingredients.held, `${methodId}: Requires is empty and holds a count`);
    const row = card.ingredients.value.find((item) => item.link.id === stepId);
    assert.ok(row, `${methodId}: Requires does not list ${stepId}`);
    assert.equal(
      row.repetition?.count,
      count,
      `${key}: the card does not carry the count the graph records`,
    );
  }
  console.log(
    `[map repeat census] ${expected.size} hop records drawn as ${marked} marked lanes across every ` +
      `figure and opening; ${onCard.size} ingredient records on their methods' cards`,
  );
});

test("a loop draws as a loop exactly where a count is drawn (W19)", () => {
  // The owner's ask, verbatim: *"iterator needs to be clearer if there is one
  // with arrows."* The corpus records closure on every repetition; before W19
  // the renderer read it zero times. Both directions are the check: a marked
  // shape without a closure is a loop the glyph misses, and a closure without
  // a mark is a loop no source counted — `withRepeatMark` writes them
  // together, and this is what says nothing else writes either.
  let closures = 0;
  const seen = new Set<string>();
  const sweep = (diagram: ConvergeDiagram, where: string) => {
    for (const lane of diagram.lanes) {
      assert.equal(
        lane.loopClosure !== null,
        lane.repeatMark !== null,
        `${where}: ${lane.key} has repeatMark=${lane.repeatMark} but loopClosure=${lane.loopClosure}`,
      );
      if (lane.loopClosure !== null) {
        closures += 1;
        seen.add(lane.loopClosure);
      }
    }
  };
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        sweep(openDiagram(focus.id, open, locale), `${focus.id} (${locale})`);
      }
    }
  }
  for (const method of LAYER_GRAPH.nodes) {
    if (!isMethod(method) || method.repeats === undefined) continue;
    sweep(pageFigure(method.id), `${method.id} page`);
  }
  // The denominator, and the distinction: both closures must actually reach a
  // drawing, or the styled difference between a coherent and a measured loop
  // is a CSS rule nothing exercises.
  assert.ok(closures > 0, "no closure reached any figure — the glyph draws nowhere");
  assert.ok(seen.has("coherent"), "no coherent loop reaches a drawing");
  console.log(`[loop glyph census] ${closures} closures drawn; kinds reached: ${[...seen].sort().join(", ")}`);
});

test("the all-at-once pair earns no loop and the marcher earns one (W19)", () => {
  // The owner's complaint made falsifiable: *"some difference needs to be seen
  // between truncated dyson process and the all-at-once."* Neither all-at-once
  // encoding iterates — no `repeats` on either route or either pin, a verified
  // negative — while time-marching's per-step amplification loop is the fan's
  // one genuine iterator. The glyph is that difference, drawn; this pins it to
  // the exact lanes the complaint names, so a corpus edit that quietly gives
  // Taylor a loop (or costs the marcher its own) fails here by name.
  const diagram = openDiagram("linear-ode-solve", openableAddresses("linear-ode-solve"));
  // Subtree membership for the EXISTENCE claim only. The negative below must
  // not use it: HHL's own ×O(κ) loops nest under both all-at-once lanes and
  // are correct there — the claim is about the pair's own lanes and pins, not
  // about everything reachable beneath them (`keyNames`'s whole-id lesson,
  // met again one level up).
  const marchers = diagram.lanes.filter((lane) => keyNames(lane.key).has("time-marching-usva"));
  assert.ok(marchers.length > 0, "the time-marching lane is not drawn at all");
  assert.ok(
    marchers.some((lane) => lane.loopClosure === "coherent"),
    "time-marching's per-step loop draws no glyph anywhere on its lanes",
  );
  for (const [id, pin] of [
    ["taylor-all-at-once", "truncated-taylor-propagator"],
    ["dyson-all-at-once", "truncated-dyson-series"],
  ] as const) {
    const own = diagram.lanes.filter(
      (lane) => lane.draws === id || lane.draws === pin,
    );
    assert.ok(own.length > 0, `${id} is not drawn at all`);
    for (const lane of own) {
      assert.equal(
        lane.loopClosure,
        null,
        `${lane.key} draws a loop glyph, but ${id} is a single-pass encoding`,
      );
    }
  }
});

test("every declared refinement is drawn on the lane of the method that declares it", () => {
  // **The map's other silent relation, and the one the owner asked for by
  // name.** `refines` is the graph already saying why two methods draw one
  // picture — the LCHS pair is the case W10 exempts from the twin census for
  // exactly that reason — and until now it said it on two card surfaces and
  // nowhere on the canvas. A reader looking at `nonlinear-linear-embedding` saw
  // Carleman and Koopman as flat peers, which is the one thing they are not.
  //
  // The subject is the opposite of the repeat mark's. A count belongs to an
  // occurrence, so that test's expected set is keyed per (method, step) and
  // asks which *lane* carries it. A narrowing belongs to the node, so this one
  // is keyed per method and asks whether it reached a drawing **at all**.
  //
  // Split since s121 (W17): a refinement with `sameInternalsAsParent` is
  // FOLDED — the owner's ruling — and must reach no slot figure at all; the
  // one drawing it still owns is its own page, checked at the bottom. The
  // drawn set is the two Koopman children, whose constructions differ.
  const expected = new Map<string, string>();
  const foldedExpected = new Map<string, string>();
  const parentOf = new Map<string, string>();
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node) || node.refines === undefined) continue;
    assert.ok(node.refinesMark !== undefined, `${node.id}: refines with no mark reached the layout`);
    (node.sameInternalsAsParent === true ? foldedExpected : expected).set(node.id, node.refinesMark);
    parentOf.set(node.id, node.refines);
  }
  assert.ok(expected.size > 0, "no drawn refinement is recorded at all — this test measures nothing");
  assert.ok(foldedExpected.size > 0, "no folded refinement is recorded — the fold sweep below measures nothing");
  const drawn = new Set<string>();
  let marks = 0;
  let nested = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        const diagram = openDiagram(focus.id, open, locale);
        const byKey = new Map(diagram.lanes.map((lane) => [lane.key, lane]));
        for (const shape of diagram.lanes) {
          if (shape.refinement === null) continue;
          marks += 1;
          assert.ok(
            [...shape.refinement.mark].length <= REFINES_MARK_MAX,
            `${shape.fullLabel}: ${shape.refinement.mark} is longer than a refinement mark may be`,
          );
          // **The relation is drawn by nesting now (W13), never as a suffix.**
          // The `⊂` shipped in session 117 and the owner rejected it in 118 —
          // the parent's name repeated on the child's lane, because graph
          // order interleaved the group. The fan is grouped, so the drawn name
          // is just the name, and a `⊂` reappearing here would be the suffix
          // coming back.
          assert.ok(
            !shape.label.includes("⊂"),
            `${shape.fullLabel} draws "${shape.label}" — the ⊂ suffix is back`,
          );
          // The sentence still reaches a reader who cannot see the nesting:
          // `spokenName` carries the full relation for the `<title>`, the
          // aria-label and the accessible list.
          assert.ok(
            spokenName(shape).includes(shape.refinement.spoken),
            `${shape.fullLabel}: the spoken name lost the refinement sentence`,
          );
        }
        // And the nesting itself: every lane that IS a variant sits under the
        // lane of the very method its `refines` names — the geometry saying
        // what the suffix used to.
        for (const lane of diagram.lanes) {
          if (!lane.variant) continue;
          nested += 1;
          assert.ok(lane.parentKey !== null, `${lane.key} is a variant with no parent`);
          const parent = byKey.get(lane.parentKey!);
          assert.ok(parent, `${lane.key} nests under ${lane.parentKey}, which is not drawn`);
          // An ANCESTOR along the `refines` chain, not necessarily the direct
          // target: `methodFanGroups` collapses a chain to its top-level
          // ancestor (A refines B refines C nests A under C), so demanding the
          // direct parent here would contradict the grouping's own rule the
          // day the corpus authors a chain. Today every chain has length one,
          // so the two readings coincide — this encodes the rule, not the
          // coincidence.
          assert.ok(lane.draws !== null, `${lane.key} is a variant that draws no method`);
          let ancestor = parentOf.get(lane.draws!);
          let reached = false;
          while (ancestor !== undefined) {
            if (ancestor === parent!.draws) {
              reached = true;
              break;
            }
            ancestor = parentOf.get(ancestor);
          }
          assert.ok(
            reached,
            `${lane.fullLabel} nests under ${parent!.fullLabel}, which is not on its refines chain`,
          );
          assert.ok(
            parent!.variantBracket !== null,
            `${parent!.fullLabel} nests ${lane.fullLabel} and draws no bracket`,
          );
        }
      }
    }
  }
  assert.ok(nested > 0, "no variant lane was drawn at all — the nesting is untested");
  // Reached-a-drawing, resolved by **exact** id on `draws`, which
  // `planForMethod` sets unconditionally — `nodeId` goes null on a leaf and a
  // leaf is most of this corpus. It had a second arm matching a stub by
  // id-shaped tokens in its parent key, because a stub carried no `draws`;
  // ingredients are card content since issue 16 and there is no second shape.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const [methodId, mark] of expected) {
        const onLane = diagram.lanes.some(
          (lane) => lane.refinement?.mark === mark && lane.draws === methodId,
        );
        if (onLane) drawn.add(methodId);
      }
      // The fold, checked as an absence where it claims one: a folded
      // refinement must draw NO lane on any slot figure, at any opening.
      for (const id of foldedExpected.keys()) {
        assert.ok(
          !diagram.lanes.some((lane) => lane.draws === id),
          `${focus.id} with ${[...open].join("+")}: folded ${id} draws a lane`,
        );
      }
    }
  }
  assert.deepEqual(
    [...expected.keys()].filter((id) => !drawn.has(id)),
    [],
    "a declared refinement reaches no figure at all",
  );
  // And the one drawing a folded refinement still owns: its own page, which
  // unfolds exactly its subject — nested under its parent, mark intact, as
  // W13 drew it before the fold.
  for (const [id, mark] of foldedExpected) {
    const node = layerNode(LAYER_GRAPH, id);
    assert.ok(node && isMethod(node), `${id} is not a method`);
    const page = layoutConvergeForMethod({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      method: node,
      locale: "en",
    });
    const lane = page.lanes.find((l) => l.draws === id && l.variant);
    assert.ok(lane, `${id}: folded, and its own page does not draw it nested`);
    assert.equal(lane!.refinement?.mark, mark, `${id}: its own page's lane lost the refinement mark`);
  }
  console.log(
    `[map refinement census] ${expected.size} drawn + ${foldedExpected.size} folded records, ${marks} marked shapes drawn across every figure and opening`,
  );
});

test("every authored specification is drawn on the hop that records it, and nowhere else", () => {
  // **ai-ops#51's mechanism, and the reason it needs a gate of its own.**
  //
  // > *"we can put specifications in the labels rather than another item on the
  // > map — something like 'penalty objective'."*   — owner, ai-ops#51
  //
  // `spec` is the only one of the four hop annotations that names **nothing**:
  // `via` must be a method that fills the step, `through` must be a state that
  // narrows it, `repeats` carries a closure the graph checks. A specification is
  // free text on a drawing, so validation can only hold it to a shape — which
  // makes "does it actually reach the picture, and does the picture compose it
  // the way the demand does" the whole of what a test can add.
  //
  // Three claims, and the second is the one that already caught a real defect:
  // the column was sized from `drawnName` and the text cut by a separately
  // composed string, so `nonlinear-ode-solve` drew *"Quantum singular value
  // transformation"* into a 361px column built for 235px of text.
  const authored: Array<{ method: string; step: string; en: string; ja: string }> = [];
  for (const id of METHOD_IDS) {
    const node = layerNode(LAYER_GRAPH, id);
    if (!node || !isMethod(node) || node.spec === undefined) continue;
    for (const [step, en] of Object.entries(node.spec)) {
      authored.push({ method: id, step, en, ja: node.specJa?.[step] ?? "" });
    }
  }
  assert.ok(authored.length >= 2, `only ${authored.length} specifications authored — is the field in use?`);

  for (const locale of ["en", "ja"] as const) {
    const wanted = new Map(authored.map((a) => [`${a.method}/${a.step}`, locale === "ja" ? a.ja : a.en]));
    const reached = new Set<string>();
    for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
      for (const lane of openDiagram(focus.id, openableAddresses(focus.id), locale).lanes) {
        if (lane.spec === null) continue;
        assert.ok(
          [...wanted.values()].includes(lane.spec),
          `a lane draws "${lane.spec}", which no method records — the canvas invented a specification`,
        );
        for (const [key, text] of wanted) if (text === lane.spec) reached.add(key);

        // **One composition, two readers.** `fullLabel` is the name plus the
        // spec, and the drawn `label` is the same string with a short form and a
        // cut allowed. Asserting the join here is what would have failed on the
        // 361px column, because the two were composed apart.
        assert.ok(
          lane.fullLabel.endsWith(`, ${lane.spec}`),
          `${lane.key}: fullLabel "${lane.fullLabel}" does not carry its own spec "${lane.spec}"`,
        );
        assert.ok(
          lane.label.includes(lane.spec) || lane.labelTruncated,
          `${lane.key}: the label "${lane.label}" drops the spec "${lane.spec}" without saying it was cut`,
        );
        // And the reader who listens gets it too, because `spokenName` reads
        // `fullLabel` — one string for the eye, the tooltip and the screen
        // reader, which is what `spokenName` exists to keep true.
        assert.ok(
          spokenName(lane).includes(lane.spec),
          `${lane.key}: the spoken name drops the specification`,
        );
      }
    }
    for (const key of wanted.keys()) {
      assert.ok(reached.has(key), `${locale}: ${key} records a specification the map draws nowhere`);
    }
  }

  // **The failable half: without it, the two collide.** The row these two split
  // was in `DRAWN_TWINS` until this field existed, and a test that only checked
  // the string reached a label would stay green if the field stopped doing the
  // job it was built for. So the hop is drawn twice — once with the specs the
  // corpus records and once with them stripped — and the two runs must disagree.
  //
  // The hop, not the subtree. `qsvt-matrix-inversion` walks four steps and
  // `eigenstate-filtering-inversion` three, so their subtrees were never
  // identical; what was identical, and what the retired row was about, is the
  // `matrix-function` hop both of them pin to `qsvt-transform`.
  const qsvtHops = (strip: boolean): string[] => {
    const graph = strip
      ? {
          ...LAYER_GRAPH,
          nodes: LAYER_GRAPH.nodes.map((node) =>
            isMethod(node) && node.spec !== undefined
              ? { ...node, spec: undefined, specJa: undefined }
              : node,
          ),
        }
      : LAYER_GRAPH;
    const focus = layerNode(graph, "quantum-linear-solve");
    assert.ok(focus && isCapability(focus));
    const open = new Set(openableAddresses("quantum-linear-solve", graph));
    return layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus, locale: "en", open })
      // `nodeId`, not the href — an href carries the reader's whole `?open=` set,
      // and the method's own stretch borrows its parent's href while naming no
      // node at all.
      .lanes.filter((lane) => lane.nodeId === "qsvt-transform")
      .map((lane) => lane.fullLabel)
      .sort();
  };
  const stripped = qsvtHops(true);
  const authoredHops = qsvtHops(false);
  assert.ok(stripped.length >= 2, `only ${stripped.length} hops draw qsvt-transform — the control is vacuous`);
  assert.equal(
    new Set(stripped).size,
    1,
    `with specifications stripped, the hops that pin QSVT should all read the same — they read ${JSON.stringify([...new Set(stripped)])}, so this control has stopped controlling for anything`,
  );
  assert.equal(
    new Set(authoredHops).size,
    authoredHops.length,
    `with specifications authored, two hops still read the same: ${JSON.stringify(authoredHops)} — the field is not reaching the picture`,
  );
});

test("nothing on the canvas is marked a narrowing that the corpus did not declare", () => {
  // The other direction, and the one that matters more. 46 of 63 methods draw a
  // chain a sibling already drew (`W10-hollow-twins.md`), and `refines` is the
  // only thing that distinguishes a *declared* narrowing from a group nobody has
  // written the interior of yet. A mark inferred from a shared chain would put
  // that distinction on the drawing without a source behind it — and would do it
  // most confidently on exactly the 17 groups that have said nothing.
  const declared = new Set(
    LAYER_GRAPH.nodes.filter((node) => isMethod(node) && node.refines !== undefined).map((n) => n.id),
  );
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const lane of diagram.lanes) {
        if (lane.refinement === null) continue;
        assert.ok(
          lane.draws !== null && declared.has(lane.draws),
          `${lane.key} draws a narrowing no method on it declares`,
        );
      }
    }
  }
});

test("the count reaches a reader who is not looking at the picture", () => {
  // **The drawn label can be cut; the spoken one cannot.** The `<title>`, the
  // `aria-label` and the accessible list beside every figure all read the full
  // name rather than the fitted one, which is exactly why the mark had to be
  // given to them explicitly: appended to `label` alone it would have been a
  // quantitative fact about cost available by eye and by no other route.
  //
  // Asserted through `spokenName`, the one function those three surfaces call,
  // so a surface that started building the string itself is what fails here.
  //
  // Both marks, because both are drawn and neither is a word. The refinement's
  // `⊂` is the sharper case: read aloud it is either skipped or called "subset
  // of", and the relation the corpus recorded is *"a narrower version of"* —
  // so the spoken form carries the sentence and the symbol must never appear
  // in it, which is asserted below rather than assumed from the composition.
  const expected = (lane: {
    fullLabel: string;
    repeatMark: string | null;
    refinement: { spoken: string } | null;
    sharedWith?: string | null;
  }): string =>
    `${lane.fullLabel}${lane.refinement === null ? "" : `, ${lane.refinement.spoken}`}${
      lane.repeatMark === null ? "" : ` ${lane.repeatMark}`
    }${
      // The `⤴` is drawn and is not a word either (W15): the spoken form says
      // what the jump does, asserted here so a screen reader never gets the
      // bare symbol's silence where a sighted reader gets an affordance.
      lane.sharedWith == null
        ? ""
        : " — its contents are drawn once earlier on this figure; this line goes there"
    }`;
  let checked = 0;
  let narrowed = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const shape of diagram.lanes) {
        assert.equal(
          spokenName(shape),
          expected(shape),
          `the spoken name is not the full name plus what is marked on it`,
        );
        assert.ok(
          !spokenName(shape).includes("⊂"),
          `${shape.fullLabel}: the drawn symbol reached a name that is read aloud`,
        );
        if (shape.repeatMark !== null || shape.refinement !== null) {
          // The full name is never shortened, so the spoken string carries every
          // character of it — including on the lanes whose drawn label was cut.
          assert.ok(spokenName(shape).startsWith(shape.fullLabel));
          checked += 1;
        }
        if (shape.refinement !== null) narrowed += 1;
      }
    }
  }
  assert.ok(checked > 0, "no marked lane was checked — this test measures nothing");
  assert.ok(narrowed > 0, "no refinement was checked — this test measures half of what it says");
});

/**
 * The box a lane's name occupies, in the units the canvas draws in.
 *
 * `text-anchor="middle"` at `(labelX, labelY)`, so it is centred in x and sits on
 * its baseline in y.
 *
 * ## Why this box grew, and what it caught
 *
 * It was `[labelY − laneFont·0.8, labelY]` — 9.6px tall, ending at the baseline.
 * The sibling invariant two hundred lines up used `[labelY − laneFont, labelY]`,
 * 12px, also ending at the baseline. **Neither is a name.** Measured with
 * `getBBox()` against the shipped face, a 12px name draws 15.2px of ink and
 * about a fifth of it is below the baseline, which is the half of a name that
 * hangs into whatever is under it — see `NAME_INK_RATIO`.
 *
 * Three pixels of unmodelled descender is not a rounding error here. Sweeping
 * all 46 figure-locales shut and saturated under this box against the old one:
 * **11 pairs of names overlap on the shipped canvas by 2.4px each**, and every
 * invariant in this file reported zero, because all of them were asking about a
 * box that stops where the descenders start. That is also what blocked issue
 * 22's remaining vertical cut — a cut that passed all 88 invariants and then put
 * *"QSVT matrix inversion"* 2.2px into *"HHL"* on the real page.
 *
 * So this is one box, read by every text invariant here, derived from the one
 * number that was measured on a browser rather than assumed at a desk.
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
 * The same name, as much **ink** as it actually draws — and the box every
 * name-against-name invariant here now uses.
 *
 * ## Why this is a second box and not a correction of the one above
 *
 * `nameBox` is the subject of one question: *does a drawn line pass through this
 * name?* Its reader, `laneEnters`, samples the neighbour's spine and inflates it
 * by that lane's **maximum** half-thickness along the whole curve, including the
 * tendon where the lane is pinched to a point — a deliberate over-estimate, and
 * its own comment says so: it "can call a near miss a hit but never the other way
 * round".
 *
 * This box is the subject of a different question: *do two names overlap?* There
 * is no conservatism budget in that one. Two names either share pixels or they
 * do not, and the answer has to be the ink.
 *
 * ## The measurement, and why the two boxes are not merged
 *
 * A 12px name draws **15.2px** of ink, about a fifth of it below the baseline —
 * `getBBox()` against the shipped face, recorded on `NamePlate`; see
 * `NAME_INK_RATIO`. Both name-against-name invariants here modelled a box that
 * stopped at the baseline (one at `laneFont`, one at `laneFont · 0.8`), so both
 * were blind to the descender. Swept over all 46 figure-locales, shut and
 * saturated, that blindness was **11 pairs of names overlapping on the shipped
 * canvas by 2.4px each**, every invariant green. It is also what blocked issue
 * 22's remaining vertical cut, which passed all 88 invariants and then put
 * *"QSVT matrix inversion"* 2.2px into *"HHL"* on the real page.
 *
 * Feeding this taller box to `laneEnters` as well was tried and **is not what
 * shipped**, because it cannot tell what it found: it flags exactly two shut
 * names, *"Warped phase transformation"* on `hamiltonian-recasting` and *"Exact
 * layout synthesis"* on `qubit-routing`, and in both the neighbour's real stroke
 * is 7.6px clear of the descender — the whole reported crossing is inside the
 * 9px uniform inflation, at the taper, where the lane is drawn as a point. Making
 * that detector agree would have meant shrinking its padding, which is loosening
 * a guard to fit a measurement it was never making. The two boxes answer two
 * questions and stay two boxes.
 */
function nameInkBox(lane: ConvergeLane): { x0: number; x1: number; y0: number; y1: number } {
  const w = estimateTextWidth(lane.label, M.laneFont);
  return {
    x0: lane.labelX - w / 2,
    x1: lane.labelX + w / 2,
    y0: lane.labelY - M.laneFont * NAME_ASCENT_RATIO,
    y1: lane.labelY + M.laneFont * NAME_DESCENT_RATIO,
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
  const shutWhere: string[] = [];
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const open = new Set(openableAddresses(focus.id));
    const diagram = openDiagram(focus.id, open);
    const byKey = new Map(diagram.lanes.map((each) => [each.key, each]));
    for (const lane of diagram.lanes) {
      if (lane.label === "") continue;
      const box = nameBox(lane);
      // Everything drawn on the figure except this lane's own centre line, which
      // its name is deliberately placed clear of — or, for a name written IN
      // the line (`labelInside`, session 119), except the lane's own ancestors
      // too: a step sits ON its parent's line by construction (`a step drawn
      // inside a lane sits ON that lane` is the invariant), so the ancestor's
      // faint spine under an in-line name is the design, covered by the step's
      // own body and plate. Any OTHER lane through the name is still a defect.
      const skip = new Set<string>([lane.key]);
      if (lane.labelInside) {
        let up = lane.parentKey;
        while (up !== null) {
          skip.add(up);
          up = byKey.get(up)?.parentKey ?? null;
        }
      }
      const crossing = diagram.lanes.find((other) => !skip.has(other.key) && laneEnters(other, box));
      const hit = crossing !== undefined;
      if (lane.open) {
        openedNamed += 1;
        if (hit) openedHit += 1;
      } else {
        shutNamed += 1;
        if (hit) {
          shutHit += 1;
          // **Named, not counted.** The bar below is 0, so a failure is one or
          // two cases and the reader's next question is always which. This test
          // reported `2/243` for a whole session with no way to find the pair
          // short of re-instrumenting it.
          shutWhere.push(`${diagram.caption}: "${lane.label}" crossed by "${crossing.label || crossing.key}"`);
        }
      }
    }
  }
  // 78 opened since W15 — every duplicate interior that used to inflate the
  // opened-name population now draws once; the names the dedup removed were
  // exactly the ones this sweep saw twice. 66 since issue 16, for the reason
  // in the note on the nested-lane floor above: fourteen methods stopped
  // opening at all when their ingredients moved to the card.
  console.log(`[opened names] ${openedNamed} opened lanes drew a name`);
  assert.ok(openedNamed > 55, `only ${openedNamed} opened lanes drew a name`);
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
      `name is only crossed if something moved it off its own belly. Where: ${shutWhere.join("; ")}`,
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
  // 20 since W15: a demoted duplicate slot never opens into a bone, so the
  // saturated population halved — the bones that remain are the ones a reader
  // actually sees, floor re-pinned just below the new measurement.
  assert.ok(checked >= 18, `only ${checked} names on a bone checked`);
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
    // **`!nameless`, because the subject is the cut and a nameless lane makes
    // no cut.** A nameless lane reaches here with `fullLabel` set and `label`
    // empty, and asking whether *that* was truncated is asking about a string
    // nobody drew. The floor below is what keeps this filter from quietly
    // emptying the subject.
    .filter((lane) => lane.fullLabel === long && !lane.nameless);
  assert.ok(drawn.length > 0, "the fixture's long name is drawn on no figure at all");
  for (const lane of drawn) {
    assert.equal(lane.labelTruncated, true, "a 1272px name was not cut by a 300px cap");
    // **The ellipsis ends the name, and the mark comes after it.** Where the
    // renamed slot is one a route declares a count on, the drawn string is
    // `AAA… ×N`. That is the invariant the mark exists for: a
    // count is the one thing on a lane the reader cannot learn anywhere else on
    // the canvas, so the *name* gives way to it and never the other way round.
    // Both marks survive the cut, in `markSuffix`'s one order: `⤴` (W15) then
    // the count — each is a fact the reader can learn nowhere else on the
    // canvas, so the name gives way to them and never the other way round.
    const mark = `${lane.sharedWith === null ? "" : " ⤴"}${
      lane.repeatMark === null ? "" : ` ${lane.repeatMark}`
    }`;
    assert.ok(
      lane.label.endsWith(`…${mark}`),
      `cut name "${lane.label}" does not end in an ellipsis followed by its mark`,
    );
    // The cut respects the cap it was sized against, and the column did not grow
    // to fit the uncapped name — that second half is the part that would silently
    // stop being true if the cap were applied at `fitLabel` instead of at the
    // demand `measure` reports. A shared lane's cap is the cap plus the `⤴`'s
    // own width (W15's `sharedAllowance`): the jump glyph rides beyond the cap
    // rather than costing the name characters, on both the demand and the cut,
    // which is exactly what this assertion re-derives.
    const cap =
      M.labelCap + (lane.sharedWith === null ? 0 : estimateTextWidth(" ⤴", M.laneFont));
    assert.ok(
      estimateTextWidth(lane.label, M.laneFont) <= cap,
      `cut name is ${estimateTextWidth(lane.label, M.laneFont)}px, past the ${cap}px cap`,
    );
    // And the whole point: nothing was lost from the page. The `<title>` reads
    // `fullLabel`, so the reader still gets every character on hover.
    assert.equal(lane.fullLabel, long);
    assert.equal(lane.shortLabel, null, "a machine cut is not an authored short form");
  }
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
  const hits: string[] = [];
  for (const locale of ["en", "ja"] as const) {
    // Both surfaces that draw this canvas, not just the map — the same
    // widening the reachability bar got in session 119, and for the same
    // reason: the shell's name landed on a step's name on
    // `taylor-all-at-once`'s page while every map sweep stayed green, because
    // no map figure draws that fan (D119.1). A method page arrives already
    // opened — its subject lane is fanned unconditionally — so it belongs in
    // the opened-figure population as built, with no saturation walk.
    const figures: ConvergeDiagram[] = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map((focus) =>
      openDiagram(focus.id, openableAddresses(focus.id), locale),
    );
    for (const id of METHOD_IDS) {
      const diagram = pageFigure(id, locale);
      if (!diagram.empty) figures.push(diagram);
    }
    for (const diagram of figures) {
      const drawn = diagram.lanes.filter((lane) => lane.label !== "");
      for (const lane of drawn) if (lane.open) openNames += 1;
        else shutNames += 1;
      for (let i = 0; i < drawn.length; i += 1) {
        for (let j = i + 1; j < drawn.length; j += 1) {
          const a = nameInkBox(drawn[i]!);
          const b = nameInkBox(drawn[j]!);
          if (!(a.x0 < b.x1 - EPS && b.x0 < a.x1 - EPS && a.y0 < b.y1 - EPS && b.y0 < a.y1 - EPS))
            continue;
          const openCount = Number(drawn[i]!.open) + Number(drawn[j]!.open);
          if (openCount === 2) kinds.openOpen += 1;
          else if (openCount === 1) kinds.openShut += 1;
          else kinds.shutShut += 1;
          hits.push(
            `${diagram.caption} (${locale}): "${drawn[i]!.label}" against "${drawn[j]!.label}"`,
          );
        }
      }
    }
  }
  // 254 opened / 264 shut since session 104 on the map alone; the method pages
  // (PR 359) roughly double both. W15 then moves every demoted duplicate
  // interior's names from the opened column to the shut one — the same names,
  // drawn once, now on shut shared lanes. The floors exist to catch the sweep
  // going quiet, not to pin the population's size.
  assert.ok(
    openNames > 140 && shutNames > 350,
    `${openNames} opened / ${shutNames} shut names drawn`,
  );
  assert.deepEqual(
    kinds,
    { shutShut: 0, openShut: 0, openOpen: 0 },
    `names overlap on an opened figure: ${kinds.shutShut} shut-against-shut, ` +
      `${kinds.openShut} opened-against-shut, ${kinds.openOpen} opened-against-opened. ` +
      `All three were 0 once the fan allocator stopped centring a row containing the spine. ` +
      `Where: ${hits.slice(0, 8).join("; ")}`,
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

/**
 * The bar for how far past a shared circle two lines may still be one line.
 *
 * **The cost R15 created, named and bounded rather than argued away.** While a
 * strand pinched to a point, two siblings' ink could not meet anywhere: their
 * centres are `(b₁ − b₂)·φ(x)` apart and their thicknesses shrank by the same φ,
 * so both went to zero together at the circle. A tendon of *constant* thickness
 * does not, so near a shared circle — where the centre lines genuinely converge
 * — two 2px lines overlap for a short stretch.
 *
 * That is a real change to the drawing and it is defensible on its own terms: the
 * lines are converging on a node they share, which is what the figure is about.
 * What it is not is unbounded, and the numbers are the reason to accept it rather
 * than the reason to hide it. Measured over all 46 figure-locales, shut and
 * saturated, at f1617681 — 1,042 sibling pairs over one base:
 *
 *     ink meets somewhere                            1,042 of 1,042
 *     entirely under the state circle (r = 11)         948 (91.0%)
 *     visible merge past the circle       p50 3.84px  p90 17.45px  max 35.14px
 *     furthest merge from a circle        p50 3.99px  p90 10.08px  max 46.14px
 *     worst as a share of its own span                        6.50%
 *
 * The two worsts are different pairs — 46.14px is 6.00% of its own 769px line,
 * and the 6.50% is a shorter one — which is why both bars are checked per pair
 * rather than one being derived from the other.
 *
 * So nine merges in ten are painted over by the very circle the lines are
 * converging on, and the worst visible one is 35px on a 769px line.
 *
 * 60px and 12%, both, because either alone is the wrong instrument: an absolute
 * bar goes vacuous on a 3,000px figure and a share goes vacuous on a short one.
 * Doubling today's worst on each is deliberate headroom — this is a bar that
 * should fail when the shape changes, not when the corpus grows a node.
 */
const INK_MERGE_MAX = { px: 60, share: 0.12 } as const;

test("two lines' ink meets only where they converge on a circle they share", () => {
  // `ribbonY` on the lane's own declared numbers, and the ink half-width from
  // `bodyX0`/`bodyX1` — the same two fields the emitter draws from. The claim is
  // about the *middle* of a span: two lines may run into each other at the ends,
  // where they are arriving at one circle, and must be apart everywhere else.
  const inkHalf = (lane: ConvergeLane, x: number): number =>
    lane.open
      ? M.spineStroke / 2
      : x >= lane.bodyX0 && x <= lane.bodyX1
        ? lane.half
        : Math.min(M.tendonHalf, lane.half);
  let pairs = 0;
  let worst = { px: 0, share: 0, why: "" };
  let hidden = 0;
  let merged = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const addresses = openableAddresses(focus.id);
    for (const locale of ["en", "ja"] as const) {
      for (const open of [[], addresses]) {
        const lanes = openDiagram(focus.id, open, locale).lanes;
        for (let i = 0; i < lanes.length; i += 1) {
          for (let j = i + 1; j < lanes.length; j += 1) {
            const a = lanes[i]!;
            const b = lanes[j]!;
            // Only lanes over one base can meet at all — different bundles hold
            // disjoint x, and that is a separate invariant's job.
            if (a.parentKey !== b.parentKey) continue;
            if (Math.abs(a.x0 - b.x0) > 0.01 || Math.abs(a.x1 - b.x1) > 0.01) continue;
            if (Math.abs(a.yc - b.yc) > 0.01) continue;
            pairs += 1;
            const span = a.x1 - a.x0;
            const ra = { x0: a.x0, x1: a.x1, y: a.yc, bow: a.bow, run: a.run };
            const rb = { x0: b.x0, x1: b.x1, y: b.yc, bow: b.bow, run: b.run };
            let far = -1;
            for (let k = 0; k <= 400; k += 1) {
              const x = a.x0 + (span * k) / 400;
              const gap =
                Math.abs(ribbonY(ra, x) - ribbonY(rb, x)) - inkHalf(a, x) - inkHalf(b, x);
              if (gap >= 0) continue;
              far = Math.max(far, Math.min(x - a.x0, a.x1 - x));
            }
            if (far < 0) continue;
            merged += 1;
            if (far <= M.stateRadius) hidden += 1;
            const share = far / span;
            if (far > worst.px) {
              worst = {
                px: far,
                share,
                why: `${focus.id} (${locale}) "${a.label}" vs "${b.label}" on a ${span.toFixed(0)}px line`,
              };
            }
            assert.ok(
              far <= INK_MERGE_MAX.px && share <= INK_MERGE_MAX.share,
              `${focus.id} (${locale}): "${a.label}" and "${b.label}" are one line for ` +
                `${far.toFixed(1)}px (${(100 * share).toFixed(1)}% of a ${span.toFixed(0)}px span) ` +
                `past the circle they share — the bar is ${INK_MERGE_MAX.px}px and ` +
                `${100 * INK_MERGE_MAX.share}%`,
            );
            // And the two ends stay two ends: a merge reaching the midpoint would
            // satisfy both bars on a short enough line and mean the lines never
            // separate at all.
            assert.ok(
              far < span / 2 - 0.01,
              `${focus.id} (${locale}): "${a.label}" and "${b.label}" never come apart`,
            );
          }
        }
      }
    }
  }
  assert.ok(pairs > 500, `only ${pairs} sibling pairs swept`);
  console.log(
    `[ink merge] ${merged} of ${pairs} sibling pairs meet near a shared circle, ` +
      `${hidden} (${((100 * hidden) / Math.max(1, merged)).toFixed(1)}%) entirely under it; ` +
      `worst ${worst.px.toFixed(2)}px / ${(100 * worst.share).toFixed(2)}% — ${worst.why}`,
  );
});

test("a row's runs are order-preserving — the crossing-free precondition, hug form", () => {
  // The geometry used to demand **one** φ per row: `base + bow·φ(x)`, one run.
  // `hugRuns` (the owner's belly-compaction ask, s121) relaxes that with a
  // proof: per-lane φ keeps siblings ordered as long as flatness order matches
  // bow order — a longer run rises later, holds a SUBSET belly, falls earlier,
  // so `run_i ≥ run_j` gives `φ_i ≤ φ_j` pointwise and `bow·φ` products never
  // reorder within a sign. What this asserts is exactly that precondition on
  // the drawing, plus the two boundaries of the relaxation: a row with any
  // OPENED member does not hug at all (an opened name leaves its own belly for
  // the rim of its band, where the bow-order argument cannot protect it — the
  // 0-crossings bar caught precisely this), and zero-bow lanes are free (a
  // zero-bow lane IS its base whatever its run).
  let rows = 0;
  let hugged = 0;
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
        if (runs.size > 1) hugged += 1;
        if (row.some((lane) => lane.open)) {
          // **Zero-bow lanes are exempt here too, and until W21 nothing in the
          // corpus made that visible.** This branch counted every run in the
          // row while the branch below already skipped zero-bow lanes — so the
          // relaxation's second boundary, stated in this test's own opening
          // paragraph ("zero-bow lanes are free: a zero-bow lane IS its base
          // whatever its run"), was implemented in one of the two branches and
          // not the other. The hazard this branch guards is a SIBLING'S TENDON
          // sweeping through an opened name that has left its own belly for the
          // rim of its band. A zero-bow lane has no tendon: it is a straight
          // line at its base, and its run cannot sweep through anything.
          //
          // The variational region is the first structure to build such a row —
          // `adapt-ansatz` opened beside its own-stretch lane, bow 0.0, run 16
          // against the bracket's 59.2 — so this was latent rather than wrong
          // for the corpus it was written against. Narrowed to exactly the
          // lanes the paragraph already exempts, and no further: an opened row
          // with two DIFFERENT non-zero bows still fails, which is the case the
          // 0-crossings bar caught.
          const bowed = new Set(row.filter((lane) => lane.bow !== 0).map((lane) => lane.run));
          assert.equal(
            bowed.size,
            1,
            `${focus.id} row ${key}: a row with an opened member must keep the shared run — ` +
              `an opened name sits at the rim of its band, outside what the bow-order argument protects`,
          );
          continue;
        }
        for (const sign of [1, -1]) {
          const members = row
            .filter((lane) => Math.sign(lane.bow) === sign)
            .sort((a, b) => Math.abs(a.bow) - Math.abs(b.bow));
          for (let i = 1; i < members.length; i++) {
            assert.ok(
              members[i]!.run <= members[i - 1]!.run + 1e-9,
              `${focus.id} row ${key}: |bow| ${Math.abs(members[i]!.bow).toFixed(1)} drew run ` +
                `${members[i]!.run.toFixed(1)} above its inner sibling's ${members[i - 1]!.run.toFixed(1)} — ` +
                `flatness order no longer matches bow order, and the products can reorder`,
            );
          }
        }
      }
    }
  }
  assert.ok(rows > 100, `only ${rows} sibling rows checked`);
  // The relaxation must actually be exercised, or this test guards a feature
  // that quietly stopped existing.
  assert.ok(hugged > 10, `only ${hugged} rows drew per-lane runs — the hug is not running`);
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
  // And on the drawing: no lane anywhere is drawn past its ceiling. There are two
  // now — a first-order line may take `maxFirstOrderTendonRun` — and the split is
  // the point, so both halves are checked and the nested half is checked
  // separately. `maxTendonRun`'s own note holds it at 110 because it is "paid
  // twice per level of nesting, on every column": if the raise ever leaked below
  // depth 0 that argument would start compounding, and the second assertion is
  // what says it has not.
  let firstOrder = 0;
  let nested = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      for (const lane of openDiagram(focus.id, open, "en").lanes) {
        // Two bounds now, because a run has two sources. The SHARED run — what
        // sizes the column — keeps the per-depth ceilings: those exist to bound
        // WIDTH, which is paid per level. A HUG run (`hugRuns`) spends width the
        // column already bought, so its bound is the shape's own: half its span,
        // past which a belly inverts. `min(row)` recovers the shared run because
        // hugging only ever lengthens — the outermost lane keeps the floor.
        const ceiling = lane.depth === 0 ? M.maxFirstOrderTendonRun : M.maxTendonRun;
        assert.ok(
          lane.run <= Math.max(ceiling, (lane.x1 - lane.x0) / 2) + 1e-9,
          `${focus.id} ${lane.key} (depth ${lane.depth}): run ${lane.run} past both the ` +
            `${ceiling} ceiling and half its own ${(lane.x1 - lane.x0).toFixed(0)} span`,
        );
        if (lane.depth === 0) firstOrder += 1;
        else nested += 1;
      }
      // No row-level floor assertion, and the absence is deliberate: once every
      // member of an all-shut row hugs, the shared run the column was sized
      // with is not recoverable from the drawn lanes (the first attempt here
      // asserted `min(row) ≤ ceiling` and a fully-hugged nested row refuted
      // it). The width bound the ceilings exist for cannot leak through a hug
      // at all — `hugRuns` runs at placement, after every span is fixed — and
      // the sizing tests above are what pin the widths themselves.
    }
  }
  assert.ok(firstOrder > 100 && nested > 100, `${firstOrder} first-order and ${nested} nested lanes`);
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

test("a first-order line spends a visible share of itself on each tendon", () => {
  // Ask B, and the defect it names, measured as the ratio it actually is rather
  // than as a length. A bounded run on an unbounded line is a *shrinking* taper:
  // before `firstOrderRun`, the bluntest first-order line in the corpus was
  // 4,848px with a **16px** run — 0.33% of itself at each end — and 31 of the 232
  // first-order lanes were under 3%. Drawn, that is a bar with two pinpricks.
  //
  // This is failable on the code it replaced: reverting `firstOrderRun` to a flat
  // `runAcross` puts 31 lanes under this bar, four of them under 0.5%.
  //
  // Three per cent and not more, because the bar has to hold for the *longest*
  // line in the corpus (7,930px), where the ceiling binds rather than the share.
  // Three per cent and not less, because 1% is what the old numbers already gave.
  const FLOOR = 0.03;
  const seen: Array<{ id: string; locale: PublicLocale; length: number; run: number }> = [];
  let bluntest = { id: "", locale: "en" as PublicLocale, share: 1, length: 0, run: 0 };
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const addresses = openableAddresses(focus.id);
    for (const locale of ["en", "ja"] as PublicLocale[]) {
      for (const open of [[], addresses]) {
        for (const lane of openDiagram(focus.id, open, locale).lanes) {
          if (lane.depth !== 0) continue;
          const length = lane.x1 - lane.x0;
          if (length <= 0) continue;
          const share = lane.run / length;
          seen.push({ id: focus.id, locale, length, run: lane.run });
          if (share < bluntest.share) bluntest = { id: focus.id, locale, share, length, run: lane.run };
          assert.ok(
            share >= FLOOR,
            `${focus.id} (${locale}): a first-order line ${length.toFixed(0)}px long drew a ` +
              `${lane.run.toFixed(0)}px tendon — ${(share * 100).toFixed(2)}% of itself at each ` +
              `end, under the ${(FLOOR * 100).toFixed(0)}% bar. It reads as a bar, not as a ` +
              `line that rises, runs level and falls.`,
          );
        }
      }
    }
  }
  assert.ok(seen.length > 200, `only ${seen.length} first-order lanes measured`);
  console.log(
    `[first-order tendons] ${seen.length} lanes; bluntest ${(bluntest.share * 100).toFixed(2)}% ` +
      `(${bluntest.run.toFixed(0)}px on ${bluntest.length.toFixed(0)}px, ${bluntest.id} ${bluntest.locale})`,
  );
});

test("firstOrderRun is a share of the line, floored by the bow and ceilinged", () => {
  // The rule in one place, as arithmetic, so it does not depend on the corpus
  // happening to contain a long enough line.
  const share = M.firstOrderTendonShare;
  // Short line: the bow's own demand wins and nothing changes from today.
  assert.equal(firstOrderRun(110, 400), 110, "a short line keeps the run its bow asked for");
  assert.equal(firstOrderRun(16, 100), 16, "a short straight line keeps its 16px taper");
  // Long line: the share wins, and it is exactly the share.
  assert.equal(firstOrderRun(16, 2000), share * 2000, "a long line takes its share");
  assert.equal(firstOrderRun(110, 3000), share * 3000, "the share overtakes the bow's demand");
  // The crossover is where the two are equal, and it is above every shut column.
  assert.equal(firstOrderRun(110, 110 / share), 110);
  // Ceilinged, and the ceiling is reached.
  assert.equal(firstOrderRun(16, 100_000), M.maxFirstOrderTendonRun, "the ceiling must bind");
  assert.ok(
    M.maxFirstOrderTendonRun > M.maxTendonRun,
    "a first-order line may take a longer tendon than a nested one — that is the change",
  );
  // Monotone in the length, so a longer line never gets a shorter tendon.
  let previous = -1;
  for (const bare of [0, 100, 500, 1375, 2000, 4250, 8000, 40_000]) {
    const run = firstOrderRun(runAcross([0], Number.POSITIVE_INFINITY), bare);
    assert.ok(run >= previous, `firstOrderRun at bare=${bare} went backwards: ${run} < ${previous}`);
    previous = run;
  }
});

// --- how big the drawing is allowed to get ------------------------------------
//
// Every assertion about size in this file is *containment* — a lane stays inside
// `diagram.width`, a label stays inside `diagram.height`. All of them held at
// **105,402px**, because the canvas simply grew to fit. The size itself has never
// been bounded anywhere, and the way it has been found each time is a session
// measuring by hand and writing the number into prose. Twice that prose then
// drifted, which is R10's own lesson: a number that lives only in a document is a
// number nothing is defending.
//
// So the numbers are printed, and they have ceilings. Absolute ceilings, not a
// ratio against the last run: a bar that moves with the drawing goes red when the
// drawing improves, and cannot be read as "this got worse".

/**
 * Generous, and deliberately so — see the note on tripping, below.
 *
 * **The "today" numbers below had drifted, which is the exact failure the block
 * comment above this one warns about.** They read 5,134 wide and 9,677 tall for
 * three sessions while the sweep was measuring 9,571 and 15,900 — so the prose
 * defending the height ceiling was describing a figure with 6,300px of headroom
 * when the real one had 100. The test prints all three every run; the numbers
 * here are from that print on the run that recorded them, not from memory.
 */
const SIZE_CEILING = {
  /**
   * Widest figure, fully opened, either locale. Today **5,908** —
   * `quantum-linear-solve` in `en`.
   *
   * **Lowered from 8,000, which is the opposite of the move this block warns
   * about, and it is calibrated rather than chosen.** The holder before this
   * session was `nonlinear-ode-solve` (ja) at **7,083**, under the rule that
   * cut a chain's belly into equal slices and sized the column at `k × widest`
   * to pay for them. Cutting by demand instead (`chainColumnNeed`,
   * `levelShares`) took the summed width of all 44 figure-locales from 78,867
   * to 66,517px, and this figure with it. So 7,000 is the number that makes the
   * ceiling a real gate on that change: **the geometry it replaced does not fit
   * under it**, while today's widest has 1,092px — 18% — of room to grow, which
   * is more headroom in relative terms than the 917px the old 8,000 left.
   *
   * The pre-W15 history, kept because it is the record of what each shape
   * cost: `linear-ode-solve` held it at 10,573 before a shared interior drew
   * once per figure; 9,571 before first-order lines took a share of themselves
   * as tendon (`firstOrderRun`, session 112), then 10,867, then 294px back off
   * via `tendonAngleDeg` 76° (session 115).
   */
  //
  // **2,036 since issue 16 — `nonlinear-ode-solve` in `en` — and the ceiling
  // comes to 3,000.** An ingredient's fan was a whole extra level of nesting
  // inside its consumer's belly, and `measureCore` charged the column
  // `(n+1) ×` the widest of them; with ingredients on the card, summed
  // saturated width over all 46 figure-locales falls **50,013 → 27,762px
  // (−44.5%)**. Calibrated the same way the two numbers above it were: 3,000
  // is a bar the geometry it replaces (5,908, and 7,083 before that) cannot
  // fit under.
  //
  // **1,955 after issue 22** — `nonlinear-ode-solve` in `en`. The tolerance
  // cut is a width story through `labelPad` (18 -> 8, the box around a label)
  // and `margin` (34 -> 18): summed saturated width 27,832 -> 25,327 (-9.0%).
  // The bar is not lowered again, deliberately — it was set one change ago
  // against a geometry that could not fit under it, and lowering a ceiling on
  // every pass turns it into a running total of the drawing rather than a
  // bound on it. 1,045px of room, and the two variational nodes are what it
  // is being kept for.
  saturatedWidth: 3_000,
  /**
   * Tallest, same sweep. Today **4,634** — `nonlinear-ode-solve` in `en`.
   *
   * **Lowered from 8,000, calibrated exactly as `saturatedWidth` was.** This
   * figure measured **5,645.5** before the vertical half of `5314ca` — the
   * number the width work left untouched by construction, recorded here at the
   * time so this bar could be set against it. 5,500 is therefore a ceiling
   * **the geometry it replaces cannot fit under**, while today's tallest keeps
   * room to grow. (Both numbers are pre-#16; see the note below the constant
   * for where the figure actually stands.)
   *
   * What came off it: a lane that writes its name INSIDE its own line, and an
   * opened fan that writes its name on the BONE, both stopped reserving a
   * `labelBand` beside themselves for a name that is not written there. Corpus
   * summed height 72,232 → 54,836px (−24.1%).
   *
   * The 6,056 this note used to quote was `nonlinear-ode-solve` en re-measured
   * at the W15 merge (the 6,395 recorded at authoring predated dev's 360–362;
   * the PR body's 5,142 is `linear-ode-solve` en — the motivating figure's drop,
   * never the max).
   *
   * **This is the ceiling coming back down, as D119.6 promised it would.** The
   * 22,982px `linear-ode-solve` fan that moved the ceiling 16,000 → 24,000 was
   * the honest figure inflated by the shared-sub-method repeat —
   * `time-discretization`'s five methods drawn once under Taylor, again under
   * Krovi, again under Dyson. W15 draws a shared interior once per figure and
   * later occurrences jump to it, so the debt the 24,000 carried is paid and
   * the ceiling returns to the measurement-plus-headroom convention. (The
   * repeat census that used to live here as a prose number — "130 groups" —
   * drifted while nothing defended it; it is now the invariant test
   * `a shared interior is drawn once per figure`, which prints its own
   * denominator every run.)
   */
  //
  // **1,946 since issues 16 and 17 — `nonlinear-ode-solve` in `en` — and the
  // ceiling comes to 3,000.** A stub reserved `max(feedRun, vHalf) + vHalf` of
  // band on the consuming strand at every level of nesting, so the cost
  // compounded down the tree; and a leaf at depth 0 stopped reserving a band
  // for a name it writes inside its own line once the caption that band was
  // holding up went (issue 17, `dropsNameBand`). Summed saturated height over
  // all 46 figure-locales: **35,438 → 21,377px (−39.7%)**, and the saturated
  // lane count 686 → 594.
  //
  // 3,000 and not lower because the two variational stubs are still to land
  // under it and the shared-sub-method dedup is still what the remaining
  // height is made of; 1,160px — 39% — of room, which is the most this bar has
  // ever left and is meant to be spent rather than admired.
  //
  // **1,840 after issue 22** — `nonlinear-ode-solve` in `en`, from 1,946 —
  // through `margin`, `spineBand` and
  // `innerStateRadius`. A further ~200px was measured, built and taken back
  // out — see the block on `labelBand` in `converge-layout.ts` for the
  // rendered name overlap that stopped it, which is still owed. Summed
  // saturated height 21,477 -> 19,593 (-8.8%). Held at 3,000 for the reason
  // above.
  saturatedHeight: 3_000,
  /**
   * Widest figure with **nothing** open, which is what a reader is handed on
   * arrival. Today **824** against a 1,204px canvas — 963 before this session,
   * and the 139px came off a figure with nothing open because a composite run
   * lane is open *by construction* (`planForSlot` sets `open: true` on a
   * multi-edge run), so a shut figure contains chains and the demand-cut
   * reaches them too. The ceiling stays at 1,400 rather than following the
   * measurement down: past 1,204 every figure arrives scaled down to fit, and
   * a bar between the measurement and that cliff is the one that reports a
   * regression before a reader sees it.
   *
   * **Session 115 shortened the columns and did not move this number**, which is
   * worth writing down rather than reading as a null result. `nonlinear-ode-solve`
   * is wide because of how many circles it has and how long their labels are, not
   * because of its bows — so the tendon angle has nothing to take off it. What
   * did move is the *median* gap between two circles, 314.7 → 292.4 across all 38
   * figure-locales, and the widest single column, 494.5 → 403. A reader sees
   * those; this number is the one figure that happens not to be made of them.
   *
   * 1,026 before session 112, and holding this number down is why the
   * first-order tendon is a *share* of the line rather than a longer flat run:
   * a flat 120px floor fixed the long lines and took this to **1,393**, buying
   * every shut figure a scale-down for a taper its short lines did not need.
   *
   * **Issue 16 did not move it, and that is the expected null result rather
   * than a disappointment**: an ingredient was only ever drawn inside an
   * *opened* strand, so a figure with nothing open never had one. Every shut
   * number in the sweep is byte-identical across that change — summed width
   * 15,287, summed height 11,275, widest 920 — which is also the cheapest
   * evidence that the change removed a drawing rather than rearranging one.
   */
  //
  // **749 after issue 22** — `nonlinear-ode-solve` in `en`, from 824 — and
  // this number is the one the ceiling
  // was always about, because past 1,204 a figure arrives scaled down. It has
  // never had this much room. Summed shut width 16,759 -> 14,395 (-14.1%) and
  // summed shut height 12,979 -> 11,499 (-11.4%), which is where `margin`
  // lands: it is a fixed cost per figure, so the smaller the figure the larger
  // its share.
  shutWidth: 1_400,
} as const;

test("a figure has a ceiling on how big it may get, and the numbers are on the record", () => {
  const rows: Array<{ id: string; locale: PublicLocale; width: number; height: number }> = [];
  let shutWidest = { id: "", width: 0 };
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const addresses = openableAddresses(focus.id);
    for (const locale of ["en", "ja"] as PublicLocale[]) {
      const shut = openDiagram(focus.id, [], locale);
      if (shut.width > shutWidest.width) shutWidest = { id: `${focus.id} (${locale})`, width: shut.width };
      const saturated = openDiagram(focus.id, addresses, locale);
      rows.push({ id: focus.id, locale, width: saturated.width, height: saturated.height });
    }
  }

  const widest = rows.reduce((a, b) => (b.width > a.width ? b : a));
  const tallest = rows.reduce((a, b) => (b.height > a.height ? b : a));
  console.log(
    `saturated: widest ${Math.round(widest.width)}px (${widest.id}, ${widest.locale}), `
      + `tallest ${Math.round(tallest.height)}px (${tallest.id}, ${tallest.locale}), `
      + `shut widest ${Math.round(shutWidest.width)}px (${shutWidest.id}), over ${rows.length} figure-locales`,
  );

  // Not vacuous. A sweep that measured nothing, or measured one locale twice,
  // passes every ceiling below it.
  assert.ok(rows.length >= 30, `only ${rows.length} figure-locales measured`);
  assert.ok(
    rows.some((row) => rows.some((other) => other.id === row.id && other.width !== row.width)),
    "no figure changed width between locales — the sweep is drawing one locale twice",
  );

  // **A trip here is a decision, not a number to raise.** Either the drawing
  // regressed — this is the class of defect that put a figure at 105,402px, and
  // nothing but a hand measurement caught it — or the corpus has outgrown the
  // shape and the shape is what has to change. Bumping the constant is the one
  // response that is always wrong.
  for (const row of rows) {
    assert.ok(
      row.width <= SIZE_CEILING.saturatedWidth,
      `${row.id} (${row.locale}) is ${Math.round(row.width)}px wide, over the ${SIZE_CEILING.saturatedWidth}px ceiling`,
    );
    assert.ok(
      row.height <= SIZE_CEILING.saturatedHeight,
      `${row.id} (${row.locale}) is ${Math.round(row.height)}px tall, over the ${SIZE_CEILING.saturatedHeight}px ceiling`,
    );
  }
  assert.ok(
    shutWidest.width <= SIZE_CEILING.shutWidth,
    `${shutWidest.id} is ${Math.round(shutWidest.width)}px wide shut, over the ${SIZE_CEILING.shutWidth}px ceiling — `
      + "a figure past this arrives scaled down to fit the canvas",
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
      // **Every address the figure emits, enumerated by hand, and the hand is
      // the risk.** It listed four of the five while an ingredient's stub
      // carried a fifth, and the one it omitted was `feed.openHref`, so on
      // `linear-ode-solve` saturated 53 of 53 lanes carried the viewport and 0
      // of 12 stubs did. Ingredients are card content since issue 16 and there
      // is no fifth shape; a new kind belongs in this list on the day it is
      // added.
      //
      // A shared lane's open control is the one address on a figure that MOVES
      // the reader — that is its entire job (W15: the interior is drawn at
      // `sharedWith` and the control goes there). Its `at=` is the target,
      // deliberately, same as the size rungs the header measured. The lane's
      // OTHER addresses still keep the reader standing, so only the jump is
      // set aside — and asserted below for what it must carry instead.
      const addresses = [
        ...carried.lanes.flatMap((lane) => [
          lane.href,
          lane.sharedWith === null ? lane.openHref : null,
        ]),
        ...carried.states.map((state) => state.href),
      ].filter((href): href is string => typeof href === "string");
      assert.ok(addresses.length > 0, `${focus.id} emitted no addresses`);
      for (const href of addresses) {
        checked += 1;
        assert.ok(
          href.includes(`at=${encodeURIComponent(AT)}`),
          `${focus.id}: ${href} dropped the viewport`,
        );
      }
      for (const lane of carried.lanes) {
        if (lane.sharedWith === null) continue;
        assert.ok(
          lane.openHref !== null &&
            lane.openHref.includes(`at=${encodeURIComponent(lane.sharedWith)}`),
          `${focus.id}: ${lane.key} is shared and its control does not go to the drawn occurrence`,
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
      // A shared lane is the third kind of honoured click (W15): it is named
      // in `?open=`, drawn shut BECAUSE its interior is drawn at an earlier
      // occurrence, and following its control moves the reader there — a real
      // change, just not a toggle. Honoured iff the target address is a lane
      // this same drawing holds open.
      if (lane.sharedWith !== null) {
        assert.ok(
          diagram.lanes.some(
            (other) => other.address === lane.sharedWith && other.open,
          ),
          `${focus.id}: ${lane.key} jumps to ${lane.sharedWith}, which is not an open lane on this figure`,
        );
        continue;
      }
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
  // Open OR shared, since W15: the id form still touches every occurrence, but
  // occurrences past the first draw as shared jumps rather than as second
  // interiors — which is the dedup's whole point, not a loss of the id's
  // meaning. Counting drawn-open alone would say the two forms "became one"
  // precisely because the duplicate interiors stopped being drawn.
  const touchedBy = (d: ConvergeDiagram) =>
    d.lanes.filter((one) => one.open || one.sharedWith !== null).length;
  const byId = touchedBy(openDiagram(FOCUS, [...ancestors, found.id]));
  const byAddress = touchedBy(openDiagram(FOCUS, [...ancestors, found.address]));
  assert.ok(
    byId > byAddress,
    `${found.id} touches ${byId} lanes and its address touches ${byAddress} — the two forms have become one`,
  );
});

// --- what a route DRAWS inside itself, and when two of them draw one picture --
//
// The owner, session 107: *"Truncated Taylor propagator, all-at-once encoding",
// "Krovi's reanalysis of the all-at-once encoding" and "Truncated Dyson series,
// all-at-once encoding" all draw the identical picture.* They did. All three
// delegate `time-discretization` then `quantum-linear-solve`, `chainInside`
// labelled each hop with the **slot**, and the `via` pin that says which
// discretization a route actually uses was read by nothing on the canvas.
//
// The assertions below are on the **drawn** sequence — lane labels off a real
// `layoutConverge` result — and not on `routeOf`, `steps` or `via`. That
// distinction is the whole point of writing them: `scripts/check-layer-graph.mjs`
// had been grouping on `steps` plus `via` since the pin was introduced, which is
// a second hand-written model of the picture, and it read the Taylor group as
// split for twenty-odd merges while the canvas drew it as one.

/**
 * The interior of one lane, as a reader sees it: the hops along it, then the
 * ingredients hanging off it.
 *
 * `fullLabel`, because that is the name of the hop — `label` is the same string
 * cut to the column, so two hops whose names differ only past the cut would read
 * as identical here and the census would report a duplicate the canvas does not
 * draw.
 *
 * The exception is the hop a method performs itself, which is `nameless` and
 * draws no text at all: its name is the method's own and the lane above already
 * carries it. It is `«own»` here for exactly that reason. Keying it by the
 * method's id instead would make every route with an own-work tail unique by
 * construction, and this census — whose job is to find two routes drawing one
 * picture — would stop being able to find anything.
 */
function drawnInterior(diagram: ConvergeDiagram, lane: ConvergeLane): string | null {
  // **Steps only.** It carried a `feedKey === null` clause as well, to keep an
  // opened ingredient's own lane out of the sequence: a stub's fan was placed
  // with `parentKey` set to the method it hung off, so it landed in this list
  // *as well as* in the ingredient list that used to follow, and the summary
  // then changed with how far that branch happened to open. Ingredients are
  // card content since issue 16 and no lane hangs off the side any more.
  // **And not a nested refinement (W13).** A variant carries `parentKey` like
  // a step does — it is drawn within the parent's band — but it is a peer of
  // the route, not a hop of it, and counting it here made `taylor-all-at-once`
  // read as `Krovi's reanalysis ▸ Truncated Taylor series ▸ …`, a route that
  // begins with a different method.
  const hops = diagram.lanes
    .filter((child) => child.parentKey === lane.key && !child.variant)
    .sort((a, b) => a.x0 - b.x0)
    .map((child) => (child.nameless ? "«own»" : child.fullLabel));
  if (hops.length === 0) return null;
  return hops.join(" ▸ ");
}

/**
 * Every method the map draws an interior for, anywhere, with what it draws.
 *
 * A `Set` per method rather than one string, because a method is drawn on more
 * than one figure — `qsvt-transform` appears under `matrix-function` and again
 * inside `qsvt-matrix-inversion` on another figure — and a method that drew two
 * different interiors depending on where it was reached would be a defect this
 * would otherwise average away. Asserted below to be exactly one each.
 */
function drawnInteriors(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = openDiagram(focus.id, openableAddresses(focus.id));
    for (const lane of diagram.lanes) {
      if (!lane.nodeId || !lane.open) continue;
      const node = layerNode(LAYER_GRAPH, lane.nodeId);
      if (!node || !isMethod(node)) continue;
      const drawn = drawnInterior(diagram, lane);
      if (drawn === null) continue;
      found.set(lane.nodeId, (found.get(lane.nodeId) ?? new Set()).add(drawn));
    }
  }
  return found;
}

/** The one drawn interior of `id`, or null where the map draws none. */
function interiorOf(drawn: Map<string, Set<string>>, id: string): string | null {
  const set = drawn.get(id);
  if (set === undefined) return null;
  assert.equal(set.size, 1, `${id} draws ${set.size} different interiors depending on where it is reached`);
  return [...set][0]!;
}

test("a route that pins its step draws the algorithm's name there, not the slot's", () => {
  const drawn = drawnInteriors();
  const taylor = interiorOf(drawn, "taylor-all-at-once");
  const dyson = interiorOf(drawn, "dyson-all-at-once");
  assert.ok(taylor && dyson, "the two pinned all-at-once routes are drawn");

  // Two routes, two pictures. Not two *routes* — `steps` is still
  // `time-discretization + quantum-linear-solve` on both, which is correct
  // and is why comparing routes here would prove nothing.
  assert.equal(new Set([taylor, dyson]).size, 2, `${taylor}\n${dyson}`);

  // And the names are the pinned ones, read off the drawing rather than inferred
  // from the count above being 2 — a count of 2 is also what two *wrongly*
  // labelled hops would give.
  assert.match(taylor, /^Truncated Taylor series of the propagator ▸ /);
  assert.match(dyson, /^Truncated Dyson series of the propagator ▸ /);
  // Krovi drew the slot-labelled pair here until s121 — honest (the paper
  // chooses no discretization, so no pin is permitted) but a third lane whose
  // internals a reader already finds one lane away. Folded by the owner's W17
  // ruling: no slot figure draws it, and the absence is the assertion.
  assert.equal(interiorOf(drawn, "krovi-linear-ode"), null, "krovi is folded and must draw no slot-figure interior");

  // The other group the same pin splits. Schrödingerisation recasts through the
  // warped phase transformation and the LCHS route through the kernel
  // identity; unpinned, they drew `hamiltonian-recasting → simulate`.
  const lchs = interiorOf(drawn, "lchs-route");
  const schrodinger = interiorOf(drawn, "schrodingerisation");
  assert.ok(lchs && schrodinger);
  assert.notEqual(lchs, schrodinger);
  assert.match(lchs, /^Kernel-weighted combination of unitary propagators ▸ /);
  assert.match(schrodinger, /^Warped phase transformation ▸ /);

  // `lchs-improved-kernel` — the owner's model case for W17 — is folded for
  // exactly the reason this assertion used to state: its interior was
  // *deliberately* identical to `lchs-route`'s (same kernel-identity pin, same
  // simulate), so the pair now draws ONE lane and the refinement lives in the
  // LCHS card's Refinements section.
  assert.equal(interiorOf(drawn, "lchs-improved-kernel"), null, "the improved kernel is folded and must draw no slot-figure interior");
});

/**
 * Groups of methods that fill one slot and draw one interior, with the reason
 * each survives.
 *
 * **The twin of `KNOWN_TWINS` in `scripts/check-layer-graph.mjs`.** They are
 * not one list because they measure two different things — that script groups
 * the authored routes, this groups a rendered diagram — and the whole reason
 * this session exists is that the two models had silently disagreed. What keeps
 * them honest is that **both sides error on a row nothing exercises**: a group
 * that stops colliding fails here and there, so a drift is red on one side
 * rather than quiet on both.
 *
 * **They no longer hold the same groups, and the difference is issue 16.** A
 * method whose only recorded structure is its ingredients draws no interior at
 * all now that ingredients are card content, so the three readouts collide as
 * authored routes and do not collide as pictures — the picture is empty on all
 * three, and an empty picture is a leaf rather than a twin. The row for them
 * lives on that script's list and not on this one.
 *
 * A `refines` chain is not on this list and never needs to be. Declaring one
 * method a narrower version of another is the graph already saying why two
 * pictures are one, and it is checked structurally below.
 */
const DRAWN_TWINS: ReadonlyArray<{ slot: string; methods: readonly string[]; why: string }> = [
  // **The `quantum-linear-solve` row is gone, and ai-ops#51 is why.** It held
  // `qsvt-matrix-inversion` and `eigenstate-filtering-inversion`, and its own
  // text named its exit precisely: *"What still separates the two and the map
  // cannot say is WHICH POLYNOMIAL goes through the transform — a scaled $1/x$
  // against a minimax filter that is 1 at a target eigenvalue and uniformly
  // small outside a spectral gap — and that is a specification on a hop, not a
  // method filling it. … `via` names a method and `through` names a state;
  // neither can carry 'with an odd polynomial approximating $1/x$'. Both records
  // already state their polynomial, so this row's exit is a field to write it
  // into, not a source to go and find."*
  //
  // The field is `LayerMethod.spec`, the two phrases are read off the two
  // `summary` clauses, and the row deleted itself: the census now finds the two
  // interiors distinct and the "delete the row" assertion below is what said so.
  //
  // The `time-discretization` row — `backward-euler` with `trapezoidal-rule` —
  // was deleted in session 118. Both drew one interior only because both hung the
  // same `quantum-linear-solve` stub, and that step is gone by the owner's
  // ruling. They are now leaves, and two leaves draw no interior at all, so there
  // is nothing here to exempt. They are still same-slot twins on the *hollow*
  // scoreboard, which is a different measurement and a corpus job.
  //
  // **Three rows left the same way with issue 16**, and the pattern is worth
  // naming because it is the whole shape of that ruling on this census: a group
  // whose members were told apart *only* by an ingredient stops colliding by
  // stopping being drawn at all. `observable-estimation`'s four readouts,
  // `ansatz-construction`'s three adaptive constructions, and
  // `excited-state-energy`'s subspace-expansion / equation-of-motion pair each
  // record one route segment and at least one ingredient, so with ingredients
  // on the card they hold no interior and are leaves. Two leaves draw no
  // picture at all rather than one picture twice, and a row nothing exercises
  // is a licence nobody watches — the assertion below says so itself.
  {
    slot: "excited-state-energy",
    methods: [
      // **Four, not five: `folded-spectrum-excited-state` has left.** It is pinned to
      // `variance-objective` and `measurement-grouped-readout` on Cadi Tazi and Thom's own
      // words — the method "minimizes the energy variance" and "employ[s] a Pauli grouping
      // procedure" — so its middle and last hops now wear those names instead of the slots'.
      // The pins were written in B5 unit 3 and held on a size argument that had gone stale by
      // three orders of magnitude; see the `KNOWN_TWINS` row in `scripts/check-layer-graph.mjs`
      // for the measurement. The remaining four are the ones with nowhere honest to point:
      // their objectives have no node, and authoring one each would draw the same papers a
      // second time. The owner's ai-ops#51 answer names the fix — a specification in the
      // label, "something like 'penalty objective'" — and that field does not exist yet.
      "deflation-excited-state",
      "subspace-search-excited-state",
      "penalty-excited-state",
      "contracted-excited-state",
    ],
    why:
      "Four ways to a state above the ground state that each choose an ansatz, optimise it and " +
      "estimate an observable — VQE's three hops, reused deliberately rather than by accident. What " +
      "separates them is the OBJECTIVE handed to the optimiser: a weighted sum over orthogonal " +
      "inputs, the variance around a target energy, the energy plus a symmetry penalty, and a " +
      "contracted multistate objective. An objective earns its own node here only where a paper is " +
      "devoted to one — `cvar-objective` is — so most of these have nothing honest to pin a `via` " +
      "to. **`deflation-excited-state` is the fifth member and used to be excluded by name**: this " +
      "row read *\"deflation is defined against the states already found — that stub is the " +
      "difference, and it is drawn\"*, and the stub was its `ground-state-energy` ingredient. Issue " +
      "16 put ingredients on the card, so the difference is no longer drawn and the exclusion has " +
      "no basis. It is a line in deflation's Requires section instead.",
  },
  // The three-member `quantum-linear-solve` row that stood here is gone, and its own
  // text said what would replace it: "a pin waiting on that slot being decomposed".
  // `discrete-adiabatic-inversion` has left outright — it applies its filter "as a
  // linear combination of walk operators rather than by quantum signal processing", so
  // its hop wears `lcu-chebyshev-transform` and the other two wear `qsvt-transform`.
  // The two that still draw one interior are the row at the top of this table, and the
  // reason they do is now a different and smaller one.
  {
    slot: "hamiltonian-simulation",
    methods: ["lcu-taylor-simulation", "qubitization-simulation"],
    why:
      "Both block-encode the Hamiltonian and then do their own work on it, so the drawn sequence is " +
      "one hop and a remainder for each. Everything that differs is an ingredient — Taylor needs a " +
      "prepared state and an amplification round, qubitization needs QSP phase factors — and " +
      "ingredients are on the card, not the canvas (issue 16). New with that ruling.",
  },
  {
    slot: "matrix-function",
    methods: ["qsvt-transform", "lcu-chebyshev-transform"],
    why:
      "The same shape one slot down, and new with issue 16 for the same reason: both block-encode " +
      "and then transform, and what differs is what each needs to do it — QSVT wants phase factors " +
      "on top of the polynomial approximation both take. That is an ingredient, so it is on the card.",
  },
];

/**
 * Methods with an interior **the map** draws nowhere, and why.
 *
 * Since session 110 the qualifier is load-bearing and the name is a little
 * narrow: all four of these ARE drawn, on their own pages, because
 * `layoutConvergeForMethod` fans their slot unconditionally. What they are
 * missing is a lane on the *map*, whose root figures stay state chains on
 * purpose — that convergence is the thing the map exists to show. So this list
 * is still exactly right about `drawnInteriors()`, which sweeps saturated slot
 * figures, and a later session must not read it as "nothing draws these".
 *
 * Not a footnote — it is the denominator of the census below, and without it
 * that census reads as covering the graph when it covers what the graph happens
 * to nest. All four are the fillers of `nonlinear-ode-solve`, which is a **root**:
 * its figure is the state chain over its own dominators, so the four routes are
 * aggregated into slot lanes and never drawn as lanes of their own. Their pins
 * are therefore recorded, validated, and drawn nowhere — the same condition
 * every pin was in before session 107, surviving in the one place the fix cannot
 * reach from `chainInside`.
 *
 * Deliberately a `deepEqual` rather than a subset check: a method leaving this
 * list is the map having started to draw it, and it must then be swept by the
 * census rather than quietly exempt from both.
 */
const DRAWN_NOWHERE: readonly string[] = [
  "carleman-euler-qls-route",
  "kvn-simulation-route",
  "level-set-observable-route",
  "homotopy-perturbation-route",
  // s121 (W17): the two folded refinements that hold an interior. Different
  // reason from the four above — not aggregation at a root, but the owner's
  // fold ruling: no slot figure draws them. Both still draw on their own
  // pages, where `layoutConvergeForMethod` unfolds its subject.
  // (`lightsabre-routing` is folded too, but atomic — no interior to miss.)
  "krovi-linear-ode",
  // `tetris-adapt-ansatz` and `iterative-qcc-ansatz` were here and are not any
  // more. Both are folded refinements, and both were listed because they *held*
  // an interior — the only thing either had inside was its parent's screening
  // stub. Issue 16 put ingredients on the card, so neither holds an interior at
  // all now: they leave `holders` above rather than this exemption, which is
  // the right side to leave from. Their backlog items are unchanged and still
  // on the nodes as `potentialPath`.
  "lchs-improved-kernel",
];

test("a shared interior is drawn once per figure, and the census prints the denominator", () => {
  // W15's invariant, replacing the prose number that guarded this before. The
  // "130 groups" written in NEXT.md and quoted in two test comments drifted —
  // a fresh census on the session that built the dedup measured 60 groups (39
  // intra-figure), with the worst offenders larger than the prose said
  // ("Block-encode a matrix" ×18 where the note said ×14). A number that lives
  // only in a document is a number nothing is defending, so the census is this
  // sweep now, and the denominator prints every run.
  //
  // The subtree is re-derived here from `parentKey` links, independently of the
  // layout's own `interiorShape` — a derived value cannot verify itself.
  let sharedLanes = 0;
  let openInteriors = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      const open = new Set(openableAddresses(focus.id));
      const diagram = openDiagram(focus.id, open, locale);
      const childrenOf = new Map<string, typeof diagram.lanes>();
      for (const lane of diagram.lanes) {
        if (lane.parentKey === null) continue;
        childrenOf.set(lane.parentKey, [...(childrenOf.get(lane.parentKey) ?? []), lane]);
      }
      const subtree = (key: string): string =>
        (childrenOf.get(key) ?? [])
          .map((lane) => `${lane.draws ?? lane.own ?? ""}(${subtree(lane.key)})`)
          .join(",");
      const seen = new Map<string, string>();
      for (const lane of diagram.lanes) {
        if (lane.sharedWith !== null) {
          sharedLanes += 1;
          continue;
        }
        if (!lane.open || lane.draws === null) continue;
        const interior = subtree(lane.key);
        if (interior === "") continue;
        openInteriors += 1;
        const key = `${lane.draws}#${interior}`;
        const first = seen.get(key);
        assert.equal(
          first,
          undefined,
          `${focus.id} (${locale}): ${lane.draws} draws the same interior twice — at ${first} and ${lane.address}`,
        );
        seen.set(key, lane.address);
      }
    }
  }
  console.log(
    `shared-interior census: ${openInteriors} open interiors drawn, ${sharedLanes} occurrences demoted to jumps, over ${
      drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).length
    } saturated figures × 2 locales`,
  );
  assert.ok(openInteriors > 50, `only ${openInteriors} open interiors — the sweep has gone quiet`);
  assert.ok(sharedLanes > 20, `only ${sharedLanes} shared lanes — is the dedup running at all?`);
});

test("no two routes through one slot draw the same interior unless something says why", () => {
  const drawn = drawnInteriors();

  // The denominator first. A census that swept nothing passes every clause below
  // it, and this one *cannot* sweep everything — see `DRAWN_NOWHERE`.
  const holders = LAYER_GRAPH.nodes.filter((node) => {
    if (!isMethod(node)) return false;
    const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, node);
    // `planForMethod`'s own `holds`, and it must stay that expression: two
    // hops. A leaf draws no interior at all, and two nothings are not one
    // picture — without this the four atomic ways through `qsp-phase-factors`
    // would read as a group of four drawing the same blank. It read
    // `|| route.feeds.length > 0` while ingredients were shapes on the canvas,
    // and dropping that clause here without dropping it there would leave seven
    // methods listed as holding an interior the map cannot draw.
    return route.segments.length >= 2;
  });
  const undrawn = holders.map((node) => node.id).filter((id) => !drawn.has(id));
  console.log(
    `drawn interiors: ${drawn.size} of ${holders.length} methods that hold one, over `
      + `${drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).length} saturated figures`,
  );
  assert.deepEqual(undrawn.sort(), [...DRAWN_NOWHERE].sort());
  // 20 until issue 16. The seven methods whose only recorded structure was
  // their ingredients hold no interior the canvas draws, so they leave both
  // sides of this census at once — `holders` above and `drawn` here — and the
  // floor comes down with them rather than becoming a bar the ruling cannot
  // clear. It is still an absolute number and not a share of `holders`: a share
  // is satisfied by a sweep that has stopped drawing anything at all.
  assert.ok(drawn.size >= 14, `only ${drawn.size} methods drew an interior — the sweep has gone quiet`);

  const groups = new Map<string, { slot: string; drawn: string; ids: string[] }>();
  for (const id of drawn.keys()) {
    const node = layerNode(LAYER_GRAPH, id);
    assert.ok(node && isMethod(node));
    const interior = interiorOf(drawn, id)!;
    const key = `${node.realizes}\n${interior}`;
    const group = groups.get(key) ?? { slot: node.realizes, drawn: interior, ids: [] };
    group.ids.push(id);
    groups.set(key, group);
  }

  // A group is declared when its members form one refinement chain: exactly one
  // member refines nothing inside the group and every other names a distinct
  // member. Same rule as the lint script's, and `validateLayerGraph` guarantees
  // a `refines` target fills the same slot, so a chain found here cannot cross
  // slots.
  const declared = (ids: readonly string[]): boolean => {
    const members = new Set(ids);
    const parents = ids
      .map((id) => {
        const node = layerNode(LAYER_GRAPH, id);
        return node && isMethod(node) ? node.refines : undefined;
      })
      .filter((parent): parent is string => parent !== undefined && members.has(parent));
    return parents.length === ids.length - 1 && new Set(parents).size === parents.length;
  };

  const matched = new Set<(typeof DRAWN_TWINS)[number]>();
  for (const group of groups.values()) {
    if (group.ids.length < 2) continue;
    if (declared(group.ids)) continue;
    const known = DRAWN_TWINS.find(
      (row) =>
        row.slot === group.slot &&
        row.methods.length === group.ids.length &&
        row.methods.every((id) => group.ids.includes(id)),
    );
    assert.ok(
      known,
      `${group.slot}: ${group.ids.join(", ")} all draw "${group.drawn}" and nothing says why. `
        + "Pin a hop with `via`, declare one a `refines` of another, or add the group to DRAWN_TWINS "
        + "with the reason it survives.",
    );
    matched.add(known);
  }
  for (const row of DRAWN_TWINS) {
    assert.ok(
      matched.has(row),
      `${row.slot}: DRAWN_TWINS records ${row.methods.join(", ")} as drawing one interior, and they no `
        + "longer do. Delete the row — a standing exception nothing exercises is a licence nobody watches.",
    );
  }

  // Not vacuous in the other direction either: if every group were a singleton
  // the loop above would assert nothing at all and the list would look clean.
  assert.equal(matched.size, DRAWN_TWINS.length);
});

// --- a method's own page draws that method -------------------------------
//
// Nothing tested this surface at all until session 110: every `layoutConverge(`
// call in this file passed a **capability**, and `repository-layers.test.ts`
// (1,302 lines) mentions neither the zoom nor the layout. So the page a reader
// reaches from every method name on the map was unguarded, and it was wrong —
// 45 of 63 pages drew a figure with their own method nowhere on it, 43 of 63
// drew a figure byte-identical to another method's page, and not one of the
// corpus's ten `via` pins was drawn on the page of the method that pinned it.
//
// The three assertions below are the three failures, one each. They are stated
// over **every** method rather than over a list, because a list is what let this
// survive: the census above sweeps saturated *slot* figures, so no matter how
// carefully it was written it could not see a defect that lives on the pages.

/** The figure `ProcessZoom` builds for a method's own page. One definition. */
function pageFigure(methodId: string, locale: "en" | "ja" = "en"): ConvergeDiagram {
  const node = layerNode(LAYER_GRAPH, methodId);
  assert.ok(node && isMethod(node), `${methodId} is not a method`);
  return layoutConvergeForMethod({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    method: node,
    locale,
    at: null,
  });
}

/**
 * What a reader can **see** of a figure, and nothing else.
 *
 * Deliberately excludes `href` and `address`: those already differed across all
 * 63 pages while the drawing was identical on 43 of them, because `withOpen`
 * copies the unmatched id into every link. Hashing them would have made the
 * duplicate assertion below pass on the defect it exists to catch.
 */
function drawnShape(diagram: ConvergeDiagram): string {
  return JSON.stringify({
    w: diagram.width,
    h: diagram.height,
    grain: diagram.grain,
    caption: diagram.caption,
    states: diagram.states.map((state) => [state.stateId, state.cx, state.cy, state.r]),
    lanes: diagram.lanes.map((lane) => [
      lane.fullLabel,
      lane.d,
      lane.outline,
      lane.open,
      lane.depth,
      lane.subject,
    ]),
  });
}

const METHOD_IDS = LAYER_GRAPH.nodes.filter(isMethod).map((node) => node.id);

test("every method's own page draws that method, marked as the one it is about", () => {
  // The denominator, printed. A sweep over an empty list passes every clause
  // under it, and this one is built from a filter.
  console.log(`method pages swept: ${METHOD_IDS.length}`);
  assert.ok(METHOD_IDS.length >= 60, `only ${METHOD_IDS.length} methods — the sweep has gone quiet`);

  const empty: string[] = [];
  for (const id of METHOD_IDS) {
    const diagram = pageFigure(id);
    if (diagram.empty) {
      empty.push(id);
      continue;
    }
    const subjects = diagram.lanes.filter((lane) => lane.subject);
    assert.equal(
      subjects.length,
      1,
      `${id}: ${subjects.length} lanes marked as the subject of its own page, expected exactly 1`,
    );
    // The mark is on the right line, checked against the node rather than
    // against the flag that set it. `nodeId` is null on a leaf — that is the
    // whole reason `subject` exists — so the href is what identifies it, and it
    // carries query parameters by the time it reaches here.
    assert.ok(
      subjects[0]!.href.startsWith(`/repository/layers/${id}?`)
        || subjects[0]!.href === `/repository/layers/${id}`,
      `${id}: the subject lane points at ${subjects[0]!.href}`,
    );
  }
  assert.deepEqual(empty, [], "a method whose page draws nothing at all");
});

test("no two method pages draw the same picture", () => {
  const byShape = new Map<string, string[]>();
  for (const id of METHOD_IDS) {
    const diagram = pageFigure(id);
    if (diagram.empty) continue;
    const shape = drawnShape(diagram);
    byShape.set(shape, [...(byShape.get(shape) ?? []), id]);
  }
  const drawn = [...byShape.values()].flat().length;
  console.log(`method pages drawn: ${drawn}, distinct pictures: ${byShape.size}`);
  assert.equal(byShape.size, drawn, "two method pages draw one picture");
  // Not vacuous: a sweep that drew nothing would satisfy the equality above.
  assert.ok(drawn >= 60, `only ${drawn} method pages drew anything`);
});

test("a pinned step is drawn on the page of the method that pinned it", () => {
  // > *"taylor and krovi's definitely have some unique math that is not the
  // > simple propagator/QLS path, so why isn't that reflected in the map?"*
  // > — owner, session 109
  //
  // `chainInside` has honoured a `via` pin since PR 322. What it could not do is
  // run: a pin is drawn inside an **opened method lane**, and on the two
  // non-atomic slots the method had no lane to open. Every one of the ten was
  // therefore invisible on the one page that is about the method that authored
  // it, which is the page a reader goes to for exactly this fact.
  const pins: { method: string; step: string; filler: string }[] = [];
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node)) continue;
    for (const [step, filler] of Object.entries(node.via ?? {})) {
      pins.push({ method: node.id, step, filler });
    }
  }
  console.log(`via pins in the corpus: ${pins.length}`);
  assert.ok(pins.length >= 8, `only ${pins.length} pins — the corpus sweep has gone quiet`);

  const missing = pins
    .filter(({ method, filler }) => {
      const diagram = pageFigure(method);
      return !diagram.lanes.some(
        (lane) =>
          lane.nodeId === filler
          || lane.href.startsWith(`/repository/layers/${filler}?`)
          || lane.href === `/repository/layers/${filler}`,
      );
    })
    .map(({ method, step, filler }) => `${method} pins ${step} to ${filler}`);
  assert.deepEqual(missing, [], "a pin the page of its own method does not draw");
});

test("the map never marks a subject lane", () => {
  // `subject` belongs to a method's page and to nothing else. If a map figure
  // ever grows one, `layoutConverge` has started answering the other question —
  // and the state chain that shows the convergence is what would have gone.
  let sweptFigures = 0;
  let sweptLanes = 0;
  for (const capability of LAYER_GRAPH.nodes.filter(isCapability)) {
    for (const open of [new Set<string>(), new Set(LAYER_GRAPH.nodes.map((node) => node.id))]) {
      const diagram = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus: capability,
        locale: "en",
        open,
        at: null,
      });
      sweptFigures += 1;
      sweptLanes += diagram.lanes.length;
      const marked = diagram.lanes.filter((lane) => lane.subject).map((lane) => lane.fullLabel);
      assert.deepEqual(marked, [], `${capability.id}: the map marked a subject lane`);
    }
  }
  console.log(`map figures swept for subject marks: ${sweptFigures}, lanes: ${sweptLanes}`);
  assert.ok(sweptLanes >= 200, `only ${sweptLanes} lanes swept — the sweep has gone quiet`);
});

/**
 * Everything `cardFor` needs, with an empty corpus.
 *
 * Empty because these tests ask whether a card *can be built*, never what its
 * repository join holds — and a corpus loaded here would make the answer depend
 * on the catalog, which is exactly the coupling `card-content.ts` takes a
 * projection to avoid.
 */
// --- the card layer, and which surface is allowed to offer it ----------------
//
// W5 slice two. A name on the map opens the node's card in place instead of
// leaving the map for its page. The three things that can go wrong are all
// surface-shaped rather than geometric, so they are asserted here rather than
// looked at once in a browser:
//
//  1. offering a card where no panel is mounted — the dead control this canvas
//     has already produced twice;
//  2. offering a card whose href has a different pathname from the page drawing
//     it, which `canvas-continuity` will not intercept, so the click leaves the
//     map altogether;
//  3. a card link that quietly drops the reader's focus, open set or viewport,
//     which is the bug `at` was threaded through this whole file to prevent.

test("a card link is offered only where a card layer exists, and never otherwise", () => {
  let withCards = 0;
  let withoutCards = 0;
  for (const capability of LAYER_GRAPH.nodes.filter(isCapability)) {
    for (const open of [new Set<string>(), new Set(openableAddresses(capability.id))]) {
      const on = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus: capability,
        locale: "en",
        open,
        cards: true,
      });
      // The node page's picture. `cards` is absent, not false, because absent is
      // what the other caller actually passes and a default is only real if the
      // test takes the same path the caller does.
      const off = layoutConverge({
        graph: LAYER_GRAPH,
        vocabulary: STATE_VOCABULARY,
        focus: capability,
        locale: "en",
        open,
      });

      const offered = off.lanes.filter((mark) => mark.cardHref !== null);
      assert.deepEqual(
        offered.map((mark) => mark.address),
        [],
        `${capability.id}: a figure with no card layer offered ${offered.length} card links`,
      );
      // A circle is not offered one either, and for a different reason: `?card=`
      // resolves against the layer graph and a state is not a node in it. When
      // the state card lands this assertion is the one that has to change, which
      // is the point of writing it down.
      assert.deepEqual(
        on.states.filter((state) => state.cardHref !== null).map((state) => state.stateId),
        [],
        `${capability.id}: a state circle offered a card that ?card= cannot resolve`,
      );

      for (const mark of on.lanes) {
        const own = mark.own;
        const draws = mark.draws;
        const id = own !== null ? ownCardId(own) : draws;
        if (mark.cardHref === null) {
          // **One shape may go without a card, and only one.** The stretch a
          // method performs itself used to be the exception here and is not any
          // more — it is addressed as `own:<methodId>`. What is left is the run
          // of *named hops*: a union whose name is `A → B` and which is drawn as
          // its hops, so the hops carry the cards and a card about their union
          // would be a card about the coined composite the owner refused.
          //
          // Named by the field rather than allowed as "anything with no node id",
          // which is what this clause said before and is how the own stretch sat
          // uncovered: `composite` and `own` are both null-id lanes and only one
          // of them is meant to be cardless.
          assert.ok(
            mark.composite,
            `${capability.id}: ${mark.address} (draws=${draws}, own=${own}) was offered no card`,
          );
          continue;
        }
        withCards += 1;
        assert.ok(
          cardFor(CARD_INPUT, id!) !== null,
          `${capability.id}: ${mark.address} offers a card for ${id}, which nothing can build`,
        );
        const url = new URL(mark.cardHref, "https://leonaqt.com");
        // The pathname is the whole of the interception rule. Anything else here
        // is a full document navigation off the map.
        assert.equal(
          url.pathname,
          "/repository/layers",
          `${capability.id}: ${mark.address}'s card href leaves the map`,
        );
        assert.equal(url.searchParams.get("card"), id);
        // The click's PLACE, not only its subject. One node is drawn in several
        // places since W15, and a card id alone falls to the first of them —
        // which is how the owner's click on "quantum linear solve" flew the
        // camera to the same-named process elsewhere. The href names the
        // occurrence it sits on, and `resolveSelection`'s address pass makes
        // that exact.
        assert.equal(
          url.searchParams.get("sel"),
          mark.address,
          `${capability.id}: ${mark.address}'s card href does not name its own occurrence`,
        );
        // Everything the reader was already holding, still held.
        assert.equal(url.searchParams.get("focus"), capability.id);
        assert.deepEqual(
          url.searchParams.getAll("open").sort(),
          [...open].sort(),
          `${capability.id}: ${mark.address}'s card href dropped part of the open set`,
        );
      }
      withoutCards += offered.length;
    }
  }
  console.log(`card links offered on the map: ${withCards}; on a node page: ${withoutCards}`);
  assert.equal(withoutCards, 0);
  assert.ok(withCards >= 200, `only ${withCards} card links — the sweep has gone quiet`);
});

test("a card link carries the reader's viewport, exactly as every other address does", () => {
  const focus = layerNode(LAYER_GRAPH, "linear-ode-solve");
  assert.ok(focus && isCapability(focus));
  const at = "120.5,-40,1.75";
  const diagram = layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus,
    locale: "en",
    at,
    cards: true,
  });
  const named = diagram.lanes.filter((lane) => lane.cardHref !== null);
  assert.ok(named.length > 0, "no lane on linear-ode-solve offered a card");
  for (const lane of named) {
    const url = new URL(lane.cardHref!, "https://leonaqt.com");
    assert.equal(
      url.searchParams.get("at"),
      at,
      `${lane.address}: opening a card would put the reader back at the origin`,
    );
  }
});

test("inside the card, a label's card href names no occurrence — the outer figures do not draw that place", () => {
  // The truncated map's addresses live in the card's own coordinate space; the
  // outer figures never draw them, so a `?sel=` carrying one would resolve to
  // nothing and the fly-to the reader gets today (to the node's first outer
  // drawing, via the card id) would become no fly at all. The interceptor's
  // fallback — "opening a card is selecting its node" — is the right behaviour
  // there, and it only fires when the href stays silent.
  const focus = layerNode(LAYER_GRAPH, "quantum-linear-solve");
  assert.ok(focus && isCapability(focus));
  const inner = layoutConverge({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    focus,
    locale: "en",
    innerBase: "/repository/layers?focus=linear-ode-solve&card=quantum-linear-solve",
  });
  const offered = inner.lanes.filter((mark) => mark.cardHref !== null);
  assert.ok(offered.length > 0, "the truncated map offered no card links — the fixture has gone quiet");
  for (const mark of offered) {
    const url = new URL(mark.cardHref!, "https://leonaqt.com");
    assert.equal(
      url.searchParams.get("sel"),
      null,
      `${mark.address}: an inner-map card href carries an occurrence the outer map cannot resolve`,
    );
  }
});

test("every opened line's shut control is reachable where its own children do not cover it", () => {
  // **The owner's tendon complaint, session 118 — and session 104 before it.**
  // *"clicking on the process line still gets you to the card, i had to click
  // on the tendon to collapse it."* Measured then with this same hit model:
  // **85 of 275 opened lanes had zero collapsible pixels on their belly** —
  // every one `opensInto: "steps"`, because a chain's steps partition the
  // belly end to end and each step rightly takes its own click. The
  // exoskeleton is the fix: the shell around the band is the lane's own
  // collapse target, and this test is what keeps it one.
  //
  // The model emulates the canvas's paint order — lanes' anchors in document
  // order, then feeds', then names' — and asks, at sampled points along a
  // lane's spine AND its shell, whether the TOPMOST target under the cursor is
  // this lane's own toggle. That is a click, not a geometry heuristic: the
  // renderer's z-order is the occlusion rule on this canvas and there is no
  // other lever.
  const STRAND_HIT = 24; // .mj-converge-strand-hit stroke-width
  const FRAME_HIT = 18; // .mj-converge-frame-hit stroke-width
  const FEED_HIT = 14; // .mj-converge-feed-hit stroke-width

  interface Target {
    order: number;
    owner: string | null; // the lane address this toggle collapses, or null
    test: (x: number, y: number) => boolean;
  }

  const distToRibbon = (
    r: { x0: number; x1: number; y: number; bow: number; run: number },
    x: number,
    y: number,
  ): number => {
    if (x < r.x0 || x > r.x1) {
      const ex = x < r.x0 ? r.x0 : r.x1;
      return Math.hypot(x - ex, y - r.y);
    }
    let best = Infinity;
    for (let t = -14; t <= 14; t += 0.5) {
      const sx = Math.min(Math.max(x + t, r.x0), r.x1);
      best = Math.min(best, Math.hypot(x - sx, y - ribbonY(r, sx)));
    }
    return best;
  };

  const targetsOf = (diagram: ConvergeDiagram): Target[] => {
    const out: Target[] = [];
    let order = 0;
    for (const lane of diagram.lanes) {
      const ribbon = { x0: lane.x0, x1: lane.x1, y: lane.yc, bow: lane.bow, run: lane.run };
      const shell = lane.frame;
      if (lane.openHref !== null) {
        out.push({
          order: order++,
          owner: lane.address,
          test: (x, y) =>
            distToRibbon(ribbon, x, y) <= STRAND_HIT / 2 ||
            (shell !== null &&
              Math.min(
                distToRibbon({ ...ribbon, bow: lane.bow - shell.half }, x, y),
                distToRibbon({ ...ribbon, bow: lane.bow + shell.half }, x, y),
              ) <= FRAME_HIT / 2),
        });
      } else if (lane.cardHref !== null) {
        // The leaf/own-stretch card anchor — same strand-hit stroke, so it
        // competes for the same pixels (that is the point of modelling it).
        out.push({
          order: order++,
          owner: null,
          test: (x, y) => distToRibbon(ribbon, x, y) <= STRAND_HIT / 2,
        });
      }
    }
    for (const lane of diagram.lanes) {
      if (lane.label === "") continue;
      const x0 = lane.labelX - lane.labelWidth / 2 - 4;
      const y0 = lane.labelY - 12;
      const x1 = lane.labelX + lane.labelWidth / 2 + 4;
      const y1 = lane.labelY + 3;
      out.push({
        order: order++,
        owner: null,
        test: (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1,
      });
    }
    for (const state of diagram.states) {
      const r = Math.max(state.r + 6, 13);
      out.push({
        order: order++,
        owner: null,
        test: (x, y) => Math.hypot(x - state.cx, y - state.cy) <= r,
      });
    }
    return out;
  };

  let opened = 0;
  let chains = 0;
  // Both surfaces that draw this canvas, not just the map. A method's own
  // page fans a slot the map may keep as a state chain — `linear-ode-solve`'s
  // seven methods are drawn ONLY there — so a sweep over `drawableSlots`
  // alone measures a population that excludes whole figures. That is how the
  // shell's name landed on a step's name on `taylor-all-at-once`'s page while
  // every map sweep stayed green.
  const figures: ConvergeDiagram[] = drawableSlots(LAYER_GRAPH, STATE_VOCABULARY).map((focus) =>
    openDiagram(focus.id, openableAddresses(focus.id)),
  );
  for (const node of LAYER_GRAPH.nodes) {
    if (!isMethod(node)) continue;
    const diagram = layoutConvergeForMethod({
      graph: LAYER_GRAPH,
      vocabulary: STATE_VOCABULARY,
      method: node,
      locale: "en",
    });
    if (!diagram.empty) figures.push(diagram);
  }
  for (const diagram of figures) {
    const targets = targetsOf(diagram);
    const topmostIsOwn = (address: string, x: number, y: number): boolean => {
      let best: Target | null = null;
      for (const target of targets) {
        if (target.test(x, y) && (best === null || target.order > best.order)) best = target;
      }
      return best !== null && best.owner === address;
    };
    for (const lane of diagram.lanes) {
      if (!lane.open || lane.openHref === null) continue;
      opened += 1;
      if (lane.opensInto === "steps") chains += 1;
      const ribbon = { x0: lane.x0, x1: lane.x1, y: lane.yc, bow: lane.bow, run: lane.run };
      let reachable = 0;
      const N = 160;
      // **The belly, not the whole spine.** The tendons at the two ends were
      // always technically clickable, and that is the complaint, not the fix —
      // *"i had to click on the tendon to collapse it"*. A control a reader
      // can only hit in the last 16px before a circle is the defect this test
      // pins at zero, so the sweep starts where the flat part does.
      for (let i = 0; i <= N && reachable === 0; i += 1) {
        const x = lane.bellyX0 + ((lane.bellyX1 - lane.bellyX0) * i) / N;
        if (topmostIsOwn(lane.address, x, ribbonY(ribbon, x))) reachable += 1;
      }
      if (lane.frame !== null) {
        for (const edge of [lane.bow - lane.frame.half, lane.bow + lane.frame.half]) {
          for (let i = 0; i <= N && reachable === 0; i += 1) {
            const x = lane.bellyX0 + ((lane.bellyX1 - lane.bellyX0) * i) / N;
            if (topmostIsOwn(lane.address, x, ribbonY({ ...ribbon, bow: edge }, x))) {
              reachable += 1;
            }
          }
        }
      }
      assert.ok(
        reachable > 0,
        `${diagram.caption}: opened ${lane.address} ("${lane.fullLabel}", into ${lane.opensInto}) has no reachable pixel that collapses it`,
      );
    }
  }
  // The denominators, printed and floored, so a saturation walk that returns
  // nothing cannot pass this test over an empty map — and the chain count is
  // the population the 85 came from, so it is the one that must stay swept.
  //
  // **The floors fell with issue 16 and the figures got smaller under them.**
  // They were 200 and 80 against a canvas that also drew every ingredient and
  // every ingredient's fan; with those on the card the saturated corpus is a
  // smaller drawing, and a floor left at the old number would be a bar the
  // change cannot clear rather than a guard against a quiet sweep.
  console.log(`[collapse reach] ${opened} opened lanes, ${chains} of them chains`);
  assert.ok(opened > 75, `only ${opened} opened lanes were checked`);
  assert.ok(chains > 50, `only ${chains} of them are chains — the exoskeleton population is missing`);
});

test("a slot drawn as a state chain is walked by every method that fills it", () => {
  // **The gate `linear-ode-solve` never had.** A chain figure claims every way
  // across passes through its circles. The edge walk cannot check that claim
  // against the routes — a method's own closing work is not an edge — so for
  // two sessions the slot's figure drew "discretise, then solve" while three
  // of its seven methods carried `bypasses` over exactly those slots, and no
  // gate could see it. Now the claim is checked where it is made: a chain
  // every filler walks, or the fan — and a fan must draw every method of the
  // slot, which is the other half of what the owner reported ("the figure
  // draws none of the slot's seven methods").
  let chains = 0;
  let fans = 0;
  for (const focus of LAYER_GRAPH.nodes.filter(isCapability)) {
    const diagram = diagramFor(focus.id);
    if (diagram.empty) continue;
    const methods = methodsRealizing(LAYER_GRAPH, focus.id);
    if (diagram.grain === "states") {
      chains += 1;
      const expansion = expansionOf(LAYER_GRAPH, STATE_VOCABULARY, focus);
      for (const method of methods) {
        const route = routeOf(LAYER_GRAPH, STATE_VOCABULARY, method);
        for (const state of expansion.chain.slice(1, -1)) {
          assert.ok(
            route.states.some((held) => stateSatisfies(STATE_VOCABULARY, held, state)),
            `${focus.id} draws a chain through ${state}, and ${method.id} never holds anything satisfying it`,
          );
        }
      }
    } else {
      fans += 1;
      const drawn = new Set(diagram.lanes.map((lane) => lane.draws));
      for (const method of methods) {
        // A folded refinement (s121, W17) is the one absence a fan may have:
        // it lives in its parent card's Refinements section, and its parent IS
        // on the fan — checked by the refinement census, not exempted blind.
        if (method.sameInternalsAsParent === true) {
          assert.ok(!drawn.has(method.id), `${focus.id}: folded ${method.id} is on the fan`);
          continue;
        }
        assert.ok(
          drawn.has(method.id),
          `${focus.id} draws the fan and ${method.id} is not on it`,
        );
      }
    }
  }
  // Both arms exercised, denominators printed: a sweep that saw no chains
  // would pass the chain assertions over nothing.
  console.log(`[chain honesty] ${chains} chain figures, ${fans} fan figures`);
  assert.ok(chains >= 1, `no chain figure was drawn at all (${chains})`);
  assert.ok(fans >= 15, `only ${fans} fan figures — the sweep is short`);
});

test("the slot whose own methods refuted its chain draws its five distinct routes", () => {
  // The concrete case, pinned by name so the general gate above cannot rot
  // into a sweep that measures nothing: `linear-ode-solve` must fan, and every
  // method with a walk of its own — including the ones whose `bypasses`
  // refuted the old chain — must be on its own slot's figure. Seven until
  // s121 (W17): the owner's fold ruling took `krovi-linear-ode` and
  // `lchs-improved-kernel` into their parents' cards, so the figure now draws
  // the five structurally distinct routes and the two folds are asserted as
  // absences.
  const diagram = diagramFor("linear-ode-solve");
  assert.equal(diagram.grain, "methods", "linear-ode-solve is drawing the refuted chain again");
  const drawn = new Set(diagram.lanes.map((lane) => lane.draws));
  for (const id of [
    "taylor-all-at-once",
    "dyson-all-at-once",
    "time-marching-usva",
    "lchs-route",
    "schrodingerisation",
  ]) {
    assert.ok(drawn.has(id), `linear-ode-solve's own figure does not draw ${id}`);
  }
  for (const id of ["krovi-linear-ode", "lchs-improved-kernel"]) {
    assert.ok(!drawn.has(id), `linear-ode-solve's figure draws folded ${id}`);
  }
});

test("the legend's two numbers count drawn variants and the unfolded subject", () => {
  // CodeRabbit on PR 366, confirmed by measurement before fixing: a variant
  // lane's drawn depth is 1, so the component's depth-0 filter undercounted
  // every fan with a DRAWN refinement (the embedding fan said 4 where 6 draw),
  // and a folded method's own page dropped its unfolded subject from both
  // numbers. The diagram carries both counts itself now; drawn + folded must
  // equal recorded, which is the sentence the legend prints.
  const embedding = diagramFor("nonlinear-linear-embedding");
  assert.equal(embedding.grain, "methods");
  assert.equal(embedding.drawnMethodCount, 6, "four tops and two drawn Koopman variants");
  assert.equal(embedding.foldedCount, 0);

  const ode = diagramFor("linear-ode-solve");
  // 5 → 6 in session 129: `berry-multistep` is a sixth top-level route on this
  // slot. 6 → 7 in session 130: `childs-liu-spectral` is a seventh. The folded
  // pair is unchanged both times — Krovi and the improved kernel — so the
  // sentence the legend prints still adds up against `methodsRealizing`.
  assert.equal(ode.drawnMethodCount, 7);
  assert.equal(ode.foldedCount, 2);
  assert.equal(
    ode.drawnMethodCount + ode.foldedCount,
    methodsRealizing(LAYER_GRAPH, "linear-ode-solve").length,
    "drawn + folded is not the recorded count",
  );

  const node = layerNode(LAYER_GRAPH, "krovi-linear-ode");
  assert.ok(node && isMethod(node));
  const page = layoutConvergeForMethod({
    graph: LAYER_GRAPH,
    vocabulary: STATE_VOCABULARY,
    method: node,
    locale: "en",
  });
  // 6 → 7 with `berry-multistep`, 7 → 8 with `childs-liu-spectral`: Krovi's own
  // page unfolds Krovi and draws the slot's other seven tops beside it.
  assert.equal(page.drawnMethodCount, 8, "the unfolded subject counts as drawn on its own page");
  assert.equal(page.foldedCount, 1, "the OTHER fold stays folded there");
  assert.equal(
    page.drawnMethodCount + page.foldedCount,
    methodsRealizing(LAYER_GRAPH, "linear-ode-solve").length,
  );
});

test("a narrowing is not a second lane beside the slot whose fan already contains it", () => {
  // Session 118's fourth repeat mechanism, the one that lives in the walk: a
  // single-edge `through` lane drew the Koopman-von Neumann lift as its own
  // way across while the plain embedding lane's fan contained the same
  // method one click down — the same route, listed twice, with nothing
  // opened. The narrowing edge itself must survive (the multi-edge lanes
  // that continue from the narrower state are real and different routes);
  // only the single-edge duplicate goes.
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    const single = diagram.lanes.filter((lane) => lane.depth === 0 && lane.slots.length === 1);
    for (const lane of single) {
      const twins = single.filter((other) => other.slots[0] === lane.slots[0]);
      assert.equal(
        twins.length,
        1,
        `${focus.id}: ${lane.slots[0]} is drawn as ${twins.length} sibling lanes`,
      );
    }
  }
  // And the pinned instance: the lift appears exactly once on the shut
  // embedding figure's slot — inside the fan once opened, never beside it.
  const shut = diagramFor("nonlinear-ode-solve");
  const liftLanes = shut.lanes.filter((lane) => lane.draws === "koopman-von-neumann-lift");
  assert.equal(liftLanes.length, 0, "the lift is drawn beside the lane whose fan contains it");
});
