import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CATALOG_REVALIDATE_SECONDS } from "./catalog-revalidate.ts";
import { LOCALE_PREFIX_ROUTES, LOCALE_ROUTES } from "./routed-paths.ts";

/**
 * One number, in one place — enforced by a check because Next will not let it
 * be enforced by an import.
 *
 * `export const revalidate` is route segment configuration, and Next requires
 * it to be a statically analyzable literal. Writing
 *
 *     export const revalidate = CATALOG_REVALIDATE_SECONDS;
 *
 * fails the build with "Invalid segment configuration export detected" — tried,
 * not assumed. So each page carries the literal `300` and this asserts every one
 * of them still equals the constant.
 *
 * The number matters and is not arbitrary. `sync-bootstrap` publishes corpus
 * changes WITHOUT a deploy and the site is expected to pick them up in about
 * five minutes. A page that drifted to a longer window, or to `force-static`,
 * would serve a stale corpus — which has already happened once in production,
 * 362 records served against a manifest of 369, for a day.
 */
const LOCALE_DIR = fileURLToPath(new URL("../app/[locale]/", import.meta.url));
const NEXT_CONFIG = fileURLToPath(new URL("../next.config.ts", import.meta.url));

/**
 * Two kinds of page live under `app/[locale]/`, and they reach the CDN by
 * different mechanisms. Telling them apart is what the tests below are for.
 *
 * A page that reads `searchParams` is opted into request-time rendering by Next
 * and CANNOT be prerendered — "a Request-time API whose values cannot be known
 * ahead of time". `export const revalidate` on such a page would be a claim
 * about a static render that never happens, so it is required to be ABSENT
 * rather than merely tolerated; a reader who found one would reasonably conclude
 * the page was cached in a way it is not. Those pages are cached in front of the
 * render instead, by `Vercel-CDN-Cache-Control` in `next.config.ts`.
 *
 * Every other page here is prerendered and carries the shared revalidate.
 */
function readsSearchParams(source: string): boolean {
  // Comments are stripped first, and that is not fussiness: every page in this
  // directory now carries a comment EXPLAINING the searchParams rule, so a bare
  // match classified the one page that prerenders as one that cannot. The
  // detector has to look at what the page does, not at what it says about
  // itself.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  return /\bsearchParams\b/.test(code);
}

function pageFiles(): { route: string; source: string }[] {
  const pages: { route: string; source: string }[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") {
        pages.push({ route: route === "" ? "/" : route, source: readFileSync(join(dir, entry.name), "utf8") });
      }
      if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("@")) {
        // A route group — `(browse)`, today — is transparent in the URL, so it
        // contributes no segment of its own. Walked into without extending
        // `route`, the same rule `routed-paths.test.ts`'s own disk-walker
        // applies, or a page inside one (`/repository`'s browse index) would
        // be counted under a path nothing ever requests.
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(join(dir, entry.name), isGroup ? route : `${route}/${entry.name}`);
      }
    }
  };
  walk(LOCALE_DIR, "");
  return pages;
}

test("every page under [locale] is accounted for by one list or the other", () => {
  // A page list that came back empty would pass every assertion below without
  // checking anything — the exact shape of failure this repository keeps
  // finding in its own gates. The count is asserted first, and it now spans two
  // lists: the seven exact marketing routes plus whatever the Atlas prefix
  // subtrees serve, which `routed-paths.test.ts` checks against disk in both
  // directions.
  const pages = pageFiles();
  const exact = pages.filter(({ route }) => !LOCALE_PREFIX_ROUTES.some(
    (prefix) => route === prefix || route.startsWith(`${prefix}/`),
  ));
  const prefixed = pages.filter((page) => !exact.includes(page));
  assert.equal(exact.length, LOCALE_ROUTES.length, "found a different number of top-level pages than LOCALE_ROUTES declares");
  assert.ok(prefixed.length > 0, "no page found under the Atlas prefix subtrees, so the checks below would be vacuous");
});

test("every PRERENDERED public page revalidates on the one shared cadence", () => {
  const pages = pageFiles().filter(({ source }) => !readsSearchParams(source));
  assert.ok(pages.length > 0, "no prerendered page found, so this check would pass vacuously");

  for (const { route, source } of pages) {
    const match = source.match(/^export const revalidate = (\d+);$/m);
    assert.ok(match, `${route} has no \`export const revalidate\`, so it is not cached at all`);
    assert.equal(
      Number(match[1]),
      CATALOG_REVALIDATE_SECONDS,
      `${route} revalidates on ${match[1]}s but CATALOG_REVALIDATE_SECONDS is ${CATALOG_REVALIDATE_SECONDS}s`,
    );
  }
});

