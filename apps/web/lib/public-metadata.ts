/**
 * The canonical address of a public page, for `<link rel="canonical">` and
 * `og:url` (ai-ops#83).
 *
 * ## Why both, and why one function
 *
 * The site answered on four hostnames and named none of them as the one it
 * meant. `middleware.ts` now sends the other three to `leonaqt.com`, which is
 * the fix; this is the other half of it, and it covers the duplication a
 * redirect cannot reach. The public marketing pages are served by an internal
 * rewrite — the reader keeps `/pricing` in the address bar while
 * `app/[locale]/pricing/page.tsx` renders it — so the page has a real address
 * (`/en/pricing`) that is not the address anybody should link to or index.
 * `canonicalRedirect()` in the middleware already 308s the prefixed form back
 * to the clean one; this states the clean one in the document as well.
 *
 * One path in, both tags out, because the failure mode of writing them
 * separately is a page whose canonical says `/pricing` and whose `og:url` says
 * `/contact`, and nothing renders either one visibly enough to notice.
 *
 * ## Relative, deliberately
 *
 * The returned paths are relative and Next resolves them against
 * `metadataBase`, set once in `app/layout.tsx` from `canonicalOrigin()`. That
 * is the same source `robots.ts` and `sitemap.ts` publish, so the three cannot
 * disagree about which origin this deployment claims to be.
 */
import type { Metadata } from "next";

export const SITE_NAME = "Leona Quantum";

/**
 * `path` is the clean, reader-facing address — the one in `PUBLIC_STATIC_PATHS`
 * and in the sitemap, never the `/{locale}`-prefixed route that renders it.
 */
export function canonicalMetadata(path: string): Pick<Metadata, "alternates" | "openGraph"> {
  return {
    alternates: { canonical: path },
    openGraph: { url: path, siteName: SITE_NAME, type: "website" },
  };
}
