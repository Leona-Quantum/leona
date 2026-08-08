// Convergence: several ways across, drawn between **one** circle and one circle
// — and openable in place, without leaving the figure.
//
// > *"several paths lead to the 'linear ODE system' state, so they should all
// > converge to that one state node, and then the options to lead out of it
// > should flow out of the state node."*
// > — owner, session-96 inbox
//
// > *"clicking a process line itself keeps the view but expands branches, while
// > clicking labels of processes induces the prezi functionality and zoom
// > in/atlas record rendering."*
// > — owner, session-100 inbox
//
// ## What was drawn before, and why it could not say this
//
// `process-layout.ts` draws one horizontal band per route and stacks the bands.
// A state on three routes is therefore three circles at the same x and three
// different y, joined — when they happen to be adjacent — by a dotted tie.
// `StateBox.key` says so outright: *"Unique per occurrence — the same state
// drawn on three lanes is three boxes."* Read on the live page 2026-08-08,
// `?focus=nonlinear-ode-solve` drew `nonlinear-ivp` **four** times,
// `linear-ivp` three times and `solution-answer` three times.
//
// That is not a rendering nicety. A picture in which the shared object appears
// once per route cannot show that the routes *share* it, and sharing it is the
// entire claim — it is what makes Carleman's exit and Schrödingerisation's
// entrance the same place, which is what makes the pair visible as a path
// nobody has published.
//
// ## Opening a line, and the measurement that decided how
//
// The obvious reading of "expand branches" is *fan out the alternatives*, and
// building only that would have been a mistake. Measured over the whole authored
// graph before any of this was written: of the 18 slots that draw, **2 draw a
// chain of states and 16 draw a fan of methods**, and of the 53 lines those 18
// figures drew between them, only **5 were slots**. A fan-only implementation
// would have made 5 lines respond to a click and left everything else inert —
// the same shape of failure as the sixteen slots that were addressable, blank
// and unlinked for three sessions.
//
// So a line opens two ways, they are different pictures, and the diagram records
// which one it drew (`ConvergeLane.opensInto`):
//
//   - a **slot** opens ACROSS, into a fan of the methods that fill it;
//   - a **method** opens ALONG, into the chain of steps it is made of, with the
//     ingredients it needs hanging off the side.
//
// As drawn today, the 18 figures come to **55 lines: 24 open, 1 is a run of
// named hops drawn open from the start, and 30 are leaves** the graph records
// nothing finer for. Those numbers are pinned in the test file rather than only
// stated here, because the second time this was measured it had changed: an
// earlier draft required a route to have two segments before it would open, and
// that made **twelve** methods inert whose entire recorded structure is the
// ingredients they consume. `hhl-qpe-inversion` names three steps, all three of
// them ingredients, and opened into nothing at all.
//
// ## The crossing-free argument, which survives nesting
//
// D96.2: **two process lines may share space only at a state circle they both
// genuinely touch, and nowhere else.** That is obtained by construction.
//
// Every line on this canvas is an *offset of some base cubic* — see
// `strand-geometry.ts`, which owns the arithmetic and its proof. The
// displacement is `3k·t(1−t)`: zero at both ends, affine in `k`, and it leaves x
// untouched. So any set of offsets of one base touches only at the two shared
// endpoints, and the whole question "do these two lines cross" reduces to "do
// their **bands** of bow values overlap", which is interval arithmetic on
// numbers this file has already computed.
//
// That is what makes nesting free. A strand is a band, not a line:
//
//   - shut, it is drawn as the region between the offsets at `bow ± half` — a
//     shape pinched to a point at each circle and thickest in the middle, which
//     is the owner's *"muscle strand-shapes lines"* falling out of the same law
//     rather than being drawn to resemble it;
//   - opened **across**, its band is partitioned among its alternatives, which
//     are offsets of the same base and therefore still cannot cross it or each
//     other;
//   - opened **along**, its spine is cut into pieces with `splitCubicEven` and
//     each piece is the base for one step. The pieces meet exactly, so a step
//     drawn inside a lane sits *on* that lane instead of near it.
//
// Lanes in different bundles occupy disjoint x-spans, so they can meet only at
// the circle they both touch. Sizing is therefore bottom-up: a strand asks its
// children how much band they need, and the bundle is as tall as its roots' bands
// summed. Nothing is placed before everything below it has been measured, which
// is why opening a slot pushes its neighbours apart instead of drawing over them.
//
// ## Server-rendered, unchanged
//
// D90.3 holds: pure function, no `window`, no measurement API, every shape gets
// an `href` that arrives from the origin. Text is measured by character class by
// the same estimator the other canvases use, so nothing here needs a DOM. What a
// reader has opened is in the URL (`?open=`), never in component state — a
// control that only works after hydration has no address (D88.2).
import { estimateTextWidth, fitLabel, stateHref } from "./process-layout.ts";
import {
  cubicPath,
  levelCubic,
  offsetCubic,
  peakOf,
  pointOn,
  splitCubicEven,
  strandOutline,
  bowDisplacement,
  controlHeight as controlHeightOf,
  type Cubic,
} from "./strand-geometry.ts";
import {
  expansionOf,
  laneFillers,
  methodFanOf,
  pathStanding,
  pathWitnesses,
  type BundleLane,
  type Expansion,
  type StateBundle,
} from "./state-graph.ts";
// `Crossing` below is this module's own type — a way IN and a way OUT of one
// shared circle, ready to render. `state-graph.ts` exports a `Crossing` too and
// it is a different thing: one (edge, filler) choice. Deliberately not shared,
// and named apart at the import so the two cannot be confused.
import type { Crossing as EdgeChoice } from "./state-graph.ts";
import {
  isCapability,
  layerNode,
  methodsRealizing,
  routeOf,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
} from "./layers.ts";
import { layerState, type StateVocabulary } from "./states.ts";
import type { PublicLocale } from "../public-locale.ts";

/** Tunables. Separate from PROCESS_METRICS so the old canvas cannot shift under this one. */
export const CONVERGE_METRICS = {
  stateRadius: 11,
  /**
   * A boundary *inside* an opened lane — the object one step hands to the next.
   *
   * Smaller than `stateRadius` and deliberately so: it is the same kind of thing
   * as the circles at the ends, met at a finer grain, and drawing it at the same
   * size would say the inside of one lane is as big a claim as the figure it
   * sits in.
   */
  innerStateRadius: 6,
  /** Half a top-level strand's thickness, at its thickest point. */
  strandHalf: 9,
  /** Room beside a strand for its own name. */
  labelBand: 13,
  /** Between two sibling strands. */
  laneGap: 10,
  /**
   * How far apart two lanes of a shut fan sit, at the peak.
   *
   * **Not an independent number**: it is `2·(strandHalf + labelBand) + laneGap`,
   * which is what the bottom-up sizing produces when every lane is a leaf. It is
   * written out because `laneOffsets` is the shut case in closed form and a
   * reader deserves to see the spacing rather than run the allocator in their
   * head — and `CONVERGE_METRICS` is asserted against in the test file, which is
   * where the two would be caught disagreeing.
   *
   * It was 30 once, which put a two-lane fan at ±11 on screen; read on the
   * rendered page the two ways into `linear-ivp` were almost a single line and
   * the convergence did not read as one.
   */
  laneBow: 54,
  /** Shortest a bundle may be drawn before its labels are considered. */
  minSpan: 150,
  /** Slack either side of a lane's label. */
  labelPad: 18,
  /** Room above and below the whole fan. */
  margin: 34,
  laneFont: 12,
  stateFont: 12,
  captionFont: 13,
  /** A lane's label sits this far off its own edge. */
  labelLift: 7,
  /**
   * How far an ingredient stub hangs off the strand that consumes it.
   *
   * An ingredient is not a stage — `hhl-qpe-inversion` needs a block-encoding
   * and a prepared |b⟩, and having them does not move the route along — so it is
   * drawn hanging off the line rather than as part of it. Long enough to read as
   * a separate thing, short enough that it does not become one.
   */
  feedRun: 18,
  /**
   * How much thinner a strand gets per level of nesting.
   *
   * A muscle reading rather than a decorative one: the fibres inside a fascicle
   * are thinner than the fascicle. It also does real work — the band a child is
   * allotted has to hold its taper *and* its name, and letting depth-3 strands
   * keep a depth-0 thickness is what makes a four-level figure a solid block.
   */
  depthTaper: 0.78,
  /**
   * The steepest a lane may leave or arrive at a circle, in degrees.
   *
   * The owner asked for two things and they are one constraint: *"distances
   * between states should increase as branches between them are opened out"*,
   * and *"no branch should be at such a steep angle that it becomes weird to
   * look at"*. A lane is a cubic whose x controls sit at exact thirds, so
   * `x(t) = x0 + span·t` and its displacement is `4·bow·t(1−t)` — which makes
   * the tangent `4·bow(1−2t)/span`, steepest at both ends, at exactly
   * `atan(4·|bow|/span)`. So capping the angle *is* the rule that widens a
   * column when a fan opens inside it: `span ≥ 4·|bow| / tan(cap)`.
   *
   * Measured before this existed, over all 18 figures fully opened: 186 of 337
   * lanes were past 45°, 90 past 60°, the steepest 79.1° — and four figures were
   * already past 45° *shut*, at 55 lines. Opening the widest fan (7 methods)
   * added 322px of height and **0px** of width, because `measure` took a `max`
   * over its children's label widths and nothing in the expression mentioned how
   * many of them there were.
   *
   * 45 rather than 30: at 30° the seven-method fan needs a 1040px column against
   * today's 392, which pushes `nonlinear-ode-solve` past 4000px wide and trades
   * the owner's complaint for a horizontal version of it.
   */
  maxLaneAngleDeg: 45,
} as const;

