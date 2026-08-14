// Whose claim is the speedup class, at one address.
//
// The census is a pure partition of the corpus's own provenance field, so this
// page needs neither the full repository read that `/repository/papers` does nor
// the layer graph. The provenance is passed in rather than imported by the census
// module — see that module's header for why a corpus import would put it out of
// reach of every test in this package.
import type { Metadata } from "next";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { SpeedupClaimsView } from "../../../../components/repository-speedup-claims";
import { parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import { ZOO_SPEEDUP_PROVENANCE } from "../../../../lib/repository/entries-zoo-parity";
import { speedupClaimCensus } from "../../../../lib/repository/speedup-claims";

// Served from the CDN. The locale comes from the path segment because a cached
// page cannot read a cookie — `middleware.ts` rewrites the clean URL to this one,
// keeping `/repository/claims` in the address bar while giving each language its
// own cache entry. `dynamicParams = false` is what stops `[locale]` from
// swallowing every mistyped URL and answering it with this page instead of a 404.
//
// This is the one Atlas route that prerenders outright. It reads no
// `searchParams` and fetches nothing: the census is a pure partition of
// `ZOO_SPEEDUP_PROVENANCE`, a static import. Its two siblings under
// `[locale]/repository/` cannot prerender at any price — see `layers/page.tsx`.
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
          title: "速度向上は誰の主張か",
          description:
            "アルゴリズム記録が掲げる速度向上の区分は外部の索引からの引用です。その根拠となる論文が同じことを述べているかどうかを、一件ずつ示します。",
        }
      : {
          title: "Whose claim is the speedup",
          description:
            "The speedup class on an algorithm record is quoted from an outside index, not derived here."
            + " For each record: whether the paper behind it states the same thing, and what was read.",
        }),
    ...canonicalMetadata("/repository/claims"),
  };
}

export default async function RepositorySpeedupClaimsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const locale = parsePublicLocale((await params).locale);
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      // The full chrome with no per-visitor part. `"full"` would call
      // `getMajoranaAuth()` -> `withAuth()`, which THROWS on a request that did
      // not pass through AuthKit's middleware — and this path deliberately no
      // longer does, because AuthKit sets a cookie on every request it sees and
      // Vercel will not store a response carrying `Set-Cookie`.
      chrome="static"
      showLanguageToggle
    >
      <SpeedupClaimsView census={speedupClaimCensus(ZOO_SPEEDUP_PROVENANCE)} locale={locale} />
    </PublicSite>
  );
}
