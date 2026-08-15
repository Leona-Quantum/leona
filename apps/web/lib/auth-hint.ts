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
 * (`force-dynamic`, `no-store`) and `/auth/sign-out` (a redirect). It must never
 * be set from `middleware.ts` or from a page render — **Vercel will not store a
 * response carrying `Set-Cookie`**, so writing it there would quietly drop every
 * public page out of the CDN, which is the cost the `chrome="static"` split
 * exists to avoid in the first place. Fixing a flash by disabling the cache
 * would be a straight downgrade.
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
