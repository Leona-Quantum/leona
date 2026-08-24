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
// Three counts, taken over the then-283 published records (measured 2026-07)
// before any of this was designed:
//
// 1. **All 120 published circuits end in a measurement.** `measure: true` on
//    every one, no exceptions. So all 120 return classical bits — and nothing in
//    the corpus consumes classical bits, because every circuit begins on
//    |0…0⟩. As published, none of the 120 is a stage; each is a whole program.
// 2. **The 163 records with no circuit are where composition would live** — 29
//    gate primitives, 13 states, 60 observables, 61 prose references — and only
//    the first two publish anything a machine can read as an interface.
// 3. **38 of the then-283 entries appear in at least one connectable pair.** The
//    other 245 connect to nothing, and that is a fact about the corpus rather
//    than a gap in this classifier.
//
// That is why this module is shaped as a *classifier with a large honest
// bottom class* rather than as a graph builder. A "connections" feature over
// this corpus that did not say 245 of the then-283 are unconnected would be
// describing a different catalogue.
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
import type { BlockRole, PublicRepositoryKnownGap } from "./types";

/**
 * What an entry does to a register, and the reason it is one word rather than a
 * pair of ports: four of the six stances have no meaningful port at one end,
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
  /**
   * Nothing machine-readable to read an interface off, **and the record says
   * which role is missing and why** (§3.6's `knownGaps`).
   *
   * The distinction from `undeclared` is the whole point and it is a claim about
   * evidence, not a shade of the same thing. `undeclared` is read off *absence*
   * — no circuit, no wires — and absence cannot say "the paper does not specify
   * the state preparation" and be believed. A declared hole is a positive
   * statement by somebody who read the source, carrying a role, a reason and a
   * citation, and §3.6's rule is that it is a **contribution** rather than a
   * defect:
   *
   * > A block may ship with a hole. It may never ship with a guess in the hole.
   *
   * So it is a *candidate* for composition rather than a non-candidate, which is
   * what `connects()` below has to honour, and it groups with the pipeline
   * stances rather than beside them.
   */
  | "declared-hole"
  /** Prose only. Nothing machine-readable, and nobody said why. */
  | "undeclared";

/**
 * The declared-gap roles that are about an *edge* rather than about the middle.
 *
 * §3.1's six roles run problem → input → input_mapping → algorithm → readout →
 * output. Four of them describe what crosses a boundary; `problem` and
 * `algorithm` describe what happens inside one. A gap in the middle is a real
 * gap and renders as one on the entry page — it just says nothing about whether
 * anything could meet this block, so it must not put the record on the graph.
 *
 * Split by side, because a hole on the left and a hole on the right are
 * different candidacies: a record whose input mapping is unstated might consume
 * something, and a record whose readout is unstated might produce something.
 * Collapsing them would make every declared hole a candidate in both directions
 * and double a set whose whole value is that it is small.
 */
const INPUT_HOLE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(["input", "input_mapping"]);
const OUTPUT_HOLE_ROLES: ReadonlySet<BlockRole> = new Set<BlockRole>(["readout", "output"]);

/** What travels on a port. Two types, and they never convert into each other. */
export type PortType = "qubits" | "bits";

/**
 * A declared hole at one edge: **a width and nothing else.**
 *
 * The width is not a guess and not an inference — it is `visualization.wires`,
 * which the record publishes, and which this module already trusts for every
 * circuit-less transform, source and observable. What the gap declaration
 * withholds is the rest of the port: whether that edge carries qubits or bits,
 * and whether anything meeting it composes.
 *
 * Carrying the width is what keeps a hole from meaning *everything*. The first
 * cut of this modelled a hole as a bare flag, and one authored gap on
 * `vqe-ssvqe` then made the browse heading read "163 of the then-283 meet
 * another entry" against 87 the day before — the 75 records whose port is the only one of its
 * width in the catalogue all acquired a partner, because a hole with no width
 * is a candidate for the whole corpus. That is the parts-bin reading this
 * module's header refuses. A width mismatch against a hole is therefore a real
 * `incompatible`: the register size IS stated, so it can refute.
 */
