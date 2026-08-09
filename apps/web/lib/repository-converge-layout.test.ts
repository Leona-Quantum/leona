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
  CONVERGE_METRICS,
  bowAt,
  convergingSlots,
  crossingsAt,
  drawableSlots,
  allocateBows,
  chainColumnNeed,
  laneOffsets,
  reservedHalfHeight,
  spanForBow,
  layoutConverge,
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
interface Cubic {
  p0: [number, number];
  p1: [number, number];
  p2: [number, number];
  p3: [number, number];
}

/**
 * The full cubic, parsed out of the emitted `d`.
 *
 * Both control points, not just the endpoints. Sampling y from `bowAt` while
 * only the endpoints came from `d` is what let a real defect through review:
 * `bowAt` returned the curve for control height `bow` while the emitter used
 * `4·bow/3`, so every invariant was measuring a curve **three quarters** the
 * height of the rendered one. The label-clearance check therefore had 25% more
 * room than the page does, and mutating either side alone kept the two
 * consistently wrong with each other, so the mutation sweep could not see it.
 *
 * Parse the artifact, sample the artifact.
 */
function parseCubic(d: string): Cubic {
  const match =
    /^M\s+(-?[\d.]+)\s+(-?[\d.]+)\s+C\s+(-?[\d.]+)\s+(-?[\d.]+),\s*(-?[\d.]+)\s+(-?[\d.]+),\s*(-?[\d.]+)\s+(-?[\d.]+)\s*$/.exec(
      d.trim(),
    );
  assert.ok(match, `not a single-cubic path: ${d}`);
  const n = (at: number) => Number(match[at]);
  return { p0: [n(1), n(2)], p1: [n(3), n(4)], p2: [n(5), n(6)], p3: [n(7), n(8)] };
}

/** A point on the parsed cubic. This is the curve the browser draws. */
function pointOn(cubic: Cubic, t: number): [number, number] {
  const b = (a: number, bb: number, c: number, dd: number) =>
    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * bb + 3 * (1 - t) * t ** 2 * c + t ** 3 * dd;
  return [
    b(cubic.p0[0], cubic.p1[0], cubic.p2[0], cubic.p3[0]),
    b(cubic.p0[1], cubic.p1[1], cubic.p2[1], cubic.p3[1]),
  ];
}

function drawnEnds(d: string): { sx: number; sy: number; ex: number; ey: number } {
  const cubic = parseCubic(d);
  return { sx: cubic.p0[0], sy: cubic.p0[1], ex: cubic.p3[0], ey: cubic.p3[1] };
}

test("bowAt describes the curve that is actually emitted", () => {
  // The helper and the emitter are two expressions of one shape, and they had
  // drifted by a factor of 4/3. Pinned against the parsed path so they cannot
  // drift again without something failing.
  for (const focus of convergingSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const lane of diagramFor(focus.id).lanes) {
      // `yc` and `bow` describe a lane of the figure's own bundles, whose base
      // is level. A nested lane is an offset of its *parent's* curve, which is
      // not level, and the general law it obeys is asserted directly in
      // `repository-strand-geometry.test.ts`. Sampling it against `bowAt` here
      // would be asserting the wrong formula and calling the disagreement a bug.
      if (lane.depth > 0) continue;
      const cubic = parseCubic(lane.d);
      for (let step = 0; step <= 20; step += 1) {
        const t = step / 20;
        const [, drawnY] = pointOn(cubic, t);
        assert.ok(
          Math.abs(drawnY - bowAt(lane.yc, lane.bow, t)) < 0.05,
          `${lane.key}: bowAt says ${bowAt(lane.yc, lane.bow, t)} at t=${t}, the path draws ${drawnY}`,
        );
      }
    }
  }
});

