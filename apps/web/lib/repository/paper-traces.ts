// Is a paper a *line* on the map, or a scatter of unrelated points?
//
// > *"measure whether a paper's cited nodes actually connect before building the
// > paper sidebar."*
// > — the standing instruction from session 98, and the reason this file is a
// > measurement before it is a renderer.
//
// ## The question, and why guessing it wrong is expensive
//
// A citation attaches to **one node**. A trace is a **path**. Those are not the
// same shape, and the whole "papers as traces" idea rests on an assumption
// nobody had checked: that the nodes citing one paper sit next to each other, so
// there is a line to draw between them.
//
// If they do not, a paper sidebar listing 84 papers is 84 promises of a line,
// most of which would render as a handful of disconnected dots with nothing
// honest to draw between them. That is worse than not shipping it — it is the
// same failure as a coverage number counting records no node could anchor.
//
// So this module answers the question first and returns a **shape** per paper,
// and the surface is built against the answer rather than the hope.
//
// ## What counts as an edge, and what deliberately does not
//
// The map's edges are containment and realisation:
//
// - a method — the capability it `realizes`;
// - a method — each capability in its `steps`;
// - a method — the method it `refines`.
//
// **`bypasses` is not an edge here, and that is a claim rather than an
// oversight.** A bypass records that a route *does not enter* a layer. Joining a
// paper's citations through one would draw a line through a node the cited route
// explicitly avoids — the single strongest negative claim on the surface, read
// backwards. A trace that needs a bypass to connect is not contiguous.
//
// ## What the shapes mean
//
// `point` and `scattered` are the two that must never be collapsed into
// "no trace": one is a paper cited once, which is the normal state of most of
// the register, and the other is a paper whose citations genuinely do not join
// up. Same doctrine as `stepsOutlook` and `repeats` — a blank never means two
// things.
import type { LayerGraph, LayerNode } from "./layers";
import type { PaperId } from "./papers";
// Extensioned: `node --test` resolves specifiers literally, so an extensionless
// runtime import fails at load. The `import type` lines above are erased before
// they run, which is why they differ.
import { isMethod } from "./layers.ts";
import { paperIdFromUrl } from "./papers.ts";

export type TraceShape =
  /** One node cites it. A point is not a line, and there is nothing to draw. */
  | "point"
  /** Every citing node is reachable from every other **through citing nodes only**. */
  | "contiguous"
  /** Not contiguous, but the gaps close by walking through nodes the paper does not cite. */
  | "joinable"
  /** The citing nodes fall in different connected components of the map. No path exists at all. */
  | "scattered";

export interface PaperTrace {
  paper: PaperId;
  /** Node ids citing this paper, in graph order. Never empty. */
  nodes: readonly string[];
  /** Connected components of the subgraph induced on `nodes`, each in graph order. */
  components: readonly (readonly string[])[];
  shape: TraceShape;
  /**
   * Nodes the paper does **not** cite that a walk had to pass through to join
   * its components — an **upper bound**, never the minimum.
   *
   * Computed greedily: grow one component, then repeatedly splice in the
   * shortest path to whichever component is nearest. Minimum-cardinality Steiner
   * tree is NP-hard and this is not it, so the field is named and documented as
   * a bound. A reader deciding "is this paper one line or three" is served by an
   * upper bound; a reader told "3" who could have had 2 is misinformed, so it is
   * never called minimal anywhere.
   *
   * Empty for `point` and `contiguous`. Absent for `scattered`, where no walk
   * exists — absent and empty mean different things here, deliberately.
   */
  bridgeUpperBound?: readonly string[];
}

/** Undirected adjacency over the map. See the header for why `bypasses` is absent. */
export function layerAdjacency(graph: LayerGraph): ReadonlyMap<string, ReadonlySet<string>> {
  const ids = new Set(graph.nodes.map((node) => node.id));
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    // A dangling id is `validateLayerGraph`'s error to report, not this
    // module's to invent an edge for. Silently linking to a node that does not
    // exist would make a paper look contiguous through a hole in the graph.
    if (!ids.has(a) || !ids.has(b) || a === b) return;
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };
  for (const node of graph.nodes) {
    if (!adjacency.has(node.id)) adjacency.set(node.id, new Set());
    if (!isMethod(node)) continue;
    link(node.id, node.realizes);
    for (const step of node.steps) link(node.id, step);
    if (node.refines) link(node.id, node.refines);
  }
  return adjacency;
}

