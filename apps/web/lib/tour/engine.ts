import type { TourActive, TourId, TourProgress, TourStep, TourTrack } from "./types.ts";

/**
 * The tour engine's pure half: progress, the URL hash, route and value matching,
 * what a click means, and where to go next. No DOM and no React, so the rules the
 * overlay acts on are the rules `engine.test.ts` checks.
 */

// Device-level on purpose (DEVICE_STORAGE_KEYS in lib/user-storage.ts): tour
// progress is read on the Atlas too, which has no account scope, and it holds
// nothing but track and step ids.
export const TOUR_STORAGE_KEY = "majorana.tour.v1"; // gitleaks:allow

/** Reader went quiet on a step that is waiting for an action. */
export const IDLE_NUDGE_MS = 20_000;

/** Misses before the card offers "Do it for me". */
export const MISSES_BEFORE_HELP = 2;

type ReadableStorage = { getItem(key: string): string | null };
type WritableStorage = { setItem(key: string, value: string): void };

export function emptyProgress(): TourProgress {
  return { version: 1, active: null, completed: [], furthest: {}, invite: "pending" };
}

/**
 * Parse what is stored, keeping only what still means something. A track that
 * was renamed or removed drops out rather than resuming a tour that no longer
 * exists; a step index past the end is clamped rather than trusted.
 */
export function parseProgress(raw: string | null, tours: (id: string) => TourTrack | null): TourProgress {
  const progress = emptyProgress();
  if (!raw) return progress;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return progress;
  }
  if (!value || typeof value !== "object") return progress;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return progress;

  if (Array.isArray(record.completed)) {
    progress.completed = record.completed.filter((id): id is TourId => typeof id === "string" && tours(id) !== null);
  }
  if (record.furthest && typeof record.furthest === "object") {
    for (const [id, index] of Object.entries(record.furthest as Record<string, unknown>)) {
      const tour = tours(id);
      if (tour && typeof index === "number" && Number.isInteger(index) && index >= 0) {
        progress.furthest[tour.id] = Math.min(index, tour.steps.length - 1);
      }
    }
  }
  if (record.invite === "dismissed" || record.invite === "started") progress.invite = record.invite;
  progress.active = parseActive(record.active, tours);
  return progress;
}

function parseActive(value: unknown, tours: (id: string) => TourTrack | null): TourActive | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.track !== "string") return null;
  const tour = tours(record.track);
  if (!tour) return null;
  const step = typeof record.step === "number" && Number.isInteger(record.step) ? record.step : 0;
  let resume: TourActive["resume"] = null;
  if (record.resume && typeof record.resume === "object") {
    const back = record.resume as Record<string, unknown>;
    const backTour = typeof back.track === "string" ? tours(back.track) : null;
    if (backTour && typeof back.step === "number" && Number.isInteger(back.step)) {
      resume = { track: backTour.id, step: clampStep(backTour, back.step) };
    }
  }
  return { track: tour.id, step: clampStep(tour, step), paused: record.paused === true, resume };
}

function clampStep(tour: TourTrack, step: number): number {
  return Math.max(0, Math.min(step, tour.steps.length - 1));
}

export function readProgress(storage: ReadableStorage | null, tours: (id: string) => TourTrack | null): TourProgress {
  if (!storage) return emptyProgress();
  try {
    return parseProgress(storage.getItem(TOUR_STORAGE_KEY), tours);
  } catch {
    return emptyProgress();
  }
}

export function writeProgress(storage: WritableStorage | null, progress: TourProgress): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TOUR_STORAGE_KEY, JSON.stringify(progress));
    return true;
  } catch {
    return false;
  }
}

/** `#tour=build.4` → build, index 3. The hash is one-based because people read it. */
export function parseTourHash(hash: string, tours: (id: string) => TourTrack | null): { track: TourId; step: number } | null {
  const match = /^#?tour=([a-z0-9-]+)\.(\d{1,3})$/.exec(hash.trim());
  if (!match) return null;
  const tour = tours(match[1]!);
  if (!tour) return null;
  const oneBased = Number(match[2]);
  if (oneBased < 1 || oneBased > tour.steps.length) return null;
  return { track: tour.id, step: oneBased - 1 };
}

export function formatTourHash(track: TourId, step: number): string {
  return `#tour=${track}.${step + 1}`;
}

/**
 * The tour may own the fragment only when nobody else does. `/account#usage`
 * selects a Settings pane and the Atlas writes its own; replacing either would
 * break a deep link to keep a bookmark of the tour, which is the worse trade.
 */
export function mayWriteTourHash(currentHash: string): boolean {
  return currentHash === "" || currentHash === "#" || /^#tour=/.test(currentHash);
}

const WORKSPACE_PREFIXES = ["/run", "/studio", "/qapps", "/notebooks", "/library", "/account", "/shared", "/upgrade"];

function normalisePath(pathname: string): string {
  const bare = pathname.split(/[?#]/)[0] ?? "/";
  const unlocalised = bare.replace(/^\/(en|ja)(?=\/|$)/, "");
  const trimmed = unlocalised.length > 1 ? unlocalised.replace(/\/+$/, "") : unlocalised;
  return trimmed || "/";
}

/**
 * Route patterns, `|`-separated alternatives:
 *
 * - `/studio` matches exactly `/studio` (query and hash ignored).
 * - `/run/*` matches `/run/<anything>` but not `/run` itself.
 * - `/repository*` matches `/repository` and everything under it.
 * - `@workspace` matches any signed-in workspace route.
 *
 * A locale prefix (`/ja/repository`) is ignored, because the Atlas serves both.
 */
export function routeMatches(pattern: string, pathname: string): boolean {
  const path = normalisePath(pathname);
  return pattern.split("|").some((raw) => {
    const alternative = raw.trim();
    if (!alternative) return false;
    if (alternative === "@workspace") {
      return WORKSPACE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
    }
    if (alternative.endsWith("/*")) {
      const base = alternative.slice(0, -2);
      return path.startsWith(`${base}/`) && path.length > base.length + 1;
    }
    if (alternative.endsWith("*")) {
      const base = alternative.slice(0, -1);
      return path === base || path.startsWith(`${base}/`);
    }
    return path === alternative;
  });
}

export function valueMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern, "u").test(value);
  } catch {
    return false;
  }
}

