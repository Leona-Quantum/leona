// Everything one paper's page shows, assembled in one place so the index and
// the detail page cannot disagree about what a paper is.
//
// ## Why this exists as its own module rather than inside the component
//
// Two surfaces read it — `/repository/papers` and `/repository/papers/[id]` —
// and the second is reachable from the first. A count on the index that the
// detail page contradicts is the exact failure the register was built to end,
// reintroduced in the renderer. So the numbers are computed once, here, and
// both surfaces render the same object.
//
// The corpus half is passed in rather than imported: `public-repository.ts`
// cannot be reached from `node --test`, and the Atlas is served from the
// catalog API in production anyway. See `repository-source.ts`.
import type { LayerGraph, LayerNode } from "./layers";
import type { PaperTrace } from "./paper-traces";
import type { PaperId, PaperRegister, RegisteredPaper } from "./papers";
import type { StateVocabulary } from "./states";
import { isCapability } from "./layers.ts";
import { paperTraces, traceFor } from "./paper-traces.ts";
import { indexPapers, paperIdFromUrl, paperSlug } from "./papers.ts";

/** One place a paper is cited from, on either side. */
export interface PaperCitationSite {
  /** `/repository/layers/<id>` or `/repository/<slug>` — where a reader goes. */
  href: string;
  label: string;
  labelJa: string;
  /**
   * What kind of thing cites it. The two are not interchangeable: a node is a
   * claim about *how a method works*, an Atlas record is a documented artefact.
   * A page that merged them would report "cited in 5 places" for a paper the
   * map cites once.
   */
  kind: "slot" | "method" | "record";
}

export interface PaperPage {
  paper: RegisteredPaper;
  slug: string;
  /** Map nodes citing it, in graph order. */
  nodes: PaperCitationSite[];
  /** Atlas records citing it, in corpus order. */
  records: PaperCitationSite[];
  /**
   * The shape of this paper on the map, or `null` when no node cites it.
   *
   * `null` and `point` are different facts and must render differently: the
   * first is a paper the map has never used, the second is a paper the map uses
   * in exactly one place. Collapsing them would report 60 papers as absent from
   * a map that cites every one of them.
   */
  trace: PaperTrace | null;
  /**
   * The uncited nodes a `joinable` trace has to walk through, as links.
   *
   * Resolved to labels here rather than rendered from `trace.bridgeUpperBound`
   * directly, because those are ids — `polynomial-approximation` — and an id
   * printed in a reader-facing list is a leak of the data model into the page.
   * Empty for every other shape.
   */
  bridge: PaperCitationSite[];
}

/** The minimum an Atlas record has to supply to appear on a paper page. */
export interface PaperCorpusEntry {
  slug: string;
  title: string;
  titleJa?: string;
  literature?: ReadonlyArray<{ url: string }>;
}

function siteForNode(node: LayerNode): PaperCitationSite {
  return {
    href: `/repository/layers/${node.id}`,
    label: node.label,
    labelJa: node.labelJa,
    kind: isCapability(node) ? "slot" : "method",
  };
}

/**
 * One page per registered paper, in register order.
 *
 * Every row gets one, including the rows nothing cites — a registered paper the
 * map has not placed is the normal state of an ingestion queue, and it having
 * an address is what makes the queue readable rather than merely counted.
 */
export function paperPages(
  register: PaperRegister,
  graph: LayerGraph,
  corpus: readonly PaperCorpusEntry[],
  vocabulary: StateVocabulary,
): PaperPage[] {
  const traces = paperTraces(graph, vocabulary);
  const nodesByPaper = new Map<PaperId, PaperCitationSite[]>();
  for (const node of graph.nodes) {
    for (const citation of node.citations ?? []) {
      const id = paperIdFromUrl(citation.url);
      if (id === null) continue;
      const sites = nodesByPaper.get(id) ?? [];
      // A node citing one paper twice is one citing node, not two. Nothing
      // forbids the duplicate today and the count is the thing on the page.
      if (!sites.some((site) => site.href === `/repository/layers/${node.id}`)) {
        sites.push(siteForNode(node));
      }
      nodesByPaper.set(id, sites);
    }
  }
  const recordsByPaper = new Map<PaperId, PaperCitationSite[]>();
  for (const entry of corpus) {
    for (const citation of entry.literature ?? []) {
      const id = paperIdFromUrl(citation.url);
      if (id === null) continue;
      const sites = recordsByPaper.get(id) ?? [];
      if (!sites.some((site) => site.href === `/repository/${entry.slug}`)) {
        sites.push({
          href: `/repository/${entry.slug}`,
          label: entry.title,
          labelJa: entry.titleJa ?? entry.title,
          kind: "record",
        });
      }
      recordsByPaper.set(id, sites);
    }
  }

  const byNodeId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  return register.papers.map((paper) => {
    const trace = traceFor(traces, paper.id);
    return {
      paper,
      slug: paperSlug(paper.id),
      nodes: nodesByPaper.get(paper.id) ?? [],
      records: recordsByPaper.get(paper.id) ?? [],
      trace,
      bridge: (trace?.bridgeUpperBound ?? []).flatMap((id) => {
        const node = byNodeId.get(id);
        // A bridge id that does not resolve is a graph the validator would
        // already have refused. Dropping it beats rendering a link with an id
        // for a label, which is what the whole field exists to avoid.
        return node ? [siteForNode(node)] : [];
      }),
    };
  });
}

export function paperPageFor(pages: readonly PaperPage[], id: PaperId): PaperPage | null {
  return pages.find((page) => page.paper.id === id) ?? null;
}

/**
 * How many papers sit in each state of being read and placed.
 *
 * Every field is a count of `PaperPage`s and they are deliberately **not** a
 * partition — a paper can be both read and uncited. A reader is served by
 * knowing each number against the same total, not by a pie chart that forces
 * four overlapping facts into one ring.
 */
export interface PaperIndexCensus {
  papers: number;
  read: number;
  /** Papers at least one map node cites. */
  onMap: number;
  /** Papers at least one Atlas record cites. */
  inAtlas: number;
  /** Papers both sides cite — where the two bibliographies actually meet. */
  both: number;
  /** Papers nothing cites yet: the ingestion queue, read or not. */
  queued: number;
  /** Of the papers on the map, those cited from more than one node. */
  spanning: number;
}

export function paperIndexCensus(pages: readonly PaperPage[]): PaperIndexCensus {
  const onMap = pages.filter((page) => page.nodes.length > 0);
  const inAtlas = pages.filter((page) => page.records.length > 0);
  return {
    papers: pages.length,
    read: pages.filter((page) => page.paper.reports !== undefined).length,
    onMap: onMap.length,
    inAtlas: inAtlas.length,
    both: pages.filter((page) => page.nodes.length > 0 && page.records.length > 0).length,
    queued: pages.filter((page) => page.nodes.length === 0 && page.records.length === 0).length,
    spanning: onMap.filter((page) => page.nodes.length > 1).length,
  };
}
