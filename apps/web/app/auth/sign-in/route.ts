import { NextResponse } from "next/server";
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

export async function GET() {
  if (!isMajoranaAuthConfigured()) {
    return NextResponse.redirect(new URL("/contact", process.env.NEXT_PUBLIC_SITE_URL ?? "https://leonaqt.com"));
  }
  return NextResponse.redirect(await getMajoranaSignInUrl());
}
