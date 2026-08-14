// Blast-radius file (CODEOWNERS). Secure by default: every matched route
// requires an AuthKit session unless listed in unauthenticatedPaths.
//
// One exception, and it is not a route: a path whose first segment matches no
// route at all falls through unauthenticated so Next can answer with the site's
// own 404 (lib/routed-paths.ts). Nothing is behind those paths to protect —
// what the gate was doing instead was 307ing every typo to WorkOS. The list of
// routed segments is checked against app/ by lib/routed-paths.test.ts, so a new
// top-level route cannot slip out of this gate by being forgotten.
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isWorkosAuthConfigured } from "./lib/auth-config";
import { canonicalLocaleTarget } from "./lib/canonical-locale-redirect";
import { isLocalDevAuthEnabled } from "./lib/local-dev-auth";
import { pageviewLoggingEnabled, pageviewSignal } from "./lib/pageview-signal";
import { LEGACY_PUBLIC_LOCALE_COOKIE, parsePublicLocale, PUBLIC_LOCALE_COOKIE, PUBLIC_LOCALES } from "./lib/public-locale";
import { isPublicDemoEnabled } from "./lib/public-demo";
import { isRoutedPath, LOCALE_ROUTES } from "./lib/routed-paths";
import { canonicalHostRedirect } from "./lib/site-origin";

