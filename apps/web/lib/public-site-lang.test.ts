/**
 * Every visitor-facing element `PublicSite` renders carries the resolved
 * locale's `lang`, not the document default.
 *
 * ## Why this is a source scan rather than a render
 *
 * `PublicSite` is an async server component that calls `getMajoranaAuth()`,
 * which reaches `headers()` — a Dynamic API that only resolves inside a real
 * request. It cannot be rendered or even imported under plain
 * `node --experimental-strip-types --test` (the same constraint
 * `public-title.test.ts` and `public-revalidate.test.ts` document for
 * `page.tsx`: extensionless imports and a component tree this harness cannot
 * load). So, following that established convention, this reads the source
 * text directly rather than rendering it.
 *
 * ## What would actually break, and what this catches
 *
 * The fix (`components/public-site.tsx`) is a straight pass-through — no
 * locale branch to invert the way `public-page-metadata.ts`'s ternaries had
 * one. The realistic regression here is someone deleting the `lang` prop
 * during a later edit of that file, or "fixing" a lint complaint by hardcoding
 * `lang="en"` on one of the two `<main>` elements instead of passing the
 * resolved value through. Both are exactly what these assertions check for —
 * verified by deliberately hardcoding `lang="en"` on one `<main>` locally,
 * confirming this suite goes red, then reverting (see the PR description).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE_PATH = fileURLToPath(new URL("../components/public-site.tsx", import.meta.url));

function source(): string {
  return readFileSync(SOURCE_PATH, "utf8");
}

/**
 * Comments stripped first — this file's own JSDoc mentions `<main>` twice in
 * prose (explaining what `chrome="none"` drops, and why `lang` lives here
 * rather than on `<html>`), and a bare scan would count those as elements.
 * Same rule `public-revalidate.test.ts`'s `readsSearchParams()` follows, for
 * the same reason: the detector has to look at what the code does, not at
 * what it says about itself.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Every `<main` opening tag's attribute text, up to its closing `>`. */
function mainTags(text: string): string[] {
  return [...stripComments(text).matchAll(/<main\b([^>]*)>/g)].map((match) => match[1]);
}

test("the guard can see the tags it claims to guard", () => {
  // Two `<main>` elements today: the `chrome="none"` early return and the
  // full/`"static"` chrome return. A count of zero or one would make every
  // assertion below pass vacuously.
  const tags = mainTags(source());
  assert.equal(tags.length, 2, `expected 2 <main> elements in public-site.tsx, found ${tags.length}`);
});

test("every <main> PublicSite renders carries lang={resolvedLocale}", () => {
  const tags = mainTags(source());
  for (const [index, tag] of tags.entries()) {
    assert.match(
      tag,
      /lang=\{resolvedLocale\}/,
      `<main> #${index + 1} in public-site.tsx does not carry lang={resolvedLocale}: <main${tag}>`,
    );
  }
});

test("no <main> hardcodes a literal lang instead of passing the resolved value through", () => {
  // The specific regression this exists to catch: `lang="en"` (or `"ja"`)
  // reads as a fix for ONE locale and is silently wrong for the other —
  // exactly the shape of bug this whole PR is about, one level down.
  for (const tag of mainTags(source())) {
    assert.doesNotMatch(tag, /lang=["'](en|ja)["']/, `a <main> tag hardcodes a literal lang instead of lang={resolvedLocale}: <main${tag}>`);
  }
});

test("resolvedLocale is not a cookie read for a page that passes its own locale prop", () => {
  // The caching half of this fix: `resolvedLocale` must fall back to a cookie
  // read (`getPublicLocale()`) ONLY when no `locale` prop was given — never
  // unconditionally — or every `[locale]` page that already passes `locale`
  // explicitly would gain a needless Dynamic API call. This is the same
  // property the six PR-710 pages rely on already; asserted here because
  // `lang` now reads the same variable.
  assert.match(
    source(),
    /const resolvedLocale = locale \?\? await getPublicLocale\(\);/,
    "resolvedLocale no longer falls back to a cookie read only when no locale prop is given — check both the caching story and lang",
  );
});
