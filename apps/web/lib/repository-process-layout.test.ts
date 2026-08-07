// The process map's geometry, pinned rather than looked at.
//
// > *"There must be no overlapping lines or states anywhere!"*
// > — owner, session-91 inbox
//
// That sentence is the whole reason this file exists, and it is the kind of
// requirement a screenshot cannot discharge. A canvas of two hundred lines has
// no visible difference between "nothing overlaps" and "nothing overlaps in the
// English locale at the depth I happened to open"; the second one ships, and the
// first thing that finds it is a reader.
//
// So the constraint is asserted as arithmetic over every pair of drawn shapes,
// on fixtures built in-file *and* on the real `LAYER_GRAPH` — every capability
// the page can focus, in both locales, opened and shut. The fixtures are where a
// named case is pinned — a two-lane slot, a nested expansion, a route with an
// ingredient — because a test that reads the authored graph asserts today's
// content and goes green when that content changes for an unrelated reason. The
// real-graph pass asserts *only* the structural invariants, never a count and
// never a name, and it is the one that catches "the layout is fine in the
// abstract and breaks on the one slot whose Japanese label is forty per cent
// wider than its English one".
//
// ## What "does not overlap" means here, precisely
//
// Four different comparisons, because four different kinds of shape are drawn
// and the cheap version of each is wrong:
//
// - **Two lines.** Comparing `y` for equality is far too weak. Two lanes whose
//   lines are forty pixels apart have different `y` and content that touches,
//   because a line is not a line — it is a run with its name in a band above it,
//   `edgeBand` tall in total. So the *bands* are compared, and they must clear
//   each other by `laneGap`, which is the separation the stacking claims to
//   provide. `strand-layout.test.ts` learned this the hard way: deleting the lane
//   gap from the placement cursor survived a centre-to-centre check completely.
// - **Two circles.** Two discs are disjoint exactly when the distance between
//   their centres is at least the sum of their radii. Comparing only `cx`, or
//   only `cy`, passes two circles five pixels apart on a diagonal. The layout
//   places several pairs *tangent* on purpose — the terminal circle and the first
//   column's circle are two drawings of one state, drawn touching — so the test
//   is `distance >= r_a + r_b` and not `>`.
// - **Two pieces of text.** This is the one every earlier version of this file
//   missed, and it shipped four real collisions: while a state's name sat
//   *beside* its circle it ran rightward into the run, the run's own name is
//   centred just above that line, and two 12px boxes eleven pixels apart
//   overlapped. Every invariant was about lines, circles and ties, so the page
//   was unreadable with the suite green. Names are shapes. They are compared as
//   boxes, all five families of them.
// - **A shape against the region it is drawn in.** A lane that overruns its
//   group's right edge has walked into whatever the enclosing lane draws next,
//   and the pairwise sweeps report the symptom without ever naming the cause.
//
// ## Ties, and why they are allowed to be vertical lines at all
//
// The header of `process-layout.ts` argues that the gap between two adjacent
// lanes is empty by construction, which is what licenses drawing a kinship tie
// through it. That argument is asserted here rather than believed: every tie is
// checked against every process line, and a tie whose span contains a line it
// crosses is a violation.
//
// D90.8's bar applies to all of it — a layout test that passes is not evidence
// until something known-broken fails it — so the invariants below were mutation-
// tested against deliberate breakages of the engine before this file was kept.
import assert from "node:assert/strict";
import test from "node:test";
import {
  columnRanks,
  estimateTextWidth,
  fitLabel,
  layoutProcessMap,
  slotHref,
  stateHref,
  PROCESS_METRICS,
  type ProcessDiagram,
} from "./repository/process-layout.ts";
import {
  isCapability,
  rootCapabilities,
  routeOf,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
} from "./repository/layers.ts";
import type { LayerState, StateVocabulary } from "./repository/states.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";

const M = PROCESS_METRICS;

/** Sub-pixel slack. Every quantity here is a float sum of shared metrics. */
const EPS = 0.5;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function state(id: string, extra: Partial<LayerState> = {}): LayerState {
  return { id, label: id, labelJa: id, summary: "", summaryJa: "", ...extra };
}

function vocabulary(...states: LayerState[]): StateVocabulary {
  return { states };
}

function capability(
  id: string,
  from: string,
  to: string,
  extra: Partial<LayerCapability> = {},
): LayerCapability {
  return {
    kind: "capability",
    id,
    label: id,
    labelJa: id,
    summary: "",
    summaryJa: "",
    contract: { from, to, takes: "x", takesJa: "x", returns: "y", returnsJa: "y" },
    whyALayer: "",
    whyALayerJa: "",
    ...extra,
  };
}

function method(id: string, realizes: string, extra: Partial<LayerMethod> = {}): LayerMethod {
  return {
    kind: "method",
    id,
    label: id,
    labelJa: id,
    summary: "",
    summaryJa: "",
    realizes,
    steps: [],
    ...extra,
  };
}

// ---------------------------------------------------------------------------
// The invariants, collected rather than thrown
// ---------------------------------------------------------------------------

/**
 * What a drawn run actually occupies vertically.
 *
 * Not `[y, y]`. `y` is the line; the name rides in a band above it and the whole
 * thing is `edgeBand` tall, which is the number the measure pass reserves. This
 * is the measurement the reader sees collide, and the reason a check on `y`
 * alone is worthless.
 */
function runBand(y: number): [number, number] {
  return [y - M.edgeBand / 2, y + M.edgeBand / 2];
}

/** Clear space between two bands, or −1 when they intersect. */
function clearanceBetween(a: [number, number], b: [number, number]): number {
  if (a[1] <= b[0]) return b[0] - a[1];
  if (b[1] <= a[0]) return a[0] - b[1];
  return -1;
}

function spansOverlap(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] - EPS && b[0] < a[1] - EPS;
}

/**
 * A drawn piece of text, as a box.
 *
 * ## This is a mirror of the renderer, and that is a cost worth naming
 *
 * The layout publishes anchors for lines, circles and regions but not for text:
 * where a name is drawn relative to the shape it belongs to lives in
 * `repository-process-map.tsx` as literal offsets on `<text>` elements. So the
 * offsets below are a **second copy** of those numbers, and a second copy drifts
 * — if the renderer moves a name and this table does not follow, these
 * assertions go on passing about a picture nobody draws any more.
 *
 * Kept anyway, because the alternative is not checking the thing that actually
 * collided. The honest fix is for the layout to publish label anchors itself and
 * for both the renderer and this file to read them; until it does, a change to a
 * `<text>` offset in the map component has to be made here too.
 *
 * Heights are the font size plus a little leading: an ascent of 0.8em above the
 * baseline and a descent of 0.25em below it. Deliberately generous — the whole
 * point of over-estimating text is that guessing high draws a shape slightly too
 * wide and guessing low draws two names through each other.
 */
