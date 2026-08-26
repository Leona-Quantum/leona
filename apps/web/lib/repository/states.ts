// States: the things a reader can be holding, named, so that a route is a path
// rather than a nest of boxes.
//
// > *"The way I think of it, there are STATES and PROCESSES. State bubbles are
// > essentially every node, which can be both befores and afters, and nodes are
// > connected by processes. States are much simpler… they are independent of the
// > processes going in or out of it (inspiration from markov chains). Then, what
// > you have as bubbles for slots, rather start off as thick lines called
// > processes that each connect 2 states."*
// > — owner, session-91 inbox
//
// ## Why this module exists, and why it is not a rename
//
// `layers.ts` already publishes a contract on every slot: `takes` on one side and
// `returns` on the other. Session 90 drew that contract as a *pinch* — the point
// a strand enters and leaves through. The owner is asking for the pinch to become
// the thing you click on, and for the slot to become the line between two of
// them. That is not a drawing change. A pinch is a place in one picture; a state
// has to be **the same object wherever it appears**, or two routes that genuinely
// meet cannot be drawn as meeting.
//
// The contract prose cannot do that job. `nonlinear-linear-embedding` returns
// *"A linear generator with any inhomogeneity, a lift map, a readout map, and an
// error bound…"* and `time-discretization` takes *"The generator A(t), the
// interval [0,T], an error tolerance ε…"*. Those are the same object, written
// twice by two authors, and no string comparison will ever say so. So the object
// gets a **name**, here, once, and the contracts point at it.
//
// ## What a state is, and what it is deliberately not
//
// A state is **the mathematical object being carried**, not the parameters
// riding alongside it. `time-discretization` takes a generator *and* an interval
// *and* a tolerance; the state is the generator, and `[0,T]` and `ε` stay in the
// contract prose where a reader can see them. Promoting every parameter to a
// state would draw a diagram of tolerances.
//
// A state is also **not a step**. Nothing here says how you got to it or where
// you can go next; that is entirely in the processes. This is the owner's Markov
// framing and it is load-bearing: it is what lets one state sit on four routes
// without belonging to any of them.
//
// ## Kinds narrow, and narrowing has a direction
//
// `specializes` is a partial order — a lattice, not a tree, because a Hermitian
// generator is honestly **both** a linear ODE system and a Hamiltonian you can
// simulate, and forcing it to pick one parent would make the Koopman-von Neumann
// route undrawable.
//
// The direction matters and is the whole reason this is checkable. A process may
// hand on something **narrower** than the next process requires — a block-encoding
// where any matrix access would do — and that composes. Handing on something
// **broader** does not: a general linear generator is not a Hamiltonian, and a
// route that quietly assumes it is has skipped a conversion. `stateSatisfies`
// enforces exactly that asymmetry, and the gaps it finds are reported rather
// than hidden. See `routeOf` in `layers.ts`.
//
// ## The three things this module must never do
//
// 1. **Never invent a state to make a chain close.** A route whose recorded steps
//    do not span its slot has a *gap*, and the gap is the finding — it is the
//    conversion nobody wrote down. Same rule as §3.6: an unstated thing is
//    absent, not a plausible sentence.
// 2. **Never let `specializes` mean "related to".** It means "is a kind of", and
//    the composition check reads it as a promise. `linear-system` does not
//    specialize `linear-ivp`; discretising is work, and work is a process.
// 3. **Never let a state id collide with a node id.** They share the
//    `/repository/layers/<id>` namespace on purpose — one address per thing a
//    reader can name — and `validateLayerGraph` rejects a collision.
//
// ## The admission rule lives in `state-vocabulary.ts`, and what is added here
//
// Four places cite *"`states.ts`'s admission rule"* and state it as **two
// processes arriving, or two leaving**: `state-vocabulary.ts` twice — on
// `marking-oracle` and on `marked-item` (*"says so in as many words"*) —
// `repository-region-joins.test.ts`, and `docs/adr/0027-cross-region-joins.md`.
// **They name the wrong file.** The rule is real and it is stated, in
// `state-vocabulary.ts`'s own header, above the vocabulary it governs:
//
// > *"The test of whether a state belongs here is the one `whyALayer` applies to
// > a slot: can you name **two different processes that arrive at it** or **two
// > that leave it**? A noun that appears on exactly one edge, in one direction,
// > is a parameter of that process and belongs in its contract prose."*
//
// Those four citations are corrected in place to name it. **This file does not
// restate it**, and the first attempt at this comment did — one rule with two
// writers is the duplication the rest of this module argues against, and it
// would have drifted the first time either was edited.
//
// ## What this comment adds, which was genuinely missing: the count
//
// The rule reads as an invariant and is not one. Measured on 2026-08-26 with
// `stateTraffic` in `layers.ts` — arrivals and departures are a node's *own*
// contract, which is what that function calls a process — **11 of the 42 states
// satisfy it and 31 do not.** Among the 31 are `ground-state-problem`,
// `eigenvalue-problem`, `hidden-period` and `search-graph-with-marked-set`, each
// with exactly one process at one end and none at the other; `history-state` is
// touched by no process at all. Nothing enforces it either: `validateStateVocabulary`
// below checks kebab-case, duplicate ids, empty prose and `specializes` hygiene
// and has no opinion on degree, and `check-layer-graph.mjs` prints arrivals ×
// departures per state and gates on none of it.
//
// So it is **a bar applied when a new state is authored, not a property the
// vocabulary has**, and three things follow:
//
// - **A state that fails it is not thereby illegal.** Thirty-one are
//   load-bearing today. The failure says the state is doing the job of *a
//   parameter of one process* until a second process reaches it.
// - **The response to a failure is to name the missing process, never to invent
//   one.** `repository-region-joins.test.ts` already writes that down for
//   `marked-item`: *"Naming a consumer would be the next real piece of work
//   here, and inventing one would be the dishonest way to make this number
//   smaller."* Manufacturing a slot so a count clears is prohibition 1 above
//   wearing a different hat.
// - **`plans/atlas-revamp/W27-marked-item-search-scoped.md` §3 read it as
//   binding and made it a shipping constraint** — Group A of the search region
//   was declared unable to ship without Group B. On the count above that
//   sequencing was stricter than the vocabulary's own practice.

