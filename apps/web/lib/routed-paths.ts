/**
 * Which first path segments the App Router actually serves.
 *
 * Middleware runs *before* routing, so it has no idea whether a path resolves
 * to a page. Without this list every unknown URL — a typo, a stale bookmark, a
 * crawler probing `/vault` — was fed to the auth gate, which did the only thing
 * it can do with a signed-out visitor and 307'd them to
 * `api.workos.com/user_management/authorize`. A visitor who mistyped a Leona
 * Quantum URL ended up on somebody else's sign-in screen, with the site's own
 * 404 unreachable because middleware answered first.
 *
 * A path whose first segment is not here matches no route, so letting it
 * through costs nothing: Next renders `app/not-found.tsx` with a real 404.
 *
 * Keeping the list correct is what stops the fall-through from becoming a hole.
 * `routed-paths.test.ts` reads `app/` and fails if a routed segment is missing
 * here (a page that would then be served with no auth gate at all) or if an
 * entry here has no route (dead weight that would swallow a 404 and send the
 * visitor to WorkOS again). Add a top-level route, add it here — the test says
 * so before CI does.
 */
/**
 * The public paths served out of `app/[locale]/` through a middleware rewrite.
 *
 * These do NOT appear in ROUTED_SEGMENTS, and that is not an oversight.
 * `middleware.ts` answers them before `isRoutedPath()` is ever consulted — it
 * rewrites `/pricing` to `/en/pricing` or `/ja/pricing` and returns. So the
 * fall-through never sees them, and listing them would be a claim about a code
 * path that does not run.
 *
 * What DOES still reach `isRoutedPath()` is a deeper path like
 * `/pricing/anything`, which matches no route and should 404. That is why
 * `pricing` and its siblings were removed from ROUTED_SEGMENTS when they moved.
 *
 * Every entry here is public by construction: the rewrite bypasses the auth
 * gate deliberately, because AuthKit refreshes the session on every request it
 * sees and Vercel will not cache a response carrying `Set-Cookie`. Adding a
 * path here therefore publishes it. `routed-paths.test.ts` checks this list
 * against what `app/[locale]/` actually serves, in both directions.
 */
export const LOCALE_ROUTES: readonly string[] = [
  "/",
  "/contact",
  "/pricing",
  "/privacy",
  "/terms",
  "/workspace",
];

export const ROUTED_SEGMENTS: readonly string[] = [
  "account",
  "api",
  "auth",
  "dashboard",
  "demo",
  "dev",
  "lab",
  "library",
  "open-source",
  "repository",
  "run",
  "shared",
  "studio",
  "upgrade",
  "welcome",
];

const ROUTED = new Set(ROUTED_SEGMENTS);

/**
 * Does `pathname` fall inside a part of the app that has routes?
 *
 * Deliberately coarse: it answers at the first segment only. `/repository/does-
 * not-exist` is "routed" and stays behind whatever gate `/repository` has —
 * that segment's own `notFound()` decides the 404, and the answer must not
 * depend on data the middleware would have to load. What this separates is
 * "somewhere in the app" from "nowhere in the app".
 */
export function isRoutedPath(pathname: string): boolean {
  if (pathname === "/" || pathname === "") return true;
  // "/pricing/" and "/pricing" both yield "pricing"; a leading empty segment is
  // impossible because Next always gives an absolute pathname.
  const first = pathname.split("/")[1] ?? "";
  return ROUTED.has(first);
}