/**
 * The narrowest column in which a lane bowed this far off its base stays inside
 * `maxLaneAngleDeg`.
 *
 * `atan(4·|bow|/span)` is the tangent at a lane's end (see `maxLaneAngleDeg`),
 * so this inverts it: `span ≥ 4·|bow| / tan(cap)`. Exported because it is the
 * whole rule in one line and deserves a test that does not have to build a
 * figure to reach it.
 */
export function spanForBow(bow: number): number {
  const tan = Math.tan((CONVERGE_METRICS.maxLaneAngleDeg * Math.PI) / 180);
  return (4 * Math.abs(bow)) / tan;
}

/**
 * How deep a chain of deliberate clicks may go before the figure stops following.
 *
 * A ceiling, not a setting: nothing opens unless its id is in `?open=`, so what a
 * reader sees is what they asked for. The deepest chain the authored graph can
 * produce is slot → method → step → method, which is four, so this binds on a
 * hand-written URL rather than on a reader.
 */
export const CONVERGE_DEPTH_MAX = 4;

/**
 * How many things `?open=` may name at once.
 *
 * The parameter is user-supplied and drives a recursive layout, so it is
 * bounded, and the count over the cap is reported rather than dropped in
 * silence. Twenty-four is past anything a reader reaches by clicking — the
 * widest figure in the graph fully opened names fewer.
 */
export const CONVERGE_OPEN_MAX = 24;

/**
 * Which of a URL's `?open=` values this figure will honour, and how many it drops.
 *
 * Lives beside `CONVERGE_OPEN_MAX` because the number that enforces and the
 * number that is reported have to be one number, and because **both** surfaces
 * that draw this canvas now parse the parameter. The node page used to ignore
 * `?open=` entirely — verified on production, its `<svg>` was byte-identical
 * with and without one — so everything a reader had opened was silently thrown
 * away the moment they clicked a name to look at something closely.
 *
 * Unknown ids are skipped rather than rejected: a URL naming four things, one
 * of which has since been renamed, should open the other three.
 */
export function resolveOpenIds(
  values: readonly string[],
  known: (id: string) => boolean,
  reserved = 0,
): { open: Set<string>; dropped: number } {
  const open = new Set<string>();
  let dropped = 0;
  for (const value of values) {
    if (!known(value)) continue;
    if (open.has(value)) continue;
    if (open.size + reserved >= CONVERGE_OPEN_MAX) {
      dropped += 1;
      continue;
    }
    open.add(value);
  }
  return { open, dropped };
}

export type LaneStanding = "recorded" | "unpinned" | "unpublished";

/** What a line opens into, when it opens into anything. */
export type OpensInto = "ways" | "steps";

export interface ConvergeState {
  key: string;
  stateId: string;
  /** The name, for a `<title>`. Not drawn on the canvas — it has no extent. */
  label: string;
  cx: number;
  cy: number;
  r: number;
  href: string;
  /** True at the two ends of the whole figure. */
  terminal: boolean;
  /** How many lanes arrive here and how many leave — the convergence, as a number. */
  arriving: number;
  leaving: number;
  /**
   * 0 for the figure's own chain; deeper for a boundary inside an opened lane.
   *
   * Carried so the renderer can draw the two differently without inferring it
   * from the radius. A drawn size is a consequence; the depth is the fact.
   */
  depth: number;
}

export interface ConvergeLane {
  key: string;
  /**
   * The **spine**: the centre line of this strand, as SVG path data.
   *
   * Still the plain cubic it always was, and still what every geometric
   * invariant is asserted against — the crossing-free property is a property of
   * these curves, and the outline below is derived from it. Drawn faint when the
   * strand is open, hidden under the fill when it is shut.
   */
  d: string;
  /**
   * The **outline**: the tapered region between `bow ± half`, closed and
   * fillable. This is what a reader actually sees.
   */
  outline: string;
  x0: number;
  x1: number;
  yc: number;
  /** Signed bow height at the peak, relative to the figure's spine. */
  bow: number;
  /** Half the strand's thickness at its thickest point. */
  half: number;
  /** 0 for a lane of the figure's own bundles; deeper inside an opened lane. */
  depth: number;
  /**
   * The strand this one was drawn inside, or null at the figure's own level.
   *
   * Carried rather than recovered from the key. The keys *are* nested strings
   * and a reader can see the relationship in them, which is exactly why the
   * first draft of the test file recovered the parent by string matching and
   * paired `hhl-qpe-inversion` with the wrong one — a structure that is legible
   * to a person is not the same as a structure something can rely on.
   */
  parentKey: string | null;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  /** Where the label sits — clear of the strand's own edge. */
  labelX: number;
  labelY: number;
  /**
   * The node this line *is*, for `?open=` and for the zoom pairing.
   *
   * Null on the one shape that is nobody's node: the part of a route the method
   * performs itself, which has no id of its own because its id would be the
   * method's, and opening it would open its own parent.
   */
  nodeId: string | null;
  /**
   * Where clicking the **line** goes: this figure, with this line opened or shut.
   *
   * Null when nothing is recorded inside, and then the line is not a link at
   * all. That is deliberate and it is the map's own precedent: a line that
   * navigates somewhere when a reader expected it to expand teaches the wrong
   * rule about every other line on the canvas.
   */
  openHref: string | null;
  /** Where clicking the **name** goes: the thing's own page. */
  href: string;
  open: boolean;
  /** What is inside, whether or not it is open — so a shut line can say so. */
  inside: number;
  opensInto: OpensInto | null;
  standing: LaneStanding;
  /** Slot ids this lane crosses, in order. */
  slots: readonly string[];
  /** Named states strictly inside this lane. Drawn as circles once it is open. */
  interior: readonly string[];
  /** How many methods fill it — the fan-out one more click down. */
  ways: number;
}

/**
 * Which of the two questions this figure answers.
 *
 * `states` — every way across passes through these objects, so the circles
 * between the ends are dominators and the lanes are alternative runs between
 * them. `methods` — the graph records no interior object, so the lanes are the
 * recorded ways of filling this one slot. They are different claims and the page
 * has to say which one it is showing; conflating them would let a reader take
 * "three ways to estimate an observable" for "three objects every estimate
 * passes through".
 */
export type ConvergeGrain = "states" | "methods";

/**
 * An ingredient a route needs, hanging off the strand that consumes it.
 *
 * Drawn only inside an **opened** strand, because that is what asking to see the
 * inside of a method means. Measured on the authored graph: 27 ingredients
 * across 20 of the 29 decomposed methods — and before this existed, opening
 * `hhl-qpe-inversion` showed nothing at all, because all three of its steps are
 * ingredients rather than stages and `routeOf` therefore returned one segment.
 * A method whose whole recorded structure is its ingredients read as a method
 * with no recorded structure.
 */
export interface ConvergeFeed {
  key: string;
  /** The ingredient's own node id. */
  nodeId: string;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  href: string;
  /** The stub: from a point beside the strand, outward. */
  x: number;
  y0: number;
  y1: number;
  /** Which way the label sits, so the renderer does not re-derive it. */
  outward: 1 | -1;
  depth: number;
}

