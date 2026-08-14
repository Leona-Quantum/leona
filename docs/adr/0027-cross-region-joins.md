# ADR-0027: A cross-region join is a shared state, a missing process, or a refusal

**Date:** 2026-08-13 · **Status:** accepted (instrument shipped; no join built under it yet)

**Context:** The owner's largest standing direction for the map, `EshMis/ai-ops` issue #64:

> **BIG:** i believe several groups can eventually be combined into bigger maps. For example,
> error correction happens on states measured on computers, so that whole map can come after in
> some way when states [are] being measured and such in another pipeline. Transpilation is a
> process that happens along the pipeline in some way, some problems can be solved using VQE by
> different framing and preparation of the problem itself, etc etc. This whole map can be
> eventually filled out and interconnected like this, and expanded well beyond what it is of course.

His intake order from ai-ops#58 governs how that gets done — *"map the pipeline of each paper
first. Then see how they can be broken into components. Then build the map by connecting
components and states that are shared across papers."* This ADR is about the third step, and only
the third: what a cross-region edge **is**, what makes two states the same state, and what a
checker may refuse.

Measured at commit `45395f9e` (117 nodes, 23 capabilities, 94 methods, 34 states), the map is
**three connected components** under the containment edges `realizes` / `steps` / `refines` — 99
nodes of algorithms, 13 of compilation and error correction, 5 of error mitigation. That split is
already documented and already load-bearing: `paper-traces.ts` grades a paper `scattered` when its
citations fall in different components, and ADR-0026 arms a gate on it.

## Decision

**A cross-region join is never a new kind of edge.** The map has exactly one way to say work
happens — a capability with a `from`/`to` contract — and exactly one way to say two objects are
the same thing — `stateSatisfies`, walking `specializes`. Every join is therefore one of three
things:

1. **A shared state.** One region produces something that *is* what another consumes. Nothing is
   authored: the edge is a consequence of two contracts that were each written and sourced
   already, so it asserts nothing new and carries no sourcing risk.
2. **A missing process.** The states differ and the conversion is real work. It is authored as an
   ordinary capability — two ways through it, primary sources, the same bar as any other slot —
   or it is not drawn.
3. **A refusal.** A reader expects an edge, none may be drawn, and the reason is written where the
   next author will find it.

There is deliberately **no `joins:` field**. A join field would be a claim with no contract, no
methods, no source and no cost, sitting in a graph where every other claim has all four. ADR-0026
§"the unit of extraction" already refuses the shape; a reader cannot tell a wrong link from a
missing one, so the cheap version of this idea is worse than none of it.

**Sameness is `stateSatisfies`, direction included.** Producing something *narrower* than a slot
requires composes — a block-encoding is a matrix access. Producing something *broader* does not,
and a join drawn that way has an unrecorded conversion hidden inside it. A join is therefore
directional, and the reverse of a valid join is usually not one.

**A join's blast radius is a product, not an edge.** Naming one state on two contracts does not
assert one composition; it asserts **every arrival against every departure** at that state. This
is the single most important consequence of the model and the reason the guard below pins a total.

## What that means, measured

At `45395f9e` the join surface is **491 method-to-method compositions**: 386 inside one region and
**105 across one**. The 105 sit at exactly three states and every one of them leaves the algorithms
region for the *same seven* compilation methods:

| state | arrivals × departures | asserted | crossing |
|---|---|---|---|
| `parameterized-circuit` | 11 × 12 | 132 | **77** |
| `evolution-circuit` | 3 × 7 | 21 | **21** |
| `runnable-evolution` | 1 × 11 | 11 | **7** |

So **the transpilation join the owner asked for already exists in the data** and is simply not
drawn or counted anywhere. It needs no new claim about the literature. The other two joins he named
do not exist at all, and neither does a fourth nobody had noticed:

- **Error correction.** Its contract is `physical-qubits → logical-qubits`, `routeOf` files it as a
  **feed** of `fault-tolerant-compilation` — an ingredient hanging off a hop, not a hop — and its
  own `whyALayer` says everything above it is *"indifferent to which code sits underneath"*. Three
  independent places in the map say **substrate**. ai-ops#64 says **stage**. Both are defensible
  readings of the literature and the choice is the owner's; it is raised on ai-ops and this ADR
  does not pre-empt it.
