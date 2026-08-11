// The one piece of arithmetic the convergence canvas is built on: a band, and a
// **ribbon** — a tendon in, a level belly, a tendon out.
//
// ## The property everything rests on, stated once
//
// Every line on this canvas is one base range displaced by
//
//     y(x) = base.y + bow · φ(x)
//
// for a single shared shape `φ(x) ∈ [0,1]` that is **zero at both ends** and
// non-negative in between. Two lines over one base are therefore `(b₁ − b₂)·φ(x)`
// apart at every x: they touch exactly where φ = 0, which is the two state
// circles they both genuinely reach, and nowhere else. That is D96.2 obtained by
// construction rather than by minimising crossings, and it is why nesting needed
// no new proof — a strand's children are offsets of *its* belly by the same law.
//
// A strand's two edges are the same law applied twice, at `bow − half` and
// `bow + half`, so the drawn shape pinches to a point at each circle for free.
// The taper is not drawn on top of the curve; it *is* the displacement law.
//
// ## Which φ, and why it changed (R14)
//
// The canvas used to use `φ(t) = 4t(1−t)` — the plain cubic bow. Nothing in the
// argument above needs that particular φ, and that one had a cost the drawing
// could not carry: its steepest slope is at the circles, `4·|bow| / span`, so
// holding a branch under 45° forced `span ≥ 4·|bow|`. Measured at saturation,
// that made one figure **87,449px** wide, painted by `max-width: 100%` at about
// 1.4% scale.
//
// The φ this module uses now is a **ramp**: `3u² − 2u³` over the first `run`,
// flat across the belly, and back down over the last `run`. Same three
// properties, so every band invariant is unchanged — and the rise is confined to
// the run, which has a ceiling, so a bow costs a bounded amount of width however
// large it grows. R14 is the ruling that permits it: a tendon carries no name, no
// destination and no claim, so `maxLaneAngleDeg` — which existed because *"no
// branch should be at such a steep angle that it becomes weird to look at"* —
// never reached it.
//
//     *"Tendons on either side can follow curved paths until both blank nodes are
//     in a horizontal line, and the muscle shape within rests between. … it makes
//     sense to allow tendons to expand past 45 degrees if only just to allow this
//     horizontal structure for pairs of states so that things become standardized
//     and easy to read."*                                    — owner, session 104
//
// The other half of what that buys is the **belly**: level by construction, so
// everything with content in it — a name, a fan of methods, a run of steps — is
// laid out along a horizontal line instead of along an arc. The owner named that
// half this session: *"tendons … separate muscle bellies and make everything with
// content horizontal, so things are easy to read and labels and lines don't cross
// structurally."*
//
// ## What left with the cubic
//
// `Cubic`, `offsetCubic`, `splitCubic`, `splitCubicEven`, `peakOf`, `pointOn`,
// `cubicPath`, `strandOutline`, `bowDisplacement` and `controlHeight` are gone,
// and so are their tests. They were the general machinery for placing a strand on
// a base that is **not level** — a segment of a bowed lane starts and ends at
// different heights — and a ribbon has no such case: a belly is level, so what a
// child is placed on is level, all the way down. Keeping arithmetic nothing draws
// with, under tests nothing can fail for a real reason, is the shape of guard
// this repository has already shipped once and had to go back for.
//
// Server-only arithmetic, no DOM, no `window`: same constraint as every other
// layout module here (D90.3).

/** Round to a hundredth. Full floats make the emitted HTML noticeably bigger for no gain. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * A closed interval of bow values, which is what a strand and everything drawn
 * inside it actually occupy.
 *
 * The whole crossing-free question reduces to this type. Two strands over one
 * base curve are disjoint (except at their shared endpoints) exactly when their
 * bands do not overlap — no sampling, no all-pairs geometric test, just interval
 * arithmetic on numbers the layout already computed. `converge-layout.ts`
 * asserts precisely that, and it is the reason nesting did not need a new proof.
 */
export interface Band {
  lo: number;
  hi: number;
}

export function bandOf(bow: number, half: number): Band {
  return { lo: bow - half, hi: bow + half };
}

/**
 * Do two bands overlap in their interiors?
 *
 * Touching at an endpoint is not an overlap: two neighbouring strands may share
 * a boundary value without either drawing inside the other, and treating that as
 * a collision would forbid the tightest packing the layout is allowed to use.
 */
export function bandsOverlap(a: Band, b: Band): boolean {
  return a.lo < b.hi && b.lo < a.hi;
}

