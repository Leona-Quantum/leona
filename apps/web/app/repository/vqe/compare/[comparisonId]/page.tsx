import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../../../components/public-site";
import { getPublicLocale } from "../../../../../lib/public-locale-server";
import { getVqeComparison, getVqeComparisons, getVqePaper } from "../../../../../lib/atlas-vqe/source";
import { VqeComparisonDetail } from "./vqe-comparison-detail";

export async function generateStaticParams() {
  return getVqeComparisons().map((comparison) => ({ comparisonId: comparison.comparison_id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ comparisonId: string }>;
}): Promise<Metadata> {
  const { comparisonId } = await params;
  const comparison = getVqeComparison(comparisonId);
  const locale = await getPublicLocale();
  return comparison
    ? { title: `${comparison.comparison_id} — Atlas`, description: `${comparison.classification} comparison, ${comparison.is_manual_gold ? "manual gold" : "machine-generated"}` }
    : { title: locale === "ja" ? "Atlas VQE比較" : "Atlas VQE comparison" };
}

export default async function VqeComparisonPage({
  params,
}: {
  params: Promise<{ comparisonId: string }>;
}) {
  const { comparisonId } = await params;
  const comparison = getVqeComparison(comparisonId);
  if (!comparison) notFound();
  const locale = await getPublicLocale();
  const papers = comparison.source_record_ids
    .map((id) => getVqePaper(id))
    .filter((paper): paper is NonNullable<typeof paper> => Boolean(paper));

  return (
    <PublicSite activePath="/repository" className="mj-repository-site mj-repository-detail-site" locale={locale} showLanguageToggle>
      <VqeComparisonDetail comparison={comparison} papers={papers} locale={locale} />
    </PublicSite>
  );
}
