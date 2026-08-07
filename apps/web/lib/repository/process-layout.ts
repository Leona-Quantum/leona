// The process map: states as circles, processes as the lines between them.
//
// > *"There must be no overlapping lines or states anywhere!"*
// > — owner, session-91 inbox
//
// ## How that constraint is met, and why it is not a solver
//
// The obvious reading of "no overlapping lines" is a crossing-minimisation pass,
// and that is the wrong tool: crossing minimisation is a heuristic over a general
// graph, it gives no guarantee, and a layout with *nearly* no crossings is a
// layout that will grow one the next time a node is added — silently, because
// nothing fails.
//
// So the drawn graph is restricted to a shape where crossings are **impossible**.
// Two rules do it, and between them they are the whole geometry:
//
// 1. **Every process line stays inside its own lane's horizontal band.** Lanes
//    are the alternative methods filling one slot; they are stacked, and their
//    bands are disjoint. A line therefore cannot meet a line in another lane.
// 2. **Within one lane, the columns a process spans are disjoint from the columns
//    its neighbours span.** Column ranks strictly increase along a lane, so two
//    processes in one lane occupy `[c0,c1)` and `[c1,c2)` and share only an
//    endpoint — the state circle they both touch.
//
// The one thing that could still cross is the vertical tie that says two lanes
// are holding the same object. It is drawn **between adjacent lanes only**, so it
// lives in the gap between two bands, and the gap is empty by construction. A tie
// between lane 0 and lane 2 across a lane 1 that spans the column is not drawn —
// the state's own page carries that fact instead. Silence there is a real cost
// and it is the price of the guarantee.
//
// `process-layout.test.ts` asserts the property directly rather than trusting
// this comment: every pair of drawn segments is checked for overlap. D90.8's bar
// applies — a layout test that passes is not evidence until something
// known-broken fails it.
//
// ## Why this is not `strand-layout.ts` with different shapes
//
// The strand canvas drew a **containment** picture: a slot is a lens, the methods
// filling it are lanes inside the lens, and a method's steps are smaller lenses
// inside the lane. It is faithful to the data and the owner's verdict on it was
// that it is hard to read — bubbles inside bubbles, lines through bubbles, and
// the routes that skip a layer drawn as dotted arcs that follow the thing they
// skip.
//
// This module draws the same data as a **path**. The move that makes it possible
// is `states.ts`: once a slot's contract names the object at each end, a slot is
// the line between two named things rather than a container, a method is another
// line between the same two things, and a route that skips a layer is simply a
// line that spans further. Nothing is drawn dotted to mean "skips"; it skips by
// being longer. That was the owner's argument and it is correct.
//
// ## Server-rendered, and that is architectural
//
// D90.3 unchanged and it is the reason this is a pure function in `lib/` rather
// than a component: no `window`, no `document`, no measurement API. Every shape
// gets an `href` in the HTML that arrives from the origin, so the map is
// crawlable, `curl`-checkable, works with JavaScript off, and is testable without
// a browser. Text is measured by character class, over-estimating Latin, because
// a low guess puts a Japanese label outside its own circle.
import {
  capabilityOutlook,
  isCapability,
  layerNode,
  methodsRealizing,
  routeOf,
  stepsOutlook,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
  type Route,
} from "./layers.ts";
import { layerState, stateSatisfies, type StateVocabulary } from "./states.ts";

/** Every tunable in one place, because the test file asserts against them. */
export const PROCESS_METRICS = {
  /** A state circle's radius. The label sits beside it, not in it. */
  stateRadius: 9,
  /**
   * A state's name sits **below** its circle, not beside it.
   *
   * Beside was drawn first and it collides by construction: the name extends
   * rightward into the run, the process's own name is centred over that run just
   * above the line, and two 12px boxes eleven pixels apart overlap. Nothing in
   * the geometry noticed, because the overlap is between two `<text>` elements
   * and every invariant was about lines and circles. Below the circle, the two
   * label bands are on opposite sides of the line and cannot meet.
   */
  stateLabelBand: 24,
  stateLabelMax: 200,
  /** The shortest a process line may be drawn, before its label is considered. */
  minRun: 64,
  /** Slack around a process label so the line is legible under it. */
  runLabelPad: 26,
  /** Between two lanes filling the same slot. */
  laneGap: 26,
  /** A lane carries its method's name in a band above its line. */
  laneLabelBand: 34,
  /** A lane with ingredients reserves a band below its line for them. */
  feedBand: 19,
  feedGap: 14,
  /** A single un-expanded process line's own band. */
  edgeBand: 22,
  /** Around the whole canvas. */
  margin: 30,
  /** Between two root processes stacked on the overview. */
  stackGap: 46,
  /** Font sizes the width estimate assumes. Must match the stylesheet. */
  processFont: 12,
  stateFont: 12,
  feedFont: 11,
} as const;