// ---------------------------------------------------------------------------
// Ribbons: a tendon, a horizontal belly, a tendon. R14.
// ---------------------------------------------------------------------------
//
// **The one-parameter family survives, and that is the whole reason this shape
// is allowed.** Everything above rests on one property: every line is `base` plus
// `bow · φ(x)` for one shared `φ ≥ 0` that vanishes at both ends. For the plain
// cubic, `φ(t) = 4t(1−t)`. Nothing in the crossing-free argument cares *which*
// φ it is — only that all the lines being compared share it, that it is
// non-negative, and that it is zero exactly at the two shared endpoints.
//
// So the bow can be moved off a parabola and onto a **ramp**: rise over the
// first `run`, run flat, fall over the last `run`. Two lines with bows `b₁ < b₂`
// are still `(b₁ − b₂)·φ(x)` apart at every x, still touch only where φ = 0, and
// a strand's two edges at `bow ± half` still pinch to a point at both circles and
// open to exactly `2·half` across the belly. Band arithmetic is unchanged, and so
// is every invariant written against it.
//
// What changes is what the shape costs. On the cubic, the steepest slope is at
// the circles and equals `4·|bow| / span`, so holding a branch under 45° forces
// `span ≥ 4·|bow|` — which is why a fully opened figure measured **87,449px
// wide**. On the ramp the rise is confined to `run`, and `run` is chosen from the
// bow with a ceiling, so a bow costs a **bounded** amount of width however large
// it is. R14 is the ruling that makes that legal: a tendon carries no name, no
// destination and no claim, so the reason the angle cap exists does not reach it.
//
//     *"Tendons on either side can follow curved paths until both blank nodes are
//     in a horizontal line, and the muscle shape within rests between."*
//                                                          — owner, session 104
//
// The belly is horizontal by construction, which is the other half of what the
// owner asked for and the half that makes the drawing readable: everything with
// content inside it — a name, a fan of methods, a run of steps — is laid out
// along a level line rather than along an arc.

/**
 * A **ribbon**: a level base range, how far off it the belly sits, and how much
 * of each end the tendon takes getting there.
 *
 * Deliberately not a `Cubic`. A ribbon is three segments and the middle one is
 * straight, so there is no single cubic that describes it — and trying to keep
 * one would put the layout back where it started, deriving the drawn shape a
 * second way. Everything nested inside a ribbon is placed against its **belly**,
 * which is a level range again, so the recursion stays in one representation.
 */
export interface Ribbon {
  x0: number;
  x1: number;
  /** The height of the two ends — where the tendons start and finish. */
  y: number;
  /** How far off `y` the belly runs. Signed. */
  bow: number;
  /** How much of each end a tendon takes. `0 ≤ 2·run ≤ x1 − x0`. */
  run: number;
}

/** A level range: the base of a ribbon, and what a ribbon's belly is. */
export interface Level {
  x0: number;
  x1: number;
  y: number;
}

/** The flat middle: where the name goes and where everything inside is placed. */
export function bellyOf(ribbon: Ribbon): Level {
  return { x0: ribbon.x0 + ribbon.run, x1: ribbon.x1 - ribbon.run, y: ribbon.y + ribbon.bow };
}

/**
 * The shared shape, `φ(x) ∈ [0,1]`: 0 at both ends, 1 across the belly.
 *
 * `3u² − 2u³` on each tendon, which is the cubic with zero slope at both ends —
 * so a line leaves its circle horizontally and arrives at its belly horizontally,
 * and there is no corner where the tendon becomes the belly. Its steepest point
 * is the middle of the tendon, at `1.5·|bow| / run`; `tendonSlope` below is that
 * number and is what the angle invariant is measured against.
 *
 * Exported for the same reason `bowDisplacement` is: measuring code must not
 * re-derive it. The last two functions that computed one of these laws
 * independently disagreed by a factor of 4/3 and agreed with each other
 * consistently enough that a mutation sweep could not see it.
 */
export function tendonProfile(ribbon: Ribbon, x: number): number {
  const { x0, x1, run } = ribbon;
  if (run <= 0) return x <= x0 || x >= x1 ? 0 : 1;
  const ease = (u: number) => 3 * u * u - 2 * u * u * u;
  if (x <= x0 || x >= x1) return 0;
  if (x < x0 + run) return ease((x - x0) / run);
  if (x > x1 - run) return ease((x1 - x) / run);
  return 1;
}

/** Where a ribbon's centre line is at x. */
export function ribbonY(ribbon: Ribbon, x: number): number {
  return ribbon.y + ribbon.bow * tendonProfile(ribbon, x);
}

/**
 * The steepest the tendon gets, as a slope (dy/dx).
 *
 * `max φ' = 1.5/run` for `3u² − 2u³`, so the steepest tangent is
 * `1.5·|bow| / run`. R14 exempts this from `maxLaneAngleDeg`; it is reported and
 * bounded rather than capped, because the whole point of the tendon is that a
 * large bow costs bounded *width* instead of unbounded width.
 */
export function tendonSlope(ribbon: Ribbon): number {
  if (ribbon.run <= 0) return ribbon.bow === 0 ? 0 : Number.POSITIVE_INFINITY;
  return (1.5 * Math.abs(ribbon.bow)) / ribbon.run;
}

