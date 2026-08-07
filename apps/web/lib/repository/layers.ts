// The layer graph: what a piece is *made of*, and what else could fill its slot.
//
// > *"going deeper level by level should be possible through these blocks, going
// > between and around layers, and easy to navigate as a user… right now, it is
// > looking too much like a bunch of separate entries rather than this 'things
// > fit together, choose your own path' kind of way."*
// > — owner, session-88 inbox
//
// ## Why this is not a field on an entry
//
// `interface.ts` already answers *"what meets this record's edges"* and it
// answers it at the level of a **register**: a width and a type, compared
// against another width and type. That is the right question for two circuits
// and it is the wrong question for the thing the owner is describing, because
// QSVT does not sit *beside* a quantum linear solve — it sits *inside* one, and
// the linear solve sits inside a differential-equation pipeline, and each of
// those levels has its own alternatives with their own trade-offs.
//
// A containment relation cannot be derived from register widths. It also cannot
// be hung on a record: 283 records would each need to know their place in a
// structure that mostly does not exist yet, and 282 of them would say
// `unknown` — the second empty skeleton D88.3 forbids. So the graph is a
// **separate authored artifact**, small, cited, and deliberately allowed to
// describe layers the corpus has no record for. Where the corpus is empty the
// page says so, and that emptiness is the most useful thing on it: it is the
// list of what the R3.5 corpus pass has to go and read.
//
// ## Why it is authored in code rather than imported as catalog rows
//
// Production serves `/repository` from `GET /v1/catalog/entries`
// (`MAJORANA_PUBLIC_CATALOG_API=true`), so a new *entry* is a two-part deploy:
// merge, then regenerate the bootstrap manifest and re-import. This graph is not
// entries. Like `topics.ts` — the other closed vocabulary in this directory — it
// is code the Next app reads directly, which makes it a one-part deploy and
// keeps it out of the 283-record pin, the width-family gate, and the manifest
// freshness check. It references the corpus **by slug**, in one direction only.
//
// ## The four things this module must never do
//
// 1. **Never compare a capability contract to a register width.** A contract
//    here is semantic — "a block-encoding of A and a state proportional to b".
//    `Port` in `interface.ts` is a number of qubits. They are different kinds,
//    they are deliberately not the same type, and nothing may join them.
// 2. **Never let a blank mean four things.** `stepsOutlook` and
//    `capabilityOutlook` exist for the same reason `portOutlook` does: "no
//    sub-steps" is a different claim from "nobody has decomposed this", and a
//    reader who cannot tell them apart is being told the corpus is more complete
//    than it is.
// 3. **Never round a sibling set up.** `alternativesTo` and `refinementsOf` are
//    a **partition** of the other methods realising the same capability. They are
//    disjoint, and either may be zero — the property `repository-layers.test.ts`
//    pins, because three sessions running a sentence shipped that presupposed a
//    set which was empty on the record that motivated the feature.
// 4. **Never fill a hole.** An unstated applicability condition is `undefined`,
//    not a plausible sentence. Same rule §3.6 applies to a gap in a record.
import type { PublicRepositoryCategory } from "./types";

/** A node is one of exactly two things, and the distinction is load-bearing. */
export type LayerNodeKind = "capability" | "method";

/**
 * A primary source. Deliberately the same shape as `PublicRepositoryCitation`
 * minus the `relevance` pair: a citation here supports a *structural* claim
 * ("this method realises that capability"), and the relevance is the edge it is
 * attached to rather than a sentence about the paper.
 */
export interface LayerCitation {
  title: string;
  authors: string;
  year: string;
  /** Always `https://`. Validation rejects anything else. */
  url: string;
}

/**
 * What crosses the boundary of a node, **at that node's own level of
 * abstraction** — which is the whole reason this type is not `Port`.
 *
 * "A block-encoding of A, and a unitary preparing |b⟩" is a contract. It is not
 * three qubits. Two capabilities whose contracts read the same are candidates
 * for the same slot; nothing about that is decidable by machine, so this module
 * publishes contracts for a **reader** and never computes a verdict from them.
 */
export interface LayerContract {
  takes: string;
  takesJa: string;
  returns: string;
  returnsJa: string;
}