/**
 * Width of a string, without a DOM. Carried over from `strand-layout.ts`
 * unchanged, including the deliberate Latin over-estimate — guessing high makes
 * a shape slightly too wide, guessing low pushes a Japanese label outside it.
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let ems = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6);
    ems += wide ? 1 : 0.53;
  }
  return ems * fontSize;
}

/** Shorten to fit, and say so. The full text always rides in a `<title>`. */
export function fitLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
): { text: string; truncated: boolean } {
  if (estimateTextWidth(text, fontSize) <= maxWidth) return { text, truncated: false };
  const characters = [...text];
  let kept = "";
  for (let index = 0; index < characters.length; index += 1) {
    const next = kept + characters[index];
    if (estimateTextWidth(next + "…", fontSize) > maxWidth) break;
    kept = next;
  }
  return { text: kept.trimEnd() + "…", truncated: true };
}

/**
 * What a drawn process is, and the four readings are four different claims.
 *
 * Same rule as `FascicleState` and for the same reason: a slot drawn shut
 * because you have not opened it and a slot nothing fills are opposite
 * statements about how complete the graph is, and a reader who cannot tell them
 * apart is being told the corpus is fuller than it is. D90.6, carried forward.
 */
export type ProcessState =
  /** Could be opened and is not — there are recorded ways through it. */
  | "collapsed"
  /** A method's own work, or a method nothing decomposes. Nothing to open. */
  | "leaf"
  /** A slot no recorded method fills. Deliberately not the same shape as shut. */
  | "unfilled";

/**
 * An opened slot. **Not a line** — which is the whole reason it is a separate
 * type rather than a fourth `ProcessState`.
 *
 * The first draft kept an opened slot in `processes` with its own `x0..x1` at
 * the group's centre line, and that line ran horizontally straight through every
 * lane drawn inside it. It was invisible in the numbers because nothing compared
 * a line against a lane, and it is exactly the crossing the owner asked not to
 * exist. Once a slot is opened, the thing on the canvas is the region its
 * alternatives occupy; the name goes above the region, and there is no line.
 */
export interface ProcessGroup {
  kind: "group";
  capabilityId: string;
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  methodCount: number;
  depth: number;
}

export interface StateBox {
  kind: "state";
  stateId: string;
  /** Unique per occurrence — the same state drawn on three lanes is three boxes. */
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  cx: number;
  cy: number;
  r: number;
  column: number;
  /** Set on the two ends of the diagram, which are drawn heavier. */
  terminal: "entry" | "exit" | null;
}

export interface ProcessBox {
  kind: "process";
  /** The slot filling this hop, or null when a method does this part itself. */
  capabilityId: string | null;
  /** Set when this is a method — either its own work, or a lane in an expansion. */
  methodId: string | null;
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  /** The straight run. `y` is the line; the label sits above it. */
  x0: number;
  x1: number;
  y: number;
  /** A slot is drawn thick, a method thin. The owner's distinction. */
  weight: "slot" | "method";
  state: ProcessState;
  /** Real count, printed even when collapsed — never a silent cap. */
  methodCount: number;
  /** How deep in the expansion this sits. 0 is the top line. */
  depth: number;
  /** For a method line: whether the graph says it bottoms out or nobody looked. */
  outlook: "decomposed" | "atomic" | "undecomposed" | null;
}

/**
 * A vertical tie saying two neighbouring lanes are holding the same object.
 *
 * `relation` is not decoration. `same` means the identical state; `kind` means
 * one is a narrower kind of the other — a Hermitian generator beside a general
 * linear one — and conflating them would claim two routes meet where one merely
 * specialises the other.
 */
export interface KinshipTie {
  x: number;
  y0: number;
  y1: number;
  relation: "same" | "kind";
  aStateId: string;
  bStateId: string;
}

/**
 * The name of one alternative, above the row it occupies.
 *
 * Separate from `ProcessBox` because a lane is not a hop: a route built entirely
 * from named slots has no segment of its own to hang its name on, and the first
 * draft left four rows on the canvas that a reader could not tell apart. It sits
 * in its own band above the line so it never competes with the labels on the
 * processes below it.
 */
