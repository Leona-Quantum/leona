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
  layoutProcessZoom,
  mapHref,
  processPageHref,
  resolveZoom,
  zoomHref,
  MAP_ZOOMS,
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
  anchor: "start" | "middle" | "end",
): TextBox {
  const width = estimateTextWidth(text, fontSize);
  const left =
    anchor === "middle" ? anchorX - width / 2 : anchor === "end" ? anchorX - width : anchorX;
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
  // A state contributes **no** text box: its name is in `<title>`, which the
  // browser draws in its own tooltip layer and which therefore has no extent on
  // the canvas. This used to be the first loop here, over
  // `<text className="mj-process-state-name" …>`, and between them those boxes
  // were three of the four real collisions session 92 found.
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
  // `<text className="mj-process-group-name" x={x0 + 4} y={top + 13}>`
  for (const group of diagram.groups) {
    boxes.push(textBox(group.key, "group name", group.x0 + 4, group.top + 13, group.label, M.processFont, "start"));
  }
  // `<text className="mj-process-lane-name" x={lane.x} y={lane.y}>`
  for (const lane of diagram.lanes) {
    boxes.push(textBox(lane.key, "lane name", lane.x, lane.y, lane.label, M.processFont, "start"));
  }
  // `<text className="mj-process-feed-name" x={feed.x + 11} y={feed.y1 + 2}>`
  for (const feed of diagram.feeds) {
    boxes.push(textBox(feed.key, "feed name", feed.x + 11, feed.y1 + 2, feed.label, M.feedFont, "start"));
  }
  // `<text className="mj-process-caption" x={x} y={y} textAnchor="end">` — the
  // zoomed figure's own name. It is placed by the layout rather than by the
  // renderer precisely so that it lands in this sweep: a name the geometry does
  // not know about is a name nothing checks, which is how three of session 92's
  // four real collisions got onto a page with a green suite.
  if (diagram.caption) {
    boxes.push(
      textBox(
        "caption",
        "caption",
        diagram.caption.x,
        diagram.caption.y,
        diagram.caption.text,
        M.captionFont,
        "end",
      ),
    );
  }
  return boxes;
}

/**
 * The lane a run belongs to, from the run's own key.
 *
 * Keys are paths — `root:<slot>/<method>:own0` — and a run's lane is its key
 * with the `:ownN` suffix taken off. Written once: two copies of a key
 * convention is two things to update, and the copy that is missed does not fail,
 * it stops matching and quietly asserts nothing.
 */
function laneKeyOf(key: string): string {
  return key.replace(/:own\d+$/, "");
}