/** Fields every node carries, whichever kind it is. */
interface LayerNodeBase {
  id: string;
  label: string;
  labelJa: string;
  summary: string;
  summaryJa: string;
  /**
   * Corpus slugs that document this node. **Usually empty, and that is the
   * finding rather than a defect** — measured 2026-08-07, the corpus carries
   * four block-encoding records, one adiabatic record and no record at all
   * mentioning qubitisation, LCHS, Carleman or Schrödingerisation.
   *
   * Validated to resolve: a slug here that no record carries is an error, not a
   * quiet blank, because a dead cross-link is indistinguishable from a layer
   * nobody has documented.
   */
  entries?: readonly string[];
  citations?: readonly LayerCitation[];
}

/**
 * A slot: something a reader is trying to achieve, stated as a contract.
 *
 * The test of whether a capability is real rather than an arbitrary cut is
 * `whyALayer` — if there is no honest sentence saying which genuinely different
 * methods compete for this slot, it is not a layer, it is a step in one method's
 * write-up and belongs in that method's summary.
 */
export interface LayerCapability extends LayerNodeBase {
  kind: "capability";
  /** The slot's own contract. Required: a slot with no contract is a topic tag. */
  contract: LayerContract;
  whyALayer: string;
  whyALayerJa: string;
}

/**
 * A way to fill a slot.
 *
 * `steps` is the containment edge — the thing the owner asked for. A method's
 * steps are **capabilities**, never other methods, which is what keeps the
 * structure a ladder rather than one author's favourite pipeline: descending
 * into a step lands on the slot and its competing methods, not on a single
 * pre-chosen answer.
 */
export interface LayerMethod extends LayerNodeBase {
  kind: "method";
  /** The capability this fulfils. Exactly one, and it must exist. */
  realizes: string;
  /**
   * Present **only when this method narrows the slot's contract** — it needs
   * sparse-access oracles rather than any block-encoding, say, or it returns a
   * flagged state rather than a plain one.
   *
   * Absent means "the same contract as the capability", and absent is the
   * common case on purpose. Restating an unchanged contract per method would be
   * a second copy of the slot's definition, sitting one click away from the
   * first, drifting the first time either is edited — the duplication rule §2
   * applies to prose as much as to numbers. `contractFor` below is the single
   * reader.
   */
  contract?: LayerContract;
  /**
   * A broader method this specialises. Must realise the **same** capability —
   * a "refinement" that fills a different slot is an alternative wearing the
   * wrong word, and validation rejects it.
   */
  refines?: string;
  /**
   * When it applies and when it does not.
   *
   * **Absent means no source we read stated one.** Never `""` — an empty string
   * is the ambiguous middle between "unstated" and "none", and validation
   * rejects it. The page renders the absence as an absence.
   */
  conditions?: string;
  conditionsJa?: string;
  /** Complexity as the primary source claims it, parameters named. Absent = not stated. */
  cost?: string;
  costJa?: string;
  /** The capabilities this method needs, in the order a reader meets them. */
  steps: readonly string[];
  /**
   * Declared to have no sub-steps **at this level, on purpose** — as opposed to
   * simply not having been decomposed yet. Only meaningful when `steps` is
   * empty; validation rejects it beside a non-empty `steps`.
   */
  atomic?: boolean;
  /**
   * Capabilities this route makes **unnecessary**, not ones it needs.
   *
   * This is the edge that makes the graph a graph. Roadmap §9 already recorded
   * the case: LCHS and Schrödingerisation do not implement a quantum linear
   * solve better — they replace the discretise-and-solve span with Hamiltonian
   * simulation, so the whole linear-solve layer is not on their path. A reader
   * standing on a capability needs to be told that some routes skip it, or the
   * ladder reads as compulsory.
   */
  bypasses?: readonly string[];
  /**
   * Where the advantage claim is disputed, superseded or dequantised.
   *
   * Present on a method whose headline is contested in the literature. Roadmap
   * §9's framing is the standing one: the product is the complete cost chain
   * with the citation attached, and the region where it closes is small, moving
   * and genuinely argued over. Hiding that is the credibility loss.
   */
  contested?: string;
  contestedJa?: string;
}

export type LayerNode = LayerCapability | LayerMethod;

/** The authored artifact: an ordered node list, read by id everywhere else. */
export interface LayerGraph {
  nodes: readonly LayerNode[];
}

export function isCapability(node: LayerNode): node is LayerCapability {
  return node.kind === "capability";
}

