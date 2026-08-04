import type { NextConfig } from "next";

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
 */
const CONTROL_PLANE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${CONTROL_PLANE}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

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
