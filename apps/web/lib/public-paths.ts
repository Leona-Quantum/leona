/**
 * The paths that answer without an AuthKit session — in both of the syntaxes
 * `middleware.ts` needs them in, derived from one list so they cannot disagree.
 *
 * ## Why this is a lib module and not part of middleware.ts
 *
 * The same reason `routed-paths.ts` is: `middleware.ts` imports
 * `@workos-inc/authkit-nextjs`, which resolves `next/cache`, which exists only
 * inside a Next build. `node --test` cannot load it, so nothing in
 * `middleware.ts` can be asserted against. A list that decides what is public
 * and has no test is a list that drifts — and it did.
 *
 * ## The asymmetry this file exists to remove
 *
 * The two matchers read the same strings differently, and the difference is
 * silent:
 *
 *   - `isPublicPath()` treats each entry as an exact path PLUS its subtree, so
 *     `/repository` already covers `/repository/<slug>`.
 *   - `authkitMiddleware`'s `unauthenticatedPaths` uses Next.js matcher glob
 *     syntax, where `/repository` matches THAT PATH ONLY. A subtree has to be
 *     spelled out as a pattern.
 *
 * That was documented in `middleware.ts` and then not enforced, so
 * `/auth/sign-in` was public while `/auth/sign-in/<anything>` was gated. Any
 * page added under a public path inherited the trap: `isPublicPath()` said
 * public, AuthKit said sign in first. For a page under `/auth/sign-in/` that is
 * a contradiction in terms — the sign-in *failure* page would send a visitor to
 * the provider that had just failed.
 *
 * `workosUnauthenticatedPaths()` derives the glob form instead of restating it,
 * so the next path added to `PUBLIC_PATHS` gets its subtree automatically and
 * the two matchers cannot drift apart again. `public-paths.test.ts` asserts
 * they agree on every entry rather than on a remembered list.
 *
 * Widening the AuthKit list to match `isPublicPath()` exposes no gated route:
 * every public path either has no children in `app/` (`/auth/callback`,
 * `/auth/sign-out`, `/open-source`, `/demo`), has only public ones
 * (`/repository/<slug>`, `/repository/papers`, `/repository/folders` — the
 * children the exact `/repository` entry below still has, now that the bare
 * path itself has joined the next group), or lives under `[locale]` and is
 * rewritten before the gate is consulted at all (`/pricing`, `/contact`,
 * `/privacy`, `/terms`, `/workspace`, and since the Atlas caching change,
 * `/repository` itself — see `routed-paths.ts`'s `LOCALE_ROUTES`). It also
 * stops a typo under a public path from being 307'd to WorkOS, which is the
 * same defect `routed-paths.ts` was written to fix.
 */
import { isPublicDemoEnabled } from "./public-demo.ts";

