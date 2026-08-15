import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalLocaleTarget } from "./canonical-locale-redirect.ts";
import { PUBLIC_LOCALES } from "./public-locale.ts";
import { PUBLIC_STATIC_PATHS } from "./sitemap-paths.ts";
import {
  CANONICAL_HOST,
  NON_CANONICAL_HOSTS,
  PRODUCTION_ORIGIN,
  canonicalHostRedirect,
  siteOrigin,
} from "./site-origin.ts";

test("the origin comes off the configured sign-in callback", () => {
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback" }),
    "https://leonaqt.com",
  );
});

test("the path is dropped, and only the path", () => {
  // A return_to of ".../auth/callback" would put a signed-out person back on
  // the sign-in callback, which is the one place they should not land.
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://www.leonaqt.com/auth/callback?x=1" }),
    "https://www.leonaqt.com",
  );
  // A non-default port is part of the origin and must survive.
  assert.equal(
    siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "http://localhost:3000/auth/callback" }),
    "http://localhost:3000",
  );
});

test("the server-only variable is the fallback, not the winner", () => {
  assert.equal(
    siteOrigin({
      NEXT_PUBLIC_WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback",
      WORKOS_REDIRECT_URI: "https://stale.example/auth/callback",
    }),
    "https://leonaqt.com",
  );
  assert.equal(
    siteOrigin({ WORKOS_REDIRECT_URI: "https://leonaqt.com/auth/callback" }),
    "https://leonaqt.com",
  );
});

test("nothing configured means nothing claimed", () => {
  assert.equal(siteOrigin({}), null);
});

test("a value that is not a usable origin yields null rather than a bad one", () => {
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "not a url" }), null);
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "/auth/callback" }), null);
  // Parses fine and has the opaque origin "null" — sending that as return_to
  // would be worse than sending nothing.
  assert.equal(siteOrigin({ NEXT_PUBLIC_WORKOS_REDIRECT_URI: "mailto:someone@example.com" }), null);
});

/**
 * `auth.ts` reaches WorkOS through `@workos-inc/authkit-nextjs`, which the bare
 * node runner cannot load, so the one line that actually decides where a
 * signed-out person lands cannot be exercised directly. It is read instead.
 *
 * A relative `returnTo` is not a compile error and not a runtime error — WorkOS
 * quietly ignores it and uses the environment's default sign-out redirect — so
 * reverting this costs nothing at any gate except this one. The assertion is
 * that the call was FOUND and is correct, not merely that a bad pattern is
 * absent: a scan that matches nothing passes forever.
 */
test("sign-out hands WorkOS an absolute origin, not a path", () => {
  const source = readFileSync(fileURLToPath(new URL("./auth.ts", import.meta.url)), "utf8");
  const call = source.match(/await signOut\(\{[^}]*\}\)/);
  assert.ok(call, "expected auth.ts to still call signOut — this guard found nothing to check");
  assert.match(
    call[0],
    /returnTo:\s*siteOrigin\(\)/,
    `signOut must be given the deployment's origin, got: ${call[0]}`,
  );
});

// ---- the canonical host (ai-ops#83) ---------------------------------------

test("the canonical host is the production origin's, not a second literal", () => {
  assert.equal(CANONICAL_HOST, "leonaqt.com");
  assert.equal(`https://${CANONICAL_HOST}`, PRODUCTION_ORIGIN);
});

test("each of the three non-canonical hosts is redirected, path and query intact", () => {
  // Named individually rather than swept, so deleting one from the list is a
  // failing test rather than a silently smaller redirect.
  for (const host of ["www.leonaqt.com", "leonaquantum.com", "www.leonaquantum.com"]) {
    assert.equal(
      canonicalHostRedirect(host, "/pricing"),
      "https://leonaqt.com/pricing",
      host,
    );
    assert.equal(
      canonicalHostRedirect(host, "/repository/grover-search?order=catalog&rows=24"),
      "https://leonaqt.com/repository/grover-search?order=catalog&rows=24",
      `${host} must keep the path and the query`,
    );
    assert.equal(canonicalHostRedirect(host, "/"), "https://leonaqt.com/", `${host} root`);
  }
  assert.deepEqual([...NON_CANONICAL_HOSTS].sort(), [
    "leonaquantum.com",
    "www.leonaqt.com",
    "www.leonaquantum.com",
  ]);
});

test("the canonical host is left alone, so there is no redirect loop", () => {
  assert.equal(canonicalHostRedirect(CANONICAL_HOST, "/pricing"), null);
  assert.equal(canonicalHostRedirect(CANONICAL_HOST, "/"), null);
});

