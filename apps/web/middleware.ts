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
import { isLocalDevAuthEnabled } from "./lib/local-dev-auth";
import { isPublicDemoEnabled } from "./lib/public-demo";
import { isRoutedPath } from "./lib/routed-paths";

const PUBLIC_PATHS = [
  "/",
  "/auth/callback",
  // Logout must remain reachable after the session cookie is gone; the route
  // itself makes the operation idempotent for already-signed-out visitors.
  "/auth/sign-out",
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

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
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
