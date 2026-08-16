import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  CRAWLER_DISALLOWED_PATHS,
  MACHINE_READABLE_PATHS,
  PUBLIC_REDIRECT_ALIASES,
  PUBLIC_STATIC_PATHS,
  sitemapPaths,
} from "./sitemap-paths.ts";
import { PRODUCTION_ORIGIN, canonicalOrigin } from "./site-origin.ts";

const SURFACE = {
  entrySlugs: ["bell-state", "grover-unstructured-search"],
  layerIds: ["algorithms", "state-preparation"],
  paperSlugs: ["arxiv-cond~mat_0010440"],
};

/** Directory names under a route folder that are real URL segments. */
function routeSegments(dir: URL): string[] {
  return readdirSync(fileURLToPath(dir), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      // `[locale]` is transparent in the address a visitor sees, the same way a
      // route group is: middleware rewrites `/pricing` into `/en/pricing` and
      // 308s the prefixed form back out, so the URL segment a crawler and this
      // sitemap deal with is `pricing`, not `en`. Its children are therefore
      // the top-level segments, and each of them still has to be published,
      // aliased or disallowed like any other.
      if (entry.name === "[locale]") return routeSegments(new URL(`${entry.name}/`, dir));
      return [entry.name];
    })
    // Route groups `(app)`, parallel routes `@modal` and private folders `_x`
    // are not URL segments.
    .filter((name) => !/^[(@_]/.test(name));
}

test("the sitemap carries the fixed public pages and every dynamic address", () => {
  const paths = sitemapPaths(SURFACE);
  for (const path of PUBLIC_STATIC_PATHS) assert.ok(paths.includes(path), `missing ${path}`);
  assert.ok(paths.includes("/repository/bell-state"));
  assert.ok(paths.includes("/repository/layers/algorithms"));
  assert.ok(paths.includes("/repository/papers/arxiv-cond~mat_0010440"));
  assert.equal(paths.length, PUBLIC_STATIC_PATHS.length + 5);
});

test("a paper slug's unreserved characters survive unescaped", () => {
  // `paperSlug` maps `/`→`_` and `_`→`~`, so a slug must reach the sitemap
  // byte-for-byte or `paperIdFromSlug` cannot invert what the sitemap published.
  // `%7E` would still resolve, but the address in the sitemap would stop
  // matching the address every page links to, which is what a sitemap is for.
  const paths = sitemapPaths({ entrySlugs: [], layerIds: [], paperSlugs: ["arxiv-cond~mat_0010440"] });
  assert.ok(paths.includes("/repository/papers/arxiv-cond~mat_0010440"));
});

test("one address is listed once", () => {
  // A node id and a state id share /repository/layers/<id>; validateLayerGraph
  // refuses a collision, but this file does not get to rely on that.
  const paths = sitemapPaths({ entrySlugs: [], layerIds: ["algorithms", "algorithms"], paperSlugs: [] });
  assert.equal(paths.filter((path) => path === "/repository/layers/algorithms").length, 1);
});

test("nothing published is also disallowed", () => {
  for (const path of sitemapPaths(SURFACE)) {
    const blocked = CRAWLER_DISALLOWED_PATHS.find((prefix) => path.startsWith(prefix));
    assert.equal(blocked, undefined, `${path} is in the sitemap and disallowed by ${blocked}`);
  }
});

/**
 * The disallow list is a hand-written mirror of "not in middleware.ts's
 * PUBLIC_PATHS". A mirror nobody checks is the failure this repo keeps finding,
 * so every top-level route segment under app/ must be accounted for by one of
 * the three lists — a new signed-in page cannot land without this test naming it.
 */