export interface LaneLabel {
  methodId: string;
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  x: number;
  y: number;
  outlook: "decomposed" | "atomic" | "undecomposed";
  coverage: "delegated" | "partly-own" | "all-own";
}

/** An ingredient a route needs, hanging below the lane that consumes it. */
export interface FeedStub {
  capabilityId: string;
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  href: string;
  x: number;
  y0: number;
  y1: number;
}

export interface ProcessDiagram {
  width: number;
  height: number;
  states: readonly StateBox[];
  /** Drawn lines only. An opened slot is a `group`, not a line — see `ProcessGroup`. */
  processes: readonly ProcessBox[];
  groups: readonly ProcessGroup[];
  lanes: readonly LaneLabel[];
  ties: readonly KinshipTie[];
  feeds: readonly FeedStub[];
  /** Slots that could be opened and are not. Surfaced so the page can say so. */
  collapsedCount: number;
  depthCap: number;
}

type Locale = "en" | "ja";

interface Options {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  locale: Locale;
  /** Capability ids the reader has opened. */
  open: ReadonlySet<string>;
  depthCap: number;
}

// --- measure -------------------------------------------------------------
//
// Two passes, as in `strand-layout.ts` and for the same reason: a box cannot be
// placed until its children's sizes are known, and a child cannot be placed
// until its parent has chosen an origin. Sizes first, bottom-up; positions
// second, top-down.

interface Measured {
  width: number;
  /** Total vertical footprint, label band and feed band included. */
  height: number;
  /** Where the line sits inside that footprint, measured from the top. */
  lineOffset: number;
}

interface LaneMeasure {
  method: LayerMethod;
  route: Route;
  measured: Measured;
  /** Column rank of each state in `route.states`. Strictly increasing. */
  ranks: readonly number[];
  segments: readonly Measured[];
  /** Whether each segment is drawn expanded. */
  expanded: readonly boolean[];
}

function labelOf(node: { label: string; labelJa: string }, locale: Locale): string {
  return locale === "ja" ? node.labelJa : node.label;
}

function summaryOf(node: { summary: string; summaryJa: string }, locale: Locale): string {
  return locale === "ja" ? node.summaryJa : node.summary;
}

/**
 * Column ranks for one set of lanes, so that a state shared by two lanes lands
 * in the same column and the tie between them is vertical.
 *
 * Longest path from the entry, by relaxation rather than a topological sort:
 * the union of the lanes' chains is a DAG in every case the authored graph
 * produces, but this function is reached from a route handler and must be total,
 * and relaxation saturates on a cycle instead of recursing forever. On
 * saturation it falls back to positional ranks, which are always strictly
 * increasing within a lane and merely stop aligning across them.
 */
export function columnRanks(lanes: readonly (readonly string[])[]): {
  ranks: number[][];
  columns: number;
} {
  const rank = new Map<string, number>();
  for (const lane of lanes) for (const state of lane) rank.set(state, 0);

  const limit = rank.size + 1;
  let changed = true;
  let passes = 0;
  while (changed && passes < limit) {
    changed = false;
    passes += 1;
    for (const lane of lanes) {
      for (let index = 1; index < lane.length; index += 1) {
        const previous = rank.get(lane[index - 1]!)!;
        const here = rank.get(lane[index]!)!;
        if (here < previous + 1) {
          rank.set(lane[index]!, previous + 1);
          changed = true;
        }
      }
    }
  }

  // Saturated: the union has a cycle, so shared columns are not available and
  // each lane is ranked by position instead. Strict increase is preserved, which
  // is the property the no-crossing guarantee actually rests on.
  const saturated = changed;
  const ranks = lanes.map((lane) =>
    saturated ? lane.map((_, index) => index) : lane.map((state) => rank.get(state)!),
  );

  // Every lane ends at the same place, so every lane's last state is pinned to
  // the final column. Without this a two-step lane finishes three columns short
  // of a five-step sibling and the two exits are different circles.
  const last = Math.max(0, ...ranks.map((lane) => lane[lane.length - 1] ?? 0));
  for (const lane of ranks) if (lane.length > 0) lane[lane.length - 1] = last;

  return { ranks, columns: last + 1 };
}

/**
 * How much of a column one state occurrence claims.
 *
 * The name is centred under the circle, so the column has to be as wide as
 * whichever is bigger — and a little wider still, or two neighbouring columns'
 * names touch even though their circles do not.
 */
