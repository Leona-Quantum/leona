// Where one region of the map hands work to another.
//
// > *"BIG: i believe several groups can eventually be combined into bigger maps.
// > For example, error correction happens on states measured on computers, so
// > that whole map can come after in some way when states [are] being measured
// > and such in another pipeline. Transpilation is a process that happens along
// > the pipeline in some way, some problems can be solved using VQE by different
// > framing and preparation of the problem itself, etc etc."*
// > — owner, ai-ops#64
//
// ## A join is not a new kind of edge
//
// The map has exactly one way to say work happens — a capability with a
// `from`/`to` contract — and exactly one way to say two objects are the same
// thing — `stateSatisfies` walking `specializes`. A cross-region join is
// therefore never a new relation. It is one of three things:
//
// 1. **A shared state.** One region produces something that *is* what another
//    consumes. Nothing to author: the edge is a consequence of two contracts
//    that were each written and sourced already, so it asserts nothing new.
// 2. **A missing process.** The states differ and the conversion is real work.
//    It is authored as an ordinary capability — two ways through it, primary
//    sources — or it is not drawn.
// 3. **A refusal.** A reader expects an edge, none may be drawn, and the reason
//    is written down where the next author will find it.
//
// There is deliberately no `joins:` field. A join field would be a claim with no
// contract, no methods, no source and no cost, sitting beside a graph where
// every other claim has all four — and a reader cannot tell a wrong link from a
// missing one, so the cheap version of this idea is worse than none of it.
//
// ## A join's blast radius is a product, not an edge
//
// Naming one state on two contracts does not assert one composition. It asserts
// **every arrival against every departure** at that state. `parameterized-circuit`
// carries 11 arrivals and 12 departures — 132 compositions, of which 77 cross
// out of the algorithms region into compilation — and no author wrote those 77
// down one at a time. That is what `joinSurface` counts, and it is why the guard
// below pins a total rather than blessing individual pairs.
//
// ## The rule this module cannot check, said out loud
//
// The owner's session-91 rule is that an arrival which cannot use every exit
// means the state has to split. That is a **restriction** relation, and
// `specializes` only ever widens, so nothing here can decide it —
// `check-layer-graph.mjs` reached the same conclusion and counts instead. So
// this module counts a join's product and reports where it lands; it never
// certifies that every member of the product is honest. `stateCompositionCensus`
// in `layers.ts` already grades individual crossings `recorded` / `unpinned` /
// `unpublished` and that grading, not this file, is what says whether anybody
// has walked one.
//
// ## And the second thing a machine cannot decide
//
// Ten of the graph's twenty-three slots consume a state **no process produces**.
// That is the normal condition of a map that has grown by regions, and it is not
// by itself a defect: the reader arrives holding the first object. What a
// machine cannot tell is whether a given slot is *correctly* a front door or
// whether the literature records a process that ought to feed it —
// `error-mitigation` being enterable-from-nowhere is structurally identical to
// `nonlinear-ode-solve` being so, and only one of them is right. So the supply
// classification here is mechanical and checked, and the **intent** beside it is
// authored prose that a human has to keep true.
import { isCapability, isMethod, contractFor, routeOf } from "./layers.ts";
import type { LayerCapability, LayerGraph } from "./layers";
// Extensioned at runtime, extensionless for types: `node --test` resolves
// specifiers literally, so a runtime import without `.ts` fails at load. Same
// split, same reason, as `paper-traces.ts`.
import { layerAdjacency } from "./paper-traces.ts";
import { stateSatisfies } from "./states.ts";
import type { StateVocabulary } from "./states";

/**
 * A region: a connected component of the map under the containment edges.
 *
 * The same edge set `paper-traces.ts` walks — `realizes`, `steps`, `refines` —
 * and reached through the same function rather than a second copy of it, so
 * "region" here and "component" in the scatter gate can never drift apart. That
 * matters because the scatter gate's whole meaning is that two citations fall in
 * different components, and a join that changed one definition without the other
 * would quietly re-grade every paper on the map.
 */
export interface Region {
  /** 1-based, largest region first. Stable only within one call. */
  index: number;
  nodes: readonly string[];
  capabilities: readonly string[];
}