test("every top-level app route is published, aliased, or disallowed", () => {
  const segments = routeSegments(new URL("../app/", import.meta.url));
  assert.ok(segments.length > 5, "found almost no routes under app/ — this guard checked nothing");
  const unaccounted = segments.filter((name) => {
    const path = `/${name}`;
    if (PUBLIC_STATIC_PATHS.some((page) => page === path || page.startsWith(`${path}/`))) return false;
    if (PUBLIC_REDIRECT_ALIASES.includes(path)) return false;
    // Public, crawlable, and not a page — see MACHINE_READABLE_PATHS.
    if (MACHINE_READABLE_PATHS.includes(path)) return false;
    return !CRAWLER_DISALLOWED_PATHS.some((prefix) => prefix === path || prefix === `${path}/`);
  });
  assert.deepEqual(unaccounted, [], `route segments in none of the three lists: ${unaccounted.join(", ")}`);
});

/**
 * The fourth list is an exemption from the census above, so it needs its own
 * fence — otherwise "add it to MACHINE_READABLE_PATHS" becomes the way any new
 * route escapes being classified, which is exactly the failure the census
 * exists to catch.
 */
test("a machine-readable path is genuinely public, and genuinely not a page", () => {
  assert.ok(MACHINE_READABLE_PATHS.length > 0, "nothing to check");
  for (const path of MACHINE_READABLE_PATHS) {
    // Being read is the point, so it must not be blocked.
    const blocked = CRAWLER_DISALLOWED_PATHS.find(
      (prefix) => path === prefix || path.startsWith(prefix),
    );
    assert.equal(blocked, undefined, `${path} is machine-readable but robots.txt disallows ${blocked}`);

    // It is not a page, so it must not be advertised as one.
    assert.ok(
      !sitemapPaths(SURFACE).includes(path),
      `${path} is in the sitemap; a sitemap lists pages to index, not descriptors`,
    );
    assert.ok(
      !PUBLIC_STATIC_PATHS.includes(path),
      `${path} is in PUBLIC_STATIC_PATHS, which would publish it in the sitemap`,
    );
    assert.ok(
      !PUBLIC_REDIRECT_ALIASES.includes(path),
      `${path} cannot be both a machine-readable endpoint and a redirect alias`,
    );

    // A file extension is what makes these recognisable as not-a-page. If a
    // bare path ever lands here it is probably an ordinary route that someone
    // routed around the census rather than classifying.
    assert.match(
      path,
      /^\/[a-z0-9-]+\.[a-z]{2,4}$/,
      `${path} does not look like a machine-readable file endpoint`,
    );
  }
});

/** The `(app)` group's own pages are URL segments even though its folder is not. */
test("the authenticated app group's pages are all disallowed", () => {
  const segments = routeSegments(new URL("../app/(app)/", import.meta.url));
  assert.ok(segments.length > 0, "found no pages under app/(app) — this guard checked nothing");
  for (const name of segments) {
    assert.ok(
      CRAWLER_DISALLOWED_PATHS.some((prefix) => prefix === `/${name}` || prefix === `/${name}/`),
      `/${name} is behind the auth gate but robots.txt does not disallow it`,
    );
  }
});

test("the canonical origin prefers configuration over the literal", () => {
  assert.equal(
    canonicalOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://preview.example.com/auth/callback" }),
    "https://preview.example.com",
  );
  assert.equal(canonicalOrigin({}), PRODUCTION_ORIGIN);
});

/**
 * The middleware excludes these three paths from the auth gate. Until this
 * change they were exclusions for files that did not exist — the gate was
 * protecting three 404s. If a rename separates the two again the symptom is a
 * sitemap that redirects to sign-in, which no gate here would notice.
 */
test("the middleware's metadata exclusions name routes that now exist", () => {
  const middleware = readFileSync(fileURLToPath(new URL("../middleware.ts", import.meta.url)), "utf8");
  for (const name of ["sitemap.xml", "robots.txt", "manifest.webmanifest"]) {
    assert.ok(middleware.includes(name), `middleware no longer excludes ${name} from the auth gate`);
  }
  for (const file of ["sitemap.ts", "robots.ts", "manifest.ts"]) {
    readFileSync(fileURLToPath(new URL(`../app/${file}`, import.meta.url)), "utf8");
  }
});
