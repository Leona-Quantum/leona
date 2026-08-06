import assert from "node:assert/strict";
import test from "node:test";
import {
  INTERFACE_STANCES,
  PIPELINE_STANCES,
  connectedCount,
  connects,
  deriveInterface,
  filterByStance,
  interfaceOptions,
  isInterfaceStance,
  isOnGraph,
  neighboursOf,
  nonPipelineStances,
  type EntryInterface,
  type InterfaceEvidence,
  declaresPort,
} from "./repository/interface.ts";
import type { TopicId } from "./repository/topics.ts";
import type { BlockRole, PublicRepositoryKnownGap } from "./repository/types.ts";

/**
 * What each entry takes and returns, and the three-valued predicate over it.
 *
 * **The corpus is not imported here**, for the reason `repository-topics.test.ts`
 * states: `public-repository.ts` reaches its entry modules with extensionless
 * specifiers and `node --test` resolves paths literally. The properties that are
 * *about* the 283 records — the stance census, the 414 compatible pairs, and the
 * 196 entries that meet nothing at either end — are asserted in
 * `scripts/check-repository-data.mjs`, which bundles with esbuild and runs in
 * `lint`.
 *
 * What is here is what synthetic evidence can pin, and the two to read twice are
 * `unknown` and the zero-assumption mutation: the first is the verdict this
 * whole design exists to keep separate from `compatible`, and a `connects` that
 * ignored `assumesZeroInput` would still satisfy every other test in this file.
 */

function evidence(overrides: Partial<InterfaceEvidence> = {}): InterfaceEvidence {
  return {
    slug: "fixture",
    topics: [],
    category: "algorithms",
    wireCount: 0,
    ...overrides,
  };
}

const GATE = (width: number): InterfaceEvidence =>
  evidence({ slug: `gate-${width}`, category: "gates", wireCount: width });

const STATE = (width: number): InterfaceEvidence =>
  evidence({
    slug: `state-${width}`,
    category: "states",
    topics: ["state"] as TopicId[],
    wireCount: width,
  });

const PROGRAM = (width: number): InterfaceEvidence =>
  evidence({
    slug: `program-${width}`,
    category: "algorithms",
    topics: ["benchmark-circuit"] as TopicId[],
    wireCount: width,
    portableCircuit: { qubitCount: width, steps: [{ gate: "H", qubits: [0] }], measure: true },
  });

/**
 * A record with no publishable interface that declares which edge its source
 * omits (§3.6). `role` is the only field this module may read — the prose is
 * filled in anyway so the fixture is a shape the guards would accept.
 */
const gap = (role: BlockRole): PublicRepositoryKnownGap => ({
  role,
  reason: "not_stated_in_source",
  detail: "The source does not state this, and the fixture says so at length.",
  detailJa: "出典に記載がありません。",
});

const HOLE = (width: number, ...roles: BlockRole[]): InterfaceEvidence =>
  evidence({
    slug: `hole-${roles.join("-")}-${width}`,
    category: "algorithms",
    topics: ["algorithm-reference"] as TopicId[],
    wireCount: width,
    knownGaps: roles.map(gap),
  });

test("a measuring circuit is a program: bits out, and a left edge that carries a caveat", () => {
  const program = deriveInterface(PROGRAM(4));
  assert.equal(program.stance, "program");
  assert.deepEqual(program.output, { type: "bits", width: 4 });
  // Not null. An absent input port would make `unknown` unreachable — see the
  // note on EntryInterface.assumesZeroInput.
  assert.deepEqual(program.input, { type: "qubits", width: 4 });
  assert.equal(program.assumesZeroInput, true);
});

test("a circuit that does not measure is a transform, and still assumes its input", () => {
  const held = deriveInterface(
    evidence({
      slug: "unmeasured",
      portableCircuit: { qubitCount: 3, steps: [{ gate: "H", qubits: [0] }], measure: false },
    }),
  );
  assert.equal(held.stance, "transform");
  assert.deepEqual(held.output, { type: "qubits", width: 3 });
  // The difference from a gate primitive, and the whole reason `compatible` is
  // rare: a published circuit was written to run from |0…0⟩.
  assert.equal(held.assumesZeroInput, true);
  assert.equal(connects(deriveInterface(GATE(3)), held), "unknown");
});

test("a gate primitive is the only thing that states no assumption about its input", () => {
  const gate = deriveInterface(GATE(2));
  assert.equal(gate.stance, "transform");
  assert.deepEqual(gate.input, { type: "qubits", width: 2 });
  assert.deepEqual(gate.output, { type: "qubits", width: 2 });
  assert.equal(gate.assumesZeroInput, false);
});

