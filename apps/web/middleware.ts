// Blast-radius file (CODEOWNERS). Secure by default: every matched route
// requires an AuthKit session unless listed in unauthenticatedPaths.
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isWorkosAuthConfigured } from "./lib/auth-config";
import { isLocalDevAuthEnabled } from "./lib/local-dev-auth";
import { isPublicDemoEnabled } from "./lib/public-demo";
import { PUBLIC_REPOSITORY_ENTRIES } from "./lib/public-repository";

const PUBLIC_PATHS = [
  "/",
  "/auth/callback",
  "/pricing",
  "/repository",
  ...PUBLIC_REPOSITORY_ENTRIES.map((entry) => `/repository/${entry.slug}`),
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

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    // The callback handles the code exchange BEFORE a session exists — gating
    // it would break every login.
    unauthenticatedPaths: PUBLIC_PATHS,
  },
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
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

// Skip static assets; everything else goes through auth.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