/** Which papers each node cites, keyed by node id. Unparseable urls are skipped. */
export function papersByNode(graph: LayerGraph): ReadonlyMap<string, ReadonlySet<PaperId>> {
  const byNode = new Map<string, Set<PaperId>>();
  for (const node of graph.nodes) {
    const papers = new Set<PaperId>();
    for (const citation of node.citations ?? []) {
      const id = paperIdFromUrl(citation.url);
      // An unparseable citation url already fails `check-paper-register.mjs`.
      // Dropping it here rather than throwing keeps the measurement runnable on
      // a broken tree, which is when you most want to run it.
      if (id !== null) papers.add(id);
    }
    if (papers.size > 0) byNode.set(node.id, papers);
  }
  return byNode;
}

function componentsOf(
  members: readonly string[],
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
  order: ReadonlyMap<string, number>,
): string[][] {
  const remaining = new Set(members);
  const components: string[][] = [];
  while (remaining.size > 0) {
    const seed = [...remaining][0];
    const component: string[] = [];
    const queue = [seed];
    remaining.delete(seed);
    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);
      for (const neighbour of adjacency.get(current) ?? []) {
        if (remaining.has(neighbour)) {
          remaining.delete(neighbour);
          queue.push(neighbour);
        }
      }
    }
    components.push(component.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }
  return components.sort((a, b) => (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
}

/** Shortest path between two node sets, inclusive of both endpoints, or null. */
function shortestPath(
  from: ReadonlySet<string>,
  to: ReadonlySet<string>,
  adjacency: ReadonlyMap<string, ReadonlySet<string>>,
): string[] | null {
  const previous = new Map<string, string | null>();
  const queue: string[] = [];
  for (const start of from) {
    previous.set(start, null);
    queue.push(start);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (to.has(current) && !from.has(current)) {
      const path: string[] = [];
      for (let at: string | null = current; at !== null; at = previous.get(at) ?? null) {
        path.push(at);
      }
      return path.reverse();
    }
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!previous.has(neighbour)) {
        previous.set(neighbour, current);
        queue.push(neighbour);
      }
    }
  }
  return null;
}

/**
 * The shape of every paper the map cites, in descending order of how many nodes
 * cite it, then by id so the order is total.
 */
export function paperTraces(graph: LayerGraph): PaperTrace[] {
  const adjacency = layerAdjacency(graph);
  const order = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
  const nodesByPaper = new Map<PaperId, string[]>();
  for (const [nodeId, papers] of papersByNode(graph)) {
    for (const paper of papers) {
      nodesByPaper.set(paper, [...(nodesByPaper.get(paper) ?? []), nodeId]);
    }
  }

  const traces: PaperTrace[] = [];
  for (const [paper, unsorted] of nodesByPaper) {
    const nodes = [...unsorted].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (nodes.length === 1) {
      traces.push({ paper, nodes, components: [nodes], shape: "point", bridgeUpperBound: [] });
      continue;
    }
    const components = componentsOf(nodes, adjacency, order);
    if (components.length === 1) {
      traces.push({ paper, nodes, components, shape: "contiguous", bridgeUpperBound: [] });
      continue;
    }
    // Greedy join. `grown` is everything reached so far — cited or walked
    // through — and each round splices in the shortest path to whichever
    // component is still outside it.
    const outstanding = components.slice(1).map((component) => new Set(component));
    const grown = new Set(components[0]);
    const bridge = new Set<string>();
    let joined = true;
    while (outstanding.length > 0) {
      let best: { path: string[]; index: number } | null = null;
      for (const [index, component] of outstanding.entries()) {
        const path = shortestPath(grown, component, adjacency);
        if (path !== null && (best === null || path.length < best.path.length)) {
          best = { path, index };
        }
      }
      if (best === null) {
        joined = false;
        break;
      }
      for (const id of best.path) {
        grown.add(id);
        if (!nodes.includes(id)) bridge.add(id);
      }
      for (const id of outstanding[best.index]) grown.add(id);
      outstanding.splice(best.index, 1);
    }
    traces.push(
      joined
        ? {
            paper,
            nodes,
            components,
            shape: "joinable",
            bridgeUpperBound: [...bridge].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)),
          }
        : // No `bridgeUpperBound` at all: a partial bridge would read as "these
          // are the nodes that join it", and nothing joins it.
          { paper, nodes, components, shape: "scattered" },
    );
  }

  return traces.sort(
    (a, b) => b.nodes.length - a.nodes.length || (a.paper < b.paper ? -1 : a.paper > b.paper ? 1 : 0),
  );
}

export interface TraceCensus {
  /** Papers the map cites at all. The denominator for everything else here. */
  papers: number;
  point: number;
  contiguous: number;
  joinable: number;
  scattered: number;
  /** Papers with a line to draw without leaving the cited set — `contiguous`. */
  drawable: number;
  /** The largest number of nodes any one paper is cited from. */
  widest: number;
}

