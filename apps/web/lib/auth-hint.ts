/**
 * The auth *hint* — a non-secret, non-httpOnly cookie whose only job is to let
 * a cached page paint the right header on the first frame (ai-ops issue 114).
 *
 * ## What it fixes
 *
 * `PublicSite`'s `chrome="static"` pages are held on the CDN, so their HTML is
 * shared by every visitor and cannot name one. The header therefore shipped the
 * signed-out control to everybody and corrected it after hydration, from
 * `/api/auth/session`. Because every link in that header is a plain `<a>`, each
 * navigation is a full page load — so a signed-in reader paid that correction
 * again on every page, saw "Sign in" flash for a beat, and watched the top bar
 * shift as the sign-out link appeared next to it.
 *
 * This cookie carries the one bit the cached HTML is missing. An inline script
 * in the root layout reads it before first paint and stamps
 * `<html data-auth="in" | "out">`; the header renders BOTH controls and lets CSS
 * choose. Server and client render identical markup, so hydration has nothing to
 * reconcile, and the visible answer is correct in the first frame instead of the
 * second.
 *
 * ## Why a cookie and not localStorage
 *
 * Sign-out is a server redirect through `/auth/sign-out`; the client never runs
 * again on that page to clear its own storage. A cookie can be deleted by the
 * same request that ends the session, which keeps the hint from outliving it.
 *
 * ## Where it may be written, and where it may NOT
 *
 * Only from routes that are already uncacheable: `/api/auth/session`
 * (`force-dynamic`, `no-store`), `/auth/callback` (a redirect, and never
 * cacheable — AuthKit stamps `Vary: Cookie` and cache-prevention headers on it
 * itself) and `/auth/sign-out` (a redirect). It must never be set from
 * `middleware.ts` or from a page render — **Vercel will not store a response
 * carrying `Set-Cookie`**, so writing it there would quietly drop every public
 * page out of the CDN, which is the cost the `chrome="static"` split exists to
 * avoid in the first place. Fixing a flash by disabling the cache would be a
 * straight downgrade.
 *
 * ## Why the callback writes it too
 *
 * `/api/auth/session` can only run after a page has hydrated, so it is always
 * one page too late for the page the reader is looking at. That was the single
 * case left open when this shipped: sign in, and the FIRST public page you land
 * on still corrects itself, because the hint is written by the fetch that page
 * makes rather than by the sign-in that preceded it. `/auth/callback` is the
 * one place that knows the session exists before any page renders, so writing
 * it there closes the gap at the source (owner: "close that last case").
 *
 * ## What it is not
 *
 * Not a credential and not a gate. It is a boolean about presentation, readable
 * and forgeable by the visitor's own browser, and nothing is authorised by it.
 * Every real check still goes through WorkOS on the server. The worst a stale or
 * forged value can do is paint the wrong control for one frame, which the
 * existing `/api/auth/session` fetch then corrects — the same correction that
 * used to run on every page, now only when the hint is actually wrong.
 */
export const AUTH_HINT_COOKIE = "mj_auth";

/** The only value that means "signed in". Anything else is treated as signed out. */
export const AUTH_HINT_SIGNED_IN = "1";

/**
 * Kept in step with the WorkOS session rather than the browser session: a hint
 * that outlived its session would paint "Sign out" to a signed-out reader on
 * every visit, which is the current bug with the sign reversed. Thirty days is
 * an upper bound, not a promise — `/api/auth/session` rewrites or clears it on
 * every static page a reader opens.
 */
export const AUTH_HINT_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * The cookie options both writers use, so the two cannot drift apart.
 *
 * Two routes now set this cookie — `/api/auth/session` and `/auth/callback` —
 * and a hint written with different attributes by one of them is not the same
 * cookie to the browser. A `path` mismatch in particular yields TWO `mj_auth`
 * cookies, at which point which one the pre-paint script reads depends on
 * ordering rather than on the truth. That is the failure this function exists
 * to make impossible; the test asserts both call sites go through it rather
 * than spelling the attributes out.
 *
 * A function and not a frozen object because of `secure`: as a module-level
 * constant it would freeze `NODE_ENV` at import, which is the same value in
 * practice but silently wrong the moment anything evaluates it earlier.
 *
 * `httpOnly: false` is the whole point and not an oversight — the only consumer
 * is an inline script in `app/layout.tsx` that must read it before first paint,
 * and this cookie authorises nothing (see the module header).
 */
export function authHintCookieOptions() {
  return {
    httpOnly: false, // read by the pre-paint script in `app/layout.tsx`
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_HINT_MAX_AGE_SECONDS,
  } as const;
}
