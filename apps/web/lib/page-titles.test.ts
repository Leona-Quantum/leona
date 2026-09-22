import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SITE_NAME } from "./public-metadata.ts";

/**
 * A page title must not name the site when a layout above it already will.
 *
 * Every root layout in this app exports `rootMetadata`, whose `title.template`
 * is `"%s · Leona Quantum"`. Next applies a layout's template to the pages in
 * its CHILD segments, not to a page in the layout's own segment. So
 * `app/q/page.tsx` (same segment as `app/q/layout.tsx`) must carry the name
 * itself, while `app/(app)/studio/page.tsx` must not: its "Studio — Leona
 * Quantum" was composed into "Studio — Leona Quantum · Leona Quantum" in the tab,
 * a bookmark and a search result, on every signed-in page and on the public
 * Qapp and embed pages (fixed 2026-09-22).
 *
 * Source-scanned, because the doubling happens in Next's metadata resolution,
 * which no unit test here runs. The scan reads string and template literals
 * after `title:` in each page that has a layout with the template ABOVE its own
 * segment, and fails on any that ends with the site name.
 */

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function layoutUsesTemplate(dir: string): boolean {
  const layout = join(dir, "layout.tsx");
  try {
    return /rootMetadata|TITLE_TEMPLATE/.test(readFileSync(layout, "utf8"));
  } catch {
    return false;
  }
}

/** True when a layout with the template sits in a STRICT ancestor of the page's segment. */
function templatedFromAbove(pageFile: string): boolean {
  let dir = dirname(dirname(pageFile));
  while (dir.startsWith(appRoot)) {
    if (layoutUsesTemplate(dir)) return true;
    if (dir === appRoot) break;
    dir = dirname(dir);
  }
  return false;
}

const TITLE_LITERAL = /title:\s*(?:"([^"]*)"|`([^`]*)`)/g;

test("no page under a templated layout names the site in its own title", () => {
  const pages = walk(appRoot).filter((file) => /\/page\.tsx$/.test(file));
  assert.ok(pages.length > 20, `found only ${pages.length} pages; the walk is not reading app/`);
  const scanned = pages.filter(templatedFromAbove);
  assert.ok(scanned.length > 10, `only ${scanned.length} pages sit under a templated layout; the ancestor test is broken`);
  const doubled: string[] = [];
  for (const file of scanned) {
    for (const match of readFileSync(file, "utf8").matchAll(TITLE_LITERAL)) {
      const title = (match[1] ?? match[2] ?? "").trim();
      if (title.endsWith(SITE_NAME)) doubled.push(`${relative(appRoot, file)}: "${title}"`);
    }
  }
  assert.deepEqual(doubled, [], `these titles would read "… · ${SITE_NAME} · ${SITE_NAME}":\n${doubled.join("\n")}`);
});

test("a page in the same segment as its templated layout is not scanned", () => {
  // The rule's other half: `app/q/page.tsx` gets no template from `app/q/layout.tsx`,
  // so it is right for it to name the site. If this starts failing, the ancestor walk
  // has begun counting the page's own segment and would flag correct titles.
  assert.equal(templatedFromAbove(join(appRoot, "q", "page.tsx")), false);
  assert.equal(templatedFromAbove(join(appRoot, "q", "[slug]", "page.tsx")), true);
});
