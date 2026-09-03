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
 *
 * `/repository` is the one entry here that shares its first segment with
 * `ROUTED_SEGMENTS` and with `LOCALE_PREFIX_ROUTES` — see the "What moved
 * here" section below `LOCALE_PREFIX_ROUTES` for why that split is safe.
 */
export const LOCALE_ROUTES: readonly string[] = [
  "/",
  "/about",
  "/contact",
  "/pricing",
  "/privacy",
  "/repository",
  "/terms",
  "/workspace",
];

/**
 * The Atlas subtrees served from `app/[locale]/repository/`, matched as a path
 * PLUS everything under it — unlike `LOCALE_ROUTES`, which is exact.
 *
 * A prefix list rather than more `LOCALE_ROUTES` entries because
 * `/repository/layers/<id>` is around 72% of everything this site serves and
 * there are some 800 such ids, so enumerating them in middleware would put the
 * layer graph into the Edge bundle — the data dependency the AuthKit matcher
 * comment above already records getting rid of once.
 *
 * ## What is NOT here, and why the omission is the interesting part
 *
 * `/repository/<slug>` — the entry pages — stay in `app/repository/` and stay
 * uncached. They call `getMajoranaAuth()` per record to decide what the export
 * button offers, so each is personalized by construction; a shared cache entry
 * would be the bug, not the goal. Everything listed here reads no per-visitor
 * state at all.
 *
 * `/repository` itself used to be uncached for the same reason and is not
 * anymore — see the section below. It is NOT in this array: it moved to
 * `LOCALE_ROUTES` (exact), not here (prefix), because a prefix match on the
 * bare `/repository` would also swallow `/repository/<slug>` as a
 * "descendant" and rewrite the one subtree that must stay personalized.
 * `routed-paths.test.ts` asserts `localePrefixRoute("/repository")` is null
 * for exactly this reason.
 *
 * That split is what makes the ordering below load-bearing. `app/repository/`
 * still has a `[slug]` segment, so an unrewritten `/repository/layers` would
 * match it, look up a record called "layers", find none and 404. The failure is
 * a 404 rather than a wrong page, which is the right way round — but it is
 * silent, so `routed-paths.test.ts` checks this list against
 * `app/[locale]/repository/` on disk in both directions.
 *
 * ## What moved here: `/repository` itself
 *
 * Until ai-ops#94's follow-up, `/repository` (the Atlas browse index) called
 * `getMajoranaAuth()` on the server for the same reason `/repository/<slug>`
 * still does — to decide what each entry's "Add to Studio" button offers —
 * which is a Dynamic API and made the whole route uncacheable. Measured
 * uncached: 960,478 bytes decoded, MISS on every request, no matter how many
 * times the same URL was asked for.
 *
 * The fix moved the page to `app/[locale]/repository/(browse)/page.tsx` (a
 * route group, so it resolves to `/repository` with no extra path segment) and
 * removed the auth call. The header's sign-in state now comes from
 * `PublicSite`'s `chrome="static"` + `<AuthStatus>` (ai-ops#94 — the same
 * mechanism the six `LOCALE_ROUTES` marketing pages already use); the export
 * button's now comes from `RepositoryBrowser`'s own client-side fetch to
 * `/api/auth/session`. Neither reads auth during the server render, so the
 * render is identical for every visitor and the response holds on the CDN
 * behind the `Vercel-CDN-Cache-Control` header in `next.config.ts` — exact
 * path only, not a `:path*` subtree, so `/repository/<slug>` is untouched by
 * it either way.
 *
 * `/repository`'s first segment, "repository", therefore now does three
 * different things depending on the exact path: `LOCALE_ROUTES` rewrites the
 * bare path, `LOCALE_PREFIX_ROUTES` rewrites two named subtrees below it, and
 * `ROUTED_SEGMENTS` still routes everything else (`/repository/<slug>`,
 * `/repository/papers`, `/repository/folders`) through `app/repository/` as
 * before. `routed-paths.test.ts` checks all three against the filesystem.
 */
export const LOCALE_PREFIX_ROUTES: readonly string[] = [
  "/repository/claims",
  "/repository/layers",
];

/**
 * Does `pathname` sit inside one of the prefix subtrees above?
 *
 * Exact match or a `/`-delimited descendant, never a bare `startsWith`:
 * `/repository/layersinger` is not `/repository/layers`, and letting it match
 * would rewrite it into a route that does not exist while telling the auth gate
 * it had been handled.
 */
export function localePrefixRoute(pathname: string): string | null {
  return LOCALE_PREFIX_ROUTES.find(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  ) ?? null;
}

export const ROUTED_SEGMENTS: readonly string[] = [
  "account",
  "api",
  "auth",
  "dashboard",
  "demo",
  "dev",
  "lab",
  "library",
  // `/llms.txt` (ai-ops 133). It sits here and not with `robots.txt` or
  // `sitemap.xml` because those two use Next's metadata FILE conventions —
  // `app/robots.ts`, `app/sitemap.ts` — which contribute no directory and so
  // never reach this list. There is no `llms` convention, so it has to be a
  // Route Handler at `app/llms.txt/route.ts`, and a Route Handler is a
  // directory, which makes it a real first segment.
  //
  // Public by design and safe to be: the handler reads only compile-time
  // constants, sets no cookie, and touches no session, so nothing about it
  // needs the auth gate. Being listed is what stops the middleware treating it
  // as an unrouted path.
  "llms.txt",
  "open-source",
  "q",
  "qapps",
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
