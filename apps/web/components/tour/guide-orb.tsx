"use client";

import type { CSSProperties } from "react";

export type GuideOrbState = "rest" | "speaking" | "success" | "miss";

/**
 * The guide: a small point of light that breathes, trailing a faint wave.
 *
 * The owner asked for this in place of a talking character (ai-ops 298): "a chat
 * text box coming from somewhere (a particle or wave or something that has easy
 * constant animation)". It is drawn with CSS and one SVG path — no canvas, no
 * animation loop in JavaScript — so it costs nothing while it sits still and the
 * browser pauses it in a hidden tab. It travels by a transform transition; under
 * reduced motion it neither breathes nor travels, it is simply where it needs to be.
 *
 * `trail` is the direction it last came from, in degrees, so the wave streams
 * behind it rather than in front.
 */
export function GuideOrb({ x, y, state, trail }: { x: number; y: number; state: GuideOrbState; trail: number }) {
  const style = { transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`, "--mj-tour-trail": `${trail}deg` } as CSSProperties;
  return (
    <div className="mj-tour-orb" data-state={state} style={style} aria-hidden="true">
      <svg className="mj-tour-orb-wave" viewBox="0 0 96 20" preserveAspectRatio="none" focusable="false">
        <path d="M0 10 C 8 3, 16 3, 24 10 S 40 17, 48 10 S 64 3, 72 10 S 88 17, 96 10" />
        <path className="mj-tour-orb-wave-echo" d="M0 10 C 8 5, 16 5, 24 10 S 40 15, 48 10 S 64 5, 72 10 S 88 15, 96 10" />
      </svg>
      <span className="mj-tour-orb-halo" />
      <span className="mj-tour-orb-core" />
    </div>
  );
}