export function regionsOf(graph: LayerGraph): Region[] {
  const adjacency = layerAdjacency(graph);
  const order = new Map(graph.nodes.map((node, index) => [node.id, index] as const));
  const capability = new Set(graph.nodes.filter(isCapability).map((node) => node.id));
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const node of graph.nodes) {
    if (seen.has(node.id)) continue;
    const members: string[] = [];
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const here = queue.shift()!;
      members.push(here);
      for (const neighbour of adjacency.get(here) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        queue.push(neighbour);
      }
    }
    components.push(members.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0)));
  }

  // Largest first, then by graph order, so the numbering is total and does not
  // depend on which node the walk happened to start from.
  components.sort((a, b) => b.length - a.length || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0));
  return components.map((nodes, index) => ({
    index: index + 1,
    nodes,
    capabilities: nodes.filter((id) => capability.has(id)),
  }));
}

/** Region index by node id, for every node in the graph. */
export function regionOf(regions: readonly Region[]): ReadonlyMap<string, number> {
  const byNode = new Map<string, number>();
  for (const region of regions) for (const id of region.nodes) byNode.set(id, region.index);
  return byNode;
}

/**
 * Every state the graph can hand you.
 *
 * Three sources, and all three are needed: a slot's declared `to`, a method's
 * own `to` where it narrows the slot's contract, and every `through` landing.
 * Leaving the narrowings out reports `runnable-evolution` as produced by nothing
 * — it is named by no contract at all — which is the mistake
 * `leona-every-state-is-reachable` was written about.
 *
 * Exported because `check-ingredients.mjs` asks the same question of records
 * that this file asks of slots, and two definitions of "the map produces this"
 * would drift the first time either was edited.
 */
export function producedStates(graph: LayerGraph): ReadonlySet<string> {
  const produced = new Set<string>();
  for (const node of graph.nodes) {
    if (isCapability(node)) {
      produced.add(node.contract.to);
      continue;
    }
    if (!isMethod(node)) continue;
    const contract = contractFor(graph, node)?.contract;
    if (contract) produced.add(contract.to);
    for (const landing of Object.values(node.through ?? {})) produced.add(landing);
  }
  return produced;
}

/**
 * How a slot gets what it consumes. Mechanical, and checked.
 *
 * The order below is the order the classification tries, and it is load-bearing
 * rather than arbitrary — see `classify`.
 *
 * ## Four classes, and there is provably no fifth
 *
 * The obvious fifth is an **orphan**: a slot walked on some route's spine that
 * nothing anywhere can supply. It was written, tested, and then removed, because
 * it cannot occur:
 *
 * - `routeOf` (`layers.ts:1429`) advances through a step only when
 *   `stateSatisfies(holding, step.from)`, and files it as a feed otherwise. So
 *   `onSpine > 0` means some route *held* something satisfying this slot's entry.
 * - What a route holds is its own slot's `from` to begin with, and after every
 *   hop it is that hop's `to` or its `through` landing — both of which
 *   `producedStates` collects. So a held state is either produced (⇒ `joined`)
 *   or the realizing slot's own entry.
 * - In the second case, walk down: that slot is either a root (⇒ `root-supplied`,
 *   since `stateSatisfies` is transitive) or it is itself stepped into, and the
 *   steps graph is acyclic — `validateLayerGraph` rejects a cycle — so the walk
 *   terminates at a root.
 *
 * Keeping the class would have shipped a branch nothing can reach, which reads
 * to the next author as coverage the checker does not have.
 */
export type EntrySupply =
  /** Some process produces a state that satisfies this slot's `from`. */
  | "joined"
  /** A root: nothing steps into it, so the reader arrives holding its entry. */
  | "front-door"
  /** Not a root, but a root's own entry state satisfies this slot's `from`. */
  | "root-supplied"
  /** Never walked on any route's spine; every route naming it files it as a feed. */
  | "ingredient";

export interface SlotEntry {
  slot: string;
  from: string;
  region: number;
  /** Produced states satisfying `from`, in vocabulary order. Empty except when `joined`. */
  suppliers: readonly string[];
  supply: EntrySupply;
  /** Routes that walk this slot as a hop of their chain. */
  onSpine: number;
  /** Routes that file this slot as an ingredient hanging off a hop. */
  asFeed: number;
  root: boolean;
}

