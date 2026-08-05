// What each entry takes and what it returns, and what that means for whether
// two of them connect.
//
// ## Why this exists
//
// The owner's direction for the repository is composition: "algorithm
// development like legos… people can make their own legos, connect them in ways
// they want while also having options that already fit with each other from
// literature." A left-hand and a right-hand edge per entry, and a reader who can
// see which edges meet.
//
// Nothing on `/repository` said what an entry takes or returns. The corpus was
// filed by what each record *is* (category, and since R2 the `role` facet) and
// never by what it *does to a register*, which is the only question composition
// asks.
//
// ## What measuring the corpus first said, because it changed this module
//
// Three counts, taken over all 283 published records before any of this was
// designed:
//
// 1. **All 120 published circuits end in a measurement.** `measure: true` on
//    every one, no exceptions. So all 120 return classical bits — and nothing in
//    the corpus consumes classical bits, because every circuit begins on
//    |0…0⟩. As published, none of the 120 is a stage; each is a whole program.
// 2. **The 163 records with no circuit are where composition would live** — 29
//    gate primitives, 13 states, 60 observables, 61 prose references — and only
//    the first two publish anything a machine can read as an interface.
// 3. **38 of 283 entries appear in at least one connectable pair.** The other
//    245 connect to nothing, and that is a fact about the corpus rather than a
//    gap in this classifier.
//
// That is why this module is shaped as a *classifier with a large honest
// bottom class* rather than as a graph builder. A "connections" feature over
// this corpus that did not say 245 of 283 are unconnected would be describing a
// different catalogue.
//
// ## The rule that keeps a connection honest
//
// The roadmap's §6 warning is the sharpest one in it: two blocks whose register
// shapes match can still be incomposable, through a basis convention, an
// unstated normalisation, an assumed ancilla state, a phase convention, or a
// precondition on the input. **A checker that validates only shapes passes
// compositions that are physically wrong**, and a green check that proves
// nothing is worse than no check.
//
// So `connects()` is three-valued and `compatible` has to be *earned*: shapes
// match AND the consumer states no assumption about what its input is. Exactly
// one class of entry in this corpus earns it — a gate primitive, which is a
// unitary and applies to any state of its register by definition. A circuit
// written to start from |0…0⟩ has an undischarged precondition the moment you
// hand it something else, so it is `unknown`, never `incompatible` and never
// `compatible`.
//
// ## Derived on read, like R1, and for the same reason
//
// Nothing here is stored, and no field is added to a record. Every input this
// module reads is already in the browse-list projection, so there is no API
// change, no contract bump, no migration, and — the trap session 78 hit — no
// second deploy to re-import the corpus. A stored interface and a published
// circuit are two things that can disagree, and the one a reader is looking at
// is the circuit.

// Explicit `.ts` on the value import: this module is reachable from a
// `node --test` entry point, which strips types but resolves paths literally.
// The type-only import above it is erased before resolution and needs none.
import type { PortableCircuit } from "../circuit-frameworks";
import { roleOf, type TopicId } from "./topics.ts";

/**
 * What an entry does to a register, and the reason it is one word rather than a
 * pair of ports: three of the five stances have no meaningful port at one end,
 * and a reader needs to know *why* an edge is blank before they need its width.
 */
export type InterfaceStance =
  /** Prepares a named state from nothing. No input; qubits out. */
  | "source"
  /** A unitary primitive. Same register in and out; no assumption about it. */
  | "transform"
  /** A whole program: begins on |0…0⟩, ends in measurement. Bits out. */
  | "program"
  /** An observable or Hamiltonian. Measured *with*, never applied as a stage. */
  | "observable"
  /** Prose only. Nothing machine-readable to read an interface off. */
  | "undeclared";

/** What travels on a port. Two types, and they never convert into each other. */
export type PortType = "qubits" | "bits";

export interface Port {
  type: PortType;
  /**
   * How wide, in qubits or bits. Never null: a port whose width is unknown is
   * not a port this module publishes, because the whole use of a width is
   * comparing it to another one.
   */
  width: number;
}

