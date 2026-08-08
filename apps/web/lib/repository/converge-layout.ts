// Convergence: several ways across, drawn between **one** circle and one circle.
//
// > *"several paths lead to the 'linear ODE system' state, so they should all
// > converge to that one state node, and then the options to lead out of it
// > should flow out of the state node."*
// > — owner, session-96 inbox
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
// ## The crossing-free argument, which is a proof rather than a sweep
//
// D96.2 replaced the old rule with: **two process lines may share space only at
// a state circle they both genuinely touch, and nowhere else.** That is
// obtained here by construction, not checked by an all-pairs test.
//
// Every lane of a bundle is the *same* cubic Bézier in x, and differs only in
// one scalar `d` — how far it bows. With
//
//     P0 = (x0, yc)   P1 = (x0 + w/3, yc + h)   P2 = (x1 - w/3, yc + h)   P3 = (x1, yc)
//
// the curve's y is **affine in h**:  y(t) = yc + h·f(t),  f(t) = 3t(1 - t).
// And x(t) does not involve h at all, so two lanes compared at the same `t` are
// compared at the same `x`.
//
// Therefore for two lanes with h₁ < h₂:  y₁(t) − y₂(t) = (h₁ − h₂)·f(t), which is
// **strictly negative for t ∈ (0,1)** and **exactly zero at t ∈ {0,1}**. Two
// lanes of one bundle meet at their two shared endpoints and are separated
// everywhere between. f(t) ≥ 0 also means no lane ever crosses the spine it bows
// around except at those same two points.
//
// Lanes in *different* bundles occupy disjoint x-spans, so they can meet only at
// the circle they both touch. Between them, the whole picture has contact
// exactly at shared circles and nowhere else, which is the invariant.
//
// This is why the shape is a bow rather than a polyline: a polyline dog-legging
// out of a shared circle has no such monotonicity, and its separation has to be
// *measured* — which is the crossing-minimisation heuristic §4 of the plan
// rejected, arriving by the back door.
//
// ## Server-rendered, unchanged
//
// D90.3 holds: pure function, no `window`, no measurement API, every shape gets
// an `href` that arrives from the origin. Text is measured by character class by
// the same estimator the other canvases use, so nothing here needs a DOM.
import { PROCESS_METRICS, estimateTextWidth, fitLabel, stateHref } from "./process-layout.ts";
import {
  expansionOf,
  laneFillers,
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
import { isCapability, layerNode, type LayerCapability, type LayerGraph } from "./layers.ts";
import { layerState, type StateVocabulary } from "./states.ts";
import type { PublicLocale } from "../public-locale.ts";

/** Tunables. Separate from PROCESS_METRICS so the old canvas cannot shift under this one. */
export const CONVERGE_METRICS = {
  stateRadius: 11,
  /**
   * How far each step away from the spine bows, at the curve's peak.
   *
   * Was 30, which put a two-lane fan at ±15 control and therefore ±11 on screen
   * — read on the rendered page, the two ways into `linear-ivp` were almost a
   * single line and the convergence did not read as a convergence at all. The
   * shape has to say "these are separate ways that meet" from across the room,
   * which is the owner's *"muscle strand-shapes lines around it"*.
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
  /** A lane's label sits this far off its own curve at the peak. */
  labelLift: 7,
} as const;

export type LaneStanding = "recorded" | "unpinned" | "unpublished";

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
}

export interface ConvergeLane {
  key: string;
  /** SVG path data. Starts and ends exactly on a shared circle's centre. */
  d: string;
  x0: number;
  x1: number;
  yc: number;
  /** Signed bow height. Zero is the straight lane through the middle. */
  bow: number;
  label: string;
  fullLabel: string;
  labelTruncated: boolean;
  /** Where the label sits — at the curve's peak, lifted clear of it. */
  labelX: number;
  labelY: number;
  href: string;
  standing: LaneStanding;
  /** Slot ids this lane crosses, in order. */
  slots: readonly string[];
  /** Named states strictly inside this lane, drawn flat because this level is not open. */
  interior: readonly string[];
  /** How many methods fill it — the fan-out one more click down. */
  ways: number;
}

export interface ConvergeDiagram {
  width: number;
  height: number;
  states: readonly ConvergeState[];
  lanes: readonly ConvergeLane[];
  /** The focused process's own name, drawn once. */
  caption: string;
  /** Nothing finer is recorded, so there is no fan to draw. */
  empty: boolean;
  /** How many lanes on this figure no recorded source walks. */
  unpublishedCount: number;
}