interface TextBox {
  key: string;
  what: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function textBox(
  key: string,
  what: string,
  anchorX: number,
  baselineY: number,
  text: string,
  fontSize: number,
  anchor: "start" | "middle",
): TextBox {
  const width = estimateTextWidth(text, fontSize);
  const left = anchor === "middle" ? anchorX - width / 2 : anchorX;
  return {
    key,
    what,
    left,
    right: left + width,
    top: baselineY - fontSize * 0.8,
    bottom: baselineY + fontSize * 0.25,
  };
}

/** Every name on the canvas, in the place the renderer puts it. */
function textBoxes(diagram: ProcessDiagram): TextBox[] {
  const boxes: TextBox[] = [];
  // `<text className="mj-process-state-name" x={cx} y={cy + r + 13} textAnchor="middle">`
  for (const box of diagram.states) {
    boxes.push(textBox(box.key, "state name", box.cx, box.cy + box.r + 13, box.label, M.stateFont, "middle"));
  }
  // `<text className="mj-process-name" x={midX} y={y - 7} textAnchor="middle">`
  for (const process of diagram.processes) {
    boxes.push(
      textBox(
        process.key,
        "run name",
        (process.x0 + process.x1) / 2,
        process.y - 7,
        process.label,
        M.processFont,
        "middle",
      ),
    );
  }
  // `<text className="mj-process-group-name" x={x0 + 4} y={top - 5}>`
  for (const group of diagram.groups) {
    boxes.push(textBox(group.key, "group name", group.x0 + 4, group.top - 5, group.label, M.processFont, "start"));
  }
  // `<text className="mj-process-lane-name" x={lane.x} y={lane.y}>`
  for (const lane of diagram.lanes) {
    boxes.push(textBox(lane.key, "lane name", lane.x, lane.y, lane.label, M.processFont, "start"));
  }
  // `<text className="mj-process-feed-name" x={feed.x + 11} y={feed.y1 + 2}>`
  for (const feed of diagram.feeds) {
    boxes.push(textBox(feed.key, "feed name", feed.x + 11, feed.y1 + 2, feed.label, M.feedFont, "start"));
  }
  return boxes;
}

function boxesIntersect(a: TextBox, b: TextBox): boolean {
  return (
    a.left < b.right - EPS &&
    b.left < a.right - EPS &&
    a.top < b.bottom - EPS &&
    b.top < a.bottom - EPS
  );
}

/**
 * True when `child` is drawn inside `group`.
 *
 * Keys are paths — `root:<slot>/<method>:<slot>/<method>:own0` — so descent is a
 * prefix test. The trailing separator is not decoration: without it a slot named
 * `block-encode` would swallow a sibling named `block-encoding`, and the
 * containment check would silently start asserting the wrong pair.
 */
function isInside(child: { key: string }, group: { key: string }): boolean {
  return child.key.startsWith(`${group.key}/`);
}

/**
 * Every invariant that must hold of any process diagram, collected rather than
 * thrown.
 *
 * Collected for the same reason `strand-layout.test.ts` collects: a geometry
 * change usually breaks a family of things at once, and fixing one, re-running,
 * and finding the next is how a layout change takes six rounds instead of one.
 */
function violations(diagram: ProcessDiagram, open: ReadonlySet<string>): string[] {
  const found: string[] = [];
  const { processes, states, groups, lanes, ties, feeds } = diagram;

  // --- lines against lines ------------------------------------------------
  //
  // Every entry in `processes` is a run that is actually stroked. An opened slot
  // is a `ProcessGroup` and has no `y` at all, which is what makes this a plain
  // all-pairs sweep with no parent/child exemption to argue about: nothing in
  // this array contains anything else in it.
  for (let i = 0; i < processes.length; i += 1) {
    for (let j = i + 1; j < processes.length; j += 1) {
      const a = processes[i]!;
      const b = processes[j]!;
      if (!spansOverlap([a.x0, a.x1], [b.x0, b.x1])) continue;

      // The literal reading of the owner's sentence: two runs on one line may
      // not share any horizontal space.
      if (Math.abs(a.y - b.y) <= EPS) {
        found.push(
          `${a.key} and ${b.key} are both on y=${a.y} and share ` +
            `[${Math.max(a.x0, b.x0)}..${Math.min(a.x1, b.x1)}]`,
        );
        continue;
      }

      // The reading that actually holds the picture together. Two runs that
      // share horizontal space are in different lanes, and lanes are stacked
      // with `laneGap` between their bands. Anything less and the two names are
      // drawn into each other even though the two lines are not.
      const clearance = clearanceBetween(runBand(a.y), runBand(b.y));
      if (clearance < M.laneGap - EPS) {
        found.push(
          `${a.key} (y=${a.y}) and ${b.key} (y=${b.y}) share horizontal space ` +
            `with ${clearance.toFixed(1)} clear — under the ${M.laneGap} lane gap`,
        );
      }
    }
  }

  // --- circles against circles --------------------------------------------
  //
  // Two discs are disjoint exactly when the distance between their centres is at
  // least the sum of the radii. Tangency is legal and deliberate: a terminal
  // circle and the first column's circle are one state drawn twice, touching.
  for (let i = 0; i < states.length; i += 1) {
    for (let j = i + 1; j < states.length; j += 1) {
      const a = states[i]!;
      const b = states[j]!;
      const needed = a.r + b.r;
      const distance = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      if (distance < needed - EPS) {
        found.push(
          `${a.key} and ${b.key} are ${distance.toFixed(1)} apart, ` +
            `inside their combined radius of ${needed}`,
        );
      }
    }
  }

  // --- text against text ---------------------------------------------------
  //
  // The invariant the first three versions of this file did not have, and the
  // one that four real collisions on the rendered page needed. A name is a shape
  // on the canvas exactly as much as a line is; two of them in the same place
  // make the picture unreadable while every line-and-circle assertion stays
  // green. All five families are compared against each other, not each family
  // against itself, because the collision that shipped was between two different
  // families — a state's name and the run's name.
  const text = textBoxes(diagram);
  for (let i = 0; i < text.length; i += 1) {
    for (let j = i + 1; j < text.length; j += 1) {
      const a = text[i]!;
      const b = text[j]!;
      if (!boxesIntersect(a, b)) continue;
      found.push(
        `the ${a.what} on ${a.key} overlaps the ${b.what} on ${b.key} — ` +
          `[${a.left.toFixed(1)}..${a.right.toFixed(1)}]x[${a.top.toFixed(1)}..${a.bottom.toFixed(1)}] ` +
          `against [${b.left.toFixed(1)}..${b.right.toFixed(1)}]x[${b.top.toFixed(1)}..${b.bottom.toFixed(1)}]`,
      );
    }
  }

  // A name is also the only part of most shapes that has any width worth
  // speaking of, so it is the part that runs off the canvas first.
  for (const box of text) {
    if (box.left < -EPS || box.right > diagram.width + EPS) {
      found.push(
        `the ${box.what} on ${box.key} runs off the canvas ` +
          `[${box.left.toFixed(1)}..${box.right.toFixed(1)}] vs 0..${diagram.width.toFixed(1)}`,
      );
    }
    if (box.top < -EPS || box.bottom > diagram.height + EPS) {
      found.push(`the ${box.what} on ${box.key} is above or below the canvas`);
    }
  }

  // --- ties against lines --------------------------------------------------
  //
  // The header's claim is that a tie lives in the empty gap between two adjacent
  // lanes. This is that claim, checked: a run whose line is strictly inside the
  // tie's span may not be crossed by it.
  for (const tie of ties) {
    const top = Math.min(tie.y0, tie.y1);
    const bottom = Math.max(tie.y0, tie.y1);
    for (const process of processes) {
      if (process.y <= top + EPS || process.y >= bottom - EPS) continue;
      if (process.x0 < tie.x - EPS && tie.x < process.x1 - EPS) {
        found.push(
          `the ${tie.relation} tie at x=${tie.x.toFixed(1)} crosses ${process.key} ` +
            `(y=${process.y}, in ${top.toFixed(1)}..${bottom.toFixed(1)})`,
        );
      }
    }
  }

  // A feed stub is a vertical line too, and it hangs off the lane's own line
  // into the band below it. Same rule, same reason.
  for (const feed of feeds) {
    const top = Math.min(feed.y0, feed.y1);
    const bottom = Math.max(feed.y0, feed.y1);
    for (const process of processes) {
      if (process.y <= top + EPS || process.y >= bottom - EPS) continue;
      if (process.x0 < feed.x - EPS && feed.x < process.x1 - EPS) {
        found.push(`the feed stub ${feed.key} crosses ${process.key}`);
      }
    }
  }

  // --- shapes that cannot be seen or clicked -------------------------------
  for (const process of processes) {
    if (!(process.x1 > process.x0 + EPS)) {
      found.push(`${process.key}: run is ${process.x0}..${process.x1} — nothing to draw or click`);
    }
  }
  for (const group of groups) {
    if (!(group.x1 > group.x0 + EPS) || !(group.bottom > group.top + EPS)) {
      found.push(`${group.key}: empty region`);
    }
  }

  // Every shape is a link with a name, and the untruncated name is what the
  // renderer puts in the `<title>`. A blank either one is a shape a reader can
  // neither read nor follow.
  //
  // `labelTruncated` is checked against the two strings rather than trusted,
  // because it is the flag the renderer uses to decide whether the shape needs
  // its full name anywhere at all. A cut label whose flag says otherwise is a
  // name that has been silently lost, not abbreviated.
  for (const shape of [...processes, ...states, ...groups, ...lanes, ...feeds]) {
    if (!shape.href) found.push(`${shape.key}: no href`);
    if (!shape.fullLabel) found.push(`${shape.key}: no fullLabel`);
    if (shape.labelTruncated) {
      if (shape.label === shape.fullLabel) found.push(`${shape.key}: flagged cut but nothing was cut`);
      if (!shape.label.endsWith("…")) found.push(`${shape.key}: cut without an ellipsis`);
      if (shape.fullLabel.length <= shape.label.length) {
        found.push(`${shape.key}: fullLabel is no longer than the cut label`);
      }
    } else if (shape.label !== shape.fullLabel) {
      found.push(`${shape.key}: label differs from fullLabel but is not flagged cut`);
    }
  }

  // --- an opened slot is never also a line ---------------------------------
  //
  // The failure this exists for: the first draft kept an opened slot in
  // `processes` with its own `x0..x1` at the group's centre line, and that line
  // ran horizontally through every lane nested inside it. It is the exact
  // crossing the owner asked not to exist and no pairwise sweep could see it,
  // because the line was the *parent* of everything it crossed.
  //
  // The predicate is the engine's own: a slot is drawn open when it is in `open`,
  // it is above the depth cap, and something realises it. A slot in `open` but
  // past the cap is correctly still a line, and so is a slot nothing fills.
  for (const process of processes) {
    if (process.capabilityId === null) continue;
    if (!open.has(process.capabilityId)) continue;
    if (process.depth >= diagram.depthCap) continue;
    if (process.methodCount === 0) continue;
    found.push(
      `${process.key}: drawn as a line at y=${process.y} although it is opened — ` +
        `an opened slot is a region, not a run`,
    );
  }

  // --- a group really contains what is drawn inside it ---------------------
  //
  // The other half of the same change. A region is only an honest statement
  // about "these are the ways through this slot" if the ways are inside it; a
  // lane that overruns its group's right edge has walked into whatever the
  // enclosing lane draws next, and the pairwise sweep above will report that as
  // an overlap without ever saying why.
  for (const group of groups) {
    const region: [number, number] = [group.x0, group.x1];
    for (const process of processes) {
      if (!isInside(process, group)) continue;
      if (process.x0 < region[0] - EPS || process.x1 > region[1] + EPS) {
        found.push(
          `${process.key} [${process.x0.toFixed(1)}..${process.x1.toFixed(1)}] escapes ` +
            `${group.key} [${region[0].toFixed(1)}..${region[1].toFixed(1)}]`,
        );
      }
      const [top, bottom] = runBand(process.y);
      if (top < group.top - EPS || bottom > group.bottom + EPS) {
        found.push(
          `${process.key} band [${top.toFixed(1)}..${bottom.toFixed(1)}] escapes ` +
            `${group.key} [${group.top.toFixed(1)}..${group.bottom.toFixed(1)}] vertically`,
        );
      }
    }
    for (const box of states) {
      if (!isInside(box, group)) continue;
      if (box.cx - box.r < region[0] - EPS || box.cx + box.r > region[1] + EPS) {
        found.push(`${box.key} escapes ${group.key} horizontally`);
      }
      if (box.cy - box.r < group.top - EPS || box.cy + box.r > group.bottom + EPS) {
        found.push(`${box.key} escapes ${group.key} vertically`);
      }
    }
    for (const feed of feeds) {
      if (!isInside(feed, group)) continue;
      if (feed.x < region[0] - EPS || feed.x > region[1] + EPS) {
        found.push(`${feed.key} escapes ${group.key} horizontally`);
      }
      if (feed.y0 < group.top - EPS || feed.y1 > group.bottom + EPS) {
        found.push(`${feed.key} escapes ${group.key} vertically`);
      }
    }
    for (const lane of lanes) {
      if (!isInside(lane, group)) continue;
      if (lane.x < region[0] - EPS || lane.x > region[1] + EPS) {
        found.push(`${lane.key} escapes ${group.key} horizontally`);
      }
      if (lane.y < group.top - EPS || lane.y > group.bottom + EPS) {
        found.push(`${lane.key} escapes ${group.key} vertically`);
      }
    }
  }

  // --- inside the canvas ---------------------------------------------------
  //
  // The canvas is an SVG `viewBox`; anything outside it is clipped away rather
  // than drawn wrong, which is the version of this failure nobody reports.
  for (const process of processes) {
    if (process.x0 < -EPS || process.x1 > diagram.width + EPS) {
      found.push(`${process.key}: horizontally outside the canvas`);
    }
    const [top, bottom] = runBand(process.y);
    if (top < -EPS || bottom > diagram.height + EPS) {
      found.push(`${process.key}: vertically outside the canvas`);
    }
  }
  for (const box of states) {
    if (box.cx - box.r < -EPS || box.cx + box.r > diagram.width + EPS) {
      found.push(`${box.key}: horizontally outside the canvas`);
    }
    if (box.cy - box.r < -EPS || box.cy + box.r > diagram.height + EPS) {
      found.push(`${box.key}: vertically outside the canvas`);
    }
  }

  // --- the count the page prints -------------------------------------------
  //
  // `collapsedCount` is what the page turns into "N lines have ways through that
  // you have not opened". A count that is not the number of shapes actually
  // drawn shut is a sentence asking a visitor to believe a number about our own
  // coverage, which is the one place this repository has decided not to guess.
  const drawnCollapsed = processes.filter((process) => process.state === "collapsed").length;
  if (diagram.collapsedCount !== drawnCollapsed) {
    found.push(
      `collapsedCount is ${diagram.collapsedCount} but ${drawnCollapsed} lines are drawn collapsed`,
    );
  }

  return found;
}

// ---------------------------------------------------------------------------
// Text measurement — the one part that cannot use a DOM
// ---------------------------------------------------------------------------

test("a CJK string is measured wider than the same number of Latin characters", () => {
  // The Japanese surface is the one a low estimate breaks, and — as the real
  // graph below demonstrates — it is the locale where this canvas runs out of
  // room first.
  assert.ok(estimateTextWidth("量子線形方程式", 12) > estimateTextWidth("abcdefg", 12));
});

test("fitLabel never exceeds its budget, and the full text always survives the cut", () => {
  const long = "Solve a linear system of ordinary differential equations to a stated error";
  const fitted = fitLabel(long, M.processFont, 120);
  assert.equal(fitted.truncated, true);
  assert.ok(estimateTextWidth(fitted.text, M.processFont) <= 120);
  assert.ok(fitted.text.endsWith("…"));

  const short = fitLabel("Short", M.processFont, 400);
  assert.deepEqual(short, { text: "Short", truncated: false });
});

// ---------------------------------------------------------------------------
// Column ranks — the model the whole no-crossing argument rests on
// ---------------------------------------------------------------------------

/** Every lane's ranks strictly increase, and every lane ends in the last column. */
function rankViolations(lanes: readonly (readonly string[])[]): string[] {
  const found: string[] = [];
  const { ranks, columns } = columnRanks(lanes);
  if (ranks.length !== lanes.length) found.push(`got ${ranks.length} lanes for ${lanes.length}`);
  ranks.forEach((lane, index) => {
    if (lane.length !== lanes[index]!.length) found.push(`lane ${index}: wrong length`);
    for (let i = 1; i < lane.length; i += 1) {
      if (lane[i]! <= lane[i - 1]!) {
        found.push(`lane ${index}: rank ${lane[i]} does not exceed ${lane[i - 1]} at ${i}`);
      }
    }
    if (lane.length > 0 && lane[lane.length - 1]! !== columns - 1) {
      found.push(`lane ${index}: ends at column ${lane[lane.length - 1]}, not ${columns - 1}`);
    }
    for (const rank of lane) {
      if (rank < 0 || rank >= columns) found.push(`lane ${index}: rank ${rank} outside 0..${columns - 1}`);
    }
  });
  return found;
}

test("column ranks strictly increase along every lane and every lane ends in the last column", () => {
  // Strict increase is not a tidiness property. It is the entire second half of
  // the no-crossing argument: two processes in one lane occupy [c0,c1) and
  // [c1,c2) and can only share the circle between them.
  assert.deepEqual(rankViolations([["a", "b", "c"]]), []);
  assert.deepEqual(rankViolations([["a", "b", "c"], ["a", "c"]]), []);
  assert.deepEqual(rankViolations([["a", "b", "c", "d"], ["a", "e"]]), []);
  assert.deepEqual(rankViolations([["a", "b"], ["a", "x", "y", "z", "b"]]), []);
});

test("a state two lanes agree on lands in one column, so the tie between them is vertical", () => {
  const { ranks, columns } = columnRanks([
    ["a", "shared", "b", "c"],
    ["a", "shared", "c"],
  ]);
  assert.equal(ranks[0]![1], ranks[1]![1], "the shared state is not in one column");
  // And both lanes finish together — without the pin the short lane's exit is a
  // different circle from the long lane's, three columns to its left.
  assert.equal(ranks[0]!.at(-1), columns - 1);
  assert.equal(ranks[1]!.at(-1), columns - 1);
});

test("a short lane beside a long one is pinned to the final column rather than stopping early", () => {
  const { ranks, columns } = columnRanks([
    ["a", "b", "c", "d", "e"],
    ["a", "z"],
  ]);
  assert.equal(columns, 5);
  assert.deepEqual(ranks[0], [0, 1, 2, 3, 4]);
  assert.equal(ranks[1]!.at(-1), 4, "the two-step lane does not finish where the five-step one does");
  assert.deepEqual(rankViolations([["a", "b", "c", "d", "e"], ["a", "z"]]), []);
});

test("two lanes that disagree about the order of two states still get usable ranks", () => {
  // The pathological input, and the reason the engine relaxes rather than sorts
  // topologically. The union of these two chains has a cycle — x before y on one
  // lane, y before x on the other — so there is no assignment that both aligns
  // the shared states and increases along both lanes. The relaxation saturates
  // and falls back to positional ranks, which give up the alignment and keep the
  // strict increase, because strict increase is what the guarantee needs.
  //
  // The assertion that matters most is that this returns at all: a longest-path
  // walk over the same input recurses until the stack gives out, and this
  // function is reached from a route handler that must answer.
  const lanes = [
    ["a", "x", "y", "b"],
    ["a", "y", "x", "b"],
  ];
  assert.deepEqual(rankViolations(lanes), []);
  const { ranks, columns } = columnRanks(lanes);
  assert.equal(columns, 4);
  assert.deepEqual(ranks, [
    [0, 1, 2, 3],
    [0, 1, 2, 3],
  ]);
});

test("degenerate lane sets do not throw and do not produce negative columns", () => {
  assert.deepEqual(columnRanks([]), { ranks: [], columns: 1 });
  assert.deepEqual(columnRanks([[]]), { ranks: [[]], columns: 1 });
  assert.deepEqual(columnRanks([["only"]]), { ranks: [[0]], columns: 1 });
});

// ---------------------------------------------------------------------------
// routeOf — a method read as a path
// ---------------------------------------------------------------------------

const ROUTE_STATES = vocabulary(
  state("alpha"),
  state("beta"),
  state("gamma"),
  state("delta"),
  state("epsilon"),
  state("beta-hermitian", { specializes: ["beta"] }),
);

test("a method with no steps is one segment, and that segment is the method itself", () => {
  // Not a gap. `direct-sampling-readout` delegates nothing and then samples, and
  // the sampling is the whole method — a real process with a page. The first
  // draft of `routeOf` reported this shape as twenty-three missing conversions.
  const graph: LayerGraph = {
    nodes: [capability("top", "alpha", "gamma"), method("only-way", "top", { atomic: true })],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.states, ["alpha", "gamma"]);
  assert.deepEqual(route.segments, [{ capabilityId: null, methodId: "only-way", narrowed: false }]);
  assert.deepEqual(route.feeds, []);
  assert.equal(route.coverage, "all-own");
  // The shape the diagram depends on everywhere: one more state than segments.
  assert.equal(route.states.length, route.segments.length + 1);
});

test("a step whose input the route is not holding is an ingredient, not a stage", () => {
  // Authored order is deliberately wrong here — the ingredient is listed first —
  // because `steps` was authored as "what this route needs" and reading it as a
  // path is what produced the feed/spine split. A route that took the list in
  // order would open at `delta`, which it has never held.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["ingredient", "hop"] }),
      capability("ingredient", "delta", "epsilon"),
      capability("hop", "alpha", "beta"),
    ],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.feeds, ["ingredient"]);
  assert.deepEqual(route.states, ["alpha", "beta", "gamma"]);
  assert.deepEqual(
    route.segments.map((segment) => segment.capabilityId ?? `own:${segment.methodId}`),
    ["hop", "own:way"],
  );
  // One delegated hop and one the method closes itself: neither "delegated" nor
  // "all-own", and a reader deciding what to reuse needs to see which it is.
  assert.equal(route.coverage, "partly-own");
});

