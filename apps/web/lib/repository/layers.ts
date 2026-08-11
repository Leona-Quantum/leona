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
import { estimateTextWidth, LANE_FONT_PX } from "./process-layout.ts";
import { stateSatisfies, validateStateVocabulary, type StateVocabulary } from "./states.ts";
import { validatePairedTheory, validateTheory } from "./theory-marks.ts";
import type { PublicRepositoryCategory, SourceCoverage } from "./types";

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
  /**
   * The name the **map draws** on a line, when the full `label` is too long for
   * one. Optional, and absent on most nodes on purpose.
   *
   * `label` stays the full name everywhere else: the node page, the accessible
   * list beside the figure, and — the load-bearing one — the `<title>` on every
   * drawn shape. So a short form never removes information from the page, it
   * only chooses which of two names the reader sees first. That is what makes
   * this different from the width cap it sits in front of: a cap machine-cuts a
   * sentence mid-word and leaves an ellipsis, and measured over the whole graph
   * a 200px cap does that to 30 names. Authoring a short form cuts nothing.
   *
   * **A short form must be a name a reader of this literature already uses** —
   * LCHS, SABRE, HHL, QSVT, qLDPC, Ross–Selinger. An acronym coined at this desk
   * is a second name for the same thing, which is the duplication rule §2 in the
   * one place the reader cannot check it against the source. When no honest
   * short form exists, leave the field absent and let the label stay long.
   *
   * **A capability keeps its verb.** Capability labels are contracts, not topic
   * tags (see `whyALayer`), so a short form for one may compress the object but
   * must not collapse to the id.
   *
   * Both locales or neither — see `validateLayerGraph`. A short EN form with no
   * JA twin draws two different pictures in the two locales, and this project's
   * standing rule is that a UI change is not verified until it has been rendered
   * in `ja`.
   */
  shortLabel?: string;
  shortLabelJa?: string;
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
   * The refined method's name, shortened — `Koopman`, `Taylor`, `LCHS`,
   * `SABRE`.
   *
   * ## What it is for, now that the canvas no longer draws it
   *
   * The map drew `LightSABRE ⊂ SABRE` until W13; a refinement now nests under
   * its parent inside a bracket, and adjacency says the relation without
   * repeating the name. The mark stays authored because it is the hand-copied
   * name that keeps `refines` *verifiable*: validation requires this string to
   * occur in the parent's own `label` or `shortLabel` for the same locale, so
   * a rename can shorten the mark's meaning but can never leave it pointing at
   * a method that no longer exists under that name. Required in both locales
   * whenever `refines` is set, absent whenever it is not.
   */
  refinesMark?: string;
  refinesMarkJa?: string;
  /**
   * Present only with `refines`, and only when this refinement records **no
   * map-representable internal difference** from its parent — same steps, same
   * bypasses, a `via` that adds nothing the parent's does not.
   *
   * The owner's s121 ruling: *"until there is actually a difference that we
   * can represent in the map itself for the user, the refinement can exist
   * within the broader card with a short explanation, and be recorded as
   * potential for new paths."* A folded refinement draws no lane of its own;
   * it lives as an entry in its parent card's Refinements section. Its node
   * stays — page, URL, citations, mathematics all survive — only the lane goes.
   *
   * Declared rather than derived, because field equality cannot tell "the same
   * construction re-analysed" (Krovi, the improved kernel) from "a different
   * construction that happens to be atomic" (the two Koopman lifts, which the
   * owner ruled keep their lanes in s103). What CAN be checked is checked:
   * validation refuses the flag when the chain facts differ, so it cannot
   * assert what the fields refute.
   */
  sameInternalsAsParent?: true;
  /**
   * Required with `sameInternalsAsParent`, absent otherwise: what granular
   * research would give this refinement drawable internals of its own — the
   * owner's "recorded as potential for new paths". A statement about the MAP's
   * backlog, never a claim about the paper; the paper's own content stays in
   * the node's ordinary fields.
   */
  potentialPath?: string;
  potentialPathJa?: string;
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
   * Step id → the method this route actually uses to fill it.
   *
   * The owner's session-94 note: *"processes are labeled by what they actually
   * are (such as a specific algorithm)"*. Measured before building this, every
   * one of the graph's 55 step instances lands on a slot that several methods
   * compete for, so the map could only ever name the **slot** on a hop — which is
   * why four routes out of `nonlinear-ode-solve` all drew "Embed a nonlinear
   * system into a linear one" as their first segment, a string that says nothing
   * the two circles do not already say.
   *
   * A rename could not fix that, because there is nothing to rename: the four
   * routes share one slot node. What was missing is the fact itself — Liu et al.'s
   * route uses **Carleman** linearization, not "some embedding" — and a label is
   * only allowed to say so once the graph does.
   *
   * **Only where a primary source pins it.** Absent is the common and correct
   * case: `carleman-euler-qls-route` names no particular quantum linear solver
   * and must keep drawing the slot there. This is the same standard `through`
   * holds to — read off contract prose that already exists, never inferred to
   * make a picture read better.
   *
   * Narrowing only, and checked: the value must be a method that realises the
   * step it is filed under, so this can name one of the ways through a slot and
   * can never introduce a way that is not recorded.
   */
  via?: Readonly<Record<string, string>>;
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
  /**
   * Step id → the fact that this route runs that step **many times**, and what
   * the turn costs.
   *
   * > *"iteration loop type algorithms, like vqe and some integrators, which run
   * > iteratively over several states/processes. eg backwards euler does, while
   * > folded euler bypasses for this reason. and so backwards euler also requires
   * > more readouts and such."*
   * > — owner, session-98 inbox
   *
   * ## Why this could not be read off the graph already
   *
   * `steps` is a **set**, and validation rejects a repeat inside it, so the only
   * thing the structure could ever say was *whether* a route meets a slot — never
   * how often. Two methods that look identical on the map are then charged
   * wildly different amounts: `qsvt-matrix-inversion` prepares its right-hand
   * side **once**; `direct-sampling-readout` prepares the same state
   * **O(1/ε²) times**, and `hhl-qpe-inversion` **O(κ) times**. All three drew one
   * line to one circle.
   *
   * That difference is not a constant factor and it is not decoration: it is the
   * reason the published encodings fold. `time-marching-usva`'s own recorded
   * prose is the clearest statement of it in this file — the success probability
   * decays *exponentially* in the number of steps, and the method exists to buy
   * that back with an amplification at **every** turn.
   *
   * ## Why it is an edge annotation and not a field on the method
   *
   * A method does not "iterate" — it iterates *something*. `direct-sampling-readout`
   * repeats `state-preparation` and nothing else; `time-marching-usva` repeats
   * `time-discretization` and not the solve it explicitly bypasses. A boolean
   * on the node would say a route loops and leave a reader to guess which of its
   * steps is inside the loop, which on a three-step method is a three-way guess
   * about where the whole cost lives. Same shape and same argument as `through`
   * and `via`: the fact belongs to the hop, so it is keyed by the hop.
   *
   * **Only where a source states it, and absent is the common and correct case.**
   * Absent means "no source we read said this step runs more than once" — never
   * "it runs once". Nothing is derived here: a plausible loop is exactly the kind
   * of sentence §3.6 forbids inventing.
   */
  repeats?: Readonly<Record<string, StepRepetition>>;
  /**
   * Hop → the mathematics of that hop, and what it approximates and assumes.
   *
   * ## Why the hop and not the method
   *
   * The owner asked for the theory *"highlighted along the way"* and, on the
   * two candidate models for approximations and assumptions — prose on the
   * method, or an annotation on a step of the trace — chose the second:
   * *"confirm the second."*
   *
   * That is the same argument `through`, `via` and `repeats` already make, and
   * it is not a stylistic one. **A method does not approximate; it approximates
   * something.** `schrodingerisation` makes its approximation in the warped
   * phase transformation and none in the Hamiltonian simulation that follows;
   * a field on the node would say the route approximates and leave a reader to
   * guess which of three hops paid for it — a three-way guess about where the
   * error lives, on the field whose whole purpose is to say where the error
   * lives.
   *
   * ## The key
   *
   * A **capability id** for a hop a named slot covers, exactly as `repeats` and
   * `via` are keyed. For the stretch a method closes itself — `routeOf`'s
   * trailing segment, which 57 of the 63 methods carry — the key is the
   * **method's own id**. That is unambiguous rather than a convention: node ids
   * are unique across the whole graph, so a method id can never also be a
   * capability id, and validation checks that a key is one or the other.
   *
   * A sentinel like `"self"` was the alternative and is worse for the reason
   * every sentinel is: it means something only where something scopes it, and
   * nothing here would stop a capability being authored with that id.
   *
   * ## Only where a source states it
   *
   * Absent is the common and correct case, and absent means *no source we read
   * stated one* — never *there is no approximation here*. Nothing is derived: an
   * approximation a reader would plausibly expect at a hop is exactly the kind
   * of sentence the map is forbidden to invent.
   */
  hops?: Readonly<Record<string, HopNote>>;
  /**
   * A worked example of running this method, and the pseudocode for it.
   *
   * The owner's seventh section, and the one he was pushed back on: across 63
   * methods it is the largest content commitment on his list. His answer took
   * the recommendation — *"build the field for all, populate on demand, and let
   * the card say 'none written yet' for the rest rather than pretend"* — and
   * added the part that makes it tractable: *"although i will say pseudo code
   * could definitely be easy enough as a first pass."*
   *
   * So `pseudocode` is here beside the prose rather than inside it, because it
   * is the half that can be written from the method's own recorded contract and
   * step list, while `text` needs a run somebody actually did. A card can hold
   * one without the other, and conflating them into one prose field would make
   * "we have the easy half" unsayable.
   */
  example?: MethodExample;
  /**
   * Every implementation of this method, with the paper as an attribute of the
   * entry rather than the other way round.
   *
   * ## The two sketches were different trees, and this is the one he chose
   *
   * Session 109 was *per paper*, with independently-derived and non-paper runs
   * as siblings. Session 113 was *per implementation*, each with sub-sections.
   * They are not the same shape: **one paper can hold two implementations and
   * one implementation can be described by two papers**, so a tree rooted at
   * papers cannot express either case without duplicating a node.
   *
   * Rooted at the implementation, `papers` becomes an ordinary field with zero,
   * one or many values — and the three branches he first wrote out ("per
   * paper", "independently derived from what a paper described", "not from a
   * paper but proven to be run") stop being three branches and become three
   * values of one field. He was shown that tree and said *"yes."*
   *
   * ## Absent is not zero
   *
   * Absent means nobody has written this method's implementations down. It does
   * **not** mean none exist, and the card must not say so — the paper register
   * already records, per paper and from its abstract, whether it reports
   * numerics or a hardware run, and 25 of the 63 methods cite a paper that
   * reports simulation. So an empty section here has a worklist behind it, not
   * a verdict.
   */
  implementations?: readonly MethodImplementation[];
}