export interface EntryInterface {
  stance: InterfaceStance;
  /** Null when the entry takes nothing (a source) or declares nothing. */
  input: Port | null;
  /** Null when the entry returns nothing a next stage could take. */
  output: Port | null;
  /**
   * Whether this entry's meaning depends on its input being the all-zero state.
   *
   * The load-bearing field. It is what stops a width match from being read as a
   * proof, and it is true for everything in this corpus except a gate
   * primitive: a VQE ansatz applied to something other than |0…0⟩ is still a
   * defined circuit, and it is no longer the thing the entry describes — its
   * published outcomes were measured from |0…0⟩.
   *
   * **This is why a program has an input port at all.** The first draft gave it
   * none, on the reading that a circuit starting from |0…0⟩ takes nothing. The
   * census over the corpus is what refuted it: with no input port, `unknown`
   * became unreachable — the whole three-valued predicate collapsed to two
   * values and the honest middle case, the one roadmap §6 says is the common
   * one, could not be produced by any pair of the 283 records. A program does
   * have a left-hand edge; what is true is that its stated behaviour assumed
   * what was on it.
   */
  assumesZeroInput: boolean;
}

/**
 * Whether one entry's output can feed another's input.
 *
 * `unknown` is the common case and must render as such — not as a
 * warning-coloured near-miss, and never rounded up to `compatible`.
 */
export type Connection = "compatible" | "incompatible" | "unknown" | "off-graph";

/**
 * The evidence a derivation may read.
 *
 * Narrow on purpose, and narrower than it could be: no prose. `description` and
 * the long-form explanation are rewritten by content passes that are not
 * thinking about composition, so a rule keyed off a phrase in them silently
 * reclassifies records when the copy is edited. Everything here was written as
 * structure — a published gate sequence, a wire list, a family label.
 */
export interface InterfaceEvidence {
  slug: string;
  /** The R2 role facet. The vocabulary the corpus is already classified against. */
  topics: readonly TopicId[];
  /** Fallback when no role rule claimed the entry. */
  category: string;
  /** `visualization.wires.length` — the only width a circuit-less record states. */
  wireCount: number;
  portableCircuit?: PortableCircuit;
}

/**
 * A role that means "this is a unitary primitive".
 *
 * One member, and the narrowness is the point: this is the only class in the
 * corpus that earns a `compatible` verdict, so widening it widens what the site
 * claims to know. A new role here is a decision about evidence, not a tidy-up.
 */
const TRANSFORM_ROLES: ReadonlySet<TopicId> = new Set<TopicId>(["gate-primitive"]);
const SOURCE_ROLES: ReadonlySet<TopicId> = new Set<TopicId>(["state"]);
const OBSERVABLE_ROLES: ReadonlySet<TopicId> = new Set<TopicId>(["operator"]);

/**
 * Category → stance, for records the role facet does not claim.
 *
 * The two classifications disagree on exactly two records, and the census is
 * what found them: `pauli-y-gate` and `pauli-z-gate` are filed under `gates`
 * and their `algorithmFamily` is "Pauli operator", so the role facet reads them
 * as observables and an earlier draft of this module gave both of them no ports
 * at all. A Pauli genuinely is both things — an operation you apply and an
 * observable you measure — so neither classification is wrong; the question is
 * which one a page showing a one-qubit gate diagram should answer.
 *
 * Hence the precedence in `deriveInterface`: **a record filed under `gates`
 * publishes an operation you apply, and that decides it.** The role facet
 * resolves everything else.
 */
const CATEGORY_STANCE: Readonly<Record<string, InterfaceStance>> = {
  gates: "transform",
  states: "source",
  operators: "observable",
};