- **VQE framing.** `ground-state-energy` has no way in. Its entry is produced by nothing and all
  three routes naming it file it as a feed, so a reader may reach a ground-state energy only as an
  ingredient of an excited-state calculation, never by bringing a problem to it. That missing
  framing process is exactly what #64's *"different framing and preparation of the problem itself"*
  names. Building it must not dissolve the guard `state-vocabulary.ts` documents at length: the
  narrowness of `ground-state-problem` exists to stop a recast Hamiltonian reaching the variational
  region and drawing a branch no literature contains.
- **Error mitigation, unnamed by him and worse than either.** Nothing produces `noisy-estimate`, so
  the whole five-node region can only be entered directly; and its `whyALayer` says nothing
  downstream can consume its output either. It is sealed at both ends. The missing process is the
  one that runs a circuit on hardware and returns a biased number — the map has only
  `observable-estimation`, which returns the idealised one.

## A process that needs two things at once is a conjunction state, not a fourth kind

The hardest test the three kinds have been put to came from the other lane, unprompted: **quantum
phase estimation has no capability on the map**, evidenced by three independent papers — one that
*is* PEA end to end, one that exists to make block encodings cheap enough to support it, and one
that argues against it by name — and its sketched contract wants **two inputs**, an
`evolution-circuit` *and* a `prepared-state`, returning an `observable-value`. `LayerContract` has
one `from` and one `to`. So: does that break the taxonomy?

**No, and the vocabulary already contains the answer.** Two things arriving together is a state
that `specializes` **both** of them, and that is the documented design rather than a workaround —
`states.ts` says *"`specializes` is a partial order — a lattice, not a tree, because a Hermitian
generator is honestly **both** a linear ODE system and a Hamiltonian you can simulate, and forcing
it to pick one parent would make the Koopman-von Neumann route undrawable."* Four states are
already conjunctions: `hermitian-generator`, `solution-state`, `history-state`, and —

