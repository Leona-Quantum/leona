import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalLocaleTarget, localePrefixOf } from "./canonical-locale-redirect.ts";
import { PUBLIC_LOCALES } from "./public-locale.ts";

const ORIGIN = "https://leonaqt.com";
const REQUEST = `${ORIGIN}/en/pricing`;

test("a query string on the request survives the redirect (ai-ops 329)", () => {
  const withQuery = `${ORIGIN}/ja/pricing?ref=share`;
  const target = canonicalLocaleTarget("/ja/pricing", withQuery, PUBLIC_LOCALES);
  assert.equal(target?.pathname, "/pricing");
  assert.equal(target?.search, "?ref=share");
  assert.equal(target?.toString(), `${ORIGIN}/pricing?ref=share`);
});

/**
 * `middleware.ts`'s `canonicalRedirect` sets `PUBLIC_LOCALE_COOKIE` to
 * whatever this returns, so its correctness IS the correctness of that
 * cookie — a wrong answer here is a wrong cookie value in production, not
 * merely a wrong redirect target. Kept as its own test file section rather
 * than folded into the target tests above so a change to either function is
 * caught by the test that actually names it.
 */
test("localePrefixOf names the locale a canonical redirect will remember", () => {
  assert.equal(localePrefixOf("/ja/pricing", PUBLIC_LOCALES), "ja");
  assert.equal(localePrefixOf("/en/pricing", PUBLIC_LOCALES), "en");
  assert.equal(localePrefixOf("/ja", PUBLIC_LOCALES), "ja");
  assert.equal(localePrefixOf("/ja/", PUBLIC_LOCALES), "ja");
  assert.equal(localePrefixOf("/en/repository/layers/abc", PUBLIC_LOCALES), "en");
});

test("localePrefixOf agrees with canonicalLocaleTarget about which paths are ours", () => {
  // Same condition, read two ways: whenever one says "not ours", the other
  // must say the same, or the redirect and the cookie it sets could disagree
  // about whether this request named a locale at all.
  for (const pathname of ["/pricing", "/account", "/", "/eng/pricing", "/e/pricing"]) {
    assert.equal(localePrefixOf(pathname, PUBLIC_LOCALES), null, pathname);
    assert.equal(canonicalLocaleTarget(pathname, REQUEST, PUBLIC_LOCALES), null, pathname);
  }
});

test("localePrefixOf stays inside `locales` even on a hostile path", () => {
  // The redirect target is proven never to leave the origin (below). This is
  // the same property for the cookie: the value written is always literally
  // "en" or "ja" — never a fragment of the attacker-controlled tail — even on
  // the exact inputs that used to escape the origin before PR 558.
  const bs = String.fromCharCode(92);
  assert.equal(localePrefixOf("/en//evil.com", PUBLIC_LOCALES), "en");
  assert.equal(localePrefixOf(`/en/${bs}evil.com`, PUBLIC_LOCALES), "en");
  assert.equal(localePrefixOf("/ja//attacker.example", PUBLIC_LOCALES), "ja");
});

test("a locale-prefixed public page collapses onto its clean path", () => {
  assert.equal(canonicalLocaleTarget("/en/pricing", REQUEST, PUBLIC_LOCALES)?.toString(), `${ORIGIN}/pricing`);
  assert.equal(canonicalLocaleTarget("/ja/contact", REQUEST, PUBLIC_LOCALES)?.toString(), `${ORIGIN}/contact`);
  assert.equal(canonicalLocaleTarget("/en/a/b/c", REQUEST, PUBLIC_LOCALES)?.toString(), `${ORIGIN}/a/b/c`);
});

test("the bare locale and its trailing-slash form both land on the root", () => {
  assert.equal(canonicalLocaleTarget("/en", REQUEST, PUBLIC_LOCALES)?.toString(), `${ORIGIN}/`);
  assert.equal(canonicalLocaleTarget("/en/", REQUEST, PUBLIC_LOCALES)?.toString(), `${ORIGIN}/`);
});

test("a path that does not start with a public locale is not ours to redirect", () => {
  for (const pathname of ["/pricing", "/account", "/", "/eng/pricing", "/e/pricing"]) {
    assert.equal(canonicalLocaleTarget(pathname, REQUEST, PUBLIC_LOCALES), null, pathname);
  }
});

/**
 * The regression this module exists for. Every one of these produced
 * `https://evil.com/` before the fix — an unauthenticated open redirect on the
 * origin that also serves the sign-in flow, reachable with a single GET because
 * the canonical redirect runs before the auth gate.
 *
 * The backslash rows are not decoration. A normalizer that collapses duplicate
 * forward slashes leaves `\` alone, so a fix covering only `//` would still be
 * exploitable through the form most likely to survive a proxy.
 */
test("no path can move the redirect off this origin", () => {
  const bs = String.fromCharCode(92);
  const hostile = [
    "/en//evil.com",
    "/en//evil.com/path",
    "/en///evil.com",
    `/en/${bs}evil.com`,
    `/en/${bs}${bs}evil.com`,
    `/en/${bs}/evil.com`,
    "/en//evil.com@leonaqt.com",
    "/ja//attacker.example",
    "/en//",
  ];
  for (const pathname of hostile) {
    const target = canonicalLocaleTarget(pathname, REQUEST, PUBLIC_LOCALES);
    assert.ok(target, pathname);
    assert.equal(target.origin, ORIGIN, `${pathname} escaped to ${target.toString()}`);
    assert.equal(target.host, "leonaqt.com", pathname);
  }
  // A loop over an empty array passes every assertion inside it, so the count is
  // asserted HERE, in the test that owns the array. Asserting it in a sibling
  // test does not protect this one: a future edit could delete rows from
  // `hostile` above and every assertion in this file would still pass.
  assert.equal(hostile.length, 9);
});

test("the hostile forms keep the host and expose the path", () => {
  const bs = String.fromCharCode(92);
  assert.equal(canonicalLocaleTarget(`/en/${bs}evil.com`, REQUEST, PUBLIC_LOCALES)?.host, "leonaqt.com");
  assert.equal(canonicalLocaleTarget("/en//evil.com", REQUEST, PUBLIC_LOCALES)?.pathname, "/evil.com");
});
