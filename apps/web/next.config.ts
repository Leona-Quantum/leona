import { resolve } from "node:path";
import type { NextConfig } from "next";
import {
  contentSecurityPolicy,
  errorReportingOrigin,
} from "./lib/content-security-policy";
import { permissionsPolicy } from "./lib/permissions-policy";
import { publicReleaseSha } from "./lib/deploy-env";
import { edgeCacheRules } from "./lib/edge-cache-headers";
import { EMBED_QAPP_SOURCES, GENERAL_ANTI_FRAMING_SOURCE } from "./lib/embed-routes";

/**
 * Content-Security-Policy (05-security.md §1 platform+edge).
 *
 * ## What this does and does not buy, stated plainly
 *
 * `script-src` carries `'unsafe-inline'`, and with it present this policy is
 * NOT a general XSS defence — an injected inline `<script>` element still runs.
 * Saying otherwise would be the failure this codebase keeps finding in itself: a
 * guarantee written down and not held.
 *
 * ## Why `'unsafe-inline'` is still there, measured
 *
 * Not for the three pre-paint scripts in `app/layout.tsx` — those are constants
 * and hash cleanly. It is there for Next's own streaming payload. Every App
 * Router page carries the RSC flight data as inline
 * `<script>self.__next_f.push([1,"…"])</script>`; on `/pricing` that one script
 * is 25,095 bytes and its content is the page. It differs per page and per
 * render, so no hash computed at build time can name it, and `headers()` in this
 * file is evaluated before any page renders — the hash could not be computed
 * here even for the prerendered pages.
 *
 * That leaves nonces, and a nonce has to be minted per request and appear in
 * both the header and the HTML. The HTML on the public pages is served from
 * the edge cache with a nonce baked in at render time, so a fresh nonce in the
 * header would match nothing in the cached document and block the whole page.
 * Nonces therefore mean per-request rendering, which is precisely the caching
 * that `localeRewrite` in `middleware.ts` and the `CDN-Cache-Control`
 * rules below exist to buy. That trade is the owner's call, not a refactor.
 *
 * ## What IS closed, and was not before
 *
 * - `script-src-attr 'none'` — inline event handler attributes are refused
 *   outright, whatever `script-src` says, because `script-src-attr` does not
 *   inherit when present. `<img onerror=…>` is the commonest injected payload
 *   there is, and React never emits a handler attribute, so this costs nothing.
 * - `style-src-elem` — inline `<style>` ELEMENTS are now named by hash. The app
 *   serves exactly one, the 404 page's, so an injected stylesheet is refused.
 *   Inline style ATTRIBUTES stay open under `style-src-attr`; the Atlas map and
 *   KaTeX both position with them and there is no version of this that closes.
 *
 * The rest of what it buys was already true and is worth having on its own:
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
  // Same env var `instrumentation-client.ts` gates the browser SDK on, so the
  // policy and the SDK can never disagree about whether Sentry is configured.
  errorReporting: errorReportingOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
});

/**
 * The embed route's own policy (ai-ops 355, owner ruling: "Any website may
 * embed a published Qapp"). Identical to `csp` in every directive except
 * `frame-ancestors` — nothing else about the embed page's security posture
 * changes, so this is built from the same `contentSecurityPolicy()` call
 * rather than a hand-duplicated string that could drift from it.
 *
 * `https:` rather than `*`. The ruling is "any website", and in practice that
 * is any HTTPS site — `*` would also admit a plain `http://` parent page,
 * whose framing traffic (the outer document, and anything on it that could
 * rewrite the frame around the embed) is legible to whoever is on the same
 * network as the visitor. The embedded content itself carries nothing
 * sensitive either way (see `app/embed/q/[slug]/page.tsx`'s own docstring),
 * so this is a small extra margin rather than a load-bearing restriction, and
 * it costs nothing real: plain-HTTP sites embedding third-party widgets are
 * already rare and getting rarer as browsers phase out mixed content.
 */
const embedCsp = contentSecurityPolicy({
  controlPlane: CONTROL_PLANE,
  development: process.env.NODE_ENV === "development",
  errorReporting: errorReportingOrigin(process.env.NEXT_PUBLIC_SENTRY_DSN),
  frameAncestors: "https:",
});