/**
 * Every slot, and where its input comes from.
 *
 * ## Why `ingredient` is tested against the spine and not against the feed count
 *
 * A slot can be both — `observable-estimation` is walked on seven spines and
 * filed as a feed nine times. Reading "is a feed anywhere" as ingredient would
 * have classified `ansatz-construction` (seven spines, one feed) as an
 * ingredient and left the gate with nothing to find. So the test is
 * `onSpine === 0`: a slot nothing advances *through* is one whose product is
 * handed sideways into a route, and its own input is the reader's to supply.
 */
export function slotEntries(graph: LayerGraph, vocabulary: StateVocabulary): SlotEntry[] {
  const regions = regionsOf(graph);
  const region = regionOf(regions);
  const produced = producedStates(graph);
  const stepped = new Set<string>();
  for (const node of graph.nodes) if (isMethod(node)) for (const step of node.steps) stepped.add(step);

  const onSpine = new Map<string, number>();
  const asFeed = new Map<string, number>();
  for (const node of graph.nodes) {
    if (!isMethod(node)) continue;
    const route = routeOf(graph, vocabulary, node);
    for (const segment of route.segments) {
      if (segment.capabilityId === null) continue;
      onSpine.set(segment.capabilityId, (onSpine.get(segment.capabilityId) ?? 0) + 1);
    }
    for (const feed of route.feeds) asFeed.set(feed, (asFeed.get(feed) ?? 0) + 1);
  }

  // The states a reader may arrive holding: the entry of every root slot.
  const doorStates = graph.nodes
    .filter((node): node is LayerCapability => isCapability(node) && !stepped.has(node.id))
    .map((node) => node.contract.from);

  const entries: SlotEntry[] = [];
  for (const node of graph.nodes) {
    if (!isCapability(node)) continue;
    const suppliers = vocabulary.states
      .map((state) => state.id)
      .filter((id) => produced.has(id) && stateSatisfies(vocabulary, id, node.contract.from));
    const root = !stepped.has(node.id);
    const spine = onSpine.get(node.id) ?? 0;
    const feed = asFeed.get(node.id) ?? 0;

    const classify = (): EntrySupply => {
      if (suppliers.length > 0) return "joined";
      if (root) return "front-door";
      // Before `ingredient`, because a slot the reader can enter holding is
      // supplied however its product is later consumed.
      if (doorStates.some((door) => stateSatisfies(vocabulary, door, node.contract.from))) {
        return "root-supplied";
      }
      // Everything left is a feed. See `EntrySupply` for why nothing reaches
      // here with `spine > 0`: a walked spine step is always joined or
      // root-supplied, so this is total rather than a default.
      return "ingredient";
    };

    entries.push({
      slot: node.id,
      from: node.contract.from,
      region: region.get(node.id) ?? 0,
      suppliers,
      supply: classify(),
      onSpine: spine,
      asFeed: feed,
      root,
    });
  }
  return entries;
}

/** One method-to-method composition the graph asserts by naming a state twice. */
export interface Crossing {
  state: string;
  arrival: string;
  departure: string;
  /** True when arrival and departure sit in different regions. */
  crosses: boolean;
}

export interface StateJoin {
  state: string;
  arrivals: number;
  departures: number;
  /** `arrivals × departures` — every composition naming this state asserts. */
  asserted: number;
  crosses: number;
}

export interface JoinSurface {
  crossings: readonly Crossing[];
  /** Compositions whose two ends sit in one region. */
  within: number;
  /** Compositions that cross a region boundary. **The figure the guard pins.** */
  crosses: number;
  /** Per state, largest product first. Only states with both an arrival and a departure. */
  states: readonly StateJoin[];
}

/**
 * Every composition the state vocabulary asserts, split by whether it crosses a
 * region.
 *
 * Arrivals and departures are derived exactly as `stateCompositionCensus` does
 * — deduped on the method, narrowings included, departures found through
 * `stateSatisfies` rather than string equality so that a narrower state departs
 * everywhere its kinds may. The one thing added here is the region test, which
 * is the whole point: the map's own census is region-blind and so cannot say how
 * much of the surface is the thing the owner asked about.
 */
