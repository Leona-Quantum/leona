/**
 * Reveal a streaming answer at a steady rate instead of in provider-sized lumps.
 *
 * The worker buffers model deltas into 160-character chunks before it emits a
 * `chat.delta` (services/worker/src/majorana_worker/handlers.py), and every
 * chunk lands in React state as one atomic append. So the reader sees a
 * paragraph appear, then nothing, then another paragraph — the text is arriving
 * continuously and only the *rendering* is lumpy. Lowering the worker's chunk
 * size would cost one durable event write per few characters; smoothing on the
 * client costs nothing and cannot lose text, because the target string is always
 * the authority and this only decides how much of it is on screen yet.
 *
 * The rate comes from the backlog rather than being fixed, and that is the whole
 * design. Revealing at a constant characters-per-second falls permanently behind
 * a fast model and would still be typing long after the answer finished.
 * Draining the backlog over a constant *time* window instead settles at a
 * standing lag of `LIVE_DRAIN_SECONDS` whatever the arrival rate — the delay is
 * bounded by construction rather than by hoping the model is slow.
 */

/** Steady-state delay between a character arriving and being shown, in seconds. */
const LIVE_DRAIN_SECONDS = 0.28;
/** Much shorter once the whole answer is known — nobody should wait on an animation. */
const SETTLED_DRAIN_SECONDS = 0.05;
/** Slowest reveal, so the last few characters of a chunk do not crawl. */
const MIN_CHARS_PER_SECOND = 180;
/**
 * A guard against one enormous append animating at an absurd rate, not a rate
 * limit: it sits well above anything a model produces, so under live streaming
 * it never binds and the standing lag stays at LIVE_DRAIN_SECONDS.
 */
const MAX_LIVE_CHARS_PER_SECOND = 4000;

export interface RevealStep {
  /** How many characters of the target are on screen now. */
  revealed: number;
  /** The full text received so far. */
  total: number;
  /** Milliseconds since the previous step. */
  deltaMs: number;
  /** True once the answer is complete and only the animation is outstanding. */
  settled: boolean;
}

/**
 * How many characters should be on screen after this frame.
 *
 * Pure: same inputs, same count. It never returns more than `total`, and it
 * always advances by at least one character when there is a backlog — a
 * zero-length frame must not be able to stall the reveal forever.
 */
export function nextRevealed({ revealed, total, deltaMs, settled }: RevealStep): number {
  // A shrinking target is a replacement, not a rewind: `chat.completed` carries
  // the provider's own final text, which can be shorter than the concatenated
  // deltas. Snap rather than animating backwards.
  if (total <= revealed) return total;
  const backlog = total - revealed;
  const drainSeconds = settled ? SETTLED_DRAIN_SECONDS : LIVE_DRAIN_SECONDS;
  const uncapped = Math.max(MIN_CHARS_PER_SECOND, backlog / drainSeconds);
  // Settled is deliberately uncapped: the text is already known and the only
  // thing left is catching up to it.
  const charsPerSecond = settled ? uncapped : Math.min(MAX_LIVE_CHARS_PER_SECOND, uncapped);
  const step = Math.max(1, Math.round((charsPerSecond * Math.max(deltaMs, 0)) / 1000));
  return Math.min(total, revealed + step);
}

/**
 * Where to cut the revealed text so a partial token is not handed to the renderer.
 *
 * Cutting at an arbitrary index splits combining marks and — the case that
 * actually shows up here — half-written LaTeX delimiters and markdown fences,
 * which the markdown renderer then tries to parse and re-parses differently one
 * frame later. Backing up to the last whitespace inside a short lookbehind keeps
 * the visible text renderable without holding anything back for long. The
 * lookbehind is bounded so a long unbroken token (a URL, a base64 blob) still
 * advances.
 */
export function safeCut(text: string, revealed: number): string {
  if (revealed >= text.length) return text;
  if (revealed <= 0) return "";
  const lookbehind = Math.max(0, revealed - 24);
  for (let index = revealed; index > lookbehind; index -= 1) {
    if (/\s/.test(text[index - 1] ?? "")) return text.slice(0, index);
  }
  return text.slice(0, revealed);
}