function stateWidth(vocabulary: StateVocabulary, id: string, locale: Locale): number {
  const state = layerState(vocabulary, id);
  const text = state ? labelOf(state, locale) : id;
  const label = Math.min(
    estimateTextWidth(text, PROCESS_METRICS.stateFont),
    PROCESS_METRICS.stateLabelMax,
  );
  return Math.max(PROCESS_METRICS.stateRadius * 2, label) + 14;
}

function processRunWidth(text: string): number {
  return Math.max(
    PROCESS_METRICS.minRun,
    estimateTextWidth(text, PROCESS_METRICS.processFont) + PROCESS_METRICS.runLabelPad,
  );
}

/** Is this slot drawn opened at this depth? */
function isOpen(id: string, depth: number, options: Options): boolean {
  return options.open.has(id) && depth < options.depthCap;
}

function measureProcess(capabilityId: string, depth: number, options: Options): Measured {
  const node = layerNode(options.graph, capabilityId);
  if (!node || !isCapability(node)) {
    return { width: PROCESS_METRICS.minRun, height: PROCESS_METRICS.edgeBand, lineOffset: PROCESS_METRICS.edgeBand / 2 };
  }
  const collapsed: Measured = {
    width: processRunWidth(labelOf(node, options.locale)),
    height: PROCESS_METRICS.edgeBand,
    lineOffset: PROCESS_METRICS.edgeBand / 2,
  };
  if (!isOpen(capabilityId, depth, options)) return collapsed;

  const { lanes } = measureLanes(node, depth, options);
  if (lanes.length === 0) return collapsed;

  const width = Math.max(collapsed.width, ...lanes.map((lane) => lane.measured.width));
  const height =
    lanes.reduce((total, lane) => total + lane.measured.height, 0) +
    PROCESS_METRICS.laneGap * (lanes.length - 1);
  return { width, height, lineOffset: height / 2 };
}

/**
 * The lanes of one slot, and the column geometry they were measured against.
 *
 * The geometry is returned rather than recomputed by the placement pass, and
 * that is a correctness fix rather than tidying. `placeLanes` used to derive its
 * own runs by spreading the leftover width evenly across the gaps, discarding
 * the per-run widths measured here — so a hop that needed more than the average
 * overran into its neighbour. It was caught by a mutation test at depth 3 in
 * `ja`, 50px into the next run. One measurement, one placement.
 */
interface LaneGeometry {
  lanes: LaneMeasure[];
  columnWidths: number[];
  runs: number[];
  columns: number;
}

