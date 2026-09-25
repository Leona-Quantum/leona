// What a notebook page needs to draw block cells (ai-ops 382, Phase B S1), built on the
// server from the Atlas and handed to the page on demand by `GET /api/notebook-blocks`.
//
// Server-side only in practice: it imports the full layer graph (about 5 MB of source) and
// Leona's own Studio blocks, and ships a slice of them. A notebook with no block cell never
// asks for it, which is why this is a route the page calls rather than a prop every
// notebook load carries.
//
// Nothing here is rewritten: every method's label, cost text and citations are the layer
// graph's own fields, in the page's language, and the audit rows are `auditBlocks()`'s own
// output. The planner's graph is the lean one the Run page already uses (ids, labels and
// route structure, no prose), because the cost lines are worked out from structure alone.
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import type { LayerMethod } from "./repository/layers.ts";
import { PAPER_REGISTER } from "./repository/paper-register.ts";
import { auditBlocks } from "./workflow-planner/block-audit.ts";
import { slimLayerGraph, type PlannerLocale } from "./workflow-planner/graph.ts";
import { leanPlannerGraph } from "./workflow-planner/lean.ts";
import { plannerPaperIds } from "./workflow-planner/sources.ts";
import type { BlockCatalog, BlockMethod } from "./notebook-blocks.ts";

function pick(en: string | undefined, ja: string | undefined, locale: PlannerLocale): string | null {
  const value = locale === "ja" ? (ja ?? en) : en;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildBlockCatalog(locale: PlannerLocale): BlockCatalog {
  const capabilities = new Map<string, string>();
  for (const node of LAYER_GRAPH.nodes) {
    if (node.kind === "capability") capabilities.set(node.id, pick(node.label, node.labelJa, locale) ?? node.id);
  }
  const methods: BlockMethod[] = LAYER_GRAPH.nodes
    .filter((node): node is LayerMethod => node.kind === "method")
    .map((node) => {
      const absence = node.absences?.cost;
      return {
        id: node.id,
        label: pick(node.label, node.labelJa, locale) ?? node.id,
        realizes: node.realizes ?? null,
        capabilityLabel: node.realizes ? (capabilities.get(node.realizes) ?? null) : null,
        cost: pick(node.cost, node.costJa, locale),
        costAbsence: absence ? pick(absence.reason, absence.reasonJa, locale) : null,
        citations: (node.citations ?? []).map(({ title, authors, year, url }) => ({ title, authors, year, url })),
      };
    });
  const cited = new Set(plannerPaperIds());
  const papers = PAPER_REGISTER.papers
    .filter((paper) => cited.has(paper.id))
    .map(({ id, title, authors, year, url }) => ({ id, title, authors, year, url }));
  return {
    locale,
    graph: leanPlannerGraph(slimLayerGraph(LAYER_GRAPH, locale)),
    methods,
    papers,
    audit: auditBlocks(),
  };
}

const cache = new Map<PlannerLocale, BlockCatalog>();

/** One catalog per language for the life of the server process: the Atlas it is built
 * from is part of the deployed code, so it cannot change underneath a running server. */
export function blockCatalog(locale: PlannerLocale): BlockCatalog {
  const cached = cache.get(locale);
  if (cached) return cached;
  const built = buildBlockCatalog(locale);
  cache.set(locale, built);
  return built;
}
