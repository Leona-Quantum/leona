// The join between the repository's object records and the map's vocabulary of
// states — the thing that was never built (R3, ai-ops#41 option B).
//
// ## What was missing
//
// The map has its own vocabulary of 34 named states — *Linear ODE system*,
// *State you can prepare*, *Hamiltonian you can query* — and each has a page.
// The repository has 101 records whose role is an **object** rather than a
// procedure: 12 states, 62 operators, 27 gates. Measured 2026-08-13, **not one
// of the 34 states pointed at a record, and not one of the 101 records pointed
// back.** The two halves were built separately and never joined, so a reader
// standing on *State you can prepare* could not see that this catalogue holds a
// dozen of them, and a reader on the Bell-state record could not see that the
// map has a slot whose whole job is producing one.
//
// ## The join is to a STATE, and everything else is derived
//
// A record is joined to at most one state, and nothing else is authored. Which
// map processes consume or produce it is then read off the graph: a slot's
// contract already names the state it takes and the state it returns, and
// `stateSatisfies` already knows that a narrower object satisfies a broader
// requirement. So "which processes is this operator relevant to" is a question
// the graph can answer as soon as the record has a state, and there is no second
// table to keep in step with the first.
//
// This is also why the join does not point at a slot directly. A slot is a
// process; these records are objects. Pointing a record at `state-preparation`
// would say the record IS the process of preparing, which is false of every one
// of them, and it would break the moment a slot was split — which is a live
// possibility this session.
//
// ## Why this is a rule table and not a field on the record
//
// **A free-text `ingredient` field on a record is the bug this project has
// already shipped once, at larger scale.** `topics.ts` records it: a literature
// record about simulating a named physical model read naturally as "Hamiltonian
// simulation", and that family's rule stamps a record `benchmark-circuit` —
// *this is one of our own yardsticks* — which quietly took it out of the
// map-eligible denominator. Every test stayed green, because a wrong value that
// is well-formed breaks no rule.
//
// So the same three properties `topics.ts` argues for apply here, unchanged:
//
// 1. **Re-runnable.** The owner may repopulate this corpus wholesale. Hand-written
//    joins would be discarded with it; a rule table joins whatever the corpus
//    becomes.
// 2. **Reviewable.** A reader can see *why* a record is joined — some rule said
//    so, and the rule is one line.
// 3. **It fails loudly.** An object record that matches neither a join rule nor
//    an abstention is refused by `scripts/check-ingredients.mjs`, which runs in
//    `lint`. There is no silent middle.
//
// ## Abstention is a first-class answer, and most records take it
//
// The honest finding of this join is that **most operator records are not
// objects any map process consumes.** They are terms of a Hamiltonian, encodings
// that map one representation to another, generator pools an ansatz picks from,
// and observables — and the map has no state for an observable, because
// `observable-estimation` names the operator being measured in its contract
// prose, as a parameter. `states.ts` is explicit that a parameter is not a
// state: *"A state is the mathematical object being carried, not the parameters
// riding alongside it."*
//
// A join that quietly dropped those would publish a shelf of confident links and
// hide the fact that three quarters of the operators corpus has nothing to
// attach to. So every object record must be *either* joined *or* abstained with
// a stated reason from a closed list, the checker refuses anything else, and the
// shelf publishes both counts with their denominator.
//
// **An abstention is not a verdict on the record.** `observable` says the map
// cannot hold this yet, not that the record is weak — several of them are among
// the best-sourced things here. It is a statement about the map's vocabulary,
// and it is the worklist for extending it.
//
// ## But the operators corpus is thin, and joining is not what would fix it
//
// The question the shelf was built to answer — *which operators are worth
// deepening and which are decoration* — has an answer now, and it does not
// divide along the join. Measured at 45395f9e over all 368 records, by the
// fraction of a record's `explanation` whose sentences appear verbatim in
// another record's:
//
// - **39 of the 46 unjoined operators** are template expansions of one
//   six-field table — `OPERATOR_CONCEPTS` in `entries-literature-expansion.ts`,
//   family *"VQE Hamiltonians and observables"*. Each shares **76–85%** of its
//   prose with the other 49 members, all 50 cite the **same single source**
//   (OpenFermion, arXiv:1710.07629), and each carries **one** literature entry.
//   The authored content that distinguishes one from another is two short
//   strings: `form` (a formula) and `role` (one sentence).
// - **11 of the 16 joined operators come from that same table**, at the same
//   78–83%, on the same one citation. So joining did not select for depth: the
//   rule found the eleven whose one-line `role` happens to say *Hamiltonian*.
// - The seven records that are genuinely hand-authored — the three Pauli
//   records, `shor-code-error-correction`, `surface-code-memory`,
//   `number-operator`, `parity-operator-measurement` — all measure **0%**
//   shared, as do all 12 states records and the five hand-authored Hamiltonian
//   operators. The measure discriminates; it is not flagging boilerplate that
//   every record has.
//
// **So the honest reading of 16/62 is not that 46 operators are waiting for a
// state to join.** 50 of the 62 are one table expanded, and wiring more of them
// to the map would attach it to records carrying two authored strings each.
// Deepening comes first, and it is needed on the joined ones too. That is a
// finding for the owner about where the operators corpus goes next, not a
// licence for this file to widen its rules — nothing here should be changed to
// make the fraction look better.
import { deriveTopics, roleOf, type TopicEvidence, type TopicId } from "./topics.ts";
import { kindsOf, stateSatisfies, type StateVocabulary } from "./states.ts";
import type { LayerGraph, LayerNode } from "./layers.ts";