function measureLanes(
  capability: LayerCapability,
  depth: number,
  options: Options,
): LaneGeometry {
  const methods = methodsRealizing(options.graph, capability.id);
  if (methods.length === 0) return { lanes: [], columnWidths: [], runs: [], columns: 0 };

  const routes = methods.map((method) => routeOf(options.graph, options.vocabulary, method));
  const { ranks, columns } = columnRanks(routes.map((route) => route.states));

  // Column widths and the runs between them are shared across every lane, so a
  // state in column 2 is at the same x on all of them — which is what makes the
  // vertical tie vertical.
  const columnWidth: number[] = [];
  routes.forEach((route, laneIndex) => {
    route.states.forEach((stateId, index) => {
      const column = ranks[laneIndex]![index]!;
      columnWidth[column] = Math.max(
        columnWidth[column] ?? 0,
        stateWidth(options.vocabulary, stateId, options.locale),
      );
    });
  });

  const segmentMeasures: Measured[][] = [];
  const expandedFlags: boolean[][] = [];
  routes.forEach((route, laneIndex) => {
    const measures: Measured[] = [];
    const flags: boolean[] = [];
    for (const segment of route.segments) {
      if (segment.capabilityId === null) {
        const method = methods[laneIndex]!;
        measures.push({
          width: processRunWidth(labelOf(method, options.locale)),
          height: PROCESS_METRICS.edgeBand,
          lineOffset: PROCESS_METRICS.edgeBand / 2,
        });
        flags.push(false);
        continue;
      }
      measures.push(measureProcess(segment.capabilityId, depth + 1, options));
      flags.push(isOpen(segment.capabilityId, depth + 1, options));
    }
    segmentMeasures.push(measures);
    expandedFlags.push(flags);
  });

  // Runs between adjacent columns, widened until every segment fits the span it
  // crosses. Narrow spans are satisfied first, so widening a run for a long span
  // can never invalidate a short one — one pass in that order is enough.
  const runs: number[] = new Array(Math.max(0, columnWidth.length - 1)).fill(PROCESS_METRICS.minRun);
  const spans: { from: number; to: number; width: number }[] = [];
  routes.forEach((route, laneIndex) => {
    route.segments.forEach((_, index) => {
      spans.push({
        from: ranks[laneIndex]![index]!,
        to: ranks[laneIndex]![index + 1]!,
        width: segmentMeasures[laneIndex]![index]!.width,
      });
    });
  });
  spans.sort((a, b) => a.to - a.from - (b.to - b.from));
  for (const span of spans) {
    let available = 0;
    for (let column = span.from; column < span.to; column += 1) available += runs[column] ?? 0;
    for (let column = span.from + 1; column < span.to; column += 1) available += columnWidth[column] ?? 0;
    const deficit = span.width - available;
    if (deficit <= 0) continue;
    const share = deficit / (span.to - span.from);
    for (let column = span.from; column < span.to; column += 1) runs[column] = (runs[column] ?? 0) + share;
  }

  const totalWidth =
    columnWidth.reduce((total, width) => total + width, 0) +
    runs.reduce((total, run) => total + run, 0);

  const lanes = methods.map((method, laneIndex) => {
    const route = routes[laneIndex]!;
    const measures = segmentMeasures[laneIndex]!;
    const tallest = Math.max(PROCESS_METRICS.edgeBand, ...measures.map((measure) => measure.height));
    // One row per ingredient. The first draft gave them all the same `y` and
    // nudged `x` by six pixels each, so three ingredients on one route drew on
    // top of each other — caught by the label-collision invariant, which is the
    // whole reason that invariant exists.
    const feedRoom =
      route.feeds.length > 0
        ? PROCESS_METRICS.feedGap + route.feeds.length * PROCESS_METRICS.feedBand + 6
        : 0;
    return {
      method,
      route,
      ranks: ranks[laneIndex]!,
      segments: measures,
      expanded: expandedFlags[laneIndex]!,
      measured: {
        width: totalWidth,
        height:
          PROCESS_METRICS.laneLabelBand + tallest + PROCESS_METRICS.stateLabelBand + feedRoom,
        lineOffset: PROCESS_METRICS.laneLabelBand + tallest / 2,
      },
    };
  });
  return { lanes, columnWidths: columnWidth, runs, columns };
}

// --- place ---------------------------------------------------------------

interface Canvas {
  states: StateBox[];
  processes: ProcessBox[];
  groups: ProcessGroup[];
  lanes: LaneLabel[];
  ties: KinshipTie[];
  feeds: FeedStub[];
  collapsed: { count: number };
}

/**
 * Where a state circle links to.
 *
 * A state is a thing with a page, like a slot and a method, and the three share
 * one namespace under `/repository/layers/` — `validateLayerGraph` rejects a
 * collision between them, so one id is one address.
 */
export function stateHref(id: string): string {
  return `/repository/layers/${id}`;
}

/**
 * Where a process line links to, and the two destinations are deliberately
 * different — carried over from the strand canvas, where it worked.
 *
 * A **slot** navigates: it re-centres the map on itself, opened, with its own
 * alternatives fanned out. A **method** reads: it links to its write-up.
 *
 * Drilling down rather than nesting in place, which is the owner's own model
 * (*"clicking into something puts people in zoomed in view which they can easily
 * escape from to get back to the last layer they were in"*) and also the only
 * one that holds the no-overlap guarantee. Expanding a slot *inside* a lane puts
 * the parent's own circles on a line that runs through the middle of the nested
 * block, and their names — drawn centred and wide — spill sideways into it. The
 * label-collision invariant found nine of those at depth 2. One level at a time
 * has no such case, and the rail's Path is the way back up.
 */
export function slotHref(id: string, _open: ReadonlySet<string>, _focus: string | null): string {
  return `/repository/layers?view=map&focus=${encodeURIComponent(id)}`;
}