/** A place a reader can be, independent of how they got there. */
export interface LayerState {
  id: string;
  label: string;
  labelJa: string;
  /**
   * What you are holding when you are here — the object, not the journey.
   *
   * Written so it reads as a noun phrase a reader could say out loud, because
   * this is the sentence a state circle shows on hover and the one the state's
   * own page opens with.
   */
  summary: string;
  summaryJa: string;
  /**
   * The broader kinds this is a kind of. A lattice, not a tree.
   *
   * Read as a promise by `stateSatisfies`: declaring `a specializes b` says
   * anything that consumes a `b` will accept an `a`. Declaring it the wrong way
   * round is how a missing conversion gets hidden, so validation checks the
   * relation is acyclic and that every parent resolves.
   */
  specializes?: readonly string[];
}

export interface StateVocabulary {
  states: readonly LayerState[];
}

export function indexStates(vocabulary: StateVocabulary): ReadonlyMap<string, LayerState> {
  return new Map(vocabulary.states.map((state) => [state.id, state]));
}

export function layerState(vocabulary: StateVocabulary, id: string): LayerState | null {
  return vocabulary.states.find((state) => state.id === id) ?? null;
}

/**
 * Every kind `id` is, itself included, walking `specializes` upward.
 *
 * Total on any input: an unknown id yields the empty set, and a cycle — which
 * validation rejects but this function is reached from a route and must survive —
 * terminates on the `seen` guard rather than recursing forever.
 */