test("a route whose steps span the whole slot delegates all of it", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["first", "second"] }),
      capability("first", "alpha", "beta"),
      capability("second", "beta", "gamma"),
    ],
  };
  const route = routeOf(graph, ROUTE_STATES, graph.nodes[1] as LayerMethod);
  assert.deepEqual(route.states, ["alpha", "beta", "gamma"]);
  assert.equal(route.segments.length, 2);
  assert.equal(route.coverage, "delegated");
});

test("`through` narrows a junction, and a `through` that would broaden it is ignored", () => {
  // The asymmetry is the whole value of the composition check. A route may hand
  // on something narrower than the next process requires; handing on something
  // broader is a conversion nobody wrote down, and `through` must not be usable
  // to wish one away.
  const base: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["hop"] }),
      capability("hop", "alpha", "beta"),
    ],
  };
  const plain = routeOf(base, ROUTE_STATES, base.nodes[1] as LayerMethod);
  assert.deepEqual(plain.states, ["alpha", "beta", "gamma"]);
  assert.equal(plain.segments[0]!.narrowed, false);

  const narrowed: LayerGraph = {
    nodes: [
      base.nodes[0]!,
      method("way", "top", { steps: ["hop"], through: { hop: "beta-hermitian" } }),
      base.nodes[2]!,
    ],
  };
  const narrowRoute = routeOf(narrowed, ROUTE_STATES, narrowed.nodes[1] as LayerMethod);
  assert.deepEqual(narrowRoute.states, ["alpha", "beta-hermitian", "gamma"]);
  assert.equal(narrowRoute.segments[0]!.narrowed, true);

  // `epsilon` is not a kind of `beta`, so this is a replacement wearing the word
  // "narrower". It is dropped and the route is exactly the un-narrowed one.
  const bogus: LayerGraph = {
    nodes: [
      base.nodes[0]!,
      method("way", "top", { steps: ["hop"], through: { hop: "epsilon" } }),
      base.nodes[2]!,
    ],
  };
  assert.deepEqual(routeOf(bogus, ROUTE_STATES, bogus.nodes[1] as LayerMethod), plain);
});