/**
 * The centre line, as SVG path data: cubic in, straight across, cubic out.
 *
 * The tendon's control y's are `[y, y+bow]` — the pair that makes a cubic over
 * an evenly-controlled x exactly `3u² − 2u³` in y. Written out rather than
 * derived at each call so `tendonProfile` and this string cannot describe two
 * different curves, which is the failure this module's header records.
 */
export function ribbonPath(ribbon: Ribbon): string {
  const { x0, x1, y, run } = ribbon;
  const belly = y + ribbon.bow;
  const a = x0 + run;
  const b = x1 - run;
  return [
    `M ${n(x0)} ${n(y)}`,
    `C ${n(x0 + run / 3)} ${n(y)}, ${n(x0 + (2 * run) / 3)} ${n(belly)}, ${n(a)} ${n(belly)}`,
    `L ${n(b)} ${n(belly)}`,
    `C ${n(b + run / 3)} ${n(belly)}, ${n(b + (2 * run) / 3)} ${n(y)}, ${n(x1)} ${n(y)}`,
  ].join(" ");
}

/**
 * The drawn region: the ribbon at `bow − half` and the ribbon at `bow + half`,
 * the second one reversed so the outline is one closed subpath.
 *
 * Both edges carry the **same** `run`, so both are the same φ scaled — which is
 * what makes the shape pinch to a point at each circle and stand at exactly
 * `2·half` across the whole belly. That is a muscle: a tendon that tapers in, a
 * belly of constant thickness, a tendon that tapers out. The old shape was a
 * lens, thickest at one point in the middle and thinning everywhere else, which
 * is what made a name written on it sit on a moving target.
 */
export function ribbonOutline(ribbon: Ribbon, half: number): string {
  const upper = ribbonPath({ ...ribbon, bow: ribbon.bow - half });
  const lower = { ...ribbon, bow: ribbon.bow + half };
  const { x0, x1, y, run } = lower;
  const belly = y + lower.bow;
  const a = x0 + run;
  const b = x1 - run;
  return [
    upper,
    // The lower edge, walked backwards from the right-hand circle.
    `L ${n(x1)} ${n(y)}`,
    `C ${n(b + (2 * run) / 3)} ${n(y)}, ${n(b + run / 3)} ${n(belly)}, ${n(b)} ${n(belly)}`,
    `L ${n(a)} ${n(belly)}`,
    `C ${n(x0 + (2 * run) / 3)} ${n(belly)}, ${n(x0 + run / 3)} ${n(y)}, ${n(x0)} ${n(y)}`,
    "Z",
  ].join(" ");
}

/**
 * A level range cut into `count` consecutive pieces.
 *
 * The straight-line replacement for `splitCubicEven`, and simpler for the same
 * reason the whole ribbon is: a chain's steps are laid out on its **belly**,
 * which is level, so cutting it is arithmetic on two numbers rather than four
 * de Casteljau splits. Equal in x, which on a level range is also equal in arc
 * length — the distinction `splitCubicEven` had to make and explain does not
 * arise here.
 */
export function levelSlices(level: Level, count: number): Level[] {
  if (count <= 1) return [level];
  const step = (level.x1 - level.x0) / count;
  return Array.from({ length: count }, (_, index) => ({
    x0: level.x0 + step * index,
    x1: level.x0 + step * (index + 1),
    y: level.y,
  }));
}

/**
 * The same cut, but each piece as long as what it has to hold.
 *
 * `levelSlices` divides equally, which is only the right division when the
 * steps make equal demands. They rarely do: a chain of two where one step is a
 * shut leaf with a 129px name and the other opens onto a whole fan gave the
 * leaf half of a 5,552px belly on `nonlinear-ode-solve`, and the leaf's own
 * demand was 197px. Equal shares are therefore what makes a figure long — the
 * widest step is paid for `k` times whether or not `k−1` of those payments buy
 * anything.
 *
 * Weights are the steps' own demands, so a piece is never shorter than what it
 * holds **provided the level is at least the summed demand** — which is exactly
 * what the caller sized it to be. Non-positive weights are floored at zero and
 * an all-zero row falls back to the equal cut rather than dividing by nothing.
 *
 * The last piece closes on `level.x1` by construction rather than by
 * accumulated float: the boundary circles between steps are drawn at these
 * seams, and a chain whose last step stops 0.02px short of its own end circle
 * is a gap a reader can see at zoom.
 */
export function levelShares(level: Level, weights: readonly number[]): Level[] {
  if (weights.length <= 1) return [level];
  const safe = weights.map((weight) => (Number.isFinite(weight) ? Math.max(0, weight) : 0));
  const total = safe.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return levelSlices(level, weights.length);
  const length = level.x1 - level.x0;
  const pieces: Level[] = [];
  let x = level.x0;
  for (const [index, weight] of safe.entries()) {
    const x1 = index === safe.length - 1 ? level.x1 : x + (length * weight) / total;
    pieces.push({ x0: x, x1, y: level.y });
    x = x1;
  }
  return pieces;
}