/**
 * The roles whose records are objects, and therefore in scope for this join.
 *
 * The other two roles are out of scope by what they are rather than by
 * omission. An `algorithm-reference` is a procedure — it is already joined to
 * the map by `LayerNodeBase.entries`, which is the anchor mechanism
 * `map-eligibility.ts` governs, and joining it to a state as well would give one
 * record two different claims about where it sits. A `benchmark-circuit` is a
 * yardstick: the owner's ruling is that it is "published to be measured against",
 * not a thing a route is holding.
 */
export const OBJECT_ROLES = ["state", "operator", "gate-primitive"] as const;
export type ObjectRole = (typeof OBJECT_ROLES)[number];

export function isObjectRole(role: string | null | undefined): role is ObjectRole {
  return (OBJECT_ROLES as readonly string[]).includes(role ?? "");
}

/**
 * Why a record is not joined. **Closed**, so the gaps can be counted, grouped
 * and published rather than read one at a time.
 *
 * Each is a statement about the MAP, not about the record — see the header. A
 * new member is a deliberate act and should be rare: the first question when a
 * record fits none of these is whether the map is missing a state, which is a
 * question for the owner and not a seventh reason.
 */
export const ABSTENTION_REASONS = [
  /**
   * An operator you measure. `observable-estimation` takes a prepared state and
   * returns a number; the operator O is named in its contract prose, which
   * `states.ts` classifies as a parameter rather than a state. **The largest
   * group, and the one that most clearly names something the map could grow.**
   */
  "observable",
  /**
   * A term *of* a Hamiltonian rather than a Hamiltonian: a hopping term, a
   * Coulomb term, a creation operator. Joining these to "Hamiltonian you can
   * query" would say a route could hand a simulator one of them and get an
   * evolution, which is not what any of them is.
   */
  "hamiltonian-term",
  /**
   * A mapping from one representation to another — Jordan–Wigner, Bravyi–Kitaev,
   * QUBO-to-Ising. These are **processes**, and the map draws none of *these
   * six*. The record is filed as an operator because what it publishes is the
   * resulting operator, but what it documents is the transformation.
   *
   * **Narrowed 2026-08-13 from "the map draws none of them", which claimed more
   * than it could defend.** The old phrasing read as *the map draws no
   * representation-changing process at all*, and that is a claim about the whole
   * graph rather than about these records. `joins` flagged it while proposing a
   * spatial-discretisation slot — a PDE becoming a discretised system is exactly
   * a representation change — and the sentence would have gone quietly false the
   * moment that landed, without any of these six records changing.
   *
   * The narrow claim is the one this abstention needs and the one that survives:
   * no map process turns a fermionic operator into a qubit operator, or a QUBO
   * into an Ising model. Whether some *other* representation change is drawn is
   * not this reason's business.
   */
  "encoding",
  /**
   * A set an ansatz picks generators from. `ansatz-construction` takes an
   * eigenvalue problem and returns a parameterised circuit family; the pool is a
   * parameter of that choice, in its contract prose, and not something the route
   * is holding between two processes.
   */
  "generator-pool",
  /**
   * An operator that recasts one question as another — a folded spectrum, a
   * deflation penalty, a constraint penalty. The map draws no process that turns
   * an excited-state question into a ground-state one, so joining these would
   * assert a hop the graph does not have.
   */
  "objective-transform",
  /**
   * The record documents a process: a product formula, a syndrome measurement, an
   * error-correcting code. These are candidates for a map NODE, not for a state,
   * and the anchor mechanism for that is `entries` — which `map-eligibility.ts`
   * restricts to `algorithm-reference` by the owner's ruling.
   */
  "documents-a-process",
  /**
   * A gate — which this vocabulary has no way to hold, and which the owner has
   * also ruled off the map.
   *
   * **The structural reason comes first because it is the one that does not
   * depend on anyone's decision.** `states.ts`: *"A state is the mathematical
   * object being carried, not the parameters riding alongside it."* The five
   * circuit states are where a gate would have to live, and each names the gate
   * *set* as a parameter rather than as the object — `discrete-circuit` is
   * *"continuous rotations replaced by words in a finite gate set"*.
   *
   * The contracts say it outright, which is the stronger evidence:
   * `ansatz-construction.takes` ends *"…and the connectivity and **native gate
   * set** of the device the family has to run on"*, with `contract.from =
   * eigenvalue-problem` and `contract.to = parameterized-circuit`. That is
   * exactly the shape of `observable-estimation.takes` naming *"a description of
   * O"* while its ends are `prepared-state → observable-value`: the object is in
   * the prose, and the prose is where parameters live.
   *
   * So a gate sits one level further from being a state than an `observable`
   * does — an observable is at least the parameter a contract names, and a gate
   * is one element of one. Nothing in the 34-state vocabulary is *a unitary you
   * can apply*.
   *
   * The owner's ruling agrees, once: *"gates are just primitives, so it is okay
   * for them to be their section… including operators/gates/whatever states are
   * would be introducing tons of primitives for no reason"* (ai-ops#14, which
   * asked whether every repository record gets a map node).
   *
   * **ai-ops#44 is not a second map ruling and must not be cited as one.** Its
   * sentence is *"just leave the gates. they are primitives, **not needed to be
   * sourced**"*, and the question it answered was whether 31 gate records citing
   * a normative specification should cite an academic paper instead. It is a
   * citation standard, and `scripts/check-paper-register.mjs` already cites it
   * correctly for exactly that. This file claimed it as a second ruling that
   * gates stay off the map, and the shelf printed *"the owner ruled twice"* to
   * every visitor, thirty times — measured on leonaqt.com 2026-08-13 at
   * 45395f9e. The mechanism was a quote clipped one clause early: drop *"not
   * needed to be sourced"* and a sourcing ruling reads as a map ruling.
   *
   * This abstention exists so that the 27 gate records are **counted** as
   * deliberately unjoined rather than merely unmatched, which is what makes the
   * shelf's Gates section an honest zero instead of an empty one.
   */
  "primitive-by-ruling",
] as const;