/**
 * What a source says about one hop of a route.
 *
 * Every field optional, and at least one required — a note that says nothing is
 * a key with no fact behind it, and `validateLayerGraph` rejects it. Each is a
 * pair or neither, like every other prose field on this type: one locale alone
 * renders as a hole for half the readers.
 *
 * **It was three fields and is now one, on the owner's re-decision.** Session
 * 114 carried `approximations` and `assumptions` beside `theory` and the card
 * drew them as three stacked headings inside every opened hop. He read it and
 * answered: *"assumptions and approximations will be colored/bolded
 * highlighted/commented within the mathematics, so no need for the sections.
 * this is probably going to be bulky, so too many sections here can make it hard
 * to follow."*
 *
 * So the two live inside the mathematics as marks — `[[approximation: …]]` and
 * `[[assumption: …]]` — and `theory-marks.ts` states the argument for why that
 * is a better content model and not only a smaller drawing. Nothing was lost in
 * the change: all 91 hops were unauthored, so no note anywhere held either
 * field.
 */
export interface HopNote {
  /**
   * The mathematics of the hop, as the source states it, with the approximations
   * it makes and the assumptions it needs marked where they occur. See
   * `theory-marks.ts` for the syntax and the three ways it can be malformed.
   */
  theory?: string;
  theoryJa?: string;
}

/** A worked example, its pseudocode, or both. See `LayerMethod.example`. */
export interface MethodExample {
  /** Prose: an example of running it. Absent when nobody has written one. */
  text?: string;
  textJa?: string;
  /**
   * Pseudocode, as a plain block. **Not localised, and that is deliberate.**
   * The identifiers are the record's own symbols and the keywords are the
   * language's; translating either would produce a second listing that has to
   * be kept in step with the first and would drift. Comments inside it are the
   * part a reader needs in their own language, and those belong in `text`.
   */
  pseudocode?: string;
}

/**
 * One implementation of a method. See `LayerMethod.implementations`.
 *
 * The five sub-sections are the owner's, verbatim from the tree he approved:
 * About (where it came from and the problem statement), Methods (what was
 * actually done), Data (inputs and their provenance), Code (the artefact) and
 * Results (what came out, with the hardware or simulator named).
 *
 * `id` and the two labels are required; everything else is absent until
 * somebody reads the source. An entry with a name and nothing else is still
 * worth having — it says an implementation exists and nobody has written it up,
 * which is a different fact from silence.
 */
export interface MethodImplementation {
  /** Unique within this method. Kebab-case, like every other id here. */
  id: string;
  label: string;
  labelJa: string;
  /**
   * The papers describing it: **zero, one or many.** Zero is a real value — his
   * *"other implementations that aren't papers but proven to be run"*. Every
   * url here must resolve in the paper register, like any other citation.
   */
  papers?: readonly LayerCitation[];
  about?: string;
  aboutJa?: string;
  methods?: string;
  methodsJa?: string;
  data?: string;
  dataJa?: string;
  code?: string;
  codeJa?: string;
  results?: string;
  resultsJa?: string;
}

/**
 * How a loop closes — and this is the field the owner's *"requires more
 * readouts"* lives in.
 *
 * - `coherent` — the turn's output stays a quantum state and feeds the next
 *   turn. Nothing is **measured**, so the state is never collapsed and restarted
 *   from classical data; the price is paid in depth and in success probability,
 *   which multiplies down the chain. This is `time-marching-usva`, which buys the
 *   decay back with an amplification per step, and `amplitude-estimation-readout`,
 *   whose iteration is *M* applications of one Grover operator.
 *
 *   **Coherent does not mean the preparation runs once.** HHL prepares |b⟩ afresh
 *   inside every one of its O(κ) amplification rounds and amplitude estimation
 *   runs *A* forwards and backwards on every iteration — both are recorded here
 *   as repeating `state-preparation`, coherently. What a coherent loop never pays
 *   is a *readout*. Saying otherwise would contradict two of this graph's own
 *   annotations, which is how it was caught.
 * - `measured` — the turn's output leaves the device as classical data, so every
 *   turn is a fresh preparation **and** a fresh readout. This is shot-based
 *   estimation, and it is the loop a variational optimizer closes.
 *
 * The two are not gradations of one thing. A coherent loop's cost is a *depth* a
 * device may simply not have; a measured loop's cost is a *count* that a device
 * can always pay and a schedule may not be able to afford. Collapsing them into
 * "it repeats" loses the only part a reader is deciding on.
 */
export type LoopClosure = "coherent" | "measured";

export const LOOP_CLOSURES = ["coherent", "measured"] as const;

/**
 * One repeated step, as a source states it.
 *
 * `count` is **symbolic and quoted**, never a number this file worked out: "one
 * per time step", "O(1/ε²) shots", "M = O(1/ε)". A concrete integer would be a
 * claim about a problem instance, and the map does not have one — it has a
 * scheme. `validateLayerGraph` rejects a `count` of `"1"` for the same reason it
 * rejects an empty `through`: a loop that turns once is not a loop, and recording
 * it as one would put an iteration badge on the folded encodings that exist
 * precisely to avoid it.
 */
export interface StepRepetition {
  count: string;
  countJa: string;
  closure: LoopClosure;
  /** What the turn costs and why it turns that many times, read off the source. */
  note: string;
  noteJa: string;
  /**
   * The count as a **mark on the drawing**: `×T/h`, `×O(κ)`, `×m`.
   *
   * ## Why this is a field and not `count` shortened by code
   *
   * `count` is a sentence — *"once per time step — T/h of them to reach time
   * T"* — and a lane's name on the canvas has a pixel budget of 300. Something
   * has to choose which part of that sentence is the number, and only a person
   * reading the source can: the symbol in `count` is sometimes at the front
   * (`m = O(…)`), sometimes at the back (`M = O(1/ε)`), and once nowhere at all
   * (`time-marching-usva` says *per step* and names no letter). A regex over the
   * prose would produce a different answer for each of those and be wrong
   * silently, on the canvas, where nothing checks it.
   *
   * So it is authored beside the sentence it abbreviates, and validation keeps
   * it a mark rather than a second description: at most `REPEAT_MARK_MAX`
   * characters, which is the width the layout reserves for it.
   *
   * ## Both locales, and usually identical
   *
   * `×T/h` is `×T/h` in Japanese — mathematics is not translated, and the two
   * fields exist for the one case that needs a word (*per step*), not because
   * the symbol changes. Same reason `MethodExample.pseudocode` is not localised.
   */
  mark: string;
  markJa: string;
}

/**
 * How long a repeat mark may be, in characters.
 *
 * A budget rather than a taste: the mark is appended to a lane's name on the
 * canvas and the name's own budget shrinks by exactly the mark's width, so a
 * long mark is paid for by truncating the name it annotates. Twelve characters
 * is the widest authored mark (`×O(1/ε²)` is eight) plus room, and it is small
 * enough that a sentence cannot be written here by accident.
 */
export const REPEAT_MARK_MAX = 12;

/**
 * How long a refinement mark may be, in characters — the name only.
 *
 * The canvas no longer draws the mark at all (W13: a refinement nests under
 * its parent inside a bracket, and adjacency says what the `⊂ <mark>` suffix
 * used to), but the mark stays authored and stays bounded: it is the
 * hand-copied name that keeps `refines` verifiable against the parent's own
 * label, and card surfaces may still print it. Ten characters fits every
 * parent's drawn short name in both locales with room, and refuses a mark
 * that would restate the parent's whole title.
 */
export const REFINES_MARK_MAX = 10;

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

/** The repetition recorded for one hop, or `null` where none is. */
export function repetitionOf(method: LayerMethod, stepId: string): StepRepetition | null {
  return method.repeats?.[stepId] ?? null;
}

/** Every repeated hop of a method, in the order its steps are met. */
export function repeatedSteps(
  method: LayerMethod,
): Array<{ stepId: string; repetition: StepRepetition }> {
  const repeats = method.repeats;
  if (!repeats) return [];
  return method.steps
    .filter((stepId) => repeats[stepId] !== undefined)
    .map((stepId) => ({ stepId, repetition: repeats[stepId]! }));
}

