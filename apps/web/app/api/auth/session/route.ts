import { NextResponse } from "next/server";
import { getMajoranaAuth, isMajoranaAuthConfigured } from "../../../../lib/auth";
import { majoranaSignInPath } from "../../../../lib/sign-in";
import { AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN, authHintCookieOptions } from "../../../../lib/auth-hint";

/**
 * The client-side half of the Atlas sign-in-status fix (ai-ops#94).
 *
 * ## The bug this exists to route around
 *
 * `PublicSite`'s `chrome="static"` pages (home, pricing, workspace, contact,
 * privacy, terms — everything served from `app/[locale]/` and held on the CDN
 * for 5 minutes) never call `getMajoranaAuth()` server-side, because that call
 * reaches a Dynamic API and would make the whole page uncacheable. So their
 * header always renders the signed-out state, baked into HTML shared by every
 * visitor, whether the visitor is actually signed in or not. `/repository`
 * (root) is `chrome="full"` — uncached, and it calls `getMajoranaAuth()` on
 * every request, so it always shows the real state. A signed-in reader
 * bouncing between the two sees the sign-in control change for no reason they
 * can see, which is the "different from other pages" the owner flagged.
 *
 * The fix is not to make the static pages dynamic (that reintroduces the cost
 * this split exists to avoid). It is to keep the page's HTML static and let a
 * small client-side fetch correct the header after hydration — this endpoint
 * is what that fetch calls. It is deliberately tiny: one boolean and one URL,
 * nothing that benefits from being part of the page's own render.
 *
 * `force-dynamic` plus the response header below keep this route itself off
 * any cache — it has to answer per-visitor or it reintroduces the exact bug
 * it exists to fix, one layer down.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await getMajoranaAuth();
  // The constant same-origin path, not the WorkOS authorization URL.
  //
  // A Route Handler MAY write cookies, so minting the real URL here does not
  // throw the way it does during a render — but under authkit-nextjs v4 PKCE is
  // unconditional, and `getSignInUrl()` seals a fresh verifier into a cookie
  // whose NAME is a hash of that flow's state. Every anonymous poll therefore
  // left behind another ~600-byte `wos-auth-verifier-<hash>` cookie, and
  // `<AuthStatus>` polls this endpoint from every `chrome="static"` page — so a
  // reader browsing the public site accumulated one per page view, toward the
  // HTTP 431 the library's own middleware path has a purge step to avoid.
  // Measured on 4.3.1 before this changed. Handing back the path defers the
  // whole hand-off to `app/auth/sign-in/route.ts`, where it happens once, after
  // a click.
  const signInHref = user ? null : isMajoranaAuthConfigured() ? majoranaSignInPath() : null;
  const signedIn = Boolean(user);
  const response = NextResponse.json(
    { signedIn, signInHref },
    { headers: { "Cache-Control": "private, no-store" } },
  );
  // Write the hint the next page will paint from (ai-ops issue 114). This route is
  // the only place that both knows the truth and is allowed to record it: it is
  // `force-dynamic` and `no-store`, so the `Set-Cookie` below cannot be stored
  // by the CDN and shown to somebody else. See `lib/auth-hint.ts` — doing this
  // from middleware or a page render would instead drop those pages out of the
  // cache entirely, since Vercel will not store a response carrying a cookie.
  if (signedIn) {
    response.cookies.set(AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN, authHintCookieOptions());
  } else {
    // Clearing matters as much as setting: a hint that outlives its session
    // paints "Sign out" at a signed-out reader, which is this bug inverted.
    response.cookies.delete(AUTH_HINT_COOKIE);
  }
  return response;
}
