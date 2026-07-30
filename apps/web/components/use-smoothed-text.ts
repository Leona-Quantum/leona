"use client";

import { useEffect, useRef, useState } from "react";
import { nextRevealed, safeCut } from "../lib/stream-smoothing.ts";

/** Reveal cadence. Not `requestAnimationFrame` — see the note below. */
const TICK_MS = 16;

/**
 * Show `text` as continuous typing rather than in the lumps it arrives in.
 *
 * The pacing is `lib/stream-smoothing`; this is only the clock around it.
 *
 * The clock is a timer rather than `requestAnimationFrame`, which is the
 * obvious choice and the wrong one here. rAF does not fire at all in a
 * background or occluded tab, so an answer that arrived while the reader was in
 * another tab would still be sitting half-revealed when they came back, with
 * nothing to restart it. A timer is throttled to roughly one second in that
 * situation instead of stopped — and because the reveal rate is derived from the
 * backlog, one throttled tick with a second of elapsed time simply reveals
 * everything. The tab that nobody is looking at catches up on its own, with no
 * visibility special-case to get wrong. Nothing here is compositor-driven, so
 * frame alignment buys nothing.
 *
 * Under `prefers-reduced-motion` the text is returned whole: a reader who asked
 * for no motion should not have words withheld from them.
 */
export function useSmoothedText(text: string, settled: boolean): string {
  const [revealed, setRevealed] = useState(0);
  const revealedRef = useRef(0);
  // Starts false so the server-rendered and first client renders agree; the
  // effect corrects it before anything is painted.
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduceMotion(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      revealedRef.current = text.length;
      setRevealed(text.length);
      return;
    }
    // A shorter target is a replacement, not a rewind — keep the ref in step so
    // the next tick does not start from a count past the end of the new string.
    if (revealedRef.current > text.length) {
      revealedRef.current = text.length;
      setRevealed(text.length);
    }
    if (revealedRef.current >= text.length) return;
    let previous = Date.now();
    const timer = window.setInterval(() => {
      const now = Date.now();
      const next = nextRevealed({
        revealed: revealedRef.current,
        total: text.length,
        deltaMs: now - previous,
        settled,
      });
      previous = now;
      if (next !== revealedRef.current) {
        revealedRef.current = next;
        setRevealed(next);
      }
      if (next >= text.length) window.clearInterval(timer);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [text, settled, reduceMotion]);

  if (reduceMotion) return text;
  return safeCut(text, revealed);
}
