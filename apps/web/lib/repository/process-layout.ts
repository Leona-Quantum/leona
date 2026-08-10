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
