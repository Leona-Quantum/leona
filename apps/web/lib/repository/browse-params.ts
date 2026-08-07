// `/repository?topic=…&fits=…&category=…&gate=…` — resolved on the server.
//
// ## Why these live in one function
//
// They were three inline ternaries in the page component, written one per
// session, each with the same comment explaining the same rule. The fourth
// (`?category=`) was added for roadmap §0.5.1 and was the one that had been
// *missed* for two sessions: the gates section had a whole reading surface — a
// sidebar and a detail pane rather than a card grid — reachable only by an
// onClick, so it had no URL, no bookmark, no share, no crawler and nothing at
// all for a reader with JS off. Nothing failed, because a control that only
// works after hydration looks identical to one that works, to whoever is
// looking at a hydrated page.
//
// ## The rule, which is the same for all of them
//
// **An unrecognised value means "no filter", never "an empty list".** A retired
// topic id in a year-old bookmark, a stance renamed by a later release, a
// category that no longer exists — every one of those should show the reader the
// catalogue, not a blank page that reads as "we have nothing like this". The
// browse controls apply exactly the opposite rule internally (`filterByTopic`
// filters an unknown value to nothing, deliberately, because a stale in-page
// selection is a bug rather than a bookmark), so the two must not be confused:
// this boundary converts a URL into a *selection*, and only a selection the
// current build understands may cross it.
//
// `?gate=` is the exception and is not validated here, because it is a corpus
// slug rather than a closed vocabulary — the listing has not been fetched at the
// point this runs, and the browser already falls back to the first gate when the
// selection is not in the filtered set.
// Explicit `.ts` on every value import: this module is reachable from a
// `node --test` entry point, which strips types but resolves paths literally.
// Same convention as the rest of lib/repository.
import { resolveRowLimit, type RowLimit } from "./browse-page.ts";
import { BROWSE_ORDERS, type BrowseOrder } from "./browse-order.ts";
import { isInterfaceStance, isPortEnd, type InterfaceStance, type PortEnd } from "./interface.ts";
import { isTopicId, type TopicId } from "./topics.ts";
import { isPublicRepositoryCategory, type PublicRepositoryCategory } from "./types.ts";

/** Next's `searchParams` shape: a value may be absent, a string, or repeated. */
export type BrowseSearchParams = Record<string, string | string[] | undefined>;

export interface ResolvedBrowseParams {
  topic: TopicId | "";
  stance: InterfaceStance | "";
  category: "all" | PublicRepositoryCategory;
  gate: string | null;
  /** `?q=` — the text filter. Empty string means no filter. */
  query: string;
  /** `?order=` — which derived number ranks the list. */
  order: BrowseOrder;
  /** `?circuit=1` — hold back the records that pin no gate sequence. */
  circuitOnly: boolean;
  /** `?rows=` — how much of the list arrives on first paint. */
  rows: RowLimit;
}

/**
 * The longest `?q=` this route will act on.
 *
 * `matchesRepositoryQuery` walks every entry for every keystroke, so an
 * arbitrarily long string from a URL is work an anonymous request can ask for.
 * 200 characters is far past any real search of a catalogue whose longest title
 * is under 80 — a longer one is truncated rather than rejected, because
 * rejecting it would show the whole catalogue to somebody who plainly meant to
 * filter, and truncation at least narrows.
 */
export const MAX_QUERY_LENGTH = 200;

/**
 * The first value, when a param was repeated.
 *
 * `?topic=a&topic=b` arrives as an array. Taking `[0]` rather than rejecting the
 * whole thing is the same "show the catalogue" instinct as an unknown value: a
 * duplicated param is almost always a link built by concatenation, and the
 * reader meant one of them.
 */
function first(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

export function resolveBrowseParams(params: BrowseSearchParams): ResolvedBrowseParams {
  const topic = first(params.topic);
  const stance = first(params.fits);
  const category = first(params.category);
  const gate = first(params.gate);
  const query = first(params.q);
  const order = first(params.order);
  const circuit = first(params.circuit);
  return {
    topic: topic !== undefined && isTopicId(topic) ? topic : "",
    stance: stance !== undefined && isInterfaceStance(stance) ? stance : "",
    category: category !== undefined && isPublicRepositoryCategory(category) ? category : "all",
    // Trimmed and emptied to null, so `?gate=` with nothing after it is the same
    // as no param rather than a selection nothing can match.
    gate: gate && gate.trim() ? gate.trim() : null,
    // Not validated against anything — a search string has no vocabulary, and
    // the corpus answering nothing is a legitimate result rather than a stale
    // bookmark. Bounded, though: see MAX_QUERY_LENGTH.
    query: query ? query.trim().slice(0, MAX_QUERY_LENGTH) : "",
    // `catalog` is the authored order and the default the page has always had,
    // so an unrecognised or retired sort key lands on it rather than on an
    // arbitrary ranking. The component may still override this to `catalog`
    // when the listing that would rank it did not load — an order the data
    // cannot supply is not an order.
    order: order !== undefined && isBrowseOrder(order) ? order : "catalog",
    // Only the two spellings a link of ours produces. Anything else is off,
    // because this filter *removes* 163 of 283 records and a typo should not
    // silently hide most of the catalogue.
    circuitOnly: circuit === "1" || circuit === "true",
    rows: resolveRowLimit(first(params.rows)),
  };
}

/** Whether `value` names an order this build can apply. */
export function isBrowseOrder(value: string): value is BrowseOrder {
  return (BROWSE_ORDERS as readonly string[]).includes(value);
}

/**
 * `/repository/<slug>?port=in|out` — which end of the piece arrives expanded.
 *
 * Here rather than inline in the entry page for the reason the header gives: the
 * one thing every param on this route has in common is that it is the boundary
 * where a URL becomes a selection, and `?category=` was missed for two sessions
 * by being decided at a call site instead. Same fallback rule as its four
 * neighbours — an unrecognised value is *no selection*, so a stale bookmark
 * still renders the entry with both ends closed rather than erroring.
 *
 * **The param is the address, not the mechanism.** `<details>` toggles natively
 * with no JavaScript at all, so a reader who clicks an end never navigates. What
 * this gives is the thing an `onClick` cannot: an expanded end can be linked,
 * bookmarked, shared and crawled.
 */
export function resolveEntryPort(params: BrowseSearchParams): PortEnd | null {
  const port = first(params.port);
  return port !== undefined && isPortEnd(port) ? port : null;
}