const nextConfig: NextConfig = {
  experimental: { globalNotFound: true },
  /**
   * Cloud Run version-skew protection (ai-ops gcp-migration-20260912; see
   * docs/runbooks/web-cloud-run.md "The gap this move opens and does not
   * close: stale chunks"). Vercel kept a previous deployment's `_next/static`
   * reachable after a new one shipped, so a tab left open across a deploy
   * could still fetch the chunk it was built against; Cloud Run has no
   * equivalent — traffic shifts to the new revision, the old chunk paths
   * 404, and the tab breaks on its next navigation.
   *
   * Setting `deploymentId` does not bring the old assets back (see the
   * runbook section above for what would: a Cloud Storage bucket holding
   * each build's `/_next/static` for a week, which is a new cloud resource
   * and out of scope here). What it does: Next appends `?dpl=<id>` to every
   * chunk URL and sends the id as `x-deployment-id` on client-side page-data
   * fetches; when the server's id disagrees, the router abandons the
   * client-side transition and does a full MPA reload instead — so a stale
   * tab self-heals the moment it navigates, rather than throwing a
   * ChunkLoadError the reader has to notice and reload past themselves. It
   * does not cover a chunk fetched by a dynamic `import()` outside a
   * navigation (a lazy-loaded component) — that failure mode is still
   * possible and is what `components/chunk-error-recovery.tsx` (rendered in
   * `RootDocument`) catches instead, by reloading the page once.
   *
   * `publicReleaseSha()` (lib/deploy-env.ts) resolves to the build's commit
   * SHA — `NEXT_PUBLIC_LEONA_GIT_COMMIT_SHA`, set as a build arg by
   * cloudbuild.web.yaml (`apps/web/Dockerfile` bakes it in at `next build`
   * time, same as the Sentry release id already read from the same var), or
   * Vercel's own `NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA` there. Undefined for a
   * bare local `next dev`/`next build`, which leaves `deploymentId` unset —
   * exactly Next's default, so nothing changes locally.
   */
  deploymentId: publicReleaseSha(),
  // @majorana/ui ships TS/TSX source (vendored components) — Next transpiles it.
  transpilePackages: ["@majorana/ui"],
  // Next sends `X-Powered-By: Next.js` on every response unless this is off.
  // It is not a vulnerability by itself — it discloses the framework, which an
  // attacker can also read from the `/_next/static/...` asset paths in the HTML
  // — but it names the framework without being asked, on every response, and
  // turning it off costs nothing. Flagged against the live site by Aikido
  // 2026-08-16; verified present on leonaqt.com before this line was added.
  poweredByHeader: false,
  // Two dev servers in one worktree otherwise share `.next` and corrupt each
  // other's build cache, which surfaces as stale-resolve errors that survive a
  // restart. Unset everywhere except a second local server, so CI and the
  // Cloud Build image build (cloudbuild.web.yaml) use the usual directory.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Cloud Run spike (ai-ops gcp-migration-20260912 PLAN.md, "Hosting and
  // build" row): `output: "standalone"` traces the server's actual runtime
  // dependencies into `.next/standalone`, so a Docker image can ship a
  // minimal `node_modules` instead of the whole workspace. Opt-in on
  // NEXT_OUTPUT=standalone — a var set only by apps/web/Dockerfile's build
  // stage — so CI and a plain local `next build`/`next dev` are byte-for-byte
  // what they were before this key existed. Until Vercel was retired as a host
  // (ADR-0033, 2026-09-21) this also kept its build untouched: Vercel has its
  // own deployment artifact format and never read `output` at all, but an
  // untested `undefined` vs. explicitly-omitted distinction was not a risk
  // worth taking on the platform serving production at the time. Cloud Run is
  // now the only consumer of this output, via apps/web/Dockerfile.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? {
        output: "standalone" as const,
        // pnpm workspace root, two levels up from apps/web (where
        // pnpm-workspace.yaml and pnpm-lock.yaml live). apps/web depends on
        // @majorana/ui and @majorana/contracts-gen as `workspace:*`, both
        // resolved through the pnpm virtual store at the workspace root, not
        // under apps/web/node_modules — so file tracing has to be told the
        // root explicitly. Without this, Next infers the nearest lockfile
        // itself and its own docs warn that inference can pick the wrong
        // directory in a monorepo, silently leaving workspace packages out
        // of `.next/standalone`.
        //
        // `path.resolve(process.cwd(), "..", "..")`, not
        // `fileURLToPath(import.meta.url)`: this file is loaded through
        // Next's own config loader, which transpiles next.config.ts to
        // CommonJS via SWC on the legacy path (module: "commonjs" —
        // node_modules/next/dist/build/next-config-ts/transpile-config.js) and
        // only uses a native ESM `import()` when an internal flag enables
        // Node's TS-stripping loader. `import.meta` is unconditionally valid
        // ESM syntax; whether it survives that CJS transpile intact is a
        // question about the *build* platform's Next/Node combination, not
        // this repo's, and it would change nothing about `process.cwd()`,
        // which both module targets support identically. Measured, not
        // assumed: `pnpm --filter @majorana/web exec pwd` runs with apps/web
        // as the working directory in apps/web/Dockerfile — pnpm's `--filter`
        // sets cwd to the selected package before invoking its script, which
        // is why this resolves against `process.cwd()` rather than this
        // module's own location. (The same held for vercel.json's own
        // `buildCommand` there too, until Vercel was retired as a host —
        // ADR-0033.)
        outputFileTracingRoot: resolve(process.cwd(), "..", ".."),
      }
    : {}),
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
      // ## Why a CDN-specific header, not Cache-Control
      //
      // Next sends `cache-control: private, no-cache, no-store, max-age=0,
      // must-revalidate` on every dynamic page, and config headers here cannot
      // override a header the render itself sets. A targeted header that only
      // the edge reads is the way round that. Until 2026-09-21 this was
      // `Vercel-CDN-Cache-Control`, measured on a Vercel preview to beat the
      // `no-store` (one render served three consecutive GETs; plain
      // `Cache-Control` from this file did not). Vercel no longer serves the
      // site, so only `CDN-Cache-Control` — the IETF targeted-cache-control
      // header, which Cloudflare reads — is sent now. The browser still
      // receives `no-store`, deliberately: only the edge is meant to hold this.
      //
      // The failure mode if this stops working is silent in the worst
      // direction: the site keeps working and every Atlas page renders on
      // every request, which is the load shape behind the 2026-09-15 outage.
      //
      // ## The header is half of it, and the missing half is not in this repo
      //
      // A `no-store` `Cache-Control` still reaches the client here (see below),
      // and Cloudflare does not cache HTML at all by default regardless of what
      // any cache header says — it needs a Cache Rule naming these paths. So
      // this header alone does NOT make the Atlas cached on Cloudflare, and a
      // reader who checks only that this file is correct would conclude it is.
      // The paired Cache Rule lives in the Cloudflare dashboard and is recorded
      // in `docs/runbooks/web-cloud-run.md`; the check that settles whether it
      // works is a repeat request measured against `cf-cache-status: HIT`, the
      // and `verify-web-cache` runs that check after every web deploy.
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
      // depend on, so both are listed and the live check is `cf-cache-status:
      // HIT` on a repeat request, not a reading of the routing order.
      //
      // ## Only a plain request is marked cacheable for Cloudflare
      //
      // `edgeCacheRules` sends `CDN-Cache-Control` only when the request
      // carries no `RSC` header, no
      // `_rsc` parameter and no locale cookie. Cloudflare ignores `Vary`, so a
      // payload request would otherwise put the React payload (or Next's 307 to
      // it) in the edge cache under the address readers ask for. The account,
      // with the measurement, is in `lib/edge-cache-headers.ts`.
      ...["/repository/layers", "/:locale(en|ja)/repository/layers"].flatMap((base) =>
        [base, `${base}/:path*`].flatMap((source) => edgeCacheRules(source, 300)),
      ),
      // `/repository/folders` — same mechanism as `/repository/layers` above,
      // for the same reason: it resolves `?scheme=` on the server, so reading
      // `searchParams` opts it out of static rendering the same way, and the
      // long note above this block is the account for both routes, not just
      // the first. `:path*` is included because every folder below the root
      // (`/repository/folders/<kind>/<family>/...`) is equally public — see
      // `lib/routed-paths.ts`'s `LOCALE_PREFIX_ROUTES` for the same reasoning
      // applied to the middleware rewrite that has to reach it first.
      //
      // `/repository/papers` is deliberately NOT here: it and `/repository/
      // papers/[id]` read no `searchParams`, so they prerender outright (the
      // `claims` recipe) and reach the CDN through Next's own static output —
      // the same reason `/repository/claims` carries no header entry either.
      ...["/repository/folders", "/:locale(en|ja)/repository/folders"].flatMap((base) =>
        [base, `${base}/:path*`].flatMap((source) => edgeCacheRules(source, 300)),
      ),
      // The Atlas browse index, same mechanism, exact path ONLY — no `:path*`.
      // `/repository/layers` above deliberately covers its subtree
      // (`/repository/layers/<id>`) because every child there is equally
      // public; `/repository` must NOT do that, because its own children
      // (`/repository/<slug>`) are the entry pages that stay personalized and
      // uncached in `app/repository/` — see lib/routed-paths.ts. A `:path*`
      // here would cache them anyway, silently, at the platform layer, no
      // matter what the route protection says.
      ...["/repository", "/:locale(en|ja)/repository"].flatMap((source) => edgeCacheRules(source, 300)),
      // The public Qapp gallery index (proposal 6, item 2) — same mechanism and
      // same reasoning as `/repository` immediately above: it resolves `?q=`
      // and `?cursor=` on the server, so reading `searchParams` opts it out of
      // static rendering, and an edge cache in front of the render is what is
      // available instead. Exact path ONLY, not `:path*`: `/q/<slug>` pages are
      // personalized (they call `getMajoranaAuth()` to know whether the viewer
      // can execute) and must stay dynamic and uncached — the same split
      // `/repository` draws against `/repository/<slug>`. `/q` does not go
      // through the `/{locale}` rewrite (it is a plain top-level route, not
      // under `app/[locale]/`), so there is no locale-prefixed form to list.
      ...edgeCacheRules("/q", 300),
      // The view-only Qapp embed (ai-ops 355). Exact path AND `:path*`, unlike
      // `/q` above: every `/embed/q/<slug>` is the same shape of page as its
      // sibling and reads no per-visitor state at all (no `getMajoranaAuth()`,
      // no cookie of any kind — see app/embed/q/[slug]/page.tsx), so there is
      // no personalized child route this has to carve back out, the way
      // `/repository` has to exclude `/repository/<slug>`.
      ...EMBED_QAPP_SOURCES.flatMap((source) => edgeCacheRules(source, 300)),
      // The landing page's demo video and the wordmark, which are the first
      // binary assets this app has ever served.
      //
      // ## What the edge does without this
      //
      // Files under `public/` leave the server with
      // `cache-control: public, max-age=0, must-revalidate` (measured on a
      // Vercel preview, on the 6.8 MB mp4 itself). That is a conditional
      // request on every single page load. The 304 that comes back is cheap in
      // bytes and not cheap in time: it is a full round trip before the poster
      // frame can be trusted, on the largest asset the site owns, on the first
      // screen a visitor sees.
      //
      // ## One week at both layers, and not `immutable`
      //
      // Neither cache is keyed to a deployment. These filenames are not
      // content-hashed — they are `leona-product-demo.mp4` and a person will
      // eventually replace it in place with a re-cut of the same name — so any
      // TTL is how long a re-cut can stay invisible. A week bounds that while
      // still costing zero requests for every repeat visit inside it.
      //
      // The edge number used to be a year, because Vercel's edge cache WAS
      // keyed to a deployment and a new deploy could not serve a stale copy.
      // Cloudflare's is not: at a year, a replaced video would have been served
      // stale from the edge for up to a year unless someone purged it by hand.
      // If these ever gain a content hash, raise both numbers to a year and add
      // `immutable` in the same commit.
      ...["/media/:path*", "/brand/:path*"].map((source) => ({
        source,
        headers: [
          { key: "Cache-Control", value: "public, max-age=604800" },
          { key: "CDN-Cache-Control", value: "max-age=604800" },
        ],
      })),
      {
        // Every route, without exception: none of these five headers change
        // for the embed route (ai-ops 355 widens only `frame-ancestors`, and
        // `X-Frame-Options` cannot be selectively widened at all — see below).
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Denies the powerful browser features this product never asks for.
          // The list, the two deliberate omissions, and why `autoplay` is
          // `(self)` rather than `()` all live in lib/permissions-policy.ts —
          // extracted so it could be tested, which it never was before.
          { key: "Permissions-Policy", value: permissionsPolicy() },
        ],
      },
      {
        // Every route EXCEPT the embed subtree keeps the default anti-framing
        // policy, byte-for-byte. This can't be "every route, then a later,
        // more specific override for the embed route" — Next merges every
        // matching `source`'s headers, so a later entry can replace a value
        // for a key it ALSO sets (that's how `embedCsp` below replaces `csp`),
        // but it cannot un-set a key it never mentions. If this source were
        // the usual `/(.*)`, `/embed/q/<slug>` would still receive
        // `X-Frame-Options: DENY` from here even though the embed-specific
        // entry never sets that header — X-Frame-Options has no wildcard form,
        // so "no X-Frame-Options" is only reachable by never matching in the
        // first place. See `lib/embed-routes.ts` for the pattern itself and
        // `embed-routes.test.ts` for proof, against Next's own path matcher,
        // that it excludes exactly the embed subtree and nothing else.
        source: GENERAL_ANTI_FRAMING_SOURCE,
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
      // The embed route (ai-ops 355, owner ruling: "Any website may embed a
      // published Qapp"). Relaxed CSP only — no X-Frame-Options entry at all,
      // for the reason above, and no other header here: the block right above
      // this comment already covers `/embed/q/<slug>` for everything that
      // isn't framing-related.
      ...EMBED_QAPP_SOURCES.map((source) => ({
        source,
        headers: [{ key: "Content-Security-Policy", value: embedCsp }],
      })),
    ];
  },
};

export default nextConfig;