/**
 * The interface this entry's own published structure supports.
 *
 * Precedence, and each step is a decision rather than a fallback:
 *
 * 1. **A published circuit outranks everything.** 112 of the 120 circuits are
 *    classified `benchmark-circuit` and the other 8 are not, but all 120 are the
 *    same kind of object — a gate sequence ending in a measurement — and what it
 *    does to a register is a fact about the sequence, not about the label above
 *    it.
 * 2. **A record filed under `gates` is a transform**, before the role facet is
 *    consulted, for the two Paulis described on `CATEGORY_STANCE`.
 * 3. **Then the role facet**, which is the vocabulary the corpus was classified
 *    against in R2 and should not be classified against twice.
 * 4. **Then the remaining categories**, then `undeclared`.
 */
export function deriveInterface(evidence: InterfaceEvidence): EntryInterface {
  const circuit = evidence.portableCircuit;
  // The same width guard the circuit-less path applies below, and it belongs
  // here for a reason the static corpus hides: `check-repository-data.mjs`
  // audits the bundled corpus, but this function also runs on records that
  // arrive from the catalog API at request time, where `from-catalog.ts` shape-
  // checks `portableCircuit` and never checks that its width is a width. A
  // zero-wide port compares equal to another zero-wide port and would read as a
  // match between two records that describe nothing.
  if (circuit && Number.isInteger(circuit.qubitCount) && circuit.qubitCount > 0) {
    const width = circuit.qubitCount;
    // The portable model has no per-step measurement and no classical control:
    // `measure` is one circuit-level flag meaning "measure every qubit at the
    // end". So a circuit either ends in bits over its whole register, or ends
    // holding a state.
    //
    // Every one of the 120 published circuits sets it. The `false` branch is
    // not dead code kept for symmetry — it is what a corpus that gains a
    // composable stage will arrive as, and it is the branch that would
    // otherwise be written in a hurry on the day that happens.
    if (circuit.measure) {
      return {
        stance: "program",
        // A left-hand edge, and a caveat on it rather than an absent edge. See
        // `assumesZeroInput` — this is the field the corpus census changed.
        input: { type: "qubits", width },
        output: { type: "bits", width },
        assumesZeroInput: true,
      };
    }
    return {
      stance: "transform",
      input: { type: "qubits", width },
      output: { type: "qubits", width },
      // A published circuit is written to run from |0…0⟩ even when it does not
      // measure. That is the difference between it and a gate primitive, and it
      // is the entire reason `compatible` is rare.
      assumesZeroInput: true,
    };
  }

  const role = roleOf(evidence.topics);
  const stance: InterfaceStance =
    evidence.category === "gates"
      ? "transform"
      : role && TRANSFORM_ROLES.has(role)
        ? "transform"
        : role && SOURCE_ROLES.has(role)
          ? "source"
          : role && OBSERVABLE_ROLES.has(role)
            ? "observable"
            : (CATEGORY_STANCE[evidence.category] ?? "undeclared");

  // A width of zero is not a register. It means the record states no wires at
  // all, and an interface with a zero-wide port would compare equal to another
  // one and read as a match.
  const width = evidence.wireCount;
  if (width <= 0) {
    return { stance: "undeclared", input: null, output: null, assumesZeroInput: false };
  }

  switch (stance) {
    case "transform":
      return {
        stance,
        input: { type: "qubits", width },
        output: { type: "qubits", width },
        // The one false in this module, and the only reason any pair is ever
        // `compatible`: a gate primitive is a unitary, and a unitary applies to
        // whatever state its register holds.
        assumesZeroInput: false,
      };
    case "source":
      return { stance, input: null, output: { type: "qubits", width }, assumesZeroInput: false };
    case "observable":
      // Deliberately no ports. An observable is not a stage in a pipeline: you
      // measure a state *with* it, you do not apply it and pass the result on.
      // Giving it a qubits→qubits interface because it has a width would put 60
      // records on the graph that cannot be composed with anything, which is
      // the false coverage R2's domain facet exists to avoid.
      return { stance, input: null, output: null, assumesZeroInput: false };
    default:
      return { stance: "undeclared", input: null, output: null, assumesZeroInput: false };
  }
}

function portsMatch(output: Port, input: Port): boolean {
  return output.type === input.type && output.width === input.width;
}

