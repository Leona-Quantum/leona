// Walking `GET /v1/catalog/entries` page by page, and proving the walk was
// complete.
//
// Split out of repository-source.ts with no imports of its own so the node test
// runner can load it: repository-source pulls in the whole static corpus, which
// is several hundred modules deep. Same reason lib/control-plane.ts is
// dependency-free.
//
// The completeness proof is the point of this file. A catalog that is short a
// hundred records renders exactly like a complete one — no error, no empty
// state, just fewer algorithms on the page than the corpus actually holds. So
// the count the server reports for the whole set is checked against what we
// actually assembled, and a disagreement is treated as a failed fetch.

/**
 * Entries requested per page.
 *
 * Chosen so a page of the FULL view stays under Vercel's 2 MB data-cache
 * ceiling: the whole corpus is ~2.37 MB across 283 records, so 100 records is
 * roughly 840 KB. The unpaginated full view was over that ceiling and therefore
 * refetched on every single request; paginating is what makes its `revalidate`
 * window real rather than decorative.
 */
export const CATALOG_PAGE_SIZE = 100;

/** Server's count of everything the listing would return, unpaginated. */
export const CATALOG_TOTAL_HEADER = "x-catalog-total";

/** Backstop against a server that never advances. */
export const CATALOG_MAX_PAGES = 100;

export type CatalogView = "full" | "list";

export type CatalogPage = { payload: unknown; total: number | null };

/** Fetch one page, or null if it could not be read. */
export type CatalogPageFetcher = (url: string) => Promise<CatalogPage | null>;

export function catalogPageUrl(apiUrl: string, view: CatalogView, offset: number): string {
  const viewParam = view === "list" ? "&view=list" : "";
  return `${apiUrl}/v1/catalog/entries?limit=${CATALOG_PAGE_SIZE}&offset=${offset}${viewParam}`;
}

/**
 * The advertised size of the whole set, or null if the server did not say.
 *
 * Null is meaningful rather than an error: a server that predates pagination
 * sends no such header, and has already returned everything.
 */
export function parseCatalogTotal(headers: Headers): number | null {
  const raw = headers.get(CATALOG_TOTAL_HEADER)?.trim();
  // An empty header must read as absent, not as zero: `Number("")` is 0, and a
  // total of zero makes any page look complete.
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Every page of the listing concatenated, or null if we cannot prove we got all
 * of it.
 *
 * Null means "use the fallback", never "the catalog is empty" — the caller
 * serves the committed static corpus instead, which is complete by
 * construction.
 */
export async function collectCatalogPages(
  apiUrl: string,
  view: CatalogView,
  fetchPage: CatalogPageFetcher,
  log: (message: string) => void = console.error,
): Promise<unknown[] | null> {
  const collected: unknown[] = [];
  let total: number | null = null;

  for (let page = 0; page < CATALOG_MAX_PAGES; page += 1) {
    const url = catalogPageUrl(apiUrl, view, page * CATALOG_PAGE_SIZE);
    const result = await fetchPage(url);
    if (result === null) return null;
    if (!Array.isArray(result.payload)) {
      log(`[catalog-pagination] page ${page} was not an array (${url})`);
      return null;
    }
    collected.push(...result.payload);

    if (page === 0) {
      // No total header on the FIRST page: a pre-pagination server, which
      // ignored limit/offset and has already handed us the whole corpus.
      // Asking for page 2 would return the same rows again, forever.
      if (result.total === null) return collected;
      total = result.total;
    } else if (result.total === null) {
      // A header that disappears mid-walk is a broken response, not a
      // pre-pagination server — a rolling deploy can put an old instance
      // behind the same load balancer as a new one. Returning here would skip
      // the completeness check below and serve the partial corpus.
      log(`[catalog-pagination] page ${page} lost its total header mid-walk (${url})`);
      return null;
    }

    if (collected.length >= (total ?? 0)) break;
    // A server that answers a page inside the advertised range with nothing has
    // contradicted its own total; stop and let the count check below refuse it,
    // rather than spinning to CATALOG_MAX_PAGES.
    if (result.payload.length === 0) break;
  }

  if (total !== null && collected.length !== total) {
    log(
      `[catalog-pagination] collected ${collected.length} of ${total} entries; ` +
        "refusing to serve a partial corpus",
    );
    return null;
  }
  return collected;
}
