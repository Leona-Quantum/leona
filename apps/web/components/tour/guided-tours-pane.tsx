"use client";

import "./tour.css";
import { useState } from "react";
import type { PublicLocale } from "../../lib/public-locale";
import { sendTourCommand } from "../../lib/tour/events.ts";
import { TOURS_COPY } from "../../lib/workspace-locale";
import { TourShowList, TourTrackList } from "./tour-chooser";
import { useTourProgress } from "./use-tour-progress";

/**
 * Settings → Guided tours: every track with its state, Resume or Start again,
 * the Show-me list, and a way to bring the first-visit prompt back.
 *
 * Progress is per browser (`majorana.tour.v1`). Carrying it across devices would
 * need a field on the account profile, which is an API change this work does not
 * make; the pane says where progress lives instead of implying it follows you.
 */
export function GuidedToursPane({ locale = "en" }: { locale?: PublicLocale }) {
  const copy = TOURS_COPY[locale];
  const [progress] = useTourProgress();
  const [invited, setInvited] = useState(false);

  return (
    <section className="mj-artifact-panel mj-tour-settings" aria-labelledby="mj-tour-settings-title">
      <div className="mj-panel-heading"><h2 id="mj-tour-settings-title">{copy.settings.label}</h2></div>
      <p className="mj-tour-chooser-lede">{copy.settings.lede}</p>
      <TourTrackList copy={copy} progress={progress} onStart={(tour, fromStart) => sendTourCommand({ action: "start", tour, fromStart })} />
      <h3 className="mj-section-label">{copy.settings.showMe}</h3>
      <TourShowList copy={copy} onStart={(tour) => sendTourCommand({ action: "start", tour, fromStart: true })} />
      <p className="mj-tour-settings-note">
        {copy.settings.perDevice}{" "}
        <button
          type="button"
          className="mj-tour-link"
          onClick={() => {
            sendTourCommand({ action: "invite-again" });
            setInvited(true);
          }}
        >
          {copy.settings.inviteAgain}
        </button>
        {invited ? <span role="status"> {copy.settings.inviteAgainDone}</span> : null}
      </p>
    </section>
  );
}
