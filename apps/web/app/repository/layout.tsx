import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";
import { getPublicLocale } from "../../lib/public-locale-server";
import { TourGate } from "../../components/tour/tour-gate";

/**
 * The root layout for the Atlas, and the second half of ai-ops issue 151.
 *
 * This tree is **not** under `[locale]`, so there is no path segment to read —
 * the Atlas takes its locale from the cookie, which is why `/repository/layers`
 * serves a fully Japanese map at an `en` URL.
 *
 * `getPublicLocale()` calls `cookies()`, which is a Dynamic API, and everywhere
 * else in this app that would be the reason not to do it. Here it is free, and
 * that was measured rather than assumed — read from outside, this route tree
 * already answered, while Vercel was still the CDN:
 *
 *     cache-control: private, no-cache, no-store, max-age=0, must-revalidate
 *     x-vercel-cache: MISS
 *
 * There is no CDN entry to lose. The page was already dynamic on every request
 * before this layout existed. The `cache-control` line is Next's own and
 * unchanged on Cloud Run; the CDN-side header is now Cloudflare's
 * `cf-cache-status`, not re-measured here since this layout has not changed.
 */
export const metadata = rootMetadata;

export default async function RepositoryRootLayout({ children }: { children: ReactNode }) {
  // The tour gate renders nothing unless a guided tour is running (the Read track).
  return <RootDocument lang={await getPublicLocale()} forcedTheme="dark">{children}<TourGate surface="atlas" /></RootDocument>;
}
