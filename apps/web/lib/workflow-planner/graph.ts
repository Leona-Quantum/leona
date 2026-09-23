// The slice of the Atlas layer graph the planner reads, in one reader language.
//
// `../repository/layer-graph.ts` is twenty thousand lines of authored,
// cited text in two languages. The planner runs in the browser (the page is
// prerendered and every choice is client-side state), so the page's server
// component calls `slimLayerGraph` once at build time and hands the client
// only the fields a workflow is assembled from, in the page's language. About
// 130 KB of JSON for the whole graph, measured 2026-09-22, against 386 KB for
// the same nodes with their conditions and both languages.
//
// Nothing here is rewritten or summarised: every string is the node's own
// field, copied. A planner that paraphrased a method's cost would be a second
// author of it.
import type { LayerCapability, LayerGraph, LayerMethod } from "../repository/layers.ts";

export type PlannerLocale = "en" | "ja";

export interface PlannerRepeat {
  /** The authored mark, e.g. `×O(κ)`. */
  mark: string;
  /** The authored sentence the mark abbreviates. */
  count: string;
}

export interface PlannerNode {
  id: string;
  kind: "capability" | "method";
  label: string;
  shortLabel: string | null;
  summary: string;
  /** Method only: the capability it realises. */
  realizes: string | null;
  /** Method only: the capabilities it needs, in the route's order. */
  steps: string[];
  /** Method only: step capability → the method the route's own source used there. */
  via: Record<string, string>;
  /** Method only: step capability → how often the route runs it, where a source says. */
  repeats: Record<string, PlannerRepeat>;
  /** Method only: the cost as the primary source states it, `$…$` math intact. */
  cost: string | null;
  /** Method only: what the method does on the stretch it closes itself, when recorded. */
  ownStretch: string | null;
  /** Capability only: what it takes and what it returns, as the contract states them. */
  takes: string | null;
  returns: string | null;
}

export interface PlannerGraph {
  locale: PlannerLocale;
  nodes: PlannerNode[];
}

function pick(en: string | undefined, ja: string | undefined, locale: PlannerLocale): string | null {
  const value = locale === "ja" ? (ja ?? en) : en;
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function slimCapability(node: LayerCapability, locale: PlannerLocale): PlannerNode {
  return {
    id: node.id,
    kind: "capability",
    label: pick(node.label, node.labelJa, locale) ?? node.id,
    shortLabel: pick(node.shortLabel, node.shortLabelJa, locale),
    summary: pick(node.summary, node.summaryJa, locale) ?? "",
    realizes: null,
    steps: [],
    via: {},
    repeats: {},
    cost: null,
    ownStretch: null,
    takes: pick(node.contract.takes, node.contract.takesJa, locale),
    returns: pick(node.contract.returns, node.contract.returnsJa, locale),
  };
}

function slimMethod(node: LayerMethod, locale: PlannerLocale): PlannerNode {
  const own = node.hops?.[node.id];
  const repeats: Record<string, PlannerRepeat> = {};
  for (const [step, repeat] of Object.entries(node.repeats ?? {})) {
    repeats[step] = {
      mark: locale === "ja" ? repeat.markJa : repeat.mark,
      count: locale === "ja" ? repeat.countJa : repeat.count,
    };
  }
  return {
    id: node.id,
    kind: "method",
    label: pick(node.label, node.labelJa, locale) ?? node.id,
    shortLabel: pick(node.shortLabel, node.shortLabelJa, locale),
    summary: pick(node.summary, node.summaryJa, locale) ?? "",
    realizes: node.realizes,
    steps: [...(node.steps ?? [])],
    via: { ...(node.via ?? {}) },
    repeats,
    cost: pick(node.cost, node.costJa, locale),
    ownStretch: pick(own?.name, own?.nameJa, locale),
    takes: null,
    returns: null,
  };
}

export function slimLayerGraph(graph: LayerGraph, locale: PlannerLocale): PlannerGraph {
  return {
    locale,
    nodes: graph.nodes.map((node) =>
      node.kind === "capability" ? slimCapability(node, locale) : slimMethod(node, locale),
    ),
  };
}

export interface IndexedGraph {
  byId: ReadonlyMap<string, PlannerNode>;
  /** Capability id → the methods realising it, in the graph's authored order. */
  realisers: ReadonlyMap<string, PlannerNode[]>;
}

export function indexPlannerGraph(graph: PlannerGraph): IndexedGraph {
  const byId = new Map<string, PlannerNode>();
  const realisers = new Map<string, PlannerNode[]>();
  for (const node of graph.nodes) {
    byId.set(node.id, node);
    if (node.kind === "method" && node.realizes) {
      const list = realisers.get(node.realizes) ?? [];
      list.push(node);
      realisers.set(node.realizes, list);
    }
  }
  return { byId, realisers };
}