export interface ConvergeDiagram {
  width: number;
  height: number;
  states: readonly ConvergeState[];
  lanes: readonly ConvergeLane[];
  /** Ingredients hanging off opened strands. Empty until something is opened. */
  feeds: readonly ConvergeFeed[];
  /** The focused process's own name, drawn once. */
  caption: string;
  /** Nothing at all to draw: no interior states *and* nothing fills the slot. */
  empty: boolean;
  /** How many lanes on this figure no recorded source walks. */
  unpublishedCount: number;
  /** Lines with something recorded inside that the reader has not opened. */
  collapsedCount: number;
  /** What the circles between the ends mean. See `ConvergeGrain`. */
  grain: ConvergeGrain;
  /**
   * The path walk hit `PATH_LIMITS` and the picture is a subset, not the graph.
   *
   * Carried because `Expansion` has reported it since session 96 and **nothing
   * read it** — measured by grep, `truncated` and `chainConsistent` were
   * computed, returned, and dropped by the only consumer. That matters more than
   * it sounds: when `maxHops` bites, `expansionOf` returns
   * `atomicAtThisLevel: true`, which this surface renders as *"no finer
   * decomposition is recorded"* — a cap that bites is therefore indistinguishable
   * from a slot the literature has nothing finer for. It does not bite on
   * today's graph (max 4 paths, max 3 hops against limits of 400 and 8), and a
   * figure that says so is the only way that stays true.
   */
  truncated: boolean;
  /** The dominator order differs between paths, so the chain is not drawable as one line. */
  chainConsistent: boolean;
  /** A chain of clicks was cut short by `CONVERGE_DEPTH_MAX`. Reported, never silent. */
  depthCapped: boolean;
}

/**
 * The control-point offset that makes a cubic peak at exactly `bow`.
 *
 * Re-exported from `strand-geometry.ts` rather than restated. It used to live
 * here beside a second copy of the same law in `bowAt`, and the two drifted:
 * `bowAt` used `h = bow` while the emitter used `h = 4·bow/3`, so every
 * invariant sampled a curve three quarters the height of the one on screen.
 */
export const controlHeight = controlHeightOf;

/**
 * y of the **drawn** bow at parameter t, on a level base at height `yc`.
 *
 * Still exported and still true: a top-level bundle's base *is* level, so this
 * is the closed form of what `strand-geometry.ts` computes for the general case.
 * It is one line thick on purpose — it must never become a second derivation.
 */
export function bowAt(yc: number, bow: number, t: number): number {
  return yc + bowDisplacement(bow, t);
}

/**
 * Room to leave above and below the spine for a fan whose outermost bow is
 * `tallest`.
 *
 * The closed form for the shut case, which is what a reader arrives at. The
 * general figure is measured bottom-up instead — see `measure` — and the layout
 * asserts it never reserves less than this.
 */
export function reservedHalfHeight(tallest: number): number {
  const M = CONVERGE_METRICS;
  return tallest + M.labelLift + M.laneFont + M.stateRadius;
}

/**
 * The offsets a shut fan of `n` lanes takes, centred on the spine.
 *
 * Odd counts put one lane **straight through the middle**, which is the owner's
 * *"the original process line should be faint but remain in the middle — every
 * other process expanded from it should be around it, even an odd number"*.
 * Even counts straddle it, so the spine stays visible between the two innermost.
 *
 * This is the closed form of what `allocateBows` produces when every child is a
 * leaf of equal band, and the test file checks the two agree. Keeping it is not
 * redundancy: it is the one case a reader can verify by looking.
 */
export function laneOffsets(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const out: number[] = [];
  const mid = (n - 1) / 2;
  for (let index = 0; index < n; index += 1) out.push((index - mid) * CONVERGE_METRICS.laneBow);
  return out;
}

/**
 * Centre a row of siblings, each asking for its own half-band, around `centre`.
 *
 * The general allocator. Siblings are packed in order with `laneGap` between
 * them and the whole row is centred, so a fan of equal leaves comes out exactly
 * as `laneOffsets` — and a fan where one member has been opened pushes the
 * others outward by precisely the room that member now needs, rather than
 * drawing over them.
 */
export function allocateBows(halves: readonly number[], centre: number, gap: number): number[] {
  if (halves.length === 0) return [];
  const total =
    halves.reduce((sum, half) => sum + half * 2, 0) + gap * Math.max(0, halves.length - 1);
  const out: number[] = [];
  let cursor = centre - total / 2;
  for (const half of halves) {
    out.push(cursor + half);
    cursor += half * 2 + gap;
  }
  return out;
}

function labelOf(item: { label: string; labelJa: string }, locale: PublicLocale): string {
  return locale === "ja" ? item.labelJa : item.label;
}

/**
 * The address of this figure, with a given focus, a given set of things open,
 * and **where the reader is standing**.
 *
 * `at` is carried because leaving it out is what made the surface stop feeling
 * like one surface. Measured on production before this: of 83 links to
 * `/repository/layers*` on the overview, exactly 5 carried `at=` — the size
 * rungs, which set it deliberately — so every "open this line in place" click
 * silently threw the reader's pan and zoom away and re-rendered them at the
 * origin at 100%. The figure did stay put; the reader did not.
 *
 * Passed through as the raw parameter rather than parsed and reformatted. It
 * arrived as a string that `parseViewport` accepted and the only thing to do
 * with it is hand it back, so round-tripping it through a float would add a
 * second writer of one value for no gain.
 */
export function figureHref(focus: string | null, open: Iterable<string>, at?: string | null): string {
  const params = new URLSearchParams();
  if (focus) params.set("focus", focus);
  for (const id of open) params.append("open", id);
  if (at) params.set("at", at);
  const query = params.toString();
  return query ? `/repository/layers?${query}` : "/repository/layers";
}

/** `/repository/layers/<id>`, keeping where the reader is standing. */
export function nodeHref(id: string, at?: string | null): string {
  return at ? `/repository/layers/${id}?at=${encodeURIComponent(at)}` : `/repository/layers/${id}`;
}

/**
 * The address that opens — or shuts — one line, leaving everything else as it is.
 *
 * A set rather than one id, because the owner asked for exactly that: *"clicking
 * on the line expands the line within the page/visualization itself … with
 * everything else still in view."* One id would mean opening a second thing
 * shuts the first.
 */
export function toggleHref(
  focus: string | null,
  open: ReadonlySet<string>,
  id: string,
  at?: string | null,
): string {
  const next = new Set(open);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return figureHref(focus, next, at);
}

function laneName(
  graph: LayerGraph,
  lane: BundleLane,
  locale: PublicLocale,
): { text: string; href: string; slots: string[]; narrowedBy: string | null } {
  const slots = lane.edges.map((edge) => edge.slot);
  if (lane.edges.length === 1) {
    const node = layerNode(graph, slots[0]!);
    const edge = lane.edges[0]!;
    // A narrowed lane is that *filler's* line, not the slot's — it is the one
    // way through that lands somewhere narrower, and naming it after the slot
    // would say four routes take it when one does.
    if (edge.narrowedBy) {
      const filler = layerNode(graph, edge.narrowedBy);
      if (filler) {
        return {
          text: labelOf(filler, locale),
          href: `/repository/layers/${edge.narrowedBy}`,
          slots,
          narrowedBy: edge.narrowedBy,
        };
      }
    }
    return {
      text: node ? labelOf(node, locale) : slots[0]!,
      href: `/repository/layers/${slots[0]}`,
      slots,
      narrowedBy: null,
    };
  }
  // A multi-edge lane has no name of its own — it is a run of named processes,
  // and inventing a name for the composite is precisely the thing the owner
  // objected to. It is named by its hops instead, and drawn as them.
  const names = slots.map((slot) => {
    const node = layerNode(graph, slot);
    return node ? labelOf(node, locale) : slot;
  });
  return {
    text: names.join(" → "),
    href: `/repository/layers/${slots[0]}`,
    slots,
    narrowedBy: null,
  };
}

// ---------------------------------------------------------------------------
// The plan: what to draw, before anything knows where it goes.
// ---------------------------------------------------------------------------

/**
 * One strand, and what is recorded inside it.
 *
 * Built before any geometry so that sizing can run bottom-up: a strand's band
 * depends on its children's bands, and a child's band on its own children's.
 */