export type AbstentionReason = (typeof ABSTENTION_REASONS)[number];

/**
 * A rule, matched against evidence the record already carries.
 *
 * Deliberately the same evidence `topics.ts` allows and for the same reason its
 * comment gives: `description` and `title` are prose a content pass rewrites
 * without thinking about classification, so a rule keyed off a phrase in them
 * silently re-joins records when the copy is edited. Family, slug and the free
 * tags are the fields that were written *as* labels.
 */
export interface IngredientRule {
  /** Exact `algorithmFamily`. */
  family?: string;
  /** Any of these, case-insensitively, in `tags`. */
  tagAny?: readonly string[];
  /** Any of these as an exact slug. */
  slugAny?: readonly string[];
}

interface JoinRule extends IngredientRule {
  /** The state id in `STATE_VOCABULARY` a matching record IS an instance of. */
  state: string;
  /** Why these records are that object, for a reviewer. */
  because: string;
}

interface AbstainRule extends IngredientRule {
  reason: AbstentionReason;
  /** What the map would have to gain for this group to join. */
  because: string;
}

/**
 * Record → the map state it is an instance of.
 *
 * **Keyed on family where a whole family agrees, and on tags where it does not.**
 * The 50-record family "VQE Hamiltonians and observables" is the reason the
 * second form is needed at all: it holds eleven Hamiltonians and thirty-nine
 * things that are not Hamiltonians, so no family-level rule is right for it, and
 * a family rule that was 11/50 right would be the exact failure this file's
 * header is about. Every member of that family carries a third tag that is its
 * own title in lower case — written as a label, which is what makes it legal
 * evidence.
 *
 * `REFINEMENT_RULES` in `topics.ts` exists for the same reason and reads the
 * same tags.
 */
export const INGREDIENT_JOIN_RULES: readonly JoinRule[] = [
  // --- states -------------------------------------------------------------
  //
  // Every one of the eleven state families joins `prepared-state`, and the
  // families are listed one by one rather than collapsed into "role = state"
  // on purpose: a twelfth state family arriving in the corpus should be a
  // decision somebody makes, not a link that appears. This is the same argument
  // `FAMILY_RULES` makes for being exhaustive over families rather than keyed on
  // a pattern.
  //
  // `prepared-state` and not `state-description`, and the difference is the one
  // the state's own summary turns on: *"Not the state itself but the routine
  // that makes it — which is the useful form, because a routine can be run
  // again, controlled, and inverted."* Each of these records publishes a
  // preparation circuit, so what it holds is the routine. A record that gave
  // only amplitudes with no construction would be `state-description`, and the
  // corpus has none.
  {
    family: "Bell / entanglement",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "GHZ / entanglement",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "Multipartite entanglement",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "Symmetric superposition states",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "Superposition state",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "Thermal state preparation",
    state: "prepared-state",
    because: "a named state published with the routine that prepares it",
  },
  {
    family: "Mixed-state entanglement",
    state: "prepared-state",
    because: "a named state published with the routine that prepares it",
  },
  {
    family: "Stabilizer states",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },
  {
    family: "Measurement-based computing",
    state: "prepared-state",
    because: "a resource state published with the circuit that prepares it",
  },
  {
    family: "Magic state distillation",
    state: "prepared-state",
    because: "a named state published with the routine that produces it",
  },
  {
    family: "Quantum metrology states",
    state: "prepared-state",
    because: "a named state published with the circuit that prepares it",
  },

  // --- Hamiltonians you can query -----------------------------------------
  //
  // The one family that agrees with itself. All three of its records — the
  // classical Ising Hamiltonian, the Heisenberg XXZ chain, and the
  // transverse-field Ising model — are operators a simulator can be handed.
  {
    family: "Spin Hamiltonians",
    state: "hamiltonian-access",
    because: "a lattice Hamiltonian, published as a Pauli sum a simulator can be handed",
  },
  // The two Hamiltonians inside "Fermionic Hamiltonians", by tag rather than by
  // family: the third member of that family is the fermionic number operator,
  // which is an observable, and a family rule would have joined it too.
  {
    tagAny: ["hubbard model"],
    state: "hamiltonian-access",
    because: "a lattice-fermion Hamiltonian, mapped to qubits and simulable as it stands",
  },
  {
    tagAny: ["molecular hamiltonian"],
    state: "hamiltonian-access",
    because: "a molecular electronic-structure Hamiltonian in qubit form",
  },
  // The eleven Hamiltonians inside "VQE Hamiltonians and observables". Each tag
  // is that record's own title in lower case — see this table's doc comment for
  // why the family cannot carry this rule.
  {
    tagAny: [
      "weighted pauli-sum hamiltonian",
      "electronic-structure hamiltonian",
      "fermi–hubbard hamiltonian",
      "bose–hubbard hamiltonian",
      "ising cost hamiltonian",
      "transverse-field ising hamiltonian",
      "xy spin hamiltonian",
      "heisenberg hamiltonian",
      "xyz spin hamiltonian",
      "kitaev-chain hamiltonian",
      "maxcut cost operator",
    ],
    state: "hamiltonian-access",
    because:
      "a Hermitian operator published as a sum of terms that can be exponentiated one at a time — which is `hamiltonian-access`'s own definition of the access model",
  },
];

