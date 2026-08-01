import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * /account opens as a centred modal, and the only thing that makes that true is
 * that every in-app link to it is a next/link <Link>.
 *
 * Next.js intercepting routes (`app/(app)/@modal/(.)account`) apply to
 * client-side navigations ONLY. A plain `<a href="/account">` is a document
 * load: the interception never runs, the full page renders, and nothing
 * anywhere reports a problem — the screen still shows settings, so the change
 * reads as working while the feature is entirely absent. That is the failure
 * this file exists to catch, because no type, no build and no glance at the
 * screen will.
 *
 * Scope note: this reads static `href="/account…"` attributes. A computed href
 * (`href={somewhere}`) would slip past, as would a link added under a directory
 * outside SCAN_DIRS. Hence the positive control below — a scan that finds
 * nothing has to fail, not pass.
 */

const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "components"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".vercel"]);
// A second local dev server builds to .next-<something>; its generated output
// is not source and must not be scanned. Same convention as scripts/check-*.mjs.
const SKIP_DIR_PREFIX = ".next-";

// The links the product actually has today: Settings and "Usage & limits" in
// the profile drawer, and "View archived chats in settings" on the archive
// banner. If this scan ever finds fewer than three, it has stopped looking at
// the code it was written to guard.
const KNOWN_ENTRY_POINTS = 3;

const ACCOUNT_HREF = /href="\/account(?:[#?][^"]*)?"/g;

function tsxFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stats = statSync(full, { throwIfNoEntry: false });
    if (!stats) continue;
    if (stats.isDirectory()) {
      if (!SKIP_DIRS.has(entry) && !entry.startsWith(SKIP_DIR_PREFIX)) tsxFiles(full, found);
    } else if (entry.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** The JSX tag an attribute belongs to: the nearest `<` before it. */
function owningTag(source: string, attributeIndex: number): string | null {
  const open = source.lastIndexOf("<", attributeIndex);
  if (open === -1) return null;
  return /^<\s*([A-Za-z][\w.]*)/.exec(source.slice(open, attributeIndex))?.[1] ?? null;
}

type EntryPoint = { file: string; line: number; tag: string | null };

function accountEntryPoints(): EntryPoint[] {
  const entries: EntryPoint[] = [];
  for (const dir of SCAN_DIRS) {
    const root = join(WEB_ROOT, dir);
    // Fail closed: a renamed or missing scan root must not read as "clean".
    assert.ok(
      statSync(root, { throwIfNoEntry: false })?.isDirectory(),
      `scan root missing: ${dir}`,
    );
    for (const file of tsxFiles(root)) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(ACCOUNT_HREF)) {
        entries.push({
          file: relative(WEB_ROOT, file).replaceAll("\\", "/"),
          line: source.slice(0, match.index).split("\n").length,
          tag: owningTag(source, match.index),
        });
      }
    }
  }
  return entries;
}

describe("in-app /account entry points", () => {
  it("finds the links it was written to guard", () => {
    // The positive control. Without it every assertion below goes vacuously
    // true the moment the scan stops matching anything.
    assert.ok(
      accountEntryPoints().length >= KNOWN_ENTRY_POINTS,
      `expected at least ${KNOWN_ENTRY_POINTS} /account links under apps/web; the scan is not looking where the code is`,
    );
  });

  it("routes every one of them through next/link", () => {
    const plainAnchors = accountEntryPoints().filter((entry) => entry.tag !== "Link");
    assert.deepEqual(
      plainAnchors,
      [],
      'a plain <a href="/account"> is a document load, so the settings modal never opens — use next/link',
    );
  });

  it("imports Link wherever it uses one", () => {
    const files = new Set(accountEntryPoints().map((entry) => entry.file));
    for (const file of files) {
      const source = readFileSync(join(WEB_ROOT, file), "utf8");
      assert.match(
        source,
        /from "next\/link"/,
        `${file} links to /account but never imports next/link`,
      );
    }
  });
});