function placeStates(
  lane: LaneMeasure,
  columnCentres: readonly number[],
  columnWidths: readonly number[],
  y: number,
  options: Options,
  canvas: Canvas,
  laneKey: string,
  terminalsAt: { entry: number; exit: number } | null,
): StateBox[] {
  const boxes: StateBox[] = [];
  lane.route.states.forEach((stateId, index) => {
    const column = lane.ranks[index]!;
    const state = layerState(options.vocabulary, stateId);
    const full = state ? labelOf(state, options.locale) : stateId;
    const fitted = fitLabel(full, PROCESS_METRICS.stateFont, PROCESS_METRICS.stateLabelMax);
    const terminal =
      terminalsAt === null
        ? null
        : column === terminalsAt.entry
          ? "entry"
          : column === terminalsAt.exit
            ? "exit"
            : null;
    const box: StateBox = {
      kind: "state",
      stateId,
      key: `${laneKey}:s${index}`,
      label: fitted.text,
      fullLabel: full,
      labelTruncated: fitted.truncated,
      summary: state ? summaryOf(state, options.locale) : "",
      href: stateHref(stateId),
      cx: columnCentres[column]!,
      cy: y,
      r: PROCESS_METRICS.stateRadius,
      column,
      terminal,
    };
    boxes.push(box);
    canvas.states.push(box);
  });
  return boxes;
}

function placeProcess(
  capabilityId: string,
  x0: number,
  x1: number,
  y: number,
  depth: number,
  options: Options,
  canvas: Canvas,
  key: string,
  focus: string | null,
): void {
  const node = layerNode(options.graph, capabilityId);
  if (!node || !isCapability(node)) return;
  const methods = methodsRealizing(options.graph, capabilityId);
  const open = isOpen(capabilityId, depth, options);
  const unfilled = capabilityOutlook(options.graph, capabilityId) === "open";

  const full = labelOf(node, options.locale);
  const fitted = fitLabel(full, PROCESS_METRICS.processFont, Math.max(24, x1 - x0 - 10));
  const expanded = open && methods.length > 0 && !unfilled;

  if (expanded) {
    // A region, not a line. The measure pass already knows how tall the lanes
    // will stack, and the two must agree or the name sits over the wrong band —
    // the same discipline the strand engine needed for its depth predicate.
    const measured = measureProcess(capabilityId, depth, options);
    canvas.groups.push({
      kind: "group",
      capabilityId,
      key,
      label: fitted.text,
      fullLabel: full,
      labelTruncated: fitted.truncated,
      summary: summaryOf(node, options.locale),
      href: slotHref(capabilityId, options.open, focus),
      x0,
      x1,
      top: y - measured.height / 2,
      bottom: y + measured.height / 2,
      methodCount: methods.length,
      depth,
    });
    placeLanes(node, x0, x1, y, depth, options, canvas, key, focus);
    return;
  }

  const state: ProcessState = unfilled ? "unfilled" : "collapsed";
  if (state === "collapsed") canvas.collapsed.count += 1;

  canvas.processes.push({
    kind: "process",
    capabilityId,
    methodId: null,
    key,
    label: fitted.text,
    fullLabel: full,
    labelTruncated: fitted.truncated,
    summary: summaryOf(node, options.locale),
    href: slotHref(capabilityId, options.open, focus),
    x0,
    x1,
    y,
    weight: "slot",
    state,
    methodCount: methods.length,
    depth,
    outlook: null,
  });
}

