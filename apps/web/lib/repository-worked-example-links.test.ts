import assert from "node:assert/strict";
import test from "node:test";

import { WORKED_EXAMPLE_LINKS, workedExampleLinks } from "./repository/worked-example-links.ts";

// The corpus-side facts (every slug exists, every evidence string is a
// verbatim substring of that record's own field, at most 2 links per record,
// no duplicate (slug, exampleId) pairs) are asserted against the live corpus
// by `scripts/check-worked-example-links.mjs`, bundled with esbuild for the
// same reason noted in repository-placeholder-diagrams.test.ts — this file
// only checks the lookup function's own contract.

test("returns the record's own links, unmodified", () => {
  const links = workedExampleLinks("bell-state-qiskit");
  assert.deepEqual(links, WORKED_EXAMPLE_LINKS["bell-state-qiskit"]);
  assert.equal(links.length, 1);
  assert.equal(links[0].exampleId, "bell-pair");
  assert.equal(links[0].relation, "instance");
});

test("an unlinked slug returns an empty array, not undefined", () => {
  assert.deepEqual(workedExampleLinks("no-such-record-at-all"), []);
});

test("every record has at least one link and at most two", () => {
  for (const [slug, links] of Object.entries(WORKED_EXAMPLE_LINKS)) {
    assert.ok(links.length >= 1 && links.length <= 2, `${slug} has ${links.length} links`);
  }
});

test("the map matches the verified count — 196 records, 214 links", () => {
  // 84 records / 99 links from the base map (atlas-example-map.json), plus
  // the 2026-09-15 VQE pass: 37 VQE-method records (instance) + 50 VQE
  // operator records (component) = 87 new links, 86 new records
  // (operator-trotter-product already carried a link and gained a second),
  // plus the 2026-09-17 pass over the records that rendered no figure at all:
  // 11 new links over 9 new records (string-rewriting-derivation-counts and
  // ising-formulations-np-problems take two each), plus the 2026-09-17 gate
  // pass: 17 gate records, each an `instance` link to a demonstration of that
  // gate written for it.
  //
  // This number is a CENSUS, not a target. A batch that changes it changes it
  // on purpose and updates this line with why — the point of pinning it is
  // that a link added or dropped by accident, in a file of 197 hand-read
  // entries, is otherwise invisible.
  const slugs = Object.keys(WORKED_EXAMPLE_LINKS);
  const total = slugs.reduce((sum, slug) => sum + WORKED_EXAMPLE_LINKS[slug].length, 0);
  assert.equal(slugs.length, 196);
  assert.equal(total, 214);
});