// ---------------------------------------------------------------------------
// The four readings of a drawn process, which must never collapse into three
// ---------------------------------------------------------------------------

const SLOT_STATES = vocabulary(state("alpha"), state("beta"), state("gamma"), state("delta"));

const SLOT_GRAPH: LayerGraph = {
  nodes: [
    capability("top", "alpha", "delta"),
    method("way", "top", { steps: ["filled", "barren"] }),
    capability("filled", "alpha", "beta"),
    method("filler", "filled", { atomic: true }),
    capability("barren", "beta", "gamma"), // nothing realises this one
  ],
};

test("a slot nothing realises and a slot you have not opened are different shapes", () => {
  const diagram = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", new Set(["top"]), 3);
  const byCapability = new Map(
    diagram.processes.filter((p) => p.capabilityId).map((p) => [p.capabilityId!, p]),
  );

  const filled = byCapability.get("filled")!;
  const barren = byCapability.get("barren")!;

  // "There is more here, and you have not looked" …
  assert.equal(filled.state, "collapsed");
  assert.equal(filled.methodCount, 1);
  // … and "nobody has recorded a way through this at all". Opposite statements
  // about how complete the graph is, and a reader who cannot tell them apart is
  // being told the corpus is fuller than it is.
  assert.equal(barren.state, "unfilled");
  assert.equal(barren.methodCount, 0);
  assert.notEqual(filled.state, barren.state);

  assert.deepEqual(violations(diagram, new Set(["top"])), []);
});