interface PlanStrand {
  key: string;
  /** What `?open=` names. Null on a shape with no node of its own. */
  id: string | null;
  label: string;
  href: string;
  standing: LaneStanding;
  open: boolean;
  /** How the children are drawn: across the strand, or along it. */
  layout: "fan" | "chain" | null;
  children: PlanStrand[];
  /** State ids between consecutive children, when chained. One fewer than children. */
  boundaries: string[];
  /** Counted whether or not it is open, so a shut line can say what it holds. */
  inside: number;
  opensInto: OpensInto | null;
  slots: readonly string[];
  interior: readonly string[];
  ways: number;
  /** Ingredients this strand consumes, drawn once it is open. */
  feeds: { id: string; label: string; href: string }[];
}

/**
 * What is recorded inside a slot: the methods that fill it, as a fan.
 *
 * Every one of them is `recorded` and that is not a default — a method node
 * exists *because* a source describes it, and validation refuses one carrying no
 * citation. So this fan can never manufacture the dashed "nobody has published
 * this" line, which belongs to compositions and not to a single filler.
 */
function fanInside(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  slotId: string,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  depth: number,
  seen: Set<string>,
  /**
   * The **parent's own key**, not the slot id.
   *
   * A key has to be unique across the whole figure and a node id is not: one
   * method can fill two different slots on one drawing, and one slot can be a
   * step of two different methods. Keyed by id alone, the second occurrence
   * silently replaced the first in every map built from these — including
   * React's — and the test that caught it was looking for something else
   * entirely, which is the usual way a duplicate key is found.
   */
  parentKey: string,
): { layout: "fan"; children: PlanStrand[]; count: number } | null {
  const methods = methodsRealizing(graph, slotId);
  if (methods.length === 0) return null;
  return {
    layout: "fan",
    count: methods.length,
    children: methods.map((method) =>
      planForMethod(graph, vocabulary, method, locale, open, depth, seen, `${parentKey}/`),
    ),
  };
}

/**
 * What is recorded inside a method: the steps it is made of, as a chain.
 *
 * `routeOf` rather than `steps`, and that difference is the whole reason this
 * reads correctly: `steps` is *what a route delegates*, unordered as a path and
 * missing the work the method does itself. `routeOf` walks it into states with
 * processes between them, files an ingredient as a feed rather than a stage, and
 * makes the method itself the last hop where the delegated steps do not reach
 * the exit — which is 23 of the 29 decomposed routes.
 *
 * Returns null for a single-segment route. One segment is the method being
 * itself, and drawing "inside" it would be drawing the same line again one level
 * down with a smaller name.
 */
function chainInside(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  method: LayerMethod,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  depth: number,
  seen: Set<string>,
  /** The parent's own key — see `fanInside`. */
  parentKey: string,
): { layout: "chain"; children: PlanStrand[]; boundaries: string[]; count: number } | null {
  const route = routeOf(graph, vocabulary, method);
  // A single segment is drawn too, now that a method may open for its
  // ingredients alone. It is one piece of curve exactly where the parent's spine
  // is, which is honest: this method's whole route is itself, and the things
  // hanging off it are what it needs.
  if (route.segments.length === 0) return null;
  const children = route.segments.map((segment, index) => {
    if (segment.capabilityId) {
      return planForSlot(
        graph,
        vocabulary,
        segment.capabilityId,
        locale,
        open,
        depth,
        seen,
        `${parentKey}/${index}/`,
      );
    }
    // The part of the route the method performs itself — 23 of the 29 decomposed
    // routes have one, and it is a real process, not a hole.
    //
    // It has no id of its own: its id would be the method's, so `?open=` could
    // not tell "open the method" from "open the piece of the method that is the
    // method". It **is** named, with the method's own name, and that is a
    // correction rather than a repetition — the opened lane above it draws no
    // name at all, so leaving this one nameless too would put an unlabelled
    // segment inside an unlabelled lane and give the reader nothing to read.
    return {
      key: `${parentKey}/${index}/own`,
      id: null,
      label: labelOf(method, locale),
      href: `/repository/layers/${method.id}`,
      standing: "recorded" as LaneStanding,
      open: false,
      layout: null,
      children: [],
      boundaries: [],
      inside: 0,
      opensInto: null,
      slots: [],
      interior: [],
      ways: 0,
      feeds: [],
    } satisfies PlanStrand;
  });
  return {
    layout: "chain",
    children,
    // `states` is entry first and exit last; the boundaries are what is between.
    boundaries: route.states.slice(1, -1),
    count: route.segments.length,
  };
}

function planForSlot(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  slotId: string,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  depth: number,
  seen: Set<string>,
  keyPrefix: string,
): PlanStrand {
  const node = layerNode(graph, slotId);
  const label = node ? labelOf(node, locale) : slotId;
  const methods = methodsRealizing(graph, slotId);
  // Recursion is cut two ways and both are reported rather than silent: the
  // depth cap, and having already drawn this node on the way down. The second is
  // not hypothetical paranoia — a slot whose method delegates back to the same
  // slot would otherwise expand until the cap, and the cap is the wrong reason
  // to stop.
  const canOpen = methods.length > 0 && depth < CONVERGE_DEPTH_MAX && !seen.has(slotId);
  const isOpen = canOpen && open.has(slotId);
  const key = `${keyPrefix}slot:${slotId}`;
  const inside = isOpen
    ? fanInside(graph, vocabulary, slotId, locale, open, depth + 1, new Set([...seen, slotId]), key)
    : null;
  return {
    key,
    id: methods.length > 0 ? slotId : null,
    label,
    href: `/repository/layers/${slotId}`,
    standing: "recorded",
    open: isOpen && inside !== null,
    layout: inside?.layout ?? null,
    children: inside?.children ?? [],
    boundaries: [],
    inside: methods.length,
    opensInto: methods.length > 0 ? "ways" : null,
    slots: [slotId],
    interior: [],
    ways: methods.length,
    feeds: [],
  };
}

function planForMethod(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  method: LayerMethod,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  depth: number,
  seen: Set<string>,
  keyPrefix: string,
): PlanStrand {
  const route = routeOf(graph, vocabulary, method);
  const segments = route.segments.length;
  const feeds = route.feeds.map((id) => {
    const node = layerNode(graph, id);
    return { id, label: node ? labelOf(node, locale) : id, href: `/repository/layers/${id}` };
  });
  // **Or `feeds`, not just `segments`.** Twelve of the twenty-nine decomposed
  // methods have exactly one segment and at least one ingredient — every step
  // they name is something they *need* rather than a stage they pass through —
  // and requiring two segments made all twelve of them inert. `hhl-qpe-inversion`
  // names three steps and opened into nothing at all.
  const holds = segments >= 2 || feeds.length > 0;
  const canOpen = holds && depth < CONVERGE_DEPTH_MAX && !seen.has(method.id);
  const isOpen = canOpen && open.has(method.id);
  const key = `${keyPrefix}method:${method.id}`;
  const inside = isOpen
    ? chainInside(
        graph,
        vocabulary,
        method,
        locale,
        open,
        depth + 1,
        new Set([...seen, method.id]),
        key,
      )
    : null;
  return {
    key,
    id: holds ? method.id : null,
    label: labelOf(method, locale),
    href: `/repository/layers/${method.id}`,
    standing: "recorded",
    // Open even when there is no chain to draw: the ingredients are the whole
    // of what a single-segment method has recorded, and they are worth drawing.
    open: isOpen && holds,
    layout: inside?.layout ?? null,
    children: inside?.children ?? [],
    boundaries: inside?.boundaries ?? [],
    inside: holds ? segments + feeds.length : 0,
    opensInto: holds ? "steps" : null,
    slots: [],
    interior: [],
    ways: 0,
    feeds: isOpen ? feeds : [],
  };
}

/**
 * A lane of the figure's own bundles, as a plan.
 *
 * Three shapes arrive here and they are not the same thing:
 *
 *  - a **narrowed** single-edge lane is one filler's own line, so it plans as
 *    that method;
 *  - a plain single-edge lane is the slot, and opens into the methods filling it;
 *  - a **multi-edge** lane is already a run of named processes. It is planned as
 *    a chain and drawn as one **without being asked**, because there is no id for
 *    `?open=` to name it by — its identity is the sequence — and because the
 *    alternative was a label reading `A → B`, which is a string describing a
 *    picture instead of the picture.
 */
