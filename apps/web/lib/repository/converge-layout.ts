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
import { ownCardId } from "./card-content.ts";
import { withCard, withIopen } from "./map-card.ts";
import { estimateTextWidth, fitLabel, LANE_FONT_PX, stateHref } from "./process-layout.ts";
import {
  bellyOf,
  levelSlices,
  ribbonOutline,
  ribbonPath,
  tendonSlope,
  type Level,
  type Ribbon,
} from "./strand-geometry.ts";
import {
  drawsAsStateChain,
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
  isMethod,
  layerNode,
  methodFanGroups,
  methodsRealizing,
  repetitionOf,
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
  /**
   * The widest a name may make its column, in px. Past this the name is cut and
   * the full text stays in the `<title>`.
   *
   * **300 and not lower, and the reason is a measurement, not taste.** Bisected
   * against the name-collision invariant ("an opened line draws its name, and
   * the name is not worse placed than a shut one's"): a cap of 200 passes, 195
   * fails at 11.8% of opened names hit by a line against 11.5% of shut ones, and
   * 127 — the value costed in an earlier session's notes — fails outright at
   * 8.7% against 2.9%. So **no cap below about 200 is shippable at all**,
   * whatever it does to the width, and that was not known when 127 was proposed.
   *
   * 300 sits above that floor on purpose, because the owner's instruction was
   * *"attempt to make each label shorter, then the width cap"* and the
   * shortening is what should be doing the work: authored short forms take the
   * eighteen figures from 8,487px to 7,138px with **nothing** machine-cut, while
   * a 240px cap buys a further 93px by cutting fifteen names mid-word. A name
   * ending "Choose a time discretization or…" is worse than the long one.
   *
   * So this is a **backstop against the next long label somebody authors**, not
   * a tool for reclaiming width today, and on the current graph it bites
   * nothing. A guard that never fires is a guard nothing has tested, so
   * `a label past the cap is cut, and the full text survives in the title`
   * drives it with a fixture rather than waiting for the graph to grow into it.
   */
  labelCap: 300,
  /** Room above and below the whole fan. */
  margin: 34,
  /** Read from `process-layout.ts`, which is also what `validateLayerGraph`
   *  measures a `shortLabel` against. One writer: a second copy of this number
   *  would let the lint accept a short form the map then draws too wide. */
  laneFont: LANE_FONT_PX,
  stateFont: 12,
  captionFont: 13,
  /** A lane's label sits this far off its own edge. */
  labelLift: 7,
  /**
   * How thick an opened line — the **bone** — is drawn.
   *
   * Owner, session 104: *"process lines that have been expanded remain in the
   * center, are thick and dotted, and not blocked/overlayed by any branch so
   * they can be clicked on to collapse"*. It was 2px at opacity 0.16, which is
   * neither thick nor findable, and the reason it was faint is that it had
   * nothing to be found *for*: the name sat outside the fan and the collapse
   * control was the invisible hit path.
   */
  spineStroke: 4,
  /**
   * Half the band an opened line keeps for itself, clear of every branch.
   *
   * This is the number that makes *"even an odd number of branches should all be
   * around it, not a middle one that covered this collapse line"* true. Before
   * it, `allocateBows` centred the row on the spine, so any odd fan — and every
   * fan of one, which is 23 of the 29 decomposed routes — put a child at offset
   * 0, exactly on top of the line the reader has to click to collapse.
   *
   * Sized to hold the bone **and its name clear of the stroke**:
   * `spineStroke/2 + labelLift + laneFont·0.8` = 2 + 7 + 9.6 = 18.6, rounded up
   * to 22 so the band is not exactly the text's bounding box.
   *
   * The first attempt wrote the name at `peak.y` exactly — literally on the line
   * — and the name-collision invariant caught it immediately: opened names
   * collided with a line on **36 of 127 (28.3%)**, against the 13.4% the shut
   * names were measured at. A name *on the bone* has to sit in the bone's band,
   * not on the bone's stroke.
   *
   * Reserved by `allocateBowsAroundSpine`, which both `measure` and `place`
   * call — one number, two uses, never two derivations.
   */
  spineBand: 22,
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
   * The shortest tendon, in px — the taper every strand gets whatever its bow.
   *
   * A strand with **no** bow still needs one: the tendon is also where the shape
   * pinches to a point at the circle it reaches, and with a zero run a chain's
   * step would be a constant-thickness bar butted against its neighbour. This is
   * therefore the taper length as much as the run-in length, and the two are one
   * number because they are one curve — `tendonProfile` scales the bow and the
   * half-thickness by the same φ.
   */
  minTendonRun: 16,
  /**
   * The longest tendon, in px, and the number that bounds the whole figure.
   *
   * This is what replaces `span ≥ 4·|bow|`. Under the old law a bow of 400px
   * demanded a **1600px** column to stay under 45°, and that is why a fully
   * opened figure measured 87,449px wide. A tendon confines the rise to its own
   * run, so a bow costs at most `2 × this` of column however large it grows.
   *
   * 110 and not less because the tendon still has to read as a curve rather than
   * as a corner at ordinary bows; not more because it is paid twice per level of
   * nesting, on every column, whether or not any lane needs it.
   */
  maxTendonRun: 110,
  /**
   * How much of a **first-order** line each of its two tendons takes, as a
   * fraction — the owner's ask B.
   *
   * The two numbers above are lengths, and a length is the wrong instrument for
   * this one. Measured on the corpus: the longest first-order line is 4,376px
   * (`ja`) and took the 110px ceiling — 2.5% per end — while the worst case, a
   * single-lane bundle at bow 0, was a **2,633px line taking the 16px floor**,
   * 0.61%. Drawn, both are blunt bars with pinpricks at the ends rather than
   * something that rises, runs level and falls. But the *short* first-order
   * lines have no such defect: a 450px column already spends 24% of itself on
   * its two tendons, and raising a flat floor to fix the long lines widened
   * every shut figure — 1,026px → 1,393px against a 1,204px canvas, which would
   * have made every figure arrive scaled down to buy a taper it did not need.
   *
   * So the rule is a share of the line, floored by what the bow already asks for
   * (`tendonRunFor`) so nothing ever gets *less* taper than it does today, and
   * ceilinged below. 8% leaves 84% of the line level.
   *
   * **It is derived once.** The circularity — a longer tendon needs a longer
   * column, and the column's length is what sets the tendon — is cut by taking
   * the share of the line **without** its tendons on it, which is the content's
   * own demand and is known before any span exists. See `firstOrderRun`.
   */
  firstOrderTendonShare: 0.08,
  /**
   * The longest tendon on a first-order line.
   *
   * `maxTendonRun`'s own note holds it at 110 "because it is paid twice per level
   * of nesting, on every column". A first-order line has no level above it and
   * pays once, so that argument does not reach here. 340 costs at most
   * `2 × (340 − 110) = 460px` of column and only on a line already past 1,375px
   * — measured against all three of `SIZE_CEILING`'s bars rather than asserted.
   */
  maxFirstOrderTendonRun: 340,
  /**
   * The angle a tendon is *aimed* at before the ceiling above takes over.
   *
   * R14: a tendon is not a branch. It carries no name, no destination and no
   * claim, so `maxLaneAngleDeg` — which existed because *"no branch should be at
   * such a steep angle that it becomes weird to look at"* — does not reach it,
   * and the owner said so explicitly: *"it makes sense to allow tendons to expand
   * past 45 degrees if only just to allow this horizontal structure for pairs of
   * states so that things become standardized and easy to read."*
   *
   * So this is not a cap. It is the slope a tendon takes while it can afford to,
   * and past `maxTendonRun` the tendon simply gets steeper rather than the column
   * getting wider. Past 45° because the trade only pays if it does: at 45° the
   * run would be `1.5·|bow|`, which is not far off the old law's `4·|bow|` and
   * would keep the figure enormous.
   *
   * ## **76°, and this is the dial the horizontal distance between states turns
   * on.** Raised from 62° in session 115, on the owner's ask
   *
   * > *"reduce horizontal distances between states — the tendons are helping and
   * > now processes are getting much longer than their labels."*
   *
   * He is describing a measured fact and this is where it comes from. A column's
   * width is `need + 2·labelPad + 2·run`, and on a shut figure `run` is set by
   * the **bow** — the vertical spread of the lanes in that bundle — divided by
   * `tan` of this angle. So the gap between two circles is the *vertical* spread
   * of what runs between them, converted into horizontal distance at this rate.
   * That is exactly the x-against-y trade he was reaching for with *"shifting
   * muscle groups along the x-axis … while compressing y-axis"*, and it is one
   * number rather than a rearrangement.
   *
   * Measured over all 19 figures in both locales, shut: the widest column falls
   * **494.5px → 403px**, the median gap **314.7 → 292.4**, and the summed width
   * of every figure **17,132px → 15,778px (−7.9%)**. On `time-discretization` —
   * the figure whose five identical lanes he was looking at — the column goes
   * **379.1px → 287.7px** against a 170.9px label, so a lane stops being 2.2× its
   * own name.
   *
   * **It costs no label a character**, and that is why it is safe rather than a
   * trade. The belly is `bare` — `need` plus the padding — and this angle does
   * not appear in it: raising the angle takes width off the *tendons* and leaves
   * the room a label is fitted into exactly where it was. Measured: **0 of 120
   * lanes truncated at 62°, 72°, 76° and 80° alike.**
   *
   * 76 and not more because the curve flattens there — 80° buys a further 1.3% of
   * summed width and 0.1px of median gap, because past this the bow stops being
   * what binds and `firstOrderTendonShare` takes over. Not less because 72° gives
   * up a third of the gain. The steepest tendon *actually drawn* at 76° is 69.5°,
   * which still reads as a taper rather than as a corner — checked on the served
   * page against 62° side by side, not asserted.
   *
   * **`maxLaneAngleDeg` is gone, and it has no subject left.** Every strand on
   * this canvas is now a tendon, a level belly and a tendon; a *branch* at a
   * steep angle is not a shape the layout can produce. What replaces the guard it
   * carried is `tendonSlope` — reported per lane and bounded by the two runs
   * above — plus the invariant that every belly is level, which is the property
   * the old cap was reaching for by limiting how far from level a line could get.
   */
  tendonAngleDeg: 76,
} as const;

/**
 * The key's swatch, emitted by the same geometry that draws the canvas.
 *
 * **Not a convenience.** The legend's mark was a literal — the lens the canvas
 * drew before R14 — and it stayed a lens right through the tendons, so the key
 * beside a figure of ribbons described a shape nothing on that figure had. Read
 * on production after the deploy. The key's own comment already said copying the
 * shapes is *"how a legend starts describing a picture that no longer looks like
 * that"*; it was the code that was not following it.
 *
 * Lives here rather than in the component so that `the key's swatch is the same
 * kind of shape the canvas draws` is checkable without rendering React — the
 * layout tests measure the layout, and the render harness draws the canvas
 * without its key, so between them there was nowhere this could have been seen.
 *
 * The numbers are a legend-scale ribbon inside the key's 34×18 box, and nothing
 * else on the canvas depends on them.
 */
export function legendMark(): { outline: string; spine: string } {
  const mark: Ribbon = { x0: 2, x1: 32, y: 13, bow: -4, run: 9 };
  return { outline: ribbonOutline(mark, 3.5), spine: ribbonPath(mark) };
}

/**
 * How much of each end a strand bowed this far off its base gives to its tendon.
 *
 * `tendonProfile`'s steepest slope is `1.5·|bow| / run`, so aiming at
 * `tendonAngleDeg` means `run = 1.5·|bow| / tan(angle)` — floored so every strand
 * tapers, and **ceilinged**, which is the whole point: past that bow the tendon
 * steepens instead of the column widening. Exported because it is the rule in one
 * line and deserves a test that does not have to build a figure to reach it.
 *
 * A pure function of the bow, with no span in it. That is deliberate: `measure`
 * decides the column width and cannot know the span it is about to produce, so a
 * run that depended on the span would have to be derived twice. The one clamp
 * that does involve the span — a run may never eat more than half its own range —
 * is applied once, per parent, in `runAcross` below.
 *
 * **This is the run for a strand drawn inside something.** A first-order strand
 * — one on the figure's own base, at depth 0 — takes this as its floor and then
 * grows it with its own length: see `firstOrderRun`, which is applied once, in
 * the one place a first-order line's length is decided.
 */
export function tendonRunFor(bow: number): number {
  const M = CONVERGE_METRICS;
  const aimed = (1.5 * Math.abs(bow)) / Math.tan((M.tendonAngleDeg * Math.PI) / 180);
  return Math.min(M.maxTendonRun, Math.max(M.minTendonRun, aimed));
}

/**
 * The run a whole row of siblings shares, which is what keeps them from crossing.
 *
 * **One run for the row, not one per member.** The crossing-free argument is that
 * every line in a row is `base + bow·φ(x)` for one shared φ — see the ribbon
 * block in `strand-geometry.ts`. φ is built from the run, so siblings with
 * different runs are compared against different φ and the argument evaporates:
 * two lines could then cross between their bellies. Taking the max means the
 * row's anchors line up in two vertical columns, which is also what the owner
 * asked the shape to buy — *"so that things become standardized and easy to
 * read"*.
 *
 * Clamped to half the range so a belly can never invert. That clamp should never
 * bite, because the column is sized with the run already in it; `every belly is
 * long enough to hold its own name` is the invariant that says so, and it is a
 * check on the sizing arithmetic rather than on this line.
 */
export function runAcross(bows: readonly number[], length: number): number {
  const wanted = Math.max(0, ...bows.map((bow) => tendonRunFor(bow)));
  return Math.min(wanted, length / 2);
}

/**
 * The run a **first-order** row shares — a row on the figure's own base, at depth 0.
 *
 * `tendonRunFor` cannot see how long a line is, and for a strand nested inside
 * something that is right: its length is its parent's belly, decided later, and a
 * run that read it would have to be derived twice. A first-order line is the one
 * case where the length is decided in the same expression as the run, so this is
 * the one place a share of the line is derivable without a second derivation.
 *
 * `bare` is the line **without its tendons on it** — the content's own demand,
 * `need + hRun + padding`. Taking the share of that rather than of the finished
 * span is what cuts the circularity: a longer tendon needs a longer column, and
 * if the share were read off the column the two would chase each other.
 *
 * Floored at `aimed`, which is `runAcross` over the row's bows, so a first-order
 * line never gets a *shorter* tendon than the shared-run rule already gives it —
 * and the crossing-free argument is untouched, because this returns one number for
 * the whole row exactly as `runAcross` does. `repository-strand-geometry.test.ts`'s
 * "two ribbons with DIFFERENT runs" control is what says that matters.
 */