/**
 * Whether `producer`'s output can feed `consumer`'s input.
 *
 * The three-valued predicate from roadmap §6, with `compatible` earned rather
 * than assumed:
 *
 * | verdict | when |
 * |---|---|
 * | `off-graph` | one of them has no port at the relevant end |
 * | `incompatible` | the port types differ, or the widths do |
 * | `unknown` | they match, and the consumer states an assumption about its input that this producer does not discharge |
 * | `compatible` | they match, and the consumer states no such assumption |
 *
 * **`unknown` is not a weaker `incompatible`.** It means the shapes fit and
 * something unstated might not, which is the honest reading of every published
 * circuit in this corpus — and the case a UI is most tempted to round up.
 */
export function connects(producer: EntryInterface, consumer: EntryInterface): Connection {
  if (producer.output === null || consumer.input === null) return "off-graph";
  if (!portsMatch(producer.output, consumer.input)) return "incompatible";
  return consumer.assumesZeroInput ? "unknown" : "compatible";
}

/** Whether this entry has an edge that could ever meet another one. */
export function isOnGraph(entry: EntryInterface): boolean {
  return entry.input !== null || entry.output !== null;
}

/** One end of a connection, with the verdict that put it there. */
export interface InterfacePartner {
  slug: string;
  verdict: Extract<Connection, "compatible" | "unknown">;
}

export interface InterfaceNeighbours {
  /** Entries whose output can reach this entry's input. */
  upstream: InterfacePartner[];
  /** Entries this entry's output can reach. */
  downstream: InterfacePartner[];
}

/**
 * Everything in `corpus` that meets `subject` at either end.
 *
 * Takes already-derived interfaces rather than entries, so this module never
 * learns the shape of a catalogue record — and so the caller decides once, at
 * the top of a render, what the corpus is.
 *
 * `compatible` sorts ahead of `unknown` within each list, and the two are
 * returned in one array rather than two so a caller cannot render the
 * compatible ones and quietly drop the rest, which is the failure mode this
 * whole predicate exists to prevent.
 */
export function neighboursOf(
  subjectSlug: string,
  subject: EntryInterface,
  corpus: ReadonlyMap<string, EntryInterface>,
): InterfaceNeighbours {
  const upstream: InterfacePartner[] = [];
  const downstream: InterfacePartner[] = [];
  for (const [slug, other] of corpus) {
    if (slug === subjectSlug) continue;
    const inbound = connects(other, subject);
    if (inbound === "compatible" || inbound === "unknown") upstream.push({ slug, verdict: inbound });
    const outbound = connects(subject, other);
    if (outbound === "compatible" || outbound === "unknown") downstream.push({ slug, verdict: outbound });
  }
  const order = (partner: InterfacePartner) => (partner.verdict === "compatible" ? 0 : 1);
  const bySlug = (a: InterfacePartner, b: InterfacePartner) => order(a) - order(b) || a.slug.localeCompare(b.slug);
  return { upstream: upstream.sort(bySlug), downstream: downstream.sort(bySlug) };
}

/**
 * Vocabulary order, which is also the order the browse control offers.
 *
 * Ordered by where a stance sits in a pipeline — a source starts one, a
 * transform continues one, a program is a whole one — and then by the two that
 * are not in a pipeline at all. Not by how many entries carry each, which would
 * put `program` first and read as though the corpus is mostly composable.
 */
export const INTERFACE_STANCES: readonly InterfaceStance[] = [
  "source",
  "transform",
  "program",
  "observable",
  "undeclared",
];

export function isInterfaceStance(value: unknown): value is InterfaceStance {
  return typeof value === "string" && (INTERFACE_STANCES as readonly string[]).includes(value);
}

/**
 * The stances that are somewhere in a pipeline, as opposed to beside one.
 *
 * Exported so the browse control groups by membership here rather than by a
 * list written out again in JSX. A sixth stance added to the vocabulary and not
 * added to this set would otherwise belong to neither group and simply not
 * appear in the control — a filter silently missing a class of the corpus, which
 * is invisible in every other way. `stancesPartition` is the test that holds it.
 */
