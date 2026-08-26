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
//
// The template itself is now a NAMED CONSTANT rather than a literal, because
// `components/not-found-standalone.tsx` has to compose the same title by hand —
// the document Next synthesises for an in-segment `notFound()` never passes
// through `generateMetadata`, so no template is applied to it. Two files
// spelling out "· Leona Quantum" is two places to forget when the brand changes,
// and it has changed once already. `rootTitle()` below resolves either form, and
// the guard fails loudly rather than going quiet if it can resolve neither —
// which is what it did when the literal first became a constant.
//
// Six `[locale]` pages (home, contact, pricing, privacy, terms, workspace)
// no longer declare `export const metadata` directly — their titles moved to
// `lib/public-page-metadata.ts` so a Japanese branch could be added and
// exercised by `node --test` (see that file's header). This file's scan
// follows them there: `declaredTitlesInMetadataLib()` below plays the same
// role for that one file that `declaredTitle()` plays for each `page.tsx`.
import assert from "node:assert/strict";
import test from "node:test";
import { siteTitle, TITLE_TEMPLATE } from "./public-metadata.ts";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `template` and `default` from the root metadata, as written.
 *
 * Read from `components/root-document.tsx`, not `app/layout.tsx`, since
 * ai-ops issue 151: there is no single root layout any more. Each top-level
 * segment has its own and they all re-export `rootMetadata` from that one
 * module, so it is still exactly one declaration this guard has to find — and
 * if it ever stops being one, the `assert.ok`s below go off rather than the
 * scan quietly reading a file that no longer decides anything.
 */
function rootTitle(): { template: string; fallback: string } {
  const source = readFileSync(join(WEB_ROOT, "components", "root-document.tsx"), "utf8");
  const literal = /template:\s*"([^"]+)"/.exec(source)?.[1];
  const named = /template:\s*([A-Za-z_$][\w$]*)\s*,/.exec(source)?.[1];
  assert.ok(
    literal || named,
    "the root metadata declares a title template that is neither a string literal nor a bare " +
      "identifier — this guard cannot read it and would otherwise pass on every page silently",
  );
  if (named) {
    assert.equal(
      named,
      "TITLE_TEMPLATE",
      `the root title template is now the identifier ${named}, which this guard cannot resolve. ` +
        "Import it here beside TITLE_TEMPLATE rather than leaving the guard reading nothing.",
    );
  }
  const template = literal ?? TITLE_TEMPLATE;
  const fallback = /default:\s*"([^"]+)"/.exec(source)?.[1];
  assert.ok(template, "the root metadata no longer declares a title template — this guard is inert");
  assert.ok(fallback, "the root metadata no longer declares a default title");
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

/**
 * Every literal `title: "..."` in `lib/public-page-metadata.ts` — the
 * English branch of each of the six pages named above. A plain global scan is
 * enough (no block-extraction needed, unlike `declaredTitle()`): each page's
 * Japanese branch there is a reference into a copy table (`CONTACT_COPY.ja
 * .overline`, …), never a string literal, so this regex cannot see it and
 * does not need to skip it. The Japanese side is checked for the same
 * property directly in `public-page-metadata.test.ts`, against the real
 * return value rather than source text.
 */
function declaredTitlesInMetadataLib(): string[] {
  const source = readFileSync(join(WEB_ROOT, "lib", "public-page-metadata.ts"), "utf8");
  const withoutComments = source.replace(/\/\/[^\n]*/g, "");
  return [...withoutComments.matchAll(/title:\s*"([^"]+)"/g)].map((match) => match[1]);
}

test("the guard can see the pages it claims to guard", () => {
  // A walk that found nothing, or a template regex that stopped matching, would
  // make every assertion below vacuously true.
  const pages = pageFiles(join(WEB_ROOT, "app"));
  assert.ok(pages.length >= 10, `found only ${pages.length} page.tsx files — the walk is broken`);
  const titled = pages.filter((file) => declaredTitle(file) !== null);
  const titledInLib = declaredTitlesInMetadataLib();
  assert.ok(
    titled.length + titledInLib.length >= 4,
    `only ${titled.length} page.tsx titles and ${titledInLib.length} in public-page-metadata.ts`,
  );
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
  for (const title of declaredTitlesInMetadataLib()) {
    const composed = template.replace("%s", title);
    const occurrences = composed.split(brand).length - 1;
    if (occurrences > 1) offenders.push(`lib/public-page-metadata.ts -> "${composed}"`);
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
  //
  // This only proves `page.tsx` itself declares nothing — which is still true
  // after the move to `generateMetadata` — not that `homeMetadataCopy()` never
  // will. The English branch of that function is checked directly in
  // `public-page-metadata.test.ts` ("home: english inherits the root layout's
  // title…"); this test would not catch a regression introduced there.
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


test("the hand-composed title matches the template every other page is given", () => {
  // `components/not-found-standalone.tsx` writes `document.title` itself, with
  // `siteTitle()`, because the error document Next synthesises for an in-segment
  // `notFound()` is never handed to `generateMetadata` and so never has the
  // template applied. That makes it the one title in the app composed by a
  // second mechanism — so the two mechanisms are pinned to each other here
  // rather than trusted to stay equal.
  const { template } = rootTitle();
  for (const page of ["Pricing", "This page does not exist.", "このページは存在しません。"]) {
    assert.equal(
      siteTitle(page),
      template.replace("%s", page),
      `siteTitle(${JSON.stringify(page)}) no longer agrees with the root title template. ` +
        "The 404's tab title would read differently from every other page's.",
    );
  }
});
