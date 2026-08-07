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
import { isInterfaceStance, type InterfaceStance } from "./interface.ts";
import { isTopicId, type TopicId } from "./topics.ts";
import { isPublicRepositoryCategory, type PublicRepositoryCategory } from "./types.ts";

/** Next's `searchParams` shape: a value may be absent, a string, or repeated. */
export type BrowseSearchParams = Record<string, string | string[] | undefined>;

export interface ResolvedBrowseParams {
  topic: TopicId | "";
  stance: InterfaceStance | "";
  category: "all" | PublicRepositoryCategory;
  gate: string | null;
}

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
  return {
    topic: topic !== undefined && isTopicId(topic) ? topic : "",
    stance: stance !== undefined && isInterfaceStance(stance) ? stance : "",
    category: category !== undefined && isPublicRepositoryCategory(category) ? category : "all",
    // Trimmed and emptied to null, so `?gate=` with nothing after it is the same
    // as no param rather than a selection nothing can match.
    gate: gate && gate.trim() ? gate.trim() : null,
  };
}