/** Each entry is an exact path and everything beneath it, except "/". */
export const PUBLIC_PATHS: readonly string[] = [
  "/",
  "/auth/callback",
  // Logout must remain reachable after the session cookie is gone; the route
  // itself makes the operation idempotent for already-signed-out visitors.
  "/auth/sign-out",
  // The header's sign-in link on a cached page. It must be reachable without a
  // session for the same reason /auth/callback is: it is what a signed-out
  // reader clicks to get one. Its subtree must be reachable for a stronger
  // reason: a page that explains why sign-in failed cannot require sign-in.
  "/auth/sign-in",
  "/about",
  "/pricing",
  "/repository",
  "/workspace",
  "/open-source",
  "/q",
  "/contact",
  "/privacy",
  "/terms",
  // `<AuthStatus>` (ai-ops#94) calls this from every `chrome="static"` page —
  // home, pricing, workspace, contact, privacy, terms — to learn the real
  // sign-in state after a cached, signed-out-by-default render. A signed-out
  // visitor is exactly who needs a clean answer from it: gated, they would be
  // 307'd to WorkOS by the very request that was supposed to tell them they
  // are not signed in. The route still sees a session cookie when one exists —
  // being on this list only means AuthKit does not require one.
  "/api/auth/session",
  // The contact form's submit target (ai-ops issue 125). `/contact` above does
  // NOT cover this: `isPublicPath` matches an entry and its subtree, and
  // `/api/contact` is not under `/contact`. Without this line the form is gated
  // for exactly the people it exists for — an anonymous visitor's POST is 307'd
  // to WorkOS, so the one page whose whole purpose is "you do not have an
  // account yet, here is how to reach us" cannot be used without an account.
  // Caught by CodeRabbit on PR 661 before it shipped; numbered without a hash
  // because `check-raw-hex` reads a three-digit hash-number as a CSS colour.
  //
  // Publishing this path is the whole subtree, per the note at the top of this
  // file. There is nothing under `/api/contact`, and the route itself validates
  // every field, refuses anything oversize, and reveals nothing about who is
  // signed in.
  "/api/contact",
  // `/llms.txt` (ai-ops 133). Being a routed segment and being public are two
  // different lists, and this endpoint needs BOTH: `ROUTED_SEGMENTS` in
  // routed-paths.ts is what stops the middleware treating it as a typo, and
  // this entry is what stops AuthKit gating it once it is routed.
  //
  // Adding it to only the first is strictly worse than adding it to neither.
  // Before it was routed, an anonymous request fell through unauthenticated and
  // Next answered; once routed and not public, the same request reaches
  // `authkitMiddleware` and is 307'd to WorkOS — so a file whose entire purpose
  // is to be read by crawlers and model clients would have shipped answering a
  // sign-in redirect to every one of them.
  //
  // Caught by Aikido's Deep Review on PR 684. It is worth recording WHY local
  // verification missed it: `middleware.ts` returns early when
  // `isLocalDevAuthEnabled()`, so the gate never runs against a local build and
  // `curl localhost:3115/llms.txt` returned the file correctly on a tree where
  // production would have redirected. A local 200 is not evidence about this
  // code path.
  //
  // Publishing the whole subtree costs nothing: there is nothing under
  // `/llms.txt`, the handler reads compile-time constants only, and it sets no
  // cookie and touches no session.
  "/llms.txt",
  // The public Qapp list (ai-ops 183). `/q` above does NOT cover it, for the
  // same reason `/contact` does not cover `/api/contact`: an entry matches its
  // own subtree, and `/api/qapps/public` is not under `/q`.
  //
  // Everything about this endpoint already says "anonymous". The Next route
  // calls `fetchControlPlane` with no `ensureSignedIn` and sends no
  // Authorization header; the FastAPI route behind it takes `PublicQappScope`
  // (`auth/qapp_deps.py::get_public_qapp_scope`), which is an anonymous RLS
  // context, not a session; and it answers with `PublicQappSummary`, a
  // `extra="forbid"` projection of seven scalar fields that carries neither
  // `quantum_source` nor `workspace_id` nor `owner_user_id` — pinned by
  // `test_public_qapp_contract_cannot_expose_quantum_source_or_tenant_ids`.
  // Every part of it was written to be reachable without a session, and it was
  // gated anyway. Measured on production 2026-08-25: `GET /api/qapps/public`
  // returned 307 to WorkOS.
  //
  // ## The subtree, which is NOT empty — and the filesystem says otherwise
  //
  // `app/api/qapps/public/` holds one `route.ts` and no children, so "there is
  // nothing under it" reads as obviously true and is false. The sibling
  // **dynamic** segment `app/api/qapps/[qappKey]/` compiles to a pattern that
  // also matches this path with `qappKey = "public"`, so two routes really do
  // live under this entry's subtree. Measured against a dev server rather than
  // reasoned about, because Next's static-beats-dynamic precedence applies per
  // segment and does not stop a longer dynamic route from matching:
  //
  //     GET  /api/qapps/public/executions  -> 405   (route exists; it is POST-only)
  //     GET  /api/qapps/public/visibility  -> 405   (route exists; it is PATCH-only)
  //     GET  /api/qapps/public/anything    -> 404   (so it is exactly those two)
  //
  // Both of them call `getMajoranaAuth({ ensureSignedIn: true })` as the first
  // thing in their own handler and forward a Bearer token an anonymous caller
  // has no way to obtain. Publishing this path therefore removes the middleware
  // layer in FRONT of those two routes; it does not remove their gate. That is
  // one layer of defence in depth spent, deliberately, and written down here
  // rather than discovered later — which is the whole reason this file asks for
  // an argument per entry instead of a line per entry.
  "/api/qapps/public",
  ...(isPublicDemoEnabled() ? ["/demo"] : []),
];

/** The subtree suffix in Next.js matcher glob syntax. */
const SUBTREE = "/:path*";

/**
 * Our own gate: an entry matches itself and everything under it.
 *
 * "/" is the one entry that does NOT carry a subtree — it is the home page, not
 * the whole site.
 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) =>
    path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`));
}

/**
 * The same list in the glob syntax `authkitMiddleware` expects.
 *
 * Takes `paths` so the test can drive it with cases that are not the live list.
 */
export function workosUnauthenticatedPaths(
  paths: readonly string[] = PUBLIC_PATHS,
): readonly string[] {
  return paths.flatMap((path) => (path === "/" ? [path] : [path, `${path}${SUBTREE}`]));
}

/**
 * Does `pathname` match one Next.js matcher glob entry?
 *
 * Only the two forms this file produces are implemented — a literal path, and a
 * literal path plus `SUBTREE`. It exists so the test can assert what AuthKit
 * will actually do with the list rather than that the list contains a string.
 */
export function matchesUnauthenticatedGlob(pattern: string, pathname: string): boolean {
  if (!pattern.endsWith(SUBTREE)) return pattern === pathname;
  const base = pattern.slice(0, -SUBTREE.length);
  return pathname === base || pathname.startsWith(`${base}/`);
}

/** Will AuthKit let `pathname` through without a session? */
export function isUnauthenticatedForAuthKit(
  pathname: string,
  paths: readonly string[] = PUBLIC_PATHS,
): boolean {
  return workosUnauthenticatedPaths(paths).some((pattern) =>
    matchesUnauthenticatedGlob(pattern, pathname));
}
