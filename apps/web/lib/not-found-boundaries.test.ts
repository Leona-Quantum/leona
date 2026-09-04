import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * A segment that owns a root layout and can `notFound()` must own the boundary too.
 *
 * Since ai-ops issue 151 there is no `app/layout.tsx`: each top-level segment renders
 * its own `<html>` through `RootDocument`. `app/not-found.tsx` therefore sits
 * above every root layout rather than inside one, and Next synthesises a bare
 * `<html><body>` around it — **no `globals.css`, no fonts**. So a `notFound()`
 * thrown anywhere inside a segment produced a page in browser-default serif with
 * blue underlined links.
 *
 * `global-not-found.tsx` fixed the neighbouring case, a URL matching no segment
 * at all, and was read as fixing this one. Measured on production 2026-08-26,
 * counting `rel="stylesheet"` in the served HTML:
 *
 *     /zzz-nothing-here        404   1 stylesheet   <- global-not-found, fine
 *     /repository/zzz          404   0
 *     /repository/papers/zzz   404   0
 *     /repository/layers/zzz   404   0
 *     /q/zzz                   404   0
 *
 * Every zero is a live Atlas or Qapp URL shape. **A status-code check passes
 * straight through all of them**, which is why nothing caught it for as long as
 * it stood — the page is a correct 404 and a broken one at the same time.
 *
 * The rule this pins is narrow on purpose: only segments that BOTH own a root
 * layout AND contain a dynamic route, because a dynamic route is what calls
 * `notFound()` on an id that does not resolve. A segment with only static
 * children cannot reach the boundary from inside, and its unmatched URLs are
 * `global-not-found.tsx`'s job.
 */

const APP_DIR = fileURLToPath(new URL("../app", import.meta.url));

function hasDynamicRoute(dir: string, depth = 4): boolean {
  if (depth === 0) return false;
  for (const entry of readdirSync(dir)) {
    const child = join(dir, entry);
    if (!statSync(child).isDirectory()) continue;
    if (entry.startsWith("[")) return true;
    if (hasDynamicRoute(child, depth - 1)) return true;
  }
  return false;
}

/**
 * A segment can reach the boundary from inside without owning a dynamic route:
 * `/lab`, `/demo` and `/dev/ui` are static pages that `notFound()` on a feature
 * flag, and on production that flag is off. Greptile caught this on PR 824 —
 * the first version of the rule below asked only about dynamic routes and
 * therefore excluded exactly those three.
 *
 * `not-found.tsx` files are skipped because several of them *describe* the bug
 * in a doc comment, and a boundary is not a caller. A comment elsewhere that
 * mentions `notFound()` will match, which over-covers rather than under-covers:
 * the cost is a boundary file nothing reaches, and the alternative is parsing.
 */
function callsNotFound(dir: string, depth = 4): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (depth > 0 && callsNotFound(child, depth - 1)) return true;
      continue;
    }
    if (entry.name === "not-found.tsx") continue;
    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    if (/\bnotFound\s*\(\s*\)/.test(readFileSync(child, "utf8"))) return true;
  }
  return false;
}

const segmentsOwningARootLayout = readdirSync(APP_DIR)
  .filter((entry) => statSync(join(APP_DIR, entry)).isDirectory())
  .filter((entry) => {
    try {
      return readFileSync(join(APP_DIR, entry, "layout.tsx"), "utf8").includes("RootDocument");
    } catch {
      return false;
    }
  });

test("the rule finds the segments it is about, so an empty list cannot pass it", () => {
  // Without this, deleting every root layout would make the checks below green.
  assert.ok(
    segmentsOwningARootLayout.includes("repository"),
    `expected app/repository to own a root layout; found ${segmentsOwningARootLayout.join(", ")}`,
  );
  assert.ok(segmentsOwningARootLayout.length >= 8, String(segmentsOwningARootLayout.length));
});

test("a segment that owns a root layout and can notFound() owns the boundary too", () => {
  const canReachTheBoundary = segmentsOwningARootLayout.filter(
    (segment) =>
      hasDynamicRoute(join(APP_DIR, segment)) || callsNotFound(join(APP_DIR, segment)),
  );
  assert.ok(
    canReachTheBoundary.length >= 7,
    `expected at least seven; found ${canReachTheBoundary.join(", ")}`,
  );
  const missing = canReachTheBoundary.filter(
    (segment) => !readdirSync(join(APP_DIR, segment)).includes("not-found.tsx"),
  );
  assert.deepEqual(
    missing,
    [],
    `these segments 404 into a boundary with no root layout, so the page they serve ` +
      `has no stylesheet: ${missing.join(", ")}`,
  );
});

test("every not-found boundary renders the one shared body", () => {
  // Two copies of a page's markup drift, and the 404 already had that caught
  // once on review. `NotFoundBody` is the single source; a boundary that
  // stopped using it would be a second 404 nobody is looking at.
  for (const segment of segmentsOwningARootLayout) {
    let source: string;
    try {
      source = readFileSync(join(APP_DIR, segment, "not-found.tsx"), "utf8");
    } catch {
      continue;
    }
    assert.ok(source.includes("NotFoundBody"), `app/${segment}/not-found.tsx`);
  }
});
