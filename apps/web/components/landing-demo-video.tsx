"use client";

import { useEffect, useRef } from "react";

type LandingDemoVideoProps = {
  label: string;
  describedById: string;
  poster: string;
  src: string;
  fallback: string;
};

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * The landing page's product demo, which starts itself only if motion is welcome.
 *
 * ## Why this is a client component rather than a `<video autoPlay loop>`
 *
 * The reduced-motion rules in `globals.css` reach animations and transitions.
 * They cannot reach media playback: no CSS property stops a `<video>`, so a
 * 47-second loop kept running for exactly the readers who asked the platform,
 * at the OS level, for things to stop moving. WCAG 2.2.2 is satisfied in the
 * narrow sense by the `controls` attribute — there IS a pause button — but
 * "you may switch it off after it starts" is not what the preference asks for.
 * Raised by CodeRabbit on the PR that added the video.
 *
 * ## Why the markup carries no `autoplay` attribute at all
 *
 * The obvious shape is to autoplay and then pause on mount if the preference is
 * set. That inverts the guarantee: it plays first and apologises afterwards, so
 * a reader who asked for no motion gets a flash of it before hydration lands.
 * Starting playback here instead means motion begins only after the preference
 * has actually been read.
 *
 * The cost is that the demo waits for hydration rather than for the parser, and
 * that a reader with JavaScript off gets a poster frame and a play button. Both
 * are acceptable for a marketing loop and neither is acceptable in reverse.
 * `preload="metadata"` stays on the element, so the first frames are already in
 * flight while React is still catching up.
 *
 * ## Why `loop` moves too
 *
 * A single 47-second play is a much smaller ask than an unbounded one. If the
 * preference is set, the video is left entirely under the reader's control:
 * they may start it, and it stops at the end.
 *
 * The listener re-runs on change, so toggling the OS setting with the page open
 * does the right thing in both directions rather than only on next load.
 */
export function LandingDemoVideo({ label, describedById, poster, src, fallback }: LandingDemoVideoProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const query = window.matchMedia(REDUCED_MOTION);

    function apply() {
      const element = ref.current;
      if (!element) return;
      if (query.matches) {
        element.loop = false;
        // `pause()` rather than leaving it alone: this also handles the reader
        // who turns the preference ON while the loop is already running.
        element.pause();
        return;
      }
      element.loop = true;
      // A rejected promise here is the browser declining autoplay — a policy
      // decision, not a fault — and the poster frame plus `controls` is already
      // the correct fallback for it, so there is nothing to report and nothing
      // to retry. Swallowed deliberately; an unhandled rejection in the console
      // on every load would be worse than the thing it describes.
      void element.play().catch(() => {});
    }

    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return (
    <video
      aria-describedby={describedById}
      aria-label={label}
      className="lq-landing-demo-video"
      controls
      muted
      playsInline
      poster={poster}
      preload="metadata"
      ref={ref}
    >
      <source src={src} type="video/mp4" />
      <a href={src}>{fallback}</a>
    </video>
  );
}
