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
