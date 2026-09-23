/**
 * Where people finish, skip or ask for help (TUTORIAL.md, "Measuring it").
 *
 * Each call fires one window event: which tour, which step and what happened — the
 * Playwright walk reads it, and it carries no prompt text, no question text and no
 * identifier — AND, since ai-ops 326, sends the same three fields to our own API,
 * where `services/api/src/majorana_api/routes/tour_signals.py` stores nothing but a
 * count keyed by (UTC day, track, step, kind).
 *
 * These used to go on to Vercel Web Analytics as a custom event, until the owner
 * switched that product off for cost (ai-ops 308); after that its script 404'd on
 * every page and the events reached nobody. ai-ops 324 deferred picking a new
 * destination until the website's move to Google Cloud landed; ai-ops 326 is that
 * destination, his stated preference on 324 (option 1): "our own API, on a small
 * endpoint that stores the counts."
 */
import { CONTROL_PLANE_URL } from "../control-plane.ts";

export const TOUR_SIGNAL_EVENT = "leona:tour-signal";

/**
 * The ten kinds a signal may report. Mirrors
 * `services/api/src/majorana_api/tour_signal_vocabulary.py`'s `TOUR_SIGNAL_KINDS`
 * and migration 0071's CHECK constraint — all three are meant to list the same ten
 * strings, and `signal-vocabulary.test.ts` is the drift test that catches the three
 * disagreeing. An array (not only a union type) so it exists at runtime for that
 * test to import, the same pattern `TOUR_TRACK_IDS` already uses in `types.ts`.
 */
export const TOUR_SIGNAL_KINDS = [
  "tour_started",
  "step_done",
  "step_skipped",
  "did_it_for_me",
  "offline_skip",
  "tour_done",
  "tour_left",
  "step_missed",
  "ask_show_me",
  "ask_nala",
] as const;
export type TourSignalKind = (typeof TOUR_SIGNAL_KINDS)[number];

export type TourSignal = {
  event: TourSignalKind;
  tour: string;
  step?: string;
};

/**
 * Sent as `step` for a track-level signal — `tour_started`, `tour_done`,
 * `ask_nala`, `ask_show_me` — none of which name a specific step at their call
 * sites in `tour-runtime.tsx`/`tour-card.tsx`. Mirrors
 * `services/api/src/majorana_api/tour_signal_vocabulary.py`'s `NO_STEP`; see
 * that constant's docstring for why a sentinel rather than an omitted field —
 * the API's `step` column is `NOT NULL` and part of the table's primary key.
 */
export const TOUR_SIGNAL_NO_STEP = "_track";

/**
 * Where the network half of a signal goes. Reuses `control-plane.ts`'s
 * `CONTROL_PLANE_URL` (`NEXT_PUBLIC_API_URL`, inlined at build time) rather than a
 * second reading of the same env var — that module is "not `server-only`... checked
 * rather than assumed" per its own docstring, so importing just this one constant
 * into a genuinely client-side module is exactly the case it was written to allow.
 */
const TOUR_SIGNAL_ENDPOINT = `${CONTROL_PLANE_URL}/v1/tour-signals`;

/**
 * Best-effort, fire-and-forget delivery of one signal over the network.
 *
 * ## Must never throw, block navigation, or log to console in production
 *
 * Every path here is wrapped so a browser that lacks `sendBeacon`, a network
 * failure, a CORS misconfiguration, or the API being down cannot surface as a
 * console error or an unhandled rejection — a telemetry signal must never be the
 * reason a page felt broken. `sendBeacon` itself already suits the "fires during
 * page unload" case `tour_left`/`tour_done` are; `fetch(..., { keepalive: true })`
 * is the fallback for a browser or a test environment (`node --test`, no DOM) where
 * `navigator.sendBeacon` does not exist.
 *
 * ## `text/plain`, not `application/json` — no CORS preflight
 *
 * The body is sent as a plain string. `sendBeacon` cannot set headers at all — a
 * `Blob` with an explicit MIME type is the only way to influence its Content-Type,
 * and `fetch` defaults a plain string body to `text/plain;charset=UTF-8` the same
 * way. `text/plain` is one of the three CORS "simple request" content types, so
 * neither call triggers a preflight `OPTIONS` round trip — worth avoiding in
 * general, and specifically for `sendBeacon`, which fires during unload with no
 * chance to wait one out. The route parses the raw body as JSON regardless of the
 * Content-Type header it arrives with, so this costs nothing server-side.
 *
 * ## Do Not Track / Global Privacy Control
 *
 * Checked here because nothing else in this app already does — there is no shared
 * `doNotTrack()` helper to reuse (searched: no match for DNT/GPC anywhere in
 * `apps/web`). `navigator.doNotTrack === "1"` and `navigator.globalPrivacyControl
 * === true` both skip the network send; the local `window.dispatchEvent` above is
 * unaffected, since nothing about it leaves the browser.
 */
function sendTourSignalBeacon(signal: TourSignal): void {
  try {
    if (typeof navigator === "undefined") return;
    if (navigator.doNotTrack === "1") return;
    if ((navigator as { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return;

    const body = JSON.stringify({
      track: signal.tour,
      step: signal.step ?? TOUR_SIGNAL_NO_STEP,
      kind: signal.event,
    });

    if (typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon(TOUR_SIGNAL_ENDPOINT, body);
      return;
    }
    if (typeof fetch === "function") {
      fetch(TOUR_SIGNAL_ENDPOINT, { method: "POST", body, keepalive: true }).catch(() => {});
    }
  } catch {
    // A signal must never be the reason a page throws.
  }
}

export function tourSignal(signal: TourSignal): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TourSignal>(TOUR_SIGNAL_EVENT, { detail: signal }));
  sendTourSignalBeacon(signal);
}