export interface Hole {
  width: number;
}

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
   * A **declared** hole at that edge rather than an absence — §3.6, and the
   * reason `connects()` has a middle value here at all.
   *
   * Two records with no left-hand port look identical to this module: a prose
   * reference that never described one, and a block whose author read the paper
   * and recorded that it does not state the input encoding. The first is not on
   * the graph. The second is a slot somebody could fill, and saying `off-graph`
   * about it publishes the opposite of what the record says.
   *
   * **Never set beside a non-null port on the same side.** A port that exists
   * is the shape; a hole is the absence of one. If both were set the pair would
   * be compared *and* excused, and `unknown` would swallow verdicts that shape
   * comparison had already settled.
   */
  inputHole: Hole | null;
  outputHole: Hole | null;
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
   * one, could not be produced by any pair of the then-283 records (measured
   * 2026-07). A program does
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
  /**
   * The register, not the circuit. This function reads exactly `qubitCount` and
   * `measure` — grep the body, there is no third — and declaring the full
   * `PortableCircuit` here asked every caller for a `steps` array it would never
   * look at. That mattered once the browse list stopped carrying one: the list
   * projection sends `{qubitCount, measure}` (LIST_VIEW_PORTABLE_CIRCUIT_FIELDS
   * in catalog_read_model.py), and a signature demanding `steps` would have made
   * the honest payload the one that fails to typecheck.
   *
   * A full `PortableCircuit` still satisfies this, so the detail page's call
   * site is unchanged.
   */
  portableCircuit?: Pick<PortableCircuit, "qubitCount" | "measure">;
  /**
   * §3.6's declared holes. **Only `role` is read here, and that is a rule rather
   * than an implementation detail** — `detail` and `detailJa` are prose, and the
   * paragraph above says why no rule in this module may key off prose.
   *
   * Passed whole rather than pre-reduced to a role list because a caller that
   * did the reduction would be a second place the mapping lives, and the four
   * call sites would then have to agree about it. The type is the record's own,
   * so a caller cannot get it wrong by construction.
   */
  knownGaps?: readonly PublicRepositoryKnownGap[];
}

/**
 * No published interface, and whether the record says why.
 *
 * `width` is the record's stated register — `visualization.wires.length`, which
 * may be zero. A hole edge is only opened when it is a real width, on the same
 * terms every other branch of the derivation applies: a zero-wide edge compares
 * equal to another zero-wide edge and would read as a match between two records
 * that state nothing.
 *
 * **A record with a declared gap and no stated width still gets the stance.**
 * The stance is a claim about disclosure — somebody read the source and
 * recorded what is missing — and that is true whether or not the record happens
 * to publish a register. It is simply off the graph, which `isOnGraph` reports
 * correctly because it asks about the edges rather than about the stance.
 */
