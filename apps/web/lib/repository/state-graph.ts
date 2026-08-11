// The state graph: the map as a graph of states, so a path can be *found*
// rather than enumerated by hand.
//
// > *"the whole reason I wanted to make this map in terms of processes and
// > states is because we can find new connections not limited to literature. For
// > example, several paths lead to the 'linear ODE system' state, so they should
// > all converge to that one state node, and then the options to lead out of it
// > should flow out of the state node. Yes, we are tracking which papers took
// > which paths, but we are not limiting the paths to it! For example, i myself
// > am doing research on carleman linearization+schrodingerization — this is not
// > a path in the map right now, but it would have been easy to see it as a
// > POSSIBLE path when broken down into this state-process representation!"*
// > — owner, session-96 inbox
//
// ## The measurement this module exists to answer
//
// Counted 2026-08-08, before any of it was written:
//
// | | |
// |---|---|
// | slots carrying a `from`/`to` contract | 18 of 18 |
// | **methods** carrying their own contract | **0 of 58** |
// | authored routes under `nonlinear-ode-solve` | **4** |
// | distinct slot-paths the state graph already admits there | **4 raw, 2 distinct** |
// | concrete method-chains those expand to | **108** |
//
// The last two rows read **6** and **435** until session 97. Neither reproduced
// against this module and no test pinned either — measured twice by different
// routes, `statePathsBetween` returns 4 raw paths which dedupe to 2 distinct
// slot-sequences, because the Koopman-von Neumann narrowing carries the same
// `slot` id as the contract edge and so enumerates one journey twice. The
// figures above are asserted in `repository-converge-layout.test.ts` now. The
// argument is unchanged: the map drew authored routes and never walked the
// graph they are paths through.
//
// The map drew the four. It could not draw the rest, because it enumerated
// **authored route nodes** and never walked the graph those routes are paths
// through. The owner's own example was checked directly and it composes today:
// `carleman-linearization` lands on `linear-ivp`, `schrodingerisation` departs
// from `linear-ivp`, and `stateSatisfies` returns true. Nobody has published
// that pair; the graph has always permitted it; nothing could draw it.
//
// ## Why a dominator chain is the "next largest denominator"
//
// The owner's expansion rule is *"clicking on a process line should expand it to
// the next largest denominator of states"*. Read literally, the largest
// denominator common to every way of crossing a slot is the set of states that
// **every** path through it must pass — the dominators. Between two consecutive
// dominators the alternatives fan out and rejoin, which is a lens sharing both
// endpoints, and a lens is crossing-free by construction. So the same reading
// that gives the owner the picture also gives the geometry its guarantee.
//
// Run on the authored graph, `nonlinear-ode-solve` has exactly one interior
// dominator and it is **`linear-ivp`** — the state the owner named. That is not
// a coincidence to celebrate; it is the check that this reading is the right
// one, and it is asserted in the test file rather than trusted here.
//
// ## The three things this module must never do
//
// 1. **Never treat the slot being expanded as one of its own crossings.** Its
//    own coarse edge A → B is a one-hop path on which no finer state appears, so
//    including it empties the dominator set for every slot in the graph. That is
//    not hypothetical — it is what the first run of the prototype printed.
// 2. **Never claim a path is published.** A path the graph admits is a fact
//    about the contracts; a *paper* having walked it is a different claim with a
//    different source. `PathWitness` keeps them apart, and D89.6 applies: the
//    absence of a witness is rendered as an absence, never as a hedge.
// 3. **Never let enumeration be unbounded.** This is reached from a route
//    handler. Every walk is capped, and a cap that bites is reported in the
//    result rather than silently truncating — a quietly-shortened path list
//    reads exactly like a graph with fewer ways through it.
import {
  isCapability,
  isMethod,
  layerNode,
  methodFanGroups,
  methodsRealizing,
  routeOf,
  type LayerCapability,
  type LayerGraph,
  type LayerMethod,
} from "./layers.ts";
import { stateSatisfies, type StateVocabulary } from "./states.ts";