export function isMethod(node: LayerNode): node is LayerMethod {
  return node.kind === "method";
}

/** Id → node, built once per render. Every lookup below goes through it. */
export function indexLayerGraph(graph: LayerGraph): ReadonlyMap<string, LayerNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

export function layerNode(graph: LayerGraph, id: string): LayerNode | null {
  return graph.nodes.find((node) => node.id === id) ?? null;
}

/**
 * What is below a method, and the three readings are three different claims.
 *
 * Same shape and same reason as `portOutlook` in `interface.ts`: before it
 * existed, a blank edge meant four things and all four rendered as "Nothing".
 * Here a method with no steps means either "this is where the description
 * bottoms out on purpose" or "nobody has taken it apart yet", and those are
 * opposite statements about how complete the graph is.
 */
export type StepsOutlook = "decomposed" | "atomic" | "undecomposed";

export function stepsOutlook(method: LayerMethod): StepsOutlook {
  if (method.steps.length > 0) return "decomposed";
  return method.atomic ? "atomic" : "undecomposed";
}

/**
 * What is above a capability.
 *
 * `open` is not a defect either. A slot nothing realises is a statement that the
 * layer is real and the graph has not recorded a way to fill it — which is
 * exactly the shape of an honest gap, and the reason it renders as its own thing
 * rather than as an empty list.
 */
export type CapabilityOutlook = "realized" | "open";

export function capabilityOutlook(graph: LayerGraph, capabilityId: string): CapabilityOutlook {
  return methodsRealizing(graph, capabilityId).length > 0 ? "realized" : "open";
}

/** Every method that fills this slot, in graph order. */
export function methodsRealizing(graph: LayerGraph, capabilityId: string): LayerMethod[] {
  return graph.nodes.filter(
    (node): node is LayerMethod => isMethod(node) && node.realizes === capabilityId,
  );
}

/**
 * The other methods filling the same slot.
 *
 * Split below into a partition. Kept as its own function because both halves
 * must be read off the *same* set or they stop being a partition the first time
 * one of them grows a condition the other does not.
 */
export function siblingsOf(graph: LayerGraph, method: LayerMethod): LayerMethod[] {
  return methodsRealizing(graph, method.realizes).filter((other) => other.id !== method.id);
}

/** Siblings that are narrower versions of *this* method. */
export function refinementsOf(graph: LayerGraph, method: LayerMethod): LayerMethod[] {
  return siblingsOf(graph, method).filter((other) => other.refines === method.id);
}

/**
 * Siblings that are not narrower versions of this method.
 *
 * With `refinementsOf` this is a **partition** of `siblingsOf`: disjoint, union
 * is the whole set, and **either side may be empty**. Nothing rendering these
 * two lists may write a sentence that presupposes the other is non-empty —
 * "and N more" reads as false the moment the first list is zero, which is what
 * shipped three sessions running.
 *
 * A method here may itself refine a *third* method. It is still an alternative
 * to this one, and the page names its parent rather than flattening it.
 */
export function alternativesTo(graph: LayerGraph, method: LayerMethod): LayerMethod[] {
  return siblingsOf(graph, method).filter((other) => other.refines !== method.id);
}

/** Methods that need this capability as a step — "this is a step inside". */
export function containersOf(graph: LayerGraph, capabilityId: string): LayerMethod[] {
  return graph.nodes.filter(
    (node): node is LayerMethod => isMethod(node) && node.steps.includes(capabilityId),
  );
}

/** Methods that make this capability unnecessary — the routes around the layer. */
export function bypassersOf(graph: LayerGraph, capabilityId: string): LayerMethod[] {
  return graph.nodes.filter(
    (node): node is LayerMethod => isMethod(node) && (node.bypasses ?? []).includes(capabilityId),
  );
}

/** The capability a method fills, or null if the id does not resolve. */
export function realizedBy(graph: LayerGraph, method: LayerMethod): LayerCapability | null {
  const node = layerNode(graph, method.realizes);
  return node && isCapability(node) ? node : null;
}

/**
 * The contract to print for a node, and where it came from.
 *
 * `inherited` is not a formatting detail: a method that narrows the slot's
 * contract is making a claim the slot does not make — "this one needs sparse
 * row and column oracles, not any block-encoding" — and a reader choosing
 * between siblings has to be able to see which of them moved the goalposts.
 * Printing both the same way would hide the only difference that matters.
 */
