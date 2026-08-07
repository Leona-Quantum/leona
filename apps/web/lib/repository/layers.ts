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
import { stateSatisfies, validateStateVocabulary, type StateVocabulary } from "./states.ts";
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
  /**
   * The state this consumes and the state it produces — the two ends of the
   * process line.
   *
   * Added session 92. The prose below is unchanged and is still the contract a
   * reader reads; these two ids are the part a machine can check. They name the
   * **object being transformed**, never the parameters riding with it: a
   * discretisation takes a generator *and* an interval *and* a tolerance, and
   * only the generator is a state. See `states.ts` for why the prose could not
   * do this job on its own.
   */
  from: string;
  to: string;
  /**
   * Everything crossing the boundary, in full, for a reader.
   *
   * Still the authority on what a slot needs — `from` is the object, and this is
   * the object *plus* every oracle, bound and tolerance that comes with it.
   * Nothing derives one from the other and nothing may quietly drop this in
   * favour of the two ids.
   */
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
   * Step id → the state this route is actually holding after that step, when it
   * is narrower than what the step's own slot promises.
   *
   * It exists because some routes only work because of *which* method fills a
   * step. The Koopman-von Neumann route lifts into a **Hermitian** generator,
   * and only a Hermitian one can be handed straight to a simulator; the slot it
   * descends into promises a linear generator and no more. Without this the
   * route reads as having a gap it does not have.
   *
   * Narrowing only. `routeOf` ignores an entry that is not a kind of what the
   * step declares and `validateLayerGraph` rejects it, so this cannot be used to
   * wish a missing conversion away.
   */
  through?: Readonly<Record<string, string>>;
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
 * The processes that touch a state, split by which end they touch it at.
 *
 * Only a node's **own** contract counts. A method that inherits its slot's
 * contract is the same process drawn at a finer grain, and listing both would
 * tell a reader that two different things arrive here when one does. A method
 * that narrows the contract itself *is* a second claim, and does appear.
 *
 * `narrowedInto` is the third way to arrive and the one a contract cannot say:
 * a route may record that a step lands somewhere narrower than the slot
 * promises — `kvn-simulation-route` reaches a Hermitian generator through a slot
 * that only promises a linear one. That is an arrival, and `unreachedStates`
 * counts it as one, so this list has to as well.
 */
export interface StateTraffic {
  /** Processes whose own contract returns this state. */
  arriving: LayerNode[];
  /** Processes whose own contract takes this state. */
  leaving: LayerNode[];
  /** Methods that record a step landing on this state by narrowing it. */
  narrowedInto: LayerMethod[];
  /**
   * Processes that ask for something broader and therefore accept this.
   *
   * Without this, `hermitian-generator` reads "nothing leaves from here" while
   * its own summary says a simulator can run it as it stands — because the
   * simulator's contract asks for a Hamiltonian, and being one is exactly what
   * `specializes` records. Narrowing composes in one direction, so this is the
   * direction it composes in, listed rather than left for a reader to infer.
   */
  acceptedBy: LayerNode[];
}

export function stateTraffic(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  stateId: string,
): StateTraffic {
  const own = (node: LayerNode): LayerContract | null =>
    isCapability(node) ? node.contract : (node.contract ?? null);
  return {
    arriving: graph.nodes.filter((node) => own(node)?.to === stateId),
    leaving: graph.nodes.filter((node) => own(node)?.from === stateId),
    narrowedInto: graph.nodes.filter(
      (node): node is LayerMethod =>
        isMethod(node) && Object.values(node.through ?? {}).includes(stateId),
    ),
    acceptedBy: graph.nodes.filter((node) => {
      const from = own(node)?.from;
      return from !== undefined && from !== stateId && stateSatisfies(vocabulary, stateId, from);
    }),
  };
}

/** One hop on a route: the process that carries it from one state to the next. */
export interface RouteSegment {
  /** The slot filling this hop, or `null` when the method does this part itself. */
  capabilityId: string | null;
  /** Set when `capabilityId` is null — the method is the process here. */
  methodId?: string;
  /** True when the state after this hop came from `through`, not the slot's contract. */
  narrowed: boolean;
}

/**
 * How much of a route is delegated to slots somebody else could fill.
 *
 * This is the ladder's own coverage measure and it is the useful one: a route
 * built entirely of named slots can be recombined, and a route that is one
 * undivided act cannot. Neither is a defect — `product-formula-simulation` is
 * genuinely one act — but they are different claims and a reader deciding what
 * to reuse needs to see which they are looking at.
 */
export type RouteCoverage = "delegated" | "partly-own" | "all-own";

