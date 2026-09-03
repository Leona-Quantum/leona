/**
 * Proves `lib/public-page-metadata.ts` actually varies by locale, rather than
 * trusting the ternaries by eye.
 *
 * Every assertion below calls the real exported functions with `"en"` and
 * `"ja"` and checks the ACTUAL return value — not source text — so a broken
 * locale check (a swapped `===`, a dropped branch, an English string pasted
 * into the `ja` return) fails one of these rather than only being visible on
 * a live deploy. `page.tsx` cannot be exercised this way at all: its imports
 * are extensionless and it renders JSX, both fatal to `node --test` (see the
 * header of the file under test).
 */
import assert from "node:assert/strict";
import test from "node:test";

import { canonicalMetadata, OG_IMAGE } from "./public-metadata.ts";
import {
  aboutMetadataCopy,
  contactMetadataCopy,
  homeMetadataCopy,
  pricingMetadataCopy,
  privacyMetadataCopy,
  termsMetadataCopy,
  workspaceMetadataCopy,
} from "./public-page-metadata.ts";
import { ABOUT_COPY } from "./about-copy.ts";
import { CONTACT_COPY, HOME_COPY, PRICING_COPY, PRIVACY_COPY, TERMS_COPY, WORKSPACE_LANDING_COPY } from "./public-copy.ts";
import { PUBLIC_SHELL_COPY } from "./public-locale.ts";

/** Any character from a Japanese script — hiragana, katakana, or a CJK ideograph. */
const JAPANESE_CHARACTER = /[぀-ヿ一-龯]/;

/**
 * A page's title cannot say the brand twice once the root layout's
 * `"%s · Leona Quantum"` template wraps it — the exact regression
 * `public-title.test.ts` is pinned against for the English titles that still
 * live directly in `page.tsx`. Checked again here because these six pages now
 * carry a SECOND literal title apiece (the Japanese one), which that file's
 * source-text scan cannot see — the Japanese branch below is never a string
 * literal in `public-page-metadata.ts`, it is a reference into a copy table,
 * so a regex over that file finds nothing to check.
 */
function assertTitleDoesNotDoubleTheBrand(title: string | undefined, label: string) {
  if (title === undefined) return;
  assert.ok(!title.includes("Leona Quantum"), `${label} would compose to the brand twice: "${title} · Leona Quantum"`);
}

/**
 * `{ ...pageCopy(locale), ...canonicalMetadata(path) }` — the exact
 * composition every converted page's `generateMetadata` does. Run here
 * rather than trusted from `public-metadata.test.ts` alone: that file proves
 * `canonicalMetadata()` carries `openGraph.images` for an arbitrary path, but
 * not that spreading a page's locale copy IN FRONT of it leaves that intact.
 * `openGraph` is merged as a whole object by Next (see `public-metadata.ts`),
 * so a page copy function that ever started returning its own `openGraph`
 * would silently drop the share-card image again — this is the check that
 * would catch it.
 */
function assertShareCardSurvives(copy: ReturnType<typeof contactMetadataCopy>, path: string) {
  const composed = { ...copy, ...canonicalMetadata(path) };
  const images = composed.openGraph && "images" in composed.openGraph ? composed.openGraph.images : undefined;
  assert.deepEqual(images, [OG_IMAGE], `${path}: openGraph.images did not survive composing the locale copy in`);
}

test("home: english inherits the root layout's title, japanese states its own", () => {
  const en = homeMetadataCopy("en");
  const ja = homeMetadataCopy("ja");
  assert.equal(en.title, undefined, "english home title should stay absent so it inherits the root layout's default");
  assert.equal(en.description, "Generate, run, and use quantum circuits with AI in one platform.");
  assert.equal(ja.title, HOME_COPY.ja.hero.title.replace("\n", ""));
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? ""), "japanese home title does not look Japanese");
  assert.equal(ja.description, HOME_COPY.ja.hero.lede);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "home (ja)");
  assertShareCardSurvives(en, "/");
  assertShareCardSurvives(ja, "/");
});

test("about: locale actually selects ABOUT_COPY.ja / the japanese nav label", () => {
  const en = aboutMetadataCopy("en");
  const ja = aboutMetadataCopy("ja");
  assert.equal(en.title, "About");
  assert.equal(
    en.description,
    "Meet the team building Leona Quantum and the mission behind its next-generation quantum operating system.",
  );
  assert.equal(ja.title, PUBLIC_SHELL_COPY.ja.nav.about);
  assert.equal(ja.description, ABOUT_COPY.ja.hero.body);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "about (ja)");
  assertShareCardSurvives(en, "/about");
  assertShareCardSurvives(ja, "/about");
});

