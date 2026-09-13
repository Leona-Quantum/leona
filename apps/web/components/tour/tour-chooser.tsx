"use client";

import { useEffect, useRef } from "react";
import { tourStatus } from "../../lib/tour/engine.ts";
import { TOUR_SHOWS, TOUR_TRACKS } from "../../lib/tour/tracks.ts";
import type { TourId, TourProgress, TourShowId, TourTrackId } from "../../lib/tour/types.ts";
import type { ToursCopy } from "../../lib/workspace-locale";

/** The five tracks with their state and one or two buttons. Shared by the chooser and Settings. */
export function TourTrackList({ copy, progress, onStart }: { copy: ToursCopy; progress: TourProgress | null; onStart: (tour: TourId, fromStart: boolean) => void }) {
  return (
    <ul className="mj-tour-track-list">
      {TOUR_TRACKS.map((tour) => {
        const words = copy.tracks[tour.id as TourTrackId];
        const status = progress ? tourStatus(progress, tour) : { state: "new" as const, step: 0, total: tour.steps.length };
        return (
          <li className="mj-tour-track" key={tour.id}>
            <div>
              <strong>{words.title}</strong>
              <span className="mj-tour-track-meta">
                <span>{copy.chooser.minutes(tour.minutes)}</span>
                {status.state === "done" ? <span data-done="true">✓ {copy.chooser.done}</span> : null}
                {status.state === "in-progress" ? <span>{copy.chooser.progress(status.step + 1, status.total)}</span> : null}
              </span>
              <p>{words.forWhom}</p>
              <small>{words.keeps}</small>
            </div>
            <div className="mj-tour-track-actions">
              {status.state === "in-progress" ? (
                <>
                  <button type="button" className="mj-tour-button" data-primary="true" onClick={() => onStart(tour.id, false)}>{copy.chooser.resume}</button>
                  <button type="button" className="mj-tour-button" onClick={() => onStart(tour.id, true)}>{copy.chooser.restart}</button>
                </>
              ) : (
                <button type="button" className="mj-tour-button" data-primary={status.state === "new" ? "true" : undefined} onClick={() => onStart(tour.id, status.state === "done")}>
                  {status.state === "done" ? copy.chooser.restart : copy.chooser.start}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TourShowList({ copy, onStart }: { copy: ToursCopy; onStart: (tour: TourId) => void }) {
  return (
    <ul className="mj-tour-show-list">
      {TOUR_SHOWS.map((tour) => (
        <li key={tour.id}>
          <button type="button" className="mj-tour-button" onClick={() => onStart(tour.id)}>{copy.shows[tour.id as TourShowId]}</button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The full chooser, behind the header `?`. A dialog in the proper sense: focus
 * moves in, Tab stays in, Escape closes, and focus goes back to what opened it.
 */
export function TourChooser({ copy, progress, onStart, onClose }: { copy: ToursCopy; progress: TourProgress | null; onStart: (tour: TourId, fromStart: boolean) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const stops = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"));
      if (!stops.length) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const inside = dialog.contains(document.activeElement) && document.activeElement !== dialog;
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="mj-tour-chooser-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="mj-tour-chooser" role="dialog" aria-modal="true" aria-labelledby="mj-tour-chooser-title" tabIndex={-1} ref={dialogRef}>
        <header>
          <div>
            <h2 id="mj-tour-chooser-title">{copy.chooser.title}</h2>
            <p className="mj-tour-chooser-lede">{copy.chooser.lede}</p>
          </div>
          <button type="button" className="mj-tour-button" onClick={onClose}>{copy.chooser.close}</button>
        </header>
        <h3>{copy.chooser.tracks}</h3>
        <TourTrackList copy={copy} progress={progress} onStart={onStart} />
        <h3>{copy.chooser.showMe}</h3>
        <p className="mj-tour-chooser-lede">{copy.chooser.showMeLede}</p>
        <TourShowList copy={copy} onStart={(tour) => onStart(tour, true)} />
      </div>
    </div>
  );
}
