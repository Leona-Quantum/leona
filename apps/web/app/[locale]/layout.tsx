import type { ReactNode } from "react";
import { RootDocument, rootMetadata } from "../../components/root-document";
import { parsePublicLocale } from "../../lib/public-locale";

/**
 * The root layout for every public marketing page, and **the whole point of
 * ai-ops issue 151**: `<html lang>` finally comes from the server on the pages
 * that actually serve Japanese.
 *
 * The locale is read from `params`, not from the cookie — which is why this
 * costs nothing. These pages are the ones a reader arrives on cold and the ones
 * Vercel prerenders (`/`, `/pricing`, `/contact`, `/privacy` all answer
 * `cache-control: public` with `x-vercel-cache: PRERENDER`). A `cookies()` call
 * here would have made all of them dynamic, which is the objection the issue
 * raised and the reason this was not done sooner. Taking it off the path
 * sidesteps it entirely: no Dynamic API, no cache lost, and the served bytes
 * are right before a single script runs.
 *
 * `parsePublicLocale` rather than the raw segment, so an unexpected path cannot
 * put arbitrary text in an attribute the whole document is read through.
 */
export const metadata = rootMetadata;

export default async function LocaleRootLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  return <RootDocument lang={parsePublicLocale(locale)}>{children}</RootDocument>;
}
