"use client";

import { LEO_LINKS, LEO_STARS } from "./leo-constellation";

/**
 * Compact constellation mark for the Run home hero. The asterism draws itself
 * in on mount (links sweep, stars pop, a single phase dot orbits the bright
 * state), brightens on hover, and leans toward the composer while it has
 * focus. Purely decorative — the greeting beside it carries the text — so the
 * whole SVG stays aria-hidden. All motion lives in globals.css and collapses
 * under prefers-reduced-motion.
 */
const W = 132;
const H = 92;
const PAD = 8;

const px = (x: number) => PAD + x * (W - PAD * 2);
const py = (y: number) => PAD + y * (H - PAD * 2);

export function RunHeroMark({ engaged = false }: { engaged?: boolean }) {
  const bright = LEO_STARS[0];
  return (
    <span className={`mj-hero-mark${engaged ? " is-engaged" : ""}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fill="none">
        {LEO_LINKS.map(([a, b], index) => (
          <line
            key={`${a}-${b}`}
            className="mj-hero-link"
            style={{ animationDelay: `${120 + index * 90}ms` }}
            pathLength={1}
            x1={px(LEO_STARS[a].x)}
            y1={py(LEO_STARS[a].y)}
            x2={px(LEO_STARS[b].x)}
            y2={py(LEO_STARS[b].y)}
          />
        ))}
        {LEO_STARS.map((star, index) => (
          <circle
            key={star.name ?? index}
            className={`mj-hero-star${index === 0 ? " mj-hero-star--bright" : ""}`}
            style={{ animationDelay: `${index * 110}ms` }}
            cx={px(star.x)}
            cy={py(star.y)}
            r={star.r}
          />
        ))}
        <g className="mj-hero-orbit" style={{ transformOrigin: `${px(bright.x)}px ${py(bright.y)}px` }}>
          <circle className="mj-hero-orbit-dot" cx={px(bright.x) + bright.r + 6} cy={py(bright.y)} r={1.4} />
        </g>
      </svg>
    </span>
  );
}
