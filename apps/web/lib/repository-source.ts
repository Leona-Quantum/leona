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
import {
  catalogPageUrl,
  collectCatalogPages,
  parseCatalogTotal,
  type CatalogPage,
} from "./catalog-pagination";
import { isPublicCatalogApiEnabled } from "./public-catalog";
import { parseCatalogEntries, parseCatalogListEntries } from "./repository/from-catalog";
import {
  parseEstimate,
  parseEstimateList,
  type RepositoryEstimate,
  type RepositoryEstimateList,
} from "./repository/estimate.ts";
import {
  parseProfile,
  parseProfileList,
  type RepositoryProfile,
  type RepositoryProfileList,
} from "./repository/profile.ts";
import { PUBLIC_REPOSITORY_ENTRIES } from "./public-repository";
import type { PublicRepositoryEntry, PublicRepositoryListEntry } from "./repository/types";
import { reportCallerTrust, withTrustedCallerHeader } from "./trusted-caller";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/** Revalidation window for the catalog fetch, in seconds. */
const CATALOG_REVALIDATE_SECONDS = 300;

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
      // Identifies this as our own renderer so the API meters it in its own
      // bucket instead of sharing the anonymous per-address ceiling with every
      // visitor at once (lib/trusted-caller.ts). Absent when unconfigured.
      headers: withTrustedCallerHeader({ Accept: "application/json" }),
      next: { revalidate: CATALOG_REVALIDATE_SECONDS, tags: ["public-catalog"] },
    });
    // Before the `ok` check: a 429 is precisely the response whose trust verdict
    // is worth reading, and returning early on it would skip the one log line
    // that names the cause.
    reportCallerTrust(upstream.headers, url);
    if (!upstream.ok) {
      if (!(expected404 && upstream.status === 404)) {
        console.error(`[repository-source] catalog fetch failed: HTTP ${upstream.status} (${url})`);
      }
      return null;
    }
    return { payload: await upstream.json(), total: parseCatalogTotal(upstream.headers) };
  } catch (error) {
    console.error(`[repository-source] catalog fetch threw (${url}):`, error);
    return null;
  }
}

async function fetchCatalogPayload(url: string, expected404 = false): Promise<unknown | null> {
  const page = await fetchCatalogPage(url, expected404);
  return page === null ? null : page.payload;
}

/** Every page of the listing, or null if completeness could not be proved. */
function fetchAllCatalogPages(view: "full" | "list"): Promise<unknown[] | null> {
  return collectCatalogPages(API_URL, view, (url) => fetchCatalogPage(url));
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

/**
 * One entry's fault-tolerant cost under the API's default assumption set (E4),
 * or null when there is no estimate to show.
 *
 * **Null has no static fallback, on purpose.** Every other reader here falls
 * back to the committed corpus when the API is unreachable, which is safe
 * because both sides hold the same 283 records — the visitor sees identical
 * content either way. An estimate is not content: it is derived by the
 * estimation package from the entry's circuit, that package is Python, and the
 * web build has no second implementation of it. A TypeScript reimplementation
 * living here is exactly the drift the estimator's own module comment warns
 * about, and the copy that drifted would be the one on the public page.
 *
 * So when the API is off or unwell this returns null and the section does not
 * render. A page missing its cost panel is a page missing a panel. A page
 * showing a cost computed by a second, unversioned implementation of the
 * arithmetic is a wrong number with a citation under it.
 */
export async function getRepositoryEstimate(slug: string): Promise<RepositoryEstimate | null> {
  if (!isPublicCatalogApiEnabled()) return null;
  const payload = await fetchCatalogPayload(
    `${API_URL}/v1/catalog/entries/${encodeURIComponent(slug)}/estimate`,
    true,
  );
  if (payload === null) return null;
  const parsed = parseEstimate(payload);
  if (parsed === null) {
    console.error(`[repository-source] estimate for ${slug} failed validation`);
  }
  return parsed;
}

/**
 * Every published entry's cost under ONE assumption set, or null.
 *
 * One request rather than one per card — not only for the obvious reason, but
 * because 283 independently-parameterised responses is the shape in which a
 * client ends up ranking rows costed under different assumptions without ever
 * deciding to. The identity arrives once, on the container.
 */
export async function getRepositoryEstimates(): Promise<RepositoryEstimateList | null> {
  if (!isPublicCatalogApiEnabled()) return null;
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/estimates`);
  if (payload === null) return null;
  const parsed = parseEstimateList(payload);
  if (parsed === null) {
    console.error("[repository-source] estimate listing failed validation");
    return null;
  }
  return parsed;
}

/**
 * One entry's derived resource profile (R1), or null when there is none to show.
 *
 * **Null has no static fallback, for the same reason `getRepositoryEstimate`
 * has none — and it is worth spelling out, because here the temptation is real.**
 * The committed corpus carries `portableCircuit` on every entry that has one, so
 * this file *could* count the steps itself in a dozen lines and never miss. That
 * is exactly the drift `majorana_openqasm/portable.py` was extracted to prevent:
 * the width rule alone is subtle enough that a second implementation would agree
 * on 119 of 120 circuits and be wrong about the one whose declared `qubitCount`
 * is narrower than its steps — and the copy on the public page would be this one.
 *
 * So when the API is off or unwell the panel does not render. A page missing a
 * panel is a page missing a panel; a page showing a depth from a second,
 * unversioned implementation is a wrong number under a heading that says
 * "derived".
 */
export async function getRepositoryProfile(slug: string): Promise<RepositoryProfile | null> {
  if (!isPublicCatalogApiEnabled()) return null;
  const payload = await fetchCatalogPayload(
    `${API_URL}/v1/catalog/entries/${encodeURIComponent(slug)}/profile`,
    true,
  );
  if (payload === null) return null;
  const parsed = parseProfile(payload);
  if (parsed === null) {
    console.error(`[repository-source] profile for ${slug} failed validation`);
  }
  return parsed;
}

/**
 * Every published entry's derived resource profile, or null.
 *
 * One request rather than one per card. Unlike the estimate listing there is no
 * parameter to get wrong and no identity to carry: a profile is a property of
 * the circuit, so every row in this payload is rankable against every other
 * unconditionally.
 */
export async function getRepositoryProfiles(): Promise<RepositoryProfileList | null> {
  if (!isPublicCatalogApiEnabled()) return null;
  const payload = await fetchCatalogPayload(`${API_URL}/v1/catalog/profiles`);
  if (payload === null) return null;
  const parsed = parseProfileList(payload);
  if (parsed === null) {
    console.error("[repository-source] profile listing failed validation");
    return null;
  }
  return parsed;
}
