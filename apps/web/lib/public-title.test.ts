// No page's browser-tab title may say the brand twice.
//
// The root layout declares `template: "%s · Leona Quantum"`, so every segment
// title is composed with the brand appended. That is right for a section name
// ("Pricing · Leona Quantum") and wrong for any title that already contains the
// brand — and the home page did exactly that, shipping
// **"Leona Quantum · Leona Quantum"** to every tab, bookmark and search result.
//
// It is asserted here rather than eyeballed because the two halves live in
// different files: the template is in `app/layout.tsx` and the offending title
// was in `app/[locale]/page.tsx`. Neither file is wrong on its own reading, and
// nothing in a type check or a render composes them.
//
// Read from source rather than from Next's metadata resolution: importing a
// page module drags its whole component tree in, and the thing under test is a
// string-composition rule, not a render.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `template` and `default` from the root layout's metadata, as written. */
function rootTitle(): { template: string; fallback: string } {
  const source = readFileSync(join(WEB_ROOT, "app", "layout.tsx"), "utf8");
  const template = /template:\s*"([^"]+)"/.exec(source)?.[1];
  const fallback = /default:\s*"([^"]+)"/.exec(source)?.[1];
  assert.ok(template, "the root layout no longer declares a title template — this guard is inert");
  assert.ok(fallback, "the root layout no longer declares a default title");
  assert.ok(template.includes("%s"), `the title template has no %s placeholder: ${template}`);
  return { template, fallback };
}

/** Every `page.tsx` under app/, so a new route cannot skip this by being new. */
function pageFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pageFiles(full, found);
    else if (entry === "page.tsx") found.push(full);
  }
  return found;
}

/** The literal `title:` a page declares, if it declares a plain string one. */
function declaredTitle(file: string): string | null {
  const source = readFileSync(file, "utf8");
  // Only a top-level metadata title. A `title` inside JSX or a nested object is
  // not what the tab shows, and matching it would produce false positives.
  const block = /export const metadata\s*:\s*Metadata\s*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1];
  if (!block) return null;
  const withoutComments = block.replace(/\/\/[^\n]*/g, "");
  return /(?:^|\n)\s*title:\s*"([^"]+)"/.exec(withoutComments)?.[1] ?? null;
}

test("the guard can see the pages it claims to guard", () => {
  // A walk that found nothing, or a template regex that stopped matching, would
  // make every assertion below vacuously true.
  const pages = pageFiles(join(WEB_ROOT, "app"));
  assert.ok(pages.length >= 10, `found only ${pages.length} page.tsx files — the walk is broken`);
  const titled = pages.filter((file) => declaredTitle(file) !== null);
  assert.ok(titled.length >= 4, `only ${titled.length} pages declare a literal title`);
});

test("no page's composed title says the brand twice", () => {
  const { template } = rootTitle();
  // "Leona Quantum" out of the template itself, so a rename cannot leave this
  // guard checking a brand the product no longer uses.
  const brand = template.replace("%s", "").replace(/^[\s·|—-]+|[\s·|—-]+$/g, "").trim();
  assert.ok(brand.length > 0, `could not read a brand out of the template: ${template}`);

  const offenders: string[] = [];
  for (const file of pageFiles(join(WEB_ROOT, "app"))) {
    const title = declaredTitle(file);
    if (title === null) continue;
    const composed = template.replace("%s", title);
    // Count occurrences, not "does the title contain the brand": a section
    // legitimately named after part of the brand would still compose to one.
    const occurrences = composed.split(brand).length - 1;
    if (occurrences > 1) offenders.push(`${file.slice(WEB_ROOT.length + 1)} -> "${composed}"`);
  }

  assert.deepEqual(
    offenders,
    [],
    `these pages compose to a title containing "${brand}" more than once. A page whose own ` +
      "subject is the brand should omit `title` and inherit the root layout's `default`, which " +
      "is written to stand alone:\n  " + offenders.join("\n  "),
  );
});

test("the home page inherits the standalone default rather than composing one", () => {
  // The specific regression, pinned by location. The rule above would keep
  // passing if someone re-added `title: "Leona"` — shorter, still wrong.
  const home = join(WEB_ROOT, "app", "[locale]", "page.tsx");
  assert.equal(
    declaredTitle(home),
    null,
    "the home page declares its own title again. The root layout's `default` is the one title " +
      "written to stand alone; a segment title here is composed with the brand appended.",
  );
  const { fallback } = rootTitle();
  assert.ok(fallback.length > 0);
});
