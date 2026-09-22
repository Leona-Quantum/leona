import assert from "node:assert/strict";
import test from "node:test";
// Next's own path-to-regexp-backed matcher, the thing `next.config.ts`'s
// `headers()` actually uses to decide whether a `source` matches a request —
// the same reasoning `edge-cache-headers.test.ts` gives for importing
// `matchHas` instead of a hand-written re-implementation: a matcher this file
// wrote itself would agree with `embed-routes.ts` by construction and prove
// nothing about what Next will do with the string.
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match.js";
import { EMBED_QAPP_SOURCES, GENERAL_ANTI_FRAMING_SOURCE } from "./embed-routes.ts";

const generalMatches = getPathMatch(GENERAL_ANTI_FRAMING_SOURCE);
const embedMatchers = EMBED_QAPP_SOURCES.map((source) => getPathMatch(source));

function matchesAnyEmbedSource(pathname: string): boolean {
  return embedMatchers.some((match) => match(pathname) !== false);
}

test("ordinary routes still match the general anti-framing source", () => {
  for (const pathname of ["/", "/q/abc", "/dashboard", "/account", "/repository", "/pricing", "/embed", "/embed/qux", "/embed/quux/more"]) {
    assert.notEqual(generalMatches(pathname), false, `${pathname} should keep the site-wide CSP and X-Frame-Options`);
  }
});

test("the embed subtree does not match the general anti-framing source", () => {
  for (const pathname of ["/embed/q", "/embed/q/", "/embed/q/some-slug", "/embed/q/some-slug/extra"]) {
    assert.equal(generalMatches(pathname), false, `${pathname} must be excluded, or X-Frame-Options: DENY reaches the embed route`);
  }
});

test("the embed sources cover exactly the embed subtree", () => {
  for (const pathname of ["/embed/q", "/embed/q/", "/embed/q/some-slug", "/embed/q/some-slug/extra"]) {
    assert.ok(matchesAnyEmbedSource(pathname), `${pathname} should be covered by EMBED_QAPP_SOURCES`);
  }
  for (const pathname of ["/embed", "/embed/qux", "/q/some-slug", "/"]) {
    assert.equal(matchesAnyEmbedSource(pathname), false, `${pathname} is not the embed route and must not match`);
  }
});

test("the two source sets partition every path tried here — never both, never neither", () => {
  const pathnames = [
    "/", "/q/abc", "/dashboard", "/account", "/repository", "/pricing",
    "/embed", "/embed/qux", "/embed/quux/more",
    "/embed/q", "/embed/q/", "/embed/q/some-slug", "/embed/q/some-slug/extra",
  ];
  for (const pathname of pathnames) {
    const general = generalMatches(pathname) !== false;
    const embed = matchesAnyEmbedSource(pathname);
    assert.notEqual(general, embed, `${pathname}: exactly one of the general and embed sources must match, got general=${general} embed=${embed}`);
  }
});

test("mutation check: a bare catch-all would wrongly cover the embed route", () => {
  // The failure this whole module exists to prevent, produced deliberately so
  // the assertions above are shown to be capable of catching it. If
  // GENERAL_ANTI_FRAMING_SOURCE ever regresses to the plain "/(.*)" catch-all
  // it replaced, this is what the regression looks like from here.
  const bareCatchAll = getPathMatch("/(.*)");
  assert.notEqual(
    bareCatchAll("/embed/q/some-slug"),
    false,
    "a bare catch-all matches the embed route — that is exactly the bug GENERAL_ANTI_FRAMING_SOURCE fixes",
  );
  assert.equal(
    generalMatches("/embed/q/some-slug"),
    false,
    "GENERAL_ANTI_FRAMING_SOURCE must not match what the bare catch-all above just matched",
  );
});
