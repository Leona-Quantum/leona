/**
 * Guided tours: the data model (TUTORIAL.md, "How it works").
 *
 * A track is data, not JSX. Every step points at a `data-tour="…"` attribute on
 * a real control — never a CSS path — so a refactor that removes the control
 * fails `lib/tour/targets.test.ts` instead of silently breaking a tour.
 *
 * One deliberate difference from the plan's sketch: the step's words do not sit
 * inside the step. Every reader-facing string lives in `lib/workspace-locale.ts`
 * (`TOURS_COPY`, English and Japanese side by side), keyed `track.step`, so the
 * copy pass and the JA pass happen in one file. `targets.test.ts` asserts every
 * step has both languages.
 */

export type TourPlacement = "top" | "right" | "bottom" | "left";

/**
 * What finishes a step. Deterministic on purpose: the engine never guesses.
 *
 * - `click`: the step's target (or the named target) was clicked.
 * - `value`: a field inside the target holds a value matching `match` (a RegExp source).
 * - `route`: the pathname matches `match` (see `routeMatches`).
 * - `wait`: a `data-tour="match"` element has appeared on the page.
 */
export type TourExpect =
  | { kind: "click"; match: string }
  | { kind: "value"; match: string }
  | { kind: "route"; match: string }
  | { kind: "wait"; match: string };

export type TourStep = {
  id: string;
  /** A `data-tour` name. Absent means a centred card with nothing to point at. */
  target?: string;
  placement: TourPlacement;
  /** Where the step lives, as a route pattern. Defaults to the track's `on`. */
  on?: string;
  /** Where "Take me there" goes when the reader is somewhere else. Defaults to the track's `go`. */
  go?: string;
  expect?: TourExpect;
  /** The control people confuse with this one; clicking it gets the step's own `wrong` line. */
  wrongTarget?: string;
  /** Nala's reaction on the Run page when this step succeeds (the tilt on a miss is automatic). */
  nala?: { corner: "tl" | "tr" | "bl" | "br"; reaction: "flick" | "nod" | "none" };
  /** The step needs the workspace online; offline it says so and skips, never fakes. */
  needs?: "api";
  /** A non-localised value "Do it for me" sets (a `<select>` option). Localised text lives in the copy's `fill`. */
  fill?: string;
  /** Read the composer when this step completes and compare later, to notice a reader's own prompt. */
  remembersPrompt?: boolean;
  /** Compare the composer against the remembered or suggested prompt before this step finishes. */
  checksPrompt?: boolean;
  /** Borrow another step's copy (`track.step`), so a Show-me can reuse a track's words. */
  copyKey?: string;
};

export const TOUR_TRACK_IDS = ["around", "first-light", "build", "teach", "read"] as const;
export type TourTrackId = (typeof TOUR_TRACK_IDS)[number];

export const TOUR_SHOW_IDS = [
  "show-cirq",
  "show-visual",
  "show-simulate",
  "show-export",
  "show-mode",
  "show-framework",
  "show-attach",
  "show-usage",
  "show-theme",
  "show-lesson",
  "show-qapp",
  "show-atlas",
] as const;
export type TourShowId = (typeof TOUR_SHOW_IDS)[number];

export type TourId = TourTrackId | TourShowId;

export type TourTrack = {
  id: TourId;
  kind: "track" | "show";
  /** Rough minutes, shown in the chooser. */
  minutes: number;
  /** Default route pattern for steps. */
  on: string;
  /** Default URL to open the track at. */
  go: string;
  steps: readonly TourStep[];
};

/** Saved per device in `majorana.tour.v1`. */
export type TourActive = {
  track: TourId;
  /** Zero-based. The URL hash shows it one-based: `#tour=build.4` is index 3. */
  step: number;
  paused: boolean;
  /** A Show-me started from inside a track returns to it when it ends. */
  resume: { track: TourId; step: number } | null;
};

export type TourProgress = {
  version: 1;
  active: TourActive | null;
  completed: TourId[];
  /** Furthest step index reached per tour, for "Resume · step 5 of 12". */
  furthest: Partial<Record<TourId, number>>;
  /** The first-visit corner prompt: not yet answered, dismissed, or taken up. */
  invite: "pending" | "dismissed" | "started";
};