/**
 * A method as a path: states with processes between them.
 *
 * `segments` is always one shorter than `states`. Every route is complete — it
 * starts at its slot's `from` and ends at its slot's `to`, because that is what
 * realising a slot means — so nothing here is ever a dangling end.
 */
export interface Route {
  /** Every state the route holds in turn, entry first, exit last. */
  states: readonly string[];
  segments: readonly RouteSegment[];
  /**
   * Steps that supply an ingredient rather than moving the route along.
   *
   * `qsvt-matrix-inversion` needs a prepared |b⟩, and preparing it does not
   * change what the route is carrying — the block-encoding is still the object
   * in hand. Drawn hanging off the process that consumes it, never as a stage.
   */
  feeds: readonly string[];
  coverage: RouteCoverage;
}

export function routeCoverage(route: Route): RouteCoverage {
  return route.coverage;
}

/**
 * The path a method takes through the state vocabulary.
 *
 * ## Two things `steps` is not, and both were found by drawing it
 *
 * `steps` was authored — correctly, for what it was for — as **the capabilities
 * this route needs**, and reading it as a path gets two things wrong.
 *
 * 1. **It is not ordered as a path.** Measured 2026-08-08, `qsvt-matrix-inversion`
 *    lists a block-encoding, a state preparation, a matrix function and an
 *    amplification, and only two of those four move the object along; the state
 *    preparation is an ingredient a later step consumes. So this walks the list
 *    greedily: a step whose input is satisfied by what the route already holds
 *    **advances** it, and one whose input is not is a **feed**. Derived rather
 *    than authored beside `steps` on purpose — two hand-maintained lists of the
 *    same steps drift, and the second is silent when it is wrong.
 *
 * 2. **It is not the whole method.** `steps` is what a route *delegates*; the
 *    method also does its own work, and that work was never a step because it
 *    has no other filler. `direct-sampling-readout` delegates the preparation
 *    and then *samples*, which is the entire method. So when the delegated steps
 *    do not reach the slot's output, the last hop is the method itself — a real
 *    process with a page, not a hole. Twenty-three of the twenty-nine decomposed
 *    routes are in that shape, which is why the first draft of this function
 *    reported twenty-three gaps that were never there.
 *
 * Total on any input, deliberately — it is reached from a route handler, and an
 * unresolvable id yields a feed rather than a throw.
 */
export function routeOf(graph: LayerGraph, vocabulary: StateVocabulary, method: LayerMethod): Route {
  const slot = contractFor(graph, method)?.contract ?? null;
  const entry = slot?.from ?? "";
  const exit = slot?.to ?? "";

  const states: string[] = [entry];
  const segments: RouteSegment[] = [];
  const feeds: string[] = [];
  let holding = entry;

  for (const id of method.steps) {
    const node = layerNode(graph, id);
    const contract = node && isCapability(node) ? node.contract : null;
    if (contract === null || !stateSatisfies(vocabulary, holding, contract.from)) {
      feeds.push(id);
      continue;
    }
    const narrowed = method.through?.[id];
    const useNarrowed = narrowed !== undefined && stateSatisfies(vocabulary, narrowed, contract.to);
    holding = useNarrowed ? narrowed : contract.to;
    segments.push({ capabilityId: id, narrowed: useNarrowed });
    states.push(holding);
  }

  // What the method does itself. Present whenever the delegated steps have not
  // arrived at the slot's output — which, on the authored graph, is most routes.
  if (!stateSatisfies(vocabulary, holding, exit)) {
    segments.push({ capabilityId: null, methodId: method.id, narrowed: false });
    states.push(exit);
  }

  const delegated = segments.filter((segment) => segment.capabilityId !== null).length;
  const coverage: RouteCoverage =
    delegated === 0 ? "all-own" : delegated === segments.length ? "delegated" : "partly-own";
  return { states, segments, feeds, coverage };
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
  /**
   * Declared slugs the corpus in hand does not carry.
   *
   * **Zero at build time and not guaranteed at read time**, which is the whole
   * reason it is counted. `check-layer-graph.mjs` proves every slug resolves
   * against the corpus in the repo; the page is served against whatever
   * `getRepositoryListEntries()` returns, which is the catalog API in
   * production and falls back to the static corpus without failing. A short or
   * mid-import corpus would silently drop cross-links and quietly lower
   * `anchored` — and the sentence built on it asks a visitor to believe a
   * number about our own coverage. Counting the shortfall turns that into a
   * statement the page can make out loud.
   */
  unresolvedEntries: number;
  /** Capabilities nothing realises yet. */
  openCapabilities: number;
  /** Methods nobody has decomposed and which are not declared atomic. */
  undecomposedMethods: number;
  /** Methods carrying at least one citation. */
  cited: number;
  /** Distinct corpus slugs referenced anywhere in the graph. */
  distinctEntries: number;
  /** States in the vocabulary. */
  states: number;
  /**
   * Routes built entirely of named slots, with no stretch the method does alone.
   *
   * Counted beside the other two rather than printed alone, because the three
   * together are the honest statement about how recombinable the ladder is.
   */
  routesDelegated: number;
  /** Routes where the method closes the last stretch itself. */
  routesPartlyOwn: number;
  /** Routes that are one undivided act — every step is an ingredient. */
  routesAllOwn: number;
  /** Steps that supply an ingredient rather than advancing the route. */
  feedSteps: number;
  /** States nothing produces — a route can start here but never arrive. */
  unreachedStates: number;
}

