import assert from "node:assert/strict";
import test from "node:test";

import { resolveWorkedExamples } from "./repository/worked-example-resolution.ts";
import { WORKED_EXAMPLE_LINKS } from "./repository/worked-example-links.ts";

// Not imported: the live corpus and `isPlaceholderDiagram` are already
// exhaustively tested in repository-placeholder-diagrams.test.ts (the three
// signatures, and the corpus-wide census in
// scripts/check-placeholder-diagram-census.mjs). What this file owns is the
// separate claim: a record with no resolvable link gets nothing back from
// resolution, and that composes with stage 1's already-proven "a placeholder
// diagram draws no hero" to mean a placeholder record with no resolvable
// link shows nothing at all — nobody has to re-derive corpus access to see
// both halves hold.

test("a slug with no worked-example links at all resolves to nothing", () => {
  // Confirms the fixture assumption before relying on it: the map really
  // does not carry every slug.
  assert.equal("definitely-not-a-real-record-slug" in WORKED_EXAMPLE_LINKS, false);
  const resolved = resolveWorkedExamples("definitely-not-a-real-record-slug");
  assert.equal(resolved.hero, null);
  assert.deepEqual(resolved.components, []);
});

// A real record whose first link points at an exampleId not yet in
// WORKED_EXAMPLES used to be demonstrable with live data (abelian-hidden-subgroup,
// while shor-order-finding-15 and simon-2 were still being written). All 21
// examples the map points at landed 2026-09-15, and
// check-worked-example-links.mjs turned the exampleId cross-check into a
// hard error the same day — so a committed link that does not resolve is now
// provably absent from the corpus, not merely absent today. The skip branch
// in resolveWorkedExamples() that used to cover (an unresolved link is
// dropped rather than crashing) is dead in practice, but still real
// defensive code; every other test below exercises resolveWorkedExamples()
// against links that DO resolve, and "a slug with no links at all resolves
// to nothing" above covers the same return shape ({hero: null, components: []}).

test("a real record whose first resolvable link is instance gets a hero", () => {
  // bell-state-qiskit -> bell-pair, relation instance, and bell-pair is one
  // of the 14 examples already checked in.
  const resolved = resolveWorkedExamples("bell-state-qiskit");
  assert.ok(resolved.hero, "expected bell-state-qiskit to resolve a hero example");
  assert.equal(resolved.hero!.id, "bell-pair");
  assert.deepEqual(resolved.components, []);
});

test("a real record whose first resolvable link is component gets no hero, but a component note", () => {
  // counterfeit-coin-problem's two links (bernstein-vazirani-1011, grover-3q-101)
  // are both relation "component" — a subroutine used, not an instance of
  // the record itself.
  const links = WORKED_EXAMPLE_LINKS["counterfeit-coin-problem"];
  assert.ok(links?.every((link) => link.relation === "component"), "fixture assumption: both links are component");
  const resolved = resolveWorkedExamples("counterfeit-coin-problem");
  assert.equal(resolved.hero, null);
  assert.equal(resolved.components.length, 2);
  assert.deepEqual(
    resolved.components.map((pair) => pair.example.id),
    ["bernstein-vazirani-1011", "grover-3q-101"],
  );
});

test("a real record whose only link is used-in gets no hero, but a note naming the example as the user", () => {
  // operator-pauli-string -> vqe-2q-transverse-ising, relation used-in: the
  // record is a Pauli-string observable (method "specify / map / group"),
  // and it is vqe-2q-transverse-ising's own algorithm that uses it, not the
  // reverse — the direction fix this test locks in.
  const links = WORKED_EXAMPLE_LINKS["operator-pauli-string"];
  assert.ok(links && links.length === 1 && links[0].relation === "used-in", "fixture assumption: one used-in link");
  const resolved = resolveWorkedExamples("operator-pauli-string");
  assert.equal(resolved.hero, null);
  assert.equal(resolved.components.length, 1);
  assert.equal(resolved.components[0].example.id, "vqe-2q-transverse-ising");
  assert.equal(resolved.components[0].link.relation, "used-in");
});

test("first-instance choice: only the FIRST resolvable link decides the hero, not any later one", () => {
  // ghz-state-pennylane: first link is ghz-4 (instance), second is bell-pair
  // (component, introduction-only mention) — the hero must be ghz-4, and
  // bell-pair must surface only as a component note, never replace it.
  const links = WORKED_EXAMPLE_LINKS["ghz-state-pennylane"];
  assert.ok(links && links.length === 2 && links[0].relation === "instance" && links[1].relation === "component");
  const resolved = resolveWorkedExamples("ghz-state-pennylane");
  assert.equal(resolved.hero!.id, "ghz-4");
  assert.deepEqual(resolved.components.map((pair) => pair.example.id), ["bell-pair"]);
});
