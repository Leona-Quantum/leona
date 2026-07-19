// Blast-radius file (CODEOWNERS). Secure by default: every matched route
// requires an AuthKit session unless listed in unauthenticatedPaths.
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isWorkosAuthConfigured } from "./lib/auth-config";
import { isLocalDevAuthEnabled } from "./lib/local-dev-auth";
import {
  isSingleUserLockEnabled,
  isValidSessionCookie,
  LOCK_COOKIE,
  LOCK_SIGN_IN_API,
  LOCK_SIGN_IN_PATH,
} from "./lib/single-user-lock";
import { isPublicDemoEnabled } from "./lib/public-demo";

const PUBLIC_PATHS = [
  "/",
  "/auth/callback",
  // Logout must remain reachable after the session cookie is gone; the route
  // itself makes the operation idempotent for already-signed-out visitors.
  "/auth/sign-out",
  // Single-user-lock sign-in page — reachable while signed out (and harmless in
  // WorkOS mode, where it just redirects home).
  "/lock-sign-in",
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
// This previously enumerated all 283 entry paths by importing the static corpus,
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

export default async function middleware(request: NextRequest, event: NextFetchEvent) {
  // Temporary single-user lock (Owner Inbox 2026-07-19). When enabled, the
  // authenticated surface — everything not in PUBLIC_PATHS, including every
  // /api/* route — is gated behind ONE username/password, and WorkOS is
  // bypassed entirely (no Google/GitHub sign-in). Public marketing pages stay
  // open. Flip SINGLE_USER_LOCK=false to restore WorkOS.
  //
  // Unlike the earlier Basic Auth gate, this uses a real sign-in page + signed
  // session cookie, so it behaves like WorkOS: enter the credential once, stay
  // signed in across navigation, and an unauthenticated request is REDIRECTED
  // to the sign-in page (not answered with a browser Basic Auth prompt).
  if (isSingleUserLockEnabled()) {
    const { pathname } = request.nextUrl;
    // The sign-in page and its POST endpoint must stay reachable while
    // signed out, alongside the normal public marketing pages.
    if (pathname === LOCK_SIGN_IN_PATH || pathname === LOCK_SIGN_IN_API || isPublicPath(pathname)) {
      return NextResponse.next();
    }
    if (await isValidSessionCookie(request.cookies.get(LOCK_COOKIE)?.value)) {
      return NextResponse.next();
    }
    // Signed out on a gated route. API calls get a clean 401 (no HTML
    // redirect for fetch); page navigations go to the sign-in page with a
    // returnTo so the user lands where they were headed.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const signInUrl = new URL(LOCK_SIGN_IN_PATH, request.url);
    signInUrl.searchParams.set("returnTo", pathname + request.nextUrl.search);
    return NextResponse.redirect(signInUrl);
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
// robots, sitemap); everything else goes through auth. Without the icon/metadata
// exclusions the single-user lock would redirect the favicon request itself to
// the sign-in page, so the tab icon vanished while signed out.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml).*)",
  ],
};