export function kindsOf(vocabulary: StateVocabulary, id: string): ReadonlySet<string> {
  const index = indexStates(vocabulary);
  const seen = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const here = queue.pop()!;
    if (seen.has(here)) continue;
    const state = index.get(here);
    if (!state) continue;
    seen.add(here);
    for (const parent of state.specializes ?? []) queue.push(parent);
  }
  return seen;
}

/**
 * Does something produced as `produced` satisfy a requirement for `required`?
 *
 * Covariant in one direction only, and that asymmetry is the entire check.
 * Producing something narrower than required is fine — a block-encoding is a
 * matrix access. Producing something broader is not, and a route that does it
 * has an unrecorded conversion sitting in the join. `routeOf` reports that as a
 * gap; it does not paper over it and it does not fail the build, because a
 * missing conversion is a fact about the literature record rather than a bug in
 * the file.
 */
export function stateSatisfies(
  vocabulary: StateVocabulary,
  produced: string,
  required: string,
): boolean {
  if (produced === required) return true;
  return kindsOf(vocabulary, produced).has(required);
}

/** The narrower kinds of `id`, one level down — the inverse of `specializes`. */
export function specializationsOf(vocabulary: StateVocabulary, id: string): LayerState[] {
  return vocabulary.states.filter((state) => (state.specializes ?? []).includes(id));
}

/**
 * Everything that must be true of the vocabulary on its own.
 *
 * Edges that cross into the layer graph — a contract naming an unknown state, an
 * id colliding with a node — are checked in `validateLayerGraph`, which is the
 * only place that has both halves.
 */
export function validateStateVocabulary(vocabulary: StateVocabulary): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const state of vocabulary.states) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(state.id)) {
      errors.push(`state id is not kebab-case: ${JSON.stringify(state.id)}`);
    }
    if (seen.has(state.id)) errors.push(`duplicate state id: ${state.id}`);
    seen.add(state.id);

    // Both locales, same rule and same reason as the node check: a missing Ja
    // field falls back to English and looks fine in a screenshot.
    for (const [field, value] of [
      ["label", state.label],
      ["labelJa", state.labelJa],
      ["summary", state.summary],
      ["summaryJa", state.summaryJa],
    ] as const) {
      if (typeof value !== "string" || value.trim() === "") {
        errors.push(`${state.id}: ${field} is empty`);
      }
    }

    if (state.specializes !== undefined && state.specializes.length === 0) {
      errors.push(`${state.id}: specializes is present but empty — omit it instead`);
    }
    if (new Set(state.specializes ?? []).size !== (state.specializes ?? []).length) {
      errors.push(`${state.id}: specializes repeats an id`);
    }
    if ((state.specializes ?? []).includes(state.id)) {
      errors.push(`${state.id}: specializes itself`);
    }
  }

  for (const state of vocabulary.states) {
    for (const parent of state.specializes ?? []) {
      if (!seen.has(parent)) {
        errors.push(`${state.id}: specializes an unknown state — ${parent}`);
      }
    }
  }

  // A cycle in `specializes` makes "is a kind of" meaningless and would let
  // `stateSatisfies` answer true in both directions, which is precisely the
  // hidden-conversion failure this whole relation exists to catch.
  const colour = new Map<string, 0 | 1 | 2>();
  const index = indexStates(vocabulary);
  const walk = (id: string): boolean => {
    const mark = colour.get(id);
    if (mark === 1) return false;
    if (mark === 2) return true;
    colour.set(id, 1);
    for (const parent of index.get(id)?.specializes ?? []) {
      if (index.has(parent) && !walk(parent)) return false;
    }
    colour.set(id, 2);
    return true;
  };
  for (const state of vocabulary.states) {
    if (!walk(state.id)) {
      errors.push(`the specializes relation contains a cycle reachable from ${state.id}`);
      break;
    }
  }

  if (vocabulary.states.length === 0) errors.push("the state vocabulary is empty");
  return errors;
}
