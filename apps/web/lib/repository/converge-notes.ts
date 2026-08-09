import type { PublicLocale } from "../public-locale";

/**
 * The two sentences the converge canvas owes a reader about its own limits.
 *
 * **They live here because they belong to the engine, not to a page.** The same
 * `layoutConverge` draws the four-root overview, a focused figure and the
 * zoom on a node's own write-up (R12.1 — *one drawing, everywhere*), so the
 * same two things can happen on any of them: a `?open=` set larger than
 * `CONVERGE_OPEN_MAX`, and a lane with more recorded inside it than
 * `CONVERGE_DEPTH_MAX` goes. Only the overview said either out loud. The node
 * page resolved the dropped count and discarded it, and never looked at
 * `depthCapped` at all, so the identical URL was honest on one surface and
 * silent on the other.
 *
 * Copied strings would have fixed that for a session. Two components holding
 * two copies of one claim is how the two surfaces come to describe one cap
 * differently, so there is one wording and both read it.
 */
export interface ConvergeNotes {
  /**
   * More was asked open than the figure will hold.
   *
   * Both numbers, always: *how many were lost* is the reader's question and
   * *how many are drawn* is what makes the sentence checkable against the
   * picture in front of them.
   */
  droppedOpen: (dropped: number, max: number) => string;
  /** Something drawn here has more inside it than this figure goes deep. */
  depthCapped: string;
}

const NOTES: Record<PublicLocale, ConvergeNotes> = {
  en: {
    droppedOpen: (dropped: number, max: number) =>
      `This link asked to open ${dropped} more ${dropped === 1 ? "thing" : "things"} than the figure will hold at once. `
      + `${max} are drawn; the rest are shown shut.`,
    depthCapped:
      "Something on this figure has more recorded inside it than this drawing goes. Open it on its own page to keep going.",
  },
  ja: {
    droppedOpen: (dropped: number, max: number) =>
      `このリンクは、同時に開ける上限より ${dropped} 件多くを要求しました。${max} 件を描画し、残りは閉じたまま表示しています。`,
    depthCapped:
      "この図の描画の深さを超えて内側が記録されている線があります。その頁を開くと続きを見られます。",
  },
};

export function convergeNotes(locale: PublicLocale): ConvergeNotes {
  return locale === "ja" ? NOTES.ja : NOTES.en;
}
