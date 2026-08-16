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
 * The card image every public page shares, stated explicitly rather than left
 * to Next's file convention.
 *
 * `app/opengraph-image.tsx` generates it, and Next attaches file-convention
 * images to the metadata of the segment they sit in. That is not enough here:
 * `openGraph` is merged as a WHOLE OBJECT, not field by field, so a page that
 * exports its own `openGraph` — which is every public page, through
 * `canonicalMetadata()` below — replaces the inherited one and takes the image
 * with it. Adding the file and stopping there produced exactly that: the image
 * route served a correct 1200x630 PNG while `og:image` appeared on no page at
 * all. Verified against a local production build rather than assumed.
 *
 * Relative, resolved against `metadataBase` in `app/layout.tsx`, so it carries
 * whichever origin this deployment claims to be. Crawlers require an absolute
 * URL and Next writes one; what must not happen is this file hard-coding a
 * hostname that the canonical redirect then disagrees with.
 */
export const OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: `${SITE_NAME} — generate, run, and reuse quantum circuits`,
} as const;

/**
 * `path` is the clean, reader-facing address — the one in `PUBLIC_STATIC_PATHS`
 * and in the sitemap, never the `/{locale}`-prefixed route that renders it.
 */
export function canonicalMetadata(path: string): Pick<Metadata, "alternates" | "openGraph"> {
  return {
    alternates: { canonical: path },
    openGraph: { url: path, siteName: SITE_NAME, type: "website", images: [OG_IMAGE] },
  };
}
