import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @majorana/ui ships TS/TSX source (vendored components) — Next transpiles it.
  transpilePackages: ["@majorana/ui"],
  // Two dev servers in one worktree otherwise share `.next` and corrupt each
  // other's build cache, which surfaces as stale-resolve errors that survive a
  // restart. Unset everywhere except a second local server, so CI and Vercel
  // build to the usual directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Security headers baseline (05-security.md §1 platform+edge); CSP tightens in Phase 3
  // when the real asset/style surface exists.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
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
