import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
// Next's own matcher for `has`/`missing`, the function that decides whether a
// `headers()` entry applies to a request. Asserting against it rather than a
// re-implementation is the point: a hand-written matcher would agree with this
// file by construction, and Next's rule for an EMPTY value (absent) is exactly
// the kind of detail a copy gets wrong.
import prepareDestination from "next/dist/shared/lib/router/utils/prepare-destination.js";
import { EDGE_CACHE_BYPASS_WHEN_PRESENT, edgeCacheRules } from "./edge-cache-headers.ts";
import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE } from "./public-locale.ts";

// Next types `req` as its full request object; matchHas reads only `headers`
// (and `cookies` when present, which falls back to parsing the header), so a
// minimal object is what it actually needs.
const { matchHas } = prepareDestination as unknown as {
  matchHas: (
    req: { headers: Record<string, string> },
    query: Record<string, string>,
    has?: unknown[],
    missing?: unknown[],
  ) => false | Record<string, string>;
};

const NEXT_CONFIG = fileURLToPath(new URL("../next.config.ts", import.meta.url));

/** The header names `headers()` would add to this request for this source. */
function headersFor(request: { headers?: Record<string, string>; query?: Record<string, string> }): string[] {
  const req = { headers: request.headers ?? {} };
  return edgeCacheRules("/repository", 300)
    .filter((rule) => matchHas(req, request.query ?? {}, [], rule.missing ?? []) !== false)
    .flatMap((rule) => rule.headers.map((h) => h.key));
}

test("a plain request is marked cacheable for both edges", () => {
  assert.deepEqual(headersFor({}), ["Vercel-CDN-Cache-Control", "CDN-Cache-Control"]);
});

test("a payload request is not marked cacheable for Cloudflare, which ignores Vary", () => {
  // Measured through Cloudflare 2026-09-19: `RSC: 1` on /repository answers a
  // 307 to /repository?_rsc, and on /repository?_rsc the raw text/x-component
  // payload. Both carried CDN-Cache-Control: max-age=300 before this change.
  assert.deepEqual(headersFor({ headers: { rsc: "1" } }), ["Vercel-CDN-Cache-Control"]);
  assert.deepEqual(headersFor({ headers: { rsc: "1" }, query: { _rsc: "" } }), ["Vercel-CDN-Cache-Control"]);
  assert.deepEqual(headersFor({ query: { _rsc: "1x7qz" } }), ["Vercel-CDN-Cache-Control"]);
});

test("an empty ?_rsc counts as absent in Next's matcher, so the header condition is the one that holds", () => {
  // Documents the boundary the comment in edge-cache-headers.ts relies on. If a
  // Next upgrade starts treating an empty value as present, this fails and the
  // comment needs rewriting; nothing about the protection gets weaker.
  assert.deepEqual(headersFor({ query: { _rsc: "" } }), ["Vercel-CDN-Cache-Control", "CDN-Cache-Control"]);
});

test("a request carrying either locale cookie is not marked cacheable for Cloudflare", () => {
  for (const name of [PUBLIC_LOCALE_COOKIE, LEGACY_PUBLIC_LOCALE_COOKIE]) {
    assert.deepEqual(headersFor({ headers: { cookie: `${name}=ja` } }), ["Vercel-CDN-Cache-Control"], name);
    assert.deepEqual(
      headersFor({ headers: { cookie: `wos-session=abc; ${name}=en; other=1` } }),
      ["Vercel-CDN-Cache-Control"],
      `${name} among other cookies`,
    );
  }
  // An unrelated cookie changes nothing: the cached pages have no per-visitor part.
  assert.deepEqual(headersFor({ headers: { cookie: "other=1" } }), ["Vercel-CDN-Cache-Control", "CDN-Cache-Control"]);
});

test("any value of the RSC header counts as present, not only 1", () => {
  // Next lowercases the key it looks up, and Node lowercases incoming header
  // names, so the condition's key has to be lowercase to match anything.
  assert.ok(EDGE_CACHE_BYPASS_WHEN_PRESENT.some((c) => c.type === "header" && c.key === "rsc"));
  assert.deepEqual(headersFor({ headers: { rsc: "0" } }), ["Vercel-CDN-Cache-Control"]);
});

test("next.config.ts sends CDN-Cache-Control for the Atlas only through edgeCacheRules", () => {
  // A literal entry would carry the header unconditionally, which is the bug.
  // Stated as a scan because next.config.ts cannot be imported by this runner
  // (its own imports are extensionless), and checked against the three route
  // families by name so a rewrite that drops one fails here, not in production.
  const config = readFileSync(NEXT_CONFIG, "utf8");
  assert.doesNotMatch(
    config,
    /key:\s*"CDN-Cache-Control",\s*value:\s*"max-age=300"/,
    "a literal CDN-Cache-Control: max-age=300 entry is back in next.config.ts; route it through edgeCacheRules",
  );
  for (const base of ["/repository/layers", "/repository/folders"]) {
    assert.match(
      config,
      new RegExp(`"${base}", "/:locale\\(en\\|ja\\)${base}"\\]\\.flatMap\\(\\(base\\) =>\\s*\\[base, \`\\$\\{base\\}/:path\\*\`\\]\\.flatMap\\(\\(source\\) => edgeCacheRules\\(source, 300\\)\\)`),
      `${base} is no longer covered by edgeCacheRules`,
    );
  }
  assert.match(
    config,
    /\["\/repository", "\/:locale\(en\|ja\)\/repository"\]\.flatMap\(\(source\) => edgeCacheRules\(source, 300\)\)/,
    "/repository (exact) is no longer covered by edgeCacheRules",
  );
});