test("a record filed under gates is a transform even when its family reads as an operator", () => {
  // The two Paulis: category `gates`, algorithmFamily "Pauli operator", so the
  // R2 role facet classifies them `operator`. The census caught this — an
  // earlier draft consulted the role first and gave both of them no ports.
  const pauli = deriveInterface(
    evidence({ slug: "pauli-z-gate", category: "gates", topics: ["operator"] as TopicId[], wireCount: 1 }),
  );
  assert.equal(pauli.stance, "transform");
  assert.equal(isOnGraph(pauli), true);
});

test("an observable has a width and deliberately no ports", () => {
  const observable = deriveInterface(
    evidence({ slug: "h2", category: "operators", topics: ["operator"] as TopicId[], wireCount: 3 }),
  );
  assert.equal(observable.stance, "observable");
  assert.equal(observable.input, null);
  assert.equal(observable.output, null);
  assert.equal(isOnGraph(observable), false);
});

test("prose with no structure is undeclared, not a zero-width port", () => {
  const reference = deriveInterface(evidence({ slug: "shors-algorithm", wireCount: 0 }));
  assert.equal(reference.stance, "undeclared");
  assert.equal(isOnGraph(reference), false);

  // A record filed as a gate that states no wires at all: still no ports. A
  // zero-width port would compare equal to another zero-width port and read as
  // a match between two records that describe nothing.
  const widthless = deriveInterface(evidence({ slug: "odd", category: "gates", wireCount: 0 }));
  assert.equal(widthless.stance, "undeclared");
  assert.equal(widthless.output, null);
});

test("connects is three-valued, and compatible is the one that has to be earned", () => {
  const gate2 = deriveInterface(GATE(2));
  const state2 = deriveInterface(STATE(2));
  const program2 = deriveInterface(PROGRAM(2));

  // Earned: shapes match and the consumer states no assumption.
  assert.equal(connects(state2, gate2), "compatible");
  assert.equal(connects(gate2, gate2), "compatible");

  // Shapes match, consumer assumed |0…0⟩. Not a weaker incompatible.
  assert.equal(connects(state2, program2), "unknown");
  assert.equal(connects(gate2, program2), "unknown");

  // Bits never feed qubits. Every one of the corpus's 120 circuits ends here.
  assert.equal(connects(program2, gate2), "incompatible");
  assert.equal(connects(program2, program2), "incompatible");

  // Width.
  assert.equal(connects(deriveInterface(GATE(3)), gate2), "incompatible");

  // Nothing to compare at one end.
  assert.equal(connects(gate2, state2), "off-graph");
  assert.equal(connects(deriveInterface(evidence()), gate2), "off-graph");
});

test("a malformed circuit width falls through rather than entering the graph", () => {
  // Reaches this function from the catalog API as well as from the bundled
  // corpus, and only the second is audited at build time.
  for (const qubitCount of [0, -3, 2.5, Number.NaN]) {
    const derived = deriveInterface(
      evidence({
        slug: "malformed",
        portableCircuit: { qubitCount, steps: [{ gate: "H", qubits: [0] }], measure: true },
      }),
    );
    assert.equal(derived.stance, "undeclared", `qubitCount ${qubitCount} produced a port`);
    assert.equal(isOnGraph(derived), false);
  }
  // A malformed circuit on a record that DOES state wires falls through to the
  // wire count rather than to nothing — the record still describes a 2-qubit
  // gate, and only its circuit is unreadable.
  const salvaged = deriveInterface(
    evidence({
      slug: "malformed-gate",
      category: "gates",
      wireCount: 2,
      portableCircuit: { qubitCount: 0, steps: [], measure: true },
    }),
  );
  assert.equal(salvaged.stance, "transform");
  assert.deepEqual(salvaged.output, { type: "qubits", width: 2 });
});

test("ignoring the zero-assumption would turn every honest unknown into a green check", () => {
  // The mutation this file exists to catch. `connects` differs from a
  // shapes-only checker on exactly the pairs where the shapes DO match, so a
  // fixture whose widths differ cannot observe the difference — it is
  // `incompatible` either way — and neither can one whose ports never meet.
  //
  // No corpus figure in the title on purpose: the population it would name is
  // computed in `check-repository-data.mjs`, nothing here asserts it, and a
  // number with no source in the file that states it drifts silently.
  const shapesOnly = (producer: EntryInterface, consumer: EntryInterface) =>
    producer.output && consumer.input
      ? producer.output.type === consumer.input.type && producer.output.width === consumer.input.width
        ? "compatible"
        : "incompatible"
      : "off-graph";

  const state = deriveInterface(STATE(4));
  const program = deriveInterface(PROGRAM(4));
  assert.equal(shapesOnly(state, program), "compatible");
  assert.notEqual(connects(state, program), shapesOnly(state, program));
  assert.equal(connects(state, program), "unknown");

  // And where there is genuinely nothing undischarged, the two agree — so the
  // predicate is not just refusing everything.
  const gate = deriveInterface(GATE(4));
  assert.equal(connects(state, gate), shapesOnly(state, gate));
});