function planForLane(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  lane: BundleLane,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  standing: LaneStanding,
): PlanStrand {
  const named = laneName(graph, lane, locale);
  if (lane.edges.length === 1) {
    const plan = named.narrowedBy
      ? planForNarrowed(graph, vocabulary, named.narrowedBy, locale, open, lane)
      : planForSlot(graph, vocabulary, lane.edges[0]!.slot, locale, open, 0, new Set(), `${lane.key}:`);
    return { ...plan, key: `${lane.key}:${plan.key}`, standing, interior: lane.interior };
  }
  const runKey = `run:${lane.key}`;
  const children = lane.edges.map((edge, index) =>
    planForSlot(graph, vocabulary, edge.slot, locale, open, 1, new Set(), `${runKey}/${index}/`),
  );
  return {
    key: runKey,
    id: null,
    label: named.text,
    href: named.href,
    standing,
    open: true,
    layout: "chain",
    children,
    boundaries: [...lane.interior],
    inside: lane.edges.length,
    opensInto: "steps",
    slots: named.slots,
    interior: lane.interior,
    ways: laneFillers(graph, lane).length,
    feeds: [],
  };
}

function planForNarrowed(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  methodId: string,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  lane: BundleLane,
): PlanStrand {
  const node = layerNode(graph, methodId);
  if (!node || node.kind !== "method") {
    return planForSlot(graph, vocabulary, lane.edges[0]!.slot, locale, open, 0, new Set(), `${lane.key}:`);
  }
  return planForMethod(graph, vocabulary, node, locale, open, 0, new Set(), `${lane.key}:`);
}

// ---------------------------------------------------------------------------
// Measurement: how much room does this strand and everything in it need?
// ---------------------------------------------------------------------------

/**
 * How much label width a column needs to hold a chain of `k` steps.
 *
 * `k × widest`, never the sum, and the reason is in `place`: each step is handed
 * an **equal** share of the column, so the column has to be wide enough for the
 * widest of them taken that many times. Summing would size the column for a
 * division the placement does not make, and the step with the longest name is
 * the one that would be clipped.
 *
 * Its own exported function because the authored graph does not currently
 * contain a chain whose steps are long enough for this to bite — mutating it to
 * plain `max` left every test on the real graph green. A rule that today's data
 * cannot exercise still has to be checkable, so it is checked as arithmetic
 * against the property it exists for rather than through a figure that happens
 * not to need it yet.
 */
export function chainColumnNeed(childNeeds: readonly number[]): number {
  if (childNeeds.length === 0) return 0;
  return childNeeds.length * Math.max(...childNeeds);
}

/** Half a strand's drawn thickness at `depth`. */
function halfAt(depth: number): number {
  return CONVERGE_METRICS.strandHalf * CONVERGE_METRICS.depthTaper ** depth;
}

interface Measure {
  /** Half the band this strand occupies, at the peak, in pixels. */
  vHalf: number;
  /**
   * How much **label width** everything inside this strand needs, unpadded.
   *
   * Unpadded on purpose, and this is the field the layout has now got wrong
   * twice. The column's span is this plus the padding; the budget a label is
   * fitted against is this number *itself*, carried, never `span − padding`.
   * `(w + 36) − 36` is not `w` in binary floating point, and the label that
   * loses that comparison by a ten-thousandth is always the widest one — the
   * very label the column was sized to hold. Measured on the second occurrence:
   * `quantum-linear-solve` in Japanese, budget `235.8`, need `235.8`, clipped to
   * *"チェビシェフ展開の LCU による行列の…"* in a column built precisely for it.
   */
  hFit: number;
  /**
   * The narrowest **column** in which everything drawn inside this strand stays
   * inside `maxLaneAngleDeg`.
   *
   * A second number rather than part of `hFit`, because `hFit` is the budget a
   * label is fitted against and that budget has to stay exactly the measured
   * label demand — the comment above it records two sessions where deriving it
   * a second way clipped the widest label in the column.
   *
   * It has to recurse, and two earlier attempts at avoiding that were wrong in
   * opposite directions. Capping each fan against its own spread misses that a
   * child is allocated around *its parent's* bow, so the offsets add. Capping
   * the whole column against its band height fixes that but misses the other
   * half: `place` gives a chain's step a `1/k` share of the column, so a bow one
   * step deep needs `k` times the room — the same multiplier, and for the same
   * reason, as `chainColumnNeed`.
   */
  hDev: number;
  /**
   * How much narrower than this whole strand the tightest slice inside it is.
   *
   * 1 for a leaf and for a fan — a fan's children are redrawn on the same
   * x-range. A chain of `k` steps multiplies it by `k`, because `place` gives
   * each step a `1/k` slice, so a bow drawn inside one has `1/k` of the run to
   * get there and needs `k` times the column to stay inside the cap.
   *
   * **Not exercised by the authored graph, and said out loud rather than left to
   * be discovered.** Mutating this line to a plain `max` leaves every test on
   * the real data green — the deepest compression today is 6x
   * (`quantum-linear-solve`, an `lcu-chebyshev-transform` step), but no fan puts
   * a chain far enough off its spine for the offset to need converting into that
   * chain's units. `hDev`'s own `k` *is* exercised (mutating it fails), so the
   * chain path is covered and this one factor of it is not. It is kept because
   * the shape that needs it is a fan of methods whose members are themselves
   * decomposed, which is exactly the VQE cluster the map is about to gain, and
   * because a bound that is right only for the graph that exists is not a bound.
   * Same reasoning, and the same honesty, as `chainColumnNeed` above.
   */
  hScale: number;
  children: Measure[];
}

function measure(strand: PlanStrand, depth: number): Measure {
  const M = CONVERGE_METRICS;
  const own = estimateTextWidth(strand.label, M.laneFont);
  if (!strand.open || strand.children.length === 0) {
    return { vHalf: halfAt(depth) + M.labelBand, hFit: own, hDev: 0, hScale: 1, children: [] };
  }
  const children = strand.children.map((child) => measure(child, depth + 1));
  // Ingredients hang past everything drawn inside, on one side, and their names
  // sit past that. Reserved symmetrically because the band model is symmetric —
  // costing a strand room on the side it does not use is cheaper than a second,
  // signed notion of "how tall is this".
  const feedRoom =
    strand.feeds.length > 0 ? M.innerStateRadius + M.feedRun + M.labelBand : 0;
  if (strand.layout === "chain") {
    // Children run one after another **along** this strand, so they share its
    // band and stack its width. The extra `innerStateRadius` is the boundary
    // circle between two of them, which sits on the spine and pokes out of the
    // widest child's band.
    //
    // `count × widest`, not the sum: `place` hands each step an equal share of
    // the column, so the column has to be wide enough for the widest of them
    // taken that many times. Summing would size the column for a division the
    // placement does not make, and the step with the longest name would be the
    // one clipped.
    return {
      vHalf:
        Math.max(...children.map((child) => child.vHalf)) +
        M.innerStateRadius +
        M.labelBand +
        feedRoom,
      hFit: Math.max(
        chainColumnNeed(children.map((child) => child.hFit)),
        ...strand.feeds.map((feed) => estimateTextWidth(feed.label, M.laneFont)),
      ),
      // A step sits *on* the spine — `place` hands it bow 0 — so a chain adds no
      // bow of its own. What it does is shrink the room: each step is drawn in a
      // `1/k` slice, so a demand made inside one is a demand for `k` times as
      // much column. Same multiplier, same reason, as `chainColumnNeed`.
      hDev: chainColumnNeed(children.map((child) => child.hDev)),
      hScale: chainColumnNeed(children.map((child) => child.hScale)),
      children,
    };
  }
  // A fan: children stack **across**, so their bands sum. The extra `labelBand`
  // is breathing room between an opened group and the siblings it has just
  // pushed apart — an opened strand draws no name of its own (see `place`).
  const spread =
    children.reduce((sum, child) => sum + child.vHalf * 2, 0) + M.laneGap * (children.length - 1);
  // The very offsets `place` will use, computed from the same allocator against
  // the same half-bands, so the bound is measured against the drawing rather
  // than against an idea of it.
  const offsets = allocateBows(children.map((child) => child.vHalf), 0, M.laneGap);
  return {
    vHalf: spread / 2 + M.labelBand,
    hFit: Math.max(own, ...children.map((child) => child.hFit)),
    // A child's bow off *this* base is this fan's offset for it plus whatever it
    // bows inside itself — the offsets add down the tree, which is the part two
    // earlier versions of this missed. `spanForBow` is linear in the bow, so the
    // sum can be carried as one number and converted to a width once, at the
    // column: a child's own demand is already in its slice's units, so the
    // offset has to be put into those units too before they add.
    hDev: Math.max(
      ...children.map((child, index) => Math.abs(offsets[index]!) * child.hScale + child.hDev),
    ),
    hScale: Math.max(...children.map((child) => child.hScale)),
    children,
  };
}

