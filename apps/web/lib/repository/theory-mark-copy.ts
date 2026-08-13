/**
 * What the two marks inside a hop's mathematics are *called*, in both locales —
 * **written once.**
 *
 * Extracted for exactly the reason `loop-closure-copy.ts` was, and the comment
 * there states the rule this file now obeys a second time: the labels were
 * authored on `map-card-panel.tsx` when the card was the only surface that drew
 * a hop's mathematics, and a second surface began drawing the same records.
 *
 * The second surface is the method page's *Requires* section. `CardIngredient`
 * already carries the note — its own doc comment records that the note was
 * "written about an ingredient rendered on no surface at all" — and the card
 * was the only reader. Giving the page a reader meant either importing the
 * card panel's private `Copy` object into a page that shares none of the rest
 * of it, or writing "approximation" and "assumption" a second time. This is
 * the third option.
 *
 * **These are labels, not claims, and the distinction is why this file is four
 * strings rather than four sentences.** `loop-closure-copy.ts` holds two
 * paragraphs about what a loop costs, because those say something a reader
 * could be misled by. A mark's name says which of two kinds of clause is
 * underlined. It still lives here for the ordinary reason: the same word must
 * appear on both surfaces, and the screen-reader prefix a marked span carries
 * is built from it, so a divergence would be inaudible rather than visible.
 *
 * **Not in `theory-marks.ts`.** That module is the syntax and its validator,
 * imported by the graph and by the checkers; this is the prose a rendering
 * surface reads the marks out with. Same boundary `loop-closure-copy.ts` keeps
 * against `layers.ts`, and for the same reason — a locale string in a module
 * the build tools import is a locale string every one of them has to ignore.
 */
import type { TheoryMark } from "./theory-marks.ts";

export const THEORY_MARK_COPY: Record<"en" | "ja", Record<TheoryMark, string>> = {
  en: {
    approximation: "approximation",
    assumption: "assumption",
  },
  ja: {
    approximation: "近似",
    assumption: "仮定",
  },
};