test("contact: locale actually selects CONTACT_COPY.ja, not just some Japanese text", () => {
  const en = contactMetadataCopy("en");
  const ja = contactMetadataCopy("ja");
  assert.equal(en.title, "Contact");
  assert.equal(en.description, "Contact Leona Quantum about research workflows and early product access.");
  assert.equal(ja.title, CONTACT_COPY.ja.overline);
  assert.equal(ja.description, CONTACT_COPY.ja.body);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "contact (ja)");
  assertShareCardSurvives(en, "/contact");
  assertShareCardSurvives(ja, "/contact");
});

test("pricing: locale actually selects PRICING_COPY.ja / the japanese nav label", () => {
  const en = pricingMetadataCopy("en");
  const ja = pricingMetadataCopy("ja");
  assert.equal(en.title, "Pricing");
  assert.equal(en.description, "Early-access Leona Quantum plans for individual researchers and teams.");
  assert.equal(ja.title, PUBLIC_SHELL_COPY.ja.nav.pricing);
  assert.equal(ja.description, PRICING_COPY.ja.hero.body);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "pricing (ja)");
  assertShareCardSurvives(en, "/pricing");
  assertShareCardSurvives(ja, "/pricing");
});

test("privacy: locale actually selects PRIVACY_COPY.ja", () => {
  const en = privacyMetadataCopy("en");
  const ja = privacyMetadataCopy("ja");
  assert.equal(en.title, "Privacy policy");
  assert.equal(en.description, "Leona Quantum privacy policy for the early-access product and public website.");
  assert.equal(ja.title, PRIVACY_COPY.ja.title);
  assert.equal(ja.description, PRIVACY_COPY.ja.lede);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "privacy (ja)");
  assertShareCardSurvives(en, "/privacy");
  assertShareCardSurvives(ja, "/privacy");
});

test("terms: locale actually selects TERMS_COPY.ja", () => {
  const en = termsMetadataCopy("en");
  const ja = termsMetadataCopy("ja");
  assert.equal(en.title, "Terms of service");
  assert.equal(en.description, "Leona Quantum early-access terms for the public website and product.");
  assert.equal(ja.title, TERMS_COPY.ja.title);
  assert.equal(ja.description, TERMS_COPY.ja.lede);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "terms (ja)");
  assertShareCardSurvives(en, "/terms");
  assertShareCardSurvives(ja, "/terms");
});

test("workspace: locale actually selects WORKSPACE_LANDING_COPY.ja / the japanese nav label", () => {
  const en = workspaceMetadataCopy("en");
  const ja = workspaceMetadataCopy("ja");
  assert.equal(en.title, "Workspace");
  assert.equal(
    en.description,
    "Leona Quantum's personal quantum workspace for guided development, Studio, and verified artifacts.",
  );
  assert.equal(ja.title, PUBLIC_SHELL_COPY.ja.nav.workspace);
  assert.equal(ja.description, WORKSPACE_LANDING_COPY.ja.body);
  assert.ok(JAPANESE_CHARACTER.test(ja.title ?? "") && JAPANESE_CHARACTER.test(ja.description ?? ""));
  assert.notEqual(ja.title, en.title);
  assert.notEqual(ja.description, en.description);
  assertTitleDoesNotDoubleTheBrand(ja.title, "workspace (ja)");
  assertShareCardSurvives(en, "/workspace");
  assertShareCardSurvives(ja, "/workspace");
});

test("an unrecognised locale value falls back to english, same as the page body does", () => {
  // `PublicLocale` is typed as `"en" | "ja"`, so nothing in this file's own
  // type checking can pass a third value — but every caller reaches these
  // functions through `parsePublicLocale()`, which coerces anything that is
  // not literally "ja" to "en" (`public-locale.ts`). Casting past the type is
  // what proves the runtime `=== "ja"` check — not the type system — is what
  // decides the branch, which is the exact thing a careless refactor could
  // quietly change (e.g. `locale !== "en"`, true for "ja" today and for
  // anything else tomorrow).
  const bogus = "fr" as unknown as Parameters<typeof contactMetadataCopy>[0];
  assert.equal(contactMetadataCopy(bogus).title, "Contact");
});