/**
 * Record → why the map cannot hold it, for every object record no join rule
 * claims.
 *
 * The checker refuses a record matched by neither table, so this list is the
 * half that keeps the join honest: it is impossible to leave a record out
 * quietly, and the reasons are countable.
 */
export const INGREDIENT_ABSTAIN_RULES: readonly AbstainRule[] = [
  // --- gates, by the owner's ruling ----------------------------------------
  ...(
    [
      "Single-qubit gate",
      "Controlled gate",
      "Two-qubit gate",
      "Multi-controlled gate",
      "Multi-qubit gate",
      "Rotation gate",
      "Phase gate",
      "Universal single-qubit gate",
      // Filed as operators by role and gates by every other reading: the three
      // Pauli records. `pauli-y-gate` and `pauli-z-gate` even carry
      // `category: "gates"` while their family resolves to the `operator` role —
      // one of the three category/role disagreements in the corpus, measured
      // 2026-08-13. The abstention is the same either way, which is the useful
      // property: this join does not have to settle that disagreement first.
      "Pauli operator",
    ] as const
  ).map((family) => ({
    family,
    reason: "primitive-by-ruling" as const,
    because:
      "a gate. Nothing in the vocabulary is a unitary you can apply — the circuit states name the gate set as a parameter, and `states.ts` is explicit that a parameter is not a state. The owner's ai-ops#14 ruling agrees; nothing here proposes to reopen it",
  })),

  // --- records that document a process -------------------------------------
  {
    family: "Quantum error correction",
    reason: "documents-a-process",
    because:
      "an error-correcting code is a way of filling the `error-correction` slot, not an object a route holds. The map's anchor for that is `entries`, which `map-eligibility.ts` restricts to algorithm records",
  },
  {
    family: "Stabilizer / error-syndrome measurement",
    reason: "documents-a-process",
    because: "a measurement primitive — the procedure, not the object it acts on",
  },
  {
    tagAny: ["first-order trotter product", "pauli time-evolution operator"],
    reason: "documents-a-process",
    because:
      "a product formula and the single-term exponential it is built from. `hamiltonian-simulation` already has methods for this; the record documents how the circuit is made, not an object between two processes",
  },

  // --- the leftover of "Fermionic Hamiltonians" -----------------------------
  {
    slugAny: ["number-operator"],
    reason: "observable",
    because:
      "the fermionic number operator counts occupation. It is measured, and the map names a measured operator only in `observable-estimation`'s contract prose",
  },

  // --- the thirty-nine of "VQE Hamiltonians and observables" ---------------
  {
    tagAny: [
      "pauli-string observable",
      "orbital number operator",
      "total particle-number operator",
      "molecular dipole operator",
      "electronic density operator",
      "total spin-x operator",
      "total spin-y operator",
      "total spin-z operator",
      "total-spin-squared operator",
      "fermion-parity operator",
      "z2 symmetry generator",
      "reference-state projector",
      "hamiltonian variance operator",
      "commuting observable group",
      "one-particle reduced density matrix",
      "two-particle reduced density matrix",
    ],
    reason: "observable",
    because:
      "something you measure. `observable-estimation` takes a prepared state and returns a number with an error bar; the operator O rides along in its contract prose, and `states.ts` is explicit that a parameter is not a state. **This is the group that names what the map is missing** — if the vocabulary ever gains a state for the operator being measured, these join it",
  },
  {
    tagAny: [
      "one-body fermionic operator",
      "two-body fermionic operator",
      "fermionic creation operator",
      "fermionic annihilation operator",
      "fermionic hopping operator",
      "fermionic pairing operator",
      "coulomb interaction operator",
    ],
    reason: "hamiltonian-term",
    because:
      "a term of a Hamiltonian rather than a Hamiltonian. Handing one to a simulator on its own is not a step any source records",
  },
  {
    tagAny: [
      "jordan–wigner mapped creation operator",
      "jordan–wigner number mapping",
      "jordan–wigner hopping mapping",
      "parity fermion-to-qubit mapping",
      "bravyi–kitaev mapping",
      "qubo operator mapping",
    ],
    reason: "encoding",
    because:
      "a mapping between representations. The record publishes the operator that comes out; what it documents is the transformation — and no map process performs a fermion-to-qubit mapping or a QUBO-to-Ising reduction",
  },
  {
    tagAny: [
      "anti-hermitian excitation generator",
      "ucc singles operator pool",
      "ucc doubles operator pool",
      "qubit-adapt pauli pool",
      "vqe gradient commutator",
    ],
    reason: "generator-pool",
    because:
      "the set an ansatz picks its generators from, and the ranking rule that picks them. `ansatz-construction` names both in its contract prose",
  },
  {
    tagAny: [
      "constraint-penalty operator",
      "deflation projector",
      "shifted hamiltonian square",
    ],
    reason: "objective-transform",
    because:
      "an operator that recasts one question as another — a penalty, a deflation, a folded spectrum. The map has no process that performs the recast, so a join would assert a hop the graph does not draw. The owner's ai-ops#51 note about putting a specification such as \"penalty objective\" in a label is about this group",
  },
];