/** Every hop drawn inside one lane — its runs and its opened slots alike. */
function hopsIn(diagram: ProcessDiagram, laneKey: string): { key: string }[] {
  return [...diagram.processes, ...diagram.groups].filter((shape) =>
    shape.key.startsWith(`${laneKey}:`),
  );
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
function violations(
  diagram: ProcessDiagram,
  open: ReadonlySet<string>,
  /**
   * Which surface this diagram is drawn on.
   *
   * Every geometric invariant below is the same on both, and that is the point
   * of the zoom reusing the map's engine. What differs is *affordances*: the map
   * is where a line toggles and every region names itself, and a process's own
   * page is neither. Those three are switched on this, and nothing else is.
   */
  surface: "map" | "zoom" = "map",
): string[] {
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
  for (const shape of [...lanes, ...feeds]) {
    if (!shape.href) found.push(`${shape.key}: no href`);
  }
  // A group with no address is the zoomed figure's own subject, and it draws no
  // name. The two move together or one of them has been silently lost: a name
  // with nowhere to go is a dead link, and an address with no name is a region
  // nobody can tell is clickable.
  for (const group of groups) {
    if (group.href === null) {
      if (surface !== "zoom") found.push(`${group.key}: no href`);
      else if (group.label !== "") found.push(`${group.key}: no href but its name is drawn`);
    } else if (group.label === "") {
      found.push(`${group.key}: an address with no name to click`);
    }
  }
  // A line may draw no name at all, and exactly one thing licenses that: the
  // name is already written, once, somewhere that names this same line. On the
  // map that is the row's own title directly above it; on a zoomed method it is
  // the caption. Asserted rather than assumed — "the name is elsewhere" is the
  // kind of claim that stays true in a comment long after the elsewhere moved.
  for (const process of processes) {
    if (process.label !== "") continue;
    // Nothing was cut — the name was dropped, and those are different claims.
    // `labelTruncated` is what tells the renderer a full name has to survive
    // somewhere else, and leaving it set on a name that is not drawn at all is
    // the renderer being told to abbreviate nothing.
    if (process.labelTruncated) found.push(`${process.key}: draws no name but is flagged cut`);
    // The lane this line is *in*, not the first lane anywhere on the canvas
    // that happens to be the same method. A method reached under two different
    // parents is drawn twice, and matching on `methodId` picked whichever came
    // first — which put a name three hundred pixels below its own line and read
    // as a violation of a rule nothing had broken. Keys are paths; use the path.
    const laneKey = laneKeyOf(process.key);
    // A row with more than one hop keeps the name on its own-work line. There it
    // is not a repetition of the row's title — it says which hop is the part the
    // method does itself, and without it that hop is a bare line between two
    // circles with nothing on the canvas saying what happens along it.
    const hops = hopsIn(diagram, laneKey);
    if (hops.length > 1) {
      found.push(`${process.key}: draws no name although its row has ${hops.length} hops`);
    }
    const lane = lanes.find((candidate) => candidate.key === `${laneKey}:name`);
    if (lane) {
      if (lane.fullLabel !== process.fullLabel) {
        found.push(`${process.key}: draws no name and its row says something else`);
      }
      if (lane.href !== process.pageHref) {
        found.push(`${process.key}: draws no name and its row leads somewhere else`);
      }
      if (!(lane.y < process.y)) found.push(`${process.key}: its row's name is not above it`);
      continue;
    }
    if (diagram.caption?.fullText === process.fullLabel) continue;
    found.push(`${process.key}: draws no name and nothing else on the canvas names it`);
  }
  for (const shape of [...processes, ...groups, ...lanes, ...feeds]) {
    if (!shape.fullLabel) found.push(`${shape.key}: no fullLabel`);
    // A line that draws no name, licensed by the loop above.
    if ("pageHref" in shape && shape.label === "") continue;
    // The subject of a zoomed figure draws nothing, so there is no drawn name to
    // compare against the whole one.
    if ("closeHref" in shape && shape.href === null) continue;
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
  // A state has a name and a destination but no drawn label, so it is checked for
  // the two it has. Losing `fullLabel` here would be worse than on any other
  // shape: it is the *only* place a state's name appears.
  for (const state of states) {
    if (!state.href) found.push(`${state.key}: no href`);
    if (!state.fullLabel) found.push(`${state.key}: no fullLabel`);
  }
  // A process's line and its name go to different places, and the name's address
  // is the one that must always exist — a line may legitimately be inert.
  for (const process of processes) {
    if (!process.pageHref) found.push(`${process.key}: no pageHref`);
    if (process.href !== null && process.href === process.pageHref) {
      found.push(`${process.key}: line and name lead to the same place`);
    }
    // Only a slot with recorded ways through it can be opened. A method's line
    // and an empty slot's line must not look like controls.
    //
    // On a zoomed figure *no* line is a control, and that is not a weaker rule —
    // it is the same rule reaching a different answer. `?open=` is the map's
    // address; a line that looked openable on a process's own page would either
    // do nothing or navigate away from the page the reader just zoomed into.
    const openable = process.weight === "slot" && process.state === "collapsed";
    if (surface === "zoom") {
      if (process.href !== null) {
        found.push(`${process.key}: a line is a control on a page that is not the map`);
      }
      continue;
    }
    if (openable && process.href === null) found.push(`${process.key}: openable but its line is inert`);
    if (!openable && process.href !== null) {
      found.push(`${process.key}: nothing to open but its line is a control`);
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

test("a line toggles one slot and leaves the rest of the map alone", () => {
  assert.equal(stateHref("linear-generator"), "/repository/layers/linear-generator");
  assert.equal(processPageHref("qls"), "/repository/layers/qls");

  // Opening adds; it does not replace. This is the owner's *"everything else
  // still in view"*, and it is the whole difference from the `?focus=`-only
  // surface session 92 shipped, where opening a second slot shut the first.
  assert.equal(slotHref("qls", new Set(), null), "/repository/layers?view=map&open=qls");
  assert.equal(
    slotHref("qls", new Set(["ode"]), null),
    "/repository/layers?view=map&open=ode&open=qls",
  );

  // Clicking an open one shuts it, and shuts only it.
  assert.equal(
    slotHref("qls", new Set(["ode", "qls"]), null),
    "/repository/layers?view=map&open=ode",
  );
  assert.equal(slotHref("qls", new Set(["qls"]), null), "/repository/layers?view=map");

  // The zoom level rides along untouched — opening something inside a focused
  // slot must not throw the reader back out to the overview.
  assert.equal(
    slotHref("qls", new Set(["ode"]), "ode"),
    "/repository/layers?view=map&focus=ode&open=ode&open=qls",
  );

  // One arrangement, one URL: the order ids arrive in must not change the
  // address, or two readers who opened the same three slots cannot compare links
  // and a cache holds the same page twice.
  assert.equal(
    slotHref("c", new Set(["b", "a"]), null),
    slotHref("c", new Set(["a", "b"]), null),
  );
  assert.equal(slotHref("c", new Set(["b", "a"]), null), "/repository/layers?view=map&open=a&open=b&open=c");

  // An id needing escaping still produces one link rather than a broken query.
  assert.ok(slotHref("a b", new Set(), null).endsWith("open=a%20b"));
  assert.ok(slotHref("x", new Set(), "a b").includes("focus=a%20b"));
});

test("every link that stays on the map carries the whole reading position", () => {
  // Which slot, what is expanded, and what size: one position. This shipped
  // broken — `mapHref` had no `open` parameter, so the breadcrumb and the
  // "all four" link discarded every expansion while the zoom rungs kept them.
  // Measured on production 2026-08-08, from
  // `?focus=linear-ode-solve&zoom=75&open=linear-ode-solve&open=time-discretization`,
  // the breadcrumb emitted `?view=map&focus=nonlinear-ode-solve&zoom=75`.
  const open = new Set(["ode", "qls"]);
  assert.equal(
    mapHref("ode", open, 75),
    "/repository/layers?view=map&focus=ode&zoom=75&open=ode&open=qls",
  );

  // Re-focusing keeps the expansions. This is the assertion the defect failed.
  assert.ok(mapHref("other", open, 75).includes("open=ode"));
  assert.ok(mapHref("other", open, 75).includes("open=qls"));

  // So does going back out to the overview.
  assert.ok(mapHref(null, open, 75).includes("open=ode"));

  // The three builders are one builder. `zoomHref` and `mapHref` were byte
  // identical copies; `slotHref` is the same address after toggling one id.
  // Asserted rather than reviewed, because two of the three had already drifted.
  assert.equal(zoomHref("ode", open, 100), mapHref("ode", open, 100));
  assert.equal(slotHref("qls", new Set(["ode"]), "ode"), mapHref("ode", open, null));

  // Same sorting rule as `slotHref`: one arrangement, one URL.
  assert.equal(mapHref("x", new Set(["b", "a"]), null), mapHref("x", new Set(["a", "b"]), null));
});

test("a toggle on the overview stays on the overview", () => {
  // The bug this pins, found on the rendered page: `layoutProcessMap` passed
  // `rootId` where the page's `?focus=` belonged — harmless while `slotHref`
  // ignored the argument, and wrong the moment a line started toggling. Every
  // link on the four-root overview came out carrying `focus=<that root>`, so
  // opening one thing navigated into its root and took the other three roots
  // off the page. That is precisely what "everything else still in view" is not.
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "gamma"),
      method("way", "top", { steps: ["hop"] }),
      capability("hop", "alpha", "beta"),
      method("hop-way", "hop", { atomic: true }),
    ],
  };
  const states = vocabulary(state("alpha"), state("beta"), state("gamma"));

  // Drawn with no focus — the overview. No link may invent one.
  const overview = layoutProcessMap(graph, states, "top", "en", new Set(["top"]), 3);
  const links = [
    ...overview.processes.map((p) => p.href),
    ...overview.groups.map((g) => g.closeHref),
  ].filter((href): href is string => href !== null);
  assert.ok(links.length > 0, "nothing to check");
  for (const href of links) assert.ok(!href.includes("focus="), href);

  // Drawn at a zoom level — every link keeps it, so opening something inside a
  // focused slot does not throw the reader back out.
  const zoomed = layoutProcessMap(graph, states, "top", "en", new Set(["top"]), 3, "top");
  const zoomedLinks = [
    ...zoomed.processes.map((p) => p.href),
    ...zoomed.groups.map((g) => g.closeHref),
  ].filter((href): href is string => href !== null);
  for (const href of zoomedLinks) assert.ok(href.includes("focus=top"), href);
});

test("toggling the same line twice is the address you started from", () => {
  // The property behind the assertions above, stated once and read back off the
  // URL rather than off the set that produced it: a toggle is its own inverse.
  // A scheme where it is not strands a reader on a map they cannot leave by
  // clicking the thing they just clicked.
  const openIn = (href: string): Set<string> =>
    new Set(
      href
        .split("?")[1]!
        .split("&")
        .filter((pair) => pair.startsWith("open="))
        .map((pair) => decodeURIComponent(pair.slice("open=".length))),
    );

  for (const start of [[], ["a"], ["a", "b"], ["q"], ["a", "q", "b"]]) {
    for (const focus of [null, "a"]) {
      const once = openIn(slotHref("q", new Set(start), focus));
      const twice = openIn(slotHref("q", once, focus));
      assert.deepEqual([...twice].sort(), [...start].sort(), `start=${start} focus=${focus}`);
      // And the first click really did change something, or "its own inverse"
      // would be satisfied by a link that does nothing at all.
      assert.notDeepEqual([...once].sort(), [...start].sort());
    }
  }
});

// ---------------------------------------------------------------------------
// Truncation — cut in the shape, never lost
// ---------------------------------------------------------------------------

test("a state's name is never cut, because it is never drawn — and it never widens a column", () => {
  // This replaced a test that a long state name is truncated to `stateLabelMax`.
  // The cap existed because a single object's name set the width of a column and
  // therefore of the canvas; the name is in `<title>` now, so it is kept **whole**
  // and costs nothing. Both halves matter and each looks fine alone: "the name
  // survives" without "the column did not grow" is the old behaviour with the cut
  // removed, which is how the canvas got to 1,811px in the first place.
  const long =
    "Embed a nonlinear initial-value problem into a linear one whose solution carries it";
  const longState =
    "The generator of a linear system of ordinary differential equations, with an inhomogeneity and a stated error budget";
  const graph = (stateLabel: string): LayerGraph => ({
    nodes: [
      capability("top", "wordy", "gamma", { label: long, labelJa: long }),
      method("way", "top", { atomic: true }),
    ],
  });
  const withName = (name: string) => vocabulary(state("wordy", { label: name, labelJa: name }), state("gamma"));

  const diagram = layoutProcessMap(graph(longState), withName(longState), "top", "en", new Set(), 3);
  const entry = diagram.states.find((box) => box.stateId === "wordy")!;
  assert.equal(entry.fullLabel, longState, "the whole name reaches the title, uncut");

  // The same map with a one-character state name is exactly as wide. That is the
  // property — not "narrower than before", which any smaller constant satisfies.
  const tiny = layoutProcessMap(graph("x"), withName("x"), "top", "en", new Set(), 3);
  assert.equal(
    diagram.width,
    tiny.width,
    "a state's name must not be able to change the width of the canvas",
  );
  assert.equal(diagram.height, tiny.height);

  const slot = diagram.processes[0]!;
  assert.equal(slot.labelTruncated, false, "a slot's run is still sized for its own name");
  assert.equal(slot.label, long);
  assert.equal(slot.fullLabel, long);

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

test("three enormous state names cost the canvas nothing, in either script", () => {
  // This test used to be called "a state whose name is far wider than its circle
  // widens its column instead of colliding", and it asserted that a column is
  // sized for its labels rather than its discs. That is the behaviour session 93
  // removed, so the old test kept passing while guarding nothing: with no state
  // name drawn, three identical wide names have nothing to collide with, and
  // `violations() == []` was true for a reason unrelated to its own title.
  //
  // What is worth pinning now is the opposite claim, and it is not free — the
  // widths still flow through `stateWidth`, and one `estimateTextWidth` call
  // reintroduced there would put 200px per column back without failing anything
  // else in this file.
  const wide = "An extremely long name for one state that no circle could ever hold on its own";
  const wideJa = "どの円にも到底収まりきらないほど長い、ひとつの対象のための名前という名前";
  const build = (label: string, labelJa: string) =>
    vocabulary(
      state("alpha", { label, labelJa }),
      state("beta", { label, labelJa }),
      state("delta", { label, labelJa }),
    );
  const graph: LayerGraph = {
    nodes: [
      capability("top", "alpha", "delta"),
      method("way", "top", { steps: ["hop"] }),
      capability("hop", "alpha", "beta"),
    ],
  };
  const open: ReadonlySet<string> = new Set(["top"]);

  const short = layoutProcessMap(graph, build("x", "x"), "top", "en", open, 3);
  for (const [locale, names] of [
    ["en", build(wide, wide)],
    ["ja", build(wideJa, wideJa)],
  ] as const) {
    const diagram = layoutProcessMap(graph, names, "top", locale, open, 3);
    assert.deepEqual(violations(diagram, open), [], `${locale} overlaps`);
    assert.equal(diagram.width, short.width, `${locale}: a state's name changed the canvas width`);
    assert.equal(diagram.height, short.height, `${locale}: a state's name changed the canvas height`);
  }
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
 * The depth the page serves.
 *
 * `MAP_DEPTH` in `repository-process-view.tsx` is the authority and it lives in
 * a component, which a `node --test` run cannot import — so this is a second
 * copy, and a second copy drifts. It is a *one-line* second copy of a constant
 * whose whole point is that it does not move, and the tests below would go on
 * asserting the old value in silence if it did; naming that here is the only
 * guard available from `lib/`.
 *
 * It was 1, because the map drilled down rather than nesting in place, and the
 * reason given was that nesting puts the enclosing route's circles on a line
 * running through the middle of the nested block while their names — centred,
 * and as wide as `stateLabelMax` — spill sideways into it. **That reason named
 * the names.** State names moved into `<title>` in session 93 on the owner's
 * brief, `stateLabelMax` is gone, and what is left is circles and lines, which
 * the column model has always kept apart. The nesting sweep below is now the
 * evidence for that, rather than the depth cap being the evidence.
 */
const SERVED_DEPTH = 4;

/**
 * Every capability, drawn shut and drawn open, in both locales.
 *
 * Not a sample: this is every single-slot configuration the page can produce,
 * asserted exhaustively. The nested cases are the test after it.
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

test("an opened slot inside an opened slot still collides with nothing, in both locales", () => {
  // The replacement for "no opened slot is ever drawn inside another", which was
  // true when the map drilled down and is deliberately false now. That test kept
  // passing after the change — its fixture opened a single id, so only one group
  // could ever form — which is exactly the shape of a guard that has stopped
  // guarding: green, and unrelated to its own title.
  //
  // What matters is the thing the old cap was standing in for. So: open every
  // slot **together with everything reachable underneath it**, which is the
  // deepest arrangement a reader can click their way into, and sweep the whole
  // canvas for overlaps in both scripts. Nine collisions were found this way at
  // depth 2 in session 92; the state names that caused all nine are gone.
  const stepsUnder = (id: string, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const node of LAYER_GRAPH.nodes) {
      if (node.kind !== "method" || node.realizes !== id) continue;
      for (const step of node.steps) stepsUnder(step, seen);
    }
  };

  let nested = 0;
  for (const node of LAYER_GRAPH.nodes) {
    if (!isCapability(node)) continue;
    const open = new Set<string>();
    stepsUnder(node.id, open);
    for (const locale of ["en", "ja"] as const) {
      const diagram = layoutProcessMap(
        LAYER_GRAPH,
        STATE_VOCABULARY,
        node.id,
        locale,
        open,
        SERVED_DEPTH,
      );
      assert.deepEqual(violations(diagram, open), [], `${node.id} (${locale}) fully opened`);
      // `groups.length > 1` would **not** prove this. Two sibling slots opened in
      // one lane are two groups, both at depth 0, and the assertion below would
      // then be satisfied by a canvas with no nesting on it at all — the same
      // shape of hollow guard this test was written to replace. `depth` says it
      // directly, so ask `depth`.
      if (diagram.groups.some((group) => group.depth > 0)) nested += 1;
    }
  }
  // And the sweep has to have actually drawn the case it is about. Without this
  // the assertion above is satisfied by a graph that never nests at all, which
  // is the state the old test was left in.
  assert.ok(nested > 0, "no capability produced a nested expansion — nothing was tested");
});

// ---------------------------------------------------------------------------
// The zoomed figure: one process on its own page
// ---------------------------------------------------------------------------
//
// `layoutProcessZoom` is deliberately the map's engine held at depth one rather
// than a second geometry, so most of what it must satisfy is already asserted
// above and is re-asserted here only over the arrangements the zoom produces and
// the map cannot. What is genuinely new is small and is all of it about
// *addresses*: this page is not the map, so nothing on it may claim to open
// anything, and the subject may not link to itself.

/** The topmost edge of anything actually stroked on the canvas. */
function topOfShapes(diagram: ProcessDiagram): number {
  const tops: number[] = [];
  for (const process of diagram.processes) tops.push(process.y - M.edgeBand / 2);
  for (const group of diagram.groups) tops.push(group.top);
  for (const stateBox of diagram.states) tops.push(stateBox.cy - stateBox.r);
  for (const lane of diagram.lanes) tops.push(lane.y - M.processFont * 0.8);
  for (const tie of diagram.ties) tops.push(tie.y0);
  return tops.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...tops);
}

const ZOOM_STATES = vocabulary(state("alpha"), state("beta"), state("gamma"), state("delta"));

const ZOOM_GRAPH: LayerGraph = {
  nodes: [
    capability("slot", "alpha", "delta"),
    method("first-way", "slot", { steps: ["inner"] }),
    method("second-way", "slot", { atomic: true }),
    capability("inner", "alpha", "delta"),
    method("inner-way", "inner", { atomic: true }),
  ],
};

// ---------------------------------------------------------------------------
// `?zoom=` — the size the reader chose
// ---------------------------------------------------------------------------

test("a size that is not a rung is not a size", () => {
  // Validated against the ladder, never clamped. `?zoom=17` is not a request for
  // 50%; it is a URL that names no rung, and the honest answer to that is the
  // default. Clamping would silently answer a question nobody asked.
  for (const rung of MAP_ZOOMS) assert.equal(resolveZoom(String(rung)), rung);
  for (const bad of ["17", "0", "-100", "1000", "100%", "fit", "", " 100", "1e2", null]) {
    assert.equal(resolveZoom(bad), null, JSON.stringify(bad));
  }
});

test("a line's toggle carries the size, so opening a slot does not undo it", () => {
  // The failure this exists for: a control that appears to work once and then
  // undoes itself. A reader sets 150%, clicks a line to open it, and the map
  // comes back at "fit" — with nothing to tell them the click did that.
  assert.equal(
    slotHref("qls", new Set(), null, 150),
    "/repository/layers?view=map&zoom=150&open=qls",
  );
  assert.equal(
    slotHref("qls", new Set(["ode"]), "ode", 75),
    "/repository/layers?view=map&focus=ode&zoom=75&open=ode&open=qls",
  );
  // Absent by default, so "fit" keeps one canonical URL rather than two.
  assert.equal(slotHref("qls", new Set(), null), "/repository/layers?view=map&open=qls");
  assert.equal(slotHref("qls", new Set(), null, null), "/repository/layers?view=map&open=qls");
});

test("every control the drawn map emits carries the size, and nothing else does", () => {
  // `slotHref` taking the argument is not the same claim as the canvas passing
  // it. That gap is the one this graph has been bitten by before — a parameter
  // threaded to a function nothing calls with it — so this asserts the shapes
  // that are actually drawn.
  //
  // The rule, stated once: **the size belongs to the page it was set on.** A
  // toggle stays on the map and keeps it. A name goes to a different subject's
  // page, where "fit" is the right first look, and a circle goes to a state page
  // which draws no canvas at all — a size parameter there would be a URL making
  // a promise the page does not keep.
  const root = rootCapabilities(LAYER_GRAPH)[0]!;
  const open: ReadonlySet<string> = new Set([root.id]);
  const diagram = layoutProcessMap(LAYER_GRAPH, STATE_VOCABULARY, root.id, "en", open, 3, null, 150);

  const toggles = [
    ...diagram.processes.map((process) => process.href),
    ...diagram.groups.map((group) => group.closeHref),
  ].filter((href): href is string => href !== null);
  assert.ok(toggles.length > 0, "nothing on this map was a control");
  for (const href of toggles) {
    assert.match(href, /[?&]zoom=150(&|$)/, `a toggle dropped the reader's size: ${href}`);
  }

  const departures = [
    ...diagram.processes.map((process) => process.pageHref),
    ...diagram.lanes.map((lane) => lane.href),
    ...diagram.states.map((state) => state.href),
    ...diagram.feeds.map((feed) => feed.href),
    ...diagram.groups.map((group) => group.href).filter((href): href is string => href !== null),
  ];
  assert.ok(departures.length > 0);
  for (const href of departures) {
    assert.ok(!href.includes("zoom="), `a link off this page carried a size it cannot honour: ${href}`);
  }

  // And with no size asked for, no address mentions one.
  const fit = layoutProcessMap(LAYER_GRAPH, STATE_VOCABULARY, root.id, "en", open, 3, null);
  for (const href of [
    ...fit.processes.map((process) => process.href),
    ...fit.groups.map((group) => group.closeHref),
  ]) {
    if (href !== null) assert.ok(!href.includes("zoom="), href);
  }
});

test("changing the size keeps everything the reader had open", () => {
  // The other direction of the same address. `slotHref` toggles a slot and keeps
  // the size; this changes the size and keeps the slots — and both sort `open`,
  // so one arrangement of the map is still exactly one URL whichever route the
  // reader took to it.
  assert.equal(
    zoomHref("ode", new Set(["qls", "ode"]), 200),
    "/repository/layers?view=map&focus=ode&zoom=200&open=ode&open=qls",
  );
  assert.equal(
    zoomHref("ode", new Set(["ode", "qls"]), 200),
    zoomHref("ode", new Set(["qls", "ode"]), 200),
  );
  // Back to "fit" is the URL with no size on it at all, not `zoom=100`.
  assert.equal(zoomHref(null, new Set(), null), "/repository/layers?view=map");
  // And the two builders agree about the map they are describing: opening `qls`
  // from here, then asking for the same size, is the address the reader is on.
  const opened = slotHref("qls", new Set(["ode"]), "ode", 150);
  assert.equal(opened, zoomHref("ode", new Set(["ode", "qls"]), 150));
});

test("a one-hop row does not write its method's name twice, and a longer row does", () => {
  // The symptom, from `get_page_text` on the rendered page: every method name in
  // the list, twice through. A lane that is a single segment of its method's own
  // work drew the row's title and then the same string again on the only line in
  // the row, five pixels below it. Forty-one of this graph's fifty-eight methods
  // are that shape.
  let single = 0;
  let longer = 0;
  for (const node of LAYER_GRAPH.nodes) {
    if (!isCapability(node)) continue;
    const diagram = layoutProcessMap(
      LAYER_GRAPH,
      STATE_VOCABULARY,
      node.id,
      "en",
      new Set([node.id]),
      1,
    );
    for (const process of diagram.processes) {
      if (process.methodId === null || process.capabilityId !== null) continue;
      const hops = hopsIn(diagram, laneKeyOf(process.key));
      if (hops.length === 1) {
        assert.equal(process.label, "", `${process.key} repeats its row's title`);
        single += 1;
      } else {
        // Where the row has other hops the name stays: it is which one of them
        // the method does itself, not a repetition of the row.
        assert.notEqual(process.label, "", `${process.key} lost the name that marks it`);
        longer += 1;
      }
    }
  }
  assert.ok(single > 0 && longer > 0, `single=${single} longer=${longer} — a case was not drawn`);
});

test("a zoomed slot draws every way through it, and no line on it is a control", () => {
  const diagram = layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, "slot", "en");

  // Both alternatives, drawn as lanes between the same two ends.
  assert.deepEqual(
    diagram.lanes.map((lane) => lane.methodId).sort(),
    ["first-way", "second-way"],
  );
  // The subject is the region the lanes sit in, and it does not name itself: the
  // caption top right and the page's own `<h1>` are the two places that name it,
  // and a third copy here would be a link back to the page you are on.
  const own = diagram.groups.find((group) => group.capabilityId === "slot")!;
  assert.equal(own.href, null);
  assert.equal(own.label, "");
  assert.equal(own.closeHref, null);
  // `?open=` is the map's address and this is not the map.
  assert.deepEqual(
    diagram.processes.filter((process) => process.href !== null),
    [],
  );
  // …and the names still are links, because a name has always gone to a page.
  assert.ok(diagram.processes.every((process) => process.pageHref.startsWith("/repository/layers/")));

  assert.equal(diagram.caption?.fullText, "slot");
  assert.equal(diagram.caption?.kind, "slot");
  assert.deepEqual(violations(diagram, new Set(["slot"]), "zoom"), []);
});

test("a zoomed method is one way through its slot, and the slot keeps its name", () => {
  const diagram = layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, "first-way", "en");

  // One lane's worth of drawing, and the lane is this method — so its own name
  // is not drawn twice. The caption is the other end of the same line.
  assert.deepEqual(diagram.lanes, []);
  assert.equal(diagram.caption?.fullText, "first-way");
  assert.equal(diagram.caption?.kind, "method");
  // The sibling is not on this page at all. That is the whole difference between
  // this figure and the slot's own, and it is what the lens buys.
  assert.equal(
    diagram.processes.some((process) => process.methodId === "second-way"),
    false,
  );
  // The slot it fills is still named, and still a link — a reader has to be able
  // to get from one way through to all of them.
  const slot = diagram.groups.find((group) => group.capabilityId === "slot")!;
  assert.equal(slot.href, "/repository/layers/slot");
  assert.ok(slot.label.length > 0);
  // Its one step is drawn, shut, and counted as shut.
  const inner = diagram.processes.find((process) => process.capabilityId === "inner")!;
  assert.equal(inner.state, "collapsed");
  assert.equal(diagram.collapsedCount, 1);

  assert.deepEqual(violations(diagram, new Set(["slot"]), "zoom"), []);
});

test("the lens that hides a method's siblings does not touch the graph", () => {
  // The zoom for a method restricts what fills one slot so that the lane code
  // draws one lane. A lens that leaked would silently delete a method from every
  // page rendered after it in the same process.
  // The whole graph, deeply. A list of ids survives a lens that mutated a node
  // in place — filtered its `steps`, rewrote its `realizes` — which is the same
  // leak with a quieter symptom.
  const before = structuredClone(ZOOM_GRAPH);
  layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, "first-way", "en");
  layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, "second-way", "ja");
  assert.deepEqual(ZOOM_GRAPH, before);
  // And the slot's own figure still has both ways through it afterwards.
  const after = layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, "slot", "en");
  assert.equal(after.lanes.length, 2);
});