/**
 * Which routes into a slot declare that they run it many times, and which
 * declare nothing.
 *
 * This is the comparison the owner asked the map to be able to draw, and it is
 * only answerable across a whole slot: "folded" is not a property of
 * `taylor-all-at-once`, it is what `taylor-all-at-once` is *relative to*
 * `time-marching-usva`. A reader standing on `time-discretization` should be able
 * to see that one route pays it once per time step and another assembles the
 * whole trajectory and pays once, because that is the single largest cost
 * difference on the layer.
 *
 * **`unpinned` is not "folded", and the name is deliberate.** A route with no
 * `repeats` entry has recorded no multiplicity; it has not claimed to meet the
 * slot exactly once. Calling that list `folded` would manufacture a claim per
 * member — the failure `via` already has, where 50 of 55 hops name no method and
 * a picture could easily imply they name one. The caller says "declares no
 * multiplicity"; nothing here says "once".
 *
 * Returns two empty arrays when nothing repeats this slot, so the contrast is
 * only ever drawn where there is a contrast, and a slot no route has measured
 * never claims a virtue nobody is competing for.
 */
export function foldedAgainst(
  graph: LayerGraph,
  capabilityId: string,
): {
  unpinned: LayerMethod[];
  repeated: Array<{ method: LayerMethod; repetition: StepRepetition }>;
} {
  const unpinned: LayerMethod[] = [];
  const repeated: Array<{ method: LayerMethod; repetition: StepRepetition }> = [];
  for (const node of graph.nodes) {
    if (!isMethod(node) || !node.steps.includes(capabilityId)) continue;
    const repetition = repetitionOf(node, capabilityId);
    if (repetition) repeated.push({ method: node, repetition });
    else unpinned.push(node);
  }
  return repeated.length === 0 ? { unpinned: [], repeated: [] } : { unpinned, repeated };
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
 * A slot's methods with each refinement grouped under the method it narrows.
 *
 * The shape every drawing of a fan reads (W13): a refinement is not another
 * way through the slot, it is a narrower version of one of the ways, so the
 * fan draws it nested under its parent instead of interleaved with the
 * alternatives — `nonlinear-linear-embedding` drew Carleman at bow −135 and
 * the Koopman it narrows at −81, two lanes apart, which is why the `⊂` mark
 * had to repeat the parent's name at all.
 *
 * **A partition of `methodsRealizing`, and the chain case is why the walk
 * exists.** `refines` may name a method that itself refines a third
 * (validation permits it; today's corpus has none), and attaching a variant to
 * its direct parent would drop it the moment that parent stopped being top
 * level. So a variant attaches to its top-level ancestor: every method appears
 * exactly once, as a group or inside one, whatever the depth of the chain.
 * The test file asserts the partition rather than trusting this sentence.
 */
export interface MethodFanGroup {
  method: LayerMethod;
  /** Members of the same fan that narrow `method` AND draw a lane, in graph order. */
  variants: readonly LayerMethod[];
  /**
   * Members that narrow `method` and are **folded** (`sameInternalsAsParent`):
   * no lane on any fan — they live as entries in the parent card's Refinements
   * section (owner's s121 ruling), and their own pages keep drawing their own
   * routes. Kept in the group rather than dropped so the partition invariant
   * survives: every method realizing the slot appears exactly once across
   * `method` ∪ `variants` ∪ `folded`.
   */
  folded: readonly LayerMethod[];
}

/**
 * `unfold` (s121, W17): the one folded member the caller needs drawn anyway —
 * a folded method's OWN page is still about that method, so the page planner
 * unfolds exactly its subject; every other surface passes nothing and the fold
 * holds. An id, not a flag, so a page can never accidentally unfold a sibling.
 */
export function methodFanGroups(
  graph: LayerGraph,
  capabilityId: string,
  unfold?: string,
): MethodFanGroup[] {
  const methods = methodsRealizing(graph, capabilityId);
  const byId = new Map(methods.map((method) => [method.id, method]));
  // The top-level ancestor within this fan. Validation refuses `refines
  // itself` but not a two-cycle, so the walk tracks what it has visited: on a
  // cycle every member answers *itself* and the cycle draws flat — a degraded
  // picture, never a dropped method, because the partition is what "every
  // method's own page draws that method" stands on.
  const topOf = (method: LayerMethod): LayerMethod => {
    let at = method;
    const seen = new Set<string>([at.id]);
    for (;;) {
      const parent = at.refines === undefined ? undefined : byId.get(at.refines);
      if (!parent) return at;
      if (seen.has(parent.id)) return method;
      seen.add(parent.id);
      at = parent;
    }
  };
  const top = methods.filter((method) => topOf(method) === method);
  const drawn = (other: LayerMethod) =>
    other.sameInternalsAsParent !== true || other.id === unfold;
  return top.map((method) => ({
    method,
    variants: methods.filter(
      (other) => other !== method && topOf(other) === method && drawn(other),
    ),
    folded: methods.filter(
      (other) => other !== method && topOf(other) === method && !drawn(other),
    ),
  }));
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

/**
 * One end of an asserted composition: the method, and the edge it takes.
 *
 * `edgeKey` is the key shape `state-graph.ts` walks — a slot id, or
 * `slot@filler` where a route records the hop landing somewhere narrower. It is
 * carried rather than recomputed by the caller because the caller is a lint
 * script and the judge is `pathStanding`, which matches on exactly these strings:
 * a key built two ways is a key that stops matching, and the symptom would be a
 * census reporting every composition as unwitnessed, which is what a
 * genuinely-empty record looks like. `check-layer-graph.mjs` asserts the join by
 * requiring at least one `recorded` — see the reachability rule below.
 */
export interface CompositionEnd {
  method: string;
  edgeKey: string;
}

/**
 * What the literature record says about one asserted composition.
 *
 * Structurally identical to `PathStanding` in `state-graph.ts`, **and the three
 * words are deliberately the same** so the number this lint prints and the mark
 * the converge surface draws cannot come to mean different things. It is
 * redeclared rather than imported because `state-graph.ts` imports *this* module;
 * importing back would be a cycle. The judge is injected for the same reason.
 */
export type CompositionStanding = "recorded" | "unpinned" | "unpublished";

export type CompositionJudge = (
  arrival: CompositionEnd,
  departure: CompositionEnd,
) => CompositionStanding;

/** One state's in/out table and how the record stands on each way across it. */
export interface StateComposition {
  state: string;
  arrivals: readonly CompositionEnd[];
  departures: readonly CompositionEnd[];
  /** `arrivals × departures` — every way across this circle the graph offers. */
  asserted: number;
  recorded: number;
  unpinned: number;
  unpublished: number;
}

export interface CompositionCensus {
  states: readonly StateComposition[];
  asserted: number;
  recorded: number;
  unpinned: number;
  unpublished: number;
  /**
   * States more than one method arrives at — the ones where the question has
   * teeth, because a shared name is doing the joining rather than a source.
   */
  statesWithSeveralArrivals: number;
}

/**
 * Every method-to-method composition the graph asserts, and how many of them
 * anybody has actually written down.
 *
 * ## Why this is counted rather than checked
 *
 * The rule it would take to *check* these is the one the block above `RouteSegment`
 * says is not expressible. So this does the next honest thing: it makes the size
 * of the unchecked surface a number the lint prints on every run, instead of a
 * figure in a session note that is right on the day it is written and silent
 * every day after.
 *
 * ## What counts as an arrival, and the case that shows why it is not obvious
 *
 * A method arrives at the state its **effective** contract returns — every method
 * here inherits its slot's contract — measured 2026-08-09, **not one** carries a
 * contract of its own — so every arrival on the map is asserted by a slot rather
 * than claimed by the method that fills it. The exception is a
 * `through` narrowing, and there the arriving *process* is the method **filling**
 * the narrowed step, not the route that recorded the narrowing: `kvn-simulation-route`
 * writes down that the hop lands on `hermitian-generator`, but the thing that
 * lands there is `koopman-von-neumann-lift`. Reading the route as the arrival
 * would put a whole nonlinear-ODE route on a circle it merely passes through.
 *
 * A departure is a method whose contract takes this state, **or takes something
 * broader** — `stateSatisfies` says a narrower object is accepted where a broader
 * one is asked for, and that is precisely how a state with one arrival can still
 * offer seventeen ways out.
 *
 * Self-pairs are kept. A method that both produces a state and accepts it (three
 * of the block-encoding constructions do, because `block-encoding` specialises
 * `matrix-access`) is a composition the graph is genuinely asserting, and dropping
 * it would make the printed total smaller than the surface a reader can click.
 */
export function stateCompositionCensus(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  judge: CompositionJudge,
): CompositionCensus {
  const methods = graph.nodes.filter(isMethod);
  const effective = (method: LayerMethod): LayerContract | null =>
    contractFor(graph, method)?.contract ?? null;

  const states: StateComposition[] = [];
  let asserted = 0;
  let recorded = 0;
  let unpinned = 0;
  let unpublished = 0;
  let statesWithSeveralArrivals = 0;

  for (const state of vocabulary.states) {
    const arrivals: CompositionEnd[] = [];
    const seenArrival = new Set<string>();
    // Deduped on the **method**, not on the way it was reached — the guard
    // `crossingsAt` had to grow after `linear-ivp` reported forty crossings and
    // listed one of them twice. A filler can reach a circle both by its slot's
    // contract and by a route's narrowing, and that is one process arriving.
    const addArrival = (method: string, edgeKey: string) => {
      if (seenArrival.has(method)) return;
      seenArrival.add(method);
      arrivals.push({ method, edgeKey });
    };
    for (const method of methods) {
      if (effective(method)?.to === state.id) addArrival(method.id, method.realizes);
    }
    for (const method of methods) {
      for (const [stepId, landing] of Object.entries(method.through ?? {})) {
        if (landing !== state.id) continue;
        // Same fallback `walkedEdgeKeys` uses: an unpinned narrowing is the
        // recording route's own claim, so the route is the process there.
        const filler = method.via?.[stepId] ?? method.id;
        const node = layerNode(graph, filler);
        if (node && isMethod(node)) addArrival(filler, `${stepId}@${filler}`);
      }
    }

    const departures: CompositionEnd[] = [];
    const seenDeparture = new Set<string>();
    for (const method of methods) {
      const from = effective(method)?.from;
      if (from === undefined) continue;
      if (from !== state.id && !stateSatisfies(vocabulary, state.id, from)) continue;
      if (seenDeparture.has(method.id)) continue;
      seenDeparture.add(method.id);
      departures.push({ method: method.id, edgeKey: method.realizes });
    }

    const here = { recorded: 0, unpinned: 0, unpublished: 0 };
    for (const arrival of arrivals) {
      for (const departure of departures) here[judge(arrival, departure)] += 1;
    }
    if (arrivals.length > 1) statesWithSeveralArrivals += 1;
    asserted += arrivals.length * departures.length;
    recorded += here.recorded;
    unpinned += here.unpinned;
    unpublished += here.unpublished;
    states.push({
      state: state.id,
      arrivals,
      departures,
      asserted: arrivals.length * departures.length,
      ...here,
    });
  }

  return { states, asserted, recorded, unpinned, unpublished, statesWithSeveralArrivals };
}

/**
 * What a real check of the owner's session-91 rule would need, and why the model
 * cannot express it yet.
 *
 * > *"we just have to make sure that the state it resides in actually matches the
 * > processes that can go in and out of it… if something arrives that can't use
 * > all of the same processes that go out of the state, it should be a new state
 * > with only those processes."*
 * > — owner
 *
 * That is a **restriction** relation: an arrival may bring *fewer* exits with it
 * than the state advertises, and where it does, the state has to split. Nothing in
 * this file or in `states.ts` can say so. `specializes` (`states.ts`:92) is the
 * only relation between states and it runs the other way by construction —
 * `stateSatisfies` reads `a specializes b` as *"anything consuming a b accepts an
 * a"*, so a narrowing can only ever **add** exits (a Hermitian generator is
 * accepted everywhere a linear one is, plus by every simulator). There is no way
 * to write "and it loses this one", and inverting `specializes` to fake it would
 * break the composition check that the whole vocabulary exists to run.
 *
 * The missing field is on the **arrival**, not on the state: a process landing on
 * a state would have to name the exits it does *not* license, or the graph would
 * have to carry the composition as an edge in its own right instead of deriving
 * it from two contracts meeting at a shared name. Either is a data-model change
 * with an authoring pass behind it, so nothing here pretends to check it.
 *
 * ## The worked example, which is already in the file
 *
 * `koopman-von-neumann-lift` has **two recorded landings and they disagree**. Its
 * own slot, `nonlinear-linear-embedding`, promises `linear-ivp`, so by contract it
 * lands exactly where `carleman-linearization` lands. But `kvn-simulation-route`
 * — the route that *calls* it — records `through: { "nonlinear-linear-embedding":
 * "hermitian-generator" }`, because a simulator can only be handed the lift's
 * output if it is Hermitian. So which state the KvN lift arrives at depends on who
 * called it, and only one caller says.
 *
 * That is not a bookkeeping detail. Every exit `linear-ivp` advertises is offered
 * to the KvN lift by the contract alone, and the census below counts each of those
 * offers as an asserted composition. Whether a KvN phase-space density can in fact
 * be handed to a time discretisation and then to a linear solver is a question no
 * source in this graph answers — and the ones nobody answers are the majority.
 * `check-layer-graph.mjs` prints the tally per state rather than a sentence here,
 * on the standing rule that a number written into prose is silent when it drifts.
 */

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
 * Every node id the Atlas has a record for, given the corpus that actually
 * loaded.
 *
 * The owner's session-94 brief: *"specific algorithms that exist in the
 * repository surface can be highlighted too perhaps. this allows user to
 * understand how atlas has everything about specific algorithms, while this map
 * has everything including how they fit in."*
 *
 * Resolved against the live corpus rather than read off `entries` directly, and
 * that is the whole point of the function: `getRepositoryListEntries` can fall
 * back to the static corpus or come up short, and a mark promising a record that
 * is not there is worse than no mark. Fifteen of the graph's seventy-six nodes
 * carry a cross-link today — the mark is meant to be sparse, because the honest
 * claim is that the Atlas documents a *few* of these in depth.
 */
export function nodesWithEntries(graph: LayerGraph, corpus: ReadonlySet<string>): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (entriesFor(node, corpus).length > 0) ids.add(node.id);
  }
  return ids;
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
  /**
   * Hops recorded as running many times, and how those loops close.
   *
   * Counted rather than left implicit for the reason every other count in here
   * is: a route that stops declaring its loop looks exactly like a route that
   * never had one, and the difference is the dominant cost term. `iteratedSteps`
   * counts hops, not methods — one method may repeat two different slots.
   */
  iteratedSteps: number;
  /** Of those, the ones whose turn ends in a measurement and a fresh preparation. */
  measuredLoops: number;
  /** Of those, the ones whose turn stays in superposition and pays in depth. */
  coherentLoops: number;
  /**
   * Slots where some route declares a multiplicity **and another declares none**
   * — the figure the capability page actually draws.
   *
   * Was `foldedSlots`, counted as "any route repeats it", and both the name and
   * the count overclaimed: a slot every route repeats has no contrast to draw,
   * and no route here "meets it exactly once" — the second list records nothing
   * at all (see `foldedAgainst`). The renderer already guarded both halves; the
   * number did not, so the census could report a comparison the page would not
   * print.
   */
  contrastedSlots: number;
  /**
   * Every hop in the graph — the denominator `iteratedSteps` is a numerator of.
   *
   * Carried because `repeats` has the failure mode `via` has and `entries` has:
   * **absent means nobody recorded it, and it renders identically to "meets this
   * slot once".** A reader who cannot see that 9 of 55 hops carry a multiplicity
   * will read the other 46 as folded, which is a claim the graph is not making
   * about any of them. One number turns that from an implication into a
   * statement.
   */
  stepInstances: number;
  /**
   * Methods carrying pseudocode, a worked example in prose, and implementations.
   *
   * **Three numbers rather than one, because they are three different kinds of
   * gap and only one of them is ours to close from the desk.** The schema on
   * `MethodExample` already draws the line: `pseudocode` "can be written from
   * the method's own recorded contract and step list", `text` "needs a run
   * somebody actually did", and `implementations` needs somebody to read a
   * source. Collapsing them into one "cards filled" figure would let the
   * transcribable half stand in for the half that needs a paper, which is the
   * substitution the honesty taxonomy exists to prevent.
   *
   * Counted for the reason `stepInstances` is counted: absent renders as
   * "nothing written yet" on the card, and until something prints the fraction
   * nobody can tell a corpus where one method in sixty-three carries pseudocode
   * from one where most do. That was the state this census was added in — 1 of
   * 63 — and `NEXT.md` had been describing it as "0 of 29 methods" against a
   * denominator that was never the method count.
   */
  withPseudocode: number;
  /** Methods carrying `example.text` — a run somebody actually did. */
  withExampleText: number;
  /** Methods carrying at least one written-up implementation. */
  withImplementations: number;
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
  const repetitions = methods.flatMap((method) => repeatedSteps(method));
  const contrastedSlots = capabilities.filter((node) => {
    const { unpinned, repeated } = foldedAgainst(graph, node.id);
    return repeated.length > 0 && unpinned.length > 0;
  }).length;
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
    iteratedSteps: repetitions.length,
    measuredLoops: repetitions.filter(({ repetition }) => repetition.closure === "measured").length,
    coherentLoops: repetitions.filter(({ repetition }) => repetition.closure === "coherent").length,
    contrastedSlots,
    stepInstances: methods.reduce((total, method) => total + method.steps.length, 0),
    // Trimmed before counting for the same reason `validateLayerGraph` rejects
    // an empty `pseudocode`: a whitespace-only field is authored-looking and
    // says nothing, and a census that counted it would report progress that no
    // reader can see on the card.
    withPseudocode: methods.filter((node) => (node.example?.pseudocode ?? "").trim() !== "").length,
    withExampleText: methods.filter((node) => (node.example?.text ?? "").trim() !== "").length,
    withImplementations: methods.filter((node) => (node.implementations ?? []).length > 0).length,
  };
}