test("neighbours are split by end, sorted compatible-first, and never dropped", () => {
  const corpus = new Map([
    ["gate-a", deriveInterface(GATE(2))],
    ["state-a", deriveInterface(STATE(2))],
    ["program-a", deriveInterface(PROGRAM(2))],
    ["wide-gate", deriveInterface(GATE(9))],
    ["prose", deriveInterface(evidence({ slug: "prose" }))],
  ]);
  const subject = deriveInterface(GATE(2));
  const { upstream, downstream } = neighboursOf("gate-a", subject, corpus);

  // Upstream: everything of width 2 that returns qubits. The program returns
  // bits, so it is not here even though it is the same width.
  assert.deepEqual(upstream, [
    { slug: "state-a", verdict: "compatible" },
  ]);
  // Downstream: the program IS here, and as `unknown` rather than omitted —
  // dropping it would be the exact silent-narrowing this predicate exists to
  // prevent, and it would look identical to "nothing follows this".
  assert.deepEqual(downstream, [
    { slug: "program-a", verdict: "unknown" },
  ]);

  // Compatible sorts ahead of unknown, whatever the slugs.
  const twoWays = new Map([
    ["zzz-gate", deriveInterface(GATE(2))],
    ["aaa-program", deriveInterface(PROGRAM(2))],
  ]);
  const mixed = neighboursOf("subject", deriveInterface(STATE(2)), twoWays).downstream;
  assert.deepEqual(mixed.map((partner) => partner.verdict), ["compatible", "unknown"]);

  // The subject never appears among its own neighbours, even though a gate is
  // compatible with a gate of the same width.
  const selfish = neighboursOf("gate-a", subject, corpus);
  assert.equal([...selfish.upstream, ...selfish.downstream].some((p) => p.slug === "gate-a"), false);
});

test("the control offers only stances the entries in hand carry, in vocabulary order", () => {
  const corpus = new Map([
    ["p", deriveInterface(PROGRAM(3))],
    ["g", deriveInterface(GATE(3))],
    ["g2", deriveInterface(GATE(1))],
  ]);
  // No source, no observable, no undeclared here — and none offered. Selecting
  // one would empty the list under a label promising rows.
  assert.deepEqual(interfaceOptions(corpus), [
    { stance: "transform", count: 2 },
    { stance: "program", count: 1 },
  ]);
});

test("filtering by stance keeps entry order and an unknown value keeps nothing", () => {
  const rows = [{ slug: "g" }, { slug: "p" }, { slug: "g2" }];
  const corpus = new Map([
    ["g", deriveInterface(GATE(2))],
    ["p", deriveInterface(PROGRAM(2))],
    ["g2", deriveInterface(GATE(4))],
  ]);
  assert.deepEqual(filterByStance(rows, corpus, "transform").map((r) => r.slug), ["g", "g2"]);
  assert.deepEqual(filterByStance(rows, corpus, "").map((r) => r.slug), ["g", "p", "g2"]);
  // A row the map does not know is not silently kept: an entry whose interface
  // could not be derived is not an entry of every stance.
  assert.deepEqual(filterByStance([...rows, { slug: "ghost" }], corpus, "program").map((r) => r.slug), ["p"]);
});

test("connectedCount counts an entry once and counts unknown as meeting", () => {
  const corpus = new Map([
    ["state", deriveInterface(STATE(2))],
    ["gate", deriveInterface(GATE(2))],
    ["program", deriveInterface(PROGRAM(2))],
    // Width 7: declares ports, meets nothing. The 75 entries this stands for are
    // why the browse heading carries two numbers rather than one.
    ["lonely", deriveInterface(GATE(7))],
  ]);
  assert.equal(connectedCount(corpus), 3);
  // Every one of them has a port, so "has a port" and "meets something" are
  // different questions — the property the heading depends on.
  assert.equal([...corpus.values()].filter(isOnGraph).length, 4);

  // Drop the two that can produce a `compatible` verdict and the program still
  // counts as met, via `unknown` alone.
  assert.equal(
    connectedCount(new Map([["state", deriveInterface(STATE(2))], ["program", deriveInterface(PROGRAM(2))]])),
    2,
  );
});

