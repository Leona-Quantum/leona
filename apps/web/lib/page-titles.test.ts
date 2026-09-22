import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { UPGRADE_COPY } from "./public-copy.ts";
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

/**
 * Each `title:` and the rest of its line, then every string or template literal in
 * that stretch. Reading the whole expression rather than only a literal right after
 * the colon is what catches `title: locale === "ja" ? "…" : "… · Leona Quantum"`.
 *
 * What a source scan cannot do is evaluate a title that is not written in the page:
 * `entry.title` and `qapp.title` are record data, which never carry the site name,
 * and a title read from a copy constant is checked against the constant itself
 * below. Anything else a page composes at runtime is outside this test.
 */
const TITLE_EXPRESSION = /\btitle:([^\n]*)/g;
const STRING_LITERAL = /"([^"\\]*)"|`([^`\\]*)`/g;

test("no page under a templated layout names the site in its own title", () => {
  const pages = walk(appRoot).filter((file) => /\/page\.tsx$/.test(file));
  assert.ok(pages.length > 20, `found only ${pages.length} pages; the walk is not reading app/`);
  const scanned = pages.filter(templatedFromAbove);
  assert.ok(scanned.length > 10, `only ${scanned.length} pages sit under a templated layout; the ancestor test is broken`);
  const doubled: string[] = [];
  for (const file of scanned) {
    for (const expression of readFileSync(file, "utf8").matchAll(TITLE_EXPRESSION)) {
      for (const literal of expression[1].matchAll(STRING_LITERAL)) {
        const title = (literal[1] ?? literal[2] ?? "").trim();
        if (title.endsWith(SITE_NAME)) doubled.push(`${relative(appRoot, file)}: "${title}"`);
      }
    }
  }
  assert.deepEqual(doubled, [], `these titles would read "… · ${SITE_NAME} · ${SITE_NAME}":\n${doubled.join("\n")}`);
});

test("the upgrade page's title, which comes from a copy constant, does not name the site", () => {
  // `app/(app)/upgrade/page.tsx` is the one page whose metadata title is an
  // identifier, not a literal, so the scan above cannot read it.
  for (const copy of Object.values(UPGRADE_COPY)) {
    assert.ok(!copy.title.trim().endsWith(SITE_NAME), `UPGRADE_COPY title "${copy.title}" names the site`);
  }
});

test("a page in the same segment as its templated layout is not scanned", () => {
  // The rule's other half: `app/q/page.tsx` gets no template from `app/q/layout.tsx`,
  // so it is right for it to name the site. If this starts failing, the ancestor walk
  // has begun counting the page's own segment and would flag correct titles.
  assert.equal(templatedFromAbove(join(appRoot, "q", "page.tsx")), false);
  assert.equal(templatedFromAbove(join(appRoot, "q", "[slug]", "page.tsx")), true);
});