test("a slot nothing fills still gets a figure, with its two ends and a broken line", () => {
  const diagram = layoutProcessZoom(SLOT_GRAPH, SLOT_STATES, "barren", "en");
  const line = diagram.processes.find((process) => process.capabilityId === "barren")!;
  assert.equal(line.state, "unfilled");
  // Nothing to open, so nothing pretends to be openable — the same rule the map
  // follows, arrived at from the other direction.
  assert.equal(line.href, null);
  assert.deepEqual(
    diagram.states.map((box) => box.stateId),
    ["beta", "gamma"],
  );
  assert.equal(diagram.caption?.fullText, "barren");
});

test("nothing that is not a process has a figure", () => {
  // A state id resolves on this route — states and nodes share one namespace on
  // purpose — and it is not a thing this figure is about. An empty diagram is
  // what makes the page render its prose and no picture, rather than a picture
  // of nothing.
  for (const id of ["alpha", "not-a-node", ""]) {
    const diagram = layoutProcessZoom(ZOOM_GRAPH, ZOOM_STATES, id, "en");
    assert.equal(diagram.width, 0, id);
    assert.equal(diagram.caption, null, id);
  }
});

test("every process in the graph zooms cleanly, in both locales", () => {
  // The exhaustive pass, and the one that catches "it lays out fine in the
  // abstract and breaks on the one method whose Japanese label is forty per cent
  // wider than its English one". Structural invariants only: no count, no name.
  let slots = 0;
  let methods = 0;
  for (const node of LAYER_GRAPH.nodes) {
    for (const locale of ["en", "ja"] as const) {
      const diagram = layoutProcessZoom(LAYER_GRAPH, STATE_VOCABULARY, node.id, locale);
      assert.ok(diagram.width > 0 && diagram.height > 0, `${node.id} (${locale}) drew nothing`);
      const opened = new Set([isCapability(node) ? node.id : node.realizes]);
      assert.deepEqual(violations(diagram, opened, "zoom"), [], `zoom ${node.id} (${locale})`);

      const caption = diagram.caption;
      assert.ok(caption, `${node.id} (${locale}) has no caption`);
      // Top right, and clear of the drawing rather than merely not equal to it.
      // A caption sitting one pixel into the first circle is the failure this is
      // about, and `y < top` would pass it.
      assert.ok(
        caption.y + M.captionFont * 0.25 < topOfShapes(diagram),
        `${node.id} (${locale}): caption overlaps the drawing`,
      );
      assert.ok(caption.x <= diagram.width, `${node.id} (${locale}): caption runs off the canvas`);
      assert.ok(
        caption.x - estimateTextWidth(caption.text, M.captionFont) >= -EPS,
        `${node.id} (${locale}): caption runs off the left`,
      );
      // Nothing on a zoomed figure toggles anything, at any depth.
      assert.deepEqual(
        diagram.processes.filter((process) => process.href !== null).map((process) => process.key),
        [],
        `${node.id} (${locale}): a line is still a toggle`,
      );
      assert.deepEqual(
        diagram.groups.filter((group) => group.closeHref !== null).map((group) => group.key),
        [],
        `${node.id} (${locale}): an opened slot is still closable`,
      );
      // Exactly one thing on the canvas declines to name itself: the subject.
      const anonymous = diagram.groups.filter((group) => group.href === null);
      if (isCapability(node)) {
        assert.deepEqual(anonymous.map((group) => group.capabilityId), [node.id]);
        slots += 1;
      } else {
        assert.deepEqual(anonymous, [], `${node.id}: a method's figure hid a slot's name`);
        assert.equal(
          diagram.lanes.some((lane) => lane.methodId === node.id),
          false,
          `${node.id}: the method named itself inside its own figure`,
        );
        methods += 1;
      }
    }
  }
  // Both shapes of figure were actually produced. Without this the assertions
  // above are satisfied by a graph of one kind of node.
  assert.ok(slots > 0 && methods > 0, `slots=${slots} methods=${methods}`);
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
