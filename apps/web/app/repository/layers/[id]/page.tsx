import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicSite } from "../../../../components/public-site";
import { LayerNodeView } from "../../../../components/repository-layers";
import { getPublicLocale } from "../../../../lib/public-locale-server";
import { getRepositoryListEntries } from "../../../../lib/repository-source";
import { LAYER_GRAPH } from "../../../../lib/repository/layer-graph";
import { layerNode, type LayerCorpusEntry } from "../../../../lib/repository/layers";

export function generateStaticParams() {
  return LAYER_GRAPH.nodes.map((node) => ({ id: node.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const node = layerNode(LAYER_GRAPH, id);
  const locale = await getPublicLocale();
  if (!node) return { title: locale === "ja" ? "階層" : "Layers" };
  return {
    title: locale === "ja" ? node.labelJa : node.label,
    description: locale === "ja" ? node.summaryJa : node.summary,
  };
}

export default async function RepositoryLayerNodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const node = layerNode(LAYER_GRAPH, id);
  if (!node) notFound();
  const [locale, entries] = await Promise.all([getPublicLocale(), getRepositoryListEntries()]);
  const corpus: LayerCorpusEntry[] = entries.map((entry) => ({
    slug: entry.slug,
    title: entry.title,
    titleJa: entry.titleJa,
    category: entry.category,
  }));

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-layers-site"
      locale={locale}
      showLanguageToggle
    >
      <LayerNodeView graph={LAYER_GRAPH} node={node} corpus={corpus} locale={locale} />
    </PublicSite>
  );
}
