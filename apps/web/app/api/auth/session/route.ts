import { NextResponse } from "next/server";
import { getMajoranaAuth, getMajoranaSignInUrl, isMajoranaAuthConfigured } from "../../../../lib/auth";

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
  const signInHref = user
    ? null
    : isMajoranaAuthConfigured()
      ? await getMajoranaSignInUrl()
      : null;
  return NextResponse.json(
    { signedIn: Boolean(user), signInHref },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