function placeLanes(
  capability: LayerCapability,
  x0: number,
  x1: number,
  y: number,
  depth: number,
  options: Options,
  canvas: Canvas,
  key: string,
  focus: string | null,
): void {
  const { lanes, columnWidths, runs, columns } = measureLanes(capability, depth, options);
  if (lanes.length === 0) return;

  // The runs the measure pass computed, stretched proportionally to whatever
  // span this slot was actually given. Proportional rather than uniform: a hop
  // carrying a 430px name and a hop carrying a three-letter one need different
  // amounts of the slack, and spreading it evenly is what used to push the wide
  // one 50px into its neighbour.
  const totalColumns = columnWidths.reduce((total, width) => total + width, 0);
  const measuredRuns = runs.reduce((total, run) => total + run, 0);
  const available = Math.max(0, x1 - x0 - totalColumns);
  const scale = measuredRuns > 0 ? available / measuredRuns : 0;
  const placedRuns = runs.map((run) => run * scale);

  const centres: number[] = [];
  let cursor = x0;
  for (let column = 0; column < columns; column += 1) {
    centres.push(cursor + (columnWidths[column] ?? 0) / 2);
    cursor += (columnWidths[column] ?? 0) + (placedRuns[column] ?? 0);
  }

  const stackHeight =
    lanes.reduce((total, lane) => total + lane.measured.height, 0) +
    PROCESS_METRICS.laneGap * (lanes.length - 1);
  let top = y - stackHeight / 2;

  const perLaneStates: StateBox[][] = [];
  lanes.forEach((lane, laneIndex) => {
    const lineY = top + lane.measured.lineOffset;
    const laneKey = `${key}/${lane.method.id}`;
    const laneFull = labelOf(lane.method, options.locale);
    const laneFitted = fitLabel(laneFull, PROCESS_METRICS.processFont, Math.max(60, x1 - x0 - 8));
    canvas.lanes.push({
      methodId: lane.method.id,
      key: `${laneKey}:name`,
      label: laneFitted.text,
      fullLabel: laneFull,
      labelTruncated: laneFitted.truncated,
      summary: summaryOf(lane.method, options.locale),
      href: `/repository/layers/${lane.method.id}`,
      x: x0,
      y: lineY - PROCESS_METRICS.edgeBand / 2 - 12,
      outlook: stepsOutlook(lane.method),
      coverage: lane.route.coverage,
    });
    const states = placeStates(
      lane,
      centres,
      columnWidths,
      lineY,
      options,
      canvas,
      laneKey,
      { entry: 0, exit: columns - 1 },
    );
    perLaneStates.push(states);

    lane.route.segments.forEach((segment, index) => {
      const from = states[index]!;
      const to = states[index + 1]!;
      const sx0 = from.cx + from.r;
      const sx1 = to.cx - to.r;
      if (segment.capabilityId === null) {
        const method = lane.method;
        const full = labelOf(method, options.locale);
        const fitted = fitLabel(full, PROCESS_METRICS.processFont, Math.max(24, sx1 - sx0 - 10));
        canvas.processes.push({
          kind: "process",
          capabilityId: null,
          methodId: method.id,
          key: `${laneKey}:own${index}`,
          label: fitted.text,
          fullLabel: full,
          labelTruncated: fitted.truncated,
          summary: summaryOf(method, options.locale),
          href: `/repository/layers/${method.id}`,
          x0: sx0,
          x1: sx1,
          y: lineY,
          weight: "method",
          state: "leaf",
          methodCount: 0,
          depth: depth + 1,
          outlook: stepsOutlook(method),
        });
        return;
      }
      placeProcess(
        segment.capabilityId,
        sx0,
        sx1,
        lineY,
        depth + 1,
        options,
        canvas,
        `${laneKey}:${segment.capabilityId}`,
        focus,
      );
    });

    // Ingredients hang below the lane's own line, inside its band, so they
    // cannot reach another lane.
    lane.route.feeds.forEach((feedId, index) => {
      const node = layerNode(options.graph, feedId);
      if (!node) return;
      const full = labelOf(node, options.locale);
      const fitted = fitLabel(full, PROCESS_METRICS.feedFont, PROCESS_METRICS.stateLabelMax);
      // Stacked at the lane's left edge, one per row. Which process consumes an
      // ingredient is not recorded, so hanging it under a particular hop would
      // assert something the graph does not say; it belongs to the route.
      canvas.feeds.push({
        capabilityId: feedId,
        key: `${laneKey}:feed${index}`,
        label: fitted.text,
        fullLabel: full,
        labelTruncated: fitted.truncated,
        summary: summaryOf(node, options.locale),
        href: `/repository/layers/${feedId}`,
        x: x0,
        y0: lineY + PROCESS_METRICS.stateLabelBand,
        y1:
          lineY +
          PROCESS_METRICS.stateLabelBand +
          PROCESS_METRICS.feedGap +
          index * PROCESS_METRICS.feedBand,
      });
    });

    top += lane.measured.height + PROCESS_METRICS.laneGap;
  });

  // Vertical ties, adjacent lanes only. The gap between two bands is empty by
  // construction, which is exactly why the tie may be drawn there and nowhere
  // else. See the header.
  for (let laneIndex = 1; laneIndex < perLaneStates.length; laneIndex += 1) {
    const above = perLaneStates[laneIndex - 1]!;
    const below = perLaneStates[laneIndex]!;
    for (const a of above) {
      // The two ends are one circle conceptually and are already aligned; a tie
      // there would be a line between a thing and itself.
      if (a.terminal !== null) continue;
      const b = below.find((candidate) => candidate.column === a.column && candidate.terminal === null);
      if (!b) continue;
      const same = a.stateId === b.stateId;
      const kin =
        stateSatisfies(options.vocabulary, a.stateId, b.stateId) ||
        stateSatisfies(options.vocabulary, b.stateId, a.stateId);
      if (!same && !kin) continue;
      canvas.ties.push({
        x: a.cx,
        y0: a.cy + a.r,
        y1: b.cy - b.r,
        relation: same ? "same" : "kind",
        aStateId: a.stateId,
        bStateId: b.stateId,
      });
    }
  }
}