export function traceCensus(traces: readonly PaperTrace[]): TraceCensus {
  const count = (shape: TraceShape) => traces.filter((trace) => trace.shape === shape).length;
  return {
    papers: traces.length,
    point: count("point"),
    contiguous: count("contiguous"),
    joinable: count("joinable"),
    scattered: count("scattered"),
    drawable: count("contiguous"),
    widest: traces.reduce((max, trace) => Math.max(max, trace.nodes.length), 0),
  };
}

/** The trace for one paper, or null if the map does not cite it. */
export function traceFor(traces: readonly PaperTrace[], paper: PaperId): PaperTrace | null {
  return traces.find((trace) => trace.paper === paper) ?? null;
}

// ---------------------------------------------------------------------------
// The drift guard (ADR-0026)
// ---------------------------------------------------------------------------

/**
 * Papers whose citations are allowed to sit in different components of the map,
 * each with the reason somebody wrote down.
 *
 * ## Why a scattered trace is the checkable half of the owner's rule
 *
 * ai-ops#51 made it doctrine that a component may be extracted from a paper
 * about something else, on two conditions: *"that we know that the paper is
 * actually relevant to the topic at hand, and that when going at this more
 * granular level it doesn't abstract to unrelated topics."*
 *
 * The second condition has a graph form and it is already computed here.
 * `scattered` means the citing nodes fall in **different connected components**
 * — no chain of `realizes`, `steps` or `refines` joins the places this one paper
 * has been used. Not "far apart"; **not joined at all**. That is the strongest
 * statement the map can make that two uses of one paper are about unrelated
 * things, and it is a property of the data rather than an opinion about it.
 *
 * ## Why it is not vacuous, measured
 *
 * A gate on a shape the data cannot take is decoration. Measured 2026-08-13 on
 * `origin/dev`: the map is **three** connected components under the trace edge
 * set — 99 nodes (the algorithms cluster), 13 (compilation and error
 * correction), 5 (error mitigation) — so a paper cited from two of them is
 * scattered, and `repository-paper-traces.test.ts` has carried a fixture that
 * produces the shape since the module was written. Also measured the same day:
 * **0 of the 117 papers the map cites are scattered**, so this arms on a clean
 * board and grandfathers nothing.
 *
 * ## Why a declaration list rather than a hard refusal
 *
 * Because the honest reading of a scatter is ambiguous and only a human can pick
 * between the two: either the extraction drifted, or **the map is missing an
 * edge** and the paper is telling us so. A list makes whoever hits it say which.
 *
 * Stale-proof in both directions, the same rule `DECLARED_SHARED_SOURCES` and
 * `KNOWN_SOURCE_TITLE_DRIFT` obey: an undeclared scatter fails, and a
 * declaration for a paper that is no longer scattered **also** fails, so a row
 * cannot outlive the condition it excuses.
 *
 * **Empty is the intended state.** If this grows past a handful, the gate has
 * started measuring the map's disconnection rather than an extraction's drift —
 * ADR-0026's reversal trigger.
 */
export const DECLARED_SCATTERED_PAPERS: Readonly<Record<PaperId, string>> = {};

export interface ScatterAudit {
  /** Scattered traces with no declaration. **The error.** */
  undeclared: readonly PaperTrace[];
  /**
   * Declared papers that are not scattered today — either they were joined, or
   * the map stopped citing them. **Also an error**, and a different one: the fix
   * is to delete the row, not to write another.
   */
  stale: readonly PaperId[];
}

/**
 * Compare the scattered traces against the declarations.
 *
 * Takes `declared` as an argument rather than reading the constant, so the
 * rule can be exercised against fixtures in both directions without the
 * repository's own declarations leaking into the test.
 */
export function auditScatteredTraces(
  traces: readonly PaperTrace[],
  declared: Readonly<Record<string, string>> = DECLARED_SCATTERED_PAPERS,
): ScatterAudit {
  const scattered = new Set(
    traces.filter((trace) => trace.shape === "scattered").map((trace) => trace.paper),
  );
  return {
    undeclared: traces.filter(
      (trace) =>
        trace.shape === "scattered" &&
        // An empty reason is not a declaration. A row that excuses a failure has
        // to say why, or the list becomes a list of ids nobody can re-judge.
        (declared[trace.paper] ?? "").trim() === "",
    ),
    stale: Object.keys(declared).filter((paper) => !scattered.has(paper)),
  };
}

/** Every node in a trace including its bridge, in graph order — what a renderer draws. */
export function traceNodes(graph: LayerGraph, trace: PaperTrace): LayerNode[] {
  const wanted = new Set([...trace.nodes, ...(trace.bridgeUpperBound ?? [])]);
  return graph.nodes.filter((node) => wanted.has(node.id));
}