/**
 * One move between two states.
 *
 * `slot` is the capability whose contract this edge is. `narrowedBy` is set on
 * the second kind of edge: a route may record, through `through`, that a
 * particular filler lands somewhere **narrower** than the slot promises — the
 * Koopman-von Neumann lift reaches a Hermitian generator through a slot that
 * only promises a linear one. That is a real arrival and a real departure point,
 * and a walk that ignores it cannot leave `hermitian-generator` at all, which is
 * how the simulation continuation goes missing.
 *
 * A narrowing's `from` is **the state its witnessing route held entering the
 * hop**, not the slot's declared entry. The two coincided on every narrowing
 * until session 120, so the distinction cost nothing to ignore; the KvN
 * simulation narrowing (`hamiltonian-simulation` → `runnable-evolution`) is the
 * first whose slot admits several entry states on one figure, and with the
 * declared entry the walk composed it after `hamiltonian-recasting` — drawing
 * recast-then-estimate ways across that no source records (a surrogate needs
 * its recovery map before any readout). The edge is exactly as strong as its
 * witness, so its entry is the witness's entry.
 */
export interface StateEdge {
  /** Stable per edge. `slot` for a contract edge, `slot@method` for a narrowing. */
  key: string;
  slot: string;
  from: string;
  to: string;
  /** The method whose `through` produced this edge, when it is a narrowing. */
  narrowedBy?: string;
}

/** Every move the authored graph permits, contract edges first. */
export function stateEdges(graph: LayerGraph, vocabulary: StateVocabulary): StateEdge[] {
  const edges: StateEdge[] = [];
  for (const node of graph.nodes) {
    if (!isCapability(node)) continue;
    edges.push({
      key: node.id,
      slot: node.id,
      from: node.contract.from,
      to: node.contract.to,
    });
  }
  for (const node of graph.nodes) {
    if (!isMethod(node)) continue;
    const narrowings = Object.entries(node.through ?? {});
    if (narrowings.length === 0) continue;
    // The witnessing route, once per method: `routeOf` is the one place that
    // knows what the route is holding entering each hop, and duplicating that
    // walk here would be the tally-in-five-places defect.
    const route = routeOf(graph, vocabulary, node);
    for (const [stepId, landing] of narrowings) {
      const step = layerNode(graph, stepId);
      if (!step || !isCapability(step)) continue;
      // A step the route files as a feed witnesses no edge at all — the same
      // invariant `repository-state-graph.test.ts` asserts from the other side.
      const index = route.segments.findIndex((segment) => segment.capabilityId === stepId);
      if (index === -1) continue;
      const filler = node.via?.[stepId] ?? node.id;
      const key = `${stepId}@${filler}`;
      if (edges.some((edge) => edge.key === key)) continue;
      // `states[index]` is what the route holds entering `segments[index]`.
      edges.push({ key, slot: stepId, from: route.states[index]!, to: landing, narrowedBy: filler });
    }
  }
  return edges;
}

/** A way across, as the states it holds in turn and the edges it takes. */
export interface StatePath {
  /** Entry first, exit last. Always one longer than `edges`. */
  states: readonly string[];
  edges: readonly StateEdge[];
}

export interface PathSearch {
  paths: readonly StatePath[];
  /** True when a cap stopped the walk, so `paths` is a floor and not the count. */
  truncated: boolean;
}

/** How far and how wide a walk may go before it is a denial-of-service. */
export const PATH_LIMITS = { maxPaths: 400, maxHops: 8 } as const;

/**
 * Every simple path from `from` to a state satisfying `to`.
 *
 * Simple in the edges *and* in the states: an edge is used at most once and a
 * state is visited at most once, which is what makes the walk terminate on a
 * graph that has cycles between abstraction levels (a coarse slot spans states a
 * finer chain also spans, so "go coarse then come back finer" is a real cycle in
 * the edge relation and it is not a defect).
 *
 * `exclude` drops one slot and every narrowing of it — see rule 1 in the header.
 */
export function statePathsBetween(
  edges: readonly StateEdge[],
  vocabulary: StateVocabulary,
  from: string,
  to: string,
  exclude?: string,
): PathSearch {
  const paths: StatePath[] = [];
  let truncated = false;

  const usable = edges.filter((edge) => edge.slot !== exclude);

  const walk = (here: string, states: string[], taken: StateEdge[]) => {
    if (paths.length >= PATH_LIMITS.maxPaths) {
      truncated = true;
      return;
    }
    if (taken.length > 0 && stateSatisfies(vocabulary, here, to)) {
      paths.push({ states: [...states], edges: [...taken] });
      return;
    }
    if (taken.length >= PATH_LIMITS.maxHops) {
      truncated = true;
      return;
    }
    for (const edge of usable) {
      if (taken.some((prior) => prior.key === edge.key)) continue;
      if (!stateSatisfies(vocabulary, here, edge.from)) continue;
      if (states.includes(edge.to)) continue;
      walk(edge.to, [...states, edge.to], [...taken, edge]);
    }
  };

  walk(from, [from], []);
  return { paths, truncated };
}