test("the stance vocabulary is closed", () => {
  assert.equal(new Set(INTERFACE_STANCES).size, INTERFACE_STANCES.length);
  for (const stance of INTERFACE_STANCES) assert.equal(isInterfaceStance(stance), true);
  assert.equal(isInterfaceStance("composable"), false);
  assert.equal(isInterfaceStance(undefined), false);
  // Every stance the derivation can produce is in the published vocabulary —
  // otherwise a filter built from the vocabulary silently omits a class.
  const produced = new Set([
    deriveInterface(GATE(1)).stance,
    deriveInterface(STATE(1)).stance,
    deriveInterface(PROGRAM(1)).stance,
    deriveInterface(evidence({ category: "operators", topics: ["operator"] as TopicId[], wireCount: 2 })).stance,
    deriveInterface(evidence()).stance,
    deriveInterface(HOLE(3, "readout")).stance,
  ]);
  assert.equal(produced.size, INTERFACE_STANCES.length);
  for (const stance of produced) assert.ok(INTERFACE_STANCES.includes(stance));
});

test("the browse groups cover the vocabulary and neither names a stance that is gone", () => {
  // The direction the complement cannot catch: a member of PIPELINE_STANCES the
  // vocabulary no longer has. It would be silently dropped from the group it
  // names AND excluded from the complement, so the control would look complete.
  for (const stance of PIPELINE_STANCES) {
    assert.ok(
      INTERFACE_STANCES.includes(stance),
      `PIPELINE_STANCES names ${stance}, which is not in the vocabulary`,
    );
  }
  // And between them the two groups are every stance, exactly once.
  const covered = [...PIPELINE_STANCES, ...nonPipelineStances()];
  assert.equal(covered.length, INTERFACE_STANCES.length);
  assert.deepEqual(new Set(covered), new Set(INTERFACE_STANCES));
  // Not a vacuous split: both sides are non-empty on the real vocabulary.
  assert.ok(PIPELINE_STANCES.size > 0);
  assert.ok(nonPipelineStances().length > 0);
});

// --- §3.6's declared hole ----------------------------------------------------
//
// The stance exists to keep two silences apart, and every test below is about
// one of the ways they could quietly collapse back together.

test("a declared edge gap is a hole, and a bare literature record is not", () => {
  const hole = deriveInterface(HOLE(3, "readout"));
  assert.equal(hole.stance, "declared-hole");
  // No port. The record publishes no gate sequence, and inventing one from the
  // wire count is the guess in the hole §3.6 forbids.
  assert.equal(hole.output, null);
  assert.equal(hole.input, null);
  // What it does publish is the register, and that is what bounds the graph.
  assert.deepEqual(hole.outputHole, { width: 3 });
  assert.equal(hole.inputHole, null);

  // The same record without the declaration. Identical evidence otherwise, and
  // it must NOT read as a hole: absence cannot say "the paper omits this".
  const bare = deriveInterface(
    evidence({ category: "algorithms", topics: ["algorithm-reference"] as TopicId[], wireCount: 3 }),
  );
  assert.equal(bare.stance, "undeclared");
  assert.equal(bare.outputHole, null);
});

test("a gap in the middle of a block is a gap and not an edge", () => {
  // `problem` and `algorithm` are real declared gaps that the entry page
  // renders. They say nothing about whether anything could meet this block, so
  // they must not put it on the graph — otherwise the stance drifts from "an
  // edge is missing" to "this record has any gap at all", and the filter starts
  // offering records nothing can connect to.
  for (const role of ["problem", "algorithm"] as BlockRole[]) {
    const middle = deriveInterface(HOLE(3, role));
    assert.equal(middle.stance, "undeclared", `${role} should not open an edge`);
    assert.equal(isOnGraph(middle), false);
  }
  // And a record declaring both a middle gap and an edge gap is still a hole.
  assert.equal(deriveInterface(HOLE(3, "problem", "input")).stance, "declared-hole");
});

