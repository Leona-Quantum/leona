/**
 * Where a clean public path is rewritten to so `app/[locale]/` can serve it.
 *
 * ## Why this is not a one-liner inside `middleware.ts`
 *
 * The first version built the target with the relative `new URL(target,
 * request.url)` form. That form takes the base's origin and replaces everything
 * from the path onward, so **the query string is silently dropped**.
 *
 * That was invisible for as long as the rewrite only served the six marketing
 * pages, because not one of them reads a search parameter. `/repository/layers`
 * reads ten (`?open=`, `?at=`, `?card=`, `?paper=`, `?focus=`, `?inner=`,
 * `?iopen=`, `?about=`, `?section=`, `?sel=`) and its node page reads two, and
 * every one of them resolves during render so a shared link arrives already
 * panned and expanded with JavaScript off.
 *
 * With the query dropped, every deep link rewrote to the same target. Measured
 * on a preview deployment before this function existed: `/repository/layers`,
 * `?open=variational-circuit` and `?open=<random>` returned three
 * byte-identical documents, and a URL nobody had ever requested came back
 * `x-vercel-cache: HIT`. The reader who followed a link to one part of the map
 * got the bare map instead — and got it out of the cache, so it was fast and
 * wrong and left no error anywhere.
 *
 * Pure and in `lib/` for the same reason `canonical-locale-redirect.ts` is:
 * `middleware.ts` is a blast-radius file, and a rule this easy to reintroduce
 * belongs somewhere a test can hold it rather than somewhere review has to.
 *
 * It takes no sibling import, deliberately — the app's imports are
 * extensionless, bare `node --test` cannot resolve those, and one here would
 * fail the suite at load time.
 */

export const LOCALE_REWRITE_SOURCE_HEADER = "x-leona-locale-rewrite-source";

/**
 * Carry the clean URL through Next's internal rewrite resolution.
 *
 * Next 16 can run middleware again for the rewritten pathname. This request
 * header lets that continuation be distinguished from a reader who actually
 * requested `/en/...`; it is upstream-only and is removed before rendering.
 */
export function localeRewriteRequestHeaders(headers: Headers, sourcePathname: string): Headers {
  const rewritten = new Headers(headers);
  rewritten.set(LOCALE_REWRITE_SOURCE_HEADER, sourcePathname);
  return rewritten;
}

/**
 * Validate that a marked request is the exact locale-prefixed destination of
 * a clean public route. The marker is routing provenance, never an auth signal;
 * callers must still restrict `isRewritableSource` to routes that are public.
 */
export function isLocaleRewriteContinuation(
  sourcePathname: string | null,
  destinationPathname: string,
  locales: readonly string[],
  isRewritableSource: (pathname: string) => boolean,
): boolean {
  if (sourcePathname === null || !isRewritableSource(sourcePathname)) return false;

  for (const locale of locales) {
    const expected = sourcePathname === "/" ? `/${locale}` : `/${locale}${sourcePathname}`;
    if (destinationPathname === expected) return true;
  }
  return false;
}

/**
 * `requestUrl` is the absolute URL of the incoming request, `pathname` its clean
 * path, and `locale` the language chosen for it. The host, scheme, query and
 * hash all come through untouched; only the path gains its prefix.
 */
export function localeRewriteTarget(requestUrl: string, pathname: string, locale: string): URL {
  const url = new URL(requestUrl);
  // Assigned to `url.pathname`, which cannot change the host. The relative
  // `new URL(str, base)` form can — that is a separate bug, and the reason
  // `canonical-locale-redirect.ts` exists.
  url.pathname = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
  return url;
}