/** What the join says about one record. */
export type IngredientJoin =
  | { readonly kind: "joined"; readonly state: string; readonly because: string }
  | { readonly kind: "abstained"; readonly reason: AbstentionReason; readonly because: string }
  | { readonly kind: "unclassified" };

function matches(rule: IngredientRule, evidence: TopicEvidence): boolean {
  if (rule.family !== undefined && rule.family !== evidence.algorithmFamily) return false;
  if (rule.slugAny && !rule.slugAny.includes(evidence.slug)) return false;
  if (rule.tagAny) {
    const lower = evidence.tags.map((tag) => tag.toLowerCase());
    const wanted = rule.tagAny.map((tag) => tag.toLowerCase());
    if (!wanted.some((tag) => lower.includes(tag))) return false;
  }
  // A rule with no predicate would claim the whole corpus. Never silently — the
  // same guard `topics.ts` carries, for the same reason.
  return rule.family !== undefined || rule.slugAny !== undefined || rule.tagAny !== undefined;
}

/**
 * Every join rule that claims this record. Plural on purpose: two rules
 * claiming one record is a defect the checker reports, and it can only report
 * what the derivation is willing to return.
 */
export function joinRulesFor(evidence: TopicEvidence): readonly JoinRule[] {
  return INGREDIENT_JOIN_RULES.filter((rule) => matches(rule, evidence));
}

export function abstainRulesFor(evidence: TopicEvidence): readonly AbstainRule[] {
  return INGREDIENT_ABSTAIN_RULES.filter((rule) => matches(rule, evidence));
}

/**
 * What this record joins, abstains from, or fails to be classified as.
 *
 * A join wins over an abstention when both match, and the checker separately
 * refuses that overlap — so the precedence here can never quietly decide
 * anything. It exists only so that a caller in a rendering path has a total
 * function rather than a throw.
 */
export function ingredientJoin(evidence: TopicEvidence): IngredientJoin {
  const joins = joinRulesFor(evidence);
  if (joins.length > 0) {
    return { kind: "joined", state: joins[0]!.state, because: joins[0]!.because };
  }
  const abstains = abstainRulesFor(evidence);
  if (abstains.length > 0) {
    return { kind: "abstained", reason: abstains[0]!.reason, because: abstains[0]!.because };
  }
  return { kind: "unclassified" };
}

/** The minimum a record has to expose for this module to classify it. */
export interface IngredientCandidate extends TopicEvidence {
  readonly title?: string;
}

/** The record's role, derived the same way every other surface derives it. */
export function roleFor(evidence: TopicEvidence): TopicId | null {
  return roleOf(deriveTopics(evidence));
}

// ---------------------------------------------------------------------------
// The other direction: which map processes touch an object
// ---------------------------------------------------------------------------

/** How a process touches an object. */
export type ProcessRelation = "consumes" | "produces";

export interface TouchingProcess {
  readonly id: string;
  readonly relation: ProcessRelation;
}