// ---------------------------------------------------------------------------
// Placement: turn the plan and its measurements into shapes.
// ---------------------------------------------------------------------------

interface Placement {
  lanes: ConvergeLane[];
  inner: ConvergeState[];
  feeds: ConvergeFeed[];
  /**
   * The furthest right anything reaches, including text.
   *
   * An ingredient's name is drawn from its stub *rightwards*, so unlike a lane
   * name — which is centred in a column sized to hold it — it can run past the
   * edge of the canvas. Read on production: `Amplify a success branc` inside a
   * viewport that clips, with no ellipsis to say it had been cut, which is the
   * silent-truncation failure in its smallest form. The width is stretched to
   * cover it after placement, which is safe because nothing else's position
   * depends on the total width.
   */
  rightmost: number;
  /** Ids already given a view-transition name, so no two elements claim one. */
  named: Set<string>;
  depthCapped: boolean;
  collapsed: number;
  unpublished: number;
}

function place(
  base: Cubic,
  strand: PlanStrand,
  size: Measure,
  bow: number,
  depth: number,
  context: {
    vocabulary: StateVocabulary;
    locale: PublicLocale;
    focusId: string | null;
    open: ReadonlySet<string>;
    out: Placement;
    columnFit: number;
    parentKey: string | null;
  },
): void {
  const M = CONVERGE_METRICS;
  const { out } = context;
  const half = halfAt(depth);
  const spine = offsetCubic(base, bow);
  const peak = peakOf(base, bow);

  // **An opened strand draws no name.** Not an oversight and not a style call.
  //
  // Every line on this canvas converges to a point at both circles, so the
  // vertical room between two neighbouring lines shrinks to nothing towards the
  // ends. A name is a box of fixed height sitting in that room, and the wider it
  // is, the further out it reaches into the part where there is none. A shut
  // strand's name is short and sits against its own edge, so it fits. An opened
  // strand's name would have to sit at the edge of its whole band — which is
  // exactly where its neighbour's band begins — and the first draft of this put
  // it there: measured on `?focus=nonlinear-ode-solve`, the curve of
  // `linear-ode-solve` ran straight through it.
  //
  // So an opened strand is named three other ways instead, none of which can
  // collide: the `<title>` on the faint spine that shuts it again, the row in
  // the list under the figure — which is the reading a screen reader and a
  // printout get — and the caption, once a reader zooms into it. The map canvas
  // reached the same conclusion about an opened group for its own reason.
  const outward = bow >= 0 ? 1 : -1;
  const labelY =
    outward > 0
      ? peak.y + half + M.labelLift + M.laneFont * 0.8
      : peak.y - half - M.labelLift;

  const fitted = strand.open
    ? { text: "", truncated: false }
    : fitLabel(strand.label, M.laneFont, context.columnFit);
  if (strand.standing === "unpublished") out.unpublished += 1;
  if (!strand.open && strand.inside > 0) out.collapsed += 1;
  if (depth >= CONVERGE_DEPTH_MAX && strand.inside > 0 && !strand.open) out.depthCapped = true;

  out.lanes.push({
    key: strand.key,
    d: cubicPath(spine),
    outline: strandOutline(base, bow, half),
    x0: base.x0,
    x1: base.x3,
    yc: base.y0,
    bow,
    half,
    depth,
    parentKey: context.parentKey,
    label: fitted.text,
    fullLabel: strand.label,
    labelTruncated: fitted.truncated,
    labelX: peak.x,
    labelY,
    nodeId: strand.id,
    openHref: strand.id ? toggleHref(context.focusId, context.open, strand.id) : null,
    href: strand.href,
    open: strand.open,
    inside: strand.inside,
    opensInto: strand.opensInto,
    standing: strand.standing,
    slots: strand.slots,
    interior: strand.interior,
    ways: strand.ways,
  });

  if (!strand.open || strand.children.length === 0) return;

  if (strand.layout === "chain") {
    const pieces = splitCubicEven(spine, strand.children.length);
    for (const [index, child] of strand.children.entries()) {
      place(pieces[index]!, child, size.children[index]!, 0, depth + 1, {
        ...context,
        parentKey: strand.key,
        // Each step gets its share of the column, so a chain of three names is
        // fitted against a third of the width rather than against all of it.
        columnFit: context.columnFit / strand.children.length,
      });
    }
    placeFeeds(base, strand, size, bow, depth, context);
    // The objects between the steps, sitting exactly where the pieces meet.
    for (let index = 1; index < strand.children.length; index += 1) {
      const stateId = strand.boundaries[index - 1];
      if (!stateId) continue;
      const at = pointOn(base, bow, index / strand.children.length);
      const named = layerState(context.vocabulary, stateId);
      out.inner.push({
        key: `${strand.key}@${index}`,
        stateId,
        label: named ? labelOf(named, context.locale) : stateId,
        cx: round(at.x),
        cy: round(at.y),
        r: M.innerStateRadius,
        href: stateHref(stateId),
        terminal: false,
        arriving: 1,
        leaving: 1,
        depth: depth + 1,
      });
    }
    return;
  }

  placeFeeds(base, strand, size, bow, depth, context);
  const bows = allocateBows(
    size.children.map((child) => child.vHalf),
    bow,
    M.laneGap,
  );
  for (const [index, child] of strand.children.entries()) {
    place(base, child, size.children[index]!, bows[index]!, depth + 1, {
      ...context,
      parentKey: strand.key,
    });
  }
}

/**
 * The ingredients an opened strand consumes, hanging clear of everything drawn
 * inside it.
 *
 * Spread over the strand rather than bunched at one end — `(index + 1) / (n + 1)`
 * puts one stub in the middle, two at a third and two thirds, and so on, which
 * is the same "leave the ends alone" rule the fan uses, and the ends are where
 * every line converges and there is no room.
 *
 * They hang **outward**, the way the strand already bows, so a stub never points
 * back through the figure's own spine.
 */
