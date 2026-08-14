/**
 * The origin this deployment is served from, or null when nothing says.
 *
 * Read off the sign-in redirect URI rather than a variable of its own. That one
 * is already required for authentication to work at all, and it is by
 * construction an origin this deployment actually answers on — a second
 * variable would be a second thing to get wrong, and the failure would only
 * show up on the one action nobody tests twice.
 *
 * Its own module, with no imports, so the bare node test runner can load it.
 * Inside `auth.ts` it would arrive via `@workos-inc/authkit-nextjs` and be
 * untestable, which for a value that decides where a signed-out person lands is
 * how the current bug survived.
 */
export function siteOrigin(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const callback = env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ?? env.WORKOS_REDIRECT_URI;
  if (!callback) return null;
  try {
    const { origin } = new URL(callback);
    // `new URL("not a url")` throws, but `new URL("mailto:x")` does not — it
    // yields the opaque origin "null", which as a return_to would be worse than
    // sending nothing.
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The origin the production site is served from.
 *
 * A literal, and the only one in this file, because it is a fallback rather
 * than a source: `canonicalOrigin()` below prefers the configured value every
 * time there is one. It exists because `siteOrigin()` is allowed to answer
 * "nothing" and the sitemap is not — see there.
 */
export const PRODUCTION_ORIGIN = "https://leonaqt.com";

/**
 * The origin `sitemap.xml` and `robots.txt` publish. Same configured source as
 * `siteOrigin()`; it differs only in that it cannot return null.
 *
 * Null is the right answer for a sign-out `returnTo` — WorkOS falls back to its
 * own configured default and the visitor lands somewhere sensible. It is not an
 * answer a sitemap can carry: `<loc>` must hold an absolute URL, so an
 * unconfigured deployment would emit a document every crawler rejects, and a
 * relative-URL sitemap fails silently in exactly the way nobody checks. Falling
 * back to the production origin is wrong only on a deployment that is not
 * production AND has no redirect URI set, where the cost is that a crawler is
 * pointed at the real site instead of a preview — which is where it should be
 * pointed anyway.
 */
export function canonicalOrigin(
  env: Record<string, string | undefined> = process.env,
): string {
  return siteOrigin(env) ?? PRODUCTION_ORIGIN;
}

/**
 * The one host a reader and a crawler should end up on.
 *
 * Derived from `PRODUCTION_ORIGIN` rather than written a second time, so moving
 * the site to another address stays the one-line change it looks like. Nothing
 * below hardcodes "leonaqt.com" again.
 */
export const CANONICAL_HOST = new URL(PRODUCTION_ORIGIN).host;

/**
 * The hosts that answer for this site but are not it (ai-ops#83).
 *
 * > *"leonaqt.com is canonical — redirect the other three, in middleware."*
 * > — owner, 2026-08-14
 *
 * All four were serving 200 with no redirect, which publishes every public page
 * at four addresses: a crawler sees four copies of the pricing page and picks
 * one, and it is not necessarily the one every link points at.
 *
 * **This is an allowlist and must stay one.** The tempting shape — "redirect
 * anything that is not the canonical host" — breaks every preview deployment on
 * `*.vercel.app`, every branch alias, and `localhost`, by sending them to
 * production the moment they are opened. Listing the three hosts we own is the
 * only version that cannot do that: a host nobody wrote down here is left
 * alone.
 *
 * All four are registered origins on the WorkOS application, and the two
 * `leonaqt.com` forms are its registered redirect URIs
 * (`docs/archive/one-time-cutovers/workos-cutover.md`). The callback therefore
 * lands on the canonical host and is never redirected mid-flow — verified
 * against production on 2026-08-14, where `/robots.txt` publishes
 * `https://leonaqt.com/sitemap.xml`, and that origin is read off the configured
 * redirect URI by `canonicalOrigin()` above.
 */
export const NON_CANONICAL_HOSTS: readonly string[] = [
  "www.leonaqt.com",
  "leonaquantum.com",
  "www.leonaquantum.com",
];

const NON_CANONICAL_HOST_SET = new Set(NON_CANONICAL_HOSTS);

/**
 * Where a request should be sent instead, or `null` to leave it alone.
 *
 * `pathAndQuery` is passed through untouched: a 308 preserves the method and
 * the body, and preserving the rest of the URL is what stops a redirect from
 * turning a deep link into a homepage visit.
 *
 * The destination is the constant above, never anything derived from the
 * request, so a forged `Host` header can do nothing except redirect its sender
 * to the real site.
 */
export function canonicalHostRedirect(
  host: string | null | undefined,
  pathAndQuery: string,
): string | null {
  if (!host) return null;
  if (!NON_CANONICAL_HOST_SET.has(host.trim().toLowerCase())) return null;
  return `${PRODUCTION_ORIGIN}${pathAndQuery}`;
}
