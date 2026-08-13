// The register, at one address.
//
// The full corpus is read here rather than the list projection, because the
// list projection does not carry `literature` and the Atlas half of every
// paper's citation count comes from it. That is the expensive path (~2.37 MB)
// and it is the correct one: a page that showed only the map's citations would
// print "cited in 1 place" for a paper eight records also cite, which is the
// kind of wrong number this whole surface exists to stop.
import type { Metadata } from "next";
import { PublicSite } from "../../../components/public-site";
import { PaperIndexView } from "../../../components/repository-papers";
import { getPublicLocale } from "../../../lib/public-locale-server";
import { getRepositoryEntries } from "../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../lib/repository/layer-graph";
import { PAPER_REGISTER } from "../../../lib/repository/paper-register";
import { STATE_VOCABULARY } from "../../../lib/repository/state-vocabulary";
import { paperIndexCensus, paperPages } from "../../../lib/repository/paper-pages";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return locale === "ja"
    ? {
        title: "論文",
        description:
          "本サイトが引用するすべての論文を、論文ごとに 1 行で。何を報告しているか、どこから引用されているか、そして地図の上で線になるかどうか。",
      }
    : {
        title: "Papers",
        description:
          "Every paper this site cites, one row each: what it reports, where it is cited from, and whether it draws a line on the map.",
      };
}

export default async function RepositoryPapersPage() {
  const [locale, entries] = await Promise.all([getPublicLocale(), getRepositoryEntries()]);
  const pages = paperPages(PAPER_REGISTER, LAYER_GRAPH, entries, STATE_VOCABULARY);
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      <PaperIndexView pages={pages} census={paperIndexCensus(pages)} locale={locale} />
    </PublicSite>
  );
}
