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

test("a real record whose first link is an unresolved exampleId also resolves to nothing yet", () => {
  // abelian-hidden-subgroup's two links point at shor-order-finding-15 and
  // simon-2 — both among the 7 examples still being written on a sibling
  // lane (see check-worked-example-links.mjs's warning) — so as of today
  // neither resolves.
  const links = WORKED_EXAMPLE_LINKS["abelian-hidden-subgroup"];
  assert.ok(links && links.length === 2, "fixture assumption: abelian-hidden-subgroup has 2 links today");
  const resolved = resolveWorkedExamples("abelian-hidden-subgroup");
  assert.equal(resolved.hero, null);
  assert.deepEqual(resolved.components, []);
});

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