/**
 * The slots that consume or produce an instance of `stateId`.
 *
 * **Derived, never authored**, which is the whole point of joining a record to a
 * state rather than to a slot: this answer changes with the graph, so a slot
 * that is split, renamed or given a different contract carries its records with
 * it and nothing here has to be edited.
 *
 * The two directions are not symmetric, and getting them the wrong way round
 * would be the hidden-conversion bug `stateSatisfies` exists to prevent:
 *
 * - A slot **consumes** the object when the object is a *kind of* what the slot
 *   takes. A block-encoding satisfies a slot that takes any matrix access.
 * - A slot **produces** the object when what the slot returns is a *kind of* the
 *   object. `quantum-linear-solve` returns a solution state, which is a kind of
 *   prepared state, so it produces one.
 *
 * A slot can legitimately be both, and both are listed: the relation is a fact
 * about that slot, not a bucket the slot is sorted into.
 *
 * ## What this deliberately does NOT read: `through`
 *
 * **Contract ends only.** `LayerMethod.through` is a third way a state gets used
 * — it pins the state a *route* is actually holding after a step, when that is
 * narrower than the step's own slot promises — and nothing here looks at it. So
 * a method that narrows through a state is not counted among that state's
 * processes.
 *
 * Measured 2026-08-13 rather than assumed, because the size of the omission is
 * the whole question: **the graph carries exactly two `through` pins, both on
 * `kvn-simulation-route`** (`nonlinear-linear-embedding → hermitian-generator`,
 * `hamiltonian-simulation → runnable-evolution`), and **neither target is a
 * state any record joins** — all 28 joins land on `prepared-state` and
 * `hamiltonian-access`, and neither is a `through` target. So no count this
 * module publishes is understated today. It could become understated the moment
 * a record joins a narrowed state, which is why the limit is written here rather
 * than left to be rediscovered.
 *
 * **And a warning about the wrong test, which cost a cross-lane exchange to
 * settle.** "Named by no contract" is *not* the same as "reached by nothing":
 * `hermitian-generator`, `runnable-evolution` and `history-state` appear in no
 * `contract.from`/`contract.to` at all, yet this function returns 5, 4 and 1
 * process for them respectively, because `stateSatisfies` walks `specializes`. A
 * grep over contract fields will tell you those states are orphans and it is
 * wrong three times out of three.
 */
export function processesTouching(
  graph: LayerGraph,
  vocabulary: StateVocabulary,
  stateId: string,
): readonly TouchingProcess[] {
  const found: TouchingProcess[] = [];
  for (const node of graph.nodes) {
    const contract = (node as LayerNode & { contract?: { from: string; to: string } }).contract;
    if (!contract) continue;
    if (stateSatisfies(vocabulary, stateId, contract.from)) {
      found.push({ id: node.id, relation: "consumes" });
    }
    if (stateSatisfies(vocabulary, contract.to, stateId)) {
      found.push({ id: node.id, relation: "produces" });
    }
  }
  return found;
}

/**
 * Every slot that carries a contract — the denominator every count on the shelf
 * is published against.
 *
 * A count with no denominator is the failure this project names most often. "5
 * processes" is a different claim on a map of 23 slots than on a map of 200, and
 * the reader cannot tell which without being told.
 */
export function contractedProcessCount(graph: LayerGraph): number {
  return graph.nodes.filter(
    (node) => (node as LayerNode & { contract?: unknown }).contract !== undefined,
  ).length;
}

// ---------------------------------------------------------------------------
// The shelf
// ---------------------------------------------------------------------------

export interface ShelfEntry {
  readonly slug: string;
  readonly title: string;
  readonly role: ObjectRole;
  readonly join: IngredientJoin;
  /** Slots that consume or produce this object. Empty for an abstention. */
  readonly processes: readonly TouchingProcess[];
}

export interface ShelfSection {
  readonly role: ObjectRole;
  readonly entries: readonly ShelfEntry[];
  /** Records in this section the map can reach. */
  readonly joined: number;
  /** Records in this section it cannot, by reason. */
  readonly abstained: Readonly<Record<AbstentionReason, number>>;
}

/**
 * The one reason a whole section abstains for, or `null` if it has no such
 * reason.
 *
 * **What this is for.** The shelf printed each record's reason on its own row,
 * which is right where the reasons differ and wrong where they do not: the Gates
 * section is 27 records that all abstain as `primitive-by-ruling`, so it printed
 * the same forty-word sentence twenty-seven times. `EntryStateLinks` already
 * made this argument one level up — it shows nothing on the 73 unjoined record
 * pages because *"one sentence about the map repeated until it stopped being
 * read"* is not a statement. The shelf is where that sentence gets published
 * once, and this is the test for when once is enough.
 *
 * Three conditions, and each one rules out a way the section-level sentence
 * could be false of a row it sits above:
 *
 * - **More than one row.** Hoisting a single row's reason above that single row
 *   moves words without removing any.
 * - **Nothing joined.** *"None of these are objects the map names"* has to hold
 *   for every row, and one joined row cancels it. Read from `joined`, which
 *   `buildShelf` counted from these same entries.
 * - **One reason, on every row.** An `unclassified` row is not an abstention and
 *   must not be spoken for — the checker refuses one into the corpus, and if one
 *   ever appears the section falls back to per-row reasons rather than
 *   attributing a reason nothing gave it.
 *
 * So a section that gains a single join, or a second reason, returns to per-row
 * reasons with nothing edited. Today exactly one section qualifies.
 */