/**
 * The states every path must pass through, in the order they are met.
 *
 * A state counts as met on a path when **some** state on that path satisfies it,
 * so `hermitian-generator` witnesses `linear-ivp` and the Koopman-von Neumann
 * route does not knock `linear-ivp` out of the chain by taking a narrower
 * landing. That asymmetry is `stateSatisfies`'s whole job and it is load-bearing
 * here: without it the owner's convergence state disappears from the one slot
 * they named it on.
 *
 * Ordered by the first path, then checked: dominators of a DAG appear in the
 * same order on every path, and a set that does not is reported as unordered
 * rather than drawn in an order that is a lie.
 */
export function denominatorChain(
  search: PathSearch,
  vocabulary: StateVocabulary,
): { chain: readonly string[]; consistent: boolean } {
  const paths = search.paths;
  if (paths.length === 0) return { chain: [], consistent: true };

  const meets = (path: StatePath, id: string) =>
    path.states.some((held) => stateSatisfies(vocabulary, held, id));

  const chain = paths[0]!.states.filter((id) => paths.every((path) => meets(path, id)));

  // Order check: on every path, the index at which each chain member is first
  // met must increase along the chain.
  const firstIndex = (path: StatePath, id: string) =>
    path.states.findIndex((held) => stateSatisfies(vocabulary, held, id));
  const consistent = paths.every((path) => {
    const seen = chain.map((id) => firstIndex(path, id));
    return seen.every((value, index) => index === 0 || value > seen[index - 1]!);
  });

  return { chain, consistent };
}

/**
 * One way across a bundle: a sub-path between two consecutive denominators.
 *
 * A lane of one edge is a named slot and nothing more. A lane of several is the
 * owner's *"they should show their intermediate states and processes in a line
 * without branches"* — the interior is drawn, and it is drawn flat, because
 * opening it is the next click and not this one.
 */
export interface BundleLane {
  key: string;
  edges: readonly StateEdge[];
  /** States strictly between the bundle's two ends. Empty for a single-edge lane. */
  interior: readonly string[];
}

/**
 * Everything that crosses from one denominator to the next.
 *
 * Both ends are **one circle each**, shared by every lane. That is the whole
 * point — it is the owner's *"they should all converge to that one state node"*
 * — and it is also what lets the geometry keep its guarantee, because N arcs
 * between two common points cannot cross one another.
 */
export interface StateBundle {
  from: string;
  to: string;
  lanes: readonly BundleLane[];
}

export interface Expansion {
  /** The dominator chain, entry first, exit last. */
  chain: readonly string[];
  /** One per consecutive pair in `chain`. */
  bundles: readonly StateBundle[];
  /** No finer decomposition exists — expanding shows the slot's methods instead. */
  atomicAtThisLevel: boolean;
  truncated: boolean;
  chainConsistent: boolean;
}

/**
 * What a process line opens into: the next largest denominator of states.
 *
 * Returns `atomicAtThisLevel` when the graph records no finer way across —
 * `time-discretization` has no interior states, so opening it can only fan out
 * the four methods that fill it, which is what the surface does instead. The two
 * are genuinely different pictures and D90.6's rule applies: they never share a
 * shape.
 */