test("every other host is left alone — this is an allowlist, not a rule", () => {
  // The failure this pins is not hypothetical: "redirect anything that is not
  // canonical" sends every preview deployment, every branch alias and local
  // development to production the moment they are opened, and the symptom is
  // that reviewing a PR shows you `dev`.
  for (const host of [
    "web-eshmis-majoranaq.vercel.app",
    "majorana-git-feature-something-eshmis.vercel.app",
    "leonaqt-com.vercel.app",
    "localhost:3000",
    "127.0.0.1:3000",
    // Neither a subdomain nor a suffix of a listed host is a listed host.
    "auth.leonaqt.com",
    "staging.leonaquantum.com",
    "notleonaqt.com",
    "leonaqt.com.evil.example",
  ]) {
    assert.equal(canonicalHostRedirect(host, "/pricing"), null, host);
  }
  assert.equal(canonicalHostRedirect(null, "/pricing"), null);
  assert.equal(canonicalHostRedirect(undefined, "/pricing"), null);
  assert.equal(canonicalHostRedirect("", "/pricing"), null);
});

test("a host header is matched case-insensitively and untrimmed", () => {
  // Host is case-insensitive per RFC 9110; a capitalised one is the same host
  // and must not slip past the list.
  assert.equal(canonicalHostRedirect("WWW.Leonaqt.com", "/"), "https://leonaqt.com/");
  assert.equal(canonicalHostRedirect(" leonaquantum.com ", "/"), "https://leonaqt.com/");
});

/**
 * The wiring, read rather than executed.
 *
 * `middleware.ts` imports `next/server`, which the bare node runner cannot
 * load, so the assertions above exercise the decision and this one asserts it
 * is still connected to a request. Both halves are needed: a correct function
 * nobody calls redirects nothing, and that failure has no symptom short of
 * loading all four hosts by hand.
 *
 * It asserts the call was FOUND as well as that it is correct — a scan that
 * matches nothing passes forever.
 */
