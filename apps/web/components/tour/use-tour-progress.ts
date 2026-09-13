"use client";

import { useCallback, useEffect, useState } from "react";
import { TOUR_STORAGE_KEY, readProgress, writeProgress } from "../../lib/tour/engine.ts";
import { TOUR_PROGRESS_EVENT } from "../../lib/tour/events.ts";
import { tourById } from "../../lib/tour/tracks.ts";
import type { TourProgress } from "../../lib/tour/types.ts";

function deviceStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTourProgress(): TourProgress {
  return readProgress(deviceStorage(), tourById);
}

export function saveTourProgress(progress: TourProgress): void {
  writeProgress(deviceStorage(), progress);
  window.dispatchEvent(new CustomEvent(TOUR_PROGRESS_EVENT));
}

/**
 * Progress as React state. `null` until mounted: the server has no idea what this
 * browser stored, and rendering a guess would be a hydration mismatch.
 */
export function useTourProgress(): [TourProgress | null, (change: (current: TourProgress) => TourProgress) => TourProgress] {
  const [progress, setProgress] = useState<TourProgress | null>(null);

  useEffect(() => {
    const refresh = () => setProgress(loadTourProgress());
    refresh();
    const onStorage = (event: StorageEvent) => {
      if (event.key === TOUR_STORAGE_KEY) refresh();
    };
    window.addEventListener(TOUR_PROGRESS_EVENT, refresh);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(TOUR_PROGRESS_EVENT, refresh);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Always from storage, never from the render's copy: two changes in one tick
  // (a step finishes and the next one skips offline) must compose, not race.
  const update = useCallback((change: (current: TourProgress) => TourProgress) => {
    const next = change(loadTourProgress());
    saveTourProgress(next);
    setProgress(next);
    return next;
  }, []);

  return [progress, update];
}