test("opening a slot nothing fills leaves it a line, because there is nothing to open", () => {
  const open: ReadonlySet<string> = new Set(["top", "barren"]);
  const diagram = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", open, 3);
  const barren = diagram.processes.find((p) => p.capabilityId === "barren")!;
  assert.equal(barren.state, "unfilled");
  assert.equal(diagram.groups.some((group) => group.capabilityId === "barren"), false);
  assert.deepEqual(violations(diagram, open), []);
});

test("an opened slot leaves `processes` entirely and becomes a region", () => {
  // The bug this pins: an opened slot that stays in `processes` keeps an
  // `x0..x1` at its own centre line, and that line is drawn straight through
  // every lane nested inside it.
  const open: ReadonlySet<string> = new Set(["top", "filled"]);
  const diagram = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", open, 3);

  assert.equal(diagram.processes.some((p) => p.capabilityId === "top"), false);
  assert.equal(diagram.processes.some((p) => p.capabilityId === "filled"), false);
  assert.deepEqual(
    diagram.groups.map((group) => group.capabilityId).sort(),
    ["filled", "top"],
  );
  // A region, and a region has no line to collide with anything.
  for (const group of diagram.groups) {
    assert.ok(group.bottom > group.top, `${group.key} has no height`);
    assert.ok(group.x1 > group.x0, `${group.key} has no width`);
    assert.equal("y" in group, false, `${group.key} still carries a line`);
  }
  assert.deepEqual(violations(diagram, open), []);
});