/**
 * The control-point offset that makes a cubic peak at exactly `bow`.
 *
 * A cubic with both controls lifted by `h` reaches `3h/4` at `t = ½`, so the
 * control has to be pushed 4/3 past the height you want. One function owns that
 * relationship because two places need it — the emitted path and `bowAt` — and
 * they had drifted: `bowAt` used `h = bow` while the emitter used `h = 4·bow/3`,
 * making the helper describe a curve **three quarters** the height of the one
 * on screen.
 */
export function controlHeight(bow: number): number {
  return (bow * 4) / 3;
}

/**
 * y of the **drawn** bow at parameter t. Affine in `bow` — the crossing-free proof.
 *
 * This must stay the y of the curve `layoutConverge` emits, not a parallel
 * formula that resembles it. It was one for a while, and the consequence was not
 * academic: every invariant sampling this function was measuring a curve 3/4 as
 * tall as the rendered one, so the label-clearance check had 25% more room than
 * the page does, and `halfHeight` reserved 3/4 of the height the fan actually
 * reaches — the outermost lane overshot its own canvas. Caught in review, after
 * a mutation sweep that could not see it: mutating the emitter and mutating this
 * helper both left the two *consistently* wrong with each other.
 */
export function bowAt(yc: number, bow: number, t: number): number {
  return yc + controlHeight(bow) * 3 * t * (1 - t);
}

/**
 * Room to leave above and below the spine for a fan whose outermost bow is
 * `tallest`.
 *
 * Its own function because it is the one number a wide fan gets wrong, and the
 * error is invisible until it is large. This read `(tallest * 3) / 4` while the
 * emitter already scaled by `controlHeight`'s 4/3, so the canvas reserved three
 * quarters of the height the fan uses. Nothing overflowed, because the 34px
 * margin absorbed the shortfall at every fan the graph produces today — the
 * lanes on a figure are *slots*, and there are at most two. The shortfall is
 * `tallest / 4`, so it eats the margin at roughly ten lanes, which is exactly
 * what the method-level fan-out will draw. A defect that waits for the next
 * feature is worth pinning now, and it can only be pinned here: sampling the
 * curves cannot see a reservation the margin is covering for.
 */
export function reservedHalfHeight(tallest: number): number {
  const M = CONVERGE_METRICS;
  return tallest + M.labelLift + M.laneFont + M.stateRadius;
}

/**
 * The offsets a fan of `n` lanes takes, centred on the spine.
 *
 * Odd counts put one lane **straight through the middle**, which is the owner's
 * *"the original process line should be faint but remain in the middle — every
 * other process expanded from it should be around it, even an odd number"*.
 * Even counts straddle it, so the spine stays visible between the two innermost.
 */
export function laneOffsets(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const out: number[] = [];
  const mid = (n - 1) / 2;
  for (let index = 0; index < n; index += 1) out.push((index - mid) * CONVERGE_METRICS.laneBow);
  return out;
}

function labelOf(item: { label: string; labelJa: string }, locale: PublicLocale): string {
  return locale === "ja" ? item.labelJa : item.label;
}

function laneName(
  graph: LayerGraph,
  lane: BundleLane,
  locale: PublicLocale,
): { text: string; href: string; slots: string[] } {
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
        };
      }
    }
    return {
      text: node ? labelOf(node, locale) : slots[0]!,
      href: `/repository/layers/${slots[0]}`,
      slots,
    };
  }
  // A multi-edge lane has no name of its own — it is a run of named processes,
  // and inventing a name for the composite is precisely the thing the owner
  // objected to. It is named by its hops instead.
  const names = slots.map((slot) => {
    const node = layerNode(graph, slot);
    return node ? labelOf(node, locale) : slot;
  });
  return { text: names.join(" → "), href: `/repository/layers/${slots[0]}`, slots };
}

/**
 * Lay out one focused slot as a chain of shared circles with fans between them.
 *
 * The chain is `expansionOf`'s dominator chain: the states every crossing must
 * pass. Each consecutive pair gets one circle each — **one**, shared by every
 * lane that touches it — and the ways across bow between them.
 */