export function contractFor(
  graph: LayerGraph,
  node: LayerNode,
): { contract: LayerContract; source: "own" | "inherited" } | null {
  if (isCapability(node)) return { contract: node.contract, source: "own" };
  if (node.contract) return { contract: node.contract, source: "own" };
  const capability = realizedBy(graph, node);
  return capability ? { contract: capability.contract, source: "inherited" } : null;
}

/**
 * Distance from the top, by **shortest** path.
 *
 * Shortest rather than longest on purpose: a capability reachable both as a
 * direct step of a top-level method and as a step four levels down is *first*
 * met at the shallower depth, and the index reads in the order a reader meets
 * things. Longest-path would bury it under the deepest route that happens to
 * mention it.
 *
 * Roots are the capabilities no method lists as a step. A graph whose `steps`
 * edges contain a cycle has no well-defined depth; `validateLayerGraph` rejects
 * one, and this function is total regardless — an unreachable node gets `null`.
 */
export function layerDepths(graph: LayerGraph): ReadonlyMap<string, number> {
  const stepped = new Set<string>();
  for (const node of graph.nodes) {
    if (isMethod(node)) for (const step of node.steps) stepped.add(step);
  }
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const node of graph.nodes) {
    if (isCapability(node) && !stepped.has(node.id)) {
      depth.set(node.id, 0);
      queue.push(node.id);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    const here = depth.get(id) ?? 0;
    for (const method of methodsRealizing(graph, id)) {
      for (const step of method.steps) {
        if (depth.has(step)) continue;
        depth.set(step, here + 1);
        queue.push(step);
      }
    }
  }
  return depth;
}

/**
 * The capabilities that start a reading, in graph order.
 *
 * A root is a slot nothing else needs — a problem someone arrives with, rather
 * than a step inside somebody's method.
 */
export function rootCapabilities(graph: LayerGraph): LayerCapability[] {
  const stepped = new Set<string>();
  for (const node of graph.nodes) {
    if (isMethod(node)) for (const step of node.steps) stepped.add(step);
  }
  return graph.nodes.filter(
    (node): node is LayerCapability => isCapability(node) && !stepped.has(node.id),
  );
}

/** Which corpus records point at this node, filtered to the ones that resolve. */
export function entriesFor(node: LayerNode, corpus: ReadonlySet<string>): string[] {
  return (node.entries ?? []).filter((slug) => corpus.has(slug));
}

/**
 * How much of the graph the corpus actually covers.
 *
 * Every number the page prints comes from here rather than from a sentence, on
 * `repository-preface.tsx`'s rule: a number typed into translated copy is a
 * second copy of a fact and nothing fails when it drifts. This one is going to
 * be embarrassing for a while — that is the point of printing it.
 */
export interface LayerCensus {
  nodes: number;
  capabilities: number;
  methods: number;
  /** Nodes with at least one resolving corpus slug. */
  anchored: number;
  /** Capabilities nothing realises yet. */
  openCapabilities: number;
  /** Methods nobody has decomposed and which are not declared atomic. */
  undecomposedMethods: number;
  /** Methods carrying at least one citation. */
  cited: number;
  /** Distinct corpus slugs referenced anywhere in the graph. */
  distinctEntries: number;
}

export function layerCensus(graph: LayerGraph, corpus: ReadonlySet<string>): LayerCensus {
  const capabilities = graph.nodes.filter(isCapability);
  const methods = graph.nodes.filter(isMethod);
  const referenced = new Set<string>();
  for (const node of graph.nodes) {
    for (const slug of entriesFor(node, corpus)) referenced.add(slug);
  }
  return {
    nodes: graph.nodes.length,
    capabilities: capabilities.length,
    methods: methods.length,
    anchored: graph.nodes.filter((node) => entriesFor(node, corpus).length > 0).length,
    openCapabilities: capabilities.filter((node) => capabilityOutlook(graph, node.id) === "open")
      .length,
    undecomposedMethods: methods.filter((node) => stepsOutlook(node) === "undecomposed").length,
    cited: methods.filter((node) => (node.citations ?? []).length > 0).length,
    distinctEntries: referenced.size,
  };
}

