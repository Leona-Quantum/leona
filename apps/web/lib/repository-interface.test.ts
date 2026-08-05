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
} from "./repository/interface.ts";
import type { TopicId } from "./repository/topics.ts";

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

test("ignoring the zero-assumption would turn 390 honest unknowns into green checks", () => {
  // The mutation this file exists to catch. `connects` differs from a
  // shapes-only checker on exactly the pairs where the shapes DO match, so a
  // fixture whose widths differ cannot observe the difference — it is
  // `incompatible` either way — and neither can one whose ports never meet.
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
