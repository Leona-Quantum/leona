/**
 * What a waiting user is told while their run sits in the queue (ai-ops#91).
 *
 * ## Why anything is shown at all
 *
 * `majorana-worker` runs one instance and its loop claims ONE job at a time
 * (`repos/system.py::claim_job`, `LIMIT 1 … FOR UPDATE SKIP LOCKED`), awaits the
 * whole handler, then loops. So runs are processed strictly serially: the
 * twentieth simultaneous run waits behind nineteen. `POST /v1/runs` returns 201
 * immediately and the status reads `queued` until that turn arrives, which on
 * screen is indistinguishable from a hung app.
 *
 * ## Why it is a position and never a time
 *
 * A count is a fact the queue can be asked for. A duration is not: the
 * wall-clock time of a successful run has never been measured against the real
 * pipeline, so any ETA would be derived from a number nobody has. A wrong
 * estimate is worse than none, because a user plans around it — they close the
 * tab, or they sit through a "2 minutes" that turns out to be twelve. If an ETA
 * is ever wanted, it needs a capacity profile of the real pipeline first, and
 * then it belongs beside this rather than instead of it.
 *
 * Its own module, with no imports beyond the locale type, so the bare
 * `node --test` runner can load it — `live-run.tsx` is a client component full
 * of fetch and stream side effects and has no test of its own, so the decision
 * lives here where it can have one.
 */
import type { PublicLocale } from "./public-locale";

/**
 * The line to show, or `null` for "say nothing".
 *
 * `null` in, `null` out is the load-bearing case. The API sends
 * `queue_position: null` for a run that is not waiting — started, finished, or
 * never queued — and the client also passes `null` when it has lost the ability
 * to refresh (see `live-run.tsx`). Both mean the same thing here: we have no
 * position we are willing to stand behind, so the caller falls back to the
 * plain waiting state rather than showing a number that may be stale.
 */
export function queuePositionLabel(
  position: number | null | undefined,
  locale: PublicLocale,
): string | null {
  if (position === null || position === undefined) return null;
  if (!Number.isInteger(position) || position < 0) return null;
  if (position === 0) return locale === "ja" ? "次に実行されます" : "Next in the queue";
  if (locale === "ja") return `他${position}件の実行を待っています`;
  return position === 1 ? "1 run ahead of yours" : `${position} runs ahead of yours`;
}

/** Statuses that can still be waiting for a worker. Anything else stops the poll. */
const WAITING_STATUSES = new Set(["queued"]);

/**
 * Whether to keep asking for a position.
 *
 * Keyed on the run's own status rather than on the presence of a number,
 * because 0 is a position — "next in the queue" — and a falsy check would stop
 * polling exactly one step before the run starts.
 */
export function isWaitingForWorker(status: string | null | undefined): boolean {
  return typeof status === "string" && WAITING_STATUSES.has(status);
}

/**
 * How often to re-ask, in milliseconds.
 *
 * The queue drains at one job per run, and a run is bounded at 600s, so the
 * number changes on the order of minutes rather than seconds. Five seconds is
 * fast enough that the count never looks frozen and slow enough that a page
 * left open overnight is not a load source: it is one indexed lookup per poll,
 * and only while the run is queued.
 */
export const QUEUE_POLL_INTERVAL_MS = 5_000;
