import assert from "node:assert/strict";
import test from "node:test";
import {
  isLocaleRewriteContinuation,
  LOCALE_REWRITE_SOURCE_HEADER,
  localeRewriteRequestHeaders,
  localeRewriteTarget,
} from "./locale-rewrite.ts";

const BASE = "https://leonaqt.com";

test("the query string survives the rewrite", () => {
  // The regression this file exists for. `new URL(target, request.url)` drops
  // it, which sent every `/repository/layers` deep link to the bare map — and
  // cached the answer, so it was fast and wrong.
  const target = localeRewriteTarget(
    `${BASE}/repository/layers?open=variational-circuit&at=1,2,3`,
    "/repository/layers",
    "en",
  );
  assert.equal(target.pathname, "/en/repository/layers");
  assert.equal(target.search, "?open=variational-circuit&at=1,2,3");
  assert.equal(target.searchParams.get("open"), "variational-circuit");
  assert.equal(target.searchParams.get("at"), "1,2,3");
});

test("a repeated parameter survives as a repeat, not as one value", () => {
  // The canvas emits `?open=` repeatedly rather than comma-joined, and
  // `resolveOpenIds` takes a list. Collapsing them would silently open one lane
  // out of four.
  const target = localeRewriteTarget(
    `${BASE}/repository/layers?open=a&open=b&open=c`,
    "/repository/layers",
    "ja",
  );
  assert.deepEqual(target.searchParams.getAll("open"), ["a", "b", "c"]);
});

test("a path with no query gains none", () => {
  const target = localeRewriteTarget(`${BASE}/pricing`, "/pricing", "ja");
  assert.equal(target.pathname, "/ja/pricing");
  assert.equal(target.search, "");
  assert.equal(target.toString(), `${BASE}/ja/pricing`);
});

test("the root becomes the bare locale, not a trailing slash", () => {
  // `/en/` and `/en` are two addresses; `app/[locale]/page.tsx` answers the
  // second.
  assert.equal(localeRewriteTarget(`${BASE}/`, "/", "en").pathname, "/en");
  assert.equal(localeRewriteTarget(`${BASE}/?ref=x`, "/", "ja").pathname, "/ja");
  assert.equal(localeRewriteTarget(`${BASE}/?ref=x`, "/", "ja").search, "?ref=x");
});

test("a nested path keeps every segment", () => {
  const target = localeRewriteTarget(
    `${BASE}/repository/layers/parameterized-circuit?at=0,0,2`,
    "/repository/layers/parameterized-circuit",
    "en",
  );
  assert.equal(target.pathname, "/en/repository/layers/parameterized-circuit");
  assert.equal(target.search, "?at=0,0,2");
});

test("the host is never changed, whatever the path looks like", () => {
  // The rewrite runs BEFORE the auth gate, so it is reachable by anyone with a
  // single GET. Assigning to `url.pathname` cannot replace the authority, but
  // the relative `new URL(str, base)` form can — that is the open redirect
  // `canonical-locale-redirect.ts` was written to close, and these are the same
  // strings, asserted here so the rewrite half cannot regress into it.
  for (const hostile of ["//evil.com", "/\\evil.com", "//evil.com/path"]) {
    const target = localeRewriteTarget(`${BASE}${hostile}`, hostile, "en");
    assert.equal(target.host, "leonaqt.com", `${hostile} changed the host`);
    assert.equal(target.protocol, "https:");
  }
});

test("a non-canonical host is preserved rather than rewritten to the canonical one", () => {
  // Four hostnames serve this site and `canonicalRedirect` is what collapses
  // them. This runs first and must not take that decision — a preview
  // deployment rewriting itself to production would serve the wrong build.
  const target = localeRewriteTarget(
    "https://web-abc123-majoranaq.vercel.app/repository/layers?open=a",
    "/repository/layers",
    "en",
  );
  assert.equal(target.host, "web-abc123-majoranaq.vercel.app");
  assert.equal(target.pathname, "/en/repository/layers");
  assert.equal(target.search, "?open=a");
});

test("locale rewrite request headers carry the clean source without mutating the input", () => {
  const original = new Headers({ accept: "text/html" });
  const rewritten = localeRewriteRequestHeaders(original, "/pricing");

  assert.equal(original.get(LOCALE_REWRITE_SOURCE_HEADER), null);
  assert.equal(rewritten.get(LOCALE_REWRITE_SOURCE_HEADER), "/pricing");
  assert.equal(rewritten.get("accept"), "text/html");
});

test("locale rewrite continuation accepts only an exact destination of a public source", () => {
  const publicSources = new Set(["/", "/pricing", "/repository/layers"]);
  const isPublicSource = (pathname: string) => publicSources.has(pathname);

  assert.equal(isLocaleRewriteContinuation("/", "/en", ["en", "ja"], isPublicSource), true);
  assert.equal(isLocaleRewriteContinuation("/pricing", "/ja/pricing", ["en", "ja"], isPublicSource), true);
  assert.equal(
    isLocaleRewriteContinuation("/repository/layers", "/en/repository/layers", ["en", "ja"], isPublicSource),
    true,
  );
  assert.equal(isLocaleRewriteContinuation(null, "/en", ["en", "ja"], isPublicSource), false);
  assert.equal(isLocaleRewriteContinuation("/pricing", "/en/contact", ["en", "ja"], isPublicSource), false);
  assert.equal(isLocaleRewriteContinuation("/account", "/en/account", ["en", "ja"], isPublicSource), false);
});