/**
 * The reserved static segments under `/repository/`.
 *
 * `app/repository/layers/` shadows `app/repository/[slug]/` for exactly these
 * paths, so a corpus record whose slug is one of them becomes unreachable — a
 * 200 showing the wrong page, which is the failure mode nothing notices.
 * `validateLayerGraph` is given the corpus and checks it.
 */
export const RESERVED_REPOSITORY_SEGMENTS: readonly string[] = ["layers"];

/**
 * Everything that must be true of the authored graph, in one place.
 *
 * Called from two callers and written once: `scripts/check-layer-graph.mjs`
 * (in the `lint` chain, so a malformed graph fails the required `ts` check) and
 * `lib/repository-layers.test.ts` (which runs it against the real graph). A
 * second implementation of these rules is a second thing to keep in step, and
 * this repository has paid for that twice.
 *
 * Returns the errors rather than throwing: the callers want all of them at once.
 */
export function validateLayerGraph(graph: LayerGraph, corpus: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const byId = new Map<string, LayerNode>();

  for (const node of graph.nodes) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id)) {
      errors.push(`node id is not kebab-case: ${JSON.stringify(node.id)}`);
    }
    if (byId.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    byId.set(node.id, node);

    // Both locales on every reader-facing string. `render ja before calling a
    // UI change verified` is a standing rule; a missing Ja field is the version
    // of that failure a screenshot cannot catch because the page falls back to
    // English and looks fine.
    const contract = isCapability(node) ? node.contract : node.contract;
    for (const [field, value] of [
      ["label", node.label],
      ["labelJa", node.labelJa],
      ["summary", node.summary],
      ["summaryJa", node.summaryJa],
      ...(contract
        ? ([
            ["contract.takes", contract.takes],
            ["contract.takesJa", contract.takesJa],
            ["contract.returns", contract.returns],
            ["contract.returnsJa", contract.returnsJa],
          ] as const)
        : []),
    ] as const) {
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(`${node.id}: ${field} is empty`);
      }
    }

    for (const citation of node.citations ?? []) {
      if (!citation.title.trim()) errors.push(`${node.id}: a citation has no title`);
      if (!citation.url.startsWith("https://")) {
        errors.push(`${node.id}: citation url is not https — ${citation.url}`);
      }
      if (!/^\d{4}$/.test(citation.year)) {
        errors.push(`${node.id}: citation year is not a four-digit year — ${citation.year}`);
      }
    }

    for (const slug of node.entries ?? []) {
      if (!corpus.has(slug)) {
        errors.push(`${node.id}: entries names a slug the corpus does not carry — ${slug}`);
      }
    }

    if (isCapability(node)) {
      if (!node.whyALayer.trim() || !node.whyALayerJa.trim()) {
        errors.push(`${node.id}: a capability must say why it is a layer, in both locales`);
      }
      if (RESERVED_REPOSITORY_SEGMENTS.includes(node.id)) {
        errors.push(`${node.id}: id collides with a reserved /repository/ route segment`);
      }
      continue;
    }

    // --- methods ---------------------------------------------------------
    if (node.citations === undefined || node.citations.length === 0) {
      errors.push(`${node.id}: a method must carry at least one citation`);
    }
    // Absent means "no source we read stated one". An empty string is the
    // ambiguous middle and there is no reading of it that is honest.
    for (const [field, value] of [
      ["conditions", node.conditions],
      ["conditionsJa", node.conditionsJa],
      ["cost", node.cost],
      ["costJa", node.costJa],
      ["contested", node.contested],
      ["contestedJa", node.contestedJa],
    ] as const) {
      if (value !== undefined && value.trim() === "") {
        errors.push(`${node.id}: ${field} is present but empty — omit it instead`);
      }
    }
    // A pair, or neither. One locale alone renders as a hole for half the readers.
    for (const [en, ja, name] of [
      [node.conditions, node.conditionsJa, "conditions"],
      [node.cost, node.costJa, "cost"],
      [node.contested, node.contestedJa, "contested"],
    ] as const) {
      if ((en === undefined) !== (ja === undefined)) {
        errors.push(`${node.id}: ${name} is present in one locale only`);
      }
    }
    if (node.atomic && node.steps.length > 0) {
      errors.push(`${node.id}: atomic is set beside a non-empty steps list`);
    }
  }

  // --- edges, once every id is known ---------------------------------------
  for (const node of graph.nodes) {
    if (!isMethod(node)) continue;
    const realized = byId.get(node.realizes);
    if (!realized) {
      errors.push(`${node.id}: realizes an unknown id — ${node.realizes}`);
    } else if (!isCapability(realized)) {
      errors.push(`${node.id}: realizes ${node.realizes}, which is a method, not a capability`);
    }
    for (const step of node.steps) {
      const target = byId.get(step);
      if (!target) errors.push(`${node.id}: steps names an unknown id — ${step}`);
      else if (!isCapability(target)) {
        errors.push(`${node.id}: steps names ${step}, which is a method — steps are capabilities`);
      }
    }
    if (new Set(node.steps).size !== node.steps.length) {
      errors.push(`${node.id}: steps repeats an id`);
    }
    if (node.steps.includes(node.realizes)) {
      errors.push(`${node.id}: lists the capability it realises as one of its own steps`);
    }
    for (const skipped of node.bypasses ?? []) {
      const target = byId.get(skipped);
      if (!target) errors.push(`${node.id}: bypasses names an unknown id — ${skipped}`);
      else if (!isCapability(target)) {
        errors.push(`${node.id}: bypasses names ${skipped}, which is a method`);
      }
      if (node.steps.includes(skipped)) {
        errors.push(`${node.id}: both needs and bypasses ${skipped}`);
      }
    }
    if (node.refines !== undefined) {
      const parent = byId.get(node.refines);
      if (!parent) errors.push(`${node.id}: refines an unknown id — ${node.refines}`);
      else if (!isMethod(parent)) {
        errors.push(`${node.id}: refines ${node.refines}, which is a capability`);
      } else if (parent.realizes !== node.realizes) {
        errors.push(
          `${node.id}: refines ${node.refines}, which fills a different slot — a narrower version of a method must realise the same capability`,
        );
      }
      if (node.refines === node.id) errors.push(`${node.id}: refines itself`);
    }
  }

  // A `refines` chain that loops has no top, and every reader-facing sentence
  // about "a variant of X" would recurse.
  for (const node of graph.nodes) {
    if (!isMethod(node) || node.refines === undefined) continue;
    const seen = new Set<string>([node.id]);
    let cursor: LayerNode | undefined = byId.get(node.refines);
    while (cursor && isMethod(cursor) && cursor.refines !== undefined) {
      if (seen.has(cursor.id)) {
        errors.push(`${node.id}: refines chain contains a cycle`);
        break;
      }
      seen.add(cursor.id);
      cursor = byId.get(cursor.refines);
    }
  }

  // The containment graph must be acyclic or `layerDepths` has no answer and a
  // reader descending "into" a step could arrive back where they started.
  const colour = new Map<string, 0 | 1 | 2>();
  const walk = (id: string): boolean => {
    const state = colour.get(id);
    if (state === 1) return false;
    if (state === 2) return true;
    colour.set(id, 1);
    const node = byId.get(id);
    if (node && isCapability(node)) {
      for (const method of methodsRealizing(graph, id)) {
        for (const step of method.steps) {
          if (!walk(step)) return false;
        }
      }
    }
    colour.set(id, 2);
    return true;
  };
  for (const node of graph.nodes) {
    if (isCapability(node) && !walk(node.id)) {
      errors.push(`the steps graph contains a cycle reachable from ${node.id}`);
      break;
    }
  }

  if (graph.nodes.length === 0) errors.push("the layer graph is empty");
  if (rootCapabilities(graph).length === 0 && graph.nodes.length > 0) {
    errors.push("no root capability — every slot is a step inside another, so nothing starts a reading");
  }

  return errors;
}

/**
 * The corpus projection this module needs, and nothing else.
 *
 * Narrow on purpose: the graph reads a slug and a title, so a change to any
 * other field on a record cannot move a layer. `category` rides along only so a
 * cross-link can say what kind of thing it is pointing at.
 */
export interface LayerCorpusEntry {
  slug: string;
  title: string;
  titleJa: string;
  category: PublicRepositoryCategory;
}

/** Every node a given corpus record appears on — the inverse of `entries`. */
export function nodesForEntry(graph: LayerGraph, slug: string): LayerNode[] {
  return graph.nodes.filter((node) => (node.entries ?? []).includes(slug));
}
