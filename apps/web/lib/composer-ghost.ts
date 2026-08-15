/**
 * The composer's typed-and-backspaced suggestion, as a pure function of time.
 *
 * A rotating placeholder that types a real prompt out, holds it, deletes it and
 * moves on shows what this thing can be *asked* — a static "Ask anything about
 * quantum algorithms…" does not. Tab accepts whatever is on screen at that
 * moment, so the suggestion has to be derivable from a timestamp alone: there is
 * no other way for the key handler and the animation to agree on which prompt
 * the user thinks they are accepting.
 *
 * Deriving the frame from elapsed time rather than stepping a counter also means
 * a backgrounded tab (where rAF stops) resumes at the right place instead of
 * replaying however many frames it missed.
 */

// Retiming, owner ai-ops 108: "typing out to occur faster, pause a bit, then
// quick deletion, very short pause before next one gets written out." Exported
// so the timing lives in exactly one place — the test file pins the values
// below and derives every boundary in this file from these constants, rather
// than repeating the numbers, so a retune here cannot silently drift out of
// sync with what the tests assert.
export const TYPE_MS_PER_CHARACTER = 30; // was 55 — faster type-out
export const DELETE_MS_PER_CHARACTER = 12; // was 22 — quick deletion, 2.5x the typing speed
export const HOLD_MS = 1400; // was 2200 — a shorter but still readable pause on the finished sentence
export const GAP_MS = 140; // was 420 — a very short pause before the next prompt starts

export type GhostPhase = "typing" | "holding" | "deleting" | "gap";

export interface GhostFrame {
  /** The characters to show as the placeholder right now. */
  text: string;
  /** The full prompt Tab would accept — never a partial one. */
  suggestion: string;
  /** Which suggestion this is, for keys and tests. */
  index: number;
  /**
   * Where in the cycle this frame falls. A caller renders a blinking caret
   * during `"typing"` and `"deleting"` only (owner, ai-ops 108) — `"holding"`
   * shows the finished sentence sitting still, and `"gap"` is the empty pause
   * between prompts, which must render as nothing rather than a fallback
   * string (that fallback *was* the "text that appears in between each
   * rotation" the owner asked to have removed).
   */
  phase: GhostPhase;
}

function cycleMs(suggestion: string): number {
  return (
    suggestion.length * TYPE_MS_PER_CHARACTER
    + HOLD_MS
    + suggestion.length * DELETE_MS_PER_CHARACTER
    + GAP_MS
  );
}

/**
 * The placeholder at `elapsedMs`.
 *
 * `suggestion` is always the whole prompt even mid-type, so pressing Tab when
 * three characters are showing still materialises the complete question. Showing
 * one thing and inserting another would be the actual bug here.
 */
export function ghostFrame(elapsedMs: number, suggestions: readonly string[]): GhostFrame | null {
  const usable = suggestions.filter((suggestion) => suggestion.trim().length > 0);
  if (!usable.length) return null;
  const total = usable.reduce((sum, suggestion) => sum + cycleMs(suggestion), 0);
  let offset = ((elapsedMs % total) + total) % total;
  for (const [index, suggestion] of usable.entries()) {
    const span = cycleMs(suggestion);
    if (offset >= span) {
      offset -= span;
      continue;
    }
    const typing = suggestion.length * TYPE_MS_PER_CHARACTER;
    const holding = typing + HOLD_MS;
    const deleting = holding + suggestion.length * DELETE_MS_PER_CHARACTER;
    if (offset < typing) {
      return { text: suggestion.slice(0, Math.floor(offset / TYPE_MS_PER_CHARACTER)), suggestion, index, phase: "typing" };
    }
    if (offset < holding) return { text: suggestion, suggestion, index, phase: "holding" };
    if (offset < deleting) {
      const deleted = Math.floor((offset - holding) / DELETE_MS_PER_CHARACTER);
      return { text: suggestion.slice(0, Math.max(0, suggestion.length - deleted)), suggestion, index, phase: "deleting" };
    }
    return { text: "", suggestion, index, phase: "gap" };
  }
  // Unreachable: `offset` is reduced modulo the sum of every span above.
  return { text: "", suggestion: usable[0], index: 0, phase: "gap" };
}

/**
 * The frame a composer should actually draw, or `null` for "draw nothing".
 *
 * This exists because both composers used to decide that for themselves and
 * they decided it differently. The workspace refused to render once the field
 * had a value; the landing page only stopped its *clock*, which freezes
 * `elapsedMs` without unmounting anything — so a half-typed example stayed
 * painted in the box and the visitor's own words rendered on top of it (owner,
 * ai-ops 112). Two call sites, one rule, and the rule now has one home.
 *
 * `typedValue` is the field's current contents rather than a boolean so a
 * caller cannot pass the wrong polarity, and whitespace counts as typed — a
 * visitor holding down the space bar is still using the box.
 */
export function composerGhost({
  elapsedMs,
  suggestions,
  typedValue,
  reduceMotion,
}: {
  elapsedMs: number;
  suggestions: readonly string[] | undefined;
  typedValue: string;
  reduceMotion: boolean;
}): GhostFrame | null {
  if (!suggestions?.length) return null;
  if (typedValue.length > 0) return null;
  if (reduceMotion) {
    // The whole prompt sitting still rather than an empty box, `phase:
    // "holding"` so `ComposerGhostOverlay` never draws a caret here — no blink
    // and no typing effect for a reader who asked for less motion (ai-ops 108).
    const frame = ghostFrame(0, suggestions);
    return frame ? { ...frame, text: frame.suggestion, phase: "holding" } : null;
  }
  return ghostFrame(elapsedMs, suggestions);
}