export function expansionOf(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  capability: LayerCapability,
): Expansion {
  const edges = stateEdges(graph, vocabulary);
  const { from, to } = capability.contract;
  const search = statePathsBetween(edges, vocabulary, from, to, capability.id);
  const { chain, consistent } = denominatorChain(search, vocabulary);

  // Endpoints are not interior. Compared by satisfaction, not by id: on
  // `linear-ode-solve` the only path ends at `solution-state`, which specializes
  // `solution-answer`, and comparing ids alone files the exit as an interior
  // state and draws a bundle that goes nowhere.
  const interiorOnly = chain.filter(
    (id) => id !== from && id !== to && !stateSatisfies(vocabulary, id, to),
  );
  const full = [from, ...interiorOnly, to];

  if (search.paths.length === 0 || interiorOnly.length === 0) {
    return {
      chain: full,
      bundles: [],
      atomicAtThisLevel: true,
      truncated: search.truncated,
      chainConsistent: consistent,
    };
  }

  const bundles: StateBundle[] = [];
  for (let index = 0; index + 1 < full.length; index += 1) {
    const start = full[index]!;
    const end = full[index + 1]!;
    const lanes: BundleLane[] = [];
    for (const path of search.paths) {
      const startAt = path.states.findIndex((held) => stateSatisfies(vocabulary, held, start));
      const endAt = path.states.findIndex((held) => stateSatisfies(vocabulary, held, end));
      if (startAt < 0 || endAt <= startAt) continue;
      const slice = path.edges.slice(startAt, endAt);
      if (slice.length === 0) continue;
      const key = slice.map((edge) => edge.key).join(">");
      if (lanes.some((lane) => lane.key === key)) continue;
      lanes.push({ key, edges: slice, interior: path.states.slice(startAt + 1, endAt) });
    }
    // **A narrowing is not a second way across.** A `through` edge exists so
    // the walk can leave from the narrower state a particular filler lands on
    // — and the multi-edge lanes that continue from there keep it. But as a
    // single-edge lane of this bundle it draws the same slot beside itself:
    // the plain lane's fan already contains the narrowing method, so the
    // reader sees the Koopman-von Neumann lift once as a lane and again
    // inside the lane next to it — the one repeat mechanism (of session
    // 118's four) that lives in the walk rather than the renderer. Exactly
    // one edge in today's corpus does this, and `crossingsAt` has deduped the
    // same pair by method since it was written.
    const deduped = lanes.filter((lane) => {
      if (lane.edges.length !== 1) return true;
      const edge = lane.edges[0]!;
      if (!edge.narrowedBy) return true;
      return !lanes.some(
        (other) => other !== lane && other.edges.length === 1 && other.edges[0]!.key === edge.slot,
      );
    });
    bundles.push({ from: start, to: end, lanes: deduped });
  }

  return {
    chain: full,
    bundles,
    atomicAtThisLevel: false,
    truncated: search.truncated,
    chainConsistent: consistent,
  };
}

/**
 * Whether the state chain a slot's expansion found is walked by EVERY method
 * that fills the slot — the claim a chain figure makes, checked against the
 * routes rather than assumed from the walk.
 *
 * `expansionOf` finds the dominators of the paths the EDGE graph admits, and
 * on most slots that is the whole story. It is not on `linear-ode-solve`: the
 * edge walk admits exactly one full path — discretise, then solve — because
 * the Hamiltonian branch's closing stretch is each method's own work and own
 * work is not an edge (see `walkedEdgeKeys`). So the figure drew
 * `linear-system` as a state every way across passes through, while three of
 * the slot's seven methods carry `bypasses: ["quantum-linear-solve",
 * "time-discretization"]` — the corpus itself recording that the claim is
 * false. A chain no recorded filler is allowed to skip is a chain; anything
 * less draws the fan, whose only claim is "here are the recorded ways".
 *
 * Satisfaction, not identity, on both sides — `solution-state` witnesses
 * `solution-answer`, a Hermitian generator witnesses `linear-ivp` — the same
 * asymmetry `denominatorChain` is built on.
 */
export function chainWalkedByEveryMethod(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  capability: LayerCapability,
  expansion: Expansion,
): boolean {
  const interior = expansion.chain.slice(1, -1);
  if (interior.length === 0) return true;
  return methodsRealizing(graph, capability.id).every((method) => {
    const route = routeOf(graph, vocabulary, method);
    return interior.every((state) =>
      route.states.some((held) => stateSatisfies(vocabulary, held, state)),
    );
  });
}

/**
 * Whether this slot's figure is the state chain at all.
 *
 * One writer for a decision two surfaces make: `layoutFigure` picks the
 * picture, and `convergingSlots` is the census of slots whose circles mean
 * "every way across passes through this". The two disagreeing is a legend
 * describing a drawing nothing draws.
 */
export function drawsAsStateChain(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  capability: LayerCapability,
  expansion: Expansion,
): boolean {
  if (expansion.atomicAtThisLevel || expansion.bundles.length === 0) return false;
  return chainWalkedByEveryMethod(graph, vocabulary, capability, expansion);
}

/** One way of filling a slot, drawn as its own line between the slot's two states. */
export interface MethodLane {
  key: string;
  method: LayerMethod;
  /**
   * Narrower versions of `method` from the same fan, nested under it (W13).
   *
   * A refinement is not another way across the slot — it is one of the ways,
   * re-analysed — so it is not a lane of its own. Drawn indented under its
   * parent inside a bracket, during the same expansion, which is what replaces
   * the `⊂ Koopman` suffix: adjacency plus the bracket say the relation
   * without repeating the parent's name.
   */
  variants: readonly LayerMethod[];
}