export function firstOrderRun(aimed: number, bare: number): number {
  const M = CONVERGE_METRICS;
  return Math.min(M.maxFirstOrderTendonRun, Math.max(aimed, M.firstOrderTendonShare * bare));
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
 * The parameter is user-supplied, so it is bounded, and the count over the cap
 * is reported rather than dropped in silence.
 *
 * **The number must stay above what a reader can reach by clicking**, and twice
 * now it has not. The comment here read *"twenty-four is past anything a reader
 * reaches by clicking"* while the constant said 64 — so the sentence defending
 * the number had stopped describing it — and 64 was itself below the graph:
 * `nonlinear-ode-solve` fully opened names **66** addresses, and the four-root
 * overview, which hands one `?open=` set to every figure it draws, names **73**.
 * A reader who opened that figure line by line lost the last two clicks to a
 * cap, which is R12.5 (*every reading position is in the URL*) failing on the
 * one position that takes the most work to reach.
 *
 * 128 is not a guess about the future either. It is today's 73, plus the one
 * slot a method's own page reserves for itself, with room for the corpus to
 * roughly double — and `the cap is above what a reader can reach by clicking`
 * re-measures both numbers off the graph on every run, so the next time growth
 * passes it the build says so instead of a reader quietly losing clicks.
 *
 * Raising it costs no layout work. Only an address that matches a lane opens
 * anything; the rest sit inert in a `Set` at O(1). What the cap actually bounds
 * is the size of the parsed set, and at 128 a hand-written URL is about 3KB.
 */
export const CONVERGE_OPEN_MAX = 128;

/**
 * The shape of a lane address, and the only thing `?open=` validates against.
 *
 * Positions and dots. There is nothing to look up: an address that names no lane
 * on this figure simply never matches during planning, so a stale or invented one
 * opens nothing rather than erroring. That is the same forgiveness the id form
 * had — "a URL naming four things, one of which has since been renamed, opens the
 * other three" — arrived at by construction instead of by a graph lookup.
 */
const ADDRESS = /^[A-Za-z0-9_-]+:\d+(?:\.\d+)*$/;

/**
 * The address prefix that says **which figure** — and it is not decoration.
 *
 * The unfocused surface draws four figures at once and hands every one of them
 * the same `?open=` set. A position alone is not unique across them: bundle 0,
 * lane 0 exists on every root, so `?open=0.0` opened a lane on **three of the
 * four** — exactly the multi-open defect addresses were introduced to kill,
 * reintroduced one level up. Caught in review and reproduced on the deployed
 * preview before being believed.
 *
 * The subject's id, because that is what a figure *is* — and it is the same
 * value on a focused page, where there is one figure and the prefix is constant
 * and harmless. One name segment, so a saturated figure goes from 733 characters
 * to about 1,800, still a quarter of what the render keys would have cost.
 */
function addressRoot(subjectId: string, bundleIndex: number, laneIndex: number): string {
  return `${subjectId}:${bundleIndex}.${laneIndex}`;
}

/**
 * Is this lane opened by the reader's `?open=` set?
 *
 * Two forms, and the second is only there so that links already written down keep
 * working. An **address** opens exactly one lane. A bare **node id** opens every
 * lane that node appears on, which is what the parameter used to mean and is why
 * one click flipped five lanes at once on `nonlinear-ode-solve` — a node can hold
 * twelve positions on one figure. Links minted from today on carry addresses;
 * `toggleHref` never emits an id.
 */
export function isOpenedBy(
  open: ReadonlySet<string>,
  address: string,
  id: string | null,
): boolean {
  if (open.has(address)) return true;
  return id !== null && open.has(id);
}

/** Whether a `?open=` value is one of the two forms above. */
export function isOpenValue(value: string, known: (id: string) => boolean): boolean {
  return ADDRESS.test(value) || known(value);
}

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
 *
 * **One function, both surfaces.** The overview page carried a hand-rolled second
 * copy of this loop with a different predicate and no `reserved` argument. Two
 * parsers for one parameter is how the two pages come to disagree about what a
 * URL means, and the disagreement would have arrived the moment the predicate
 * changed — which is this change.
 */
export function resolveOpenIds(
  values: readonly string[],
  known: (id: string) => boolean,
  reserved = 0,
): { open: Set<string>; dropped: number } {
  const open = new Set<string>();
  let dropped = 0;
  for (const value of values) {
    if (!isOpenValue(value, known)) continue;
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
  /**
   * Where clicking the circle goes **when this surface has a card layer**: this
   * same figure, with the state's card open over it. Null everywhere else, and
   * then `href` is the only destination.
   *
   * See `layoutFigure`'s `cards` option for why this is a field rather than
   * something the renderer derives — the answer is a property of the *surface*,
   * and the renderer for the two surfaces is one component.
   */
  cardHref: string | null;
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
   * This lane's position in the figure, and what `?open=` names. See
   * `PlanStrand.address` for why it is a path of positions and not the node id.
   */
  address: string;
  /**
   * The **spine**: the centre line of this strand, as SVG path data.
   *
   * A **ribbon** since R14 — cubic in, straight across, cubic out — and no longer
   * a single cubic. It is still what every geometric invariant is asserted
   * against: the crossing-free property is a property of these curves and the
   * outline below is derived from the same numbers. Drawn faint when the strand
   * is open, hidden under the fill when it is shut.
   */
  d: string;
  /**
   * The **outline**: the region between `bow ± half`, closed and fillable. This
   * is what a reader actually sees — tapered through the two tendons, exactly
   * `2·half` thick across the whole belly.
   */
  outline: string;
  x0: number;
  x1: number;
  yc: number;
  /** Signed height of the **belly** above the base. Constant across the belly. */
  bow: number;
  /** Half the strand's thickness across its belly. */
  half: number;
  /**
   * How much of each end this strand's tendon takes.
   *
   * Emitted rather than recomputed from `bow`, because it is not a function of
   * this lane's bow alone: a row of siblings shares one run so that they cannot
   * cross (see `runAcross`), and it is additionally clamped to the range. Two
   * derivations of it is exactly the mistake this file has already paid for with
   * `hFit`.
   */
  run: number;
  /**
   * The flat middle, in x — where this lane's name is written and where anything
   * drawn inside it is laid out.
   *
   * `bellyX0 = x0 + run` and `bellyX1 = x1 − run` by construction, and they are
   * carried anyway for the same reason `run` is: a test or a renderer that
   * rebuilds them is a second writer of the drawn shape.
   */
  bellyX0: number;
  bellyX1: number;
  /** The height of the belly: `yc + bow`. */
  bellyY: number;
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
  /**
   * The **stub** this lane hangs off, or null when it lies on its parent's own
   * line.
   *
   * The two are different claims and only one of them is "this is a
   * decomposition of that". A step is drawn *on* the line it decomposes, and
   * `a step drawn inside a lane sits ON that lane, at both of its ends` asserts
   * exactly that over every nested lane. An **ingredient** is not a
   * decomposition of the strand that consumes it — it hangs off the side, at the
   * end of a stub — so its fan starts at the stub's end and is off its parent's
   * curve by construction. Carried as a field rather than inferred, because the
   * alternative is that invariant quietly acquiring a "unless it looks like a
   * feed" clause and stopping being total.
   */
  feedKey: string | null;
  /** What is drawn: the short form if the node has one, else the full label,
   *  either way cut to the column by `fitLabel`. */
  label: string;
  /** The full name, always — the `<title>`, the accessible list, the print view. */
  fullLabel: string;
  /**
   * The authored short name if this lane drew one, else null.
   *
   * Carried so a test — and a reader of the data — can tell "drawn short because
   * a human wrote a short name" from "machine-cut by the width cap", which is
   * `labelTruncated`. Those are different events and only one of them is a
   * defect: the two existing assertions that `label === fullLabel` must relax to
   * allow the first while still catching a short form written into `fullLabel`.
   */
  shortLabel: string | null;
  /**
   * The count drawn at the end of `label`, or null — see `PlanStrand.repeatMark`.
   *
   * Emitted rather than re-derived: the renderer's only handle would be
   * `nodeId`, and the mark is a fact about *this occurrence* of that node, not
   * about the node. A lookup keyed on the id would put HHL's `×O(κ)` on the
   * QSVT lane drawing the same `state-preparation` slot.
   */
  repeatMark: string | null;
  /**
   * The address of the earlier occurrence drawing this lane's interior, or null
   * — see `dedupSharedInteriors` (W15).
   *
   * When set, the lane draws shut with `⤴` at its name, its `openHref` is the
   * jump to that address (`?at=`, a same-pathname navigation `canvas-continuity`
   * intercepts), and `spokenName` says the sentence the symbol abbreviates.
   */
  sharedWith: string | null;
  /**
   * What this lane narrows, drawn and spoken — see `StrandRefinement`.
   *
   * Emitted rather than looked up from `nodeId` for the reason `repeatMark` is,
   * with one addition: the spoken form names the parent in full, and the parent
   * is a *second* node. A renderer holding one node id cannot reach it, and a
   * renderer that could would be a second reader of a relation the layout has
   * already read.
   */
  refinement: StrandRefinement | null;
  labelTruncated: boolean;
  /**
   * A run of named hops, drawn as its hops and never under a name of its own.
   * Its `fullLabel` is `A → B`, which is the honest answer in a `<title>` and is
   * the coined composite the owner refused when drawn. See `PlanStrand.composite`.
   */
  composite: boolean;
  /**
   * This lane has a real name and something else on the canvas already draws it,
   * so it draws none. Distinct from `composite`, which means the name itself
   * must never appear. See `PlanStrand.nameless`.
   */
  nameless: boolean;
  /**
   * The method whose own stretch this is, or null. See `PlanStrand.own`.
   *
   * Carried to the renderer so the phrase this lane draws can be styled as the
   * note it is rather than as a name — the same footnote treatment session 112
   * gave an opened stub's label, and for the same reason: it sits beside real
   * names and must not compete with them.
   */
  own: string | null;
  /** The node this lane draws, open or not. See `PlanStrand.draws`. */
  draws: string | null;
  /**
   * This is a **bone**: a line the reader opened *across* into branches, which
   * keeps a clear middle, wears its own name there, and is drawn thick and
   * dotted so it can be found and clicked to collapse.
   *
   * True only for an opened **fan** (`opensInto: "ways"`). An opened *chain*
   * draws its steps on its own spine — `place` hands them bow 0 — so it has no
   * clear middle to write in and no visible line to thicken; that case is what
   * the **exoskeleton** (`frame`, below) carries instead.
   *
   * Decided here rather than re-derived in the renderer from `opensInto`. The
   * plate under the name, the dotted stroke and the reserved band all have to
   * agree about which lanes are bones, and three readings of one condition is
   * how they come apart.
   */
  bone: boolean;
  /**
   * The **exoskeleton** (W13): the outline of this opened chain's whole band,
   * drawn as a shell around the steps and clickable to collapse.
   *
   * The bone's counterpart for a line opened *along*: its steps partition the
   * belly end to end — measured, 85 of 275 opened lanes had zero collapsible
   * pixels there — so the collapse target moves off the spine entirely, onto
   * the boundary of the band the measurement already reserves. The shape is
   * `ribbonOutline` at the lane's own bow: its two edges are members of the
   * same one-parameter family as every lane, so the crossing-free argument
   * covers the shell without a new proof. The lane's name is written on the
   * shell's outer edge, and the whole outline shares the lane's `openHref`.
   *
   * Null on everything but an opened, non-composite chain.
   */
  frame: { d: string; half: number } | null;
  /**
   * The **bracket** (W13): the outline drawn around this lane's nested
   * refinements, when it has any. Path data only — it is inert (the variants
   * carry their own names and clicks); it exists so adjacency reads as the
   * relation the `⊂` suffix used to spell out. Null when nothing nests here.
   */
  variantBracket: string | null;
  /**
   * This lane IS a nested refinement — drawn under the method it narrows,
   * inside that method's bracket (W13).
   *
   * Carried because `parentKey` alone cannot say it: a variant and a chain
   * step both name the lane they are drawn within, and only one of them is a
   * hop of that lane's route. The interior census reads this to keep a
   * nested peer out of its parent's drawn sequence, and the renderer styles
   * the row as the aside it is.
   */
  variant: boolean;
  /**
   * The name is written INSIDE the line, on its belly, and the whole shape is
   * one destination — the owner's session-119 rule for a process that cannot
   * be expanded any further: *"the label can be inside the process line and
   * it is all one clickable to open the card."*
   *
   * True exactly on a drawn-named lane with nothing inside it. It also
   * retires a measured defect class: a leaf's name used to hang below its
   * band and poke ~3.6px past the room its parent reserved, which is where
   * both of this session's name-graze collisions came from.
   */
  labelInside: boolean;
  /** Where the label sits — clear of the strand's own edge. */
  labelX: number;
  labelY: number;
  /**
   * How wide the drawn label is, so the click target can be the size of the word.
   *
   * Emitted rather than recomputed by the canvas. The renderer would have to
   * import `estimateTextWidth` and call it on the same string, which is a second
   * derivation of one measurement — the mistake this file has already made twice
   * with `hFit`, both times clipping the widest label in a column built to hold
   * it. 0 on a lane that draws no name.
   */
  labelWidth: number;
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
  /**
   * Where clicking the **name** goes instead, on a surface that has a card.
   *
   * Null on the node page and null on any lane with no node id — a lane that is
   * nobody's node has no card to open, and the fallback is `href`.
   *
   * The full page is never lost: `MapCardPanel` draws `card.pageHref` as the
   * card's first link, so repointing a name costs the reader one click rather
   * than a destination. That is the one thing about this change a reader could
   * object to, and it is why the link is at the top of the card rather than the
   * bottom.
   */
  cardHref: string | null;
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
  /**
   * This is the line the page is *about*. False on every lane of a map figure.
   *
   * Only `layoutConvergeForMethod` sets it, and it sets it on exactly one lane:
   * a method's own page draws the fan its method belongs to, and this is which
   * of the siblings the reader came to read. It exists because **`nodeId` cannot
   * do the job** — `planForMethod` writes `id: holds ? method.id : null`, so the
   * 34 leaf methods with nothing inside them carry no id at all, and those are
   * precisely the pages where every lane otherwise looks the same.
   *
   * Not derived downstream from `open` either: a reader can open a sibling, and
   * then two lanes are open and only one of them is the subject.
   */
  subject: boolean;
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
  /**
   * The strand this stub hangs off, as an identity rather than as a prefix.
   *
   * `ConvergeLane` has carried this since keys became hierarchical; a stub never
   * did, so the only way to ask "which ingredients belong to this method" was
   * `feed.key.startsWith(`${lane.key}~`)` — and a **grandchild's** key starts with
   * that same prefix, because a nested stub's key is built from its parent
   * strand's key, which already contains one `~`. A prefix of an address selects
   * the whole subtree under it, never one generation.
   *
   * That is not hypothetical. `no two routes through one slot draw the same
   * interior` summarises a method by its steps and its ingredients, and with the
   * prefix it absorbed the ingredients of anything reachable below it — so the
   * summary changed with **how far that branch happened to open**, which the
   * depth cap and the cycle guard make different at different reach points. It
   * reported `hhl-qpe-inversion draws 3 different interiors depending on where it
   * is reached`. The three interiors were the same method; the helper was reading
   * three different depths of its subtree.
   */
  parentKey: string;
  /** The ingredient's own node id. */
  nodeId: string;
  label: string;
  fullLabel: string;
  /** The authored short name if this stub drew one. See `ConvergeLane.shortLabel`. */
  shortLabel: string | null;
  /** The count drawn at the end of `label`. See `ConvergeLane.repeatMark`. */
  repeatMark: string | null;
  /** What this stub narrows. See `ConvergeLane.refinement`. */
  refinement: StrandRefinement | null;
  labelTruncated: boolean;
  href: string;
  /** As `ConvergeLane.cardHref`: the card for this ingredient, or null. */
  cardHref: string | null;
  /** The stub: from a point beside the strand, outward. */
  x: number;
  y0: number;
  y1: number;
  /** Which way the label sits, so the renderer does not re-derive it. */
  outward: 1 | -1;
  depth: number;
  /**
   * This stub's position in the figure, and what `?open=` names.
   *
   * Numbered after the strand's steps in the same dot path, because `ADDRESS` is
   * positions and dots and nothing else parses — see `planForMethod`.
   */
  address: string;
  /**
   * Where clicking the stub goes: this figure, with the ingredient opened or
   * shut. Null when nothing is recorded inside it, and then it is not a control
   * at all — the same rule R12.2 gives every line.
   */
  openHref: string | null;
  /** The earlier occurrence drawing this stub's interior, or null — see
   *  `ConvergeLane.sharedWith` (W15). The stub's `openHref` is then the jump. */
  sharedWith: string | null;
  open: boolean;
  /** What is inside, whether or not it is open — so a shut stub can say so. */
  inside: number;
  /**
   * The half-band this ingredient's own fan needs — `size.feeds[index].vHalf`
   * from `measure`, the same number `feedReach` and `placeFeeds` compute the
   * fan's actual base from. Recorded rather than left internal so a check can
   * confirm the fan landed where that arithmetic says it should, `y1 +
   * outward · max(0, vHalf − feedRun)`, without a second, hand-carried copy of
   * the formula going stale next to the one that draws it.
   */
  vHalf: number;
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
  /**
   * Lines with something recorded inside that the reader **can still open**.
   *
   * The `openable` clause is the whole point and it was missing. This counted
   * every shut line with anything inside it, and a line at `CONVERGE_DEPTH_MAX`
   * has something inside and no click — so a reader who had opened literally
   * every line on `nonlinear-ode-solve` was told *"33 lines have something
   * recorded inside that you have not opened"* with no clicks left to make.
   * Three of the nineteen figures could never reach *"everything that opens is
   * open"*, which is the sentence this count exists to earn.
   *
   * `cappedCount` is the other half, and the two partition the old number
   * exactly: a lane is shut with something inside, and this figure either will
   * open it or will not.
   */
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
  /**
   * Lines with something recorded inside that this figure will **not** open.
   *
   * A count rather than the boolean it replaces, because the sentence a reader
   * gets is now *how many* — a figure that says "something here goes deeper"
   * gives them nothing to look for, and the number is the difference between
   * the note explaining the shortfall in `collapsedCount` and merely coexisting
   * with it.
   *
   * **Two cuts land here and only one of them is the depth cap.** `openable` is
   * false when the chain hit `CONVERGE_DEPTH_MAX`, and also when the walk has
   * already drawn this node on the way down — a slot whose method delegates
   * back to it. On today's graph the second is **0 of 45** (all 45 sit at the
   * depth ceiling, on three figures), so the note names depth. If a cycle ever
   * arrives, this count is still right and the note's wording is the thing to
   * revisit; that is why the reason is not baked into the number.
   */
  cappedCount: number;
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
 * Centre a row of siblings around `centre` **without letting any of them land on
 * it** — the opened line keeps the middle.
 *
 * The owner's rule, session 104, correcting the reading this file shipped:
 *
 * > *"Make sure that process lines that have been expanded remain in the center
 * > … not blocked/overlayed by any branch so they can be clicked on to collapse.
 * > Even an odd number of branches should all be around it, not a middle one
 * > that covered this collapse line."*
 *
 * The session-96 wording was *"everything expanded from it arranges around it,
 * including for an odd number of branches"*, and `laneOffsets` above reads that
 * as **put one lane through the middle**. It is the opposite reading, and it is
 * the one that shipped: a fan of one — which is what 23 of the 29 decomposed
 * routes produce — got `[0]`, drawn exactly over the 2px spine it was supposed
 * to leave clear. The owner's report is the symptom: *"it was hard to collapse
 * it again."*
 *
 * Implemented as a **virtual sibling** rather than as a special case per parity,
 * so odd and even counts go through one code path and the reserved band is the
 * same band `measure` reserved. A parity branch here is what would let the
 * measurement and the placement disagree by one gap.
 */
export function allocateBowsAroundSpine(
  halves: readonly number[],
  centre: number,
  gap: number,
  spineHalf: number,
): number[] {
  if (halves.length === 0) return [];
  // Ceil, so the extra member of an odd fan sits **above** the bone: the reading
  // order of a fan is top-first, and a reader who opens a line looks up.
  const mid = Math.ceil(halves.length / 2);
  const out: number[] = new Array(halves.length);
  // Packed **outward from the spine's own edges**, not centred as a row that
  // happens to contain the spine. Centring the row is what the first version
  // did, and it only holds the spine at `centre` when the two groups are
  // mirror images: with one child, `[20, 22]` centres to put the child at
  // `centre - 27` and the spine at `centre + 25`, so the child's band reaches
  // `centre - 7` — *inside* the band the spine reserved, which is the whole
  // thing this function exists to prevent, on the 23-of-29 case (a fan of one).
  // Every odd fan drifts the same way.
  let cursor = centre - spineHalf - gap;
  for (let index = mid - 1; index >= 0; index -= 1) {
    const half = halves[index]!;
    out[index] = cursor - half;
    cursor -= half * 2 + gap;
  }
  cursor = centre + spineHalf + gap;
  for (let index = mid; index < halves.length; index += 1) {
    const half = halves[index]!;
    out[index] = cursor + half;
    cursor += half * 2 + gap;
  }
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
/**
 * Pack a row of siblings on **one side only**, outward from a clearance.
 *
 * The variant row's allocator (W13): refinements nest under their parent's own
 * line, on the side the parent already bows, so the packing starts past the
 * band the parent keeps for itself — its content, its ingredients, its name —
 * and walks outward. Returns unsigned magnitudes off the parent's base; the
 * placement multiplies by the outward sign, so measurement and drawing read
 * one arithmetic. Exported for the same reason `allocateBowsAroundSpine` is:
 * the row is measured and placed from the same call, and the test file can
 * reach the rule without building a figure.
 */
export function allocateBowsOutward(
  halves: readonly number[],
  gap: number,
  clearance: number,
): number[] {
  const out: number[] = [];
  let cursor = clearance + gap;
  for (const half of halves) {
    out.push(cursor + half);
    cursor += half * 2 + gap;
  }
  return out;
}

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
 * The name to **draw**, when the node carries one authored for drawing.
 *
 * Resolved here, at the plan, and never in the renderer. The renderer's only
 * handle on a node would be `lane.nodeId`, and that is `null` on 586 of the 1914
 * named lanes the graph can draw — including the widest name in the whole graph
 * (`ross-selinger-synthesis`, four levels down under `compile-to-device`). A
 * renderer-side lookup would therefore have shortened exactly the lanes that did
 * not need it and left the ones that did.
 *
 * Returns null rather than falling back to the full label, so that every caller
 * has to write `?? label` and the one place that must NOT — `fullLabel`, which
 * feeds the `<title>` — is visible as an absence of that operator.
 */
function shortLabelOf(
  item: { shortLabel?: string; shortLabelJa?: string },
  locale: PublicLocale,
): string | null {
  return (locale === "ja" ? item.shortLabelJa : item.shortLabel) ?? null;
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
  address: string,
  at?: string | null,
  /**
   * The node this lane draws, if it has one.
   *
   * Shutting has to remove whatever is actually holding the lane open, and an
   * inherited `?open=<id>` from a link written before addresses existed holds
   * *every* lane that node appears on. Dropping only the address would leave the
   * id behind and the lane open, so the shut control would do nothing — the dead
   * control this canvas has now produced twice. Removing the id shuts its
   * siblings too, which is the old behaviour and the honest reading of a URL that
   * asked for it by name.
   */
  id?: string | null,
): string {
  return figureHref(focus, toggledOpen(open, address, id), at);
}

/**
 * The set after toggling one lane — the arithmetic `toggleHref` and
 * `innerToggleHref` share, extracted so the two serializers cannot come to
 * disagree about what a toggle *is* while agreeing about where it writes.
 */
function toggledOpen(
  open: ReadonlySet<string>,
  address: string,
  id?: string | null,
): Set<string> {
  const next = new Set(open);
  // **Both forms, unconditionally**, and only then decide whether to add.
  // Written as an if/else-if first, which is wrong for the one input a click can
  // never produce and a URL can: `?open=` carrying the address *and* the node id
  // for the same lane. The address was removed, the id kept holding it open, and
  // the shut control did nothing — the dead control this canvas has now produced
  // twice. `?open=` is user-supplied and shareable, so "a click cannot reach it"
  // is not an argument. Caught in review.
  const heldByAddress = next.delete(address);
  const heldById = id !== null && id !== undefined ? next.delete(id) : false;
  if (!heldByAddress && !heldById) next.add(address);
  return next;
}

/**
 * The address that opens — or shuts — one line **of the truncated map inside
 * the card**, leaving everything else as it is.
 *
 * The same toggle as `toggleHref`, written to `?iopen=` on the *outer* address
 * instead of to `?open=` on a fresh one. Same address grammar, different key:
 * the truncated figure's lanes have addresses in exactly the form the outer
 * figure's do, and writing them under `?open=` would open lanes on the map
 * *behind* the card — the two sets describe two different figures and must not
 * share a key. Writing onto `base` rather than through `figureHref` is what
 * keeps the reader's focus, outer open set, viewport, card and inner intact
 * across every click inside the panel; see `withIopen` for that argument.
 */
export function innerToggleHref(
  base: string,
  open: ReadonlySet<string>,
  address: string,
  id?: string | null,
): string {
  return withIopen(base, toggledOpen(open, address, id));
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
  /**
   * What `?open=` names: **this lane**, and no other.
   *
   * A dotted path of positions from the figure's root — `1.0.3` is the fourth
   * child of the first child of bundle 1's lane 0. Not the node id, which is what
   * it used to be and which opens every lane that node appears on: `nonlinear-ode-solve`
   * has one node on twelve lanes and one click flipped five of them at once, in
   * unrelated parts of the canvas. Not `key` either, though `key` is unique and
   * stable (measured: 0 duplicates and 0 identity mismatches over 41 figure/open-set
   * pairs) — a key is a path of *names* and runs to 177 characters, so a saturated
   * figure would need a 6.5 KB query string. A path of positions says the same
   * thing in eight.
   *
   * Stable for the same reason the key is: every position comes from a
   * `.map()` over a list the graph decides — `methodsRealizing`, `route.segments`,
   * the bundle's lanes — none of which the open set can reorder.
   *
   * Never null: every lane has a position even when it has no node. That is the
   * point — the run lane and the method's own segment could not be named at all
   * before, because naming was by id and they have none.
   */
  address: string;
  /**
   * The node this lane draws, for the Atlas mark and for back-compatible `?open=`.
   * Null on a shape with no node of its own.
   */
  id: string | null;
  /** The full name. Always. This is what rides in the `<title>`. */
  label: string;
  /**
   * The authored short name, when the node has one — what the map draws instead.
   *
   * Carried on the strand rather than looked up at the shape, because `id` is
   * null on 586 of the 1914 named lanes and a lookup keyed on it would miss
   * precisely the deepest, widest ones. Null means "draw `label`".
   */
  shortLabel: string | null;
  /**
   * How many times **the route above this lane** walks it — `×T/h`, `×O(κ)`.
   *
   * ## It belongs to the edge, not to the node, and that is why it is here
   *
   * `state-preparation` is walked an uncounted once by `qsvt-matrix-inversion`
   * and O(κ) times by `hhl-qpe-inversion`, and it is one node drawn on both
   * lanes. A lookup keyed on `id` at the shape would put HHL's count on the QSVT
   * lane —
   * the mark is a fact about *this occurrence*, so it is set where the occurrence
   * is planned and carried down with it, exactly as `shortLabel` is.
   *
   * ## Where it comes from
   *
   * `planForMethod` sets it on the two kinds of child it plans from a route:
   * the hops of the chain, and the ingredients. Measured, 7 of the corpus's 10
   * records are ingredients — the three readouts' ε^-2 and HHL's two κ's are
   * facts about a **stub**, not about the spine — so a mark drawn on the chain
   * alone would have reached 3 of them.
   *
   * ## Null is the common and correct case
   *
   * 10 records over 1,914 named lanes. Null means no source we read said this
   * lane is walked more than once, which is not the same as once — the same
   * reading `LayerMethod.repeats` states, and nothing here derives a count.
   */
  repeatMark: string | null;
  /**
   * That this lane is a **narrower version** of another method — see
   * `StrandRefinement`.
   *
   * ## The opposite of `repeatMark` in exactly one way
   *
   * A count belongs to the occurrence; a refinement belongs to the *node*.
   * `lightsabre-routing` is a narrower SABRE on every lane that ever draws it,
   * on every figure, so this is set once where the method's own strand is
   * planned and never varies by route. That is why it is set in `planForMethod`
   * from the method itself rather than passed in by whoever planned the hop.
   *
   * Null on 58 of the 63 methods and on every capability. Null means no source
   * declared this a narrowing of a sibling — the reading `LayerMethod.refines`
   * states, and nothing here infers one from a shared chain.
   */
  refinement: StrandRefinement | null;
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
  /**
   * Whether clicking the body would actually draw what is inside.
   *
   * Not the same as `inside > 0`, and the gap between the two was 39 lines.
   * `inside` is set unconditionally from the child count while opening is gated
   * on the depth cap, so a line at the ceiling said "opens into 4", carried a
   * live open link, and rendered shut when the reader took it up on the offer —
   * on `nonlinear-ode-solve`, 27 lines did that at once. A control that does
   * nothing does not read as a limit; it reads as a broken surface, and it
   * teaches the wrong rule about every other line on the canvas.
   */
  openable: boolean;
  /**
   * A run of named hops, whose `label` is `A → B` and must never be **drawn**.
   *
   * > *"don't invent composite processes… integrator+qls should not be one
   * > composite process"* — owner
   *
   * The string exists because a `<title>` and a list row still have to say what
   * the line is, and "A → B" is the honest answer there: it names the hops rather
   * than coining a name for their union. Drawn on the canvas it becomes exactly
   * the coined composite the owner refused — so the run lane is drawn as its
   * hops, and the hops carry the names.
   *
   * An explicit field rather than the coincidence that `open && !openable` picks
   * out the same lane. It does today, and relying on it is how the `openHref`
   * expression above ended up with two clauses that cancelled: this restored the
   * canvas's opened names and the composite came back with them, because the
   * suppression that had been holding it down was `strand.open ? "" : …` and was
   * doing two unrelated jobs at once.
   */
  composite: boolean;
  /**
   * This strand has a real name, and something else on the canvas is already
   * drawing it.
   *
   * **A second field rather than a second use of `composite`**, and the comment
   * above says why in this file's own words: the last time one flag did two
   * unrelated jobs here, restoring the opened names brought the coined composite
   * back with them. `composite` means *"this name was coined by joining two
   * concepts and must never appear"*; this means *"this name is correct and is
   * already on the page once."* They suppress the same drawing for opposite
   * reasons, and a future session that lifts one must not lift the other.
   *
   * True on **two** kinds of strand. The remainder hop, the part of a route the
   * method performs itself: its name is the method's, and the method's name is
   * written on the bone or the exoskeleton above it. And, since session 118, the
   * base an open ingredient's fan hangs from: its name is the stub's, drawn one
   * shape above it, and drawing it twice is what the owner was reading as a
   * repeat. See `placeFeeds`.
   */
  nameless: boolean;
  /**
   * The node this lane **draws**, whether or not it can be opened.
   *
   * **Not `id`, and the difference is 34 of the 63 methods.** `id` answers *what
   * does `?open=` name here*, and `planForMethod` sets it to null on a leaf —
   * a method with nothing recorded inside has no open control, so there is
   * nothing for `?open=` to name. But the lane still carries that method's name,
   * still links to its page, and a reader clicking it is asking about the
   * method. Reading `id` for the card therefore left every leaf's name pointed
   * off the map, silently, while the branches beside it opened cards.
   *
   * Null on exactly two shapes, both of which draw nobody's name: the run of
   * named hops, and the stretch a method performs itself — and the second one
   * has `own` instead.
   */
  draws: string | null;
  /**
   * The method whose **own** stretch this is, or null on every other strand.
   *
   * A separate field from `nameless`, and the third time this file has had to
   * split one flag that was doing two jobs. `nameless` says *"do not draw
   * `label`, something else on the canvas already does"*; this says *"this hop is
   * a method doing its own work and no slot covers it"*. They coincide on
   * today's graph and they are not the same claim: the day a second kind of
   * strand borrows a name already drawn, `nameless` will be true on something
   * that is nobody's own stretch, and the label and the card would both follow it
   * there.
   */
  own: string | null;
  opensInto: OpensInto | null;
  slots: readonly string[];
  interior: readonly string[];
  ways: number;
  /**
   * Ingredients this strand consumes, drawn once it is open.
   *
   * **A full strand each, not a name and a link.** They were a flat
   * `{id,label,href}` record, which is what made `state-preparation` and
   * `success-amplification` — the two the owner named — unopenable: the layout
   * read "not a stage" as "not openable" and there was nothing on a feed to
   * open. They are slots like any other, planned by `planForSlot`, so a feed
   * that is open carries its own fan of methods and every one of those is a
   * `ConvergeLane`. That last part is the load-bearing half: the test sweep
   * enumerates `diagram.lanes`, so a fan emitted any other way would leave the
   * crossing-free, canvas-bounds and angle-cap checks green over a set that
   * excludes the whole feature.
   */
  feeds: PlanStrand[];
  /**
   * Narrower versions of this method, nested under its own line (W13).
   *
   * Planned whether or not the strand is open — the owner's rule is that
   * *"the refinements are there during the same expansion"*, and the expansion
   * they mean is the fan that drew the parent, not a further click on it. Full
   * strands, for the reason `feeds` are: a refinement is a method, it can open
   * into its own chain, and everything it draws has to land in
   * `diagram.lanes` where the sweeps can see it.
   *
   * Empty on every strand that is not a fan-grouped parent —
   * `methodFanGroups` is the one writer of who nests under whom, so a method
   * that is itself a variant plans none and the recursion grounds there.
   */
  variants: PlanStrand[];
  /**
   * The address of the earlier occurrence that draws this strand's interior,
   * when `dedupSharedInteriors` demoted this one — absent everywhere else (W15).
   *
   * Optional rather than `| null` on every constructor, because exactly one
   * writer exists (the dedup pass) and it runs after planning; a constructor
   * that set it would be a second writer of a fact the pass derives.
   */
  sharedWith?: string;
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
  /** The parent's `?open=` address; a child's is this plus its position. */
  parentAddress: string,
): { layout: "fan"; children: PlanStrand[]; count: number } | null {
  // Grouped (W13): a refinement rides inside its parent's lane, here exactly
  // as on the figure's own fan — `methodFanGroups` is the one writer of the
  // grouping, and `planForMethod` nests each group's variants itself.
  const groups = methodFanGroups(graph, slotId);
  if (groups.length === 0) return null;
  return {
    layout: "fan",
    count: groups.length,
    children: groups.map((group, index) =>
      planForMethod(
        graph,
        vocabulary,
        group.method,
        locale,
        open,
        depth,
        seen,
        `${parentKey}/`,
        `${parentAddress}.${index}`,
      ),
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
 * A hop this route has **pinned** with `via` is drawn as the pinned method, not
 * as the slot; see the comment on that branch below for what that was costing.
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
  /** The parent's `?open=` address — see `fanInside`. */
  parentAddress: string,
): { layout: "chain"; children: PlanStrand[]; boundaries: string[]; count: number } | null {
  const route = routeOf(graph, vocabulary, method);
  // A single segment is drawn too, now that a method may open for its
  // ingredients alone. It is one piece of curve exactly where the parent's spine
  // is, which is honest: this method's whole route is itself, and the things
  // hanging off it are what it needs.
  if (route.segments.length === 0) return null;
  const children = route.segments.map((segment, index) => {
    if (segment.capabilityId) {
      // **The `via` pin, drawn.** `via[step]` is the graph saying *this* route
      // fills that step with *that* algorithm, read off a primary source; the
      // field has existed since session 94 and until now nothing on the canvas
      // read it, so seven of the corpus's eight pins were inert. Measured on the
      // authored graph before this: `taylor-all-at-once`, `krovi-linear-ode` and
      // `dyson-all-at-once` drew one identical interior — *discretize, then
      // solve* — and so did `lchs-route`, `lchs-improved-kernel` and
      // `schrodingerisation`, and so did `level-set-observable-route` and
      // `homotopy-perturbation-route`. Six methods out of eight in three groups,
      // each group one picture, because the hop could only ever name the slot
      // several routes share.
      //
      // Pinned, the hop is the **filler's** own lane rather than the slot's, so
      // it wears the algorithm's name and opens into that algorithm's interior
      // instead of into the fan of alternatives the route did not take. That
      // second half is the point as much as the name is: a route that says it
      // uses the truncated Taylor propagator is not offering the reader a choice
      // of four discretizations at that hop.
      //
      // The same shape as `planForNarrowed`, including the fallback: a pin that
      // does not resolve to a method draws the slot. `validateLayerGraph`
      // already refuses a pin that names a capability, an unknown id, or a
      // method filling some other slot — but this function is reached from a
      // route handler and has to be total on any input, and a silent slot is a
      // truthful drawing where a throw is a 500.
      const pinned = method.via?.[segment.capabilityId];
      const filler = pinned === undefined ? null : layerNode(graph, pinned);
      if (filler && isMethod(filler) && filler.realizes === segment.capabilityId) {
        // The mark is keyed on the **slot**, not on the filler, because that is
        // what `repeats` is keyed on: the route says it walks *this step* T/h
        // times, and which algorithm fills the step is a separate record. A pin
        // must not lose the count.
        return withRepeatMark(
          planForMethod(
            graph,
            vocabulary,
            filler,
            locale,
            open,
            depth,
          // The **slot** joins `seen`, not just the filler. `planForMethod` cuts
          // the recursion on the method's own id; the slot is what a route below
          // could delegate back to, and pinning must not open a door the
          // unpinned hop had shut. Every pin in the corpus today names an
          // atomic filler, so this cannot bite yet — which is exactly when a
          // cycle guard is cheap to get right.
            new Set([...seen, segment.capabilityId]),
            `${parentKey}/${index}/`,
            `${parentAddress}.${index}`,
          ),
          method,
          segment.capabilityId,
          locale,
        );
      }
      return withRepeatMark(
        planForSlot(
          graph,
          vocabulary,
          segment.capabilityId,
          locale,
          open,
          depth,
          seen,
          `${parentKey}/${index}/`,
          `${parentAddress}.${index}`,
        ),
        method,
        segment.capabilityId,
        locale,
      );
    }
    // The part of the route the method performs itself — 23 of the 29 decomposed
    // routes have one, and it is a real process, not a hole.
    //
    // It has no id of its own: its id would be the method's, so `?open=` could
    // not tell "open the method" from "open the piece of the method that is the
    // method".
    //
    // **And it is no longer named.** Owner, session 104, on seeing it:
    // *"Time marching is all over the place — expands into propagation then
    // itself."* That is this segment: `time-marching-usva` delegates one step,
    // stops at `linear-system`, and its own name was drawn again as the hop to
    // the answer, so opening it appeared to produce a copy of itself. There is
    // no cycle in the graph — measured, 0 cycles over all 78 nodes — only a name
    // printed twice.
    //
    // The reason it *was* named has been removed rather than overruled: the note
    // here used to argue that an unlabelled segment inside an unlabelled lane
    // gives the reader nothing to read, and that was true while an opened lane
    // dropped its own name. It does not any more — an opened fan writes its name
    // on the bone, and an opened chain wears it on the exoskeleton. The name is
    // on the page exactly once, which is what it always should have been.
    //
    // `fullLabel` still carries the method's name, so the `<title>` and the
    // accessible list beside the figure lose nothing.
    return {
      key: `${parentKey}/${index}/own`,
      address: `${parentAddress}.${index}`,
      id: null,
      label: labelOf(method, locale),
      shortLabel: shortLabelOf(method, locale),
      // The stretch a method closes itself is not one of its steps, so nothing
      // can have recorded a multiplicity for it. See `repeatMark`.
      repeatMark: null,
      // Nor a refinement: this is a *step*, and only a method narrows a method.
      refinement: null,
      href: `/repository/layers/${method.id}`,
      standing: "recorded" as LaneStanding,
      open: false,
      layout: null,
      children: [],
      boundaries: [],
      inside: 0,
      openable: false,
      composite: false,
      nameless: true,
      draws: null,
      own: method.id,
      opensInto: null,
      slots: [],
      interior: [],
      ways: 0,
      feeds: [],
      variants: [],
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
  address: string,
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
  const isOpen = canOpen && isOpenedBy(open, address, slotId);
  const key = `${keyPrefix}slot:${slotId}`;
  const inside = isOpen
    ? fanInside(
        graph,
        vocabulary,
        slotId,
        locale,
        open,
        depth + 1,
        new Set([...seen, slotId]),
        key,
        address,
      )
    : null;
  return {
    key,
    address,
    id: methods.length > 0 ? slotId : null,
    label,
    shortLabel: node ? shortLabelOf(node, locale) : null,
    // Set by whoever plans this occurrence, not here: a slot is one node on
    // many lanes and the count belongs to the route above it. See `repeatMark`.
    repeatMark: null,
    // A slot is a capability. `refines` is a relation between two methods, so a
    // slot's own lane never carries one — the methods inside its fan do.
    refinement: null,
    href: `/repository/layers/${slotId}`,
    standing: "recorded",
    open: isOpen && inside !== null,
    layout: inside?.layout ?? null,
    children: inside?.children ?? [],
    boundaries: [],
    inside: methods.length,
    openable: canOpen,
    composite: false,
    nameless: false,
    draws: node === null ? null : slotId,
    own: null,
    opensInto: methods.length > 0 ? "ways" : null,
    slots: [slotId],
    interior: [],
    ways: methods.length,
    feeds: [],
    // A slot is a capability, and only a method narrows a method — the same
    // reason its `refinement` above is null.
    variants: [],
  };
}

/**
 * The position a variant takes in its parent's address namespace: after the
 * steps and after the feeds.
 *
 * Derived from the **route** rather than from what was planned, because a shut
 * parent plans neither its children nor its feeds and its variants are drawn
 * anyway — an address that shifted when the parent opened would silently shut
 * a variant the reader had opened. One writer: `planForMethod` numbers the
 * variants with it and the subject match on a method's own page
 * (`layoutConvergeForMethod`) reads it back.
 */
function variantPosition(
  route: { segments: readonly unknown[]; feeds: readonly unknown[] },
  index: number,
): number {
  return route.segments.length + route.feeds.length + index;
}

/**
 * Whether a method's lane has anything inside it to draw — the **single
 * writer** of "this method has an interior".
 *
 * **Or `feeds`, not just `segments`.** Twelve of the twenty-nine decomposed
 * methods have exactly one segment and at least one ingredient — every step
 * they name is something they *need* rather than a stage they pass through —
 * and requiring two segments made all twelve of them inert. `hhl-qpe-inversion`
 * names three steps and opened into nothing at all.
 *
 * Exported for the method card's expand control (W9): *"the method card gets it
 * too where the method has an interior"* has to mean the same interior the lane
 * opens into, or the card offers a truncated map that expands into nothing —
 * which is precisely what a view-side re-derivation from `segments` alone did
 * to `hhl-qpe-inversion` a second time, caught on the served page.
 */
export function methodHasInterior(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  method: LayerMethod,
): boolean {
  const route = routeOf(graph, vocabulary, method);
  return route.segments.length >= 2 || route.feeds.length > 0;
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
  address: string,
  // s121 (W17): the one folded refinement this figure draws anyway — set only
  // by the subject's own page, threaded to the grouping and NOT into the
  // recursion below, because the unfolded id realizes THIS slot and can appear
  // nowhere deeper.
  unfold?: string,
): PlanStrand {
  const route = routeOf(graph, vocabulary, method);
  const segments = route.segments.length;
  // See `methodHasInterior` — one predicate, drawn on by the lane and offered
  // on by the card, so the two cannot disagree about what opens.
  const holds = methodHasInterior(graph, vocabulary, method);
  const canOpen = holds && depth < CONVERGE_DEPTH_MAX && !seen.has(method.id);
  const isOpen = canOpen && isOpenedBy(open, address, method.id);
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
        address,
      )
    : null;
  // An ingredient is a slot, so it plans as one — the same `planForSlot` the
  // steps use, which is what gives a feed a fan, an `openHref` and an address.
  //
  // **Positions continue past the steps rather than starting a namespace of
  // their own.** `ADDRESS` is `<subject>:\d+(\.\d+)*` and nothing else parses,
  // so a `~n` or `f n` segment would need the grammar widened on both surfaces
  // that read `?open=`. A feed *is* one of the things inside this strand, and
  // numbering it after the steps says exactly that. The count is taken from the
  // planned children rather than from `segments`, because those are the same
  // positions `chainInside` just handed out.
  const childCount = inside?.children.length ?? 0;
  const feeds = isOpen
    ? route.feeds.map((id, index) =>
        // **Where most of the repeat marks land.** Measured against `routeOf`:
        // 7 of the corpus's 10 records key a `feeds` step rather than a hop —
        // the three readouts' ε^-2 and HHL's two κ's are facts about a stub —
        // so a mark written only onto the chain would reach 3 of them.
        withRepeatMark(
          planForSlot(
            graph,
            vocabulary,
            id,
            locale,
            open,
            depth + 1,
            new Set([...seen, method.id]),
            `${key}~`,
            `${address}.${childCount + index}`,
          ),
          method,
          id,
          locale,
        ),
      )
    : [];
  // The narrower versions nested under this line (W13). `methodFanGroups` is
  // the one writer of the grouping: a method that is itself a variant finds no
  // group of its own here, so the recursion grounds one level down, and a
  // `refines` cycle — which the grouping degrades to a flat fan — plans no
  // nesting at all. `seen` is honoured for the same reason it is everywhere
  // else: a variant already drawn on the way down must not be drawn again
  // inside itself.
  const ownGroup = methodFanGroups(graph, method.realizes, unfold).find(
    (group) => group.method.id === method.id,
  );
  // `flatMap` over the group with its own index, never filter-then-map: a
  // variant skipped by the `seen` guard must not shift its siblings' positions,
  // or the same variant would answer to different addresses in different
  // drawings of one figure.
  // Planned at the PARENT's depth, not one deeper. A refinement is a peer of
  // the method it narrows — another way of filling the same slot, re-analysed
  // — so nesting it must not spend a rung of the reader's depth budget: at the
  // ceiling, `depth + 1` here cost the four-root overview eight open controls
  // that existed before the grouping (73 → 65 reachable addresses, measured).
  // The drawing still steps it visually — `place` and `measure` take their own
  // depth argument and pass `depth + 1` for the taper and the receding style.
  const variants = (ownGroup?.variants ?? []).flatMap((variant, index) =>
    seen.has(variant.id)
      ? []
      : [
          planForMethod(
            graph,
            vocabulary,
            variant,
            locale,
            open,
            depth,
            new Set([...seen, method.id]),
            `${key}+`,
            `${address}.${variantPosition(route, index)}`,
          ),
        ],
  );
  return {
    key,
    address,
    id: holds ? method.id : null,
    label: labelOf(method, locale),
    shortLabel: shortLabelOf(method, locale),
    // A method is not a step of itself. Its *steps* carry the marks, and
    // `planForMethod` writes them onto the children it plans below.
    repeatMark: null,
    // The refinement, by contrast, is the method's own and is set right here:
    // it is true of this node wherever it is drawn, not of one route through it.
    refinement: refinementOf(graph, method, locale),
    href: `/repository/layers/${method.id}`,
    standing: "recorded",
    // Open even when there is no chain to draw: the ingredients are the whole
    // of what a single-segment method has recorded, and they are worth drawing.
    open: isOpen && holds,
    layout: inside?.layout ?? null,
    children: inside?.children ?? [],
    boundaries: inside?.boundaries ?? [],
    // `route.feeds`, not the planned `feeds`: a shut method has no planned
    // feeds and still has to say how many things are inside it, or its own
    // control reads as opening into nothing.
    inside: holds ? segments + route.feeds.length : 0,
    openable: canOpen && holds,
    composite: false,
    nameless: false,
    // The method, always — `id` above goes null on a leaf and the name does not.
    draws: method.id,
    own: null,
    opensInto: holds ? "steps" : null,
    slots: [],
    interior: [],
    ways: 0,
    feeds,
    variants,
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
  address: string,
): PlanStrand {
  const named = laneName(graph, lane, locale);
  if (lane.edges.length === 1) {
    const plan = named.narrowedBy
      ? planForNarrowed(graph, vocabulary, named.narrowedBy, locale, open, lane, address)
      : planForSlot(
          graph,
          vocabulary,
          lane.edges[0]!.slot,
          locale,
          open,
          0,
          new Set(),
          `${lane.key}:`,
          address,
        );
    // `plan.key`, not `${lane.key}:${plan.key}`. The prefix was applied twice —
    // once here and once as the `keyPrefix` argument above — which left 20 of 284
    // child lanes carrying a key their parent's key is not a prefix of. Nothing
    // depended on the doubling; the keys stayed unique either way, so it was
    // invisible until something wanted to read the hierarchy back out of a key.
    return { ...plan, standing, interior: lane.interior };
  }
  const runKey = `run:${lane.key}`;
  const children = lane.edges.map((edge, index) =>
    planForSlot(
      graph,
      vocabulary,
      edge.slot,
      locale,
      open,
      1,
      new Set(),
      `${runKey}/${index}/`,
      `${address}.${index}`,
    ),
  );
  return {
    key: runKey,
    address,
    id: null,
    label: named.text,
    // A run lane's name is `A → B`, built from its hops rather than authored on
    // any one node, so there is nothing to shorten and nothing to shorten it
    // from. It is never drawn anyway — `composite` below — so this is null for
    // the same reason the label is not drawn: the hops carry the names.
    shortLabel: null,
    // Null for the same reason, and it costs nothing: a composite draws no name
    // at all, so a mark on it would be measured into a width nothing uses.
    repeatMark: null,
    refinement: null,
    href: named.href,
    standing,
    open: true,
    layout: "chain",
    children,
    boundaries: [...lane.interior],
    inside: lane.edges.length,
    // A run of named hops is drawn open from the start and has no id for
    // `?open=` to name it by, so there was never anything to click.
    openable: false,
    composite: true,
    nameless: false,
    draws: null,
    own: null,
    opensInto: "steps",
    slots: named.slots,
    interior: lane.interior,
    ways: laneFillers(graph, lane).length,
    feeds: [],
    variants: [],
  };
}

function planForNarrowed(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  methodId: string,
  locale: PublicLocale,
  open: ReadonlySet<string>,
  lane: BundleLane,
  address: string,
): PlanStrand {
  const node = layerNode(graph, methodId);
  if (!node || node.kind !== "method") {
    return planForSlot(
      graph,
      vocabulary,
      lane.edges[0]!.slot,
      locale,
      open,
      0,
      new Set(),
      `${lane.key}:`,
      address,
    );
  }
  return planForMethod(graph, vocabulary, node, locale, open, 0, new Set(), `${lane.key}:`, address);
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

/**
 * How much further out an ingredient reaches than what is drawn inside the
 * strand consuming it.
 *
 * **The stub's own length plus whatever is drawn at the end of it** — not the
 * constant `innerStateRadius + feedRun + labelBand` this replaced. That constant
 * was the height of a stub with a name on the end, which was the whole of what
 * an ingredient could ever be while it could not open. It can now, so the room
 * it needs is a measurement of its own fan.
 *
 * One function, read by the three `measure` branches that reserve the band and
 * by the `placeFeeds` that draws into it, so a reservation and a drawing cannot
 * come to different answers.
 */
function feedReach(feeds: readonly Measure[]): number {
  if (feeds.length === 0) return 0;
  // **The fan's own half-band, twice, only for the part of it that is not
  // already spent on the stub.** A fan is allocated around its own base, so a
  // base placed at the stub's end puts half the fan back *inward* — through
  // the belly the stub hangs off and into whatever that strand drew inside
  // itself. Measured, before the fix below existed: on `quantum-linear-solve`
  // the `state-preparation` stub ended at y=6272.7 and two of its three
  // children were drawn at 6162.8 and 6209.7, 110px and 63px the wrong side of
  // it, landing on a lane inside the chain at 6167.0 — same x, 4.2px apart.
  // That is 10 of the 10 opened-against-shut name overlaps this branch was
  // parked on. So `placeFeeds` pushes the base out by the fan's own half-band
  // and the fan occupies `[stub end, stub end + 2·vHalf]` outward — that fixed
  // the 10 overlaps, at the cost of `feedRun + 2·vHalf` of height for every
  // opened ingredient, which tripped the height ceiling: `time-discretization`
  // (en) measured 16,836px against the 16,000px bar.
  //
  // **`feedRun` was never a clearance requirement — it is the length the
  // *stub itself* is drawn.** The clearance requirement is only that the fan's
  // inward half not reach back past `innerReach`, which is `max(feedRun,
  // vHalf)` beyond it, not `feedRun + vHalf`: when `vHalf ≤ feedRun` the stub
  // is already long enough that the fan's own half-band, folded back inward
  // from the stub's end, cannot reach `innerReach` at all, and no push is
  // owed. Only the excess of `vHalf` over `feedRun`, if any, is real demand.
  // Reserved here, spent in `placeFeeds`'s `fanY` by the identical formula —
  // one number, so a reservation and a drawing still cannot come to different
  // answers.
  return Math.max(
    ...feeds.map((feed) => Math.max(CONVERGE_METRICS.feedRun, feed.vHalf) + feed.vHalf),
  );
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
   * How much **tendon run** everything inside this strand consumes, in this
   * strand's own x-units.
   *
   * A second number rather than part of `hFit`, and the reason is the one `hFit`
   * has already been got wrong for twice: `hFit` is the budget a label is fitted
   * against, and that budget must stay exactly the measured *label* demand. A
   * fan that needs room for its tendons has not earned its labels more
   * characters, and letting it would make the drawn text depend on how many
   * siblings a line has.
   *
   * It recurses, and it has to. Each level of nesting spends two runs — one at
   * each end of the belly — before its children get any x at all, and a chain
   * multiplies whatever its steps spend by `k`, because `place` hands each step
   * a `1/k` slice of the belly. Same multiplier and same reason as
   * `chainColumnNeed`.
   *
   * **This is what replaced `hDev`/`hScale`, and it is bounded where they were
   * not.** Those carried a bow down the tree and turned it into `4·|bow|` of
   * column at the top, which is why a saturated figure measured 87,449px wide.
   * A run is capped at `maxTendonRun` however large the bow gets, so the width
   * a level can demand is bounded by its depth rather than by its geometry.
   */
  hRun: number;
  children: Measure[];
  /** One per `PlanStrand.feed`, in the same order — `placeFeeds` indexes it. */
  feeds: Measure[];
  /** One per `PlanStrand.variants`, in the same order — the variant row in
   *  `place` indexes it, and the wrapper half of `measure` is its one writer. */
  variants: Measure[];
  /**
   * How far out everything drawn **inside** this strand reaches, before its own
   * name and before anything hanging off it.
   *
   * The number a stub has to start past, and it is stored rather than recomputed
   * because the two ways of getting it disagree on exactly the shape that
   * matters. `placeFeeds` took `max(children.vHalf) + innerStateRadius`, which is
   * right for a **chain** — its steps sit on the spine — and wrong for a **fan**,
   * whose children are at allocated offsets and reach `|offset| + vHalf`. So a
   * fan's stubs started inside its own spread, its ingredient's fan came out into
   * the neighbouring lane's band, and eight names landed on each other the first
   * time ingredients could open. Same measurement, one writer.
   */
  innerReach: number;
}

/** An ingredient stub's drawn name width, capped the same way a lane's is. */
function feedWidth(feed: { label: string; shortLabel: string | null }): number {
  const M = CONVERGE_METRICS;
  return Math.min(M.labelCap, estimateTextWidth(feed.shortLabel ?? feed.label, M.laneFont));
}

/**
 * The extra belly length `n` stubs need to stand side by side.
 *
 * `placeFeeds` spreads them at `(i+1)/(n+1)` and draws each name from its stub
 * rightwards with a 4px offset, so the belly has to be `(n+1)·(widest + 4)` long
 * before two names can miss each other. Returned as the amount **past** what the
 * steps' own names already bought, because those two demands share one belly and
 * charging for both would widen every method that has an ingredient.
 */
function feedSpread(
  feeds: readonly { label: string; shortLabel: string | null }[],
  already: number,
): number {
  if (feeds.length === 0) return 0;
  const widest = Math.max(...feeds.map(feedWidth));
  return Math.max(0, (feeds.length + 1) * (widest + 4) - already);
}

/**
 * What the map writes on the stretch a method performs itself.
 *
 * **Not a name and deliberately not one.** The two failures this string sits
 * between are one name printed twice (session 104) and no name at all (session
 * 113, the owner: *"I am seeing some blank processes — i would like them
 * labeled"*). A phrase describing the *kind* of hop escapes both: it repeats
 * nothing, and it is not blank.
 *
 * **The same words the card already uses**, `map-card-panel.tsx`'s `itself`, so a
 * reader who clicks it reads back what they clicked. One string in two places is
 * the duplication rule's exception it names itself: they are one fact, and the
 * test below asserts they stay equal rather than trusting this comment.
 */
export function ownStepName(locale: PublicLocale): string {
  return locale === "ja" ? "手法そのもの" : "the method itself";
}

/**
 * Put the route's count on the lane it walks many times, where a source states
 * one.
 *
 * Applied at the two places a route's steps become lanes — the hops of
 * `chainInside` and the ingredients of `planForMethod` — rather than inside
 * `planForSlot`, because `planForSlot` does not know which route is asking. A
 * slot is one node drawn on many lanes and the count is a property of the
 * occurrence: `state-preparation` is walked an uncounted once by
 * `qsvt-matrix-inversion` and O(κ) times by `hhl-qpe-inversion`.
 *
 * Returns the strand untouched when nothing is recorded, which is the
 * overwhelming majority: **265 of the 279 named lanes** the nineteen figures draw
 * when every one of them is opened as far as it goes. (1,904 of 1,914 until
 * session 118, over a wider population — every partial opening rather than the
 * saturated one. The population is stated here because the two numbers are not
 * comparable and the smaller one is not a regression.)
 */
/**
 * Fit a lane's drawn name to its budget — and **spend the budget on the mark
 * first.**
 *
 * `fitLabel` cuts from the right, and the mark is on the right, so fitting
 * `Simulate Hamiltonian evolution ×O(κ)` in one call would drop the `×O(κ)`
 * before it dropped a single letter of a name the reader can already read from
 * the figure's other lanes. The count is the thing this lane says that nothing
 * else on the canvas does, so it is the thing that must survive: the name is cut
 * to `budget − mark`, and the mark is appended whole.
 *
 * `truncated` still describes the **name**, which is what it has always meant —
 * it is what `a truncated label is strictly shorter than the whole one and says
 * so` reads, and what the `<title>` on the shape is for. A mark is never
 * truncated, so it can never be the reason that flag is set.
 */
function fitMarkedName(
  strand: MarkedStrand,
  font: number,
  budget: number,
): { text: string; truncated: boolean } {
  return fitLabel(strand.shortLabel ?? strand.label, font, budget, markSuffix(strand));
}

/**
 * What this lane is a narrower version of, in the two forms the two audiences
 * need.
 *
 * `mark` is the name alone (`SABRE`); the canvas draws `⊂ ` in front of it and
 * that symbol has exactly one writer, `markSuffix`. `spoken` is the sentence —
 * *"a narrower version of SABRE (SWAP-based bidirectional heuristic search)"* —
 * and it names the parent in **full**, because the two audiences want opposite
 * things from the same fact: the drawing has a 300px budget and the reader
 * beside it has the parent's other lane in view, while a `<title>` or a screen
 * reader has neither and `⊂` read aloud is not a word.
 *
 * Composed here, once, rather than at the two shapes and the accessible list —
 * three writers of one sentence is the shape that drifts, and `refines` is
 * already stated in words on two card surfaces, which is two too many places
 * for a fourth to disagree with.
 */
export interface StrandRefinement {
  mark: string;
  spoken: string;
}

type MarkedStrand = {
  label: string;
  shortLabel: string | null;
  repeatMark: string | null;
  refinement: StrandRefinement | null;
};

/**
 * Everything appended to a drawn name, in one string and one order.
 *
 * **One writer, because the budget is one number.** `fitLabel` measures the
 * kept name and this suffix together in a single `estimateTextWidth` call — the
 * standing lesson from the `repeats` mark, where subtracting the mark's width
 * from the budget first cut a name at a budget equal to its own demand.
 *
 * **The `⊂ <parent>` suffix is gone (W13), and it is not a loss of the fact.**
 * It shipped in session 117 and the owner rejected it in 118: the reason a
 * drawn name ever needed the parent's name repeated is that graph order
 * interleaved the group — Carleman drew two lanes away from the Koopman it
 * narrows. The fan is grouped now, so adjacency and the bracket say the same
 * thing without the repetition; `spokenName` keeps the full sentence, because
 * a screen reader gets no bracket.
 */
/**
 * The `⤴` rides **beyond** the label cap rather than eating the name (W15).
 *
 * The count keeps the budget-first rule — a count is quantitative and the name
 * gives way to it — but the jump glyph is a constant-width affordance, and
 * cutting characters off "打ち切り Taylor 級数の LCU によるシミュレーション" to
 * make 14px of room for it inverts the value order. One writer, used by the
 * demand (`measure`) and the cut (`place`, `placeFeeds`) alike, so the two
 * cannot drift the way `hFit` did.
 */
const sharedAllowance = (strand: { sharedWith?: string | null }): number =>
  strand.sharedWith == null ? 0 : estimateTextWidth(" ⤴", CONVERGE_METRICS.laneFont);

function markSuffix(strand: {
  repeatMark: string | null;
  refinement: StrandRefinement | null;
  sharedWith?: string | null;
}): string {
  // `⤴` before the count, never after: the multiplicity sweep pins the count
  // as the label's LAST token, and a shared lane that also carries a count
  // must keep that true — "name ⤴ ×4K", not "name ×4K ⤴".
  const shared = strand.sharedWith == null ? "" : " ⤴";
  const repeat = strand.repeatMark === null ? "" : ` ${strand.repeatMark}`;
  return `${shared}${repeat}`;
}

/**
 * The refinement a method declares, in the locale being drawn — or null.
 *
 * Reads `refines` and the authored mark beside it and goes no further: a method
 * that draws the same chain as a sibling without declaring `refines` gets null,
 * because the drawing must not assert a relation the corpus did not record.
 * That is the whole of the difference between this mark and the census in
 * `repository-map-card.test.ts`, which counts the ones nothing has declared.
 */
function refinementOf(
  graph: LayerGraph,
  method: LayerMethod,
  locale: PublicLocale,
): StrandRefinement | null {
  if (method.refines === undefined) return null;
  const mark = locale === "ja" ? method.refinesMarkJa : method.refinesMark;
  const parent = layerNode(graph, method.refines);
  if (mark === undefined || mark.trim() === "" || !parent) return null;
  const name = labelOf(parent, locale);
  return {
    mark: mark.trim(),
    // The node page's and the card's own words for this edge
    // (`repository-layers.tsx`'s `variantOf`, `map-card-panel.tsx`'s `refines`).
    // One fact should read as one fact wherever it is drawn or spoken.
    spoken: locale === "ja" ? `${name}をより狭めた版` : `a narrower version of ${name}`,
  };
}

function withRepeatMark(
  strand: PlanStrand,
  method: LayerMethod,
  stepId: string,
  locale: PublicLocale,
): PlanStrand {
  const repetition = repetitionOf(method, stepId);
  if (repetition === null) return strand;
  return { ...strand, repeatMark: locale === "ja" ? repetition.markJa : repetition.mark };
}

/**
 * The string a lane actually draws: its name, and the count if it is a loop.
 *
 * **One writer, because three places have to agree.** The column's demand
 * (`measure`), the budget the name is cut to (`place`) and the width the
 * renderer is handed (`labelWidth`) are three readings of one string, and the
 * comment on `hFit` records two sessions lost to deriving that budget a second
 * way. A mark added to the drawn name in one of the three and not the others
 * would either overflow the column or be sized into a column nothing uses.
 *
 * The mark is **appended**, not substituted: `Quantum linear solve ×T/h` is the
 * name plus the fact. See `repeatMark` for why the name gives way to it rather
 * than the other way round.
 */
/**
 * The name a **non-visual** surface reads out: the full name, and the count.
 *
 * The drawn label may be cut to a column; `fullLabel` never is, which is why the
 * `<title>`, the `aria-label` and the accessible list beside the figure all read
 * it instead. The mark has to ride along with them or the count becomes a fact
 * only a sighted reader gets — and it is a *quantitative* fact about cost, which
 * is the last thing that should be available by eye alone.
 *
 * Separate from `drawnName` because the two answer different questions:
 * `drawnName` is what the column is sized for and may be shortened, this is what
 * is spoken and never is.
 */
export function spokenName(lane: {
  fullLabel: string;
  repeatMark: string | null;
  refinement: StrandRefinement | null;
  sharedWith?: string | null;
}): string {
  // The **words**, not `markSuffix`'s symbol. `⊂` in an `aria-label` is a
  // character a screen reader either skips or names as "subset of", and neither
  // is the relation the corpus recorded. Same fact, said the way this surface
  // says things — which is the rule `spokenName` exists to keep. `⤴` gets the
  // same treatment: the words say what the jump does.
  const refines = lane.refinement === null ? "" : `, ${lane.refinement.spoken}`;
  const repeats = lane.repeatMark === null ? "" : ` ${lane.repeatMark}`;
  const shared =
    lane.sharedWith == null ? "" : " — its contents are drawn once earlier on this figure; this line goes there";
  return `${lane.fullLabel}${refines}${repeats}${shared}`;
}

export function drawnName(strand: MarkedStrand): string {
  return `${strand.shortLabel ?? strand.label}${markSuffix(strand)}`;
}

/** How far past its own edge a strand must clear before a variant row starts:
 *  room for the name written at that edge, which `labelLift` is already the
 *  unit of everywhere else on this canvas. */
const VARIANT_FRAME_PAD = 3;

/**
 * The band a strand keeps for itself before anything nests outward of it —
 * its content, its ingredients, and the `labelBand` its own name sits in.
 *
 * Equal to every arm of `measureCore`'s `vHalf` by construction (each arm is
 * `innerReach + feedReach + labelBand`, with the leaf's `feedReach` zero), and
 * written once here because `place`'s variant row and the exoskeleton frame
 * both need it back from a `Measure` whose `vHalf` has since grown to include
 * the variants. A second derivation of a band is the `hFit` mistake again.
 */
function coreBandHalf(size: { innerReach: number; feeds: readonly Measure[] }): number {
  return size.innerReach + feedReach(size.feeds) + CONVERGE_METRICS.labelBand;
}

/**
 * `measureCore` folded together with the strand's variant row (W13).
 *
 * The core is the strand as it always measured; the wrapper stacks the
 * refinements nested under it — packed outward from the band the core already
 * claims, plus the bracket's own pad — into `vHalf`, takes the widest variant
 * name into `hFit` (a variant spans the whole belly, so there is no `k`
 * multiplier), and charges `hRun` the row's two tendons exactly as a fan
 * charges its children's. One wrapper rather than four edited arms, so no arm
 * can forget the row.
 */
function measure(strand: PlanStrand, depth: number): Measure {
  const core = measureCore(strand, depth);
  if (strand.variants.length === 0) return { ...core, variants: [] };
  const M = CONVERGE_METRICS;
  const variants = strand.variants.map((variant) => measure(variant, depth + 1));
  const clear = coreBandHalf(core) + M.labelLift;
  const offsets = allocateBowsOutward(variants.map((v) => v.vHalf), M.laneGap, clear);
  const reach = Math.max(...offsets.map((offset, i) => offset + variants[i]!.vHalf));
  return {
    ...core,
    vHalf: reach + VARIANT_FRAME_PAD + M.laneGap,
    hFit: Math.max(core.hFit, ...variants.map((v) => v.hFit)),
    hRun: Math.max(
      core.hRun,
      2 * Math.max(...offsets.map((offset) => tendonRunFor(offset))) +
        Math.max(0, ...variants.map((v) => v.hRun)),
    ),
    variants,
  };
}

function measureCore(strand: PlanStrand, depth: number): Omit<Measure, "variants"> {
  const M = CONVERGE_METRICS;
  // The **drawn** name, which is the short form when one is authored. Sizing a
  // column to the full label and then drawing the short one would leave every
  // shortened column padded out to a width nothing in it uses.
  //
  // Capped here, at the demand, rather than at `fitLabel` where the cut happens.
  // `hFit` is the budget the label is later fitted against and the comment on it
  // records two sessions lost to deriving that budget a second way; capping the
  // demand keeps one number flowing through `need` → `span` → `fit` →
  // `columnFit` → `fitLabel`, so the column and the cut agree by construction.
  const own = Math.min(
    M.labelCap + sharedAllowance(strand),
    estimateTextWidth(drawnName(strand), M.laneFont),
  );
  const feeds = strand.feeds.map((feed) => measure(feed, depth + 1));
  // **The horizontal demand a stub's own fan makes.** `placeFeeds` gives stub `i`
  // a `1/(n+1)` slice of the belly to draw its fan in, so a run spent inside one
  // is a run the belly has to find `(n+1)` times over — the exact analogue of a
  // chain's `k`, and `chainColumnNeed` is the same multiplier for the same
  // reason. Without it the sizing simply does not see the new shapes.
  const feedScale = feeds.length + 1;
  const feedFit = feeds.length > 0 ? Math.max(...feeds.map((feed) => feed.hFit)) * feedScale : 0;
  // Each stub's fan also spends its own two tendons inside its slice, at bow 0,
  // so `minTendonRun` each — the same charge a chain's step pays.
  const feedRun =
    feeds.length > 0
      ? Math.max(...feeds.map((feed) => feed.hRun + 2 * M.minTendonRun)) * feedScale
      : 0;
  // **`|| feeds.length > 0`, and that clause is the bug this feature is made
  // of.** Twelve of the twenty-nine decomposed methods have one segment and at
  // least one ingredient, so they plan with no children at all — and the leaf
  // return below hands back a band with no room in it for anything hanging off
  // the side. `place` had the same early return, one line apart, and dropped the
  // stubs silently.
  if (!strand.open || (strand.children.length === 0 && feeds.length === 0)) {
    return {
      vHalf: halfAt(depth) + M.labelBand,
      hFit: own,
      hRun: 0,
      children: [],
      feeds: [],
      innerReach: halfAt(depth),
    };
  }
  const children = strand.children.map((child) => measure(child, depth + 1));
  if (strand.children.length === 0) {
    // Open, and everything it holds is hanging off the side. The band is the
    // strand's own plus the feed room; the column is whatever the feeds demand.
    const innerReach = halfAt(depth);
    return {
      vHalf: innerReach + feedReach(feeds) + M.labelBand,
      hFit: Math.max(own, feedFit),
      // Only the stubs' own runs and their spacing: this strand has no children,
      // so nothing else is drawn inside its belly.
      hRun: feedRun + feedSpread(strand.feeds, own),
      children: [],
      feeds,
      innerReach,
    };
  }
  if (strand.layout === "chain") {
    // Children run one after another **along** this strand's belly, so they
    // share its band and stack its width. The extra `innerStateRadius` is the
    // boundary circle between two of them, which sits on the belly and pokes out
    // of the widest child's band.
    //
    // `count × widest`, not the sum: `place` hands each step an equal slice of
    // the belly, so the belly has to be long enough for the widest of them taken
    // that many times. Summing would size the column for a division the
    // placement does not make, and the step with the longest name would be the
    // one clipped.
    const innerReach =
      Math.max(...children.map((child) => child.vHalf)) + M.innerStateRadius;
    return {
      vHalf: innerReach + feedReach(feeds) + M.labelBand,
      // The feed clause used to be a bare label width, capped. It is now the
      // feed's own measured demand times `(n+1)` — which subsumes that label,
      // since a shut feed measures as a leaf whose `hFit` *is* its capped name.
      hFit: Math.max(chainColumnNeed(children.map((child) => child.hFit)), feedFit),
      // A step sits **on** the belly — `place` hands it bow 0 — so a chain adds
      // no bow of its own and buys no tendon of its own. What each step *does*
      // spend is its own two tendons, which at bow 0 are exactly `minTendonRun`
      // — the taper that pinches it to a point at its boundary circles. Those,
      // plus whatever the step spends inside itself, then get the `k` multiplier
      // for the same reason `chainColumnNeed` does: the step is drawn in a `1/k`
      // slice, so a run spent inside one is a run the belly has to find `k`
      // times over.
      hRun:
        Math.max(
          chainColumnNeed(children.map((child) => child.hRun + 2 * M.minTendonRun)),
          feedRun,
        ) +
        // **Room for the stubs to stand side by side**, over and above whatever
        // the steps' own names already ask for.
        //
        // `placeFeeds` puts stub `i` at `(i+1)/(n+1)` of the belly and writes its
        // name from there *rightwards*, so two stubs are `belly/(n+1)` apart and
        // the names collide unless that gap holds one. `measure` only ever asked
        // for the **widest single** stub, so it has never asked for the room the
        // placement actually needs — three ingredients on one method could always
        // have written over each other.
        //
        // It became visible rather than latent with the tendons, because a belly
        // is shorter than the span it sits in: read on the rendered page,
        // `hhl-qpe-inversion` drew *"Simulate Hamiltonian evolutiAmplify a success
        // branch"*. Charged to `hRun` and not to `hFit` for the reason `hRun`
        // exists — this is room the *drawing* needs, and a method with three
        // ingredients has not earned its labels more characters.
        feedSpread(strand.feeds, chainColumnNeed(children.map((child) => child.hFit))),
      children,
      feeds,
      innerReach,
    };
  }
  // A fan: children stack **across**, so their bands sum. The extra `labelBand`
  // is breathing room between an opened group and the siblings it has just
  // pushed apart.
  //
  // The very offsets `place` will use, computed from the same allocator against
  // the same half-bands, so the bound is measured against the drawing rather
  // than against an idea of it.
  const offsets = allocateBowsAroundSpine(
    children.map((child) => child.vHalf),
    0,
    M.laneGap,
    M.spineBand,
  );
  // Read off those offsets, **not** from a closed form of the row's total. The
  // closed form (`half the summed spread`) is only the true half-band when the
  // two groups mirror each other, and since `mid` is a ceil they never do for an
  // odd fan: a fan of one measured 47 against a drawing that reaches 72, so the
  // parent reserved a band its own child overflowed by 25px. The groups are
  // asymmetric by construction now, so the half-band is the furthest edge any
  // member actually reaches — floored at the spine's own band, because a fan of
  // one leaves the other side of the bone empty and the bone still needs its
  // room.
  const reach = Math.max(
    M.spineBand,
    ...children.map((child, index) => Math.abs(offsets[index]!) + child.vHalf),
  );
  return {
    vHalf: reach + feedReach(feeds) + M.labelBand,
    hFit: Math.max(own, feedFit, ...children.map((child) => child.hFit)),
    // The two runs this fan spends getting its children off its own belly, plus
    // whatever the deepest thing inside it spends — a child, or a stub's own fan
    // in its `1/(n+1)` slice. **Not** clamped to a range here: `measure` runs
    // before any span exists, and a run that depended on the span would have to
    // be derived a second time in `place`. The clamp lives in `runAcross`, once,
    // and `every belly is long enough to hold its own name` is what says it never
    // bites.
    hRun:
      2 * Math.max(0, ...offsets.map((offset) => tendonRunFor(offset))) +
      Math.max(0, feedRun, ...children.map((child) => child.hRun)) +
      feedSpread(strand.feeds, Math.max(own, ...children.map((child) => child.hFit))),
    children,
    feeds,
    innerReach: reach,
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
  /** Shut, something inside, and openable — a click the reader has not made. */
  collapsed: number;
  /** Shut, something inside, and not openable — a click that does not exist. */
  capped: number;
  unpublished: number;
}

/**
 * The width a **drawn** name is cut to: this lane's share of its column, and
 * never past the cap whatever that share is.
 *
 * `measure` caps the demand — see its comment — and that was read as making the
 * cut safe by construction, because the column would then be the label's own
 * capped demand. It is not: a column's `fit` is the widest thing *in* the
 * column, and a chain stacks its steps' widths into it, so a capped label can
 * land in a column wider than the cap and be fitted against all of it. Measured
 * when `hamiltonian-recasting` was authored (session 106): the 300px cap's own
 * fixture drew a **445px** name. A latent hole, reached by adding a slot.
 *
 * One function, two call sites, so the two cannot drift the way `hFit` did.
 */
const nameBudget = (columnFit: number): number =>
  Math.min(columnFit, CONVERGE_METRICS.labelCap);

function place(
  base: Level,
  strand: PlanStrand,
  size: Measure,
  bow: number,
  /** The run this strand's row shares. Decided by the parent — see `runAcross`. */
  run: number,
  depth: number,
  context: {
    vocabulary: StateVocabulary;
    locale: PublicLocale;
    focusId: string | null;
    open: ReadonlySet<string>;
    out: Placement;
    columnFit: number;
    parentKey: string | null;
    /** The stub this strand hangs off. See `ConvergeLane.feedKey`. */
    feedKey: string | null;
    /** This placement is a nested refinement. See `ConvergeLane.variant`.
     *  Every child call site resets it explicitly, the same discipline
     *  `feedKey` has — a variant's own steps are not variants. */
    variant: boolean;
    /**
     * This figure's own address, for hanging a `?card=` off. Null on a surface
     * with no card layer — see `layoutFigure`'s `cards` option.
     */
    cardBase: string | null;
    /**
     * The outer address this figure's toggles rewrite `?iopen=` on, when the
     * figure is the truncated map inside the card. Null everywhere else, and
     * then a toggle writes `?open=` through `toggleHref` as it always did. See
     * `layoutConverge`'s `innerBase` option.
     */
    innerBase: string | null;
  },
): void {
  const M = CONVERGE_METRICS;
  const { out } = context;
  const half = halfAt(depth);
  const ribbon: Ribbon = { x0: base.x0, x1: base.x1, y: base.y, bow, run };
  // The flat middle. Everything this strand contains is laid out on it, and its
  // midpoint is where the name goes — a **point on a level line** rather than the
  // peak of an arc, which is what makes a name here sit still while the figure
  // around it opens and closes.
  const belly = bellyOf(ribbon);
  const peak = { x: (belly.x0 + belly.x1) / 2, y: belly.y };

  // **An opened strand draws its name at the edge of its band, not of its spine.**
  //
  // It used to draw no name at all, and the reason was a real measurement: every
  // line here converges to a point at both circles, so the vertical room between
  // two neighbours shrinks to nothing towards the ends, and an opened strand's
  // name has to sit at the edge of its whole band — which is exactly where its
  // neighbour's band begins. The first draft put it there and the curve of
  // `linear-ode-solve` ran straight through it.
  //
  // **That constraint was measured two PRs before the angle cap existed, and the
  // cap almost entirely relieved it.** Re-measured over all 18 figures fully
  // opened, with the pre-cap geometry reconstructed and validated against the
  // three numbers the cap's own comment records: **68 of 128 opened names
  // collided before, 6 do now.** The cap turned 62 of the 68 into clearances,
  // because it multiplied the summed figure width by 7.5x and the room at a
  // given y is linear in the span. Meanwhile the owner was reading a canvas where
  // **128 of 337 lines drew nothing** and names appeared and vanished as they
  // clicked — *"labels that show up randomly"*.
  //
  // The 6 that still overlap are not worse than what already ships: applying the
  // identical test to the **shut** names on the same fully-opened figures, 33 of
  // 209 of them already collide with something. One bar, applied to both, and the
  // restored names clear it by a wider margin than the existing ones do.
  //
  // `size.vHalf`, not `half`. `half` is the thin spine an opened strand draws;
  // `vHalf` is the band its children actually fill, and it is the number
  // `allocateBows` already spaced the neighbours against — so the name lands
  // exactly where the layout has already reserved room, rather than on top of its
  // own children. Deriving it from the children's drawn edges instead puts the
  // name on its own child's name: 16 collisions rather than 6.
  // `bow >= 0`, and it is only sound because **no chain run bows up**. A chain's
  // steps are drawn on their parent's spine at bow 0, so every step reads this as
  // +1 and writes its name below itself — clear of the arc for a run that bows
  // down, and straight through the parent's own curve for one that bows up.
  //
  // Session 106 hit the second case and then removed it: a first draft of
  // `hamiltonian-surrogate` specialised `hermitian-generator`, which let the walk
  // hand a surrogate back to `linear-ode-solve` and gave `nonlinear-ode-solve` an
  // upward two-hop run whose own line crossed its own step's name. Inheriting the
  // parent's side fixes it and moves 64 labels; the state's parentage was wrong
  // for its own reasons, correcting that removed the only witness, and 37 of 576
  // opened labels sit under a line either way. So the inheritance is **not**
  // carried here — it would be a placement rule nothing on this graph exercises.
  // The measurement and what it is owed are in NEXT.md, for the tendons.
  const outward = bow >= 0 ? 1 : -1;
  const bandHalf = strand.open ? size.vHalf : half;
  // **An opened fan wears its name on the bone.**
  //
  // Owner, session 104: *"the name of the process line resides there not in some
  // surrounding area."* It did not — an opened line's name was lifted clear of
  // `size.vHalf`, the whole band its children fill, which put it outside the fan
  // it names and next to whatever the neighbouring lane's name was doing. On a
  // three-deep figure that is 300px away from the line it belongs to.
  //
  // Safe only because `allocateBowsAroundSpine` now keeps `spineBand` clear:
  // writing the name at `peak.y` before that reservation existed would have put
  // it under the middle branch, which is the collision this file previously
  // refused the name to avoid.
  //
  // Fans only. A **chain** draws its steps *on* the spine — `place` hands them
  // bow 0 — so there is no clear middle to write in, and the parent's identity
  // is carried by the exoskeleton drawn around the run instead.
  const onBone = strand.open && strand.layout === "fan";
  // **The exoskeleton (W13).** An opened chain's steps partition its belly end
  // to end — measured, 85 of 275 opened lanes had zero collapsible pixels
  // there — so the collapse target moves onto the outline of the band the
  // measurement already reserves: `ribbonOutline` at the lane's own bow, whose
  // two edges are members of the same one-parameter family as every lane. The
  // composite run lane is drawn open by construction and has no click to
  // carry, so it gets no shell.
  const framed = strand.open && strand.opensInto === "steps" && !strand.composite;
  const frameHalf = coreBandHalf(size) - M.labelBand;
  const frame = framed ? { d: ribbonOutline(ribbon, frameHalf), half: frameHalf } : null;
  // **The variant row (W13):** refinements nested under this lane's own line,
  // packed outward from the band the lane keeps for itself, wrapped in a
  // bracket. Same allocator, same clearance and same shared run as `measure`
  // charged, so the reservation and the drawing are one arithmetic.
  const variantRow =
    strand.variants.length === 0
      ? null
      : (() => {
          const clear = coreBandHalf(size) + M.labelLift;
          const offsets = allocateBowsOutward(
            size.variants.map((v) => v.vHalf),
            M.laneGap,
            clear,
          );
          const run = runAcross(offsets, belly.x1 - belly.x0);
          const lo = offsets[0]! - size.variants[0]!.vHalf - VARIANT_FRAME_PAD;
          const hi =
            Math.max(...offsets.map((offset, i) => offset + size.variants[i]!.vHalf)) +
            VARIANT_FRAME_PAD;
          const bracket: Ribbon = {
            x0: belly.x0,
            x1: belly.x1,
            y: belly.y,
            bow: outward * ((lo + hi) / 2),
            run,
          };
          return { offsets, run, d: ribbonOutline(bracket, (hi - lo) / 2) };
        })();
  // Which edge of the shell carries the name. Two text populations approach
  // the shell and they sit on fixed GLOBAL sides, not on the lane's own
  // outward: a step's name always hangs below its spine (a step is at bow 0,
  // so its outward is always +1), and an ingredient's fan hangs on the lane's
  // outward side. So the upper edge is clear unless the lane bows up AND has
  // feeds — and in exactly that case the lower edge is the inward one, clear
  // of the step names' known ~3.6px slop by the whole of `feedReach` (≥ a
  // tendon run). Measured both ways before this rule existed: the outward
  // edge was grazed by fan names at 14.8px on three map figures, and the
  // inward edge by step names at ~7px on `taylor-all-at-once`'s own page —
  // a fan the map sweeps never draw, which is why the second one was found
  // in a browser and not by a test.
  const nameEdge: 1 | -1 = outward === -1 && strand.feeds.length > 0 ? 1 : -1;
  // A lane with nothing inside wears its name IN the line (owner, session
  // 119) — one shape, one destination. Everything still expandable keeps the
  // two-target split: the line opens, the name reads.
  const labelInside =
    strand.inside === 0 && !strand.composite && !strand.nameless && !strand.openable;
  const labelY = onBone
    ? peak.y - M.spineStroke / 2 - M.labelLift
    : framed
      ? // ON the chosen edge, baseline-dropped so the name sits on the line —
        // the treatment the bone gives its own name, one band out.
        peak.y + nameEdge * frameHalf + M.laneFont * 0.35
      : labelInside
        ? peak.y + M.laneFont * 0.35
        : outward > 0
          ? peak.y + bandHalf + M.labelLift + M.laneFont * 0.8
          : peak.y - bandHalf - M.labelLift;

  // Two lanes keep drawing nothing, for two different reasons.
  //
  // A **run of named hops**: its label is `A → B`, which on the canvas is the
  // coined composite the owner refused. It is drawn as its hops and the hops
  // carry the names.
  //
  // A **method's own stretch**: its label is the method's name, already drawn on
  // the line above it. The owner asked for this one to be labelled in session
  // 113 — *"I am seeing some blank processes — i would like them labeled"* — and
  // a standing phrase was built for it (`ownStepName`, the wording the card has
  // used since W5 slice one, which is not a name and so cannot be the duplicate
  // session 104 removed). **It is not drawn yet, and the reason is measured:**
  // writing it here puts 4 opened-against-shut name overlaps back on the canvas,
  // at 10px and at 12px alike, so the collision is where the phrase sits rather
  // than how wide it is. `no two names overlap on an opened figure either` pins
  // all three kinds at 0 and that test's own comment records these same 4 as
  // what session 104 removed by silencing this hop.
  //
  // So the label waits for a placement rule, and the hop is named on hover, in
  // its `<title>`, to a screen reader and on its own card meanwhile — see
  // `cardHref` below, which is what makes it separately clickable from its
  // parent, the other half of what he asked for.
  const fitted =
    strand.composite || strand.nameless
      ? { text: "", truncated: false }
      : fitMarkedName(strand, M.laneFont, nameBudget(context.columnFit) + sharedAllowance(strand));
  const fittedWidth = fitted.text === "" ? 0 : estimateTextWidth(fitted.text, M.laneFont);
  // A framed name sits at the LEFT of the shell, not the centre — the owner's
  // own bracket sketch, and a measured constraint: `placeFeeds` puts a lone
  // ingredient stub at the belly's exact middle, and the outermost fan name
  // under that stub pokes its known ~3.6px past the band, which grazed a
  // centre-placed shell name's click target by 0.2px on `quantum-linear-solve`
  // (ja). The left end of the flat part faces no stub and no step name at
  // shell height. `min(…, peak.x)` so a name wider than the belly stays
  // centred rather than hanging off the left tendon.
  // Past the variant row's tendon zone as well as the pad: a variant converges
  // at the belly's two ends, so its tendon rises THROUGH the shell's edge
  // within the row's run of the left end — measured crossing the shell name at
  // exactly that x on `nonlinear-ode-solve` saturated. Beyond the run the
  // variants are level at their own bows, clear of the edge.
  const labelX = framed
    ? Math.min(
        belly.x0 + (variantRow === null ? 0 : variantRow.run) + M.labelPad + fittedWidth / 2,
        peak.x,
      )
    : peak.x;
  if (strand.standing === "unpublished") out.unpublished += 1;
  // **A partition of the old single count, on `openable`.** Both arms need
  // `!open` and neither can drop it: a run of named hops is drawn open from the
  // start and carries `openable: false` with `inside > 0`, so a bare
  // `!openable && inside > 0` would count the one lane on the canvas that is
  // already showing everything it has as a thing the reader cannot reach.
  //
  // `openable`, not `depth >= CONVERGE_DEPTH_MAX`, which is what the boolean
  // this replaces tested. The two agree on today's graph and the field is the
  // honest question — *will this figure open it* — where the depth comparison
  // is one of the two reasons the answer can be no.
  // A shared lane (W15) is in neither arm: its interior is not hidden — it is
  // drawn at `sharedWith`, on this same figure — so counting it as collapsed
  // would tell the reader a click is owed, and as capped that the map is
  // quietly missing something. Both would be false.
  if (!strand.open && strand.inside > 0 && strand.sharedWith === undefined) {
    if (strand.openable) out.collapsed += 1;
    else out.capped += 1;
  }

  out.lanes.push({
    key: strand.key,
    address: strand.address,
    // Set once, at the end of `layoutFigure`, by matching this address against
    // the one the caller named. `place` deliberately does not know which figure
    // it is building or who asked for it.
    subject: false,
    d: ribbonPath(ribbon),
    outline: ribbonOutline(ribbon, half),
    x0: base.x0,
    x1: base.x1,
    yc: base.y,
    bow,
    half,
    run,
    // Not rounded, and deliberately not: `x0`/`x1`/`yc` are not either, and a
    // belly that were rounded while its own base was not would be a second,
    // slightly different account of the same three numbers. The rounding
    // happens once, in the path emitter, which is where it is a rendering
    // decision rather than a fact about the layout.
    bellyX0: belly.x0,
    bellyX1: belly.x1,
    bellyY: belly.y,
    depth,
    parentKey: context.parentKey,
    feedKey: context.feedKey,
    label: fitted.text,
    // The FULL name, never the short one. This is what the `<title>` on every
    // drawn shape reads, and what the accessible list beside the figure prints,
    // so it is the line that keeps a short form from removing anything from the
    // page. Two tests assert `label === fullLabel`; they now have to allow the
    // authored short form, and the thing they must keep refusing is a short form
    // leaking into this field.
    fullLabel: strand.label,
    shortLabel: strand.shortLabel,
    repeatMark: strand.repeatMark,
    refinement: strand.refinement,
    labelTruncated: fitted.truncated,
    // Two addresses, because there are two kinds of thing here.
    //
    // A lane that **is** a node opens that node's card. A lane that is a
    // method's own stretch is nobody's node — that is why `strand.id` is null on
    // it — and opens `own:<methodId>`, which is a card about the stretch rather
    // than about the method. Pointing it at the method's own card would answer a
    // question the reader did not ask: they clicked the piece *inside* the line,
    // and the line is already one click away.
    cardHref:
      context.cardBase === null
        ? null
        : strand.own !== null
          ? withCard(context.cardBase, ownCardId(strand.own))
          : strand.draws !== null
            ? withCard(context.cardBase, strand.draws)
            : null,
    composite: strand.composite,
    nameless: strand.nameless,
    own: strand.own,
    draws: strand.draws,
    bone: onBone,
    frame,
    variantBracket: variantRow === null ? null : variantRow.d,
    variant: context.variant,
    labelInside,
    labelX,
    labelY,
    labelWidth: fittedWidth,
    nodeId: strand.id,
    // `openable`, not `id`. A line at the depth ceiling has an id and something
    // inside and still cannot draw it, and offering the click anyway is what
    // produced 39 dead controls.
    // `openable`, and not already at the ceiling. Once `?open=` names
    // CONVERGE_OPEN_MAX ids, appending one more produces an address the page
    // drops on arrival — the same dead control as the depth cap, at the other
    // cap. Shutting something already open is always offered, because that is
    // what makes room.
    // `openable`, and nothing else. It used to read
    // `strand.id && (strand.openable || strand.open) && …`, and those first two
    // clauses cancelled: the only strand with `open` but not `openable` is the
    // run lane, which is drawn open *by construction* rather than by request —
    // and `strand.id` is null on exactly that lane, so the `|| strand.open`
    // admitted it and the `strand.id` threw it back out. Now that a lane has an
    // address whether or not it has a node, the id clause would have stopped
    // cancelling and the run lane would have gained a shut control that shuts
    // nothing. Caught by the census, which counts the controls.
    // A demoted shared lane's body control is the JUMP, not a toggle: its
    // interior is drawn at `sharedWith`'s address and the control goes there.
    // Built with its own `at=` so the viewport carry at the diagram's edge
    // leaves it alone (`withViewport` lets a deliberate `at=` win).
    // Composed at the W9×W15 merge: inside the truncated map (`innerBase` set)
    // a demoted lane gets NO control rather than the jump — `figureHref` builds
    // a whole outer address, so the jump from in here would silently exit the
    // card, and the owner's rule is that the truncated map stays in the card.
    // W15's own lesson applies (a control that cannot do its job is a dead
    // control): the ⤴ mark and `spokenName` still say the interior is drawn
    // elsewhere; if the owner wants in-card jumps, that is an inner `at=` to
    // design, not this href to widen.
    openHref:
      strand.sharedWith !== undefined
        ? context.innerBase === null
          ? figureHref(context.focusId, context.open, strand.sharedWith)
          : null
        : strand.openable &&
            (isOpenedBy(context.open, strand.address, strand.id) ||
              context.open.size < CONVERGE_OPEN_MAX)
          ? context.innerBase === null
            ? toggleHref(context.focusId, context.open, strand.address, null, strand.id)
            : innerToggleHref(context.innerBase, context.open, strand.address, strand.id)
          : null,
    sharedWith: strand.sharedWith ?? null,
    href: strand.href,
    open: strand.open,
    inside: strand.inside,
    opensInto: strand.opensInto,
    standing: strand.standing,
    slots: strand.slots,
    interior: strand.interior,
    ways: strand.ways,
  });

  // **The variant row is drawn whether or not the strand is open** — the
  // owner's rule is that refinements are there during the same expansion that
  // drew their parent, with no further click — which is why this precedes the
  // shut return below.
  if (variantRow !== null) {
    for (const [index, variant] of strand.variants.entries()) {
      place(
        belly,
        variant,
        size.variants[index]!,
        outward * variantRow.offsets[index]!,
        variantRow.run,
        depth + 1,
        {
          ...context,
          parentKey: strand.key,
          feedKey: null,
          variant: true,
          // A variant spans the whole belly, so it is fitted against the
          // parent's own column — floored at its measured demand, the same
          // guard a chain's steps carry.
          columnFit: Math.max(size.variants[index]!.hFit, context.columnFit),
        },
      );
    }
  }

  if (!strand.open) return;
  // **Before the children check, not after it.** This return read
  // `|| strand.children.length === 0`, so an opened method whose whole content
  // is ingredients — twelve of the twenty-nine decomposed ones — dropped every
  // stub without a word. It is the same clause `measure` had, one function away,
  // and the two were wrong together, which is why nothing ever disagreed.
  if (strand.children.length === 0) {
    placeFeeds(belly, strand, size, bow, depth, context);
    return;
  }

  if (strand.layout === "chain") {
    // The steps are laid out on the **belly**, which is level, so cutting it is
    // arithmetic on two numbers rather than four de Casteljau splits — and, more
    // to the point, every step is then drawn horizontally. That is the half of
    // R14 the owner named this session: *"tendons … make everything with content
    // horizontal, so things are easy to read and labels and lines don't cross
    // structurally."*
    const pieces = levelSlices(belly, strand.children.length);
    // Bow 0 for every step, so the row's run is `minTendonRun` — the taper that
    // pinches each step to a point at its boundary circles. Through `runAcross`
    // rather than as a literal, so the clamp against a short slice applies here
    // too and the run a step is drawn with is the run `measure` charged for it.
    const stepRun = runAcross([0], pieces[0]!.x1 - pieces[0]!.x0);
    for (const [index, child] of strand.children.entries()) {
      place(pieces[index]!, child, size.children[index]!, 0, stepRun, depth + 1, {
        ...context,
        parentKey: strand.key,
        // Cleared: a step lies on the line it decomposes even when that line is
        // itself an ingredient's. `feedKey` marks the one hop off the side.
        feedKey: null,
        // Cleared for the same reason: a variant's own steps are not variants.
        variant: false,
        // Each step gets its share of the column, so a chain of three names is
        // fitted against a third of the width rather than against all of it.
        //
        // Floored at the step's **own measured demand**, which is the number the
        // column was sized to hold in the first place. The share and the demand
        // are the same value when the column is exactly sized, so this changes
        // nothing in the ordinary case — but the two are computed by dividing
        // and by multiplying, in different orders, down four levels of nesting,
        // and they came apart by **0.05px** on a 229px name once ingredients
        // could open. A label cut by a twentieth of a pixel is a wrong-reason
        // truncation, and floor-at-demand is what makes the two arithmetics
        // agree by construction rather than by luck.
        columnFit: Math.max(
          size.children[index]!.hFit,
          context.columnFit / strand.children.length,
        ),
      });
    }
    placeFeeds(belly, strand, size, bow, depth, context);
    // The objects between the steps, sitting exactly where the pieces meet — on
    // the belly, at its own height, which is where the steps themselves are.
    for (let index = 1; index < strand.children.length; index += 1) {
      const stateId = strand.boundaries[index - 1];
      if (!stateId) continue;
      const at = { x: pieces[index]!.x0, y: belly.y };
      const named = layerState(context.vocabulary, stateId);
      out.inner.push({
        key: `${strand.key}@${index}`,
        stateId,
        label: named ? labelOf(named, context.locale) : stateId,
        cx: round(at.x),
        cy: round(at.y),
        r: M.innerStateRadius,
        href: stateHref(stateId),
        // **Null, deliberately, and not because the surface has no card layer.**
        // `?card=` resolves against `layerNode`, and a state is not a layer-graph
        // node — it lives in `state-vocabulary`. So a card href on a circle would
        // resolve to nothing, `parseCardId` would count it dropped, and the
        // circle would be a control that does nothing: the dead control this
        // canvas has produced twice already. The state card is W5 slice three,
        // and this field is where it lands when `cardFor` can build one.
        cardHref: null,
        terminal: false,
        arriving: 1,
        leaving: 1,
        depth: depth + 1,
      });
    }
    return;
  }

  placeFeeds(belly, strand, size, bow, depth, context);
  // Around the bone, never on it. See `allocateBowsAroundSpine`.
  //
  // Centred on **0**, not on `bow`: a child's base is now this strand's belly, so
  // its offset is measured from the belly rather than from the figure's own axis.
  // Passing `bow` here would add this strand's own displacement a second time.
  const bows = allocateBowsAroundSpine(
    size.children.map((child) => child.vHalf),
    0,
    M.laneGap,
    M.spineBand,
  );
  // **One run for the whole row.** See `runAcross`: the crossing-free argument is
  // that every line in a row is `belly + bow·φ` for one shared φ, and φ is built
  // from the run.
  const childRun = runAcross(bows, belly.x1 - belly.x0);
  for (const [index, child] of strand.children.entries()) {
    place(belly, child, size.children[index]!, bows[index]!, childRun, depth + 1, {
      ...context,
      parentKey: strand.key,
      feedKey: null,
      variant: false,
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
  /** The strand's **belly** — stubs hang off the flat part, never off a tendon. */
  belly: Level,
  strand: PlanStrand,
  size: Measure,
  bow: number,
  depth: number,
  context: Parameters<typeof place>[6],
): void {
  if (strand.feeds.length === 0) return;
  const M = CONVERGE_METRICS;
  const outward: 1 | -1 = bow >= 0 ? 1 : -1;
  // `size.innerReach`, not a second derivation from the children. See `Measure`.
  const inner = size.innerReach;
  // The slice each stub owns, and the same `(n+1)` `measure` costed the column
  // in. One number, used for the geometry and for the budget, so the drawing and
  // the demand cannot describe different pictures.
  const slice = (belly.x1 - belly.x0) / (strand.feeds.length + 1);
  for (const [index, feed] of strand.feeds.entries()) {
    const t = (index + 1) / (strand.feeds.length + 1);
    const at = { x: belly.x0 + (belly.x1 - belly.x0) * t, y: belly.y };
    const fitted = fitMarkedName(feed, M.laneFont, nameBudget(context.columnFit) + sharedAllowance(feed));
    const y0 = at.y + outward * inner;
    const y1 = at.y + outward * (inner + M.feedRun);
    context.out.rightmost = Math.max(
      context.out.rightmost,
      at.x + 4 + estimateTextWidth(fitted.text, M.laneFont),
    );
    context.out.feeds.push({
      key: `${strand.key}~${feed.id ?? index}`,
      parentKey: strand.key,
      nodeId: feed.id ?? "",
      label: fitted.text,
      fullLabel: feed.label,
      shortLabel: feed.shortLabel,
      repeatMark: feed.repeatMark,
      refinement: feed.refinement,
      labelTruncated: fitted.truncated,
      href: feed.href,
      cardHref:
        context.cardBase !== null && feed.id !== null
          ? withCard(context.cardBase, feed.id)
          : null,
      x: round(at.x),
      y0: round(y0),
      y1: round(y1),
      outward,
      depth: depth + 1,
      // The control that opens the ingredient. Same two conditions as a lane's:
      // something recorded inside, and room left under the cap — unless W15
      // demoted this occurrence, in which case the control is the jump, exactly
      // as on a lane — and, exactly as on a lane, the jump only exists OUTSIDE
      // the truncated map: `figureHref` is a whole outer address, and from
      // inside the card it would silently exit it (the W9×W15 composition at
      // the lane's `openHref` records the reasoning once).
      sharedWith: feed.sharedWith ?? null,
      openHref:
        feed.sharedWith !== undefined
          ? context.innerBase === null
            ? figureHref(context.focusId, context.open, feed.sharedWith)
            : null
          : feed.openable &&
          (isOpenedBy(context.open, feed.address, feed.id) ||
          context.open.size < CONVERGE_OPEN_MAX)
          ? context.innerBase === null
            ? toggleHref(context.focusId, context.open, feed.address, null, feed.id)
            : innerToggleHref(context.innerBase, context.open, feed.address, feed.id)
          : null,
      address: feed.address,
      open: feed.open,
      inside: feed.inside,
      vHalf: size.feeds[index]!.vHalf,
    });
    if (!feed.open) continue;
    // **The fan itself, as lanes.** Drawn on a level base at the end of the stub,
    // spanning this stub's slice of the parent — so it is the same shape as every
    // other fan on the canvas, obeys the angle cap by the same arithmetic, and
    // lands in `diagram.lanes` where the sweeps can see it. A fan emitted as some
    // private shape on `ConvergeFeed` would leave the crossing-free, canvas-bounds
    // and angle-cap checks passing over a set with the whole feature missing.
    // **Pushed out only as far as the fan's own half-band actually demands
    // past `innerReach`**, so the whole fan clears what is drawn inside this
    // strand instead of straddling it, without spending more of the stub than
    // that requires. `place` allocates a fan's bows around its base, so a base
    // *at* `y1` draws half the ingredient back through the belly whenever the
    // fan's half-band exceeds `feedRun` — see `feedReach`, which reserves the
    // identical `max(feedRun, vHalf) + vHalf` this spends. The comment at the
    // top of this function has always said a stub never points back through
    // the figure; until the fix this replaced, the stub obeyed it and its fan
    // did not.
    const feedVHalf = size.feeds[index]!.vHalf;
    const fanY = at.y + outward * (inner + Math.max(M.feedRun, feedVHalf));
    const fanBase: Level = { x0: at.x - slice / 2, x1: at.x + slice / 2, y: fanY };
    place(
      fanBase,
      // **`nameless`, because the stub above already carries this name.** The
      // owner, session 118: *"still seeing things like … strange repeats within
      // larger processes. These kinds of things need to be eliminated."*
      //
      // An open ingredient was drawn twice, in the same words, one shape apart:
      // once as the stub's own name and once again on the strand its fan hangs
      // from, which `place` pushes into `out.lanes` at the identical address.
      // Measured, **94 of 94 open ingredients** across the nineteen saturated
      // figures. On `quantum-linear-solve` opened three deep the page drew
      // *"Prepare an input state ×O(κ)"* at two heights and the reader has no way
      // to know they are one thing.
      //
      // This is the second kind of strand `PlanStrand.nameless`'s own doc
      // comment said would arrive — *"the day a second kind of strand borrows a
      // name already drawn"* — and it is exactly that claim: the name is
      // correct and is already on the page once. Nothing else is lost. The stub
      // keeps the name, the `<title>`, the card and the click; only the second
      // copy of the string goes.
      //
      // Set here rather than in `measure`, deliberately: the column still
      // reserves the width this name would have taken, so no figure changes size
      // and no label that fits today starts being cut. Reclaiming that width is a
      // separate change with its own measurements.
      { ...feed, nameless: true },
      size.feeds[index]!,
      0,
      // The stub's own fan is one strand on a level base, so its row is a row of
      // one and its run is `minTendonRun` — the taper that pinches it to a point
      // at each end of its slice. Through `runAcross` so the clamp against a
      // short slice applies here as everywhere else.
      runAcross([0], slice),
      depth + 1,
      {
        ...context,
        parentKey: strand.key,
        feedKey: `${strand.key}~${feed.id ?? index}`,
        variant: false,
        // Floored at the ingredient's own demand, same reason as a chain's steps.
        columnFit: Math.max(
          size.feeds[index]!.hFit,
          context.columnFit / (strand.feeds.length + 1),
        ),
      },
    );
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

/**
 * A node's own page, carrying what the reader had open as well as where they
 * were standing.
 *
 * Both halves are needed and shipping one is worse than shipping neither: the
 * node page was taught to *honour* `?open=` and nothing *sent* it, so the set
 * still died on every name click — measured on the preview, 0 of 16 node links
 * carried one. A link is not verified until something has followed it, and a
 * hand-written URL is not something.
 *
 * Only figure addresses get this. `openHref` already carries its own `open`
 * list, and the size rungs build their own address on purpose.
 */
function withOpen(href: string, open: ReadonlySet<string>): string {
  if (open.size === 0 || href.includes("open=")) return href;
  if (!href.startsWith("/repository/layers/")) return href;
  const params = new URLSearchParams();
  for (const id of open) params.append("open", id);
  return `${href}${href.includes("?") ? "&" : "?"}${params.toString()}`;
}

function carryViewport<T extends { href: string }>(
  shape: T,
  at: string | null | undefined,
  open: ReadonlySet<string>,
): T {
  const href = withViewport(withOpen(shape.href, open), at);
  return href === shape.href ? shape : { ...shape, href: href! };
}

/**
 * A figure of one **method** — the picture its own page should draw.
 *
 * ## What this fixes
 *
 * A method's page used to call `layoutConverge` with the capability the method
 * realizes and add the method's id to `open`, trusting the fan to pick it up.
 * That works only when the slot's plan **is** a fan. Two slots on today's graph
 * are not atomic — `linear-ode-solve` (7 methods) and `nonlinear-ode-solve` (4)
 * — so `layoutConverge` chose `planStateChain`, whose lanes are *slots*, and the
 * method's own id matched nothing. Measured on `dev` before this landed:
 *
 * - **45 of 63** method pages drew a figure with their own method nowhere on it
 *   (11 absent entirely; 34 more drawn as a lane carrying no id at all);
 * - **43 of 63** drew a figure byte-identical to another method's page;
 * - **0 of the corpus's 10 `via` pins** were drawn on the page of the method
 *   that authored them;
 * - and for 4 of `linear-ode-solve`'s 7 the shared figure was **false**, not
 *   merely generic: `lchs-route` routes `linear-ivp → hamiltonian-surrogate →
 *   evolution-circuit → solution-answer`, and its page drew
 *   `time-discretization → quantum-linear-solve`.
 *
 * ## Why a separate entry point, and not a flag on `layoutConverge`
 *
 * The two callers are asking different questions. The map asks *"what does every
 * route through this slot pass through"* — and the answer must stay the state
 * chain, because that convergence is the thing the whole surface exists to show.
 * A page about one method asks *"which of the ways through this slot is this
 * one, and what is inside it"*, and the answer is always the fan.
 *
 * Threading a condition into `layoutConverge`'s plan selection would put those
 * two questions one boolean apart, in the expression that decides what the map
 * draws. They share everything downstream and nothing upstream, so the fork is
 * here, where a reader can see which question is being asked from the function's
 * name.
 *
 * A slot with no methods has no fan; `planMethodFan` returns null and the
 * diagram comes back `empty`, which is what the page already handles.
 */
export function layoutConvergeForMethod(options: {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  method: LayerMethod;
  locale: PublicLocale;
  open?: ReadonlySet<string>;
  focusParam?: string | null;
  at?: string | null;
}): ConvergeDiagram {
  const { graph, vocabulary, method, locale } = options;
  const slot = layerNode(graph, method.realizes);
  if (!slot || !isCapability(slot)) {
    return {
      width: 0,
      height: 0,
      states: [],
      lanes: [],
      feeds: [],
      caption: labelOf(method, locale),
      empty: true,
      unpublishedCount: 0,
      collapsedCount: 0,
      grain: "methods",
      truncated: false,
      chainConsistent: true,
      cappedCount: 0,
    };
  }
  // The reader's own `?open=` **and** this method, which is not negotiable: the
  // page is about what is inside this one way through the slot.
  const open = new Set([...(options.open ?? []), method.id]);
  // Which lane of the fan is the subject, by **address**. `methodFanOf` is the
  // same list `planMethodFan` maps over, in the same order, so the index is the
  // index — and `addressRoot` is the same call. Deriving it here rather than
  // having `planMethodFan` stamp a flag keeps the fan builder ignorant of who is
  // asking, which is what lets the map and this page share it.
  //
  // A **variant** is not a top-level lane since the fan grouped (W13): its
  // page's subject is the nested strand under its parent, at the position
  // `variantPosition` numbers — the same writer `planForMethod` used to mint
  // the address, so the two cannot disagree about where the five refinement
  // methods live.
  // With the subject unfolded (s121, W17): a folded refinement draws no lane on
  // the slot's figure, but its own page is still ABOUT it, so this one surface
  // asks the grouping to draw it — nested under its parent, exactly as W13 drew
  // it before the fold.
  const fan = methodFanOf(graph, slot, method.id);
  let subjectAddress: string | null = null;
  if (fan) {
    const at = fan.lanes.findIndex((lane) => lane.method.id === method.id);
    if (at !== -1) {
      subjectAddress = addressRoot(slot.id, 0, at);
    } else {
      const parentAt = fan.lanes.findIndex((lane) =>
        lane.variants.some((variant) => variant.id === method.id),
      );
      if (parentAt !== -1) {
        const parent = fan.lanes[parentAt]!;
        const route = routeOf(graph, vocabulary, parent.method);
        const index = parent.variants.findIndex((variant) => variant.id === method.id);
        subjectAddress = `${addressRoot(slot.id, 0, parentAt)}.${variantPosition(route, index)}`;
      }
    }
  }
  return layoutFigure({
    graph,
    vocabulary,
    focus: slot,
    locale,
    open,
    focusParam: options.focusParam === undefined ? slot.id : options.focusParam,
    at: options.at,
    plan: "fan",
    subjectAddress,
    unfold: method.id,
  });
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
  /**
   * This surface has a card layer, so a **name** opens a card in place.
   *
   * Off by default, and the default is the safe one. `figureHref` hardcodes
   * `/repository/layers`, so a `?card=` href emitted on `/repository/layers/<id>`
   * carries a *different* pathname from the page drawing it, and
   * `canvas-continuity` intercepts by pathname equality
   * (`canvas-continuity.tsx:128`). It would therefore not intercept: the click
   * would leave the node page altogether and land on the overview — the one
   * destination the reader did not ask for. Three handoffs running said the risk
   * here was the view-transition pairing; measured this session, it is this
   * instead, and it is worse than what they warned about.
   *
   * `MapCardPanel` is mounted on exactly one surface
   * (`repository-converge-view.tsx`), which is the same surface that passes this
   * flag. A card href with no panel to open is the dead control this canvas has
   * already produced twice.
   */
  cards?: boolean;
  /**
   * Set when this figure is the **truncated map inside the card** (`?inner=`),
   * and it is the outer map's own address — focus, outer open set, viewport,
   * `card` and `inner` and all. Every address the figure emits is then built on
   * it rather than minted fresh:
   *
   * - a line's open control toggles `?iopen=` on the base (`innerToggleHref`),
   *   because the outer `?open=` set belongs to the figure *behind* the card
   *   and must survive every click inside it;
   * - a name opens `withCard(base, id)` — and `withCard` drops `inner` and
   *   `iopen`, so the click that opens a new card is the owner's reset, arrived
   *   at rather than enforced.
   *
   * Not combined with `cards`, whose card layer hangs off an address
   * `figureHref` mints from the figure's own parameters — inside the panel that
   * address would name the truncated figure as if it were the page, and
   * following any link on it would silently swap the reader's whole outer map
   * for its own inner one. When both are passed, this one wins, because a
   * figure inside the card has exactly one right base and it is this one.
   */
  innerBase?: string | null;
}): ConvergeDiagram {
  return layoutFigure(options);
}

/**
 * One fingerprint of what a strand **holds** — ids, layout and boundaries,
 * recursively. Addresses are excluded because two occurrences of one node
 * differ in address by construction; open flags and marks are excluded because
 * they are facts about the *drawing* (the depth cap shuts what it cannot
 * reach, a prior demotion rewrites a twin) and letting them into the key made
 * the dedup order-dependent — two corpus-identical interiors read as different
 * pictures because one sat a level deeper (W15).
 */
function corpusShape(strand: PlanStrand): string {
  const part = (s: PlanStrand): string =>
    `${s.draws ?? s.own ?? ""}:${s.layout ?? ""}` +
    `[${s.children.map(part).join(",")}|${s.feeds.map(part).join(",")}|${s.variants.map(part).join(",")}]` +
    `#${s.boundaries.join(">")}`;
  return part(strand);
}

/**
 * W15: a node's interior is drawn **once per figure**; every other occurrence
 * keeps its lane and gets a jump to the one that draws it (NEXT.md §1
 * option (b), `plans/atlas-revamp/W15-shared-submethod-dedup.md`).
 *
 * ## What counts as a duplicate
 *
 * Same drawn node AND identical corpus-level interior (`corpusShape`). A
 * context that genuinely narrows what fills a slot produces a different shape
 * and both occurrences draw. The saturated `linear-ode-solve` fan is the
 * motivating case: `time-discretization`'s five methods drawn identically
 * under Taylor, again under Krovi, again under Dyson — 7,000px of the size
 * ceiling (D119.6).
 *
 * ## Who hosts
 *
 * The **shallowest open** occurrence, ties to draw order — not the first in
 * draw order, which was the first design and picked exactly wrong once: the
 * first-drawn `chebyshev-lcu-inversion` on the saturated nonlinear figure sits
 * a level deeper than its twin, so the depth cap had already shut the feeds
 * the shallower copy could draw. A group with no open member demotes nobody —
 * every shut line keeps its own open control until a reader opens one, and
 * from then on that copy hosts and its twins jump to it.
 *
 * ## Why a fixpoint, shallowest host first
 *
 * Demoting a subtree removes occurrences that lived inside it, so groups are
 * recomputed over the live tree after every demotion; taking the shallowest
 * host each round means no later demotion can bury an already-chosen host.
 * Terminates because every round strictly shrinks the live interior. Runs
 * before measurement, so a demoted strand sizes as the shut line it now is —
 * that ordering is the whole height win. Planning itself stays a pure
 * recursion; its `seen` set remains a cycle guard and nothing more.
 *
 * ## What demotion keeps and what it drops
 *
 * The lane stays — the branch genuinely contains the node, and hiding the lane
 * would redraw the false picture the dedup exists to prevent. Its interior
 * (children, feeds, variants, boundaries) drops, its open controls go, and
 * `sharedWith` carries the host's address for the jump and the `⤴` mark. The
 * figure's own subject (a method page's top lane) never demotes: its interior
 * is the page's point.
 */
function dedupSharedInteriors(
  bundles: readonly { readonly lanes: readonly PlanStrand[] }[],
  subjectAddress: string | null,
): void {
  const depthOf = (address: string): number => address.split(".").length;
  for (;;) {
    // Occurrences with an interior, over the live (post-demotion) tree.
    const groups = new Map<string, PlanStrand[]>();
    const walk = (strand: PlanStrand): void => {
      if (strand.sharedWith !== undefined) return;
      if (
        strand.draws !== null &&
        strand.address !== subjectAddress &&
        (strand.children.length > 0 || strand.feeds.length > 0)
      ) {
        const key = `${strand.draws}#${corpusShape(strand)}`;
        groups.set(key, [...(groups.get(key) ?? []), strand]);
      }
      for (const child of strand.children) walk(child);
      for (const feed of strand.feeds) walk(feed);
      for (const variant of strand.variants) walk(variant);
    };
    for (const bundle of bundles) for (const lane of bundle.lanes) walk(lane);

    // The qualifying group whose host is shallowest, or done.
    let host: PlanStrand | null = null;
    let twins: PlanStrand[] = [];
    for (const members of groups.values()) {
      if (members.length < 2) continue;
      const open = members.filter((member) => member.open);
      if (open.length === 0) continue;
      const candidate = open.reduce((best, member) =>
        depthOf(member.address) < depthOf(best.address) ? member : best,
      );
      if (host === null || depthOf(candidate.address) < depthOf(host.address)) {
        host = candidate;
        twins = members.filter((member) => member !== candidate);
      }
    }
    if (host === null) return;
    for (const twin of twins) {
      twin.sharedWith = host.address;
      twin.children = [];
      twin.boundaries = [];
      twin.feeds = [];
      twin.variants = [];
      twin.layout = null;
      twin.open = false;
      twin.openable = false;
      twin.opensInto = null;
    }
  }
}

/**
 * The shared body. Both entry points above reach here; they differ in `plan`.
 *
 * `plan: "auto"` is the map's rule, unchanged and untouched — the state chain is
 * asked for first and the fan is the answer only when there is no chain.
 * `plan: "fan"` is a method page saying it already knows which picture it wants.
 * Keeping the two words apart, in a parameter, is what stops a future edit to
 * the map's rule from silently deciding what a method page draws.
 */
function layoutFigure(options: {
  graph: LayerGraph;
  vocabulary: StateVocabulary;
  focus: LayerCapability;
  locale: PublicLocale;
  open?: ReadonlySet<string>;
  focusParam?: string | null;
  at?: string | null;
  plan?: "auto" | "fan";
  /**
   * The address of the one lane this figure is *about*, or null.
   *
   * An **address**, not a node id, because `planForMethod` sets
   * `id: holds ? method.id : null` — 34 of the 63 methods are leaves with
   * nothing inside them, so they carry no node id, and those are exactly the
   * pages where nothing else on the drawing would tell a reader which line they
   * came to read about. Only the top-level lane can match this string exactly,
   * so a nested child of the same method is never mistaken for it.
   */
  subjectAddress?: string | null;
  /** s121 (W17): the folded refinement this figure draws anyway — its own page only. */
  unfold?: string;
  cards?: boolean;
  innerBase?: string | null;
}): ConvergeDiagram {
  const { graph, vocabulary, focus, locale } = options;
  const focusParam = options.focusParam === undefined ? focus.id : options.focusParam;
  const open = options.open ?? new Set<string>();
  const subjectAddress = options.subjectAddress ?? null;
  const innerBase = options.innerBase ?? null;
  // The address a `?card=` hangs off: **this figure, exactly as the reader has
  // it**. Built once here from the same three parameters every other address on
  // the figure is built from, rather than per-anchor, so a card link cannot
  // carry a different focus, a different open set or a different viewport from
  // the line beside it. Null when the surface has no card layer — see `cards`.
  //
  // Inside the card (`innerBase`), the base is the **outer** address instead:
  // `withCard` on it swaps which card is over the outer map — and drops `inner`
  // and `iopen`, which is the reset. The one panel is the card layer here; a
  // second one never mounts (`MapCardPanel` is mounted exactly once, in
  // `repository-converge-view.tsx`), so a name inside the truncated map
  // retargets that panel rather than opening a card inside a card.
  const cardBase =
    innerBase !== null
      ? innerBase
      : options.cards === true
        ? figureHref(focusParam, open, options.at)
        : null;
  const M = CONVERGE_METRICS;
  const expansion: Expansion = expansionOf(graph, vocabulary, focus);
  const caption = labelOf(focus, locale);

  // Which picture this is. The state chain is asked for first and the method
  // fan is the answer when there is no chain — or when the chain's own claim
  // does not hold: a chain figure says every way across passes through its
  // circles, and `drawsAsStateChain` checks that against the routes of the
  // methods actually filling this slot. `linear-ode-solve` is why the check
  // exists — its edge walk admits only discretise-then-solve, while three of
  // its seven methods record `bypasses` over exactly those slots, so the
  // chain drew a claim the corpus itself refutes and none of the seven
  // methods appeared on their own slot's figure.
  const plan =
    options.plan === "fan" || !drawsAsStateChain(graph, vocabulary, focus, expansion)
      ? planMethodFan(graph, vocabulary, focus, locale, open, options.unfold)
      : planStateChain(graph, vocabulary, expansion, locale, open, focus.id);

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
      cappedCount: 0,
    };
  }

  // W15: one interior per (node, shape) per figure — before measurement, so a
  // demoted strand sizes as the shut line it now is.
  dedupSharedInteriors(plan.bundles, subjectAddress);

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
    //
    // **This is where the figure stopped being enormous.** It used to be
    // `spanForBow(offset·hScale + hDev)` — `4·|bow|` of column for a bow of
    // `|bow|`, because the old law spread the whole rise over the whole span and
    // the angle cap then bought it back as width. Saturated, that measured
    // 21,849px on `hamiltonian-simulation` and **87,449px** on
    // `quantum-linear-solve`. A tendon confines the rise to its own run and the
    // run has a ceiling, so what a bow costs is now two runs, bounded, per level.
    const offsets = allocateBows(lanes.map((lane) => lane.vHalf), 0, M.laneGap);
    // The line **without its tendons on it**: everything drawn along it, plus the
    // padding. This is what `firstOrderRun` takes its share of, and taking it here
    // rather than off `span` is what cuts the circularity — `span` is this plus
    // twice the run, so the two are one derivation read in one direction.
    const bare = need + Math.max(0, ...lanes.map((lane) => lane.hRun)) + M.labelPad * 2;
    const run = firstOrderRun(runAcross(offsets, Number.POSITIVE_INFINITY), bare);
    const span = Math.max(M.minSpan, bare + 2 * run);
    return {
      span,
      fit: Math.max(M.minSpan - M.labelPad * 2, need),
      /**
       * The bundle's shared run, so `place` uses the number the span paid for.
       *
       * **It now does.** This field existed and was read nowhere — `place` derived
       * the run a second time off the placed base, which is the one thing the note
       * at the top of this block says not to do, and it is why the first-order run
       * could not depend on the length before. Clamped here, once, against the
       * span that was actually built: `minSpan` can win the `max` above, and then
       * the column is shorter than twice the run the offsets asked for.
       */
      run: Math.min(run, span / 2),
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
      /** Null for the same reason as the interior circles above. */
      cardHref: null,
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
    collapsed: 0,
    capped: 0,
    unpublished: 0,
  };

  for (const [index, bundle] of plan.bundles.entries()) {
    const base: Level = { x0: xs[index]!, x1: xs[index + 1]!, y: yc };
    const halves = measured[index]!.map((lane) => lane.vHalf);
    const bows = allocateBows(halves, 0, M.laneGap);
    // **Read, not re-derived.** This used to recompute `runAcross` off the placed
    // base, so the number the column was sized for and the number the row was
    // drawn with were two derivations of one quantity that happened to agree —
    // and `columns[].run`, which exists to carry it, was read nowhere. A
    // first-order run that depends on the line's length cannot survive that: the
    // two would disagree the moment the length entered only one of them.
    const run = columns[index]!.run;
    for (const [at, lane] of bundle.lanes.entries()) {
      place(base, lane, measured[index]![at]!, bows[at]!, run, 0, {
        vocabulary,
        locale,
        focusId: focusParam,
        open,
        out,
        columnFit: columns[index]!.fit,
        parentKey: null,
        feedKey: null,
        variant: false,
        cardBase,
        innerBase,
      });
    }
  }

  return {
    // Stretched to cover any ingredient name that runs past the last circle.
    // Never shrunk: `width` is the tiled columns plus their margins, and that is
    // the minimum whatever the labels do.
    width: Math.max(width, round(out.rightmost + M.margin)),
    height,
    states: [...states, ...out.inner].map((state) => carryViewport(state, options.at, open)),
    lanes: out.lanes.map((lane) => ({
      ...carryViewport(lane, options.at, open),
      openHref: withViewport(lane.openHref, options.at),
      // Matched on the address, and matched here rather than in `place`, so the
      // placement code stays ignorant of who is asking for the figure. Exact
      // string equality: a child of the subject has a longer address and is a
      // different line.
      subject: subjectAddress !== null && lane.address === subjectAddress,
    })),
    // `openHref` explicitly, exactly as the lanes above — `carryViewport`
    // rewrites `href` and nothing else. Measured on `linear-ode-solve` saturated
    // with a viewport: 53 of 53 lanes carried it and **0 of 12 feeds did**, so
    // opening or shutting an ingredient dropped the reader back at the origin at
    // 100%, which reads as the map jumping rather than as a control working. The
    // test that enumerates every address on a figure listed `lane.href`,
    // `lane.openHref`, `state.href` and `feed.href`, and omitted this one.
    feeds: out.feeds.map((feed) => ({
      ...carryViewport(feed, options.at, open),
      openHref: withViewport(feed.openHref, options.at),
    })),
    caption,
    empty: false,
    unpublishedCount: out.unpublished,
    collapsedCount: out.collapsed,
    grain: plan.grain,
    truncated: expansion.truncated,
    chainConsistent: expansion.chainConsistent,
    cappedCount: out.capped,
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
  subjectId: string,
): Plan {
  return {
    chain: expansion.chain,
    grain: "states",
    bundles: expansion.bundles.map((bundle, bundleIndex) => ({
      from: bundle.from,
      to: bundle.to,
      lanes: bundle.lanes.map((lane, laneIndex) =>
        planForLane(
          graph,
          vocabulary,
          lane,
          locale,
          open,
          standingFor(graph, vocabulary, lane),
          addressRoot(subjectId, bundleIndex, laneIndex),
        ),
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
  unfold?: string,
): Plan | null {
  // The fan IS the focus's own figure, so the subject is `focus` itself.
  const fan = methodFanOf(graph, focus, unfold);
  if (!fan) return null;
  return {
    chain: [fan.from, fan.to],
    grain: "methods",
    bundles: [
      {
        from: fan.from,
        to: fan.to,
        lanes: fan.lanes.map((lane, laneIndex) =>
          planForMethod(
            graph,
            vocabulary,
            lane.method,
            locale,
            open,
            0,
            new Set([focus.id]),
            `${focus.id}:`,
            addressRoot(focus.id, 0, laneIndex),
            unfold,
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
    // The same predicate the figure is chosen by — one writer, so this census
    // cannot list a slot whose page draws the fan. `linear-ode-solve` left
    // this list the day the check landed: its chain was refuted by its own
    // methods' `bypasses`, which is exactly what this census must not count.
    return drawsAsStateChain(graph, vocabulary, node, expansionOf(graph, vocabulary, node));
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
