import { NextResponse, type NextRequest } from "next/server";
import { getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../lib/auth";

/**
 * A constant href that starts sign-in, so a cached page can link to it.
 *
 * The header's sign-in link used to be the WorkOS authorization URL itself,
 * built during render by `getSignInUrl()`. That URL is per-request by
 * construction — `get-authorization-url.js:34` reads `x-redirect-uri` off
 * `headers()`, and with `WORKOS_ENABLE_PKCE=true` it would also carry a
 * one-shot code challenge. Putting either inside a page the CDN keeps for five
 * minutes is wrong twice: it makes the page uncacheable today, and it would
 * hand every visitor one other visitor's challenge if PKCE were ever switched
 * on. Redirecting through a route handler keeps the per-request part
 * per-request and leaves the page a constant string.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  // `getMajoranaSignInUrl()` returns an absolute WorkOS URL in every deployed
  // environment and the RELATIVE "/run" under local dev auth (lib/auth.ts:46),
  // and Next 16 rejects a relative argument to `NextResponse.redirect` outright.
  // Resolving against `request.url` handles both without asking which one it is:
  // an absolute input is returned unchanged, a relative one is resolved against
  // the host the reader actually arrived on — which also keeps this correct on
  // preview deployments and on each of the site's several hostnames, where a
  // hardcoded origin would have sent them somewhere else to sign in.
  const target = isMajoranaAuthConfigured() ? await getMajoranaSignInUrl() : "/contact";
  return NextResponse.redirect(new URL(target, request.url));
}
