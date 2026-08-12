import { safeReturnTo } from "./return-to.ts";

export type SignInFailureReason = "not_configured" | "provider_unavailable";

/** A same-origin entrypoint, so every sign-in attempt reaches our logs first. */
export function majoranaSignInPath(returnTo: string | null | undefined = "/run"): string {
  const query = new URLSearchParams({ returnTo: safeReturnTo(returnTo) });
  return `/auth/sign-in?${query.toString()}`;
}

/** A non-sensitive error location carrying only bounded diagnostic metadata. */
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
