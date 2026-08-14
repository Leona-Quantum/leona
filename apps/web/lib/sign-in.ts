import { safeReturnTo } from "./return-to.ts";

export type SignInFailureReason = "not_configured" | "provider_unavailable";

/**
 * The same-origin entrypoint that starts sign-in.
 *
 * A constant string, so a CDN-cached page can link to it: the per-request part
 * (the WorkOS authorization URL, and its one-shot PKCE challenge) is minted
 * inside `app/auth/sign-in/route.ts` after the click, never during a render.
 * See that file for why putting it in the page is wrong twice.
 */
export function majoranaSignInPath(returnTo: string | null | undefined = "/run"): string {
  const query = new URLSearchParams({ returnTo: safeReturnTo(returnTo) });
  return `/auth/sign-in?${query.toString()}`;
}

/**
 * Where the sign-in route sends a visitor when it could not hand them off.
 *
 * Carries only bounded, non-sensitive diagnostics: a reason from a closed set,
 * a request id the logs also carry so a report can be matched to a line, and a
 * `returnTo` that has been through `safeReturnTo` so the retry link cannot be
 * turned into an open redirect by whoever crafted the original URL.
 */
export function signInFailurePath(
  reason: SignInFailureReason,
  requestId: string,
  returnTo: string | null | undefined,
): string {
  const query = new URLSearchParams({
    reason,
    requestId: requestId.slice(0, 64),
    returnTo: safeReturnTo(returnTo),
  });
  return `/auth/sign-in/error?${query.toString()}`;
}