// ---------------------------------------------------------------------------
// Region closure
//
// > *"make sure everything is completely closed and perfectly implemented for
// > linear ODE so it can be scaled, making sure it is easily reproducible using
// > our first principles… this means it is scalable to other things without
// > major problems."*
// > — owner, 2026-08-11 inbox
//
// `layerCensus` counts the **whole graph**, and every number it prints is a
// total. That is the right shape for "how much of the atlas is written" and the
// wrong shape for the question above, which is asked of one region at a time:
// a region can be finished while the graph's totals barely move, and the totals
// cannot tell anyone which region moved them.
//
// ## Why the answer is a table and not a percentage
//
// The tempting summary is one number — "linear ODE is 78% closed". It would be
// wrong in a way that matters, because **the fields are not the same kind of
// gap**, and `MethodExample`'s own doc comment already draws the line this
// splits on:
//
// - `pseudocode` "can be written from the method's own recorded contract and
//   step list" — closable at this desk, today, with no new information;
// - a hop's `theory` needs the cited source read, but the source is already
//   named on the record, so the work is bounded and known;
// - `text` "needs a run somebody actually did" and `implementations` needs one
//   too — **and if no cited paper reports a run, no amount of work closes
//   them.** An empty section there is the correct and final answer.
//
// Averaging those together lets the transcribable half stand in for the half
// that needs a laboratory, which is the substitution the honesty taxonomy on
// `LayerCensus.withPseudocode` exists to prevent. So this returns each field's
// own fraction and each field's own missing list, and no combined figure exists
// to be quoted.
//
// ## The part that makes "closed" checkable rather than claimed
//
// For `text` and `implementations` the register already knows whether there is
// anything to write up: `PaperRegisterEntry.reports` records, per paper, whether
// it reports simulation or hardware. So an absence on a method can be
// **classified** rather than merely counted, on the register's own three-valued
// rule:
//
// - `accounted` — every cited paper reports `absent` on both axes. Nobody ran
//   anything; the empty section is the truth and closing it is not work.
// - `outstanding` — some cited paper reports a run. There is something to write
//   up and this is a worklist item.
// - `unread` — some cited paper says `unknown`, or carries no `reports` row at
//   all. **The account itself does not exist yet**, and the next action is to
//   read that paper's full text, not to write an example.
//
// The three-valued shape is not decoration: `papers.ts` forces `simulation` to
// `unknown` on an abstract read precisely because numerics hide below the
// abstract, so a two-valued version of this would report "nothing to write up"
// for every method in the graph whose sources were only skimmed. The middle
// value is the common one today and it is the one that names the work.
// ---------------------------------------------------------------------------

