"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Scroll-reveal wrapper for the public marketing surface. Content is visible by
 * default (no-JS and reduced-motion safe): the hidden state is only applied
 * after mount by the observer, and only while the element is outside the
 * viewport, so reveals replay on the way back up as well as on the way down
 * (Owner Inbox 2026-07-17). CSS drops the transition entirely under
 * prefers-reduced-motion.
 */
export function Reveal({
  children,
  className = "",
  delay,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // Toggle rather than disconnect after the first pass: hidden exactly while
    // out of view, so the rise replays in both scroll directions. The first
    // async callback also replaces the old mount-time rect check — elements
    // already in view get a no-op, elements below the fold get hidden before
    // they can be seen.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          node.classList.toggle("mj-reveal--pending", !entry.isIntersecting);
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`mj-reveal ${className}`.trim()} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}