**`runnable-evolution`, which specializes exactly `evolution-circuit` and `prepared-state`.** It
was authored in session 120 for this precise shape, and its own comment describes phase estimation
without naming it: *"The pair is still a circuit… and it is also the routine that makes the evolved
state: run it and the state is in hand, **control and invert it and an estimation readout can call
the whole simulation as a subroutine**."* So the contract shape is `runnable-evolution →
observable-value`: one input, already in the vocabulary, and `stateSatisfies` supplies both halves
because a `runnable-evolution` satisfies `evolution-circuit` and `prepared-state` at once.

So a two-input process is **category (b), a missing process** — whose entry state may also need
authoring. That is ordinary vocabulary growth under `states.ts`'s existing admission rule (two
processes arriving, or two leaving), and it changes nothing about what an edge is: still one
contract, still `stateSatisfies`, still directional.

**The constraint that keeps this honest, and it is the one to enforce at review:** a conjunction
state must be an object *a source hands on as one thing*, never a tuple invented so a chain closes.
That is `states.ts`'s first prohibition — *"Never invent a state to make a chain close"* — and
`runnable-evolution` earned itself on Joseph's text rather than on convenience. A conjunction
written because two arrows needed to meet is the same defect as a link we cannot source, wearing a
type.

## The rule this model cannot check, stated rather than hidden

The owner's session-91 rule is that **an arrival which cannot use every exit means the state has to
split**. That is a *restriction* relation and `specializes` only ever widens, so nothing can decide
it mechanically; `check-layer-graph.mjs` reached the same conclusion and counts instead of
checking. This model inherits the limit exactly: it counts a join's product and reports where it
lands, and it never certifies that every member of the product is honest. `stateCompositionCensus`
already grades individual crossings `recorded` / `unpinned` / `unpublished`, and that grading —
not this model — is what says whether anybody has walked one.

The practical consequence is that the guard is a **pin on the product**, not a verdict on it. A
`specializes` line added in `state-vocabulary.ts` changes no contract, touches no node, and
re-types every slot naming the parent; it is the cheapest way to connect two regions and the
easiest to do by accident. Pinning 105 means whoever moves it has to say why.

## Ten slots consume something nothing produces, and only a human can grade them

`slotEntries` classifies every slot mechanically into four supply classes, and at `45395f9e`
**10 of 23** consume a state no process produces: 3 `front-door`, 2 `root-supplied`, 5
`ingredient`. That is the normal condition of a map grown region by region, not a defect.

What a machine cannot tell is whether a given slot is *correctly* unfed. `error-mitigation` is a
front door for structurally the same reason `nonlinear-ode-solve` is one — nothing steps into
either, and nothing produces what either consumes — and only one of them is right. So
`DECLARED_SLOT_ENTRIES` carries a row per open slot with two fields: the mechanical `supply`,
re-derived on every lint so a row cannot outlive the shape it describes, and an authored `intent`
of `settled` or `join-wanted`. Three rows are `join-wanted` today and they are the three above.

Every open slot needs a row, not only the bad ones, because **which ones are bad is the
judgement**, and a list of only the bad ones records the judgement nowhere. Ten silent editorial
decisions become ten written ones.

**There is provably no fifth supply class.** An `orphan` — a slot walked on some route's spine that
nothing can supply — was written, tested, and removed. `routeOf` (`layers.ts:1429`) advances
through a step only when what the route holds satisfies it, and files it as a feed otherwise; what
a route holds is its own slot's `from` or a prior hop's output; the steps graph is acyclic, so
walking down terminates at a root and `stateSatisfies` is transitive. An unsuppliable step is
therefore always a feed and can never be walked. Keeping the branch would have read to the next
author as coverage the checker does not have.

## Consequences

- `scripts/check-region-joins.mjs` runs in `lint`. It refuses exactly three things, all of them a
  declaration going out of date: an open slot with no row; a row for a slot that has since gained
  a supplier; and **a row whose recorded supply no longer matches the graph** — the direction that
  catches a region being joined or cut by accident.
- It refuses nothing about the *size* of the join surface. There is no honest threshold: a map
  that grows correctly grows it. The figure is pinned once, in
  `apps/web/lib/repository-region-joins.test.ts`, where moving it is a reviewed edit.
- `regionsOf` reaches `layerAdjacency` from `paper-traces.ts` rather than re-deriving components,
  so "region" here and "component" in ADR-0026's scatter gate cannot drift. This matters: the
  scatter gate's whole meaning is that two citations fall in different components.
- **A trace now walks shared states, and it was measured before it was built.** A shared state is
  the fourth kind of edge: when one slot's `contract.to` satisfies another's `contract.from` the
  second continues the first, which is what a contract means. It adds **23 undirected capability
  edges** and takes the map from **3 components to 2** (112 nodes and 5) — compilation joins the
  algorithms region, and error mitigation stays out because nothing produces `noisy-estimate`. The
  paper census is **unchanged in every bucket**: 117 cited, 86 `point` / 2 `contiguous` / 29
  `joinable` / **0 `scattered`**, identically before and after. So this arms nothing new today and
  closes a false positive that was waiting — a paper cited at both `hamiltonian-simulation` and
  `gate-synthesis` is following the pipeline and was graded as having drifted for doing so.

- **Two relations, not one.** `layerAdjacency` stays containment-only — it is what a **region**
  is — and `walkableAdjacency` adds the state edges, which is what a **trace** may walk.
  `regionsOf` uses the first and must keep doing so: fold the state edges into the definition of a
  region and two areas joined by a shared state become one region, so "cross-region join" means
  nothing by construction and the 105 crossings above count themselves away. That is asserted on
  the real graph rather than left as a caution.
- `producedStates` is exported for `check-ingredients.mjs`, which asks the same question of object
  records that this asks of slots. Two definitions of "the map produces this" would drift the first
  time either was edited.

## What this does not decide

Whether error correction is a stage or a substrate (ai-ops, open, options A/B/C put to the owner);
whether a locus field is added to citations (ADR-0026, open); and any particular join. This ADR
fixes the *shape* a join must take and the instrument that watches for one appearing. The three
joins ai-ops#64 names are worklist rows under it, not decisions inside it.
