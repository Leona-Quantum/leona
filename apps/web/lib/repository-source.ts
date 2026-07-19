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

/** Fetch + JSON-decode one catalog URL, or null with a loud log. */
async function fetchCatalogPayload(url: string): Promise<unknown | null> {
  try {
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ["public-catalog"] },
    });
    if (!upstream.ok) {
      console.error(`[repository-source] catalog fetch failed: HTTP ${upstream.status} (${url})`);
      return null;
    }
    return await upstream.json();
  } catch (error) {
    console.error(`[repository-source] catalog fetch threw (${url}):`, error);
    return null;
  }
}

async function fetchCatalogEntries(): Promise<PublicRepositoryEntry[] | null> {
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/entries`);
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
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/entries?view=list`);
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
 * Prefer getRepositoryListEntries() for anything that only renders the browse
 * list — this response is ~2.37 MB and is over Vercel's data-cache ceiling, so
 * it is refetched on every request.
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
 * This is the cacheable path: ~0.91 MB against a 2 MB ceiling, so the
 * revalidate window on the fetch is real rather than inert. The static corpus
 * satisfies the narrower type directly (PublicRepositoryEntry is a superset),
 * so the fallback needs no projection of its own.
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
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/entries/${encodeURIComponent(slug)}`);
  // A miss is an ordinary 404 for an unknown slug, which fetchCatalogPayload
  // already logged; fall through to the static corpus so a transient API
  // failure does not 404 a record that genuinely exists.
  const parsed = payload === null ? null : parseCatalogEntries([payload]).entries[0] ?? null;
  return parsed ?? PUBLIC_REPOSITORY_ENTRIES.find((entry) => entry.slug === slug);
}