/** How one content field stands across a region. */
export interface RegionFieldCoverage {
  /** The field as an author types it — `cost`, `example.pseudocode`. */
  field: string;
  /** Methods carrying it. */
  present: number;
  /** Methods in the region. The denominator, printed rather than implied. */
  total: number;
  /** Which methods do not carry it, in graph order. */
  missing: readonly string[];
}

/**
 * Why a method has no worked run written up — the classification above.
 *
 * Keyed by method id, and only for methods that are actually missing the field:
 * a method that carries one needs no account.
 */
export type RunEvidenceVerdict = "accounted" | "outstanding" | "unread";

/** One route stretch with no hop note on it. See `RegionClosure.unauthoredHops`. */
export interface UnauthoredHop {
  method: string;
  /** The capability id of the hop, or the method's own id for its own stretch. */
  key: string;
}

/**
 * A region, measured. See the block above for why there is no single number.
 */
export interface RegionClosure {
  /** The slots asked for, in the order given, minus any that name nothing. */
  capabilities: readonly string[];
  /** Ids that named no capability in this graph — a typo, printed rather than ignored. */
  unknown: readonly string[];
  /** Every method realising one of those slots, in graph order. */
  methods: readonly string[];
  fields: readonly RegionFieldCoverage[];
  /**
   * Every stretch of every route in the region, and how many carry a hop note.
   *
   * **Stretches, not methods.** A method with one authored hop out of five reads
   * as "has hops" on any per-method count, and that is exactly the region that
   * looks finished and is not. `hops` is keyed per stretch, so the honest
   * denominator is the stretch.
   */
  hopStretches: number;
  hopStretchesAuthored: number;
  unauthoredHops: readonly UnauthoredHop[];
  /** Per method missing `example.text`, why. Empty when the field is filled. */
  runEvidence: ReadonlyMap<string, RunEvidenceVerdict>;
}

/**
 * Classify one method's missing worked run against the register.
 *
 * `reports` is looked up by the citation's `url`, which is the register's own
 * key rule (`papers.ts`: "every url here must resolve in the paper register").
 * A method with no citations at all comes back `unread` rather than `accounted`
 * — an absence of sources is not evidence that no run exists, it is the absence
 * of the evidence.
 */
function runEvidenceFor(
  method: LayerMethod,
  reports: ReadonlyMap<string, SourceCoverage>,
): RunEvidenceVerdict {
  const citations = method.citations ?? [];
  if (citations.length === 0) return "unread";
  let sawUnknown = false;
  for (const citation of citations) {
    const row = reports.get(citation.url);
    if (!row) {
      sawUnknown = true;
      continue;
    }
    if (row.simulation === "reported" || row.hardware === "reported") return "outstanding";
    if (row.simulation === "unknown" || row.hardware === "unknown") sawUnknown = true;
  }
  return sawUnknown ? "unread" : "accounted";
}

/**
 * Measure a region: the named slots, the methods filling them, field by field.
 *
 * `reports` is passed in rather than imported for the reason `corpus` is on
 * `layerCensus` — this module references the corpus and the register **by
 * identifier only, in one direction**, and importing either would make the
 * graph's schema depend on the data it describes.
 */
export function regionClosure(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  capabilityIds: readonly string[],
  reports: ReadonlyMap<string, SourceCoverage>,
): RegionClosure {
  // De-duplicated first, first-seen order kept. `--closure=solve,solve` is one
  // region, and counting it as two slots is the same failure as the typo below:
  // a slot count that is too high makes the fractions beside it read as a
  // bigger region than was measured. `methods` was already immune (it filters
  // on a Set) and the two would then disagree.
  const requested = [...new Set(capabilityIds)];
  const capabilities = requested.filter((id) =>
    graph.nodes.some((node) => node.id === id && isCapability(node)),
  );
  const unknown = requested.filter((id) => !capabilities.includes(id));
  const wanted = new Set(capabilities);
  const methods = graph.nodes.filter(
    (node): node is LayerMethod => isMethod(node) && wanted.has(node.realizes),
  );

  const filled = (value: string | undefined) => (value ?? "").trim() !== "";
  const measures: readonly { field: string; has: (method: LayerMethod) => boolean }[] = [
    { field: "summary", has: (method) => filled(method.summary) },
    { field: "conditions", has: (method) => filled(method.conditions) },
    { field: "cost", has: (method) => filled(method.cost) },
    { field: "citations", has: (method) => (method.citations ?? []).length > 0 },
    { field: "example.pseudocode", has: (method) => filled(method.example?.pseudocode) },
    { field: "example.text", has: (method) => filled(method.example?.text) },
    { field: "implementations", has: (method) => (method.implementations ?? []).length > 0 },
  ];

  const fields = measures.map(({ field, has }) => ({
    field,
    present: methods.filter(has).length,
    total: methods.length,
    missing: methods.filter((method) => !has(method)).map((method) => method.id),
  }));

  // A route's stretches are every step it lists — whether that step advances the
  // route or feeds it, since both are drawn and both are keyable — plus its own
  // stretch **only where it has one**.
  //
  // The "only where it has one" is the whole reason this walks `routeOf` instead
  // of taking `[...steps, id]` from the schema's key rule. `validateLayerGraph`
  // accepts a method's own id as a key on *any* method, but a route whose
  // delegated steps already reach its slot's output draws no own stretch, so a
  // note keyed there would render nowhere. Counting those as gaps would put
  // stretches on the worklist that no author could ever close and no reader
  // could ever see — a denominator inflated by exactly the routes that are
  // already finished.
  const unauthoredHops: UnauthoredHop[] = [];
  let hopStretches = 0;
  let hopStretchesAuthored = 0;
  for (const method of methods) {
    const route = routeOf(graph, vocabulary, method);
    const ownStretch = route.segments.some((segment) => segment.capabilityId === null);
    for (const key of [...method.steps, ...(ownStretch ? [method.id] : [])]) {
      hopStretches += 1;
      if (method.hops?.[key]) hopStretchesAuthored += 1;
      else unauthoredHops.push({ method: method.id, key });
    }
  }

  const runEvidence = new Map<string, RunEvidenceVerdict>();
  for (const method of methods) {
    if (filled(method.example?.text) && (method.implementations ?? []).length > 0) continue;
    runEvidence.set(method.id, runEvidenceFor(method, reports));
  }

  return {
    capabilities,
    unknown,
    methods: methods.map((method) => method.id),
    fields,
    hopStretches,
    hopStretchesAuthored,
    unauthoredHops,
    runEvidence,
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
export const RESERVED_REPOSITORY_SEGMENTS: readonly string[] = ["layers", "papers"];

// ---------------------------------------------------------------------------
// Coined composite names
//
// > *"Only composite processes without branches on one layer should show the
// > states and subprocesses within, **don't invent composite processes**. for
// > example, integrator+qls should not be one composite process — it should be
// > integrators->state->qls. however, something else like maybe 'lindbladians'
// > could be the name of one composite process… like there is a clear name for
// > the composite process that is its own concept, not one we just made up."*
// > — owner
//
// `converge-layout.ts` already applies this at the **lane** level and says so.
// Nothing applied it to a node **label**, which is where it is actually broken:
// two of the fifty-eight method labels are the route's own step list with plus
// signs between the parts, which is the owner's `integrator+qls` case verbatim.
//
// ## What distinguishes "Clifford+T" from "Carleman + forward Euler + QLS"
//
// A blanket ban on `+` is wrong and would fire on three honest labels — two
// naming the **Clifford+T** gate set and one printing the equation
// `du/dt = A(t)u + b(t)`. Three things separate them, and the rule uses all
// three rather than picking a favourite:
//
// 1. **Only a composite can invent a composite.** The rule is scoped to methods
//    whose route has more than one *advancing* hop — ten of fifty-eight. That
//    alone spares `ross-selinger-synthesis`, which is `atomic`, and
//    `linear-ode-solve`, which is a capability and has no steps at all.
// 2. **A term of art is written closed up; a list is written spaced.**
//    `Clifford+T` is one token naming one gate set. `Carleman + forward Euler +
//    quantum linear solver` is a list with separators, and a spaced joiner in a
//    composite method's label is the arm that fires on today's graph. It also
//    spares `fault-tolerant-compilation`, which *is* composite by hop count and
//    whose `(Clifford+T pipeline)` is closed up.
// 3. **A coined name relists parts the map already draws.** Split on the joiner
//    and the fragments of the two offenders are `carleman-linearization`,
//    `forward-euler`, `quantum-linear-solve`, `koopman-von-neumann-lift`,
//    `hamiltonian-simulation` — nodes of this graph, joined by the very `steps`
//    edges the label is duplicating. Splitting `Clifford+T` yields nothing that
//    names anything. This arm is what stops the obvious evasion of closing the
//    spaces up, and it is the arm that tells a human *why* the name is wrong.
//
// Nothing in this section reaches a page: `conjoinedCompositeNames` is called by
// the validator, the lint script and the tests, and its strings are read by
// whoever broke the build. So they are English only, like every other message
// `validateLayerGraph` returns. The both-locales rule is about what a visitor
// sees, and what a visitor sees here is the **label** — which is exactly the
// thing this rule refuses to let anyone leave half-renamed.
//
// A rename is a **domain** decision — these are terms from the literature and
// this file's standing rule is that an unstated thing stays unstated — so the
// lint never renames. It refuses an unacknowledged one and routes the two that
// exist to the owner through the register below.

/**
 * Splits on every joiner — `+`, `&`, `and` — spaced or closed up.
 *
 * A comma is deliberately not one: `Truncated Taylor propagator, all-at-once
 * encoding` is apposition — one thing described twice — and reading it as a
 * conjunction would flag four honest labels to catch nothing.
 *
 * These two patterns are the only statement of what a joiner is. A list constant
 * beside them would be a second copy of the same predicate, drifting the first
 * time either was edited.
 */
const JOINER_SPLIT = /\s*\+\s*|\s*&\s*|\s+and\s+/i;

/** The same joiners written as a list separator — whitespace on both sides. */
const JOINER_SPACED = /\s\+\s|\s&\s|\s+and\s+/i;

/**
 * Grammatical words only. Nothing domain-bearing is dropped: a stop list holding
 * "method" or "approach" would let `Carleman method + Euler method` match
 * anything, and the whole value of the second arm is that a fragment has to name
 * a concept exactly enough to be that concept.
 */
const NAME_STOPWORDS = new Set([
  "a", "an", "the", "of", "for", "with", "in", "to", "by", "on", "at", "from", "into", "as",
  "its", "and", "or",
]);

function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !NAME_STOPWORDS.has(token));
}