test("middleware performs the canonical-host hop, permanently and before the counter", () => {
  const source = readFileSync(fileURLToPath(new URL("../middleware.ts", import.meta.url)), "utf8");
  assert.match(
    source,
    /canonicalHostRedirect\(/,
    "middleware no longer calls canonicalHostRedirect — the redirect is inert",
  );
  assert.match(
    source,
    /NextResponse\.redirect\(target,\s*308\)/,
    "the canonical-host hop must be a 308: permanent, and method-preserving",
  );
  // Ahead of countPageview, or every figure on those hosts is inflated by the
  // redirect that precedes the real read.
  const hop = source.indexOf("canonicalHost(request)");
  const counter = source.indexOf("countPageview(request);");
  assert.ok(hop > 0 && counter > 0, "expected both the hop and the counter to still be called");
  assert.ok(hop < counter, "the canonical-host hop must run before the pageview counter");
});

/**
 * The matcher has to reach the pages the redirect is for.
 *
 * It is one negative lookahead listing static-asset prefixes, so the risk is
 * not that a page is missed today — it is that a future exclusion quietly takes
 * a public page out of the middleware, and with it the redirect, the auth gate
 * and the locale rewrite all at once.
 */
/**
 * The other half of ai-ops#83: the redirect stops three hostnames from serving
 * the site, and this stops the site from being silent about which address it
 * means.
 *
 * Keyed off `PUBLIC_STATIC_PATHS` rather than a list of its own, so a public
 * page added to the sitemap without a canonical URL fails here instead of
 * shipping. The value is the file that renders it — the public marketing pages
 * are served by an internal rewrite, so the route on disk is not the address.
 */
const CANONICAL_PAGE_SOURCES: Record<string, string> = {
  "/": "app/[locale]/page.tsx",
  "/pricing": "app/[locale]/pricing/page.tsx",
  "/workspace": "app/[locale]/workspace/page.tsx",
  "/contact": "app/[locale]/contact/page.tsx",
  "/privacy": "app/[locale]/privacy/page.tsx",
  "/terms": "app/[locale]/terms/page.tsx",
  "/repository/folders": "app/repository/folders/[[...path]]/page.tsx",
  // Under `[locale]` since the Atlas caching change: these three carry no
  // per-visitor read during their server render, so they moved to where the
  // locale is a path segment and the CDN can hold them. Their canonical
  // address is unchanged, which is the whole point of `canonicalMetadata`
  // taking the clean path. `/repository` is the newest of the three — it
  // still has a per-entry personalized control (the "Add to Studio" button),
  // which is why it moved later than its two siblings: that control had to
  // learn to resolve sign-in state client-side (`/api/auth/session`) before
  // the page itself could stop calling `getMajoranaAuth()` server-side.
  "/repository": "app/[locale]/repository/(browse)/page.tsx",
  "/repository/layers": "app/[locale]/repository/layers/page.tsx",
  "/repository/claims": "app/[locale]/repository/claims/page.tsx",
  "/repository/papers": "app/repository/papers/page.tsx",
};

function pageSource(relative: string): string {
  const web = fileURLToPath(new URL("../", import.meta.url));
  return readFileSync(join(web, ...relative.split("/")), "utf8");
}

test("every public page with a fixed address states its canonical URL", () => {
  for (const path of PUBLIC_STATIC_PATHS) {
    const file = CANONICAL_PAGE_SOURCES[path];
    assert.ok(file, `${path} is in the sitemap but this test does not know which page renders it`);
    const source = pageSource(file);
    assert.match(
      source,
      /canonicalMetadata\(/,
      `${file} serves ${path} and declares no canonical URL`,
    );
  }
});

test("the canonical URL a page states is the address the sitemap publishes", () => {
  // `/repository/folders` is excluded because its canonical is computed from
  // the catch-all segments rather than written as a literal — the assertion
  // above still requires it to declare one.
  for (const [path, file] of Object.entries(CANONICAL_PAGE_SOURCES)) {
    if (path === "/repository/folders") continue;
    assert.match(
      pageSource(file),
      new RegExp(`canonicalMetadata\\("${path}"\\)`),
      `${file} should claim ${path} as its canonical address`,
    );
  }
});

test("no canonical URL is declared in the root layout", () => {
  // Metadata is inherited. A canonical in `app/layout.tsx` would be applied to
  // every route that does not override it, telling a crawler that all seven
  // hundred pages are the same page — strictly worse than declaring none.
  // `metadataBase` is the one field that belongs there.
  const layout = pageSource("app/layout.tsx");
  assert.match(layout, /metadataBase:\s*new URL\(canonicalOrigin\(\)\)/);
  // The field, not the word: this file's own comment explains why the field is
  // absent, and a bare /alternates/ would match the explanation.
  assert.doesNotMatch(layout, /^\s*alternates:/m);
  assert.doesNotMatch(layout, /\.\.\.canonicalMetadata\(/);
});

test("the middleware matcher still covers every public page", () => {
  const source = readFileSync(fileURLToPath(new URL("../middleware.ts", import.meta.url)), "utf8");
  const matcher = source.match(/matcher:\s*\[\s*"([^"]+)"/);
  assert.ok(matcher, "expected middleware.ts to still declare a matcher");
  const pattern = new RegExp(matcher[1]);
  for (const path of ["/", "/pricing", "/repository", "/repository/grover-search", "/auth/callback", "/account", "/studio"]) {
    assert.ok(pattern.test(path), `the matcher no longer covers ${path}`);
  }
});

// ---- the two redirects together (PR 558 + PR 559) --------------------------

/**
 * A request carrying BOTH problems at once, which is the case neither PR tested
 * on its own: a non-canonical host AND a locale prefix.
 *
 * It takes two hops, host first, and that order is deliberate rather than
 * incidental. Collapsing them into one would mean rebuilding the locale rule
 * inside the host redirect — a second copy of the thing `canonicalLocaleTarget`
 * exists to be the only copy of. Two 308s are cached by browsers and followed by
 * crawlers, and the shape that needs both (a locale-prefixed URL on a host
 * nothing links to) is not one anybody arrives at by clicking.
 *
 * Host first matters for a reason beyond tidiness: `canonicalRedirect` runs
 * BEFORE the auth gate, so keeping it downstream of the host hop means it is
 * only ever exercised on the canonical origin.
 */
test("a non-canonical host and a locale prefix resolve in two hops, host first", () => {
  const first = canonicalHostRedirect("www.leonaquantum.com", "/en/pricing");
  assert.equal(first, "https://leonaqt.com/en/pricing");

  const second = canonicalLocaleTarget("/en/pricing", first!, PUBLIC_LOCALES);
  assert.equal(second?.toString(), "https://leonaqt.com/pricing");

  // And the destination is a fixed point: neither redirect fires on it again.
  assert.equal(canonicalHostRedirect("leonaqt.com", "/pricing"), null);
  assert.equal(canonicalLocaleTarget("/pricing", "https://leonaqt.com/pricing", PUBLIC_LOCALES), null);
});

test("neither hop can be re-entered by the other's output, in either direction", () => {
  // The loop this rules out is not hypothetical in shape: two redirects that
  // each undo the other's normalisation is the classic redirect cycle, and a
  // browser answers it with ERR_TOO_MANY_REDIRECTS rather than a page.
  for (const path of ["/", "/pricing", "/en/pricing", "/repository/grover-search"]) {
    const hop = canonicalHostRedirect("leonaquantum.com", path);
    assert.ok(hop, path);
    const { host, pathname, search } = new URL(hop);
    assert.equal(host, "leonaqt.com", path);
    // Second pass over the same decision: the host hop is done.
    assert.equal(canonicalHostRedirect(host, `${pathname}${search}`), null, path);
    const locale = canonicalLocaleTarget(pathname, hop, PUBLIC_LOCALES);
    if (locale) {
      assert.equal(locale.host, "leonaqt.com", path);
      // ...and the locale hop is done too.
      assert.equal(canonicalLocaleTarget(locale.pathname, locale.toString(), PUBLIC_LOCALES), null, path);
      assert.equal(canonicalHostRedirect(locale.host, locale.pathname), null, path);
    }
  }
});

/**
 * The host hop is same-origin by construction, for a DIFFERENT reason than
 * `canonicalLocaleTarget` is.
 *
 * That module was an open redirect because it handed an attacker-influenced
 * path tail to the relative `new URL(str, base)` form, which is allowed to
 * replace the authority. This one never uses that form: the origin is a literal
 * PREFIX of the string, so the authority is already consumed before any path
 * byte is read, and no tail can displace it.
 *
 * That is a claim about the URL parser, so it is asserted here rather than
 * argued in a comment — the same reason the rows below exist on the other side.
 * The two are composed in production, and the composition is safe in both
 * orders: this hop carries `/en//evil.com` across verbatim and the sanitiser
 * then collapses it on the canonical origin.
 */
test("no path can move the host hop off this origin", () => {
  const bs = String.fromCharCode(92);
  const hostile = [
    "//evil.com",
    "//evil.com/path",
    "///evil.com",
    `/${bs}evil.com`,
    `/${bs}${bs}evil.com`,
    `/${bs}/evil.com`,
    "//evil.com@leonaqt.com",
    "/en//evil.com",
    "//",
  ];
  for (const path of hostile) {
    const target = canonicalHostRedirect("leonaquantum.com", path);
    assert.ok(target, path);
    const url = new URL(target);
    assert.equal(url.origin, "https://leonaqt.com", `${path} escaped to ${target}`);
    assert.equal(url.host, "leonaqt.com", path);
  }
  // Asserted here, in the test that owns the array: a loop over an emptied array
  // passes every assertion inside it, so a count in a sibling test would not
  // protect this one.
  assert.equal(hostile.length, 9);
});

test("a hostile path survives the host hop and is defused by the locale hop", () => {
  // The composition, end to end. The host hop deliberately does NOT sanitize —
  // it preserves the path so a deep link is not silently rewritten — and the
  // locale hop is what collapses the authority-shaped tail, on the canonical
  // origin where it can no longer matter.
  const first = canonicalHostRedirect("www.leonaquantum.com", "/en//evil.com");
  assert.equal(first, "https://leonaqt.com/en//evil.com");
  const second = canonicalLocaleTarget("/en//evil.com", first!, PUBLIC_LOCALES);
  assert.equal(second?.host, "leonaqt.com");
  assert.equal(second?.pathname, "/evil.com");
  assert.equal(second?.origin, "https://leonaqt.com");
});

/** The reconciliation itself: PR 558's fix must still be wired in. */
test("the locale redirect still routes through the same-origin builder", () => {
  const source = readFileSync(fileURLToPath(new URL("../middleware.ts", import.meta.url)), "utf8");
  assert.match(
    source,
    /import \{ canonicalLocaleTarget \} from "\.\/lib\/canonical-locale-redirect"/,
    "middleware lost the canonical-locale-redirect import in a merge",
  );
  assert.match(
    source,
    /import \{ canonicalHostRedirect \} from "\.\/lib\/site-origin"/,
    "middleware lost the canonical-host import in a merge",
  );
  // The pre-fix body built the target with the relative `new URL(rest, base)`
  // form. If a merge resolution took the wrong side of this hunk the open
  // redirect comes back with it, and nothing else in this file would notice.
  const body = source.match(/function canonicalRedirect\(request: NextRequest\)[^}]*\}/);
  assert.ok(body, "canonicalRedirect disappeared");
  assert.match(body[0], /canonicalLocaleTarget\(/, "canonicalRedirect no longer uses the safe builder");
  assert.doesNotMatch(body[0], /new URL\(rest/, "the relative-URL open redirect came back");
});