export const PIPELINE_STANCES: ReadonlySet<InterfaceStance> = new Set<InterfaceStance>([
  "source",
  "transform",
  "program",
]);

/**
 * The complement, computed rather than listed.
 *
 * This is what makes the control safe to extend: the second group is *whatever
 * is not in the first*, so a new stance lands in "Not a pipeline stage" — wrong,
 * perhaps, but on screen with a count beside it, where the next reader sees it.
 * Two hand-written lists would have let it fall between them and disappear.
 *
 * A test asserts the reverse direction, which is the one no structure catches:
 * a member of `PIPELINE_STANCES` that the vocabulary no longer has.
 */
export function nonPipelineStances(): InterfaceStance[] {
  return INTERFACE_STANCES.filter((stance) => !PIPELINE_STANCES.has(stance));
}

export interface InterfaceOption {
  stance: InterfaceStance;
  /** How many of the entries offered carry it. Never zero — see `interfaceOptions`. */
  count: number;
}

/**
 * How many entries meet at least one other entry at either end, on either the
 * `compatible` or the `unknown` verdict.
 *
 * **Not the same number as "has a port", and the gap is the point.** On today's
 * corpus 162 of 283 declare ports and **87** meet anything — 38 of them in a
 * `compatible` pair, 71 in an `unknown` one, 22 in both. The other 75 declare a
 * port that is the only one of its width and type in the catalogue. A control
 * that published only the 162 would read as a parts bin.
 *
 * Both verdicts count, deliberately. `unknown` means the edges meet and
 * something unstated might not, so a reader looking for what to put beside an
 * entry does have somewhere to look — this number is "how many entries have a
 * neighbour to consider", not "how many compositions are proven", and nothing
 * downstream may present it as the second.
 *
 * O(n²) over the corpus, called once per listing behind a memo. 80k integer
 * comparisons, which is cheaper than any of the fetches on the page.
 */
export function connectedCount(interfaces: ReadonlyMap<string, EntryInterface>): number {
  const met = new Set<string>();
  for (const [producerSlug, producer] of interfaces) {
    for (const [consumerSlug, consumer] of interfaces) {
      if (producerSlug === consumerSlug) continue;
      const verdict = connects(producer, consumer);
      if (verdict === "compatible" || verdict === "unknown") {
        met.add(producerSlug);
        met.add(consumerSlug);
      }
    }
  }
  return met.size;
}

/**
 * The stances a control may offer, counted against the entries in hand.
 *
 * A stance no entry carries is not offered, for the reason `topicOptions` gives:
 * selecting it would empty the list, and an empty list reads as "the corpus has
 * nothing like this" when the truth is "nothing here, under the filters already
 * applied".
 */
export function interfaceOptions(
  interfaces: ReadonlyMap<string, EntryInterface>,
): InterfaceOption[] {
  const counts = new Map<InterfaceStance, number>();
  for (const derived of interfaces.values()) {
    counts.set(derived.stance, (counts.get(derived.stance) ?? 0) + 1);
  }
  return INTERFACE_STANCES.filter((stance) => (counts.get(stance) ?? 0) > 0).map((stance) => ({
    stance,
    count: counts.get(stance) ?? 0,
  }));
}

/**
 * Entries whose derived stance is `stance`, or all of them when none is
 * selected.
 *
 * `""` for "no filter", and an unknown value filters to nothing rather than to
 * everything — both for the reasons `filterByTopic` states, and they are the
 * same reasons because a reader arriving from a stale bookmark cannot tell the
 * two behaviours apart except by being shown a list that is wrong.
 */
export function filterByStance<T extends { slug: string }>(
  entries: readonly T[],
  interfaces: ReadonlyMap<string, EntryInterface>,
  stance: InterfaceStance | "",
): T[] {
  if (!stance) return [...entries];
  return entries.filter((entry) => interfaces.get(entry.slug)?.stance === stance);
}
