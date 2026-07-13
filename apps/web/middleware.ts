// Blast-radius file (CODEOWNERS). Secure by default: every matched route
// requires an AuthKit session unless listed in unauthenticatedPaths.
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { isWorkosAuthConfigured } from "./lib/auth-config";
import { isLocalDevAuthEnabled } from "./lib/local-dev-auth";
import { isPublicDemoEnabled } from "./lib/public-demo";

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    // The callback handles the code exchange BEFORE a session exists — gating
    // it would break every login.
    unauthenticatedPaths: ["/", "/auth/callback", ...(isPublicDemoEnabled() ? ["/demo"] : [])],
  },
});

export default function middleware(request: NextRequest, event: NextFetchEvent) {
  if (isLocalDevAuthEnabled()) return NextResponse.next();
  if (!isWorkosAuthConfigured()) {
    const { pathname } = request.nextUrl;
    if (pathname === "/" || pathname === "/demo" || pathname === "/auth/callback") {
      return NextResponse.next();
    }
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