/**
 * The fan a slot opens into when it has no finer chain of states.
 *
 * Both ends are the slot's **own** contract states, so this is one bundle
 * between two circles, exactly like a state bundle — and for the same reason it
 * cannot cross itself.
 */
export interface MethodFan {
  from: string;
  to: string;
  lanes: readonly MethodLane[];
}

/**
 * What an atomic slot opens into: the methods that fill it.
 *
 * `expansionOf`'s own doc comment has said since session 92 that opening
 * `time-discretization` *"can only fan out the four methods that fill it, which
 * is what the surface does instead"*. **The surface did not do that.** Measured
 * on production 2026-08-08, `?view=converge&focus=observable-estimation` — the
 * address before converge became the only surface and `?view=` stopped being
 * read at all; the same figure is `?focus=observable-estimation` now — drew
 * nothing at all and printed *"Nothing recorded goes through this in more than
 * one way."* — and 16 of the 18 slots are atomic, so that was the whole page for
 * all but two of them. The comment described a feature nobody had written.
 *
 * This is deliberately **not** folded into `Expansion`. A chain of states and a
 * fan of methods are different claims — one says *every way across passes
 * through this object*, the other says *here are the recorded ways across* — and
 * D90.6's rule is that two different things never share a shape. The caller asks
 * for the second only after the first says there is none, and the diagram
 * records which it drew.
 *
 * Returns `null` for a slot nothing fills, rather than an empty fan: a shut slot
 * and an unfilled one are not the same picture either. Measured on the authored
 * graph, no slot is unfilled today — the range is 2 to 7 methods — so this is a
 * guard against a future edit, not a case the page renders.
 */
export function methodFanOf(
  graph: LayerGraph,
  capability: LayerCapability,
  unfold?: string,
): MethodFan | null {
  // Grouped, not flat (W13): a refinement rides inside its parent's lane
  // rather than taking one of its own. `methodFanGroups` is the one writer of
  // that grouping, and every reader of a fan — this function, `fanInside`, and
  // the subject match on a method's own page — goes through it, because three
  // readings of one grouping is how a method's own page and the map would come
  // to disagree about where the five refinement methods are drawn. `unfold`
  // rides through to it (s121, W17): a folded refinement draws no lane
  // anywhere except on its own page, whose planner names it here.
  const groups = methodFanGroups(graph, capability.id, unfold);
  if (groups.length === 0) return null;
  return {
    from: capability.contract.from,
    to: capability.contract.to,
    lanes: groups.map((group) => ({
      key: `m:${group.method.id}`,
      method: group.method,
      variants: group.variants,
    })),
  };
}

/**
 * Whether any recorded route walks this exact sequence of slots.
 *
 * The honest half of D96.3. A path the graph admits is a derivation from two
 * authored contracts; a paper having taken it is a claim with a source. This
 * answers only the second, and it answers it by looking for a method whose own
 * walk uses the same slots in the same order — never by inference, and never by
 * treating "we could not find one" as "there is none in the literature". The
 * surface says *no recorded source takes this path*, which is a statement about
 * this graph and is true.
 */
export function pathWitnesses(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  lane: BundleLane,
): LayerMethod[] {
  const wanted = lane.edges.map((edge) => edge.key);
  return graph.nodes.filter((node): node is LayerMethod => {
    if (!isMethod(node)) return false;
    const walked = walkedEdgeKeys(graph, vocabulary, node);
    return containsRun(walked, wanted);
  });
}

/**
 * The edge keys a method actually advances along, in order.
 *
 * Read off `routeOf` rather than off `steps`, and the difference is not
 * cosmetic. `hhl-qpe-inversion` lists `state-preparation` as a step, but
 * `routeOf` classifies it as a **feed** — an ingredient the method consumes, not
 * a hop it travels — so reading `steps` credits HHL with walking the
 * state-preparation edge, which it does not. (`backward-euler` was the example
 * here until session 118 removed the step it named; 22 step records are still
 * filed as feeds, and `a step that is a feed does not witness the edge it names`
 * now sweeps all of them rather than naming one.) The same read also picks up
 * `through`, so the Koopman-von Neumann lift witnesses its **narrowed** edge and
 * not the broader one every other embedding takes.
 *
 * Own-work segments have no slot and are deliberately absent: a method's own
 * work is not an edge anybody else can take.
 */
