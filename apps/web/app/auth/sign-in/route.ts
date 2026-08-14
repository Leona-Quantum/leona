import { NextResponse, type NextRequest } from "next/server";
import { getMajoranaAuthorizationUrl, isMajoranaAuthConfigured } from "../../../lib/auth";
import { safeReturnTo } from "../../../lib/return-to";
import { signInFailurePath } from "../../../lib/sign-in";

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
 *
 * It is also the only place a sign-in attempt is observable. Every hand-off
 * carries a request id that the logs and the failure page both quote, so a
 * report of "sign-in didn't work" can be matched to a line rather than guessed
 * at. Before this, a provider outage surfaced as an unhandled 500 on click.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Honour where the visitor was headed. `safeReturnTo` fails closed to "/run",
  // so a crafted `?returnTo=` cannot turn this into an open redirect.
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"));
  const requestId = crypto.randomUUID();

  if (!isMajoranaAuthConfigured()) {
    console.error("sign-in redirect refused: authentication is not configured", { requestId });
    return NextResponse.redirect(
      new URL(signInFailurePath("not_configured", requestId, returnTo), request.url),
      303,
    );
  }

  try {
    // Generate only after the click: the provider hop stays fresh, and every
    // attempt becomes visible at this deployment boundary.
    const target = await getMajoranaAuthorizationUrl(returnTo);
    console.info("sign-in redirect started", { requestId });
    // `getMajoranaAuthorizationUrl()` returns an absolute WorkOS URL in every
    // deployed environment and a RELATIVE path under local dev auth, and Next 16
    // rejects a relative argument to `NextResponse.redirect` outright. Resolving
    // against `request.url` handles both without asking which one it is: an
    // absolute input is returned unchanged, a relative one is resolved against
    // the host the reader actually arrived on — which also keeps this correct on
    // preview deployments and on each of the site's several hostnames, where a
    // hardcoded origin would have sent them somewhere else to sign in.
    return NextResponse.redirect(new URL(target, request.url));
  } catch (cause) {
    // Never the provider's message: it can carry request details, and it is not
    // something a visitor can act on. The name alone is enough to triage with,
    // and the request id is what ties this line to the page they are looking at.
    const error = cause instanceof Error ? cause : new Error("unknown sign-in provider error");
    console.error("sign-in redirect failed", { requestId, errorName: error.name });
    return NextResponse.redirect(
      new URL(signInFailurePath("provider_unavailable", requestId, returnTo), request.url),
      303,
    );
  }
}
