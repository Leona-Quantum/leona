import assert from "node:assert/strict";
import test from "node:test";
import {
  CATALOG_MAX_PAGES,
  CATALOG_PAGE_SIZE,
  catalogPageUrl,
  collectCatalogPages,
  parseCatalogTotal,
  type CatalogPage,
} from "./catalog-pagination.ts";

const API = "https://api.test";

/**
 * Stand in for the catalog API.
 *
 * `total` null omits the header entirely, which is how a server that predates
 * pagination behaves; `corpus` is how many entries actually exist, so a server
 * can be made to disagree with its own advertised total.
 */
function serve(
  { total, corpus }: { total: number | null; corpus: number },
  options: { honourPaging?: boolean } = {},
) {
  const honourPaging = options.honourPaging ?? true;
  const requested: string[] = [];
  const all = Array.from({ length: corpus }, (_, i) => ({ slug: `paged-${i}` }));

  const fetchPage = async (url: string): Promise<CatalogPage | null> => {
    requested.push(url);
    const params = new URL(url).searchParams;
    const limit = Number(params.get("limit") ?? CATALOG_PAGE_SIZE);
    const offset = Number(params.get("offset") ?? 0);
    return {
      payload: honourPaging ? all.slice(offset, offset + limit) : all,
      total,
    };
  };
  return { fetchPage, requested };
}

const silent = () => {};

test("a corpus larger than one page is collected across pages, without overlap", async () => {
  const { fetchPage, requested } = serve({ total: 230, corpus: 230 });
  const entries = (await collectCatalogPages(API, "list", fetchPage, silent)) as { slug: string }[];
  assert.equal(entries.length, 230);
  assert.equal(requested.length, 3);
  assert.equal(new Set(entries.map((e) => e.slug)).size, 230);
});

test("a server short of its own advertised total is refused", async () => {
  // The failure this exists for: the server says 230 and hands back 100. A
  // partial catalog renders with no error at all, so this count check is the
  // only thing standing between that and a public page quietly missing 130
  // algorithms.
  const { fetchPage } = serve({ total: 230, corpus: 100 });
  assert.equal(await collectCatalogPages(API, "list", fetchPage, silent), null);
});

test("a server with no total header is treated as having returned everything", async () => {
  // A pre-pagination API ignores limit/offset and returns the whole corpus on
  // every request. Paging it would refetch the same rows forever, so the two
  // deploys need no ordering between them.
  const { fetchPage, requested } = serve({ total: null, corpus: 230 }, { honourPaging: false });
  const entries = (await collectCatalogPages(API, "list", fetchPage, silent)) as unknown[];
  assert.equal(entries.length, 230);
  assert.equal(requested.length, 1);
});

test("an exact multiple of the page size does not fetch an extra empty page", async () => {
  const { fetchPage, requested } = serve({ total: CATALOG_PAGE_SIZE, corpus: CATALOG_PAGE_SIZE });
  const entries = (await collectCatalogPages(API, "list", fetchPage, silent)) as unknown[];
  assert.equal(entries.length, CATALOG_PAGE_SIZE);
  assert.equal(requested.length, 1);
});

test("an empty corpus is a real answer, not a failure", async () => {
  const { fetchPage } = serve({ total: 0, corpus: 0 });
  assert.deepEqual(await collectCatalogPages(API, "list", fetchPage, silent), []);
});

test("a failed page aborts rather than serving what came before it", async () => {
  let call = 0;
  const fetchPage = async (): Promise<CatalogPage | null> => {
    call += 1;
    if (call === 1) return { payload: Array.from({ length: 100 }, () => ({})), total: 230 };
    return null;
  };
  assert.equal(await collectCatalogPages(API, "list", fetchPage, silent), null);
});

test("a non-array page is refused rather than spread into the results", async () => {
  const fetchPage = async (): Promise<CatalogPage> => ({ payload: { error: "nope" }, total: 5 });
  assert.equal(await collectCatalogPages(API, "list", fetchPage, silent), null);
});

test("a server that never advances is bounded, and still refused", async () => {
  // Advertises far more than it will ever serve, one entry at a time.
  const fetchPage = async (): Promise<CatalogPage> => ({ payload: [{}], total: 10 ** 6 });
  const before = Date.now();
  assert.equal(await collectCatalogPages(API, "list", fetchPage, silent), null);
  assert.ok(Date.now() - before < 5000);
});

test("every request carries an explicit bound", async () => {
  const { fetchPage, requested } = serve({ total: 150, corpus: 150 });
  await collectCatalogPages(API, "list", fetchPage, silent);
  assert.ok(requested.length > 0);
  for (const url of requested) {
    assert.match(url, /[?&]limit=\d+/, `unbounded catalog request: ${url}`);
    assert.match(url, /[?&]offset=\d+/, `unpaged catalog request: ${url}`);
  }
});

test("the view projection is carried on every page, and only for the list view", async () => {
  const list = serve({ total: 150, corpus: 150 });
  await collectCatalogPages(API, "list", list.fetchPage, silent);
  for (const url of list.requested) assert.match(url, /view=list/, url);

  const full = serve({ total: 150, corpus: 150 });
  await collectCatalogPages(API, "full", full.fetchPage, silent);
  for (const url of full.requested) assert.doesNotMatch(url, /view=list/, url);
});

test("offsets step by the page size from zero", () => {
  assert.equal(
    catalogPageUrl(API, "full", 0),
    `${API}/v1/catalog/entries?limit=${CATALOG_PAGE_SIZE}&offset=0`,
  );
  assert.equal(
    catalogPageUrl(API, "list", CATALOG_PAGE_SIZE),
    `${API}/v1/catalog/entries?limit=${CATALOG_PAGE_SIZE}&offset=${CATALOG_PAGE_SIZE}&view=list`,
  );
});

test("the total header is read strictly", () => {
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "283" })), 283);
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "0" })), 0);
  // A header we cannot trust must read as absent, never as zero — zero would
  // make every page look complete.
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "many" })), null);
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "" })), null);
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "-1" })), null);
  assert.equal(parseCatalogTotal(new Headers({ "X-Catalog-Total": "1.5" })), null);
  assert.equal(parseCatalogTotal(new Headers()), null);
});

test("the page ceiling is high enough for a corpus that grows", () => {
  assert.ok(CATALOG_MAX_PAGES * CATALOG_PAGE_SIZE >= 10_000);
});