export function joinSurface(graph: LayerGraph, vocabulary: StateVocabulary): JoinSurface {
  const region = regionOf(regionsOf(graph));
  const methods = graph.nodes.filter(isMethod);
  const contract = (id: string) => {
    const node = methods.find((method) => method.id === id);
    return node ? (contractFor(graph, node)?.contract ?? null) : null;
  };

  const crossings: Crossing[] = [];
  const states: StateJoin[] = [];

  for (const state of vocabulary.states) {
    const arrivals: string[] = [];
    const seen = new Set<string>();
    for (const method of methods) {
      if (contract(method.id)?.to === state.id && !seen.has(method.id)) {
        seen.add(method.id);
        arrivals.push(method.id);
      }
    }
    for (const method of methods) {
      for (const [stepId, landing] of Object.entries(method.through ?? {})) {
        if (landing !== state.id) continue;
        // An unpinned narrowing is the recording route's own claim, so the route
        // is the process there — the fallback `walkedEdgeKeys` uses.
        const filler = method.via?.[stepId] ?? method.id;
        if (!seen.has(filler) && methods.some((m) => m.id === filler)) {
          seen.add(filler);
          arrivals.push(filler);
        }
      }
    }

    const departures: string[] = [];
    for (const method of methods) {
      const from = contract(method.id)?.from;
      if (from === undefined || from === null) continue;
      if (from !== state.id && !stateSatisfies(vocabulary, state.id, from)) continue;
      departures.push(method.id);
    }

    if (arrivals.length === 0 || departures.length === 0) continue;
    let crosses = 0;
    for (const arrival of arrivals) {
      for (const departure of departures) {
        const crossesHere = region.get(arrival) !== region.get(departure);
        if (crossesHere) crosses += 1;
        crossings.push({ state: state.id, arrival, departure, crosses: crossesHere });
      }
    }
    states.push({
      state: state.id,
      arrivals: arrivals.length,
      departures: departures.length,
      asserted: arrivals.length * departures.length,
      crosses,
    });
  }

  states.sort((a, b) => b.crosses - a.crosses || b.asserted - a.asserted);
  return {
    crossings,
    within: crossings.filter((crossing) => !crossing.crosses).length,
    crosses: crossings.filter((crossing) => crossing.crosses).length,
    states,
  };
}

// ---------------------------------------------------------------------------
// The declaration
// ---------------------------------------------------------------------------

/**
 * Whether the map means a slot's supply to stay as it is.
 *
 * This is the column a machine cannot fill. `error-mitigation` is a front door
 * for exactly the same structural reason `nonlinear-ode-solve` is one — nothing
 * steps into either, and nothing produces what either consumes — and the two are
 * not the same situation at all. One is where a reader starts. The other is a
 * five-node region the rest of the map cannot reach, which is the thing ai-ops#64
 * asks to fix.
 */
export type EntryIntent =
  /** The map means this. A front door, or an ingredient the reader supplies. */
  | "settled"
  /** A process ought to feed this and none is recorded. **The join worklist.** */
  | "join-wanted";

export interface EntryDisposition {
  /** The mechanical class this row was written against. Checked, so it cannot go stale. */
  supply: EntrySupply;
  intent: EntryIntent;
  /** Why. An empty reason is not a declaration. */
  reason: string;
}

/**
 * Every slot whose entry state no process produces, and what the map means by it.
 *
 * ## Why every one of them needs a row rather than only the bad ones
 *
 * Because which ones are bad is the judgement, and a list of only the bad ones
 * records the judgement nowhere. Ten of twenty-three slots are in this condition
 * and the map currently makes ten silent decisions about them; a row per slot
 * turns those into ten written ones, and the `supply` field is re-derived on
 * every lint so a row cannot outlive the shape it describes.
 *
 * Stale-proof in both directions, the rule `DECLARED_SCATTERED_PAPERS`,
 * `KNOWN_TWINS` and `PERMITTED_NON_PAPER_SOURCES` all obey: a slot in this
 * condition with no row fails, a row for a slot that has since gained a supplier
 * fails, and a row whose `supply` no longer matches what the graph says fails.
 * The third is the one that catches a join being made by accident.
 */