function walkedEdgeKeys(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  method: LayerMethod,
): string[] {
  const route = routeOf(graph, vocabulary, method);
  return route.segments.flatMap((segment) => {
    if (segment.capabilityId === null) return [];
    if (!segment.narrowed) return [segment.capabilityId];
    const filler = method.via?.[segment.capabilityId] ?? method.id;
    return [`${segment.capabilityId}@${filler}`];
  });
}

/** Is `wanted` a contiguous run inside `walked`? */
function containsRun(walked: readonly string[], wanted: readonly string[]): boolean {
  if (wanted.length === 0) return false;
  for (let start = 0; start + wanted.length <= walked.length; start += 1) {
    if (wanted.every((key, at) => walked[start + at] === key)) return true;
  }
  return false;
}

/**
 * One fully-chosen way across: an edge, and the method taken along it.
 *
 * `filler` is null where the reader has not chosen one — the slot itself is the
 * choice at that point, which is a real state of the surface and not a missing
 * value.
 */
export interface Crossing {
  edgeKey: string;
  filler: string | null;
}

/**
 * What the literature record says about one concrete combination.
 *
 * **Three-valued, and the middle is the whole reason.** A binary
 * published/unpublished flag reads as a claim the graph cannot support: only
 * five of the fifty-five step instances carry a `via` pin, so a route saying
 * *"embed, then solve the linear ODE"* names no particular solver and therefore
 * neither confirms nor denies Schrödingerisation on that hop. Collapsing that
 * into "unpublished" would print a discovery on every second line and the mark
 * would mean nothing.
 *
 * Counted on the authored graph in `repository-state-graph.test.ts`, so the
 * middle is known to be reachable rather than assumed — the standing rule from
 * the three-valued-check note applies, and a value nothing can produce is a bug
 * that passes its own test.
 */
export type PathStanding = "recorded" | "unpinned" | "unpublished";

export function pathStanding(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  crossings: readonly Crossing[],
): PathStanding {
  if (crossings.length === 0) return "unpublished";
  const wanted = crossings.map((crossing) => crossing.edgeKey);

  let anyCompatibleWalker = false;
  for (const node of graph.nodes) {
    if (!isMethod(node)) continue;
    const walked = walkedEdgeKeys(graph, vocabulary, node);
    const start = runStart(walked, wanted);
    if (start < 0) continue;

    // A route that walks these slots but pins a **different** method on one of
    // them does not leave this combination open — it takes a different one. It
    // is not a walker for this crossing at all.
    //
    // Getting this wrong is how the middle value swallows the third: with a
    // plain "did anything walk these slots" test, Carleman + Schrödingerisation
    // reported `unpinned`, even though both routes crossing that slot pair pin a
    // conflicting embedding and neither leaves Carleman open there. The owner's
    // own discovery case was being filed as "the record is silent" when the
    // truthful answer is "no recorded source takes this".
    let conflicts = false;
    let pinsEveryNamed = true;
    let pinsSomething = false;
    for (const [at, crossing] of crossings.entries()) {
      if (crossing.filler === null) continue;
      const slot = walked[start + at]!.split("@")[0]!;
      const pinned = node.via?.[slot];
      if (pinned === undefined) {
        pinsEveryNamed = false;
        continue;
      }
      if (pinned !== crossing.filler) {
        conflicts = true;
        break;
      }
      pinsSomething = true;
    }
    if (conflicts) continue;
    anyCompatibleWalker = true;
    if (pinsEveryNamed && pinsSomething) return "recorded";
  }

  return anyCompatibleWalker ? "unpinned" : "unpublished";
}

/** Index where `wanted` starts inside `walked`, or -1. */
function runStart(walked: readonly string[], wanted: readonly string[]): number {
  if (wanted.length === 0) return -1;
  for (let start = 0; start + wanted.length <= walked.length; start += 1) {
    if (wanted.every((key, at) => walked[start + at] === key)) return start;
  }
  return -1;
}

/** The methods filling a lane's single slot — the fan-out one more click down. */
export function laneFillers(graph: LayerGraph, lane: BundleLane): LayerMethod[] {
  if (lane.edges.length !== 1) return [];
  const edge = lane.edges[0]!;
  const fillers = methodsRealizing(graph, edge.slot);
  if (!edge.narrowedBy) return fillers;
  return fillers.filter((method) => method.id === edge.narrowedBy);
}
