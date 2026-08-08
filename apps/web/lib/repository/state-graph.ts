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
export function stateEdges(graph: LayerGraph): StateEdge[] {
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
    for (const [stepId, landing] of Object.entries(node.through ?? {})) {
      const step = layerNode(graph, stepId);
      if (!step || !isCapability(step)) continue;
      const filler = node.via?.[stepId] ?? node.id;
      const key = `${stepId}@${filler}`;
      if (edges.some((edge) => edge.key === key)) continue;
      edges.push({ key, slot: stepId, from: step.contract.from, to: landing, narrowedBy: filler });
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
  const edges = stateEdges(graph);
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
    bundles.push({ from: start, to: end, lanes });
  }

  return {
    chain: full,
    bundles,
    atomicAtThisLevel: false,
    truncated: search.truncated,
    chainConsistent: consistent,
  };
}

/** One way of filling a slot, drawn as its own line between the slot's two states. */
export interface MethodLane {
  key: string;
  method: LayerMethod;
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
export function methodFanOf(graph: LayerGraph, capability: LayerCapability): MethodFan | null {
  const methods = methodsRealizing(graph, capability.id);
  if (methods.length === 0) return null;
  return {
    from: capability.contract.from,
    to: capability.contract.to,
    lanes: methods.map((method) => ({ key: `m:${method.id}`, method })),
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
 * cosmetic. `backward-euler` lists `quantum-linear-solve` as a step, but
 * `routeOf` classifies it as a **feed** — an ingredient the method consumes, not
 * a hop it travels — so reading `steps` credits backward Euler with walking the
 * quantum-linear-solve edge, which it does not. The same read also picks up
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
