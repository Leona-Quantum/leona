"use client";

import { useEffect, useState } from "react";
import { thinkingSeed, thinkingWord, type ThinkingLocale } from "../lib/thinking-words.ts";

/**
 * The word shown while a turn is being worked on.
 *
 * Replaces a bare three-dot pulse, which reads identically at 400 ms and at
 * forty seconds. The word list and its rotation live in `lib/thinking-words`;
 * this only holds a clock. The dots stay alongside it — they are the part that
 * says "still connected", and they are the only motion here, so
 * `prefers-reduced-motion` is handled by the existing CSS for them rather than
 * by suppressing the word.
 *
 * `aria-live` is deliberately absent: a screen reader announcing a new word
 * every two and a half seconds while waiting is worse than silence. The
 * surrounding thread already carries `aria-live="polite"` for the answer itself.
 */
export function ThinkingLabel({
  locale = "en",
  turnId,
  className = "mj-chat-thinking-label",
}: {
  locale?: ThinkingLocale;
  turnId?: string | null;
  className?: string;
}) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    const started = Date.now();
    const timer = window.setInterval(() => setElapsedMs(Date.now() - started), 900);
    return () => window.clearInterval(timer);
  }, [turnId]);

  return (
    <span className={className}>
      <span className="mj-chat-thinking-word">{thinkingWord(elapsedMs, locale, thinkingSeed(turnId))}</span>
      {/* The dots keep their own wrapper because their stagger is written as
          :nth-child, and putting the word first in the same box would shift
          every delay onto the wrong dot. */}
      <span className="mj-chat-loading-dots" aria-hidden="true">
        <span className="mj-chat-loading-dot" />
        <span className="mj-chat-loading-dot" />
        <span className="mj-chat-loading-dot" />
      </span>
    </span>
  );
}
