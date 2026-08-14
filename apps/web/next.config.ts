import type { NextConfig } from "next";
import { contentSecurityPolicy } from "./lib/content-security-policy";

/**
 * Content-Security-Policy (05-security.md §1 platform+edge).
 *
 * ## What this does and does not buy, stated plainly
 *
 * `script-src` carries `'unsafe-inline'`, and with it present this policy is
 * NOT an XSS defence — an injected inline script still runs. Saying otherwise
 * would be the failure this codebase keeps finding in itself: a guarantee
 * written down and not held. Removing it needs per-request nonces, which means
 * a nonce threaded from middleware through the document and the one inline
 * theme script in `app/layout.tsx`, plus Next's own hydration inlines. That is
 * a real change with a real way of half-working, and it is not this PR.
 *
 * What it does buy today is worth having on its own:
 *
 * - `default-src`/`script-src 'self'` — an injection cannot pull executable
 *   code from an attacker's origin, which is how most of them get their payload.
 * - `connect-src` — exfiltration by `fetch` to an arbitrary host is refused.
 *   This is the directive that matters most here, because the interesting data
 *   is what the page already holds.
 * - `object-src 'none'`, `base-uri 'self'` — no plugin embedding, and no
 *   `<base>` rewrite silently repointing every relative URL on the page.
 * - `frame-ancestors 'none'`, `form-action 'self'` — clickjacking, and a form
 *   whose action was rewritten to post credentials elsewhere.
 *
 * `connect-src` must name the control plane explicitly: the browser talks to it
 * directly for SSE, so `'self'` alone would break every live run.
 * React's development runtime uses `eval()` for debugging call stacks, so only
 * development adds `'unsafe-eval'`; the production policy never receives it.
 */
const CONTROL_PLANE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

/**
 * `upgrade-insecure-requests` is omitted when the control plane is plain HTTP.
 *
 * The directive rewrites every http:// subresource to https:// *before* the
 * source list is checked, so with the local default of `http://localhost:8000`
 * the browser would try `https://localhost:8000`, find no TLS there, and fail
 * every API and SSE call — the whole product, broken in local dev only, by a
 * header added for production. Caught in review; the first version of this
 * emitted it unconditionally.
 *
 * Keyed on the control plane's scheme rather than on NODE_ENV: what matters is
 * whether there is actually an http:// origin in `connect-src` to be upgraded
 * out from under us, and a developer pointing at a deployed https API should
 * still get the directive.
 */
const csp = contentSecurityPolicy({
  controlPlane: CONTROL_PLANE,
  development: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  // @majorana/ui ships TS/TSX source (vendored components) — Next transpiles it.
  transpilePackages: ["@majorana/ui"],
  // Two dev servers in one worktree otherwise share `.next` and corrupt each
  // other's build cache, which surfaces as stale-resolve errors that survive a
  // restart. Unset everywhere except a second local server, so CI and Vercel
  // build to the usual directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Security headers baseline (05-security.md §1 platform+edge). The CSP above
  // documents exactly which classes it stops and which it does not.
  async headers() {
    return [
      // The Atlas map, served from the edge without being prerendered.
      //
      // ## Why this header and not `revalidate`
      //
      // `/repository/layers` and `/repository/layers/[id]` resolve their search
      // parameters on the server so a shared link arrives already panned and
      // expanded with JavaScript off. Next opts any page reading `searchParams`
      // into request-time rendering, so these two cannot be prerendered — the
      // `revalidate` + `dynamicParams = false` recipe that put the six marketing
      // pages on the CDN is unavailable here at any price. What is available is
      // an edge cache in FRONT of the render, which is what this configures.
      //
      // ## Measured, because the documentation contradicts itself here
      //
      // Next sends `cache-control: private, no-cache, no-store, max-age=0,
      // must-revalidate` on every dynamic page. Vercel documents both that
      // "Vercel-CDN-Cache-Control is exclusive to Vercel and has top priority"
      // and, in its cacheable-response criteria, that a response must not
      // "contain the private, no-cache or no-store directives in the
      // Cache-Control header". Those cannot both govern this case, and nothing
      // in either doc says which wins.
      //
      // A preview deployment of `spike/repo-cdn-cache-control` answered it. Three
      // arms, three consecutive GETs each, one run:
      //
      //   /cs-probe    Vercel-CDN-Cache-Control     MISS HIT  HIT
      //   /cs-cc       Cache-Control via this file  MISS MISS MISS
      //   /cs-control  no header                    MISS MISS MISS
      //
      // The probe's three responses carried a byte-identical render timestamp,
      // so one render served all three; the two controls each rendered three
      // times. So the priority rule wins, and a plain `Cache-Control` here does
      // not — Vercel's own note that config headers "will be overridden by
      // headers defined in Function responses" covers that second arm, and it is
      // why this cannot simply be written as `s-maxage`.
      //
      // The browser still receives `no-store`, which is left alone deliberately:
      // only Vercel's CDN is meant to hold this, and any other proxy in the path
      // reads the standard header and declines. `Vercel-CDN-Cache-Control` is
      // consumed at the edge and never reaches the client.
      //
      // ## Why 300
      //
      // The same number as CATALOG_REVALIDATE_SECONDS, which is what the corpus
      // fetch inside these pages already uses, so "how stale may the Atlas be"
      // has one answer rather than two. `stale-while-revalidate` is deliberately
      // absent: it would extend the window past that one answer.
      //
      // ## Both address forms
      //
      // The clean path is what a reader requests; middleware rewrites it to the
      // `/{locale}` form before the routing layer sees it. Which of the two the
      // header phase matches is a platform-ordering detail this file should not
      // depend on, so both are listed and the live check is `x-vercel-cache: HIT`
      // on a repeat request, not a reading of the routing order.
      ...["/repository/layers", "/:locale(en|ja)/repository/layers"].flatMap((base) =>
        [base, `${base}/:path*`].map((source) => ({
          source,
          headers: [{ key: "Vercel-CDN-Cache-Control", value: "max-age=300" }],
        })),
      ),
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