export const DECLARED_SLOT_ENTRIES: Readonly<Record<string, EntryDisposition>> = {
  "nonlinear-ode-solve": {
    supply: "front-door",
    intent: "settled",
    reason:
      "The map's own front door. A reader arrives holding a nonlinear initial-value problem; nothing in the literature produces one, because it is the problem you came with.",
  },
  "spatial-discretization": {
    supply: "front-door",
    intent: "settled",
    reason:
      "A reader arrives holding a partial differential equation. Nothing in the literature produces one — it is the problem you came with — so this is a front door in the same sense nonlinear-ode-solve is, and correctly so. What is new is where it leads: it produces a linear ODE system, which the algorithms region already consumes, so this slot is joined to that region by a shared state rather than by containment. That is the first cross-region join on this map built from sourced content rather than found in it.",
  },
  "full-discretization": {
    supply: "front-door",
    intent: "settled",
    reason:
      "The same front door as spatial-discretization and the same reason: a PDE is brought, not produced. It is a separate slot because it is a separate act — Linden, Montanaro and Shao's forward-time centre-space scheme builds one block system over every timestep at once rather than discretising space and then time, and Novikau et al. have no time axis to discretise at all. It joins the algorithms region at linear-system.",
  },
  "nonlinear-linear-embedding": {
    supply: "root-supplied",
    intent: "settled",
    reason:
      "Consumes the same nonlinear IVP the root slot is entered with, so the reader's own problem supplies it. Not a gap: it is the first hop off the front door.",
  },
  "polynomial-approximation": {
    supply: "ingredient",
    intent: "settled",
    reason:
      "Takes a target function — 1/x, the sign function, e^{-ixt} — which is a choice the caller makes, not an object a prior process hands over. Filed as a feed by both routes that name it.",
  },
  "state-preparation": {
    supply: "ingredient",
    intent: "settled",
    reason:
      "Takes the amplitudes you want loaded. Twelve routes file it as a feed and none walks it on a spine: the vector is data the caller has, and where it came from is outside what this map describes.",
  },
  "success-amplification": {
    supply: "ingredient",
    intent: "settled",
    reason:
      "Takes a routine with a good branch, which is what the subroutine being amplified already returned. Four routes hang it off the hop that produced the flagged routine; it advances nothing on its own.",
  },
  "device-characterization": {
    supply: "front-door",
    intent: "settled",
    reason:
      "Takes a programmable device — its qubits, its gate set, its connectivity, its measurement. Nothing produces one, because a machine is not the output of any process this map draws; a reader arrives holding the hardware, the same way `nonlinear-ode-solve`'s reader arrives holding a problem. Owner ruling ai-ops#68 put these protocols on the map so one parity number covers both surfaces; it did not claim they are reached from anywhere, and inventing a producer would have been the dishonest way to make the region look connected.",
  },
  "error-correction": {
    supply: "root-supplied",
    intent: "join-wanted",
    reason:
      "Takes physical qubits, which no process here produces, and `fault-tolerant-compilation` files it as a feed rather than a hop — so the map says error correction is the substrate the pipeline runs on, matching this slot's own whyALayer ('everything above this layer is written in logical qubits and is indifferent to which code sits underneath'). ai-ops#64 asks for the other reading, that it 'happens on states measured on computers' and should come after measurement. Both are defensible and the choice is the owner's; the row stays join-wanted until he rules. **Reclassified `ingredient` -> `root-supplied` in session 15 without anyone editing this slot**: `device-characterization` is a root capability that also consumes `physical-qubits`, so the state is now entered at a root and every slot naming it re-types. The change is mechanical and it is also an improvement in honesty — the map now has an explicit place where a reader hands over hardware, where before it only had slots quietly assuming one. What it is NOT is an answer to this row's open question, which is about whether error correction belongs before or after measurement. `intent` deliberately stays `join-wanted`.",
  },
  "hidden-period-finding": {
    supply: "front-door",
    intent: "settled",
    reason:
      "**The map's second front door, and the first one added deliberately.** A reader arrives holding a function they can evaluate in superposition and a promise that it repeats; nothing in the literature produces one, because it is the problem you came with — the same reading `nonlinear-ode-solve` carries, for the same reason. That this slot opens a FOURTH region is what growing the map into a new subject area looks like from the join model's side: a genuinely new subject is entered directly or it is not new. The alternative was manufacturing a producer, and the only honest candidate would have been a problem-framing step turning factoring into order finding — which Shor does contain (\"The order of the generator could in fact be computed using the quantum order-finding algorithm given in §5 of this paper\") but which lives INSIDE this region rather than joining it to another. Recorded as settled rather than join-wanted on that basis: nothing outside number theory produces a periodic function, and nothing should be invented so that something does.",
  },
  "phase-estimation": {
    supply: "ingredient",
    intent: "settled",
    reason:
      "Takes a unitary whose eigenphase is wanted — an evolution circuit, the routine preparing the state it acts on, AND the declaration that a phase in its spectrum is the quantity asked for. Nothing produces that declaration, because a declaration is not something a process hands over; it is what the caller wants. `phase-estimation-ground-state` files it as a feed, which is the right shape: Aspuru-Guzik et al. build the evolution and the reference state and then say what they want out of them. Worth recording that this slot spent one commit as a FOURTH REGION — three nodes nothing reached — until that step was declared, and the step was declared because the paper makes the claim, not because the checker asked. Had no route genuinely used it, the honest outcome would have been a front-door row saying so.",
  },
  "error-mitigation": {
    supply: "front-door",
    intent: "join-wanted",
    reason:
      "Nothing produces a noisy expectation value, so the whole five-node region can only be entered directly — and its own whyALayer says nothing downstream can consume its output either, leaving it sealed at both ends. The missing process is the one that runs a circuit on hardware and returns a biased estimate; the map has only observable-estimation, which returns the idealised number. Not a front door anybody wants.",
  },
  "ground-state-energy": {
    supply: "ingredient",
    intent: "join-wanted",
    reason:
      "The VQE slot has no way in. Its entry, a Hamiltonian declared to want its lowest eigenvalue, is produced by nothing, and the three routes naming it file it as a feed — so a reader may reach a ground-state energy only as an ingredient of an excited-state calculation, never by bringing a problem to it. ai-ops#64's 'some problems can be solved using VQE by different framing and preparation of the problem itself' names exactly this missing framing process.",
  },
  "ansatz-construction": {
    supply: "root-supplied",
    intent: "settled",
    reason:
      "Consumes an eigenvalue problem, which the excited-state root is entered with and which satisfies it. Seven routes walk it on their spine and they are all reachable, so this is supplied rather than open — the gap in this region is at ground-state-energy, not here.",
  },
  "excited-state-energy": {
    supply: "front-door",
    intent: "settled",
    reason:
      "A root: the reader arrives declaring which state above the lowest one is wanted, and that declaration is part of the problem rather than something a prior process computes.",
  },
};

