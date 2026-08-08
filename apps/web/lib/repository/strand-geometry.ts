// The one piece of arithmetic the convergence canvas is built on: a cubic, an
// offset of that cubic, and a split of it.
//
// ## Why this module exists
//
// `converge-layout.ts` used to emit its path strings inline, from one hard-coded
// family: a bow between two circles at the same height. That was enough while a
// figure was one level deep. It is not enough for a figure a reader can open in
// place, because opening asks two different questions of the same curve:
//
//   - **across** — a slot's alternatives fan out around it (`offsetCubic`)
//   - **along**  — a method's steps run one after another down it (`splitCubic`)
//
// and the second one produces sub-curves that are *not* level: a segment of a
// bowed lane starts and ends at different heights. Every formula in the old file
// assumed `y0 === y3`, so it could not have drawn the inside of a lane at all.
//
// Both operations are exact, both are closed over cubics, and both preserve the
// property the whole drawing rests on. That is the point of doing it here rather
// than approximating with polylines: the crossing-free argument survives
// nesting, and it survives it as arithmetic rather than as a sampled check.
//
// ## The property, and why offsetting the controls is the way to get it
//
// For a cubic with control points C1, C2, raising **both** control y's by `k`:
//
//     Δy(t) = 3(1−t)²t·k + 3(1−t)t²·k = 3k·t(1−t)·[(1−t) + t] = 3k·t(1−t)
//
// So the displacement is `3k·t(1−t)`: **zero at both ends, maximal at t = ½**,
// and — the load-bearing part — *affine in k* while x(t) does not involve k at
// all. Two offsets of one base curve are therefore compared at the same x for
// the same t, and their separation is `3(k₁−k₂)·t(1−t)`, which is strictly
// non-zero on (0,1) whenever k₁ ≠ k₂ and exactly zero at t ∈ {0,1}.
//
// Two consequences, and they are the entire geometry of this surface:
//
//   1. **Lines meet only where they should.** Any set of offsets of one base
//      curve touches only at the two shared endpoints — which are the state
//      circles both of them genuinely reach. That is D96.2, obtained by
//      construction rather than by minimising crossings.
//   2. **A strand can taper for free.** Draw the outline as the offsets at
//      `bow + w` and `bow − w` and the shape pinches to a point at each circle
//      and is `2w` thick in the middle. The taper is not drawn on top of the
//      curve; it *is* the same displacement law applied twice.
//
// Because Δy(½) = 3k/4, the offset that peaks at exactly `bow` needs
// `k = 4·bow/3`. That factor lived in `converge-layout.ts` as `controlHeight`
// and had already drifted once — a helper describing a curve three quarters the
// height of the emitted one — so it moves here, beside the only two functions
// allowed to apply it.
//
// Server-only arithmetic, no DOM, no `window`: same constraint as every other
// layout module here (D90.3).

/**
 * A cubic Bézier: two endpoints and two controls.
 *
 * Deliberately a flat record of eight numbers rather than four point objects.
 * Every function here reads and writes all eight, the layout stores thousands of
 * them, and a point type would buy nothing but allocation.
 */
export interface Cubic {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/**
 * The control-point lift that makes a cubic peak at exactly `bow`.
 *
 * A cubic with both controls lifted by `k` reaches `3k/4` at `t = ½`, so the
 * control has to be pushed 4/3 past the displacement you want. One function owns
 * that relationship because everything that draws and everything that measures
 * needs it, and they have drifted before: `bowAt` once used `k = bow` while the
 * emitter used `k = 4·bow/3`, which made every invariant sample a curve three
 * quarters the height of the one on screen and made the canvas reserve three
 * quarters of the height its fan actually used.
 */
export function controlHeight(bow: number): number {
  return (bow * 4) / 3;
}

/** A level cubic between two points at the same height — the base of a bundle. */
export function levelCubic(x0: number, x1: number, y: number): Cubic {
  const third = (x1 - x0) / 3;
  return { x0, y0: y, x1: x0 + third, y1: y, x2: x1 - third, y2: y, x3: x1, y3: y };
}

/**
 * The same curve, displaced by `bow` at its midpoint and by nothing at its ends.
 *
 * This is the only way a line is ever moved on this canvas. Both the fan of
 * alternatives and the two edges of a tapered strand are offsets of one base,
 * which is what makes "these lines cannot cross" a statement about the numbers
 * `bow` rather than a claim about the picture.
 */
export function offsetCubic(base: Cubic, bow: number): Cubic {
  const k = controlHeight(bow);
  return { ...base, y1: base.y1 + k, y2: base.y2 + k };
}

/** y of a cubic at parameter t. */
export function cubicY(c: Cubic, t: number): number {
  const u = 1 - t;
  return u * u * u * c.y0 + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y3;
}

/** x of a cubic at parameter t. */
export function cubicX(c: Cubic, t: number): number {
  const u = 1 - t;
  return u * u * u * c.x0 + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x3;
}

/**
 * The displacement `offsetCubic` applies at parameter t, for a given bow.
 *
 * Exported because measuring code must not re-derive it. The last time two
 * places computed this law independently they disagreed by a factor of 4/3 and
 * agreed with each other consistently enough that a mutation sweep could not see
 * it — mutating either one left them both wrong together.
 */
export function bowDisplacement(bow: number, t: number): number {
  return 3 * controlHeight(bow) * t * (1 - t);
}

/**
 * Split a cubic at parameter `t` into two cubics whose union is the original.
 *
 * De Casteljau, written out rather than looped: at four points it is shorter
 * this way and there is nothing to get wrong in a loop that is not already
 * wrong here. Exact — the two halves reproduce the parent curve pointwise, not
 * approximately, which is what lets a step drawn inside a lane sit *on* that
 * lane instead of near it.
 */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const lerp = (a: number, b: number) => a + (b - a) * t;