test("a hole is a candidate at the width it publishes, and nowhere else", () => {
  const hole = deriveInterface(HOLE(3, "readout"));
  // Feeds a 3-wide consumer: shapes cannot be compared past the width, so this
  // is the reachable middle rather than a green check.
  assert.equal(connects(hole, deriveInterface(GATE(3))), "unknown");
  assert.equal(connects(hole, deriveInterface(PROGRAM(3))), "unknown");
  // A width mismatch is a refutation, not an excuse. The register size IS
  // stated, so it can say no — and this is the assertion that keeps one
  // authored gap from making the whole catalogue look connectable: without it
  // the hole met 149 entries instead of 18, and the browse heading went from
  // "87 of 283 meet another entry" to 163.
  assert.equal(connects(hole, deriveInterface(GATE(4))), "incompatible");
  // Nothing reaches it from the left: only its readout is declared missing.
  assert.equal(connects(deriveInterface(STATE(3)), hole), "off-graph");
  // The mirror case, so neither side is special-cased into working.
  const inHole = deriveInterface(HOLE(3, "input_mapping"));
  assert.equal(connects(deriveInterface(STATE(3)), inHole), "unknown");
  assert.equal(connects(deriveInterface(STATE(5)), inHole), "incompatible");
  assert.equal(connects(inHole, deriveInterface(GATE(3))), "off-graph");
});

test("two holes are not a pair, and a hole with no width is not on the graph", () => {
  // A candidate needs something to be a candidate FOR. Two records that both
  // say "this edge is unstated" have not described a pair, and calling it
  // `unknown` would let holes multiply into a graph of their own.
  const producer = deriveInterface(HOLE(3, "readout"));
  const consumer = deriveInterface(HOLE(3, "input"));
  assert.equal(connects(producer, consumer), "off-graph");

  // A record that declares a gap and publishes no register keeps the stance —
  // the disclosure is true whether or not there is a width — but has no edge to
  // meet anything with. Stance and graph membership are different questions.
  const widthless = deriveInterface(HOLE(0, "readout"));
  assert.equal(widthless.stance, "declared-hole");
  assert.equal(widthless.outputHole, null);
  assert.equal(isOnGraph(widthless), false);
  assert.equal(connects(widthless, deriveInterface(GATE(3))), "off-graph");
});

test("a hole is on the graph without declaring a port", () => {
  // The two questions the browse heading asks separately, and the reason
  // `declaresPort` exists: its sentence says "declare ports", and a hole does
  // not. `isOnGraph` gates whether the entry page renders a partner list, and
  // a hole has partners.
  const hole = deriveInterface(HOLE(3, "readout"));
  assert.equal(isOnGraph(hole), true);
  assert.equal(declaresPort(hole), false);
  const gate = deriveInterface(GATE(3));
  assert.equal(isOnGraph(gate), true);
  assert.equal(declaresPort(gate), true);
});

test("a hole never earns compatible, however the pair is arranged", () => {
  // The invariant that keeps `compatible` meaning something, asserted against
  // the new stance directly: a hole withholds the port type and everything a
  // type does not carry, so no arrangement of it may produce a green check.
  const holes = [HOLE(2, "readout"), HOLE(2, "input"), HOLE(2, "output"), HOLE(2, "input_mapping")]
    .map(deriveInterface);
  const others = [GATE(2), STATE(2), PROGRAM(2), GATE(3)].map(deriveInterface);
  for (const hole of holes) {
    for (const other of others) {
      assert.notEqual(connects(hole, other), "compatible");
      assert.notEqual(connects(other, hole), "compatible");
    }
  }
});

test("a hole counts as meeting, and the count does not double it", () => {
  const corpus = new Map([
    ["hole", deriveInterface(HOLE(2, "readout"))],
    ["gate", deriveInterface(GATE(2))],
    // Width 5: nothing here meets it, including the hole.
    ["lonely", deriveInterface(GATE(5))],
  ]);
  assert.equal(connectedCount(corpus), 2);
  const neighbours = neighboursOf("hole", corpus.get("hole")!, corpus);
  assert.deepEqual(neighbours.downstream, [{ slug: "gate", verdict: "unknown" }]);
  assert.deepEqual(neighbours.upstream, []);
});

test("the hole stance is offered as a pipeline stage", () => {
  // Filing it under "not a pipeline stage" would put the corpus's inventory of
  // silences beside the pipeline rather than in it — §3.6's whole argument is
  // that a declared hole is a candidate.
  assert.ok(PIPELINE_STANCES.has("declared-hole"));
  assert.ok(!nonPipelineStances().includes("declared-hole"));
  const options = interfaceOptions(
    new Map([["h", deriveInterface(HOLE(2, "readout"))], ["g", deriveInterface(GATE(2))]]),
  );
  assert.deepEqual(options, [
    { stance: "transform", count: 1 },
    { stance: "declared-hole", count: 1 },
  ]);
});