/**
 * Two tokens name the same thing.
 *
 * Prefix-tolerant so `solver` reaches `quantum-linear-solve`, and floored at four
 * characters so a stray `T` from `Clifford+T` cannot prefix-match `time`,
 * `taylor` or `trapezoidal` and turn a gate set into a step list.
 */
function tokenMatches(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

/**
 * The concept a label fragment names, or null.
 *
 * Every content token of the fragment has to land on one candidate, so
 * `Fault-tolerant compilation (Clifford` names nothing — no node carries all of
 * `fault tolerant compilation clifford` — while `quantum linear solver` names
 * `quantum-linear-solve`.
 *
 * **The tightest match wins, and that is not cosmetic.** Several nodes can cover
 * one fragment: `Hamiltonian simulation` is covered by `hamiltonian-simulation`
 * and also by `lchs-route`, whose label reads *"LCHS — linear combination of
 * Hamiltonian simulation"*. Taking the first in graph order reported the wrong
 * node in the error a human is meant to act on — caught by mutating the register
 * away and reading the message — so the candidate carrying the fewest words
 * beyond the fragment wins, and graph order only breaks a tie.
 */
function conceptNamedBy(
  fragment: string,
  candidates: ReadonlyArray<{ id: string; label: string }>,
): string | null {
  const tokens = nameTokens(fragment);
  if (tokens.length === 0) return null;
  let best: { id: string; breadth: number } | null = null;
  for (const candidate of candidates) {
    const pool = new Set([...nameTokens(candidate.id), ...nameTokens(candidate.label)]);
    if (!tokens.every((token) => [...pool].some((other) => tokenMatches(token, other)))) continue;
    if (best === null || pool.size < best.breadth) best = { id: candidate.id, breadth: pool.size };
  }
  return best?.id ?? null;
}

/** A method label that conjoins concepts, with the evidence for saying so. */
export interface ConjoinedName {
  node: string;
  /**
   * Every locale whose label conjoins. Carried because a rename is only done
   * when it is done in **both** — a node renamed in English and left as a plus
   * list in Japanese is the half-fix that renders fine in a screenshot.
   */
  locales: readonly ("en" | "ja")[];
  /** Advancing hops — why this counts as a composite at all. */
  advancing: number;
  /**
   * Fragments that already name another node or state, English only.
   *
   * **English only, and that is a real limit rather than an oversight.** The
   * matcher tokenises on `[a-z0-9]`, so `量子線形ソルバー` yields nothing to match
   * and a Japanese label can only ever trip the spaced-joiner arm. Both authored
   * Japanese labels use a spaced ASCII `+`, so both are caught today; a coined
   * Japanese name written with `・` or `と` would not be, and nothing here
   * pretends otherwise.
   */
  relisted: readonly { fragment: string; concept: string }[];
}

/** Advancing hops — the delegated segments of a method's route. */
export function advancingStepCount(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  method: LayerMethod,
): number {
  return routeOf(graph, vocabulary, method).segments.filter(
    (segment) => segment.capabilityId !== null,
  ).length;
}

/**
 * Every composite method whose label conjoins concepts, in graph order.
 *
 * Total on any input and never throws: it is reached from the validator, which
 * has to be able to report a malformed graph rather than die on it.
 */
export function conjoinedCompositeNames(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
): ConjoinedName[] {
  const found: ConjoinedName[] = [];
  for (const node of graph.nodes) {
    if (!isMethod(node)) continue;
    const advancing = advancingStepCount(graph, vocabulary, node);
    if (advancing <= 1) continue;

    const candidates = [
      ...graph.nodes.filter((other) => other.id !== node.id),
      ...vocabulary.states,
    ];
    // **Every name this node can be DRAWN under**, not just `label`. A
    // `shortLabel` is a name a human authored for the canvas, which makes it
    // exactly the kind of string this rule is about — and the more tempting
    // place to coin one, because the pressure that produces "Carleman + Euler +
    // QLS" is the pressure to fit a lane. Reading only `label` would leave the
    // rule refusing the long name while the short one, the one actually on
    // screen, went unchecked.
    const drawnEn = [node.label, node.shortLabel].filter((name) => name !== undefined);
    const drawnJa = [node.labelJa, node.shortLabelJa].filter((name) => name !== undefined);
    const relisted: { fragment: string; concept: string }[] = [];
    for (const name of drawnEn) {
      for (const fragment of name.split(JOINER_SPLIT)) {
        const concept = conceptNamedBy(fragment, candidates);
        if (concept !== null) relisted.push({ fragment: fragment.trim(), concept });
      }
    }
    const distinct = new Set(relisted.map((entry) => entry.concept));

    const locales = (["en", "ja"] as const).filter((locale) =>
      (locale === "ja" ? drawnJa : drawnEn).some((name) => JOINER_SPACED.test(name)),
    );
    if (locales.length === 0 && distinct.size < 2) continue;
    found.push({ node: node.id, locales, advancing, relisted });
  }
  return found;
}

/**
 * What was decided about a name this rule refuses, and by whom.
 *
 * Two dispositions, and they are not the same claim:
 *
 * - `source-framing` — the compound name is the **paper's**, not ours. It must
 *   name a citation the node already carries, and validation checks the url
 *   resolves there, so the acknowledgement cannot be a sentence somebody typed.
 *   `phrase` is the wording as the source has it; it is not translated, for the
 *   reason `citation.title` is not translated — a quotation rendered into another
 *   language is no longer the thing being quoted.
 * - `awaiting-owner-rename` — the name **is** coined, nobody has renamed it, and
 *   renaming it is a domain call. This is a queue, not an allowlist: the lint
 *   prints every row on every run, and a row whose node has stopped conjoining is
 *   an error, so a rename cannot leave its excuse behind.
 *
 * **Empty, and that is the finished state rather than an unwritten one.** It
 * held two rows for several sessions — `carleman-euler-qls-route` and
 * `kvn-simulation-route`, both coined by conjoining node names, both the owner's
 * "integrator+qls" example. The owner's ruling was that a composite may keep a
 * name only if it is one *"that people or the paper uses"*, and re-reading the
 * primary sources found that both papers do name their own route:
 *
 * - Liu et al. head their §3 *"Quantum Carleman linearization"* and name
 *   Theorem 1 *"Quantum Carleman linearization algorithm"* (arXiv:2011.03185).
 * - Joseph writes *"Quantum simulation of the KvN representation"*
 *   (arXiv:2003.09980, §VI) — so this file's previous claim that his paper "does
 *   not name this pipeline" was false. It is easy to see how: the paper is
 *   two-column, and a naive text extraction interleaves the columns and splits
 *   that phrase across the boundary, so searching for it returns nothing.
 *
 * Both nodes were renamed to the source's own words and both rows deleted, which
 * is the required move rather than a tidy one: a row whose node has stopped
 * conjoining is an **error** by the rule above, so a rename cannot leave its
 * excuse behind. The register stays because the rule that fills it stays.
 */
export interface CompositeNameDisposition {
  node: string;
  disposition: "source-framing" | "awaiting-owner-rename";
  /** Why, for whoever reads the lint output. Developer-facing, so English only. */
  reason: string;
  /** `source-framing` only: a citation url the node carries. */
  citedAs?: string;
  /** `source-framing` only: the compound name as that source writes it. */
  phrase?: string;
}

export const COMPOSITE_NAME_DISPOSITIONS: readonly CompositeNameDisposition[] = [];

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
  /**
   * The name dispositions this graph is checked against.
   *
   * Passed rather than read off `COMPOSITE_NAME_DISPOSITIONS` directly, and
   * required rather than defaulted, for the reason `corpus` and `vocabulary` are:
   * the validator is run against fixtures as much as against the authored graph,
   * and a module constant reaching inside it would report the real register's two
   * rows as unknown ids on every fixture. A caller with no dispositions passes
   * `[]` and says so.
   */
  dispositions: readonly CompositeNameDisposition[],
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

    // A short form is the name the map DRAWS, so everything that is true of a
    // label has to be true of it, plus two things that are only true of it.
    //
    // The pair rule first: a short EN form with no JA twin means the two locales
    // draw different pictures, and the one that is not shortened is the one
    // nobody looks at. Measured before this field existed, JA labels are half
    // the character count of their EN twins but only 1.3x narrower in pixels, so
    // "the Japanese is already short" is not true and is exactly the assumption
    // this catches.
    const shortPresent = node.shortLabel !== undefined;
    const shortJaPresent = node.shortLabelJa !== undefined;
    if (shortPresent !== shortJaPresent) {
      errors.push(
        `${node.id}: ${shortPresent ? "shortLabel" : "shortLabelJa"} is set and ${shortPresent ? "shortLabelJa" : "shortLabel"} is not — a short form must be authored in both locales or neither`,
      );
    }
    for (const [field, short, long] of [
      ["shortLabel", node.shortLabel, node.label],
      ["shortLabelJa", node.shortLabelJa, node.labelJa],
    ] as const) {
      if (short === undefined) continue;
      if (short.trim() === "") {
        errors.push(`${node.id}: ${field} is empty — omit the field rather than setting it to ""`);
        continue;
      }
      if (short === long) {
        errors.push(
          `${node.id}: ${field} is a copy of the full label — that is a second place for one string to drift, not a short form`,
        );
        continue;
      }
      // Narrower in PIXELS, not in characters, and this is the whole reason the
      // check exists rather than being obvious. One CJK code point is 1em and
      // one Latin is 0.53em, so a Japanese short form can drop half its
      // characters and get wider. `laneFont` because that is the size the map
      // actually draws a lane name at; a form that is not narrower there is not
      // doing the job the field exists for.
      if (estimateTextWidth(short, LANE_FONT_PX) >= estimateTextWidth(long, LANE_FONT_PX)) {
        errors.push(
          `${node.id}: ${field} is not narrower than the full label when drawn (${estimateTextWidth(short, LANE_FONT_PX).toFixed(1)}px vs ${estimateTextWidth(long, LANE_FONT_PX).toFixed(1)}px)`,
        );
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

    // --- the three the card had nowhere to put ------------------------------
    //
    // Same two rules every prose field on this type holds to — never `""`, and
    // a pair or neither — applied one level down, where they are easier to
    // break because nothing about a nested object makes a missing twin obvious.
    const pairs = (
      owner: string,
      fields: ReadonlyArray<readonly [string, string | undefined, string | undefined]>,
    ) => {
      for (const [name, en, ja] of fields) {
        if (en !== undefined && en.trim() === "") {
          errors.push(`${node.id}: ${owner}.${name} is present but empty — omit it instead`);
        }
        if (ja !== undefined && ja.trim() === "") {
          errors.push(`${node.id}: ${owner}.${name}Ja is present but empty — omit it instead`);
        }
        if ((en === undefined) !== (ja === undefined)) {
          errors.push(`${node.id}: ${owner}.${name} is present in one locale only`);
        }
      }
    };

    for (const [key, note] of Object.entries(node.hops ?? {})) {
      // The key is a step of this route, or this method itself — the stretch it
      // closes with no named slot. Anything else annotates a hop the reader
      // never sees, which is a note that can never be wrong because it is never
      // read.
      if (key !== node.id && !node.steps.includes(key)) {
        errors.push(
          `${node.id}: hops names ${key}, which is neither one of its steps nor the method itself`,
        );
      }
      pairs(`hops[${key}]`, [["theory", note.theory, note.theoryJa]]);
      // The marks inside the mathematics, checked here rather than trusted to a
      // renderer. A malformed one does not fail loudly at draw time — the
      // parser skips it and the clause renders as prose with literal brackets
      // in it, which reads as a rendering bug and is a data one. `[[` is not a
      // sequence prose reaches for by accident, so this cannot fire on an
      // honest sentence.
      if (note.theory !== undefined) {
        errors.push(...validateTheory(`${node.id}: hops[${key}].theory`, note.theory));
      }
      if (note.theoryJa !== undefined) {
        errors.push(...validateTheory(`${node.id}: hops[${key}].theoryJa`, note.theoryJa));
      }
      // And that the two locales mark the same clauses. A Japanese note that
      // drops the approximation is not a styling difference between two
      // translations; it is half the readers never being told the step makes
      // one.
      if (note.theory !== undefined && note.theoryJa !== undefined) {
        errors.push(
          ...validatePairedTheory(`${node.id}: hops[${key}]`, note.theory, note.theoryJa),
        );
      }
      // A key with no fact behind it. `repeats` rejects the same shape, and for
      // the same reason: it draws a disclosure a reader opens onto nothing.
      //
      // **Every locale counts, not just `en`.** A note carrying only Japanese is
      // malformed — the pair rule above says so — but it is not *empty*, and
      // reporting both errors would tell an author to delete a sentence when
      // what they need to do is write its twin. One defect, one diagnosis.
      if (Object.values(note).every((value) => value === undefined)) {
        errors.push(`${node.id}: hops[${key}] records nothing — omit it instead`);
      }
    }

    if (node.example !== undefined) {
      pairs("example", [["text", node.example.text, node.example.textJa]]);
      if (node.example.pseudocode !== undefined && node.example.pseudocode.trim() === "") {
        errors.push(`${node.id}: example.pseudocode is present but empty — omit it instead`);
      }
      if (node.example.text === undefined && node.example.pseudocode === undefined) {
        errors.push(`${node.id}: example records nothing — omit it instead`);
      }
    }

    const implIds = new Set<string>();
    for (const implementation of node.implementations ?? []) {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(implementation.id)) {
        errors.push(`${node.id}: implementation id is not kebab-case — ${implementation.id}`);
      }
      // Unique within the method, not globally: an implementation is addressed
      // through its method, and two methods may honestly both have a "qiskit"
      // one.
      if (implIds.has(implementation.id)) {
        errors.push(`${node.id}: two implementations share the id ${implementation.id}`);
      }
      implIds.add(implementation.id);
      if (implementation.label.trim() === "" || implementation.labelJa.trim() === "") {
        errors.push(`${node.id}: implementation ${implementation.id} has an empty name`);
      }
      pairs(`implementations[${implementation.id}]`, [
        ["about", implementation.about, implementation.aboutJa],
        ["methods", implementation.methods, implementation.methodsJa],
        ["data", implementation.data, implementation.dataJa],
        ["code", implementation.code, implementation.codeJa],
        ["results", implementation.results, implementation.resultsJa],
      ]);
      // Zero papers is a real value — his "implementations that aren't papers
      // but proven to be run" — so this checks the ones that are there, and
      // never that there are any.
      for (const citation of implementation.papers ?? []) {
        if (!citation.url.startsWith("https://")) {
          errors.push(
            `${node.id}: implementation ${implementation.id} cites a non-https url — ${citation.url}`,
          );
        }
        if (citation.title.trim() === "") {
          errors.push(`${node.id}: implementation ${implementation.id} cites a paper with no title`);
        }
        if (!/^\d{4}$/.test(citation.year)) {
          errors.push(
            `${node.id}: implementation ${implementation.id} cites a paper with a year of ${citation.year}`,
          );
        }
      }
    }
  }

  // --- repetitions ---------------------------------------------------------
  //
  // Checked in its own pass rather than inside the method block above, because
  // two of the five rules compare `repeats` against `steps` and `bypasses` and
  // read better beside each other than threaded through the field walk.
  //
  // The rule that matters most is the last one: **a route may not both skip a
  // layer and run it many times.** That is not a typo-catcher. Skipping and
  // repeating are the two opposite answers to the same question — LCHS removes
  // the linear-solve span, `time-marching-usva` pays its discretization once per
  // step and bypasses the solve outright — and a node
  // asserting both would render as a route that avoids the cost it is charged
  // for, on the one surface whose whole claim is that the costs are honest.
  for (const node of graph.nodes) {
    if (!isMethod(node) || node.repeats === undefined) continue;
    const entries = Object.entries(node.repeats);
    if (entries.length === 0) {
      errors.push(`${node.id}: repeats records nothing — omit it instead`);
    }
    for (const [stepId, repetition] of entries) {
      if (!node.steps.includes(stepId)) {
        errors.push(
          `${node.id}: repeats names ${stepId}, which is not one of its steps — a route can only repeat a hop it takes`,
        );
        continue;
      }
      if ((node.bypasses ?? []).includes(stepId)) {
        errors.push(
          `${node.id}: both bypasses and repeats ${stepId} — a route cannot skip a layer it runs once per turn`,
        );
      }
      for (const [field, value] of [
        ["count", repetition.count],
        ["countJa", repetition.countJa],
        ["note", repetition.note],
        ["noteJa", repetition.noteJa],
        ["mark", repetition.mark],
        ["markJa", repetition.markJa],
      ] as const) {
        if (typeof value !== "string" || value.trim() === "") {
          errors.push(`${node.id}: repeats[${stepId}].${field} is empty`);
        }
      }
      // **The mark is a budget, not a preference.** It is appended to a lane's
      // name on the canvas and the name's own budget shrinks by exactly its
      // width, so a mark written as a sentence is paid for by truncating the
      // name it annotates — on the drawing, where nothing would report it.
      for (const [field, value] of [
        ["mark", repetition.mark],
        ["markJa", repetition.markJa],
      ] as const) {
        if (typeof value === "string" && [...value.trim()].length > REPEAT_MARK_MAX) {
          errors.push(
            `${node.id}: repeats[${stepId}].${field} is ${[...value.trim()].length} characters — a mark on the canvas may be at most ${REPEAT_MARK_MAX}`,
          );
        }
      }
      // A loop that turns once is not a loop. Recording it as one would put the
      // badge on exactly the folded encodings that exist to avoid the loop —
      // `taylor-all-at-once` and `krovi-linear-ode` call the solver once, and
      // that is the fact worth seeing, not a repetition of multiplicity one.
      for (const [field, value] of [
        ["count", repetition.count],
        ["countJa", repetition.countJa],
      ] as const) {
        if (typeof value === "string" && value.trim() === "1") {
          errors.push(
            `${node.id}: repeats[${stepId}].${field} is "1" — a step taken once is not a repetition, omit it`,
          );
        }
      }
      if (!(LOOP_CLOSURES as readonly string[]).includes(repetition.closure)) {
        errors.push(
          `${node.id}: repeats[${stepId}].closure is ${JSON.stringify(repetition.closure)}, not one of ${LOOP_CLOSURES.join(" | ")}`,
        );
      }
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
    // `via` pins which method fills a step. Checked for the same reason `through`
    // is: it puts a **specific algorithm's name** on a hop of this route, and a
    // pin naming a method that does not fill that slot would print a name the
    // graph does not support — on the one surface whose whole claim is that it
    // shows how the recorded pieces fit.
    if (node.via !== undefined) {
      const entries = Object.entries(node.via);
      if (entries.length === 0) {
        errors.push(`${node.id}: via pins nothing — omit it instead`);
      }
      for (const [stepId, methodId] of entries) {
        if (!node.steps.includes(stepId)) {
          errors.push(`${node.id}: via names ${stepId}, which is not one of its steps`);
          continue;
        }
        const filler = byId.get(methodId);
        if (!filler) {
          errors.push(`${node.id}: via[${stepId}] names an unknown id — ${methodId}`);
          continue;
        }
        if (!isMethod(filler)) {
          errors.push(`${node.id}: via[${stepId}] is ${methodId}, which is a capability, not a way through one`);
          continue;
        }
        if (filler.realizes !== stepId) {
          errors.push(
            `${node.id}: via[${stepId}] is ${methodId}, which fills ${filler.realizes} — a pin may only name one of the ways through the step it is filed under`,
          );
        }
        if (methodId === node.id) errors.push(`${node.id}: via[${stepId}] names itself`);
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
      // **The mark names the parent, and validation is what keeps it naming
      // the parent.** It is a hand-copied name, which is the shape that
      // eventually points at something else; requiring it to occur inside the
      // parent's own drawn name means a rename can shorten this mark's meaning
      // but can never leave it pointing at a method that no longer exists under
      // that name. Checked per locale, because the two names differ.
      for (const [field, mark, whole, short] of [
        ["refinesMark", node.refinesMark, parent?.label, parent?.shortLabel],
        ["refinesMarkJa", node.refinesMarkJa, parent?.labelJa, parent?.shortLabelJa],
      ] as const) {
        if (typeof mark !== "string" || mark.trim() === "") {
          errors.push(
            `${node.id}: refines ${node.refines} and ${field} is empty — the canvas draws the relation as a mark and needs the name it points at, in both locales`,
          );
          continue;
        }
        if ([...mark.trim()].length > REFINES_MARK_MAX) {
          errors.push(
            `${node.id}: ${field} is ${[...mark.trim()].length} characters — a refinement mark may be at most ${REFINES_MARK_MAX}`,
          );
        }
        const names = [whole, short].filter((name): name is string => typeof name === "string");
        if (names.length > 0 && !names.some((name) => name.includes(mark.trim()))) {
          errors.push(
            `${node.id}: ${field} is "${mark.trim()}", which does not occur in ${node.refines}'s own name (${names.join(" / ")}) — a mark may shorten the name it points at, never replace it`,
          );
        }
      }
      // **The fold flag cannot assert what the fields refute.** A folded
      // refinement (owner's s121 ruling) draws no lane because it records no
      // map-representable difference — so the claim is checked against the
      // chain facts it summarises. The Koopman children stay drawable
      // precisely because their authors do NOT declare this: "a different
      // construction that happens to be atomic" is a judgment the corpus
      // records, not one a machine could infer from field equality.
      if (node.sameInternalsAsParent === true && parent && isMethod(parent)) {
        const same = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
          JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
        if (!same(node.steps, parent.steps)) {
          errors.push(
            `${node.id}: sameInternalsAsParent, but its steps differ from ${parent.id}'s — a different walk is a drawable difference, so it is not folded`,
          );
        }
        if (!same(node.bypasses, parent.bypasses)) {
          errors.push(
            `${node.id}: sameInternalsAsParent, but its bypasses differ from ${parent.id}'s`,
          );
        }
        if (node.via !== undefined && JSON.stringify(node.via) !== JSON.stringify(parent.via ?? {})) {
          errors.push(
            `${node.id}: sameInternalsAsParent, but its via pins differ from ${parent.id}'s — a different pin is a drawable difference`,
          );
        }
        if (node.through !== undefined && JSON.stringify(node.through) !== JSON.stringify(parent.through ?? {})) {
          errors.push(
            `${node.id}: sameInternalsAsParent, but its through narrowings differ from ${parent.id}'s`,
          );
        }
      }
      for (const [field, value] of [
        ["potentialPath", node.potentialPath],
        ["potentialPathJa", node.potentialPathJa],
      ] as const) {
        if (node.sameInternalsAsParent === true) {
          if (typeof value !== "string" || value.trim() === "") {
            errors.push(
              `${node.id}: sameInternalsAsParent and ${field} is missing — a folded refinement records what would earn it a path of its own, in both locales`,
            );
          }
        } else if (value !== undefined) {
          errors.push(`${node.id}: ${field} is set and sameInternalsAsParent is not — the note belongs to the fold`);
        }
      }
    } else {
      for (const field of ["refinesMark", "refinesMarkJa", "sameInternalsAsParent", "potentialPath", "potentialPathJa"] as const) {
        if (node[field] !== undefined) {
          errors.push(`${node.id}: ${field} is set and refines is not`);
        }
      }
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

  // --- coined composite names ----------------------------------------------
  //
  // The owner's rule, applied where it was not applied: to the label. Fail-closed
  // — a composite whose name conjoins concepts is an error unless a row in
  // `COMPOSITE_NAME_DISPOSITIONS` says what was decided about it — and the
  // message tells whoever is adding the node which of the two things to do.
  const conjoined = conjoinedCompositeNames(graph, vocabulary);
  const dispositionOf = new Map<string, CompositeNameDisposition>();
  for (const row of dispositions) {
    if (dispositionOf.has(row.node)) {
      errors.push(`${row.node}: listed twice in COMPOSITE_NAME_DISPOSITIONS`);
    }
    dispositionOf.set(row.node, row);
  }
  for (const { node, locales, relisted } of conjoined) {
    if (dispositionOf.has(node)) continue;
    const parts = relisted.map((entry) => `${JSON.stringify(entry.fragment)} is ${entry.concept}`);
    errors.push(
      `${node}: its label joins separate concepts${
        parts.length > 0 ? ` — ${parts.join(", ")}` : ""
      }, and this method takes more than one hop, so the name relists a chain the steps already draw. Rename it to the one concept this route is (in ${
        locales.length > 1 ? "both locales" : "every locale"
      }), or add a COMPOSITE_NAME_DISPOSITIONS row: "source-framing" with the citation url whose paper writes it this way, or "awaiting-owner-rename" if the replacement is a domain call.`,
    );
  }
  const conjoinedIds = new Set(conjoined.map((entry) => entry.node));
  for (const row of dispositions) {
    const node = byId.get(row.node);
    if (!node) {
      errors.push(`${row.node}: COMPOSITE_NAME_DISPOSITIONS names an id the graph does not carry`);
      continue;
    }
    if (!isMethod(node)) {
      errors.push(`${row.node}: COMPOSITE_NAME_DISPOSITIONS names a capability — the rule is about routes`);
      continue;
    }
    // A row that outlives the name it excuses is the failure this whole
    // mechanism exists to avoid: a queue nobody empties reads exactly like a
    // queue with nothing in it.
    if (!conjoinedIds.has(row.node)) {
      errors.push(
        `${row.node}: its label no longer joins concepts — delete the COMPOSITE_NAME_DISPOSITIONS row`,
      );
    }
    if (!row.reason.trim()) errors.push(`${row.node}: its disposition gives no reason`);
    if (row.disposition === "source-framing") {
      if (!row.phrase?.trim()) {
        errors.push(`${row.node}: source-framing must quote the phrase the source uses`);
      }
      const urls = (node.citations ?? []).map((citation) => citation.url);
      if (row.citedAs === undefined) {
        errors.push(`${row.node}: source-framing must name the citation url that frames it this way`);
      } else if (!urls.includes(row.citedAs)) {
        errors.push(
          `${row.node}: source-framing cites ${row.citedAs}, which is not one of this node's citations — cite the paper on the node first`,
        );
      }
    } else if (row.citedAs !== undefined || row.phrase !== undefined) {
      errors.push(
        `${row.node}: awaiting-owner-rename carries a citation — a name nobody has ruled on is not a source's framing`,
      );
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
  /**
   * What the Atlas record actually says, in one line.
   *
   * Added session 95 on the owner's *"when people see specific algorithms on the
   * map, they see the content of the atlas repository entry and can click around
   * in there and export etc etc."* Until now this surface listed a record by
   * **title only**, so a reader met a link and had to follow it to find out
   * whether it was worth following.
   *
   * A projection of the record, never a second copy of it: one sentence and a
   * link. The record itself — the code, the verification, the export — stays at
   * `/repository/<slug>`, which is the page that owns it.
   */
  description: string;
  descriptionJa: string;
}

/** Every node a given corpus record appears on — the inverse of `entries`. */
export function nodesForEntry(graph: LayerGraph, slug: string): LayerNode[] {
  return graph.nodes.filter((node) => (node.entries ?? []).includes(slug));
}