function withoutInterface(
  gaps: readonly PublicRepositoryKnownGap[] | undefined,
  width: number,
): EntryInterface {
  const roles = gaps?.map((gap) => gap.role) ?? [];
  // A gap in `problem` or `algorithm` is a real declared gap and the entry page
  // renders it — it is simply not an edge, so it does not put this record on
  // the graph and does not earn the stance. `declared-hole` means "an edge of
  // this block is named as missing", not "this record has any gap at all".
  const declaresInput = roles.some((role) => INPUT_HOLE_ROLES.has(role));
  const declaresOutput = roles.some((role) => OUTPUT_HOLE_ROLES.has(role));
  const usable = Number.isInteger(width) && width > 0;
  return {
    stance: declaresInput || declaresOutput ? "declared-hole" : "undeclared",
    input: null,
    output: null,
    inputHole: declaresInput && usable ? { width } : null,
    outputHole: declaresOutput && usable ? { width } : null,
    assumesZeroInput: false,
  };
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
 * 1. **A published circuit outranks everything.** What a gate sequence does to a
 *    register is a fact about the sequence, not about the label above it.
 *
 *    The evidence this rule was written on has since evaporated, and saying so
 *    is more useful than restating it. It read "112 of the 120 circuits are
 *    classified `benchmark-circuit` and the other 8 are not" — eight records
 *    where the circuit path and the label path would have disagreed, which is
 *    what made the precedence observable. Measured 2026-08-25 JST: **30 records
 *    carry a `portableCircuit`, all 30 are `benchmark-circuit`, and all 30 sit
 *    in `basic-circuits`.** Zero counterexamples, so this step currently changes
 *    no record's stance and is defence in depth rather than something doing
 *    work. Keep it — the next record that carries a circuit without the label is
 *    exactly what it is for — but do not cite the old figures as if they still
 *    stood.
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
        inputHole: null,
        outputHole: null,
        assumesZeroInput: true,
      };
    }
    return {
      stance: "transform",
      input: { type: "qubits", width },
      output: { type: "qubits", width },
      inputHole: null,
      outputHole: null,
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
    return withoutInterface(evidence.knownGaps, evidence.wireCount);
  }

  switch (stance) {
    case "transform":
      return {
        stance,
        input: { type: "qubits", width },
        output: { type: "qubits", width },
        inputHole: null,
        outputHole: null,
        // The one false in this module, and the only reason any pair is ever
        // `compatible`: a gate primitive is a unitary, and a unitary applies to
        // whatever state its register holds.
        assumesZeroInput: false,
      };
    case "source":
      return {
        stance,
        input: null,
        output: { type: "qubits", width },
        // A source takes nothing *by construction*, so its blank left edge is a
        // statement rather than a silence, and a declared gap does not turn it
        // into a slot. Same for the observable below: its blank edges are the
        // modelling decision on that branch, not missing evidence. Only the
        // no-interface case can carry a hole — see `withoutInterface`.
        inputHole: null,
        outputHole: null,
        assumesZeroInput: false,
      };
    case "observable":
      // Deliberately no ports. An observable is not a stage in a pipeline: you
      // measure a state *with* it, you do not apply it and pass the result on.
      // Giving it a qubits→qubits interface because it has a width would put 60
      // records on the graph that cannot be composed with anything, which is
      // the false coverage R2's domain facet exists to avoid.
      return { stance, input: null, output: null, inputHole: null, outputHole: null, assumesZeroInput: false };
    default:
      return withoutInterface(evidence.knownGaps, evidence.wireCount);
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
 * | `off-graph` | one of them has no port at the relevant end, and does not declare one missing |
 * | `unknown` | one end is a **declared hole** and the other publishes a port (§3.6) |
 * | `incompatible` | the port types differ, or the widths do |
 * | `unknown` | they match, and the consumer states an assumption about its input that this producer does not discharge |
 * | `compatible` | they match, and the consumer states no such assumption |
 *
 * **`unknown` is not a weaker `incompatible`.** It means the shapes fit and
 * something unstated might not, which is the honest reading of every published
 * circuit in this corpus — and the case a UI is most tempted to round up.
 *
 * **The declared-hole row is §3.6's ask and it is deliberately the narrowest
 * reading of it.** A hole earns `unknown` only against a partner that actually
 * publishes the port the pair would meet at. Hole-against-hole stays
 * `off-graph`: a candidate needs something to be a candidate *for*, and two
 * records that both say "this edge is unstated" have not described a pair. The
 * bound is not fastidiousness — `unknown` counts as *meeting* in
 * `neighboursOf`, `connectedCount` and the browse heading, so an unbounded
 * reading would put one declared hole beside all 162 ported records and turn
 * the graph into the parts bin this module's header refuses to be.
 */
export function connects(producer: EntryInterface, consumer: EntryInterface): Connection {
  // The right-hand end of the producer and the left-hand end of the consumer,
  // each of which is a port, a declared hole, or nothing at all.
  const right = producer.output ?? producer.outputHole;
  const left = consumer.input ?? consumer.inputHole;
  if (right === null || left === null) return "off-graph";
  // A candidate needs something to be a candidate FOR. Two records that both say
  // "this edge is unstated" have not described a pair, and admitting them would
  // let holes form a graph among themselves out of nothing but two wire counts.
  if (producer.outputHole !== null && consumer.inputHole !== null) return "off-graph";

  // Width first, and it is the one thing a hole still states — so a mismatch is
  // a refutation rather than an excuse. Only after it passes does the missing
  // half of the hole (the port type, and everything a type does not carry)
  // become the reason the verdict cannot be better than `unknown`.
  if (right.width !== left.width) return "incompatible";
  if (producer.outputHole !== null || consumer.inputHole !== null) return "unknown";

  // Two real ports from here on, so both are non-null by construction.
  if (!portsMatch(producer.output!, consumer.input!)) return "incompatible";
  return consumer.assumesZeroInput ? "unknown" : "compatible";
}

/** Which side of the piece. `in` is the left-hand edge, `out` the right. */
export type PortEnd = "in" | "out";

const PORT_ENDS: readonly PortEnd[] = ["in", "out"];

export function isPortEnd(value: unknown): value is PortEnd {
  return typeof value === "string" && (PORT_ENDS as readonly string[]).includes(value);
}

/**
 * What one end of a piece *is*, as a closed vocabulary rather than a sentence.
 *
 * The panel already renders a stance sentence for the block as a whole, and the
 * owner's ask is one level below it — *"people can click on either end to get a
 * preview of what it can take as input and what it can take as output"*. The
 * reason that needs its own vocabulary rather than a second prose field is
 * roadmap §0.5.2: a port note nobody sourced is a guess in a hole. Everything
 * here is **derived from the same fields `connects()` reads**, so no value can
 * assert something the record does not publish, and the six cases are exactly
 * the ones the block-level sentence collapses.
 *
 * The distinction that earns this: a blank edge has four different meanings —
 * a source starts a pipeline, an observable has no ports on purpose, a prose
 * record never published any, and a declared hole says the source withheld one.
 * All four render as an empty `Takes` line today.
 */
export type PortOutlook =
  /** A real port with no stated assumption on it. Anything of the width joins. */
  | "open"
  /** A real port whose entry's published behaviour was measured from |0…0⟩. */
  | "assumed"
  /** A real port carrying classical bits. Nothing in the corpus takes them. */
  | "terminal"
  /** §3.6: the edge is real and the source does not state its shape. */
  | "hole"
  /** No input port, and that absence is what `source` means. */
  | "start"
  /** No port here on purpose — an observable is measured with, never applied. */
  | "by-design"
  /** No port because the record publishes nothing to read one off. */
  | "undeclared";

/**
 * The reading for one end.
 *
 * Order matters and mirrors `connects()`: a hole is checked before a port
 * because §3.6 forbids both being set on one side, and reversing them would let
 * a future record with both silently render as a published port — the collapse
 * the whole field exists to stop.
 */
export function portOutlook(entry: EntryInterface, end: PortEnd): PortOutlook {
  if (end === "in") {
    if (entry.inputHole !== null) return "hole";
    if (entry.input !== null) return entry.assumesZeroInput ? "assumed" : "open";
    if (entry.stance === "source") return "start";
    return entry.stance === "observable" ? "by-design" : "undeclared";
  }
  if (entry.outputHole !== null) return "hole";
  // `assumesZeroInput` is deliberately not consulted here. It is a statement
  // about what this entry was fed, not about what it hands on, and reading it at
  // the output end would caveat the wrong edge.
  if (entry.output !== null) return entry.output.type === "bits" ? "terminal" : "open";
  return entry.stance === "observable" ? "by-design" : "undeclared";
}

/**
 * Whether this entry has an edge that could ever meet another one.
 *
 * A declared hole counts, and it has to: it is exactly the case where the edge
 * is real and its shape is not. `connects()` can return `unknown` for it, so an
 * entry page gated on this function would otherwise compute a partner list and
 * then decline to render it — the neighbours would exist and nobody would see
 * them.
 *
 * Which also means this is no longer "has a port". Any caller wanting that
 * narrower number must ask for the ports.
 */
export function isOnGraph(entry: EntryInterface): boolean {
  return (
    entry.input !== null ||
    entry.output !== null ||
    entry.inputHole !== null ||
    entry.outputHole !== null
  );
}

/** Ports only — the number the browse heading qualifies itself with (162 of the then-283, measured 2026-07). */
export function declaresPort(entry: EntryInterface): boolean {
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
  "declared-hole",
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
  // In the pipeline group on purpose, and it is the whole §3.6 argument in one
  // membership: a declared hole is a stage whose edge is named as missing, which
  // is a *candidate* for composition. Filing it under "not a pipeline stage"
  // would put the corpus's honest inventory of silences beside the pipeline
  // rather than in it — the same rounding-down `connects()` refuses.
  "declared-hole",
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
 * **Not the same number as "has a port", and the gap is the point.** As of
 * 2026-07, 162 of the then-283 declared ports and **87** met anything — 38 of them in a
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
