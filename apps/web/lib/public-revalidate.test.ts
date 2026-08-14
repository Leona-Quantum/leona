import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CATALOG_REVALIDATE_SECONDS } from "./catalog-revalidate.ts";
import { LOCALE_ROUTES } from "./routed-paths.ts";

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

function pageFiles(): { route: string; source: string }[] {
  const pages: { route: string; source: string }[] = [];
  const walk = (dir: string, route: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "page.tsx") {
        pages.push({ route: route === "" ? "/" : route, source: readFileSync(join(dir, entry.name), "utf8") });
      }
      if (entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("@")) {
        walk(join(dir, entry.name), `${route}/${entry.name}`);
      }
    }
  };
  walk(LOCALE_DIR, "");
  return pages;
}

test("every cached public page revalidates on the one shared cadence", () => {
  const pages = pageFiles();
  // A page list that came back empty would pass every assertion below without
  // checking anything — the exact shape of failure this repository keeps
  // finding in its own gates.
  assert.equal(pages.length, LOCALE_ROUTES.length, "found a different number of pages than LOCALE_ROUTES declares");

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
