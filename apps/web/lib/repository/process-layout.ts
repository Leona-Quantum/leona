// Two pieces of the retired process map that are still load-bearing.
//
// This module used to be the whole crossing-free process-map engine: states as
// circles, processes as the lines between them, laid out so that "there must be
// no overlapping lines or states anywhere" (owner, session-91 inbox) held by
// construction rather than by a crossing-minimisation heuristic. That map —
// `layoutProcessMap`, `layoutProcessZoom`, and the address builders around them
// (`mapHref`, `slotHref`, `zoomHref`, `resolveZoom`, `MAP_ZOOMS`) — was retired
// this session: `/repository/layers` no longer reads `?view=`, and
// `repository-layers.tsx` draws a `ConvergeCanvas` for every reading instead.
// Every consumer of that engine was `repository-process-view.tsx` and
// `repository-process-map.tsx`, both deleted with it, so it went too — checked
// by grep, not assumed, because this exact module also survived one prior
// retirement (the strand canvas) as dead weight nobody had re-checked.
//
// What is left is two text-measurement helpers and one address builder that
// `converge-layout.ts` still imports, because the strand geometry these came
// from (`strand-layout.ts`) drew a **containment** picture and this module's
// version already assumed a slot has no drawn name — the state the converge
// engine also starts from. Splitting them into a third file would be a rename
// with no behaviour change; they stay here, named for what they still do.

/**
 * The size the map draws a line's name at, in px.
 *
 * Here rather than in `converge-layout.ts` because two modules need it and this
 * one has no imports, so it can be the single writer. `CONVERGE_METRICS.laneFont`
 * reads it, and so does `validateLayerGraph`, which has to answer "is this short
 * form actually narrower than the label it replaces" in the units the map draws
 * in — a question that is meaningless at an assumed font size, and wrong in the
 * one direction that matters, since a Japanese short form can shed half its
 * characters and get wider. Two copies of this number is the
 * tally-computed-in-five-places class of bug the repository has already paid for
 * twice; see `AGENTS.md`.
 */
export const LANE_FONT_PX = 12;

/**
 * How tall a drawn name's **ink** is, as a multiple of the font size.
 *
 * ## The number the engine did not have
 *
 * Every place the layout reserved room for a name modelled its box as
 * `[baseline − laneFont, baseline]` — `laneFont` tall, ending at the baseline.
 * A name does not end at its baseline. Measured with `getBBox()` against the
 * real `next/font` face on the rendered page, a 12px Japanese name draws
 * **15.2px** tall, and `NamePlate` in `repository-converge-map.tsx` has been
 * sized and placed around that measurement since before this constant existed:
 * its cover is 17px at `baseline − 12.5`, tuned to sit 1.0px above the ink and
 * 1.5px below it, which puts the ink at `[baseline − 11.5, baseline + 3.0]`.
 *
 * So the model was right about the ascent — 12 is a shade over the 11.5 the
 * plate found, and guessing high there is the safe direction — and had **no
 * descender at all**. That missing third of a name is not academic: measured
 * over all 46 figure-locales, shut and saturated, it is 11 pairs of names whose
 * ink overlaps on the page by 2.4px each, none of which any of the 88 layout
 * invariants could see, because all 88 were asking about a box that stops where
 * the descenders start.
 *
 * `NAME_INK_RATIO` is the getBBox figure (15.2 / 12); the ascent stays at the
 * `1` the layout already assumed and already gets right, and the descent is the
 * remainder. Stated as ratios rather than as three pixel constants so that the
 * one number a reader can check — 15.2px at 12px — is the one written down, and
 * so that `laneFont` remains the single writer for the size a name is drawn at.
 *
 * **One writer, two readers**: `converge-layout.ts` reserves against it and
 * `repository-converge-layout.test.ts` collides against it. `NamePlate` is
 * deliberately **not** made a third: its 12.5/17 pair is where this measurement
 * was taken, but it describes the *plate*, not the ink — the two are different
 * shapes, and the plate's half-pixel asymmetry is documented there as protection
 * for a CJK fallback face whose ascent this repository cannot see. Rewriting it
 * from these ratios would move a tuned number for tidiness. It stays the source
 * of the measurement rather than a copy of it.
 */
