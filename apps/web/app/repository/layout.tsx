import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";
import { getPublicLocale } from "../../lib/public-locale-server";

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
 * already answers:
 *
 *     cache-control: private, no-cache, no-store, max-age=0, must-revalidate
 *     x-vercel-cache: MISS
 *
 * There is no CDN entry to lose. The page was already dynamic on every request
 * before this layout existed.
 */
export const metadata = rootMetadata;

export default async function RepositoryRootLayout({ children }: { children: ReactNode }) {
  return <RootDocument lang={await getPublicLocale()}>{children}</RootDocument>;
}
