"use client";

import "./tour.css";
import type { PublicLocale } from "../../lib/public-locale";
import { sendTourCommand } from "../../lib/tour/events.ts";
import { TOURS_COPY } from "../../lib/workspace-locale";

/** The header `?`: opens the Guided tours chooser. */
export function TourHelpButton({ locale = "en" }: { locale?: PublicLocale }) {
  const label = TOURS_COPY[locale].helpButton;
  return (
    <button
      type="button"
      className="mj-tour-help"
      data-tour="tour-help"
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      onClick={() => sendTourCommand({ action: "open-chooser" })}
    >
      ?
    </button>
  );
}