  const ax = lerp(c.x0, c.x1);
  const ay = lerp(c.y0, c.y1);
  const bx = lerp(c.x1, c.x2);
  const by = lerp(c.y1, c.y2);
  const cx = lerp(c.x2, c.x3);
  const cy = lerp(c.y2, c.y3);

  const dx = lerp(ax, bx);
  const dy = lerp(ay, by);
  const ex = lerp(bx, cx);
  const ey = lerp(by, cy);

  const fx = lerp(dx, ex);
  const fy = lerp(dy, ey);

  return [
    { x0: c.x0, y0: c.y0, x1: ax, y1: ay, x2: dx, y2: dy, x3: fx, y3: fy },
    { x0: fx, y0: fy, x1: ex, y1: ey, x2: cx, y2: cy, x3: c.x3, y3: c.y3 },
  ];
}

/**
 * Cut a cubic into `count` consecutive pieces of equal parameter length.
 *
 * Equal in **t**, not in arc length. That is the right choice and not a
 * shortcut: the pieces are the steps of one method, drawn in order, and the
 * reader is being shown a sequence rather than a measurement. Equal arc length
 * would need an integral to buy a difference nobody can see on a curve this
 * shallow — the bow is at most a few tens of pixels over a span of hundreds.
 *
 * Each split is taken from the *remaining* tail, so the parameter has to be
 * renormalised: after cutting at `1/3`, the point that was at `2/3` of the whole
 * is at `1/2` of what is left. Getting that wrong bunches every step towards the
 * end, which is a mistake that looks like a layout preference rather than a bug.
 */
export function splitCubicEven(c: Cubic, count: number): Cubic[] {
  if (count <= 1) return [c];
  const out: Cubic[] = [];
  let rest = c;
  for (let cut = 1; cut < count; cut += 1) {
    // Absolute cut position is `cut/count`; `(cut - 1)/count` of the curve has
    // already been taken off the front, so the cut sits this far along the tail.
    const local = 1 / (count - cut + 1);
    const [head, tail] = splitCubic(rest, local);
    out.push(head);
    rest = tail;
  }
  out.push(rest);
  return out;
}

/** Round to a hundredth. Full floats make the emitted HTML noticeably bigger for no gain. */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A cubic as SVG path data, starting with a move. */
export function cubicPath(c: Cubic): string {
  return `M ${n(c.x0)} ${n(c.y0)} C ${n(c.x1)} ${n(c.y1)}, ${n(c.x2)} ${n(c.y2)}, ${n(c.x3)} ${n(c.y3)}`;
}

/**
 * A strand: the region between the offsets at `bow + half` and `bow − half`.
 *
 * Closed, fillable, and pinched to a point at both ends because the two edges
 * are offsets of one base and every offset is zero at t ∈ {0,1}. This is the
 * owner's *"muscle strand-shapes lines"* and the taper the strand view drew with
 * a bespoke `lensPath`; here it falls out of the displacement law instead of
 * being a second shape drawn to resemble it.
 *
 * The second edge is emitted **reversed** — a cubic run backwards is the same
 * cubic with its endpoints and its controls swapped — so the outline is one
 * continuous subpath and fills without a rule about winding.
 */
export function strandOutline(base: Cubic, bow: number, half: number): string {
  const upper = offsetCubic(base, bow - half);
  const lower = offsetCubic(base, bow + half);
  return [
    `M ${n(upper.x0)} ${n(upper.y0)}`,
    `C ${n(upper.x1)} ${n(upper.y1)}, ${n(upper.x2)} ${n(upper.y2)}, ${n(upper.x3)} ${n(upper.y3)}`,
    // Reversed: end point first, controls in the other order.
    `C ${n(lower.x2)} ${n(lower.y2)}, ${n(lower.x1)} ${n(lower.y1)}, ${n(lower.x0)} ${n(lower.y0)}`,
    "Z",
  ].join(" ");
}

/** Where a strand is thickest and where its name therefore goes. */
export function peakOf(base: Cubic, bow: number): { x: number; y: number } {
  return { x: cubicX(base, 0.5), y: cubicY(base, 0.5) + bowDisplacement(bow, 0.5) };
}

/**
 * The point on an offset curve at parameter t — where a nested circle sits.
 *
 * A step boundary inside an opened lane is a real point on that lane, not a
 * point near it. `splitCubicEven` already guarantees the pieces meet there; this
 * is how the *circle* finds the same place without re-deriving it from the
 * pieces.
 */
export function pointOn(base: Cubic, bow: number, t: number): { x: number; y: number } {
  return { x: cubicX(base, t), y: cubicY(base, t) + bowDisplacement(bow, t) };
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
