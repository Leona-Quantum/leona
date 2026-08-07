// How much of the browse list arrives on first paint, and the address of "more".
//
// ## The measurement this exists to fix
//
// `/repository` rendered every matching row in one pass. Measured on production
// (2026-08-07, 1280×720): **22,825px of document, 176 cards, no paging and no
// virtualisation anywhere on the route.** The listing does not even begin until
// 1,287px, so the page was ~21,200px of cards below a screen and a half of
// preface. Nothing was slow and nothing was broken; there was simply no length
// at which the page stopped.
//
// ## Why a cap and a link rather than a pager or a virtual list
//
// A **virtual list** would have kept the scroll and moved the cost, and it only
// exists after hydration — the rows it does not mount are rows no crawler reads
// and no reader without JS ever sees. This route's whole design is that the
// server's HTML is already the answer (`browse-params.ts`), so a client-only
// window would have been the one change that made the real page *worse* than the
// rendered one.
//
// **Numbered pages** would have needed the filter state in the URL to be
// complete before they were correct, and they put a floor under how short the
// first view can be: page 2 of 8 is still a page of chrome.
//
// So: a cap with a real `?rows=` address. The control is an `<a href>` that a
// hydrated click intercepts — the same shape the category strip and the gate
// sidebar already use here — which means the longer list is reachable three
// ways that all agree: clicking it, following the link with JS off, and a
// crawler reading the href.
//
// ## The rule, which is `browse-params.ts`'s rule
//
// **An unrecognised value means the default, never an empty page.** `?rows=0`,
// `?rows=-5`, `?rows=banana` and a `?rows=` left dangling by a link built from
// concatenation all resolve to `DEFAULT_ROW_LIMIT`. A cap is the one param on
// this route where the failure mode of "trust the string" is a page with
// *nothing* on it, which reads as "we have nothing like this" rather than as a
// bad URL.
//
// Explicit `.ts` on every value import for the `node --test` entry point, as
// everywhere else in lib/repository.

/** Rows shown before the reader asks for more. */
export const DEFAULT_ROW_LIMIT = 24;

/**
 * The cap doubles on each "show more" rather than adding a fixed step.
 *
 * A fixed step of 24 needs **seven** presses to get from 24 rows to 176, which
 * is worse than the scroll it replaced: the reader who wants the whole list
 * pays for the cap. Doubling gets there in three (24 → 48 → 96 → all), and it
 * matches what repeated presses mean — the first is "a bit more", the fourth is
 * "just show me everything".
 *
 * The "show everything" link is offered alongside every "show more" for the
 * reader who knew that from the start, so nobody has to walk the chain at all.
 */
export const ROW_LIMIT_GROWTH = 2;

/**
 * The largest cap a URL may name.
 *
 * The corpus folds to 176 rows, so this is not a performance bound — it is a
 * bound on what an arbitrary string may talk this route into allocating. A
 * limit above the list length is harmless and already handled by `capRows`
 * (it caps at the list), so clamping here costs a reader nothing real.
 */
export const MAX_ROW_LIMIT = 1000;

/** A resolved cap: a positive row count, or every row. */
export type RowLimit = number | "all";

/**
 * `?rows=` → a cap.
 *
 * `all` is spelled, not encoded as a large number, so the "everything" URL is
 * legible in a shared link and does not go stale when the corpus grows past
 * whatever number somebody happened to paste.
 */
export function resolveRowLimit(raw: string | undefined): RowLimit {
  if (raw === undefined) return DEFAULT_ROW_LIMIT;
  const value = raw.trim();
  if (value === "all") return "all";
  // `Number("")` is 0 and `Number(" 12 ")` is 12, so the empty case has to be
  // rejected before the numeric one or a dangling `?rows=` becomes a cap of
  // zero — an empty list under a control that says "show more".
  if (!/^\d+$/.test(value)) return DEFAULT_ROW_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return DEFAULT_ROW_LIMIT;
  return Math.min(parsed, MAX_ROW_LIMIT);
}

export interface CappedRows<T> {
  /** The rows to render. */
  shown: T[];
  /** How many matched rows are held back. 0 when everything is shown. */
  hidden: number;
  /**
   * The cap the "show more" control should link to, or `null` when there is
   * nothing more to show.
   *
   * Returned rather than computed at the call site because the last step is the
   * interesting one: a step that lands within a row or two of the end leaves a
   * "show more" that reveals two cards and then has to be clicked again, so the
   * final step absorbs the remainder instead.
   */
  next: RowLimit | null;
}

/**
 * Cap a row list, and say what the control above it should offer.
 *
 * Pure and generic over the row type on purpose: the browse list folds width
 * families into rows before this runs, and a cap that knew what a row *was*
 * would be a second place that had to agree with `foldRows`. It counts rows —
 * the same things the reader counts on the page — and nothing else.
 */
/**
 * Split a capped sequence back into the two sections that render it.
 *
 * The browse page draws the ranked list and then the held-out tail, and the cap
 * governs both as one sequence — a cap that stops at the first section leaves
 * the second rendering in full underneath a control that says everything is
 * shown. So the two are concatenated, cut once, and split back **by position**.
 *
 * By position, and never by capping each section against its own budget: two
 * caps are two places that have to agree on how much is left, and the number
 * the control prints comes from only one of them.
 */
export function splitCapped<T>(
  shown: readonly T[],
  firstSectionLength: number,
): { first: T[]; second: T[] } {
  // `min` because the cut may land inside the first section, in which case the
  // second gets nothing rather than a negative slice — `slice(-3)` would
  // silently return the last three rows of the first section.
  const take = Math.max(0, Math.min(firstSectionLength, shown.length));
  return { first: shown.slice(0, take), second: shown.slice(take) };
}

export function capRows<T>(rows: readonly T[], limit: RowLimit): CappedRows<T> {
  if (limit === "all" || rows.length <= limit) {
    return { shown: [...rows], hidden: 0, next: null };
  }
  const shown = rows.slice(0, limit);
  const hidden = rows.length - shown.length;
  // Absorb the remainder rather than leaving a step that reveals a handful and
  // asks again. `<=` so a doubling that lands exactly on the end still resolves
  // to "all", which is the shorter URL and the honest label.
  const next: RowLimit = hidden <= limit * (ROW_LIMIT_GROWTH - 1) ? "all" : limit * ROW_LIMIT_GROWTH;
  return { shown, hidden, next };
}
