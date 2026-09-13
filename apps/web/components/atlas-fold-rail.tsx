"use client";

/**
 * The sticky row of section names over an Atlas page's folds.
 *
 * Every name is a plain `#id` link, so with JavaScript off it still jumps to the
 * section and the browser opens the `<details>` it lands on. The script adds
 * three things only: it opens the section before the jump (so the scroll lands
 * on the open section rather than on a closed one that then grows), it marks
 * the section in view, and it offers open-all / close-all.
 */
import { useEffect, useRef, useState } from "react";

export interface AtlasFoldRailItem {
  readonly id: string;
  readonly label: string;
}

function openDetails(id: string): void {
  const element = document.getElementById(id);
  if (element instanceof HTMLDetailsElement) element.open = true;
}

export function AtlasFoldRail({
  items,
  label,
  openAllLabel,
  closeAllLabel,
}: {
  items: readonly AtlasFoldRailItem[];
  label: string;
  openAllLabel: string;
  closeAllLabel: string;
}): React.ReactElement | null {
  const [current, setCurrent] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const ids = items.map((item) => item.id).join(" ");

  useEffect(() => {
    const openFromHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) openDetails(id);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    const targets = ids
      .split(" ")
      .map((id) => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    targets.forEach((target) => observer.observe(target));
    return () => {
      window.removeEventListener("hashchange", openFromHash);
      observer.disconnect();
    };
  }, [ids]);

  function setAll(open: boolean) {
    const scope = railRef.current?.closest("[data-atlas-folds]") ?? document;
    scope.querySelectorAll<HTMLDetailsElement>("details.mj-atlas-fold").forEach((details) => {
      details.open = open;
    });
  }

  if (items.length === 0) return null;
  return (
    <nav className="mj-atlas-rail" aria-label={label} ref={railRef}>
      <ul className="mj-atlas-rail-list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={current === item.id ? "location" : undefined}
              onClick={() => openDetails(item.id)}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
      <span className="mj-atlas-rail-actions">
        <button type="button" onClick={() => setAll(true)}>
          {openAllLabel}
        </button>
        <button type="button" onClick={() => setAll(false)}>
          {closeAllLabel}
        </button>
      </span>
    </nav>
  );
}
