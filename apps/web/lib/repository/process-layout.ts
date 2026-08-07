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
  isMethod,
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
  /** A state circle's radius. Its name is in a tooltip and has no extent here. */
  stateRadius: 9,
  /**
   * Slack either side of a state circle so two adjacent ones do not touch.
   *
   * This replaced a 24px label band and a 200px name allowance. Both existed
   * because a state's name was drawn on the canvas, and the comment they carried
   * is worth keeping because it is the reason the name is not drawn any more:
   * the name was first placed *beside* the circle, where it extended rightward
   * into the run while the process's own name sat centred over that run just
   * above the line — two 12px boxes eleven pixels apart, overlapping. Nothing in
   * the geometry noticed, because the overlap was between two `<text>` elements
   * and every invariant was about lines and circles. Moving it below the circle
   * fixed that pair and created the sideways spill that made in-place expansion
   * undrawable. A name with no extent has neither failure.
   */
  stateGap: 14,
  /**
   * Room below a lane's line for the bottom of its circles, and for a tie to
   * leave one. Was `stateLabelBand: 24`, which was the name's room; a circle of
   * radius 9 needs less, and the lane heights come down with it.
   */
  stateBelow: 14,
  /** An ingredient's name is still drawn, so it still needs a ceiling. */
  feedLabelMax: 200,
  /** The shortest a process line may be drawn, before its label is considered. */
  minRun: 64,
  /** Slack around a process label so the line is legible under it. */
  runLabelPad: 26,
  /** Between two lanes filling the same slot. */
  laneGap: 26,
  /** A lane carries its method's name in a band above its line. */
  laneLabelBand: 34,
  /**
   * An opened slot carries its own name, and has to own the room it uses.
   *
   * It did not, and nothing noticed while only one slot could ever be open: the
   * name was drawn at `top - 5`, five pixels *outside* the measured box, into
   * space that at depth 0 is the canvas margin and therefore free. The moment a
   * slot could open inside another, that space belonged to an ancestor's lane
   * name, and the deep-nesting sweep found 40 of those collisions on the
   * authored graph.
   *
   * Reserved on **both** sides rather than only the top. The band below is slack
   * nothing draws in, and buying it costs one number; the alternative is an
   * asymmetric box, and `lineOffset` and `tallest/2` are computed in three places
   * that each assume a segment is centred on its own line.
   */
  groupLabelBand: 18,
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
  /**
   * The zoomed figure's own name, top right. Larger than everything on the
   * canvas because it is the one piece of text that names the whole picture
   * rather than a part of it.
   */
  captionFont: 13,
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
 * An opened slot: still a span, still a separate type from a drawn line.
 *
 * The history is worth keeping because it is what changed. The first draft kept
 * an opened slot in `processes` with its own `x0..x1` at the group's centre line,
 * and that line ran horizontally straight through every lane drawn inside it —
 * invisible in the numbers, because nothing compared a line against a lane, and
 * exactly the crossing the owner asked not to exist. Session 92's answer was to
 * stop drawing the line at all and paint a **region** behind the lanes instead.
 *
 * The owner's answer is better and is what ships now: *"the straight original
 * process line turns into a faint line, and there are muscle strand-shapes lines
 * around it."* The line comes back, faint, and it no longer crosses anything —
 * because the lanes converge onto its two endpoints rather than being stacked
 * independently across its span, so the faint line and the strands around it are
 * two drawings of the same journey between the same two circles.
 *
 * This stays a distinct type because a group is a *span with a height*, and a
 * `ProcessBox` is a span at a `y`. The renderer derives the spine from
 * `(top + bottom) / 2`, which is the `y` the slot would have had.
 */
