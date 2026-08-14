import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isRoutedPath, LOCALE_PREFIX_ROUTES, localePrefixRoute, LOCALE_ROUTES, ROUTED_SEGMENTS } from "./routed-paths.ts";

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
      //      undoing the mistyped-URL fix, which exists because those URLs used to land on
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
  // The bare `/repository` path joined them, and in production is answered the
  // same way before this function ever sees it — but unlike pricing's segment,
  // "repository" stays a ROUTED_SEGMENT (below) for everything under it, so
  // this function's own answer for the exact string "/repository" is still,
  // correctly, `true`. The two facts describe different things and do not
  // conflict; see the "nothing served from [locale]..." test for why this one
  // is exempted from the usual either/or.
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

/**
 * The first segment under `app/[locale]/` that is served by a PREFIX entry
 * rather than an exact one — `repository`, today.
 *
 * Derived from LOCALE_PREFIX_ROUTES rather than hardcoded, so adding a prefix
 * subtree under a new first segment cannot silently disappear from the exact
 * list's accounting below.
 */
const PREFIX_FIRST_SEGMENTS = new Set(
  LOCALE_PREFIX_ROUTES.map((route) => route.split("/")[1]).filter((segment) => segment !== ""),
);

/**
 * What `app/[locale]/` serves at the top level, as clean paths, excluding the
 * prefix subtrees.
 *
 * A prefix-owned segment ("repository") is not simply skipped: it can ALSO
 * carry an exact route of its own, at its own root, through a route group
 * (a parenthesized directory, transparent in the URL). `/repository` is that
 * case — `app/[locale]/repository/(browse)/page.tsx` resolves to `/repository`
 * itself, distinct from the `layers/`/`claims/` subtrees `localePrefixRoutesOnDisk()`
 * below already accounts for. Only route-group children are looked at here,
 * never a plain named subdirectory, so a page added under `layers/` or
 * `claims/` cannot silently start counting as an exact route too.
 */
function localeRoutesOnDisk(): string[] {
  const dir = join(APP_DIR, "[locale]");
  const found = ["/"];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
    if (PREFIX_FIRST_SEGMENTS.has(entry.name)) {
      const segmentDir = join(dir, entry.name);
      for (const child of readdirSync(segmentDir, { withFileTypes: true })) {
        if (!child.isDirectory()) continue;
        if (!(child.name.startsWith("(") && child.name.endsWith(")"))) continue;
        if (servesARoute(join(segmentDir, child.name))) found.push(`/${entry.name}`);
      }
      continue;
    }
    if (servesARoute(join(dir, entry.name))) found.push(`/${entry.name}`);
  }
  return found.sort();
}

/**
 * The Atlas subtrees actually on disk under `app/[locale]/repository/`, as
 * clean paths.
 *
 * `[id]` and friends are not walked into: LOCALE_PREFIX_ROUTES names subtrees,
 * and a dynamic child is part of the subtree its parent declares.
 *
 * A route-group child — `(browse)`, today — is skipped here rather than
 * counted as a named subtree. It contributes no URL segment of its own, so
 * `/repository/(browse)` is not a real path; it is `localeRoutesOnDisk()`'s
 * job to find it, as the exact `/repository` entry.
 */
function localePrefixRoutesOnDisk(): string[] {
  const found: string[] = [];
  for (const segment of PREFIX_FIRST_SEGMENTS) {
    const dir = join(APP_DIR, "[locale]", segment);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith("@") || entry.name.startsWith("_")) continue;
      if (entry.name.startsWith("(") && entry.name.endsWith(")")) continue;
      if (servesARoute(join(dir, entry.name))) found.push(`/${segment}/${entry.name}`);
    }
  }
  return found.sort();
}

test("LOCALE_PREFIX_ROUTES is exactly what app/[locale]/repository/ serves", () => {
  // The same two-directional check as the exact list, with one extra failure
  // mode that is specific to this list and worth naming.
  //
  // `app/repository/` still exists — `/repository` and `/repository/<slug>` live
  // there because both call `getMajoranaAuth()` and must stay personalized — and
  // it still has a `[slug]` segment. So a subtree that is on disk under
  // `app/[locale]/repository/` but MISSING from this list is not a 404 at the
  // middleware: the request falls through unrewritten, `[slug]` matches it, the
  // catalogue is asked for a record named "layers", and the reader gets the
  // Atlas's own 404 page. Right answer, wrong reason, no error anywhere.
  assert.deepEqual([...LOCALE_PREFIX_ROUTES].sort(), localePrefixRoutesOnDisk());
});

test("the prefix matcher takes descendants and not lookalikes", () => {
  for (const route of LOCALE_PREFIX_ROUTES) {
    assert.equal(localePrefixRoute(route), route, `${route} should match itself`);
    assert.equal(localePrefixRoute(`${route}/child`), route, `${route}/child should match`);
    assert.equal(localePrefixRoute(`${route}/a/b/c`), route, `${route}/a/b/c should match`);
    // A bare startsWith would rewrite this into a route that does not exist
    // while telling the auth gate the path had been handled.
    assert.equal(localePrefixRoute(`${route}extra`), null, `${route}extra must not match`);
  }
  // `/repository` itself IS locale-rewritten now (LOCALE_ROUTES, exact) — it
  // must still be null HERE, from the PREFIX matcher, because prefix matching
  // is startsWith-shaped and would treat every entry page below it as a
  // "descendant" of `/repository` and rewrite those too. Exact vs prefix is
  // the whole reason `/repository` lives in the other list.
  assert.equal(localePrefixRoute("/repository"), null, "/repository is an exact LOCALE_ROUTES entry, not a prefix");
  assert.equal(localePrefixRoute("/repository/some-record-slug"), null, "an entry page stays in app/repository/");
});

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
  //
  // `/repository` is the one deliberate exception. Unlike the other entries —
  // each of which moved WHOLESALE to app/[locale]/, leaving nothing behind for
  // ROUTED_SEGMENTS to legitimately claim — "repository" still has to stay a
  // ROUTED_SEGMENT for everything below the exact root: `/repository/<slug>`,
  // `/repository/papers`, `/repository/folders` are all still served from
  // app/repository/ and still need the auth gate. Only the bare `/repository`
  // path is answered by the rewrite; isRoutedPath("/repository") is never
  // consulted for it in practice, and its result would still be `true` if it
  // were — the two are not in conflict, they are both true about different
  // things, which is why this is a skip and not a second exception list.
  for (const route of LOCALE_ROUTES) {
    if (route === "/" || route === "/repository") continue;
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
