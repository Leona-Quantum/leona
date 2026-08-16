// AuthKit redirect URI target — register http://localhost:3000/auth/callback
// (and the deployed equivalent) in the WorkOS dashboard.
import { handleAuth } from "@workos-inc/authkit-nextjs";
import { cookies } from "next/headers";
import { AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN, authHintCookieOptions } from "../../../lib/auth-hint";

// Land the signed-in user in the real workspace, not the /dashboard debug
// surface (Owner Inbox 2026-07-17: the raw /v1/me dump read as a broken page).
export const GET = handleAuth({
  returnPathname: "/run",
  /**
   * Write the auth hint at the moment the session is created (ai-ops issue 114,
   * "close that last case").
   *
   * ## The case this closes
   *
   * The hint lets a CDN-cached page paint the right header on its first frame,
   * but until now the only writer was `/api/auth/session`, which a page calls
   * AFTER it hydrates. So the hint was always written by the page before — and
   * the first public page opened straight after signing in had no page before
   * it. That one page still flashed "Sign in" and shifted the top bar, which is
   * exactly the symptom the fix was for. Every page after it was already right.
   *
   * ## Why `onSuccess` and not the response
   *
   * `onSuccess` is AuthKit's own hook and it is awaited on the success path
   * ONLY — a callback that fails on a missing code, an unverifiable PKCE
   * cookie, or a state mismatch returns through `errorResponse` without ever
   * reaching here. That matters more than it looks: writing the hint on a
   * failed callback would paint "Sign out" at somebody who is not signed in,
   * which is this bug inverted and worse than the flash it replaces.
   *
   * Mutating `cookies()` rather than the redirect works for the same reason the
   * session cookie itself does — AuthKit's `saveSession` writes through the
   * same store two lines above this call, and Next merges those mutations into
   * the response it returns. So this rides a path already proven in production
   * rather than a new one.
   *
   * Setting a cookie here does not cost a cache entry: `/auth/callback` is a
   * redirect that AuthKit already stamps `Vary: Cookie` and cache-prevention
   * headers on, so there was never anything to store. That is the constraint
   * `lib/auth-hint.ts` documents, and this is inside it, not an exception.
   */
  onSuccess: async () => {
    (await cookies()).set(AUTH_HINT_COOKIE, AUTH_HINT_SIGNED_IN, authHintCookieOptions());
  },
});
