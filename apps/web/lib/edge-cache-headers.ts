import { LEGACY_PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALE_COOKIE } from "./public-locale.ts";

/**
 * The `headers()` entries that let a shared cache hold a public page in front of
 * its render. See the long note above the Atlas entries in `next.config.ts` for
 * why a header is needed at all and why 300 seconds.
 *
 * ## Conditional on the request, because Cloudflare ignores `Vary`
 *
 * The same URL answers with different bodies depending on the REQUEST. Measured
 * through Cloudflare on 2026-09-19, against `/repository`:
 *
 *   GET /repository                   HTML page
 *   GET /repository        + RSC: 1   307 to /repository?_rsc
 *   GET /repository?_rsc   + RSC: 1   200 text/x-component (the raw payload)
 *   GET /repository?_rsc              HTML page
 *
 * and before this change all four carried `CDN-Cache-Control: max-age=300`.
 * Next answers `Vary: rsc, next-router-state-tree, …` on each of them, which is
 * enough for an edge that honours `Vary`. Cloudflare's does not: it keys
 * on the URL and ignores `Vary` apart from content encoding. So once a Cache
 * Rule makes these paths eligible, one request carrying `RSC: 1` on a cold edge
 * stores the redirect (or, one hop later, the React payload) under the address
 * every visitor asks for, and the next five minutes of readers get raw payload
 * text instead of the Atlas.
 *
 * The locale cookie is the same shape of problem. Cloudflare's Free plan cannot
 * put a cookie in the cache key, so the Japanese render and the English render
 * of `/repository` would share one entry. The dashboard rule refuses to cache a
 * request carrying either locale cookie, and this refuses to MARK such a
 * response cacheable, so the two languages stay apart even if the rule is later
 * rewritten without those lines.
 *
 * So `CDN-Cache-Control` (the header Cloudflare reads) is sent only when none
 * of those request properties is present. With the rule's Edge TTL on "use
 * cache-control header if present", a response without it falls back to Next's
 * own `private, no-store` or to no header at all, and is not stored.
 *
 * Until Vercel was retired this also sent `Vercel-CDN-Cache-Control`
 * unconditionally, because Vercel's edge honours `Vary` and could cache the
 * navigation payloads safely. No Vercel edge serves the site any more, so that
 * header was dropped rather than left as a string nothing reads.
 */
export const EDGE_CACHE_BYPASS_WHEN_PRESENT = [
  // Next's client router marks every payload request with this header, and the
  // 307 above is Next's own answer to the header arriving without `?_rsc`.
  { type: "header", key: "rsc" },
  // The payload's cache-busting parameter. A request carrying it without the
  // header gets HTML, which would then sit under the key a real payload request
  // uses. Next's matcher treats an EMPTY value as absent, so the bare `?_rsc`
  // the 307 points at is not caught here; the header condition above catches
  // the request that makes that address dangerous.
  { type: "query", key: "_rsc" },
  { type: "cookie", key: PUBLIC_LOCALE_COOKIE },
  { type: "cookie", key: LEGACY_PUBLIC_LOCALE_COOKIE },
] as const;

export type EdgeCacheRule = {
  source: string;
  headers: { key: string; value: string }[];
  missing?: { type: "header" | "query" | "cookie"; key: string }[];
};

/** The entry for one `source`: Cloudflare's header, only on a plain request. */
export function edgeCacheRules(source: string, maxAgeSeconds: number): EdgeCacheRule[] {
  const value = `max-age=${maxAgeSeconds}`;
  return [
    {
      source,
      missing: EDGE_CACHE_BYPASS_WHEN_PRESENT.map((condition) => ({ ...condition })),
      headers: [{ key: "CDN-Cache-Control", value }],
    },
  ];
}