export function layoutConverge(options: {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  focus: LayerCapability;
  locale: PublicLocale;
  width?: number;
}): ConvergeDiagram {
  const { graph, vocabulary, focus, locale } = options;
  const M = CONVERGE_METRICS;
  const expansion: Expansion = expansionOf(graph, vocabulary, focus);
  const caption = labelOf(focus, locale);

  if (expansion.atomicAtThisLevel || expansion.bundles.length === 0) {
    return { width: 0, height: 0, states: [], lanes: [], caption, empty: true, unpublishedCount: 0 };
  }

  // Column widths: each bundle needs room for its widest lane label.
  const spans = expansion.bundles.map((bundle) => {
    const widest = bundle.lanes.reduce((wide, lane) => {
      const { text } = laneName(graph, lane, locale);
      return Math.max(wide, estimateTextWidth(text, M.laneFont));
    }, 0);
    return Math.max(M.minSpan, widest + M.labelPad * 2);
  });

  const tallest = expansion.bundles.reduce(
    (tall, bundle) => Math.max(tall, Math.max(...laneOffsets(bundle.lanes.length).map(Math.abs))),
    0,
  );
  const halfHeight = reservedHalfHeight(tallest);
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
  for (const [index, bundle] of expansion.bundles.entries()) {
    arriving.set(bundle.to, (arriving.get(bundle.to) ?? 0) + bundle.lanes.length);
    leaving.set(bundle.from, (leaving.get(bundle.from) ?? 0) + bundle.lanes.length);
    void index;
  }

  const states: ConvergeState[] = expansion.chain.map((stateId, index) => {
    const state = layerState(vocabulary, stateId);
    return {
      key: `s:${stateId}`,
      stateId,
      label: state ? labelOf(state, locale) : stateId,
      cx: xs[index]!,
      cy: yc,
      r: M.stateRadius,
      href: stateHref(stateId),
      terminal: index === 0 || index === expansion.chain.length - 1,
      arriving: arriving.get(stateId) ?? 0,
      leaving: leaving.get(stateId) ?? 0,
    };
  });

  const lanes: ConvergeLane[] = [];
  let unpublishedCount = 0;
  for (const [index, bundle] of expansion.bundles.entries()) {
    const x0 = xs[index]!;
    const x1 = xs[index + 1]!;
    const offsets = laneOffsets(bundle.lanes.length);
    for (const [at, lane] of bundle.lanes.entries()) {
      const bow = offsets[at]!;
      const h = controlHeight(bow);
      const third = (x1 - x0) / 3;
      const d =
        `M ${round(x0)} ${round(yc)} ` +
        `C ${round(x0 + third)} ${round(yc + h)}, ${round(x1 - third)} ${round(yc + h)}, ` +
        `${round(x1)} ${round(yc)}`;

      const { text, href, slots } = laneName(graph, lane, locale);
      const fitted = fitLabel(text, M.laneFont, x1 - x0 - M.labelPad * 2);
      const peakY = bowAt(yc, bow, 0.5);
      const standing = standingFor(graph, vocabulary, lane);
      if (standing === "unpublished") unpublishedCount += 1;

      lanes.push({
        key: `${bundle.from}>${bundle.to}:${lane.key}`,
        d,
        x0,
        x1,
        yc,
        bow,
        label: fitted.text,
        fullLabel: text,
        labelTruncated: fitted.truncated,
        labelX: (x0 + x1) / 2,
        // Above the curve for the upper half, below for the lower, so a label
        // never sits on the line it names or on its neighbour's.
        labelY: bow >= 0 ? peakY + M.labelLift + M.laneFont * 0.8 : peakY - M.labelLift,
        href,
        standing,
        slots,
        interior: lane.interior,
        ways: laneFillers(graph, lane).length,
      });
    }
  }

  return { width, height, states, lanes, caption, empty: false, unpublishedCount };
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
 * what the canvas draws. The lanes on the figure are *slots*, and at slot
 * granularity every lane on the authored graph is one a recorded source walks —
 * so the figure's own `unpublishedCount` is zero and would stay zero. The
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

/** Every focusable slot that has something to converge — used by the page and the tests. */
export function convergingSlots(graph: LayerGraph, vocabulary: StateVocabulary): LayerCapability[] {
  return graph.nodes.filter((node): node is LayerCapability => {
    if (!isCapability(node)) return false;
    return !expansionOf(graph, vocabulary, node).atomicAtThisLevel;
  });
}