test("a slot in `open` but past the depth cap is still a line, and is counted as one", () => {
  // The cap is not a second way of saying "closed": the slot really is drawn
  // shut, so it really is one of the ways through that a reader has not seen.
  const open: ReadonlySet<string> = new Set(["top", "filled"]);
  const capped = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", open, 1);
  const filled = capped.processes.find((p) => p.capabilityId === "filled")!;
  assert.equal(filled.state, "collapsed");
  assert.equal(capped.collapsedCount, 1);
  assert.deepEqual(violations(capped, open), []);

  // Raising the cap opens it and the count drops to nothing shut.
  const deeper = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", open, 3);
  assert.equal(deeper.collapsedCount, 0);
});

test("collapsedCount is the number of lines actually drawn shut", () => {
  const closed = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", new Set(), 3);
  assert.equal(closed.collapsedCount, 1); // `top` itself
  assert.equal(closed.processes.filter((p) => p.state === "collapsed").length, 1);

  const opened = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "top", "en", new Set(["top"]), 3);
  assert.equal(opened.collapsedCount, opened.processes.filter((p) => p.state === "collapsed").length);
  assert.equal(opened.collapsedCount, 1); // `filled`; `barren` is unfilled, not shut
});

test("an id that is not a capability yields an empty diagram rather than a throw", () => {
  const missing = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "no-such-slot", "en", new Set(), 3);
  assert.deepEqual(
    { width: missing.width, processes: missing.processes, states: missing.states },
    { width: 0, processes: [], states: [] },
  );
  const aMethod = layoutProcessMap(SLOT_GRAPH, SLOT_STATES, "filler", "en", new Set(), 3);
  assert.equal(aMethod.width, 0);
});

// ---------------------------------------------------------------------------
// Where the shapes link to
// ---------------------------------------------------------------------------

test("a slot drills down to its own map; a state links to its own page", () => {
  assert.equal(stateHref("linear-generator"), "/repository/layers/linear-generator");

  // Clicking a slot re-centres the map on it rather than expanding it where it
  // stands. The destination therefore depends on **nothing but the id** — not on
  // what is currently open, not on where the reader came from — which is what
  // makes every shape on the canvas a plain, crawlable, idempotent address.
  const target = "/repository/layers?view=map&focus=qls";
  assert.equal(slotHref("qls", new Set(), null), target);
  assert.equal(slotHref("qls", new Set(["ode"]), "ode"), target);
  assert.equal(slotHref("qls", new Set(["ode", "qls"]), "other"), target);
  // An id needing escaping still produces one link rather than a broken query.
  assert.ok(slotHref("a b", new Set(), null).endsWith("focus=a%20b"));
});

// ---------------------------------------------------------------------------
// Truncation — cut in the shape, never lost
// ---------------------------------------------------------------------------

test("a state name too long for its column is cut on the canvas and kept whole in fullLabel", () => {
  // A state name is the one label with a hard ceiling — `stateLabelMax`, because
  // otherwise a single object's name would set the width of a whole column and
  // therefore of the canvas. A slot's name has no such cap: its run is sized
  // *from* its name by `processRunWidth`, so it is not cut, and the asymmetry is
  // deliberate. Both halves are asserted, because "nothing is ever truncated"
  // and "the cap works" look identical from a passing test of only one of them.
  const long =
    "Embed a nonlinear initial-value problem into a linear one whose solution carries it";
  const longState =
    "The generator of a linear system of ordinary differential equations, with an inhomogeneity and a stated error budget";
  const graph: LayerGraph = {
    nodes: [
      capability("top", "wordy", "gamma", { label: long, labelJa: long }),
      method("way", "top", { atomic: true }),
    ],
  };
  const states = vocabulary(state("wordy", { label: longState, labelJa: longState }), state("gamma"));

  const diagram = layoutProcessMap(graph, states, "top", "en", new Set(), 3);

  const entry = diagram.states.find((box) => box.stateId === "wordy")!;
  assert.equal(entry.labelTruncated, true);
  assert.ok(entry.label.endsWith("…"));
  assert.ok(entry.label.length < longState.length);
  assert.ok(estimateTextWidth(entry.label, M.stateFont) <= M.stateLabelMax);
  // Cut in the shape, never lost: the renderer puts this in the `<title>`, and
  // losing it makes the circle unreadable rather than merely abbreviated.
  assert.equal(entry.fullLabel, longState);

  const slot = diagram.processes[0]!;
  assert.equal(slot.labelTruncated, false, "a slot's run is sized for its own name");
  assert.equal(slot.label, long);
  assert.equal(slot.fullLabel, long);

  // And a name at the ceiling is never an excuse to overflow anything else.
  assert.deepEqual(violations(diagram, new Set()), []);
});

// ---------------------------------------------------------------------------
// The geometry, on fixtures that name the case
// ---------------------------------------------------------------------------

const FAN_STATES = vocabulary(state("alpha"), state("beta"), state("gamma"), state("delta"));

test("a slot with many alternatives keeps every lane clear of every other", () => {
  // Seven lanes in one slot. This is the shape a centre-to-centre check passes
  // and a band check does not.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      ...Array.from({ length: 7 }, (_, index) => method(`way-${index}`, "top", { atomic: true })),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, FAN_STATES, "top", "en", open, 3);
  assert.deepEqual(violations(diagram, open), []);
  assert.equal(diagram.processes.filter((p) => p.methodId !== null).length, 7);
});

test("lanes whose routes are different lengths share their columns and stay apart", () => {
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("long-way", "top", { steps: ["first", "second"] }),
      method("short-way", "top", { atomic: true }),
      capability("first", "alpha", "beta"),
      capability("second", "beta", "gamma"),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, FAN_STATES, "top", "en", open, 3);
  assert.deepEqual(violations(diagram, open), []);

  // Both lanes end on the same column, so the two exits are one circle drawn
  // twice rather than two circles at different x.
  const exits = diagram.states.filter((box) => box.terminal === "exit");
  assert.ok(exits.length >= 2);
  assert.equal(new Set(exits.map((box) => box.cx.toFixed(3))).size, 1);
});

