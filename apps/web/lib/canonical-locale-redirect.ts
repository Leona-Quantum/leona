/**
 * Where `/en/pricing` should be sent so every public page has one address.
 *
 * ## Why this is not a one-liner, and why it lives outside `middleware.ts`
 *
 * The first version built the target by handing the tail of the request path
 * straight to `new URL(rest, request.url)` as the relative argument. That is an
 * OPEN REDIRECT, because a relative URL is allowed to replace the authority:
 *
 *     /en//evil.com   -> rest "//evil.com"  -> https://evil.com/
 *     /en/\evil.com   -> rest "/\evil.com"  -> https://evil.com/
 *
 * Both parse as `scheme-relative`, so the host we resolved against is discarded.
 * The backslash form is the one that matters operationally: a proxy or a
 * normalizer that collapses duplicate FORWARD slashes leaves a lone backslash
 * untouched, and the WHATWG URL parser treats `/\` and `//` identically for
 * special schemes. Fixing only the double-slash case would look fixed and not be.
 *
 * It reaches this far because `canonicalRedirect` runs BEFORE the auth gate — it
 * has to, since it collapses a public page's second address — so the redirect is
 * reachable by anyone, with no session and a single GET.
 *
 * Two things make the result same-origin by construction rather than by review:
 *
 * - the path is rebuilt from segments with the empties dropped, so no leading
 *   `//` can survive to be read as an authority;
 * - it is assigned to `url.pathname`, which cannot change the host. The relative
 *   `new URL(str, base)` form can, and that is the whole bug.
 *
 * Pure and in `lib/` so the exploit strings above are asserted by a test rather
 * than argued about in a comment — `middleware.ts` is a blast-radius file and
 * nothing in it was directly testable before.
 *
 * `locales` is a parameter rather than an import of `PUBLIC_LOCALES` so this
 * module has no sibling import at all. Every `lib/*.ts` covered by the hand-run
 * `node --test` line is self-contained for the same reason: the app's imports
 * are extensionless, bare `node --test` cannot resolve those, and one of them
 * here would fail this suite at load time — the trap that moved
 * `CATALOG_REVALIDATE_SECONDS` into its own file. The list still has exactly one
 * definition; `middleware.ts` passes it in.
 */
/**
 * The locale a request's path names, from its first segment — or null if that
 * segment is not one of `locales`.
 *
 * Split out of `canonicalLocaleTarget` below so `middleware.ts`'s
 * `canonicalRedirect` can learn WHICH locale a `/ja/...` or `/en/...` request
 * named without re-deriving `segments[1]` itself: it needs that value to set
 * `PUBLIC_LOCALE_COOKIE` to (ai-ops 329 — a shared `/ja` link should open the
 * site in Japanese instead of silently collapsing to English), and a second
 * copy of "the first path segment, checked against `locales`" is exactly the
 * kind of thing that goes on agreeing until one of them changes.
 *
 * The return value is always a member of `locales` or `null` — never a
 * substring of the attacker-influenced tail below — so a caller that writes
 * it straight into a cookie cannot be handed anything the site does not
 * actually serve.
 */
export function localePrefixOf(pathname: string, locales: readonly string[]): string | null {
  const first = pathname.split("/")[1] ?? "";
  return locales.includes(first) ? first : null;
}

export function canonicalLocaleTarget(
  pathname: string,
  requestUrl: string,
  locales: readonly string[],
): URL | null {
  if (localePrefixOf(pathname, locales) === null) return null;
  const segments = pathname.split("/");
  const target = new URL(requestUrl);
  // Backslashes first: the URL parser would treat them as separators anyway, so
  // normalizing here means the emptiness filter below sees the same segments the
  // parser would, rather than one opaque `\evil.com` segment.
  const rest = segments
    .slice(2)
    .join("/")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment !== "")
    .join("/");
  target.pathname = rest === "" ? "/" : `/${rest}`;
  return target;
}
