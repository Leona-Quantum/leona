import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../../components/public-site";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import {
  getComparisonsForPaper,
  getRepositoriesForPaper,
  getVqePaper,
  getVqePapers,
} from "../../../../lib/atlas-vqe/source";
import { VqePaperDetail } from "./vqe-paper-detail";

export async function generateStaticParams() {
  return getVqePapers().map((paper) => ({ paperId: paper.paper_id }));
}

export async function generateMetadata({ params }: { params: Promise<{ paperId: string }> }): Promise<Metadata> {
  const { paperId } = await params;
  const paper = getVqePaper(paperId);
  const locale = await getPublicLocale();
  return paper
    ? { title: `${paper.title} — Atlas`, description: paper.problem_summary }
    : { title: locale === "ja" ? "Atlas VQE手法" : "Atlas VQE method" };
}

export default async function VqePaperPage({ params }: { params: Promise<{ paperId: string }> }) {
  const { paperId } = await params;
  const paper = getVqePaper(paperId);
  if (!paper) notFound();
  const locale = await getPublicLocale();
  const repositories = getRepositoriesForPaper(paperId);
  const comparisons = getComparisonsForPaper(paperId);

  return (
    <PublicSite activePath="/repository" className="mj-repository-site mj-repository-detail-site" locale={locale} showLanguageToggle>
      <VqePaperDetail paper={paper} repositories={repositories} comparisons={comparisons} locale={locale} />
    </PublicSite>
  );
}