export interface ProcessGroup {
  kind: "group";
  capabilityId: string;
  key: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  summary: string;
  /**
   * Where the **name** goes: this slot's own page.
   *
   * `null` on the zoomed figure's own root, and the absence is what stops the
   * name being drawn at all. A page that draws its own title inside its own
   * picture, linking to itself, is a link a reader can only lose by following —
   * so the name moves to the caption and the shape keeps only the spine.
   */
  href: string | null;
  /** Where the **faint line** goes: the same map with this slot shut again. */
  closeHref: string | null;
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
  /**
   * The name, whole — there is no truncated twin, because it is never drawn.
   *
   * Every other box here carries a `label`/`fullLabel` pair, one fitted to the
   * space and one for the `<title>`. A state has only the second: its name lives
   * in the tooltip, and a tooltip has no width to fit to. Keeping a `label` field
   * that nothing renders would be an invitation to render it.
   */
  fullLabel: string;
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
  /**
   * Where the **line** goes: the same map with this slot toggled open.
   *
   * `null` on a method, and that absence is the point. A method has no ways
   * through it, so there is nothing for a click on its line to open — and a
   * shape that looks like a control but is not one is worse than no control.
   * The name is still a link; only the line stops being one.
   */
  href: string | null;
  /** Where the **name** goes: this process's own page. Never null. */
  pageHref: string;
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

/**
 * The whole figure's own name, top right.
 *
 * *"…with the original process label in the top right like the strand
 * visualization"* — owner, session 92. It is a caption rather than a shape: it
 * names the picture, it is not a thing in it, and nothing on the canvas links to
 * it. It is measured and placed here rather than in the renderer for the reason
 * every other name on this surface is — the collision sweep reads the geometry,
 * and a name the geometry does not know about is a name nothing checks.
 *
 * `null` on the map, which has no single subject to name.
 */
export interface DiagramCaption {
  /** Fitted to the canvas. The full text rides in a `<title>`, as everywhere. */
  text: string;
  fullText: string;
  truncated: boolean;
  /** The **right** edge: this is drawn `text-anchor="end"`. */
  x: number;
  /** Baseline. */
  y: number;
  /** What kind of thing the figure is about — a slot, or one way through one. */
  kind: "slot" | "method";
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
  /** Set on a zoomed figure, never on the map. See `DiagramCaption`. */
  caption: DiagramCaption | null;
}

type Locale = "en" | "ja";

interface Options {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  locale: Locale;
  /** Capability ids the reader has opened. */
  open: ReadonlySet<string>;
  depthCap: number;
  /**
   * The percentage the reader chose to draw this at, or `null` for "fit".
   *
   * The layout does not scale — the geometry is identical at every size, and the
   * SVG's `viewBox` does the scaling. This is here for one reason: every href
   * the canvas emits has to carry it, or the first click undoes it.
   */
  zoom: number | null;
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
 * How much of a column one state occurrence claims: the circle, and nothing else.
 *
 * It used to be the **name**, centred under the circle and reserved up to
 * `stateLabelMax` = 200px wide. That single number was most of the canvas — the
 * four-route ODE map came out 1,811px across inside an 868px column, so a reader
 * scrolled sideways through a picture whose point is that you can see it at once.
 * It is also what made in-place expansion impossible: every one of the nine
 * depth-2 collisions session 92 found was a wide centred state name spilling into
 * a neighbour.
 *
 * The name is in `<title>` now, on the owner's brief. A name in a tooltip has no
 * extent on the canvas, so a column is the circle plus enough slack that two
 * adjacent circles are not touching.
 *
 * `vocabulary`, `id` and `locale` stay in the signature: this is a per-occurrence
 * measurement and the day a state gets a mark of its own — a badge, a differently
 * sized dot — it will need to know which state it is measuring.
 */
function stateWidth(_vocabulary: StateVocabulary, _id: string, _locale: Locale): number {
  return PROCESS_METRICS.stateRadius * 2 + PROCESS_METRICS.stateGap;
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
  const stack =
    lanes.reduce((total, lane) => total + lane.measured.height, 0) +
    PROCESS_METRICS.laneGap * (lanes.length - 1);
  // The lanes are centred on the slot's line by `placeLanes`, so the band its own
  // name needs is reserved at both ends to keep the box symmetric about that line.
  const height = stack + PROCESS_METRICS.groupLabelBand * 2;
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
          PROCESS_METRICS.laneLabelBand + tallest + PROCESS_METRICS.stateBelow + feedRoom,
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
 * Where the **name** on a process links to: its own page, always.
 *
 * *"Clicking on the label of a process zooms in… but clicking on the line
 * expands the line within the page/visualization itself."* — owner, session 92.
 * Two shapes, two verbs, and this is the reading one. It never depends on what
 * is open, so it is the same address from every state of the map — which is what
 * makes it the thing to link to from elsewhere.
 */
export function processPageHref(id: string): string {
  return `/repository/layers/${id}`;
}

/**
 * Where the **line** on a slot links to: the same map with that slot toggled.
 *
 * This is the owner's *"expands the line within the page/visualization itself
 * without any more granular zooming in… everything else still in view"*, and it
 * is a set rather than a single id because they were explicit that opening one
 * thing must not close another: *"they can still click on process lines on
 * whatever zoomed in layer you are in to see more connections without rendering
 * a layer deeper."*
 *
 * Session 92 shipped this as `?focus=` — one id, replacing whatever was open —
 * and rejected in-place expansion because *"expanding a slot inside a lane puts
 * the parent's own circles on a line that runs through the middle of the nested
 * block, and their names — drawn centred and wide — spill sideways into it. The
 * label-collision invariant found nine of those at depth 2."*
 *
 * **That diagnosis named the labels, and the labels are now gone.** A state's
 * name moved into `<title>` on the owner's brief, `stateWidth` no longer reserves
 * a column for it, and the nine collisions were every one of them a name against
 * something else. `?focus=` survives as the zoom level; `?open=` is what a line
 * toggles inside it.
 *
 * Returns `null` when there is nothing to toggle — a method has no ways through
 * it, so its line is not a control and must not be drawn as one.
 */
export function slotHref(
  id: string,
  open: ReadonlySet<string>,
  focus: string | null,
  /**
   * The size the reader chose, carried through.
   *
   * **The rule, and it has no exceptions: the size belongs to the page it was
   * set on.** Everything that stays there carries it — every toggle, the close
   * link, the "all four" link, the rail's path back up. Nothing that leaves
   * carries it: a name goes to a different subject at a different natural width,
   * where "fit" is the right first look, and a circle goes to a state page that
   * draws no canvas at all, where a size would be a URL making a promise the
   * page cannot keep.
   *
   * A toggle that dropped it would zoom the map back out under a reader every
   * time they opened a line — the control would appear to work once and then
   * undo itself, which is worse than not having one.
   */
  zoom: number | null = null,
): string {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  const params: string[] = ["view=map"];
  if (focus !== null) params.push(`focus=${encodeURIComponent(focus)}`);
  if (zoom !== null) params.push(`zoom=${zoom}`);
  // Sorted so one arrangement of the map has exactly one URL: two readers who
  // opened the same three slots in different orders must be able to compare
  // links, and a cache must not hold the same page twice.
  for (const openId of [...next].sort()) params.push(`open=${encodeURIComponent(openId)}`);
  return `/repository/layers?${params.join("&")}`;
}

/**
 * The sizes a reader may ask for, as percentages.
 *
 * A short ladder rather than a slider, and that is D88.2 rather than taste: a
 * slider is a control that only works after hydration, so it has no address —
 * nothing to link, send, bookmark or check with `curl`. Five rungs and "fit" is
 * six links, and any of the six can be pasted to somebody else.
 *
 * Bounded at both ends deliberately. Below 50% a 12px label is 6px and the
 * picture is not smaller, it is unreadable — which is the argument
 * `.mj-process-canvas`'s floor has always made, now made once rather than
 * enforced silently. Above 200% the scroll box is doing all the work and the
 * browser's own zoom is the better tool.
 */
export const MAP_ZOOMS = [50, 75, 100, 150, 200] as const;

export type MapZoom = (typeof MAP_ZOOMS)[number];

/**
 * `?zoom=` — the size the reader chose, or `null` for "fit".
 *
 * Validated against the ladder rather than clamped: `?zoom=17` is not a request
 * for 50%, it is a URL that does not name a rung, and the honest answer is the
 * default. Same rule `browse-params.ts` states for the Atlas deep links.
 */
export function resolveZoom(value: string | null): MapZoom | null {
  // Compared as strings, never through `Number()`. `Number(" 100")` is 100, and
  // `Number("1e2")` is 100 — so a coercing parser gives one arrangement of this
  // map three different URLs that all render identically, which is the thing
  // sorting `open` exists to prevent. One rung, one spelling, one address.
  return MAP_ZOOMS.find((rung) => String(rung) === value) ?? null;
}

/**
 * The map's address with a different size on it, and everything else kept.
 *
 * `slotHref` builds the same URL for the *toggle* direction; this is the size
 * direction. Both sort `open`, so one arrangement of the map is still one URL
 * whichever of the two got the reader there.
 */
export function zoomHref(
  focus: string | null,
  open: ReadonlySet<string>,
  zoom: MapZoom | null,
): string {
  const params: string[] = ["view=map"];
  if (focus !== null) params.push(`focus=${encodeURIComponent(focus)}`);
  if (zoom !== null) params.push(`zoom=${zoom}`);
  for (const id of [...open].sort()) params.push(`open=${encodeURIComponent(id)}`);
  return `/repository/layers?${params.join("&")}`;
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
      fullLabel: full,
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
    // A span with a height. The measure pass already knows how tall the lanes
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
      href: processPageHref(capabilityId),
      closeHref: slotHref(capabilityId, options.open, focus, options.zoom),
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
    // A slot with nothing recorded in it has nothing to open, so its line is not
    // a control. Only a shut slot with ways through it gets one.
    href: state === "collapsed" ? slotHref(capabilityId, options.open, focus, options.zoom) : null,
    pageHref: processPageHref(capabilityId),
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
      href: processPageHref(lane.method.id),
      x: x0,
      // Anchored to the **top of the lane's band**, where `laneLabelBand` reserved
      // the room, not to the lane's line. Those are 23px apart for a shallow lane
      // and they were the same expression, so nothing showed until a lane's
      // tallest segment became a whole nested expansion: `lineOffset` is
      // `laneLabelBand + tallest / 2`, so a 400px-tall nested slot put this
      // method's own name two hundred pixels down, in the middle of it.
      y: top + PROCESS_METRICS.laneLabelBand - 12,
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
        // A lane that is one segment of the method's own work has its name
        // written twice: once as the row's title, and again on the only line in
        // the row, five pixels below it. Forty-one of the graph's fifty-eight
        // methods are that shape — `get_page_text` reads them back as a list of
        // every method name twice through — so the line drops the name and keeps
        // the row's. Where a lane has *several* hops the name stays: there it is
        // not a repetition, it marks which hop the method does itself.
        const repeatsLane = lane.route.segments.length === 1;
        canvas.processes.push({
          kind: "process",
          capabilityId: null,
          methodId: method.id,
          key: `${laneKey}:own${index}`,
          label: repeatsLane ? "" : fitted.text,
          fullLabel: full,
          labelTruncated: repeatsLane ? false : fitted.truncated,
          summary: summaryOf(method, options.locale),
          // A method's own work: nothing under it to open, so the line is inert
          // and only the name is a link.
          href: null,
          pageHref: processPageHref(method.id),
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
      const fitted = fitLabel(full, PROCESS_METRICS.feedFont, PROCESS_METRICS.feedLabelMax);
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
        href: processPageHref(feedId),
        x: x0,
        // Same correction as the lane name, at the other edge. The room for these
        // is `feedRoom`, reserved at the **bottom** of the lane's band; hanging
        // them a fixed distance below the *line* put them inside the lane's own
        // content the moment that content was taller than one hop. The bottom of
        // that content is `lineY + tallest / 2`, and `tallest / 2` is exactly
        // `lineOffset - laneLabelBand` — derived rather than a second copy of the
        // formula `measureLanes` already computes.
        y0: lineY,
        y1:
          lineY +
          (lane.measured.lineOffset - PROCESS_METRICS.laneLabelBand) +
          PROCESS_METRICS.stateBelow +
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
  /**
   * Which slot the reader is standing in — the page's `?focus=`, not the root
   * being drawn. (It used to be called the canvas's "zoom level" here; `?zoom=`
   * below is now a real and different thing, so this says what it is.)
   *
   * It used to be `rootId`, passed down and then ignored, because `slotHref`
   * took the argument and never read it. Now that a line toggles rather than
   * drills, the difference is visible: on the four-root overview `focus` is
   * `null`, and passing the root instead would make every toggle navigate the
   * reader *into* that root — dropping the other three from the page, which is
   * the opposite of "everything else still in view".
   */
  focus: string | null = null,
  /** Carried into every href this canvas emits. See `slotHref`. */
  zoom: number | null = null,
): ProcessDiagram {
  const options: Options = { graph, vocabulary, locale, open, depthCap, zoom };
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
      caption: null,
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
    focus,
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
    caption: null,
  };
}

/**
 * One process, drawn on its own page: its two states, and the first level of it
 * between them.
 *
 * This is the other half of *"clicking on the label of a process zooms in"* —
 * the half session 93 shipped a link to and did not draw. The owner asked for
 * *"the first level of the process expanded with connection to the two states
 * before and after, with the original process label in the top right like the
 * strand visualization"*, and what arrives here is the map's own engine held at
 * depth one.
 *
 * ## Why it is the map's engine and not a second one
 *
 * The map's placement pass is what 174 fixed collisions were fixed *in*. A
 * second geometry for the same picture would be a second place for all of them
 * to come back, and nothing would compare the two — the same argument that keeps
 * the legend drawing the canvas's own classes rather than copies of them.
 *
 * So the differences are stated as differences, not re-derived:
 *
 * - **Depth one.** The reader asked for this process, not for the whole tree
 *   under it. Everything one level down is drawn shut, and the figcaption says
 *   how many.
 * - **No line is a control.** `?open=` is the map's address, and this page is not
 *   the map; a line that looked clickable here would either do nothing or
 *   navigate away from the page a reader just zoomed into. The names stay links,
 *   because a name has always gone to a page.
 * - **The subject does not name itself inside its own picture.** The zoomed
 *   node's own name is the caption, top right; its shape on the canvas keeps the
 *   spine and drops the label.
 *
 * ## A method is the same slot with one way through it
 *
 * A method has no lanes of its own — it *is* a lane. Rather than a second
 * placement pass for the one-lane case, the slot it fills is laid out through a
 * graph **lens** that hides the sibling methods (`soleMethodLens`). The engine
 * draws whatever the graph says fills a slot; restricting what fills it is how
 * one lane gets drawn by the code that already draws lanes. The lens is read-only
 * and local to this call, and it hides *only* siblings under the same slot —
 * every step, state and citation the lane reaches is the authored graph.
 */
export function layoutProcessZoom(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  id: string,
  locale: Locale,
): ProcessDiagram {
  const node = layerNode(graph, id);
  if (!node) return emptyDiagram();
  const capabilityId = isCapability(node) ? node.id : node.realizes;
  const lens = isCapability(node) ? graph : soleMethodLens(graph, node);
  const base = layoutProcessMap(
    lens,
    vocabulary,
    capabilityId,
    locale,
    new Set([capabilityId]),
    1,
    null,
  );
  if (base.width === 0) return emptyDiagram();
  return asZoom(base, id, labelOf(node, locale), isCapability(node) ? "slot" : "method");
}

function emptyDiagram(): ProcessDiagram {
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
    depthCap: 1,
    caption: null,
  };
}

/**
 * The graph with one slot's other methods hidden.
 *
 * Everything else — the method's own steps, the slots they name, the states, the
 * whole rest of the graph — is untouched. Only the set of ways through *this one
 * slot* is narrowed to the one being zoomed.
 */
function soleMethodLens(graph: LayerGraph, method: LayerMethod): LayerGraph {
  return {
    ...graph,
    nodes: graph.nodes.filter(
      (node) => node.id === method.id || !(isMethod(node) && node.realizes === method.realizes),
    ),
  };
}

/** The map's diagram, re-read as a figure about one thing. */
function asZoom(
  base: ProcessDiagram,
  selfId: string,
  captionText: string,
  kind: "slot" | "method",
): ProcessDiagram {
  const fitted = fitLabel(
    captionText,
    PROCESS_METRICS.captionFont,
    Math.max(60, base.width - PROCESS_METRICS.margin * 2),
  );
  return {
    ...base,
    // Nothing toggles on a page that is not the map. A method's line was already
    // inert for the same reason: a shape that looks like a control and is not one
    // is worse than no control.
    processes: base.processes.map((process) => ({ ...process, href: null })),
    groups: base.groups.map((group) =>
      group.capabilityId === selfId
        ? { ...group, label: "", labelTruncated: false, href: null, closeHref: null }
        : { ...group, closeHref: null },
    ),
    // The lane that *is* this page keeps its shape and loses its name — the
    // caption already says it, in bigger type, at the other end of the same line.
    lanes: base.lanes.filter((lane) => lane.methodId !== selfId),
    caption: {
      text: fitted.text,
      fullText: captionText,
      // Truncation costs nothing here and is worth saying plainly: the caption is
      // a repetition of the page's own `<h1>`, which is six lines above it and is
      // never cut. It is the only name on this surface where that is true.
      truncated: fitted.truncated,
      x: base.width - PROCESS_METRICS.margin,
      y: PROCESS_METRICS.margin - 12,
      kind,
    },
  };
}

/**
 * One of the two ends of the whole map.
 *
 * Still centred in the width its column reserved rather than placed a radius in
 * from the left. The original reason is gone — a name drawn centred under the
 * circle used to push half of `Nonlinear initial-value problem` off the canvas,
 * by 58px — but the reserved width is now symmetric slack around the circle, and
 * sitting in the middle of it is what keeps the margin even at both ends.
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
  return {
    kind: "state",
    stateId,
    key: `${keyPrefix}:${terminal}`,
    fullLabel: full,
    summary: state ? summaryOf(state, options.locale) : "",
    href: stateHref(stateId),
    cx: left + reserved / 2,
    cy: y,
    r: PROCESS_METRICS.stateRadius + 2,
    column: terminal === "entry" ? -1 : Number.MAX_SAFE_INTEGER,
    terminal,
  };
}