/**
 * What a click means for the step on screen.
 *
 * - on the target: finishes a `click` step; for anything else the step's own
 *   listener decides (a link finishes a `route` step by navigating).
 * - on the dimmed page: a miss, but only when the step is waiting for an action.
 *   A reading step has nothing to get wrong.
 * - on the tour's own card or chooser: nothing.
 */
export function clickOutcome(step: TourStep, where: "target" | "scrim" | "tour"): "match" | "miss" | "ignore" {
  if (where === "tour") return "ignore";
  if (where === "target") return step.expect?.kind === "click" ? "match" : "ignore";
  return step.expect && step.expect.kind !== "wait" ? "miss" : "ignore";
}

/**
 * The correction for a miss, most specific first: the step's own line when the
 * reader hit the control it is usually confused with; otherwise the name of what
 * they did hit; otherwise a plain "not that one". The step's `wrong` line is
 * never used for some other control, where it would be untrue.
 */
export function correctionFor(
  step: TourStep,
  clicked: string | null,
  words: { wrong?: string; targets: Record<string, string>; notQuite: (thing: string) => string; generic: string },
): string {
  if (clicked && step.wrongTarget && clicked === step.wrongTarget && words.wrong) return words.wrong;
  if (clicked && clicked !== step.target && words.targets[clicked]) return words.notQuite(words.targets[clicked]!);
  return words.generic;
}

export function offersHelp(misses: number, nudged: boolean): boolean {
  return misses >= MISSES_BEFORE_HELP || nudged;
}

/**
 * The next step that can run. Offline, steps that need the API are passed over,
 * and the caller is told how many so the card can say so instead of pretending.
 */
export function nextRunnableStep(tour: TourTrack, from: number, online: boolean): { index: number; skipped: number } {
  let skipped = 0;
  for (let index = from + 1; index < tour.steps.length; index += 1) {
    if (!online && tour.steps[index]!.needs === "api") {
      skipped += 1;
      continue;
    }
    return { index, skipped };
  }
  return { index: -1, skipped };
}

/** Whitespace-insensitive, so a trailing newline is not "your own prompt". */
export function classifyPrompt(value: string, suggested: readonly string[]): "empty" | "suggested" | "own" {
  const normal = (text: string) => text.replace(/\s+/g, " ").trim().toLocaleLowerCase();
  const typed = normal(value);
  if (!typed) return "empty";
  return suggested.some((candidate) => candidate && normal(candidate) === typed) ? "suggested" : "own";
}

export function startTour(progress: TourProgress, tour: TourTrack, options: { step?: number; returnTo?: TourActive | null } = {}): TourProgress {
  const step = clampStep(tour, options.step ?? 0);
  const returnTo = options.returnTo && tour.kind === "show" && options.returnTo.track !== tour.id
    ? { track: options.returnTo.track, step: options.returnTo.step }
    : null;
  return {
    ...progress,
    invite: progress.invite === "pending" ? "started" : progress.invite,
    active: { track: tour.id, step, paused: false, resume: returnTo },
    furthest: { ...progress.furthest, [tour.id]: Math.max(progress.furthest[tour.id] ?? 0, step) },
  };
}

export function moveTo(progress: TourProgress, tour: TourTrack, step: number): TourProgress {
  if (!progress.active || progress.active.track !== tour.id) return progress;
  const index = clampStep(tour, step);
  return {
    ...progress,
    active: { ...progress.active, step: index, paused: false },
    furthest: { ...progress.furthest, [tour.id]: Math.max(progress.furthest[tour.id] ?? 0, index) },
  };
}

/** Finishing a Show-me started from a track goes back to that track's step. */
export function finishTour(progress: TourProgress, tour: TourTrack): TourProgress {
  const completed = progress.completed.includes(tour.id) ? progress.completed : [...progress.completed, tour.id];
  const resume = progress.active?.track === tour.id ? progress.active.resume : null;
  return {
    ...progress,
    completed,
    active: resume ? { track: resume.track, step: resume.step, paused: false, resume: null } : null,
  };
}

export function leaveTour(progress: TourProgress): TourProgress {
  return { ...progress, active: null };
}

export function setPaused(progress: TourProgress, paused: boolean): TourProgress {
  return progress.active ? { ...progress, active: { ...progress.active, paused } } : progress;
}

/** Restart clears the check mark as well as the position: "again from the top". */
export function restartTour(progress: TourProgress, tour: TourTrack): TourProgress {
  const cleared = { ...progress, completed: progress.completed.filter((id) => id !== tour.id), furthest: { ...progress.furthest, [tour.id]: 0 } };
  return startTour(cleared, tour);
}

export type TourStatusSummary = { state: "done" | "in-progress" | "new"; step: number; total: number };

export function tourStatus(progress: TourProgress, tour: TourTrack): TourStatusSummary {
  const total = tour.steps.length;
  if (progress.active?.track === tour.id) return { state: "in-progress", step: progress.active.step, total };
  if (progress.completed.includes(tour.id)) return { state: "done", step: total - 1, total };
  const furthest = progress.furthest[tour.id];
  return furthest && furthest > 0 ? { state: "in-progress", step: furthest, total } : { state: "new", step: 0, total };
}