const PUBLIC_PATHS = [
  "/",
  "/auth/callback",
  // Logout must remain reachable after the session cookie is gone; the route
  // itself makes the operation idempotent for already-signed-out visitors.
  "/auth/sign-out",
  // The header's sign-in link on a cached page. It must be reachable without a
  // session for the same reason /auth/callback is: it is what a signed-out
  // reader clicks to get one.
  "/auth/sign-in",
  "/pricing",
  "/repository",
  "/workspace",
  "/open-source",
  "/contact",
  "/privacy",
  "/terms",
  ...(isPublicDemoEnabled() ? ["/demo"] : []),
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`));
}

// The two matchers have DIFFERENT syntaxes and must be kept in step deliberately.
// isPublicPath() above treats each entry as an exact path plus its subtree, so
// "/repository" already covers "/repository/<slug>". authkitMiddleware instead
// uses Next.js matcher glob syntax, where "/repository" matches that path ONLY —
// so the subtree has to be spelled out as a pattern.
//
// This previously enumerated every entry path by importing the static corpus,
// which forced the entire repository dataset into the Edge bundle at cold start
// and made the middleware a build-time consumer of data that Slice D moves behind
// an async API call. The glob is equivalent and carries no data dependency.
const WORKOS_UNAUTHENTICATED_PATHS = [...PUBLIC_PATHS, "/repository/:path*"];

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    // The callback handles the code exchange BEFORE a session exists — gating
    // it would break every login.
    unauthenticatedPaths: WORKOS_UNAUTHENTICATED_PATHS,
  },
});

// The fall-through for paths that match no route at all (see lib/routed-paths.ts).
//
// It is a second AuthKit instance rather than a bare NextResponse.next() because
// authkit-nextjs refuses to answer `withAuth()` on a request that did not pass
// through its middleware — it throws, by design, so that a forgotten matcher is
// loud. The 404 page renders the ordinary public shell, whose header asks who
// you are, so a bare next() would have turned every unknown URL into a 500.
// With `middlewareAuth` left at its default (disabled) this instance refreshes
// the session and stamps the headers `withAuth()` needs, and redirects nobody.
const unauthenticatedFallThrough = authkitMiddleware();

/**
 * Write one line per public pageview to the runtime log, and change nothing.
 *
 * This is the whole public analytics implementation. It lives here because
 * middleware is the only place that runs exactly once per request, sees the
 * prefetch headers that distinguish a read from a hover, and is already being
 * invoked — so counting costs no extra function invocation, no database write,
 * and no call to the API service. Every alternative sink was rejected on cost:
 * see `docs/runbooks/pageviews.md`.
 *
 * It is inert with respect to authentication by construction: it takes no
 * decision, touches neither the request nor the response, cannot return, and
 * swallows everything. `pageviewSignal` also never throws. In a blast-radius
 * file the belt and the braces are both deliberate — a counter that 500s the
 * site is worse than no counter.
 */
function countPageview(request: NextRequest): void {
  try {
    // Named statically, not read off `process.env` inside the helper. Next
    // inlines edge-runtime environment variables only where it can see the key
    // at build time, so a dynamic lookup here would always come back undefined
    // and the off switch would silently never turn anything off.
    if (!pageviewLoggingEnabled({ LEONA_PAGEVIEW_LOG: process.env.LEONA_PAGEVIEW_LOG })) return;
    const signal = pageviewSignal({
      method: request.method,
      pathname: request.nextUrl.pathname,
      headers: request.headers,
      selfHost: request.nextUrl.host,
      now: new Date(),
    });
    if (signal === null) return;
    // One line, one JSON object, no interpolation — the read-back procedure
    // greps for the marker and parses the rest.
    console.log(JSON.stringify(signal));
  } catch {
    // A metric is never worth a request.
  }
}

/**
 * The public paths served from a `[locale]` route, and answered here.
 *
 * ## Why the rewrite exists at all
 *
 * These pages render different copy per language, so one cache entry cannot
 * serve both — the locale has to be part of the cache key, and on Vercel the
 * cache key is the path. The alternative, reading the cookie during render,
 * is a Dynamic API and is exactly what kept the whole site off the CDN.
 *
 * The rewrite is internal, so the reader keeps `/pricing` in the address bar
 * and still gets `/en/pricing` or `/ja/pricing` out of the edge cache. That an
 * internally-rewritten request is served from the CDN at all is measured, not
 * assumed — no Vercel documentation answers it, and the one page on "rewrite
 * caching" covers EXTERNAL rewrites, a different mechanism. A preview
 * deployment of `spike/locale-rewrite-caching` returned PRERENDER, HIT, HIT on
 * three consecutive GETs of `/pricing` with a byte-identical render timestamp,
 * against a MISS, MISS, MISS control on an untouched page in the same run.
 *
 * ## Why these paths never reach AuthKit, which is load-bearing
 *
 * `authkitMiddleware` refreshes the session on every request it sees, and
 * Vercel will not store a response carrying `Set-Cookie`. A public page that
 * kept the gate could therefore never cache for a signed-in reader. These paths
 * are public by definition — every one of them is already in PUBLIC_PATHS — so
 * the gate has nothing to decide about them.
 *
 * The pageview counter is unaffected: it runs before this, and therefore still
 * counts the clean path the reader typed rather than the rewritten one.
 */
const LOCALE_ROUTE_SET = new Set(LOCALE_ROUTES);

function readLocale(request: NextRequest) {
  return parsePublicLocale(
    request.cookies.get(PUBLIC_LOCALE_COOKIE)?.value
      ?? request.cookies.get(LEGACY_PUBLIC_LOCALE_COOKIE)?.value,
  );
}

function localeRewrite(request: NextRequest): NextResponse | null {
  const { pathname } = request.nextUrl;
  if (!LOCALE_ROUTE_SET.has(pathname)) return null;
  const locale = readLocale(request);
  const target = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
  return NextResponse.rewrite(new URL(target, request.url));
}

/**
 * `/en/pricing` is a real, reachable route once the pages move under
 * `[locale]`, and leaving it reachable would publish every public page at two
 * addresses. One canonical URL, so send it back to the clean one.
 *
 * No loop: the rewrite above is internal, so the browser is never asked for the
 * prefixed form and never arrives here carrying it.
 *
 * The target is built by `lib/canonical-locale-redirect.ts`, which is where the
 * reason it is not a one-liner is written down: this runs before the auth gate,
 * so handing an attacker-influenced tail to the relative `new URL(str, base)`
 * form made it an unauthenticated open redirect off this origin.
 */
function canonicalRedirect(request: NextRequest): NextResponse | null {
  const target = canonicalLocaleTarget(request.nextUrl.pathname, request.url, PUBLIC_LOCALES);
  if (target === null) return null;
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 308);
}

/**
 * Send the three non-canonical hosts to `leonaqt.com` (ai-ops#83), path and
 * query intact.
 *
 * 308 rather than 301 or 307: permanent, so a crawler moves its index across
 * and a browser stops asking, and method-preserving, so a POST that arrives on
 * the wrong host is replayed rather than silently turned into a GET.
 *
 * The host list and the destination are in `lib/site-origin.ts` — see there for
 * why it is an allowlist of three rather than "everything that is not
 * canonical", which is the version that breaks every preview deployment.
 *
 * ## Not covered by the matcher, on purpose
 *
 * `config.matcher` at the bottom of this file excludes `_next/static`,
 * `_next/image` and the file-convention metadata routes, so those are not
 * redirected. That is the right outcome and not an oversight: the document
 * itself is redirected before the browser asks for anything, so by the time an
 * asset is requested the page is already on the canonical host, and adding a
 * hop in front of every static file would cost a round trip per asset for a
 * case that does not arise.
 */
function canonicalHost(request: NextRequest): NextResponse | null {
  const host = request.headers.get("host") ?? request.nextUrl.host;
  const target = canonicalHostRedirect(host, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return target === null ? null : NextResponse.redirect(target, 308);
}

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Ahead of the counter, and it is the one thing that may be. A request on a
  // non-canonical host is answered with a redirect and nothing else — the
  // reader has not read a page yet, and the request that serves them one is
  // counted on the next line of the next request. Counting both would inflate
  // every figure on those hosts by exactly one, and this counter has no
  // de-duplication to absorb it (`lib/pageview-signal.ts`: it counts pageviews,
  // never people).
  const canonicalHostHop = canonicalHost(request);
  if (canonicalHostHop) return canonicalHostHop;
  // First among the things that answer a request, and before any early return:
  // the counter's contract is that it runs exactly once per request. It is also
  // why placement here is safe next to the 404 fall-through below —
  // `publicRoute()` returns null for anything outside PAGEVIEW_ROUTES, all of
  // which are routed paths, so an unrouted URL logs nothing either way.
  // Counting first keeps that true if the route list ever grows.
  countPageview(request);
  // Both before the gate. The rewrite serves a cached page; the redirect
  // collapses the locale-prefixed form back onto the clean one.
  const rewritten = localeRewrite(request);
  if (rewritten) return rewritten;
  const canonical = canonicalRedirect(request);
  if (canonical) return canonical;
  // Before the gate, deliberately: an auth gate handed a path that resolves to
  // nothing can only send the visitor to AuthKit, so a typo, a stale bookmark
  // or a crawler landed on api.workos.com's sign-in screen. Nothing is exposed
  // by letting these through — there is no route behind them, so Next answers
  // with app/not-found.tsx and a 404.
  if (!isRoutedPath(request.nextUrl.pathname)) {
    if (isLocalDevAuthEnabled() || !isWorkosAuthConfigured()) return NextResponse.next();
    return unauthenticatedFallThrough(request, event);
  }
  if (isLocalDevAuthEnabled()) return NextResponse.next();
  if (!isWorkosAuthConfigured()) {
    const { pathname } = request.nextUrl;
    if (isPublicPath(pathname)) return NextResponse.next();
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
    }
    return NextResponse.redirect(new URL("/", request.url));
  }
  return workosMiddleware(request, event);
}

// Skip static assets and file-convention metadata routes (icons, manifest,
// robots, sitemap); everything else goes through auth. These exclusions were
// added because the single-user lock redirected the favicon request itself to
// its sign-in page and the tab icon vanished while signed out. The lock is gone;
// the exclusions are not lock-specific and stay — any auth gate would do the
// same to a metadata route.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