export const NAME_INK_RATIO = 15.2 / 12;
/** Above the baseline. The layout's existing assumption, and the plate's 11.5px
 *  measurement says it is a safe over-estimate rather than a guess. */
export const NAME_ASCENT_RATIO = 1;
/** Below the baseline — the part no reservation on this canvas modelled. */
export const NAME_DESCENT_RATIO = NAME_INK_RATIO - NAME_ASCENT_RATIO;

/**
 * The plate under a name, as multiples of the font size — **the box a reader
 * actually sees**, and therefore what a reservation has to clear.
 *
 * `NamePlate` has drawn `y = labelY − 12.5, height = 17` since session 107, and
 * its comment carries the reasoning for both halves of the asymmetry: the height
 * came from `getBBox()`, and the extra half pixel above the ink is deliberate
 * protection for a CJK fallback face whose ascent this repository cannot see,
 * because Instrument Sans has no CJK glyphs. **Those two numbers are unchanged
 * here** — this is where they live now, not a new pair, so that the layout can
 * reserve against the same shape the component draws.
 *
 * Reserving the plate rather than the bare ink is worth the ~2px it costs.
 * Measured on the rendered page: with only the ink reserved, an opened chain's
 * name cleared the first leaf inside it by **0.20px** and their two plates still
 * overlapped by 1.80px. 0.20px is not clearance — it is the difference between
 * the 15.2px this file models and the 15.0px the Latin face happened to draw,
 * and on the CJK fallback the plate's own comment is about it goes negative.
 */
export const NAME_PLATE_TOP_RATIO = 12.5 / LANE_FONT_PX;
export const NAME_PLATE_HEIGHT_RATIO = 17 / LANE_FONT_PX;
/** How far the plate reaches below the baseline. */
export const NAME_PLATE_BELOW_RATIO = NAME_PLATE_HEIGHT_RATIO - NAME_PLATE_TOP_RATIO;

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

/**
 * Shorten to fit, and say so. The full text always rides in a `<title>`.
 *
 * `suffix` is text that must survive the cut — the repeat mark, `×T/h`, which is
 * appended to a lane's name and is the one thing on that lane the reader cannot
 * learn anywhere else on the canvas. It is **measured with** the kept text rather
 * than subtracted from `maxWidth` first, and that is not a style choice: the
 * caller's budget was measured off the whole string, and
 * `width(name) + width(suffix)` is not `width(name + suffix)` in floating point.
 * The first version subtracted, and `Block-encode a matrix ×m` was cut by one
 * character at a budget exactly equal to its own demand — a wrong-reason
 * truncation of the same family as the 0.05px one `columnFit` already carries a
 * comment about. One measurement, one derivation.
 *
 * `truncated` describes the **text**, never the suffix, which is never cut.
 */
export function fitLabel(
  text: string,
  fontSize: number,
  maxWidth: number,
  suffix = "",
): { text: string; truncated: boolean } {
  if (estimateTextWidth(text + suffix, fontSize) <= maxWidth) {
    return { text: text + suffix, truncated: false };
  }
  const characters = [...text];
  let kept = "";
  for (let index = 0; index < characters.length; index += 1) {
    const next = kept + characters[index];
    if (estimateTextWidth(next + "…" + suffix, fontSize) > maxWidth) break;
    kept = next;
  }
  // A cut that saves nothing is not a cut.
  //
  // The loop above stops on *pixels*, and one dropped character plus an ellipsis
  // can come back the same length: `レベルセット法による厳密な線形化` is sixteen
  // characters and so is `レベルセット法による厳密な線形…`, which shows a reader
  // the mark that says "there is more here" in exchange for the one character it
  // hid. Widened Japanese labels are where this surfaces — a wide glyph is one
  // character, so the pixel budget runs out a single character early.
  //
  // Found by the layout suite's own invariant (a cut label is strictly shorter
  // than the whole one), not by looking at the picture, and only once `via`
  // started putting method names on hops. Dropping one more character keeps the
  // fit — the result is strictly narrower than what already fitted — and makes
  // the ellipsis mean something again.
  let cut = [...kept.trimEnd()];
  while (cut.length > 0 && cut.length + 1 >= characters.length) cut = cut.slice(0, -1);
  return { text: cut.join("") + "…" + suffix, truncated: true };
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
