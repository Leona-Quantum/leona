// Server-side source of /repository content: the committed static corpus, or the
// API's published system catalog when MAJORANA_PUBLIC_CATALOG_API is on.
//
// Why there is no app/api/* proxy route for this: every existing handler under
// app/api/ proxies an AUTHENTICATED upstream call on behalf of the browser. The
// public catalog is anonymous and is only ever read by server components and
// route handlers, which can reach the API directly. Adding a public passthrough
// would create a second unauthenticated surface for no gain.
//
// Fallback policy: if the API is unreachable or returns nothing usable, fall back
// to the static corpus rather than 500 the public site. That is safe precisely
// because both sides are the same 283 records (owner decision 2026-07-19) — the
// visitor sees identical content either way. It is logged loudly because a silent
// fallback would make a broken cutover look like a working one.
//
// Server-only by convention, not by the `server-only` package (not a workspace
// dependency): the only importers are server components and route handlers. The
// client components take entries as props and keep importing the static barrel
// for their synchronous variant/verification helpers.
import { isPublicCatalogApiEnabled } from "./public-catalog";
import { parseCatalogEntries, parseCatalogListEntries } from "./repository/from-catalog";
import { PUBLIC_REPOSITORY_ENTRIES } from "./public-repository";
import type { PublicRepositoryEntry, PublicRepositoryListEntry } from "./repository/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Revalidation window for the catalog fetch, in seconds. */
const CATALOG_REVALIDATE_SECONDS = 300;

/**
 * Entries requested per page.
 *
 * Chosen so that a page of the FULL view stays under Vercel's 2 MB data-cache
 * ceiling: the whole corpus is ~2.37 MB across 283 records, so 100 records is
 * roughly 840 KB. The unpaginated full view was over the ceiling and therefore
 * refetched on every single request; paginating is what makes its `revalidate`
 * window real rather than decorative.
 */
const CATALOG_PAGE_SIZE = 100;

/** Server's count of everything the listing would return, unpaginated. */
const CATALOG_TOTAL_HEADER = "x-catalog-total";

/** Refuse to loop forever if the server never advances. */
const CATALOG_MAX_PAGES = 100;

type CatalogPage = { payload: unknown; total: number | null };

/**
 * Fetch + JSON-decode one catalog URL, or null with a loud log.
 *
 * `expected404` is set by the per-slug lookup, where a 404 is the ordinary
 * answer for a slug that does not exist rather than a fault. Without it every
 * visit to an unknown /repository/<slug> would write an error line that reads
 * like an API outage, which is exactly the noise that makes a real outage hard
 * to spot. Every other status, on every caller, still logs.
 */
async function fetchCatalogPage(url: string, expected404 = false): Promise<CatalogPage | null> {
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ["public-catalog"] },
    });
    if (!upstream.ok) {
      if (!(expected404 && upstream.status === 404)) {
        console.error(`[repository-source] catalog fetch failed: HTTP ${upstream.status} (${url})`);
      }
      return null;
    }
    const header = upstream.headers.get(CATALOG_TOTAL_HEADER);
    const parsedTotal = header === null ? Number.NaN : Number(header);
    return {
      payload: await upstream.json(),
      total: Number.isInteger(parsedTotal) ? parsedTotal : null,
    };
  } catch (error) {
    console.error(`[repository-source] catalog fetch threw (${url}):`, error);
    return null;
  }
}

async function fetchCatalogPayload(url: string, expected404 = false): Promise<unknown | null> {
  const page = await fetchCatalogPage(url, expected404);
  return page === null ? null : page.payload;
}

/**
 * Every page of the catalog listing, concatenated — or null if we cannot prove
 * we got all of it.
 *
 * The proof matters more than the pagination. A short catalog renders exactly
 * like a complete one: no error, no empty state, just fewer algorithms than the
 * corpus actually holds. So a page count that disagrees with the server's own
 * `X-Catalog-Total` is treated as a failed fetch and sends the caller to the
 * static corpus, which is complete by construction.
 *
 * A server that predates pagination sends no total header and ignores the query
 * parameters, returning the whole corpus in one response. That is detected by
 * the absent header and accepted as-is, so this works against either version and
 * the two deploys need no ordering between them.
 */
