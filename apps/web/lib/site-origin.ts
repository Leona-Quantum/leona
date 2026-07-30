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
