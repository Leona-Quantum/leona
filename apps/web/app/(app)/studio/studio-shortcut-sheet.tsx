"use client";

import { useEffect, useRef } from "react";
import { STUDIO_SHORTCUT_ROWS } from "../../../lib/studio-shortcuts";
import type { PublicLocale } from "../../../lib/public-locale";
import type { WORKSPACE_COPY } from "../../../lib/workspace-locale";

type StudioCopy = (typeof WORKSPACE_COPY)[PublicLocale]["studio"];

const GROUPS = ["general", "visual", "simulation"] as const;

/**
 * The `?` sheet. It renders from STUDIO_SHORTCUT_ROWS, the same table the key
 * handler is tested against, so it cannot list a chord that does nothing.
 * Focus moves to Close on open and returns to wherever it was on close.
 */
export function ShortcutSheet({ onClose, copy }: { onClose: () => void; copy: StudioCopy }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="mj-shortcut-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="mj-shortcut-sheet" role="dialog" aria-modal="true" aria-labelledby="studio-shortcuts-title">
        <header className="mj-shortcut-sheet-head">
          <h2 id="studio-shortcuts-title">{copy.shortcutsTitle}</h2>
          <button ref={closeRef} className="mj-icon-button" type="button" aria-label={copy.shortcutsClose} title={copy.shortcutsClose} onClick={onClose}>
            <span aria-hidden="true">×</span>
          </button>
        </header>
        <div className="mj-shortcut-groups">
          {GROUPS.map((group) => (
            <div className="mj-shortcut-group" key={group}>
              <h3>{copy.shortcutGroups[group]}</h3>
              <dl>
                {STUDIO_SHORTCUT_ROWS.filter((row) => row.group === group).map((row) => (
                  <div key={row.id}>
                    <dt>{copy.shortcutRows[row.id]}</dt>
                    <dd>{row.keys.map((key) => <kbd key={key}>{key}</kbd>)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
