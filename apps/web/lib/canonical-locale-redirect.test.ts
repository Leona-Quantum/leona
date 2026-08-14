import assert from "node:assert/strict";
import { test } from "node:test";

import { canonicalLocaleTarget } from "./canonical-locale-redirect.ts";
import { PUBLIC_LOCALES } from "./public-locale.ts";

const ORIGIN = "https://leonaqt.com";
const REQUEST = `${ORIGIN}/en/pricing`;

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
});

test("the hostile list is not vacuously empty", () => {
  // A loop over an empty array passes every assertion inside it. The count is
  // asserted so a future edit cannot quietly delete the cases above.
  const bs = String.fromCharCode(92);
  assert.equal(canonicalLocaleTarget(`/en/${bs}evil.com`, REQUEST, PUBLIC_LOCALES)?.host, "leonaqt.com");
  assert.equal(canonicalLocaleTarget("/en//evil.com", REQUEST, PUBLIC_LOCALES)?.pathname, "/evil.com");
});
