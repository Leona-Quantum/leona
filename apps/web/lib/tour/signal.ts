/**
 * Where people finish, skip or ask for help (TUTORIAL.md, "Measuring it").
 *
 * Each call fires one window event: which tour, which step and what happened. No
 * prompt text, no question text, no identifier. The Playwright walk reads it.
 *
 * Nothing leaves the browser. These used to go on to Vercel Web Analytics as a custom
 * event, until the owner switched that product off for cost (ai-ops 308); after that
 * its script 404'd on every page and the events reached nobody. Where they should go
 * instead is the owner's call (ai-ops 303), and a listener on this event is where a
 * destination would attach.
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
}