test("the peak of a bow is exactly its `bow`, and the canvas reserves that much", () => {
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
      if (lane.depth > 0) continue; // see `bowAt describes the curve…` above
      const peak = pointOn(parseCubic(lane.d), 0.5)[1] - lane.yc;
      assert.ok(
        Math.abs(peak - lane.bow) < 0.05,
        `${lane.key}: bow is ${lane.bow} but the drawn peak is ${peak}`,
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
        const cubic = parseCubic(lane.d);
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
          const ca = parseCubic(a.d);
          const cb = parseCubic(b.d);
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
        const offset = bowAt(lane.yc, lane.bow, t) - lane.yc;
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
          const cubic = parseCubic(other.d);
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
  assert.equal(capabilities.length, 18, "the graph's slot count changed; update these figures");

  for (const focus of capabilities) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = diagramFor(focus.id, locale);
      assert.equal(diagram.empty, false, `${focus.id} (${locale}) draws nothing`);
      assert.ok(diagram.lanes.length > 0, `${focus.id} (${locale}) has no lanes`);
      assert.ok(diagram.states.length >= 2, `${focus.id} (${locale}) has fewer than two circles`);
    }
  }

  // The split is measured, not assumed: 2 slots have interior states and the
  // other 16 are method fans. If a future edit gives a method its own contract
  // this number moves, and moving it should be a deliberate edit here.
  const byGrain = capabilities.map((focus) => diagramFor(focus.id).grain);
  assert.equal(byGrain.filter((grain) => grain === "states").length, 2);
  assert.equal(byGrain.filter((grain) => grain === "methods").length, 16);
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
  assert.equal(offered.length, 18);

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
  assert.equal(strippedOffer.length, 17);
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
function openableAddresses(id: string): string[] {
  const seen = new Set<string>();
  const walk = (open: ReadonlySet<string>) => {
    const node = layerNode(LAYER_GRAPH, id);
    assert.ok(node && isCapability(node));
    const diagram = layoutConverge({
      graph: LAYER_GRAPH,
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
  assert.equal(openable + leaves + 1, 57, "the eighteen figures draw 57 lines between them");
  assert.equal(openable, 24, "24 of them open into something recorded");
  assert.equal(leaves, 32, "32 are leaves — nothing finer is recorded for them");
});

test("opening a line keeps every line apart — the crossing-free claim, with things open", () => {
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const open of openings(focus.id)) {
      const diagram = openDiagram(focus.id, open);
      for (const bundle of siblingsOf(diagram)) {
        for (let i = 0; i < bundle.length; i += 1) {
          for (let j = i + 1; j < bundle.length; j += 1) {
            const a = parseCubic(bundle[i]!.d);
            const b = parseCubic(bundle[j]!.d);
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
        const on = parseCubic(parent.d);
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
        const cubic = parseCubic(lane.d);
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
          if (lane.label === "") {
            // Two lanes draw nothing, for opposite reasons, and both are
            // declared rather than inferred:
            //   `open`     — the run of named hops, whose own name is `A → B`,
            //                the coined composite the owner refused;
            //   `nameless` — the remainder hop, the part of a route the method
            //                performs itself. Its name is the method's, and the
            //                method writes it once, on the bone above it.
            // Before session 104 the remainder hop drew the method's name a
            // second time, one level down, which is what the owner saw as
            // *"time marching expands into propagation then itself"*.
            assert.ok(
              lane.open || lane.nameless,
              `${lane.key} draws no name and is neither an opened run nor a remainder hop`,
            );
            continue;
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
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    const shut = diagram.lanes.filter((lane) => !lane.open && lane.inside > 0).length;
    assert.equal(diagram.collapsedCount, shut, `${focus.id}: the count must be the thing counted`);
  }
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

test("every strand is drawn as a tapered shape that pinches at both of its ends", () => {
  // The taper is not decoration: a line of constant width arriving at a circle
  // says "this ends here", and a strand pinching to a point says "this and the
  // others become one thing here", which is what a convergence is. Read off the
  // emitted outline, because that is the shape a reader sees.
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    const diagram = diagramFor(focus.id);
    for (const lane of diagram.lanes) {
      const numbers = lane.outline.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      assert.equal(numbers.length, 14, `${lane.key}: an outline is a move and two cubics`);
      assert.ok(lane.outline.endsWith("Z"), `${lane.key}: an outline is closed`);
      const start = { x: numbers[0]!, y: numbers[1]! };
      const turn = { x: numbers[6]!, y: numbers[7]! };
      const back = { x: numbers[12]!, y: numbers[13]! };
      // Both edges meet at the same two points — that is the pinch.
      assert.ok(Math.abs(back.x - start.x) < 0.02 && Math.abs(back.y - start.y) < 0.02,
        `${lane.key}: the outline does not close on its own start`);
      const spine = drawnEnds(lane.d);
      assert.ok(Math.abs(start.x - spine.sx) < 0.02, `${lane.key}: outline starts off the spine`);
      assert.ok(Math.abs(turn.x - spine.ex) < 0.02, `${lane.key}: outline turns off the spine end`);
      // And it is genuinely two different curves in between.
      assert.notEqual(numbers[3], numbers[11], `${lane.key}: both edges are the same curve`);
      assert.ok(lane.half > 0, `${lane.key}: a strand with no thickness`);
    }
  }
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
  const c = parseCubic(lane.d);
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
  assert.ok(
    shutRate < 0.134,
    `shut names collide with a line ${shutHit}/${shutNamed} (${(shutRate * 100).toFixed(1)}%), ` +
      `past the 13.4% they were measured at — the placement of the names nothing occludes got worse`,
  );
  assert.ok(
    shutHit <= 28,
    `${shutHit} shut names collide with a line across every figure, past the 28 measured once ` +
      `labels were shortened — the drawing got busier where no plate is hiding it`,
  );
  // Reported, not barred. This is the number the owner's instruction moved on
  // purpose, and a bar on it would be a bar on following the instruction.
  assert.ok(
    openedRate >= 0,
    `${openedHit}/${openedNamed} opened names cross a line and rely on the plate`,
  );
});

test("a name on the bone stays inside the band the layout reserved for it", () => {
  // The half of the opened-name guard that survives in the layout, and the thing
  // that keeps `.mj-converge-name-plate` honest: a plate is only acceptable
  // because it is *small*. If an opened name drifted outside `spineBand` the
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
      // The bone read off its own drawn path, not rebuilt from `yc`/`bow`.
      // `bowAt(yc, bow, t)` assumes a flat base and a nested strand's base is a
      // piece of its parent's curve — reconstructing it that way put the bone at
      // 519.7 for a name at 68, which is the second derivation this file's own
      // comments keep warning about.
      const [, spineY] = pointOn(parseCubic(lane.d), 0.5);
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
  const drawn = drawableSlots(graph, STATE_VOCABULARY).flatMap((slot) => {
    const focus = layerNode(graph, slot.id);
    assert.ok(focus && isCapability(focus));
    return layoutConverge({ graph, vocabulary: STATE_VOCABULARY, focus, locale: "en" }).lanes;
  }).filter((lane) => lane.fullLabel === long);
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

test("name-on-name overlap on an opened figure stays where it was measured", () => {
  // **The residue of restoring the opened names, counted rather than hidden.**
  //
  // `two lane labels never overlap` above is absolute and passes — but it only
  // ever ran on figures with **nothing open**, and at full saturation the picture
  // is not clean: 8 pairs of *shut* names already overlapped before any of this,
  // and restoring 254 opened names added 12 more (4 opened-against-shut, 8
  // opened-against-opened).
  //
  // Those 12 are shipped deliberately. The alternative measured was widening the
  // reserved label band from 13px to 17px so it covers the name's actual vertical
  // reach (`labelLift + 0.8 × laneFont` = 16.6, which it does not) — that removes
  // 4 of the 20 and costs **16% more width and 14% more height on every figure**,
  // on a canvas the owner has already said is too wide. Twelve overlaps in a
  // state a reader reaches after ~54 deliberate clicks is a better trade than 128
  // lines that draw no name at all in the state they reach on the first one.
  //
  // Pinned by kind so the trade cannot quietly get worse, and so the 8 that were
  // here first stay attributable to what caused them.
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
  // **8 → 4, and it went down because the drawing got better.** The remainder
  // hop stopped drawing the method's name a second time, so half the
  // shut-against-shut overlaps stopped existing — they were a name overlapping
  // the *duplicate* of another name. Pinned at 8, this test would now be
  // demanding the duplicates come back, which is the exact shape of failure this
  // file has already taken once ("a relative bar punishes an improvement").
  // Re-pinned at the new measurement rather than loosened to `<= 8`, so a
  // regression back toward 8 is still red.
  assert.equal(
    kinds.shutShut,
    4,
    `${kinds.shutShut} shut-against-shut overlaps; 4 remain once the duplicate names went`,
  );
  assert.ok(
    kinds.openShut + kinds.openOpen <= 12,
    `${kinds.openShut + kinds.openOpen} overlaps involve a restored name (was 12: ` +
      `${kinds.openShut} opened-against-shut, ${kinds.openOpen} opened-against-opened)`,
  );
});

/** The steepest the drawn curve gets, in degrees from horizontal. Sampled off `d`. */
function steepestDegrees(d: string): number {
  const c = parseCubic(d);
  // The derivative of a cubic Bézier. Sampled densely rather than evaluated at
  // the endpoints: "the steepest point is always an endpoint" is a property of
  // *this* family of curves, and asserting it against a formula that assumes it
  // would be the test agreeing with the emitter about the thing in question.
  let worst = 0;
  for (let i = 0; i <= 200; i += 1) {
    const t = i / 200;
    const dx =
      3 * (1 - t) ** 2 * (c.p1[0] - c.p0[0]) +
      6 * (1 - t) * t * (c.p2[0] - c.p1[0]) +
      3 * t ** 2 * (c.p3[0] - c.p2[0]);
    const dy =
      3 * (1 - t) ** 2 * (c.p1[1] - c.p0[1]) +
      6 * (1 - t) * t * (c.p2[1] - c.p1[1]) +
      3 * t ** 2 * (c.p3[1] - c.p2[1]);
    if (dx === 0) return 90;
    worst = Math.max(worst, Math.abs(Math.atan2(Math.abs(dy), Math.abs(dx))));
  }
  return (worst * 180) / Math.PI;
}

test("no line stands up on end, however much is opened", () => {
  // The owner asked for two things — *"distances between states should increase
  // as branches between them are opened out"* and *"no branch should be at such
  // a steep angle that it becomes weird to look at"* — and they are one
  // constraint, because a lane's tangent is `4·bow/span`. Capping the angle is
  // what widens the column.
  //
  // Measured before the cap existed, over these same figures: 186 of 337 lanes
  // past 45 degrees, 90 past 60, steepest 79.1 — and four figures already past
  // 45 *shut*. Sampled off the emitted `d`, because a test that recomputes the
  // geometry beside the emitter cannot see the emitter break (session 100).
  let checked = 0;
  for (const focus of drawableSlots(LAYER_GRAPH, STATE_VOCABULARY)) {
    for (const locale of ["en", "ja"] as const) {
      for (const open of openings(focus.id)) {
        const diagram = openDiagram(focus.id, open, locale);
        for (const lane of diagram.lanes) {
          const degrees = steepestDegrees(lane.d);
          checked += 1;
          assert.ok(
            degrees <= M.maxLaneAngleDeg + 1e-6,
            `${focus.id} (${locale}) ${lane.key}: ${degrees.toFixed(1)}deg exceeds ` +
              `${M.maxLaneAngleDeg}deg`,
          );
        }
      }
    }
  }
  // A guard over an empty set passes for the wrong reason.
  assert.ok(checked > 300, `only ${checked} lanes checked`);
});

test("a column is wide enough for the bows it holds, and that is what makes it grow", () => {
  // `spanForBand` inverts the tangent, so it is checkable as arithmetic without
  // building a figure — which matters because the property it defends is about
  // figures the authored graph cannot currently produce.
  assert.equal(spanForBow(0), 0);
  // At 45 degrees, tan is 1, so the span is exactly four times the bow.
  assert.ok(Math.abs(spanForBow(100) - 400) < 1e-9);
  // Sign-blind: a lane bowed upward asks for exactly what one bowed down does.
  assert.equal(spanForBow(-137), spanForBow(137));
  // Monotone: a further-bowed lane never asks for a narrower column.
  let previous = -1;
  for (const bow of [0, 10, 55, 120, 400, 2300]) {
    const span = spanForBow(bow);
    assert.ok(span > previous, `spanForBow(${bow}) = ${span} did not grow`);
    previous = span;
  }
  // And the figure actually uses it: opening the widest fan in the graph must
  // widen the figure, which is the behaviour that was missing entirely — a
  // seven-method fan used to add 322px of height and exactly 0px of width.
  const shut = openDiagram("nonlinear-ode-solve", []);
  const opened = openDiagram("nonlinear-ode-solve", ["linear-ode-solve"]);
  assert.ok(
    opened.width > shut.width,
    `opening a 7-method fan left the figure ${opened.width} wide, was ${shut.width}`,
  );
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
