// One paper, at one address.
//
// The segment is `paperSlug(id)`, not the id: a `PaperId` carries a `:` and,
// for every pre-2007 arXiv id and every DOI, a `/` — and a segment containing a
// slash is two segments. `validatePaperRegister` checks the whole register
// round-trips through the mapping and that no two rows claim one segment, so a
// collision fails the build rather than serving one paper at another's address.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { PaperView } from "../../../../components/repository-papers";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import { getRepositoryEntries } from "../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../lib/repository/layer-graph";
import { PAPER_REGISTER } from "../../../../lib/repository/paper-register";
import { STATE_VOCABULARY } from "../../../../lib/repository/state-vocabulary";
import { paperPageFor, paperPages } from "../../../../lib/repository/paper-pages";
import { paperIdFromSlug, paperSlug } from "../../../../lib/repository/papers";

export function generateStaticParams() {
  return PAPER_REGISTER.papers.map((paper) => ({ id: paperSlug(paper.id) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const locale = await getPublicLocale();
  const paperId = paperIdFromSlug(id);
  const paper = paperId && PAPER_REGISTER.papers.find((row) => row.id === paperId);
  if (!paper) return { title: locale === "ja" ? "論文" : "Papers" };
  return {
    title: paper.title,
    description: `${paper.authors} · ${paper.year}`,
    ...canonicalMetadata(`/repository/papers/${id}`),
  };
}

export default async function RepositoryPaperPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paperId = paperIdFromSlug(id);
  if (!paperId) notFound();
  // The corpus is fetched before the 404 check would need it, but only after the
  // slug has parsed — an unparseable segment must not cost a corpus read.
  const [locale, entries] = await Promise.all([getPublicLocale(), getRepositoryEntries()]);
  const page = paperPageFor(paperPages(PAPER_REGISTER, LAYER_GRAPH, entries, STATE_VOCABULARY), paperId);
  if (!page) notFound();
  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      <PaperView page={page} locale={locale} />
    </PublicSite>
  );
}