function placeFeeds(
  base: Cubic,
  strand: PlanStrand,
  size: Measure,
  bow: number,
  depth: number,
  context: { locale: PublicLocale; out: Placement; columnFit: number },
): void {
  if (strand.feeds.length === 0) return;
  const M = CONVERGE_METRICS;
  const outward: 1 | -1 = bow >= 0 ? 1 : -1;
  const inner = Math.max(0, ...size.children.map((child) => child.vHalf)) + M.innerStateRadius;
  for (const [index, feed] of strand.feeds.entries()) {
    const t = (index + 1) / (strand.feeds.length + 1);
    const at = pointOn(base, bow, t);
    const fitted = fitLabel(feed.label, M.laneFont, context.columnFit);
    context.out.rightmost = Math.max(
      context.out.rightmost,
      at.x + 4 + estimateTextWidth(fitted.text, M.laneFont),
    );
    context.out.feeds.push({
      key: `${strand.key}~${feed.id}`,
      nodeId: feed.id,
      label: fitted.text,
      fullLabel: feed.label,
      labelTruncated: fitted.truncated,
      href: feed.href,
      x: round(at.x),
      y0: round(at.y + outward * inner),
      y1: round(at.y + outward * (inner + M.feedRun)),
      outward,
      depth: depth + 1,
    });
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Lay out one focused slot as a chain of shared circles with fans between them,
 * with anything the reader has opened drawn in place.
 *
 * The chain is `expansionOf`'s dominator chain: the states every crossing must
 * pass. Each consecutive pair gets one circle each — **one**, shared by every
 * lane that touches it — and the ways across bow between them.
 */
/**
 * Put the reader's viewport back on an address this figure emitted.
 *
 * One writer for the whole diagram rather than an `at` threaded through the
 * nine places that build a `/repository/layers/...` string. Threading it would
 * mean nine call sites that each have to remember, and the ones that forgot
 * would be invisible — which is precisely how the parameter came to be on 5 of
 * 83 links in the first place.
 */
function withViewport(href: string | null, at?: string | null): string | null {
  if (!href || !at) return href;
  // Already addressed — the size rungs set their own `at` deliberately and must
  // win over the one the reader arrived with, or the control does nothing.
  if (href.includes("at=")) return href;
  return `${href}${href.includes("?") ? "&" : "?"}at=${encodeURIComponent(at)}`;
}

function carryViewport<T extends { href: string }>(shape: T, at?: string | null): T {
  return at ? { ...shape, href: withViewport(shape.href, at)! } : shape;
}

export function layoutConverge(options: {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  focus: LayerCapability;
  locale: PublicLocale;
  /** What the reader has opened. Ids of slots and of methods, from `?open=`. */
  open?: ReadonlySet<string>;
  /**
   * The `?focus=` the **page** is on, which is not always this figure's subject.
   *
   * Unfocused, the surface draws all four roots at once, and every open link on
   * those figures is a link back to this same page. Building it from the drawn
   * subject instead put `focus=<that root>` in it, so opening a line on the
   * overview quietly replaced the overview with one figure — the reader asked to
   * see inside a line and lost the other three drawings. Caught by following the
   * link on the built page, which is the only way it could have been: the href
   * is well-formed, it lands on a real page, and the page it lands on is a
   * perfectly good one that is not the one they were on.
   *
   * Defaults to the subject, which is right whenever there is only one figure.
   */
  focusParam?: string | null;
  /**
   * The reader's current `?at=`, carried onto every address this figure emits.
   *
   * Raw, as it arrived. A figure that forgets it re-renders the reader at the
   * origin on every click, which is most of what "it does not feel like one
   * continuous surface" turned out to be.
   */
  at?: string | null;
}): ConvergeDiagram {
  const { graph, vocabulary, focus, locale } = options;
  const focusParam = options.focusParam === undefined ? focus.id : options.focusParam;
  const open = options.open ?? new Set<string>();
  const M = CONVERGE_METRICS;
  const expansion: Expansion = expansionOf(graph, vocabulary, focus);
  const caption = labelOf(focus, locale);

  // Which picture this is. The state chain is asked for first and the method fan
  // is the answer only when there is no chain — never both, and the answer is
  // recorded on the diagram rather than inferred downstream from `lanes.length`.
  const plan =
    expansion.atomicAtThisLevel || expansion.bundles.length === 0
      ? planMethodFan(graph, vocabulary, focus, locale, open)
      : planStateChain(graph, vocabulary, expansion, locale, open);

  if (!plan) {
    return {
      width: 0,
      height: 0,
      states: [],
      lanes: [],
      feeds: [],
      caption,
      empty: true,
      unpublishedCount: 0,
      collapsedCount: 0,
      grain: "methods",
      truncated: expansion.truncated,
      chainConsistent: expansion.chainConsistent,
      depthCapped: false,
    };
  }

  // Measured before anything is placed, bottom-up: a bundle is as wide as its
  // widest strand wants and as tall as its strands' bands summed.
  const measured = plan.bundles.map((bundle) => bundle.lanes.map((lane) => measure(lane, 0)));

  // Each column's band, measured before its width — because the width now
  // depends on it. A band is how tall the column's lanes stack; the cap on how
  // steeply a lane may leave a circle turns that height into a minimum width.
  const bundleHalves = measured.map((lanes) => {
    if (lanes.length === 0) return 0;
    return (
      lanes.reduce((sum, lane) => sum + lane.vHalf * 2, 0) + M.laneGap * (lanes.length - 1)
    ) / 2;
  });

  const columns = measured.map((lanes) => {
    // One measurement, two uses — never two derivations. `fit` is the measured
    // demand itself; `span` is that demand plus the padding. Recovering `fit`
    // from `span` by subtracting the padding back off is the same arithmetic in
    // the wrong direction and it clips the widest label in the column, which is
    // how this was found the first time (12 of 18 figures, English) and the
    // second (`quantum-linear-solve`, Japanese).
    const need = Math.max(0, ...lanes.map((lane) => lane.hFit));
    // The geometric demand joins here and nowhere else. It widens the column and
    // deliberately does **not** widen `fit`: a fan that needs room to stay flat
    // has not earned its labels more characters, and letting it would make the
    // drawn text depend on how many siblings a line has.
    // The bundle's own lanes are spread across this column by the same
    // allocator, and that spread is subject to the same cap as any fan inside
    // one of them.
    const offsets = allocateBows(lanes.map((lane) => lane.vHalf), 0, M.laneGap);
    const spread = spanForBow(
      Math.max(
        0,
        ...lanes.map((lane, index) => Math.abs(offsets[index]!) * lane.hScale + lane.hDev),
      ),
    );
    return {
      span: Math.max(M.minSpan, need + M.labelPad * 2, spread),
      fit: Math.max(M.minSpan - M.labelPad * 2, need),
    };
  });
  const spans = columns.map((column) => column.span);
  // Never less than the closed form for the shut case. The two agree on a shut
  // figure by construction; this is the guard that says so if either moves.
  const tallestShut = plan.bundles.reduce(
    (tall, bundle) => Math.max(tall, Math.max(0, ...laneOffsets(bundle.lanes.length).map(Math.abs))),
    0,
  );
  const halfHeight = Math.max(
    reservedHalfHeight(tallestShut),
    Math.max(0, ...bundleHalves) + M.stateRadius,
  );
  const height = round(halfHeight * 2 + M.margin * 2 + M.captionFont + 8);
  const yc = round(M.margin + M.captionFont + 8 + halfHeight);

  // Rounded here, once, rather than at each `d` string. Every span is a float
  // sum of estimated text widths, so a circle centre came out
  // `392.64000000000016` while the path drawn between two of them said
  // `392.64`. The difference is invisible on screen and it is not invisible to
  // anything that asks whether a lane lands on a circle — the two numbers have
  // to *be* the same number, not agree to twelve places.
  const xs: number[] = [round(M.margin + M.stateRadius)];
  for (const span of spans) xs.push(round(xs[xs.length - 1]! + span));
  const width = round(xs[xs.length - 1]! + M.stateRadius + M.margin);

  const arriving = new Map<string, number>();
  const leaving = new Map<string, number>();
  for (const bundle of plan.bundles) {
    arriving.set(bundle.to, (arriving.get(bundle.to) ?? 0) + bundle.lanes.length);
    leaving.set(bundle.from, (leaving.get(bundle.from) ?? 0) + bundle.lanes.length);
  }

  const states: ConvergeState[] = plan.chain.map((stateId, index) => {
    const state = layerState(vocabulary, stateId);
    return {
      key: `s:${stateId}`,
      stateId,
      label: state ? labelOf(state, locale) : stateId,
      cx: xs[index]!,
      cy: yc,
      r: M.stateRadius,
      href: stateHref(stateId),
      terminal: index === 0 || index === plan.chain.length - 1,
      arriving: arriving.get(stateId) ?? 0,
      leaving: leaving.get(stateId) ?? 0,
      depth: 0,
    };
  });

  const out: Placement = {
    lanes: [],
    inner: [],
    feeds: [],
    named: new Set(),
    rightmost: 0,
    depthCapped: false,
    collapsed: 0,
    unpublished: 0,
  };

  for (const [index, bundle] of plan.bundles.entries()) {
    const base = levelCubic(xs[index]!, xs[index + 1]!, yc);
    const halves = measured[index]!.map((lane) => lane.vHalf);
    const bows = allocateBows(halves, 0, M.laneGap);
    for (const [at, lane] of bundle.lanes.entries()) {
      place(base, lane, measured[index]![at]!, bows[at]!, 0, {
        vocabulary,
        locale,
        focusId: focusParam,
        open,
        out,
        columnFit: columns[index]!.fit,
        parentKey: null,
      });
    }
  }

  return {
    // Stretched to cover any ingredient name that runs past the last circle.
    // Never shrunk: `width` is the tiled columns plus their margins, and that is
    // the minimum whatever the labels do.
    width: Math.max(width, round(out.rightmost + M.margin)),
    height,
    states: [...states, ...out.inner].map((state) => carryViewport(state, options.at)),
    lanes: out.lanes.map((lane) => ({
      ...carryViewport(lane, options.at),
      openHref: withViewport(lane.openHref, options.at),
    })),
    feeds: out.feeds.map((feed) => carryViewport(feed, options.at)),
    caption,
    empty: false,
    unpublishedCount: out.unpublished,
    collapsedCount: out.collapsed,
    grain: plan.grain,
    truncated: expansion.truncated,
    chainConsistent: expansion.chainConsistent,
    depthCapped: out.depthCapped,
  };
}

interface Plan {
  chain: readonly string[];
  bundles: readonly { from: string; to: string; lanes: readonly PlanStrand[] }[];
  grain: ConvergeGrain;
}

function planStateChain(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  expansion: Expansion,
  locale: PublicLocale,
  open: ReadonlySet<string>,
): Plan {
  return {
    chain: expansion.chain,
    grain: "states",
    bundles: expansion.bundles.map((bundle) => ({
      from: bundle.from,
      to: bundle.to,
      lanes: bundle.lanes.map((lane) =>
        planForLane(graph, vocabulary, lane, locale, open, standingFor(graph, vocabulary, lane)),
      ),
    })),
  };
}

/**
 * The slot's own two states, with one lane per method that fills it.
 *
 * `ways` is 0 rather than the method's step count. A step is not another way
 * *across this slot* — it is the inside of this one way — and putting it in the
 * field that renders "N ways through" would say there are three alternatives
 * where there is one method with three steps. What the method holds inside is
 * `inside`/`opensInto`, which say "steps" out loud.
 */
function planMethodFan(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  focus: LayerCapability,
  locale: PublicLocale,
  open: ReadonlySet<string>,
): Plan | null {
  const fan = methodFanOf(graph, focus);
  if (!fan) return null;
  return {
    chain: [fan.from, fan.to],
    grain: "methods",
    bundles: [
      {
        from: fan.from,
        to: fan.to,
        lanes: fan.lanes.map((lane) =>
          planForMethod(
            graph,
            vocabulary,
            lane.method,
            locale,
            open,
            0,
            new Set([focus.id]),
            `${focus.id}:`,
          ),
        ),
      },
    ],
  };
}

/**
 * Whether any recorded source walks this lane.
 *
 * A lane is a sequence of *slots*, so the question here is the slot-level one:
 * has anything been recorded that crosses these slots in this order? The
 * finer question — whether a particular pair of *methods* has been published
 * together — is `pathStanding`, and it is what the fan one click down asks.
 */
function standingFor(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  lane: BundleLane,
): LaneStanding {
  if (pathWitnesses(graph, vocabulary, lane).length > 0) return "recorded";
  return pathStanding(
    graph,
    vocabulary,
    lane.edges.map((edge) => ({ edgeKey: edge.key, filler: null })),
  );
}

/** One concrete route through a shared circle: a way in, then a way out. */
export interface Crossing {
  key: string;
  inLabel: string;
  inHref: string;
  outLabel: string;
  outHref: string;
  standing: LaneStanding;
}

export interface CrossingCensus {
  stateId: string;
  waysIn: number;
  waysOut: number;
  /** waysIn × waysOut. What the shared circle actually offers. */
  total: number;
  recorded: number;
  unpinned: number;
  unpublished: number;
  /** The unpublished ones, capped — the discovery, listed. */
  examples: readonly Crossing[];
  /**
   * True when the cap bit, so `examples` is a floor rather than the list.
   *
   * Same reason `PathSearch.truncated` exists: a silently shortened list of
   * discoveries reads exactly like a shorter list of discoveries, and a contract
   * that cannot express the truncation gives no consumer anything to render and
   * no test anything to assert.
   */
  examplesTruncated: boolean;
}

/**
 * Every way across a shared circle, at **method** granularity, with its standing.
 *
 * This is where the owner's discovery actually lives, and it is a level below
 * what the canvas draws by default. The lanes on the figure are *slots*, and at
 * slot granularity every lane on the authored graph is one a recorded source
 * walks — so the figure's own `unpublishedCount` is zero and would stay zero. The
 * unpublished pairs are combinations of the **methods** filling two slots:
 * Carleman fills the embedding, Schrödingerisation fills the linear solve, they
 * compose through `linear-ivp`, and no source puts them together.
 *
 * Capped, and the cap is reported rather than applied silently: a truncated list
 * of discoveries reads exactly like a shorter list of them.
 */
export function crossingsAt(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  expansion: Expansion,
  stateId: string,
  locale: PublicLocale,
  cap = 30,
): CrossingCensus | null {
  const into = expansion.bundles.filter((bundle) => bundle.to === stateId);
  const outOf = expansion.bundles.filter((bundle) => bundle.from === stateId);
  if (into.length === 0 || outOf.length === 0) return null;

  const ways = (bundles: readonly StateBundle[]) =>
    bundles.flatMap((bundle) =>
      bundle.lanes.flatMap((lane) => {
        const fillers = laneFillers(graph, lane);
        if (fillers.length > 0) {
          return fillers.map((method) => ({
            crossing: { edgeKey: lane.edges[0]!.key, filler: method.id },
            label: labelOf(method, locale),
            href: `/repository/layers/${method.id}`,
          }));
        }
        // A multi-edge lane names no single method; it is the run itself.
        return [
          {
            crossing: { edgeKey: lane.edges[0]!.key, filler: null } as EdgeChoice,
            label: laneName(graph, lane, locale).text,
            href: laneName(graph, lane, locale).href,
          },
        ];
      }),
    );

  // Deduped on the method, not on the lane it was reached by.
  //
  // A filler can appear on two lanes of the same bundle: the Koopman-von Neumann
  // lift fills the broad `nonlinear-linear-embedding` lane *and* is the sole
  // filler of the narrowed `…@koopman-von-neumann-lift` lane, because the
  // narrowing is drawn as its own way across. Both reach the circle by the same
  // method, so counting both says the same route twice — measured before this
  // guard, `linear-ivp` reported 40 crossings and listed
  // "Koopman-von Neumann → Schrödingerisation" twice.
  const distinct = <T extends { crossing: EdgeChoice; label: string }>(items: T[]): T[] => {
    const seen = new Set<string>();
    return items.filter((item) => {
      // Namespaced, so a filler id can never collide with another lane's edge
      // key, and two filler-less lanes sharing a first edge stay two entries.
      const id =
        item.crossing.filler === null
          ? `edge:${item.crossing.edgeKey}:${item.label}`
          : `method:${item.crossing.filler}`;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  };

  const arrivals = distinct(ways(into));
  const departures = distinct(ways(outOf));

  const tally = { recorded: 0, unpinned: 0, unpublished: 0 };
  const examples: Crossing[] = [];
  for (const arrival of arrivals) {
    for (const departure of departures) {
      const standing = pathStanding(graph, vocabulary, [arrival.crossing, departure.crossing]);
      tally[standing] += 1;
      if (standing === "unpublished" && examples.length < cap) {
        examples.push({
          key: `${arrival.crossing.filler ?? arrival.crossing.edgeKey}>${departure.crossing.filler ?? departure.crossing.edgeKey}`,
          inLabel: arrival.label,
          inHref: arrival.href,
          outLabel: departure.label,
          outHref: departure.href,
          standing,
        });
      }
    }
  }

  return {
    stateId,
    waysIn: arrivals.length,
    waysOut: departures.length,
    total: arrivals.length * departures.length,
    ...tally,
    examples,
    examplesTruncated: tally.unpublished > examples.length,
  };
}

/**
 * Every focusable slot whose interior states converge — 2 of 18 on today's graph.
 *
 * Still a real and separate distinction after the method fan landed: these are
 * the figures where the circles between the ends mean *"every way across passes
 * through this"*. It is no longer the list of slots the page can draw — see
 * `drawableSlots` — and conflating the two is what made 16 slots render a blank
 * page for three sessions.
 */
export function convergingSlots(graph: LayerGraph, vocabulary: StateVocabulary): LayerCapability[] {
  return graph.nodes.filter((node): node is LayerCapability => {
    if (!isCapability(node)) return false;
    return !expansionOf(graph, vocabulary, node).atomicAtThisLevel;
  });
}

/**
 * Every slot this surface can draw a figure for.
 *
 * A slot draws when it has interior states **or** something fills it. Written as
 * the disjunction the layout actually branches on rather than as "all
 * capabilities", so a slot that stops being drawable stops being offered — the
 * failure this replaces was a navigation list and a renderer disagreeing about
 * what exists, and the fix is not a second hand-maintained list that agrees
 * today.
 */
export function drawableSlots(graph: LayerGraph, vocabulary: StateVocabulary): LayerCapability[] {
  return graph.nodes.filter((node): node is LayerCapability => {
    if (!isCapability(node)) return false;
    if (!expansionOf(graph, vocabulary, node).atomicAtThisLevel) return true;
    return methodFanOf(graph, node) !== null;
  });
}