export interface EntryAudit {
  /** In this condition with no row. **The error.** */
  undeclared: readonly SlotEntry[];
  /** A row for a slot that has since gained a supplier, or vanished. Delete it. */
  stale: readonly string[];
  /** A row whose `supply` no longer matches the graph. **A join was made or broken.** */
  misclassified: readonly { slot: string; declared: EntrySupply; actual: EntrySupply }[];
}

/**
 * Compare the slots against the declarations.
 *
 * Takes `declared` as an argument rather than reading the constant, so both
 * directions can be exercised against fixtures without the repository's own
 * rows leaking into the test.
 */
export function auditSlotEntries(
  entries: readonly SlotEntry[],
  declared: Readonly<Record<string, EntryDisposition>> = DECLARED_SLOT_ENTRIES,
): EntryAudit {
  const open = entries.filter((entry) => entry.supply !== "joined");
  const bySlot = new Map(open.map((entry) => [entry.slot, entry] as const));
  return {
    undeclared: open.filter(
      // An empty reason is not a declaration: a row that records a judgement has
      // to say what the judgement was, or the list becomes ids nobody can re-read.
      (entry) => (declared[entry.slot]?.reason ?? "").trim() === "",
    ),
    stale: Object.keys(declared).filter((slot) => !bySlot.has(slot)),
    misclassified: Object.entries(declared)
      .filter(([slot, row]) => bySlot.has(slot) && bySlot.get(slot)!.supply !== row.supply)
      .map(([slot, row]) => ({ slot, declared: row.supply, actual: bySlot.get(slot)!.supply })),
  };
}

/** Slots whose entry a process ought to produce and none does — the join worklist. */
export function joinWorklist(
  entries: readonly SlotEntry[],
  declared: Readonly<Record<string, EntryDisposition>> = DECLARED_SLOT_ENTRIES,
): SlotEntry[] {
  return entries.filter((entry) => declared[entry.slot]?.intent === "join-wanted");
}
