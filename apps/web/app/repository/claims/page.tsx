// Whose claim is the speedup class, at one address.
//
// The census is a pure partition of the corpus's own provenance field, so this
// page needs neither the full repository read that `/repository/papers` does nor
// the layer graph. The provenance is passed in rather than imported by the census
// module — see that module's header for why a corpus import would put it out of
// reach of every test in this package.
import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { SpeedupClaimsView } from "../../../components/repository-speedup-claims";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { ZOO_SPEEDUP_PROVENANCE } from "../../../lib/repository/entries-zoo-parity";
import { speedupClaimCensus } from "../../../lib/repository/speedup-claims";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return locale === "ja"
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
      };
}

export default async function RepositorySpeedupClaimsPage() {
  const locale = await getPublicLocale();
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      <SpeedupClaimsView census={speedupClaimCensus(ZOO_SPEEDUP_PROVENANCE)} locale={locale} />
    </PublicSite>
  );
}
