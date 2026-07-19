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
import { parseCatalogEntries } from "./repository/from-catalog";
import { PUBLIC_REPOSITORY_ENTRIES } from "./public-repository";
import type { PublicRepositoryEntry } from "./repository/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Revalidation window for the catalog fetch, in seconds. */
const CATALOG_REVALIDATE_SECONDS = 300;

async function fetchCatalogEntries(): Promise<PublicRepositoryEntry[] | null> {
  let payload: unknown;
  try {
    const upstream = await fetch(`${API_URL}/v1/catalog/entries`, {
      headers: { Accept: "application/json" },
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ["public-catalog"] },
    });
    if (!upstream.ok) {
      console.error(`[repository-source] catalog fetch failed: HTTP ${upstream.status}`);
      return null;
    }
    payload = await upstream.json();
  } catch (error) {
    console.error("[repository-source] catalog fetch threw:", error);
    return null;
  }

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

/**
 * Every entry backing /repository. Async by construction so the call sites do not
 * have to change again when the flag flips.
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

/** One entry by slug, or undefined. */
export async function getRepositoryEntry(slug: string): Promise<PublicRepositoryEntry | undefined> {
  const entries = await getRepositoryEntries();
  return entries.find((entry) => entry.slug === slug);
}
