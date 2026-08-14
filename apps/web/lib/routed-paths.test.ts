import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isRoutedPath, LOCALE_ROUTES, ROUTED_SEGMENTS } from "./routed-paths.ts";

const APP_DIR = fileURLToPath(new URL("../app/", import.meta.url));
const ROUTE_FILES = new Set(["page.tsx", "page.ts", "page.jsx", "page.js", "route.ts", "route.tsx", "route.js"]);

/** Does anything under `dir` actually answer a request? */
function servesARoute(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isFile() && ROUTE_FILES.has(entry.name)) return true;
    if (entry.isDirectory() && servesARoute(join(dir, entry.name))) return true;
  }
  return false;
}

/**
 * The first URL segment of every route the App Router serves, read off the
 * filesystem rather than off a second hand-written list — the whole point is to
 * catch the day the two disagree.
 */
function segmentsOnDisk(): Set<string> {
  const found = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const { name } = entry;
      // `@slot` is a parallel route and `_private` is not routable; neither
      // contributes a URL segment.
      if (name.startsWith("@") || name.startsWith("_")) continue;
      // A route group is transparent in the URL, so its children are the
      // top-level segments.
      if (name.startsWith("(") && name.endsWith(")")) {
        walk(join(dir, name));
        continue;
      }
      // `[locale]` is the ONE root-level dynamic segment, and it is allowed on
      // three conditions that the tests below check rather than assume:
      //
      //   1. Its pages set `dynamicParams = false`, so it answers only to the
      //      locales in `generateStaticParams`. Without that it would match
      //      every unknown URL and serve the home page instead of a 404 —
      //      undoing #527, which exists because mistyped URLs used to land on
      //      api.workos.com.
      //   2. Nothing reaches it by URL. `middleware.ts` rewrites `/pricing`
      //      into it and 308s `/en/pricing` back out, so `[locale]` contributes
      //      no top-level segment a visitor can type, and `isRoutedPath()` is
      //      never asked to classify one.
      //   3. Every path it serves is declared in LOCALE_ROUTES, which is what
      //      the middleware rewrites and therefore what is published.
      //
      // Any OTHER root-level dynamic segment still fails here, because the
      // reasoning above is specific to this one.
      if (name === "[locale]") continue;
      assert.ok(
        !name.startsWith("[") && !name.startsWith("."),
        `app/${name} is a root-level dynamic or hidden segment; isRoutedPath() cannot classify it. Rethink the fall-through before adding one.`,
      );
      if (servesARoute(join(dir, name))) found.add(name);
    }
  };
  walk(APP_DIR);
  return found;
}

test("the routed-segment list is exactly what app/ serves", () => {
  // Both directions matter and they fail differently. A segment on disk that is
  // missing from the list is a page served with NO auth gate at all — the
  // middleware would hand it straight to Next. A segment in the list with no
  // route on disk sends a 404 back through the gate, which is where the
  // "mistyped URL lands on api.workos.com" bug came from in the first place.
  const onDisk = [...segmentsOnDisk()].sort();
  assert.deepEqual([...ROUTED_SEGMENTS].sort(), onDisk);
});

test("paths inside the app are routed, including ones that will 404 deeper down", () => {
  assert.equal(isRoutedPath("/"), true);
  // /pricing and its siblings moved under app/[locale]/ and are answered by the
  // middleware rewrite before this function is consulted; see LOCALE_ROUTES.
  assert.equal(isRoutedPath("/repository"), true);
  // /repository/<slug> stays behind the repository gate; whether that slug
  // exists is the page's question, not the middleware's.
  assert.equal(isRoutedPath("/repository/nonexistent-slug-xyz"), true);
  assert.equal(isRoutedPath("/api/me"), true);
  assert.equal(isRoutedPath("/run/abc-123"), true);
});

test("the URLs a visitor guesses are not routed", () => {
  // Every one of these 307'd to api.workos.com's sign-in screen before the
  // fall-through existed. They are plausible guesses at this site's own nouns,
  // which is exactly who ends up on them.
  for (const path of ["/zzz-nonexistent-31047", "/map", "/atlas", "/methods", "/papers", "/vault"]) {
    assert.equal(isRoutedPath(path), false, `${path} should fall through to the 404`);
  }
});

/** What `app/[locale]/` actually serves, as clean paths. */
function localeRoutesOnDisk(): string[] {
  const dir = join(APP_DIR, "[locale]");
  const found = ["/"];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
    if (servesARoute(join(dir, entry.name))) found.push(`/${entry.name}`);
  }
  return found.sort();
}

test("LOCALE_ROUTES is exactly what app/[locale]/ serves", () => {
  // Both directions are a real failure and they differ.
  //
  // On disk but not in the list: the page exists at `/en/x` only, the clean
  // `/x` is never rewritten to it, and `isRoutedPath("/x")` says false — so a
  // reader following the site's own nav gets a 404 on a page that was built.
  //
  // In the list but not on disk: middleware rewrites `/x` to `/en/x`, which
  // matches nothing, and the visitor gets a 404 from a path the middleware
  // asserts is public. Worse, the rewrite returns BEFORE the auth gate, so the
  // entry is a standing declaration that something is public with nothing
  // behind it to check that claim.
  assert.deepEqual([...LOCALE_ROUTES].sort(), localeRoutesOnDisk());
});

test("nothing served from [locale] is also claimed as a routed segment", () => {
  // The two lists answer different questions and must not overlap: a path in
  // LOCALE_ROUTES is answered by the rewrite and never reaches isRoutedPath(),
  // so a segment claiming to be routed as well would be dead weight that also
  // reads as a second, contradictory declaration of where that path lives.
  for (const route of LOCALE_ROUTES) {
    if (route === "/") continue;
    assert.equal(
      ROUTED_SEGMENTS.includes(route.slice(1)),
      false,
      `${route} is rewritten into app/[locale]/ and must not also be a ROUTED_SEGMENT`,
    );
  }
});

test("a mistyped URL still falls through to the site's own 404", () => {
  // The hazard `[locale]` introduces: a root-level dynamic segment matches any
  // single-segment path. `dynamicParams = false` on the pages is what stops it
  // from answering — this asserts the middleware half, that isRoutedPath() has
  // not quietly started claiming these.
  for (const path of ["/fr", "/de", "/zh", "/pricing-page", "/en-us"]) {
    assert.equal(isRoutedPath(path), false, `${path} should fall through to the 404`);
  }
});

test("a routed segment is a whole segment, not a prefix", () => {
  // "/runner" must not ride in on "/run", and "/api-docs" must not ride in on
  // "/api" — a startsWith() check would gate both and 307 them to WorkOS.
  assert.equal(isRoutedPath("/runner"), false);
  assert.equal(isRoutedPath("/api-docs"), false);
  assert.equal(isRoutedPath("/repositories"), false);
});