/**
 * One slot, drawn as the line between its two states, opened as far as `open`
 * and `depthCap` allow.
 */
export function layoutProcessMap(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  rootId: string,
  locale: Locale,
  open: ReadonlySet<string>,
  depthCap: number,
): ProcessDiagram {
  const options: Options = { graph, vocabulary, locale, open, depthCap };
  const node = layerNode(graph, rootId);
  const canvas: Canvas = {
    states: [],
    processes: [],
    groups: [],
    lanes: [],
    ties: [],
    feeds: [],
    collapsed: { count: 0 },
  };
  if (!node || !isCapability(node)) {
    return {
      width: 0,
      height: 0,
      states: [],
      processes: [],
      groups: [],
      lanes: [],
      ties: [],
      feeds: [],
      collapsedCount: 0,
      depthCap,
    };
  }

  // `node` is a capability by the guard above, and a capability's contract is a
  // required field — so this is `node.contract` rather than `contractFor(...)!`,
  // which routes through the method-oriented own-vs-inherited API only to assert
  // away a null that branch can never return.
  const contract = node.contract;
  const measured = measureProcess(rootId, 0, options);
  const entryWidth = stateWidth(vocabulary, contract.from, locale);
  const exitWidth = stateWidth(vocabulary, contract.to, locale);
  const width = PROCESS_METRICS.margin * 2 + entryWidth + measured.width + exitWidth;
  const height = PROCESS_METRICS.margin * 2 + Math.max(measured.height, PROCESS_METRICS.edgeBand);
  const midY = height / 2;

  const entry = terminalState(contract.from, PROCESS_METRICS.margin, entryWidth, midY, "entry", options, "root");
  const exit = terminalState(
    contract.to,
    width - PROCESS_METRICS.margin - exitWidth,
    exitWidth,
    midY,
    "exit",
    options,
    "root",
  );
  // Drawn only when the root is shut. Once it opens, every lane carries its own
  // first and last circle — and those are not all the same object: one route
  // ends holding a state proportional to the solution, another holds a circuit
  // for e^{-iHt}. A single terminal over the top of them would assert they all
  // arrive at the same place, which is exactly the overclaim the gap analysis
  // exists to prevent.
  const rootOpen = isOpen(rootId, 0, options) && methodsRealizing(graph, rootId).length > 0;
  if (!rootOpen) canvas.states.push(entry, exit);

  placeProcess(
    rootId,
    entry.cx + entry.r,
    exit.cx - exit.r,
    midY,
    0,
    options,
    canvas,
    `root:${rootId}`,
    rootId,
  );

  return {
    width,
    height,
    states: canvas.states,
    processes: canvas.processes,
    groups: canvas.groups,
    lanes: canvas.lanes,
    ties: canvas.ties,
    feeds: canvas.feeds,
    collapsedCount: canvas.collapsed.count,
    depthCap,
  };
}

/**
 * One of the two ends of the whole map.
 *
 * Centred in the width its column reserved, not placed a radius in from the
 * left. A name is drawn centred *under* its circle, so left-anchoring the
 * circle pushes half the name off the canvas — which is what the first draft did
 * to `Nonlinear initial-value problem`, by 58px.
 */
function terminalState(
  stateId: string,
  left: number,
  reserved: number,
  y: number,
  terminal: "entry" | "exit",
  options: Options,
  keyPrefix: string,
): StateBox {
  const state = layerState(options.vocabulary, stateId);
  const full = state ? labelOf(state, options.locale) : stateId;
  const fitted = fitLabel(full, PROCESS_METRICS.stateFont, PROCESS_METRICS.stateLabelMax);
  return {
    kind: "state",
    stateId,
    key: `${keyPrefix}:${terminal}`,
    label: fitted.text,
    fullLabel: full,
    labelTruncated: fitted.truncated,
    summary: state ? summaryOf(state, options.locale) : "",
    href: stateHref(stateId),
    cx: left + reserved / 2,
    cy: y,
    r: PROCESS_METRICS.stateRadius + 2,
    column: terminal === "entry" ? -1 : Number.MAX_SAFE_INTEGER,
    terminal,
  };
}
