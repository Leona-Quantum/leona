"use client";

import type { ReactNode } from "react";

/**
 * Landing hero scroll cue: an anchor to the intro section that upgrades the
 * native hash jump to a smooth scroll when motion is allowed. Scoped to the
 * click so html-level scroll-behavior cannot leak into App Router navigation
 * scroll resets. No-JS falls back to the plain hash jump.
 */
export function ScrollCue({ href, targetId, children }: { href: string; targetId: string; children: ReactNode }) {
  return (
    <a
      className="mj-company-scroll-cue"
      href={href}
      onClick={(event) => {
        const target = document.getElementById(targetId);
        if (!target) return;
        event.preventDefault();
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        history.replaceState(null, "", href);
      }}
    >
      {children}
    </a>
  );
}