test("a run beside a much shorter one is still widened to hold its own name", () => {
  // The property `processRunWidth` exists for, and the one that makes a slot's
  // name readable rather than an ellipsis: a run is never narrower than its own
  // name plus `runLabelPad`. It is a claim about the *measure* pass, and it only
  // survives because the run-widening loop hands each span the shortfall it
  // asked for. Spread that slack evenly instead — every run the same width —
  // and a long name beside a short one is cut with room to spare on its
  // neighbour.
  //
  // The two hops here are deliberately lopsided: a slot whose name is four
  // hundred pixels wide, and the method's own closing work, whose name is three
  // letters. Even widths cannot serve both.
  const wide = "Embed the nonlinear problem in a linear one whose solution carries it";
  const longState = "A generator of a linear system with an inhomogeneity";
  const states = vocabulary(
    state("alpha", { label: `${longState} one`, labelJa: `${longState} one` }),
    state("beta", { label: `${longState} two`, labelJa: `${longState} two` }),
    state("gamma", { label: `${longState} three`, labelJa: `${longState} three` }),
  );
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("outer", "top", { steps: ["wide"] }),
      capability("wide", "alpha", "beta", { label: wide, labelJa: wide }),
      method("filler", "wide", { atomic: true }),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, states, "top", "en", open, 3);
  const slot = diagram.processes.find((process) => process.capabilityId === "wide")!;

  assert.equal(slot.labelTruncated, false, `"${slot.label}" was cut although its run sets the width`);
  assert.equal(slot.label, wide);
  assert.ok(
    slot.x1 - slot.x0 >= estimateTextWidth(wide, M.processFont) + M.runLabelPad - EPS,
    `run is ${(slot.x1 - slot.x0).toFixed(1)} for a name needing ` +
      `${(estimateTextWidth(wide, M.processFont) + M.runLabelPad).toFixed(1)}`,
  );
  assert.deepEqual(violations(diagram, open), []);
});

test("a nested expansion stays inside the run it was given", () => {
  // Past what the page serves, and deliberately kept. `depthCap` is a parameter
  // of `layoutProcessMap`, not a constant inside it, and the measure pass and
  // the place pass have to agree at every value of it or the disagreement is one
  // caller away. The page is at `MAP_DEPTH = 1` because nesting *collides on
  // real labels*, which is a fact about the authored names rather than about the
  // arithmetic; the arithmetic still has to be right, and this is where it is
  // checked.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("outer", "top", { steps: ["middle"] }),
      capability("middle", "alpha", "beta"),
      method("inner-a", "middle", { atomic: true }),
      method("inner-b", "middle", { atomic: true }),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top", "middle"]);
  const diagram = layoutProcessMap(graph, FAN_STATES, "top", "en", open, 4);
  assert.deepEqual(violations(diagram, open), []);

  const inner = diagram.groups.find((group) => group.capabilityId === "middle")!;
  const outer = diagram.groups.find((group) => group.capabilityId === "top")!;
  assert.ok(inner.x0 >= outer.x0 - EPS && inner.x1 <= outer.x1 + EPS);
  assert.ok(inner.top >= outer.top - EPS && inner.bottom <= outer.bottom + EPS);
  assert.equal(inner.depth, outer.depth + 1);
});

test("two lanes holding the same object are tied, and the tie crosses nothing", () => {
  const states = vocabulary(
    state("alpha"),
    state("shared"),
    state("delta"),
    state("shared-narrow", { specializes: ["shared"] }),
  );
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("via-plain", "top", { steps: ["hop"] }),
      method("via-narrow", "top", { steps: ["hop"], through: { hop: "shared-narrow" } }),
      capability("hop", "alpha", "shared"),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, states, "top", "en", open, 3);
  assert.deepEqual(violations(diagram, open), []);

  // One lane holds `shared`, the other holds a kind of it. Those are different
  // claims and the tie says which — conflating them would assert that two routes
  // meet where one merely specialises the other.
  assert.deepEqual(
    diagram.ties.map((tie) => tie.relation),
    ["kind"],
  );
  assert.deepEqual(
    [diagram.ties[0]!.aStateId, diagram.ties[0]!.bStateId].sort(),
    ["shared", "shared-narrow"],
  );
});

test("no tie is drawn at a lane's two ends, where the circles are one object already", () => {
  // Both lanes enter at `alpha` and leave at `delta`, and the two ends are
  // aligned by construction. A tie there is a line drawn from a thing to itself.
  //
  // Measured while mutation-testing this file, and worth writing down where the
  // next reader will find it: the tie loop guards the terminals **twice** —
  // `if (a.terminal !== null) continue` on the upper state, and
  // `candidate.terminal === null` in the lookup for the lower one. Terminality
  // is a property of the column, and both lanes share the columns, so either
  // guard alone rejects every terminal pair. Deleting *either one* changes no
  // output at all: they are equivalent mutants, and no test can distinguish
  // them. Deleting both is caught here. That is not an argument for removing one
  // — the redundancy costs nothing — but it does mean this assertion is guarding
  // the behaviour rather than the belt.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("way-a", "top", { atomic: true }),
      method("way-b", "top", { atomic: true }),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, FAN_STATES, "top", "en", open, 3);
  assert.deepEqual(diagram.ties, []);
  assert.deepEqual(violations(diagram, open), []);
});

test("an ingredient hangs inside its own lane's band and reaches no other lane", () => {
  const states = vocabulary(state("alpha"), state("beta"), state("gamma"), state("delta"), state("epsilon"));
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("needs-one", "top", { steps: ["ingredient", "hop"] }),
      method("needs-none", "top", { atomic: true }),
      capability("ingredient", "epsilon", "gamma"),
      capability("hop", "alpha", "beta"),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, states, "top", "en", open, 3);
  assert.deepEqual(violations(diagram, open), []);
  assert.deepEqual(
    diagram.feeds.map((feed) => feed.capabilityId),
    ["ingredient"],
  );
});

test("a state whose name is far wider than its circle widens its column instead of colliding", () => {
  // The check that a column is sized for its labels rather than its discs. With
  // the label dropped from the width the circles stay ninety pixels apart and
  // the two names are drawn through each other.
  const wide = "An extremely long name for one state that no circle could ever hold on its own";
  const states = vocabulary(
    state("alpha", { label: wide, labelJa: wide }),
    state("beta", { label: wide, labelJa: wide }),
    state("delta", { label: wide, labelJa: wide }),
  );
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("way", "top", { steps: ["hop"] }),
      capability("hop", "alpha", "beta"),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);
  const diagram = layoutProcessMap(graph, states, "top", "en", open, 3);
  assert.deepEqual(violations(diagram, open), []);
});