async function fetchAllCatalogPages(view: "full" | "list"): Promise<unknown[] | null> {
  const viewParam = view === "list" ? "&view=list" : "";
  const collected: unknown[] = [];
  let total: number | null = null;

  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const offset = page * CATALOG_PAGE_SIZE;
    const url = `${API_URL}/v1/catalog/entries?limit=${CATALOG_PAGE_SIZE}&offset=${offset}${viewParam}`;
    const result = await fetchCatalogPage(url);
    if (result === null) return null;
    if (!Array.isArray(result.payload)) {
      console.error(`[repository-source] catalog page ${page} was not an array (${url})`);
      return null;
    }
    collected.push(...result.payload);

    // No total header: a pre-pagination server, which ignored limit/offset and
    // has already handed us everything. Asking for page 2 would return the same
    // rows again.
    if (result.total === null) return collected;
    if (page === 0) total = result.total;

    if (collected.length >= (total ?? 0)) break;
    if (result.payload.length === 0) break;
  }

  if (total !== null && collected.length !== total) {
    console.error(
      `[repository-source] catalog pagination collected ${collected.length} of ${total} entries; ` +
        "refusing to serve a partial corpus",
    );
    return null;
  }
  return collected;
}

async function fetchCatalogEntries(): Promise<PublicRepositoryEntry[] | null> {
  const payload = await fetchAllCatalogPages("full");
  if (payload === null) return null;

  const { entries, rejected } = parseCatalogEntries(payload);
  if (rejected.length > 0) {
    console.error(`[repository-source] ${rejected.length} catalog record(s) failed validation:`, rejected.slice(0, 20));
  }
  if (entries.length === 0) {
    console.error("[repository-source] catalog returned no usable entries");
    return null;
  }
  return entries;
}

async function fetchCatalogListEntries(): Promise<PublicRepositoryListEntry[] | null> {
  const payload = await fetchAllCatalogPages("list");
  if (payload === null) return null;

  const { entries, rejected } = parseCatalogListEntries(payload);
  if (rejected.length > 0) {
    console.error(`[repository-source] ${rejected.length} catalog list record(s) failed validation:`, rejected.slice(0, 20));
  }
  if (entries.length === 0) {
    console.error("[repository-source] catalog list returned no usable entries");
    return null;
  }
  return entries;
}

/**
 * Every entry backing /repository, with the FULL record. Async by construction
 * so the call sites do not have to change again when the flag flips.
 *
 * Still prefer getRepositoryListEntries() for anything that only renders the
 * browse list — this reads ~2.37 MB across all pages either way. What changed
 * is that no single response is over Vercel's data-cache ceiling any more, so
 * these pages are actually cached instead of refetched on every request.
 */
export async function getRepositoryEntries(): Promise<PublicRepositoryEntry[]> {
  if (!isPublicCatalogApiEnabled()) return PUBLIC_REPOSITORY_ENTRIES;
  const entries = await fetchCatalogEntries();
  if (!entries) {
    console.error("[repository-source] falling back to the static corpus");
    return PUBLIC_REPOSITORY_ENTRIES;
  }
  return entries;
}

/**
 * Every entry backing /repository, projected to the fields the browse list and
 * the detail page's related-links strip actually read (Slice E).
 *
 * This is the cheap path: ~0.91 MB in total, now split across pages of roughly
 * 320 KB. The static corpus satisfies the narrower type directly
 * (PublicRepositoryEntry is a superset), so the fallback needs no projection of
 * its own.
 */
export async function getRepositoryListEntries(): Promise<PublicRepositoryListEntry[]> {
  if (!isPublicCatalogApiEnabled()) return PUBLIC_REPOSITORY_ENTRIES;
  const entries = await fetchCatalogListEntries();
  if (!entries) {
    console.error("[repository-source] falling back to the static corpus (list)");
    return PUBLIC_REPOSITORY_ENTRIES;
  }
  return entries;
}

/**
 * One entry by slug with its full record, or undefined.
 *
 * Goes straight to the per-slug endpoint when the API is on, so a detail page
 * costs one small record rather than the whole corpus.
 */
export async function getRepositoryEntry(slug: string): Promise<PublicRepositoryEntry | undefined> {
  if (!isPublicCatalogApiEnabled()) {
    return PUBLIC_REPOSITORY_ENTRIES.find((entry) => entry.slug === slug);
  }
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/entries/${encodeURIComponent(slug)}`, true);
  // Fall through to the static corpus on a miss so a transient API failure does
  // not 404 a record that genuinely exists; a slug in neither is undefined, and
  // the caller turns that into a real notFound().
  const parsed = payload === null ? null : parseCatalogEntries([payload]).entries[0] ?? null;
  return parsed ?? PUBLIC_REPOSITORY_ENTRIES.find((entry) => entry.slug === slug);
}