export function layerCensus(
  graph: LayerGraph,
  corpus: ReadonlySet<string>,
  vocabulary: StateVocabulary,
): LayerCensus {
  const capabilities = graph.nodes.filter(isCapability);
  const methods = graph.nodes.filter(isMethod);
  // Leaves are excluded: a method with no steps spans its slot by assertion, so
  // counting it as a route that "closes" would inflate the number with routes
  // nobody has taken apart. `stepsOutlook` is where that distinction lives.
  const decomposed = methods
    .filter((method) => method.steps.length > 0)
    .map((method) => routeOf(graph, vocabulary, method));
  // Every state some slot produces. A state nothing produces is either an entry
  // point a reader arrives with — a nonlinear problem, a matrix, a machine — or
  // an object the graph mentions and no recorded process ever reaches.
  const produced = new Set<string>();
  for (const node of capabilities) produced.add(node.contract.to);
  for (const method of methods) if (method.contract) produced.add(method.contract.to);
  // A `through` narrowing is an arrival too. `kvn-simulation-route` records that
  // its embedding step lands on a *Hermitian* generator, and no contract in the
  // graph says `to: "hermitian-generator"` — the state exists precisely because
  // one route reaches a narrower object than the slot promises. Reading only
  // contracts would report it as a place no route ever arrives at, which is the
  // opposite of what the route says.
  for (const method of methods) {
    for (const narrowed of Object.values(method.through ?? {})) produced.add(narrowed);
  }
  const referenced = new Set<string>();
  let unresolved = 0;
  for (const node of graph.nodes) {
    for (const slug of entriesFor(node, corpus)) referenced.add(slug);
    unresolved += (node.entries ?? []).filter((slug) => !corpus.has(slug)).length;
  }
  return {
    nodes: graph.nodes.length,
    capabilities: capabilities.length,
    methods: methods.length,
    anchored: graph.nodes.filter((node) => entriesFor(node, corpus).length > 0).length,
    unresolvedEntries: unresolved,
    openCapabilities: capabilities.filter((node) => capabilityOutlook(graph, node.id) === "open")
      .length,
    undecomposedMethods: methods.filter((node) => stepsOutlook(node) === "undecomposed").length,
    cited: methods.filter((node) => (node.citations ?? []).length > 0).length,
    distinctEntries: referenced.size,
    states: vocabulary.states.length,
    routesDelegated: decomposed.filter((route) => route.coverage === "delegated").length,
    routesPartlyOwn: decomposed.filter((route) => route.coverage === "partly-own").length,
    routesAllOwn: decomposed.filter((route) => route.coverage === "all-own").length,
    feedSteps: decomposed.reduce((total, route) => total + route.feeds.length, 0),
    unreachedStates: vocabulary.states.filter((state) => !produced.has(state.id)).length,
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
 * The contract of a step id, for validation, without assuming it resolves.
 *
 * Local to the validator: `routeOf` does the same lookup against the graph, and
 * this one works off the id map the validator has already built so a malformed
 * graph does not have to be indexed twice.
 */
function stepContractOf(
  byId: ReadonlyMap<string, LayerNode>,
  id: string | undefined,
): LayerContract | null {
  if (id === undefined) return null;
  const node = byId.get(id);
  return node && isCapability(node) ? node.contract : null;
}

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
export function validateLayerGraph(
  graph: LayerGraph,
  corpus: ReadonlySet<string>,
  vocabulary: StateVocabulary,
): string[] {
  const errors: string[] = [...validateStateVocabulary(vocabulary)];
  const byId = new Map<string, LayerNode>();
  const stateIds = new Set(vocabulary.states.map((state) => state.id));

  // States and nodes share the `/repository/layers/<id>` namespace, on purpose:
  // one address per thing a reader can name. That only works while the two id
  // sets are disjoint, and a collision is a 200 showing the wrong page — the
  // failure mode nothing notices. Same argument as `RESERVED_REPOSITORY_SEGMENTS`.
  for (const node of graph.nodes) {
    if (stateIds.has(node.id)) {
      errors.push(`${node.id}: a node id and a state id are the same — they share one route`);
    }
  }
  for (const id of stateIds) {
    if (RESERVED_REPOSITORY_SEGMENTS.includes(id)) {
      errors.push(`${id}: state id collides with a reserved /repository/ route segment`);
    }
  }

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
    const contract = node.contract;
    // A process connects two states, and both ends have to be states this
    // vocabulary carries. An unresolvable end is worse than a blank: `routeOf`
    // is total, so it would quietly satisfy nothing and every route through this
    // slot would report a gap it does not have.
    if (contract) {
      for (const [end, id] of [
        ["from", contract.from],
        ["to", contract.to],
      ] as const) {
        if (typeof id !== "string" || id.trim() === "") {
          errors.push(`${node.id}: contract.${end} is empty`);
        } else if (!stateIds.has(id)) {
          errors.push(`${node.id}: contract.${end} names an unknown state — ${id}`);
        }
      }
      if (contract.from && contract.from === contract.to) {
        errors.push(
          `${node.id}: contract.from and contract.to are the same state — a process that changes nothing is not a layer`,
        );
      }
    }
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

    // The same paper listed twice on one node. Zero today, and worth failing
    // rather than de-duplicating on render: `Citations` keys on the url, so a
    // repeat is a React duplicate key as well as a reader seeing one source
    // twice.
    const urlsHere = (node.citations ?? []).map((citation) => citation.url);
    if (new Set(urlsHere).size !== urlsHere.length) {
      errors.push(`${node.id}: the same citation url is listed twice`);
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
    // `through` narrows a junction. It is checked here rather than trusted,
    // because the whole value of the composition check is that it cannot be
    // silenced: a `through` state that is not a kind of what the step declares
    // is a different claim wearing the word "narrower", and it would erase a
    // real gap.
    if (node.through !== undefined) {
      const entries = Object.entries(node.through);
      if (entries.length === 0) {
        errors.push(`${node.id}: through narrows nothing — omit it instead`);
      }
      for (const [stepId, narrowed] of entries) {
        if (!node.steps.includes(stepId)) {
          errors.push(`${node.id}: through names ${stepId}, which is not one of its steps`);
          continue;
        }
        if (!stateIds.has(narrowed)) {
          errors.push(`${node.id}: through[${stepId}] names an unknown state — ${narrowed}`);
          continue;
        }
        const declared = stepContractOf(byId, stepId)?.to;
        if (declared !== undefined && !stateSatisfies(vocabulary, narrowed, declared)) {
          errors.push(
            `${node.id}: through[${stepId}] is ${narrowed}, which is not a kind of ${declared} — a step may only be narrowed, never replaced`,
          );
        }
        if (declared === narrowed) {
          errors.push(`${node.id}: through[${stepId}] repeats what ${stepId} already returns`);
        }
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

  // One paper, one set of metadata.
  //
  // A citation is repeated across nodes by design — GSLW is cited by four of
  // them — and repetition is where a fact drifts. The first pass shipped
  // arXiv:1806.01838 as both 2018 and 2019 and as both "Gilyén" and "Gilyen",
  // so a reader comparing two method pages saw one paper presented as two, and
  // the four-digit-year check was happy with both. The rule that holds is the
  // one the URL already implies: same paper, same title, same authors, same
  // year, everywhere.
  const citationByUrl = new Map<string, { node: string; title: string; authors: string; year: string }>();
  for (const node of graph.nodes) {
    for (const citation of node.citations ?? []) {
      const seen = citationByUrl.get(citation.url);
      if (!seen) {
        citationByUrl.set(citation.url, {
          node: node.id,
          title: citation.title,
          authors: citation.authors,
          year: citation.year,
        });
        continue;
      }
      for (const [field, here, there] of [
        ["title", citation.title, seen.title],
        ["authors", citation.authors, seen.authors],
        ["year", citation.year, seen.year],
      ] as const) {
        if (here !== there) {
          errors.push(
            `${node.id}: ${citation.url} has ${field} ${JSON.stringify(here)} here and ${JSON.stringify(there)} on ${seen.node} — one paper, one set of metadata`,
          );
        }
      }
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
