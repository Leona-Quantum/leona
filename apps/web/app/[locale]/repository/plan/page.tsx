// The workflow planner (owner directive 2026-09-22): describe a problem in a
// sentence, get a pipeline of Atlas blocks with its cost from the papers, and
// suggestions for making it cheaper.
//
// Prerendered outright, on the `find`/`claims`/`papers` recipe: the page reads
// no `searchParams` and calls `getMajoranaAuth()` nowhere, so it is one cached
// document for every visitor. Everything a reader does — the sentence, the
// numbers, the blocks they swap — is client state in `AtlasWorkflowPlanner`,
// and a sentence can be handed in through the URL fragment, which no server
// ever sees.
//
// What the client receives is prepared here, once per locale, because each
// source is too big to ship whole: the layer graph slimmed to one language
// (`slimLayerGraph`), the register rows the planner actually cites (not all
// three hundred), and for each problem's worked example only its title,
// instance and block names — `worked-examples.ts` says to import it only from
// a Server Component, since it carries every example's full step list.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { canonicalMetadata } from "../../../../lib/public-metadata";
import { PublicSite } from "../../../../components/public-site";
import { isPublicLocale, parsePublicLocale, PUBLIC_LOCALES } from "../../../../lib/public-locale";
import { LAYER_GRAPH } from "../../../../lib/repository/layer-graph.ts";
import { PAPER_REGISTER } from "../../../../lib/repository/paper-register.ts";
import { slimLayerGraph } from "../../../../lib/workflow-planner/graph.ts";
import { plannerPaperIds } from "../../../../lib/workflow-planner/sources.ts";
import { PROBLEMS } from "../../../../lib/workflow-planner/problems.ts";
import { workedExample } from "../../../../lib/worked-examples.ts";
import { blockTemplate } from "../../../../lib/circuit-blocks.ts";
import {
  AtlasWorkflowPlanner,
  type PlannerExample,
  type PlannerPaper,
} from "../../../../components/atlas-workflow-planner";

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
          title: "量子ワークフローを計画する",
          description:
            "解きたい問題を一文で書くと、アトラスのブロックでワークフローを組み立て、論文に基づくコストと、安くするための提案を示します。",
        }
      : {
          title: "Plan a quantum workflow",
          description:
            "Describe a problem in a sentence and get a workflow built from Atlas blocks, its cost from the papers, and suggestions for making it cheaper.",
        }),
    ...canonicalMetadata("/repository/plan"),
  };
}

export default async function RepositoryPlanPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const routeLocale = await params;
  if (!isPublicLocale(routeLocale.locale)) notFound();
  const locale = parsePublicLocale(routeLocale.locale);

  const graph = slimLayerGraph(LAYER_GRAPH, locale);

  const cited = new Set(plannerPaperIds());
  const papers: PlannerPaper[] = PAPER_REGISTER.papers
    .filter((paper) => cited.has(paper.id))
    .map(({ id, title, authors, year, url }) => ({ id, title, authors, year, url }));

  const examples: Record<string, PlannerExample> = {};
  for (const problem of PROBLEMS) {
    const id = problem.workedExample;
    if (!id || examples[id]) continue;
    const example = workedExample(id);
    if (!example) continue;
    examples[id] = {
      id,
      title: locale === "ja" ? example.title.ja : example.title.en,
      instance: locale === "ja" ? example.instance.ja : example.instance.en,
      blocks: example.blocks.map((key) => blockTemplate(key)?.name ?? key),
    };
  }

  return (
    <PublicSite
      activePath="/repository"
      className="mj-repository-site mj-plan-site"
      locale={locale}
      // `"static"`, as on `find/page.tsx`: `"full"` would call
      // `getMajoranaAuth()`, which throws on this locale-rewritten path. The
      // "Open in Studio" action reads sign-in state client-side instead.
      chrome="static"
      showLanguageToggle
    >
      <AtlasWorkflowPlanner locale={locale} graph={graph} papers={papers} examples={examples} />
    </PublicSite>
  );
}
