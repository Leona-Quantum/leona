"use client";

import type { StudioPanel } from "../lib/studio-panels";

/**
 * The four-tab bar Studio and the artifact detail view both render.
 *
 * One component because they are one control: the two surfaces used to carry
 * near-identical `<nav>` + `<button>` + `.is-active` markup that had already
 * drifted apart (36px min-height on one, none on the other), and a third copy
 * would have drifted further.
 *
 * It is a real ARIA tab widget rather than a row of buttons. `.is-active` is a
 * class — it changes what the tab looks like and tells a screen reader nothing,
 * so every tab announced identically and the selected one was unfindable
 * without sight. `aria-selected` is the part that carries the state; the
 * `aria-controls`/`id` pair is what lets a reader jump from the tab to the panel
 * it opened. State stays with the caller: this renders, it does not decide.
 */
export function PanelTabs({
  panels,
  active,
  onSelect,
  label,
  labelFor,
  idPrefix,
  className = "mj-studio-tabs",
}: {
  panels: readonly StudioPanel[];
  active: StudioPanel;
  onSelect: (panel: StudioPanel) => void;
  label: string;
  labelFor: (panel: StudioPanel) => string;
  idPrefix: string;
  className?: string;
}) {
  return (
    <nav className={className} role="tablist" aria-label={label}>
      {panels.map((panel) => (
        <button
          className={panel === active ? "is-active" : ""}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${panel}`}
          aria-selected={panel === active}
          aria-controls={`${idPrefix}-panel-${panel}`}
          key={panel}
          onClick={() => onSelect(panel)}
        >
          {labelFor(panel)}
        </button>
      ))}
    </nav>
  );
}

/** The props a panel needs so the tab above it points at something real. */
export function panelRegion(idPrefix: string, panel: StudioPanel) {
  return {
    role: "tabpanel" as const,
    id: `${idPrefix}-panel-${panel}`,
    "aria-labelledby": `${idPrefix}-tab-${panel}`,
  };
}
