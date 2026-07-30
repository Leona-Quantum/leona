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

const TYPE_MS_PER_CHARACTER = 55;
const DELETE_MS_PER_CHARACTER = 22;
const HOLD_MS = 2200;
const GAP_MS = 420;

export interface GhostFrame {
  /** The characters to show as the placeholder right now. */
  text: string;
  /** The full prompt Tab would accept — never a partial one. */
  suggestion: string;
  /** Which suggestion this is, for keys and tests. */
  index: number;
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
      return { text: suggestion.slice(0, Math.floor(offset / TYPE_MS_PER_CHARACTER)), suggestion, index };
    }
    if (offset < holding) return { text: suggestion, suggestion, index };
    if (offset < deleting) {
      const deleted = Math.floor((offset - holding) / DELETE_MS_PER_CHARACTER);
      return { text: suggestion.slice(0, Math.max(0, suggestion.length - deleted)), suggestion, index };
    }
    return { text: "", suggestion, index };
  }
  // Unreachable: `offset` is reduced modulo the sum of every span above.
  return { text: "", suggestion: usable[0], index: 0 };
}