export function soleAbstentionReason(section: ShelfSection): AbstentionReason | null {
  if (section.entries.length < 2 || section.joined > 0) return null;
  let only: AbstentionReason | null = null;
  for (const entry of section.entries) {
    if (entry.join.kind !== "abstained") return null;
    if (only === null) only = entry.join.reason;
    else if (only !== entry.join.reason) return null;
  }
  return only;
}

export interface Shelf {
  readonly sections: readonly ShelfSection[];
  /** Every slot with a contract — the denominator for every process count. */
  readonly processDenominator: number;
  /** Object records in total — the denominator for the coverage fraction. */
  readonly recordDenominator: number;
  readonly joined: number;
  /** Records no rule claimed. Always zero while the checker passes. */
  readonly unclassified: readonly string[];
}

/**
 * Build the shelf, ordered so the objects that matter to many processes float to
 * the top.
 *
 * The owner's phrase was *"operators are useful for certain algorithms like VQE,
 * QSVT, and others"*, and the count is that phrase turned into a number: how
 * many of the map's processes consume or produce this object. It is the first
 * honest measurement of which operators are worth deepening and which are
 * decoration — and, as it turns out, of how few of them the map can reach at all.
 *
 * Ties break on the slug so the order is stable between renders; an unstable
 * order on a list this long reads as a bug (the same argument `orderEntries`
 * makes).
 */
export function buildShelf(
  records: readonly IngredientCandidate[],
  graph: LayerGraph,
  vocabulary: StateVocabulary,
): Shelf {
  const emptyCounts = (): Record<AbstentionReason, number> =>
    Object.fromEntries(ABSTENTION_REASONS.map((reason) => [reason, 0])) as Record<
      AbstentionReason,
      number
    >;

  const sections: ShelfSection[] = [];
  const unclassified: string[] = [];
  let joinedTotal = 0;
  let recordTotal = 0;

  // **Two caches, because this runs on every render of `/repository` and the
  // owner's ai-ops#45 acceptance condition is about exactly that.** Neither
  // changes an answer; both stop one being computed hundreds of times.
  //
  // Measured on the production build before they were added: the shelf cost
  // `/repository` 14 ms of its 65 ms median. The cause was arithmetic, not
  // width — `roleFor` re-derived every record's topics once per role, so 346
  // records became 1038 derivations, and `processesTouching` walked all 23
  // contracts per joined record even though the 28 joined records resolve to
  // just **two** distinct states between them.
  const roleCache = new Map<string, TopicId | null>();
  const roleOnce = (record: IngredientCandidate): TopicId | null => {
    const hit = roleCache.get(record.slug);
    if (hit !== undefined) return hit;
    const role = roleFor(record);
    roleCache.set(record.slug, role);
    return role;
  };
  const touchCache = new Map<string, readonly TouchingProcess[]>();
  const touchOnce = (stateId: string): readonly TouchingProcess[] => {
    const hit = touchCache.get(stateId);
    if (hit !== undefined) return hit;
    const found = processesTouching(graph, vocabulary, stateId);
    touchCache.set(stateId, found);
    return found;
  };

  for (const role of OBJECT_ROLES) {
    const entries: ShelfEntry[] = [];
    const abstained = emptyCounts();
    let joined = 0;
    for (const record of records) {
      if (roleOnce(record) !== role) continue;
      recordTotal += 1;
      const join = ingredientJoin(record);
      if (join.kind === "unclassified") unclassified.push(record.slug);
      if (join.kind === "abstained") abstained[join.reason] += 1;
      const processes = join.kind === "joined" ? touchOnce(join.state) : [];
      if (join.kind === "joined") joined += 1;
      entries.push({
        slug: record.slug,
        title: record.title ?? record.slug,
        role,
        join,
        processes,
      });
    }
    entries.sort(
      (a, b) => b.processes.length - a.processes.length || a.slug.localeCompare(b.slug),
    );
    joinedTotal += joined;
    sections.push({ role, entries, joined, abstained });
  }

  return {
    sections,
    processDenominator: contractedProcessCount(graph),
    recordDenominator: recordTotal,
    joined: joinedTotal,
    unclassified,
  };
}

/**
 * The records that ARE a given state, for the state's own page.
 *
 * Transitive through `specializes`, deliberately: a reader on *Matrix you can
 * query* should see the Hamiltonians, because every one of them is one. That is
 * the same direction `stateSatisfies` allows everywhere else, and reading it the
 * other way — showing a broad object on a narrow state's page — is the claim
 * that would be false.
 */
