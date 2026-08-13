import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { isRoutedPath, ROUTED_SEGMENTS } from "./routed-paths.ts";

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
      // A dynamic segment at the ROOT would make "which paths are routed?"
      // unanswerable without loading data — every unknown URL would match it.
      // None exists today; fail loudly rather than silently mis-answer.
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
  assert.equal(isRoutedPath("/pricing"), true);
  assert.equal(isRoutedPath("/pricing/"), true);
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

test("a routed segment is a whole segment, not a prefix", () => {
  // "/runner" must not ride in on "/run", and "/api-docs" must not ride in on
  // "/api" — a startsWith() check would gate both and 307 them to WorkOS.
  assert.equal(isRoutedPath("/runner"), false);
  assert.equal(isRoutedPath("/api-docs"), false);
  assert.equal(isRoutedPath("/repositories"), false);
});
