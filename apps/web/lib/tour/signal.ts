import { track } from "@vercel/analytics";

/**
 * Where people finish, skip or ask for help (TUTORIAL.md, "Measuring it").
 *
 * The plan said "through the existing pageview signal". That signal is the
 * middleware's server log of public pageviews; a client event cannot reach it
 * without a new route, and a new route is an external-boundary change this work
 * is not allowed to make. So these go through the one client analytics surface
 * the site already loads, Vercel Web Analytics (`<Analytics />` in
 * root-document.tsx), as a single custom event name.
 *
 * What is sent is only which tour, which step and what happened. No prompt text,
 * no question text, no identifier. Every call also fires a window event, which
 * is what the Playwright walk reads.
 */
export const TOUR_SIGNAL_EVENT = "leona:tour-signal";

export type TourSignal = {
  event: "tour_started" | "step_done" | "step_skipped" | "did_it_for_me" | "offline_skip" | "tour_done" | "tour_left" | "step_missed" | "ask_show_me" | "ask_nala";
  tour: string;
  step?: string;
};

export function tourSignal(signal: TourSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourSignal>(TOUR_SIGNAL_EVENT, { detail: signal }));
  try {
    track("guided_tour", { event: signal.event, tour: signal.tour, step: signal.step ?? "" });
  } catch {
    // Analytics must never be the reason a tour step fails.
  }
}