test("a page that reads searchParams carries no revalidate, and is CDN-cached instead", () => {
  // The two halves of one rule. Such a page cannot prerender, so `revalidate`
  // would be a false claim; and with no `Vercel-CDN-Cache-Control` source
  // covering it, it is not cached at all — which is the silent regression this
  // whole change exists to fix, and it looks exactly like success from CI.
  const config = readFileSync(NEXT_CONFIG, "utf8");
  assert.match(config, /Vercel-CDN-Cache-Control/, "next.config.ts no longer sets Vercel-CDN-Cache-Control at all");

  const dynamicPages = pageFiles().filter(({ source }) => readsSearchParams(source));
  assert.ok(dynamicPages.length > 0, "no searchParams-reading page found, so this check would pass vacuously");

  for (const { route, source } of dynamicPages) {
    assert.equal(
      /^export const revalidate = /m.test(source),
      false,
      `${route} reads searchParams, so it renders on every request and cannot prerender; its \`revalidate\` claims a static render that never happens`,
    );
    // Two ways a dynamic page can be covered, because `/repository` (exact)
    // joined the prefix subtrees as the first LOCALE_ROUTES entry that also
    // reads searchParams — no earlier exact entry needed this branch, since
    // all six marketing pages prerender.
    //
    // Prefix: the subtree the header names, not the page's own route —
    // `next.config.ts` covers `/repository/layers` and everything under it
    // with one source pair.
    const prefixCovered = LOCALE_PREFIX_ROUTES.filter(
      (prefix) => route === prefix || route.startsWith(`${prefix}/`),
    ).some((prefix) => config.includes(`"${prefix}"`));
    // Exact: the page's own route, named directly — `/repository` itself,
    // not a subtree. A page reachable only via an exact LOCALE_ROUTES entry
    // is covered this way instead; the prefix filter above is legitimately
    // empty for it, which is why `some()` on an empty array (`false`) must
    // not be the final word.
    const exactCovered = LOCALE_ROUTES.includes(route) && config.includes(`"${route}"`);
    assert.ok(
      prefixCovered || exactCovered,
      `${route} reads searchParams but no Vercel-CDN-Cache-Control source in next.config.ts covers it, so it renders on every request and is never cached`,
    );
    // **The third half of the rule, and the one that looks redundant.**
    //
    // Every page here also sets `dynamicParams = false`, which reads like it
    // already refuses an unknown locale. On these pages it does not.
    // `dynamicParams` restricts params only on a route that PRERENDERS — it
    // decides whether to render params outside the prerendered set, and where
    // nothing is prerendered, every param is outside it.
    //
    // Measured on a preview deployment, both halves in one run:
    //   /zz/repository/claims  (prerendered)  404
    //   /zz/repository/layers  (dynamic)      200, English map
    //
    // So a dynamic page has to check for itself, or `[locale]` quietly becomes
    // a second address for the site's most-read route — the mistyped-URL fix
    // undone exactly where it matters most.
    assert.match(
      source,
      /isPublicLocale\([^)]*\)\)\s*notFound\(\)/,
      `${route} reads searchParams, so it never prerenders and \`dynamicParams = false\` cannot refuse an unknown locale for it; it must call notFound() on one itself`,
    );
  }
});

test("no cached public page is force-static", () => {
  // `force-static` would freeze the corpus until the next deploy and silently
  // break catalog-sync, which publishes without one.
  for (const { route, source } of pageFiles()) {
    assert.equal(
      /export const dynamic\s*=\s*["']force-static["']/.test(source),
      false,
      `${route} is force-static; use revalidate so sync-bootstrap's publishes are picked up`,
    );
  }
});

test("every cached public page refuses an unknown locale", () => {
  // Without this a root-level `[locale]` matches any single-segment path, and a
  // mistyped URL is answered with the home page instead of the site's own 404.
  for (const { route, source } of pageFiles()) {
    assert.ok(
      /^export const dynamicParams = false;$/m.test(source),
      `${route} does not set \`dynamicParams = false\`, so /anything would render it`,
    );
  }
});