test("a cycle in the steps graph terminates and is drawn shut rather than followed", () => {
  const states = vocabulary(state("alpha"), state("beta"), state("gamma"));
  const graph: LayerGraph = {
    nodes: [
      capability("a", "alpha", "beta"),
      method("a-way", "a", { steps: ["b"] }),
      capability("b", "alpha", "gamma"),
      method("b-way", "b", { steps: ["a"] }), // back to the top
    ],
  };
  // The assertion here is **termination**, and only termination. A layout that
  // trusted the graph would recurse until the stack gave out; this one stops at
  // the depth cap and draws the repeat shut.
  //
  // Geometry is deliberately not asserted on this input. `validateLayerGraph`
  // rejects a cycle, so no authored graph reaches this path, and a slot nested
  // inside itself is asked to hold its own full width inside one of its own
  // runs — it cannot, and the overflow that produces is a fact about impossible
  // input rather than about the layout. Asserting clean geometry here would be
  // asserting something the shape cannot deliver and does not need to.
  const open: ReadonlySet<string> = new Set(["a", "b"]);
  const diagram = layoutProcessMap(graph, states, "a", "en", open, 3);
  assert.ok(diagram.width > 0 && diagram.height > 0);
  assert.ok(diagram.processes.length > 0, "nothing was drawn at all");
  // The repeat is drawn shut rather than followed: something is still collapsed
  // at the bottom of the recursion.
  assert.ok(diagram.collapsedCount > 0, "the recursion was followed instead of being capped");
  for (const process of diagram.processes) {
    assert.ok(process.depth < diagram.depthCap + 1, `${process.key} is past the cap`);
  }
});

// ---------------------------------------------------------------------------
// The real graph. Structure only — never a count, never a name.
// ---------------------------------------------------------------------------

/**
 * The one depth the page serves.
 *
 * `MAP_DEPTH` in `repository-process-view.tsx` is the authority and it lives in
 * a component, which a `node --test` run cannot import — so this is a second
 * copy, and a second copy drifts. It is a *one-line* second copy of a constant
 * whose whole point is that it does not move, and the test below would go on
 * asserting the old value in silence if it did; naming that here is the only
 * guard available from `lib/`.
 *
 * It is 1 because the map **drills down** rather than nesting in place. Nesting
 * an opened slot inside a lane puts the enclosing route's own circles on a line
 * running through the middle of the nested block, and their names — centred,
 * and as wide as `stateLabelMax` — spill sideways into it. The label-collision
 * sweep below found nine of those at depth 2 on the authored graph. One level at
 * a time has no such case, by construction rather than by measurement.
 */
const SERVED_DEPTH = 1;

/**
 * The two configurations the page can actually produce, for every capability.
 *
 * `repository-process-view.tsx` builds exactly one open set: the focused slot,
 * or nothing at all on the overview. There is no `?depth=` and no free-form
 * `?open=` any more, so this sweep is not a sample of a large space — it *is*
 * the space, and it is asserted exhaustively in both locales.
 */
test("every capability the page can focus draws cleanly, in both locales", () => {
  const capabilities = LAYER_GRAPH.nodes.filter(isCapability);
  assert.ok(capabilities.length > 0, "the graph has no capabilities to draw");

  for (const node of capabilities) {
    for (const locale of ["en", "ja"] as const) {
      // Focused: the slot the reader clicked, with its alternatives fanned out.
      const focused: ReadonlySet<string> = new Set([node.id]);
      const opened = layoutProcessMap(
        LAYER_GRAPH,
        STATE_VOCABULARY,
        node.id,
        locale,
        focused,
        SERVED_DEPTH,
      );
      assert.deepEqual(violations(opened, focused), [], `focused ${node.id} (${locale})`);
      assert.ok(opened.width > 0 && opened.height > 0);

      // On the overview the same slot is drawn shut, and that is a different
      // layout rather than a subset of the first one.
      const shut: ReadonlySet<string> = new Set();
      const closed = layoutProcessMap(
        LAYER_GRAPH,
        STATE_VOCABULARY,
        node.id,
        locale,
        shut,
        SERVED_DEPTH,
      );
      assert.deepEqual(violations(closed, shut), [], `shut ${node.id} (${locale})`);
    }
  }
});

test("at the depth the page serves, no opened slot is ever drawn inside another", () => {
  // This is the property that makes the label collision impossible rather than
  // merely absent, so it is the one worth guarding directly. A nested group is
  // not a cosmetic problem: the enclosing route's circles sit on the line that
  // runs through the middle of it, and a centred name two hundred pixels wide
  // has nowhere to go but sideways into the block.
  for (const node of LAYER_GRAPH.nodes) {
    if (!isCapability(node)) continue;
    for (const locale of ["en", "ja"] as const) {
      const open: ReadonlySet<string> = new Set([node.id]);
      const diagram = layoutProcessMap(LAYER_GRAPH, STATE_VOCABULARY, node.id, locale, open, SERVED_DEPTH);
      assert.ok(
        diagram.groups.length <= 1,
        `${node.id} (${locale}) drew ${diagram.groups.length} regions at depth ${SERVED_DEPTH}`,
      );
      // Belt and braces, and not a restatement: a second region that happened to
      // be a sibling rather than a child would pass the count above on a graph
      // with two roots on one canvas, and still be wrong if it were contained.
      for (const outer of diagram.groups) {
        for (const inner of diagram.groups) {
          if (inner === outer) continue;
          const contained =
            inner.top >= outer.top - EPS &&
            inner.bottom <= outer.bottom + EPS &&
            inner.x0 >= outer.x0 - EPS &&
            inner.x1 <= outer.x1 + EPS;
          assert.equal(contained, false, `${inner.key} is drawn inside ${outer.key}`);
        }
      }
    }
  }
});

test("opening a slot never draws fewer shapes than leaving it shut", () => {
  // Monotonicity is what makes the open/close control mean what it says. It is
  // also the cheapest possible check that an expansion is drawing its lanes at
  // all rather than swallowing them into a region and stopping.
  for (const root of rootCapabilities(LAYER_GRAPH)) {
    const shut = layoutProcessMap(LAYER_GRAPH, STATE_VOCABULARY, root.id, "en", new Set(), SERVED_DEPTH);
    const opened = layoutProcessMap(
      LAYER_GRAPH,
      STATE_VOCABULARY,
      root.id,
      "en",
      new Set([root.id]),
      SERVED_DEPTH,
    );
    const total = (diagram: ProcessDiagram): number =>
      diagram.processes.length + diagram.groups.length + diagram.states.length;
    assert.ok(total(opened) >= total(shut), `${root.id}: opening drew fewer shapes`);
    assert.ok(opened.width >= shut.width - EPS, `${root.id}: opening narrowed the canvas`);
  }
});
