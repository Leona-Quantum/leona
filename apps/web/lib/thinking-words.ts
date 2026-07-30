/**
 * The word shown while a turn is being worked on, before any answer text exists.
 *
 * A bare three-dot pulse says "something is happening" and nothing else; it
 * reads the same at 400 ms and at forty seconds. A word that changes is honest
 * about elapsed time without inventing a progress bar for work whose length
 * nobody knows — and this pipeline genuinely can take a while, because a run
 * classifies intent, generates, executes in a sandbox and then reviews.
 *
 * Deterministic in `elapsedMs` so the caller can render it from an animation
 * frame with no state, and seeded per turn so two conversations open side by
 * side do not recite the same list in lockstep.
 */

const ROTATE_MS = 2600;

const WORDS = {
  en: [
    "Thinking",
    "Pondering",
    "Reasoning it through",
    "Weighing the approach",
    "Working through the maths",
    "Considering",
    "Lining up the circuit",
    "Still thinking",
  ],
  ja: [
    "考えています",
    "検討しています",
    "筋道を立てています",
    "方針を練っています",
    "計算を確かめています",
    "整理しています",
    "回路を組み立てています",
    "まだ考えています",
  ],
} as const;

export type ThinkingLocale = keyof typeof WORDS;

/** A small stable offset from an arbitrary string, so each turn starts elsewhere. */
export function thinkingSeed(value: string | null | undefined): number {
  if (!value) return 0;
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) % 9973;
  return hash;
}

export function thinkingWord(elapsedMs: number, locale: ThinkingLocale = "en", seed = 0): string {
  const words = WORDS[locale];
  const rotating = words.slice(0, -1);
  const steps = Math.floor(Math.max(elapsedMs, 0) / ROTATE_MS);
  // The last entry is a terminus, not part of the loop. Once a turn has been
  // going for a while, cycling back to "Thinking" implies it started over;
  // "Still thinking" is the truthful thing to say and it stays there.
  if (steps >= rotating.length) return words[words.length - 1];
  return rotating[(steps + Math.max(seed, 0)) % rotating.length];
}

export function thinkingWordCount(locale: ThinkingLocale = "en"): number {
  return WORDS[locale].length;
}
