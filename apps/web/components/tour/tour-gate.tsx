"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import type { PublicLocale } from "../../lib/public-locale";
import { TOUR_COMMAND_EVENT, type TourCommand } from "../../lib/tour/events.ts";
import { loadTourProgress } from "./use-tour-progress";

const TourRuntime = dynamic(() => import("./tour-runtime").then((module) => module.TourRuntime), { ssr: false });

/**
 * Loads the tour only when something needs it: a tour in progress, a
 * `#tour=` link, the first-visit invite, or a command from the `?` button or
 * Settings. Everyone else — and every Atlas reader who never started a tour —
 * pays for a localStorage read and nothing more.
 *
 * A command that arrives before the runtime has loaded is kept and handed to it,
 * so pressing `?` the first time still opens the chooser.
 */
export function TourGate({ locale, surface }: { locale?: PublicLocale; surface: "workspace" | "atlas" }) {
  const [needed, setNeeded] = useState(false);
  const [initialCommand, setInitialCommand] = useState<TourCommand | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    const check = () => {
      const progress = loadTourProgress();
      const wanted = /^#tour=/.test(window.location.hash)
        || Boolean(progress.active)
        || (surface === "workspace" && progress.invite === "pending");
      if (wanted) setNeeded(true);
    };
    const onCommand = (event: Event) => {
      if (loaded.current) return;
      loaded.current = true;
      setInitialCommand((event as CustomEvent<TourCommand>).detail);
      setNeeded(true);
    };
    check();
    window.addEventListener("hashchange", check);
    window.addEventListener(TOUR_COMMAND_EVENT, onCommand);
    return () => {
      window.removeEventListener("hashchange", check);
      window.removeEventListener(TOUR_COMMAND_EVENT, onCommand);
    };
  }, [surface]);

  useEffect(() => {
    if (needed) loaded.current = true;
  }, [needed]);

  return needed ? <TourRuntime locale={locale} surface={surface} initialCommand={initialCommand} /> : null;
}