export function recordsForState(
  records: readonly IngredientCandidate[],
  vocabulary: StateVocabulary,
  stateId: string,
): readonly IngredientCandidate[] {
  return records.filter((record) => {
    const join = ingredientJoin(record);
    if (join.kind !== "joined") return false;
    return kindsOf(vocabulary, join.state).has(stateId);
  });
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Everything that must be true of the join, as one function.
 *
 * **Lives here rather than in the checker**, for the reason
 * `check-layer-graph.mjs` gives about `validateLayerGraph`: the rules live in
 * one place and cannot drift, so `scripts/check-ingredients.mjs` and the unit
 * test are two callers of one implementation rather than two implementations
 * that agree today.
 *
 * The checks, and the failure each one is the only defence against:
 *
 * 1. **Unclassified.** An object record matched by neither table. Without this
 *    the join would silently shrink every time a content batch added a family,
 *    and a shelf that is quietly missing records looks exactly like a corpus
 *    that has none.
 * 2. **Double-claimed.** Two join rules, or a join and an abstention, on one
 *    record. A record with two states is the same defect as a record with two
 *    roles, and `deriveTopics` learned that the hard way.
 * 3. **A join to a state that does not exist.** A dead link is
 *    indistinguishable from an object nobody has documented.
 * 4. **A join to a state no process touches.** This is the one that matters
 *    most and the one nothing else would catch: a record joined to a state the
 *    graph neither consumes nor produces would publish "the map documents this"
 *    on a page where the map documents nothing. **A link that claims we cover
 *    something we do not is the worst thing this surface can do.**
 * 5. **A stale rule.** A rule matching no record in the corpus. Stale rules are
 *    invisible — they read as coverage — and `TOPIC_OVERRIDES` grew one within
 *    an hour of being written, which is why `check-repository-data.mjs` has the
 *    same check.
 *
 * ## What has been shown to fail, and what has not
 *
 * Checks 1, 2, 3 and 5 were mutation-tested **through the lint script against
 * the real corpus**: breaking a family string, joining an already-abstained tag,
 * and misspelling a state id each take `check-ingredients.mjs` to exit 1 with a
 * distinct message, and restoring takes it back to exit 0.
 *
 * **Check 4 was mutation-tested at the unit level only, and that is a real
 * limit rather than an oversight.** It cannot be made to fire against today's
 * graph by choosing a different state, because **every one of the 34 states is
 * consumed or produced by at least one process** — measured 2026-08-13, with
 * `history-state`, `hermitian-generator` and `runnable-evolution` reachable
 * through `specializes` even though no contract names them directly. So the only
 * way to exercise it is to take the contracts off the graph, which is what
 * `repository-ingredients.test.ts` does. The check is a guard for the moment a
 * state arrives that nothing touches — which is a live possibility while the map
 * is being decomposed — and until then it is proven, not exercised.
 */
export function validateIngredientJoin(
  records: readonly IngredientCandidate[],
  graph: LayerGraph,
  vocabulary: StateVocabulary,
): string[] {
  const errors: string[] = [];
  const stateIds = new Set(vocabulary.states.map((state) => state.id));
  const joinRuleHits = INGREDIENT_JOIN_RULES.map(() => 0);
  const abstainRuleHits = INGREDIENT_ABSTAIN_RULES.map(() => 0);

  for (const record of records) {
    const role = roleFor(record);
    if (!isObjectRole(role)) continue;

    const joins = INGREDIENT_JOIN_RULES.filter((rule, index) => {
      const hit = matches(rule, record);
      if (hit) joinRuleHits[index] += 1;
      return hit;
    });
    const abstains = INGREDIENT_ABSTAIN_RULES.filter((rule, index) => {
      const hit = matches(rule, record);
      if (hit) abstainRuleHits[index] += 1;
      return hit;
    });

    if (joins.length === 0 && abstains.length === 0) {
      errors.push(
        `${record.slug}: role ${role} and no ingredient rule claims it — join it to a state or abstain with a reason (family ${JSON.stringify(record.algorithmFamily)})`,
      );
      continue;
    }
    if (joins.length > 1) {
      errors.push(
        `${record.slug}: ${joins.length} join rules claim it — ${joins.map((rule) => rule.state).join(", ")}`,
      );
    }
    if (joins.length > 0 && abstains.length > 0) {
      errors.push(
        `${record.slug}: joined to ${joins[0]!.state} and abstained as ${abstains[0]!.reason} — one record, one answer`,
      );
    }
    if (abstains.length > 1) {
      errors.push(
        `${record.slug}: ${abstains.length} abstention rules claim it — ${abstains.map((rule) => rule.reason).join(", ")}`,
      );
    }

    for (const rule of joins) {
      if (!stateIds.has(rule.state)) {
        errors.push(`${record.slug}: joined to ${rule.state}, which is not a state in the vocabulary`);
        continue;
      }
      if (processesTouching(graph, vocabulary, rule.state).length === 0) {
        errors.push(
          `${record.slug}: joined to ${rule.state}, which no process consumes or produces — the link would claim the map covers this when it does not`,
        );
      }
    }
  }

  INGREDIENT_JOIN_RULES.forEach((rule, index) => {
    if (joinRuleHits[index] === 0) {
      errors.push(
        `join rule for ${JSON.stringify(rule.family ?? rule.slugAny ?? rule.tagAny)} → ${rule.state} matches no record in the corpus`,
      );
    }
  });
  INGREDIENT_ABSTAIN_RULES.forEach((rule, index) => {
    if (abstainRuleHits[index] === 0) {
      errors.push(
        `abstention rule for ${JSON.stringify(rule.family ?? rule.slugAny ?? rule.tagAny)} (${rule.reason}) matches no record in the corpus`,
      );
    }
  });

  return errors;
}
