// The register, at one address.
//
// The full corpus is read here rather than the list projection, because the
// list projection does not carry `literature` and the Atlas half of every
// paper's citation count comes from it. That is the expensive path (~2.37 MB)
// and it is the correct one: a page that showed only the map's citations would
// print "cited in 1 place" for a paper eight records also cite, which is the
// kind of wrong number this whole surface exists to stop.
//
// Served from the CDN by being prerendered outright — the `claims` recipe, not
// the `layers` one. This page reads no `searchParams` and its only per-visitor
// read was `getPublicLocale()` (a cookie), which is gone now that the locale is
// a path segment; `middleware.ts` rewrites the clean `/repository/papers` URL
// into this one, keeping the address bar unprefixed while giving each language
// its own cache entry. `dynamicParams = false` is what stops `[locale]` from
// swallowing a mistyped URL and answering it with this page instead of a 404.
//
// `export const revalidate = 300` matches CATALOG_REVALIDATE_SECONDS, which is
// what the corpus fetch below already uses (`repository-source.ts`) — so
// `sync-bootstrap`'s no-deploy corpus publishes are picked up here on the same
// cadence they are everywhere else, rather than being frozen at the last
// deploy. `public-revalidate.test.ts` pins the literal to the constant.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { PaperIndexView } from "../../../../components/repository-papers";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import { getRepositoryEntries } from "../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../lib/repository/layer-graph";
import { PAPER_REGISTER } from "../../../../lib/repository/paper-register";
import { STATE_VOCABULARY } from "../../../../lib/repository/state-vocabulary";
import { paperIndexCensus, paperPages } from "../../../../lib/repository/paper-pages";

export const revalidate = 300;
export const dynamicParams = false;

export function generateStaticParams() {
  return PUBLIC_LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const locale = parsePublicLocale((await params).locale);
  return {
    ...(locale === "ja"
      ? {
          title: "論文",
          description:
            "本サイトが引用するすべての論文を、論文ごとに 1 行で。何を報告しているか、どこから引用されているか、そして地図の上で線になるかどうか。",
        }
      : {
          title: "Papers",
          description:
            "Every paper this site cites, one row each: what it reports, where it is cited from, and whether it draws a line on the map.",
        }),
    ...canonicalMetadata("/repository/papers"),
  };
}

export default async function RepositoryPapersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  // `dynamicParams = false` DOES cover this page — unlike `layers/page.tsx` and
  // `folders/[[...path]]/page.tsx`, it reads no `searchParams`, so it actually
  // prerenders and an unknown locale 404s at the routing layer before this body
  // ever runs. Still validated here rather than trusted blindly, the same
  // belt-and-suspenders reasoning `(browse)/page.tsx` states: a mistyped locale
  // should cost nothing, not a corpus fetch, if the guard is ever weakened.
  const routeLocale = await params;
  if (!isPublicLocale(routeLocale.locale)) notFound();
  const locale = parsePublicLocale(routeLocale.locale);
  const entries = await getRepositoryEntries();
  const pages = paperPages(PAPER_REGISTER, LAYER_GRAPH, entries, STATE_VOCABULARY);
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      // The full chrome with no per-visitor part in the server render. `"full"`
      // (the default) would call `getMajoranaAuth()` -> `withAuth()`, which
      // THROWS on a request that did not pass through AuthKit's middleware —
      // and this path deliberately no longer does, because `localeRewrite()`
      // answers a rewritten path before `workosMiddleware()` is ever reached.
      // See the same note on `claims/page.tsx` and `layers/page.tsx`.
      chrome="static"
      showLanguageToggle
    >
      <PaperIndexView pages={pages} census={paperIndexCensus(pages)} locale={locale} />
    </PublicSite>
  );
}
