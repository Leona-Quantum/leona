import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_REPOSITORY_TOPICS,
  TOPICS_BY_ID,
  TOPIC_OVERRIDES,
  deriveTopics,
  isTopicId,
  roleOf,
  topicsInFacet,
  topicsInFacetOf,
} from "./repository/topics.ts";

/**
 * R2's closed vocabulary and the rules that assign it.
 *
 * **The corpus is not imported here and that is not an oversight.**
 * `public-repository.ts` reaches its entry modules with extensionless
 * specifiers, and `node --test` strips types but resolves paths literally — so
 * this file cannot see the 283 records. The properties that are *about* the
 * corpus (every entry has exactly one role, no vocabulary member is empty, the
 * domain facet stays sparse) are asserted in `scripts/check-repository-data.mjs`
 * instead, which bundles with esbuild and, as of this change, runs in `lint`.
 *
 * What is here is everything that can be pinned with synthetic evidence, and the
 * two worth reading twice are the unmapped family and the case-insensitive
 * match: the first is the property the CI gate depends on, and a `deriveTopics`
 * that quietly defaulted a role would satisfy every other test in this file.
 */

test("the vocabulary is closed, unique, and fully labelled in both locales", () => {
  const ids = new Set<string>();
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    assert.equal(ids.has(topic.id), false, `duplicate topic id ${topic.id}`);
    ids.add(topic.id);
    assert.ok(["role", "method", "domain"].includes(topic.facet), `${topic.id} has an odd facet`);
    for (const field of ["label", "labelJa", "definition", "definitionJa"] as const) {
      assert.ok(topic[field].length > 0, `${topic.id} is missing ${field}`);
    }
  }
  assert.equal(isTopicId("chemistry"), true);
  assert.equal(isTopicId("astrology"), false);
});

test("facets partition the vocabulary and nothing else", () => {
  const total = (["role", "method", "domain"] as const).reduce(
    (sum, facet) => sum + topicsInFacet(facet).length,
    0,
  );
  assert.equal(total, PUBLIC_REPOSITORY_TOPICS.length);
});

test("an unmapped family yields no role, which is what the CI gate reads", () => {
  const orphan = deriveTopics({
    slug: "not-in-the-corpus",
    category: "algorithms",
    algorithmFamily: "A family nobody has written a rule for",
    tags: [],
  });

  assert.deepEqual(orphan, []);
  assert.equal(roleOf(orphan), null);
});

test("a rule with no predicate would tag the whole corpus, so there are none", () => {
  // Reached through the public surface rather than by reading the table: an
  // entry whose family matches nothing and whose tags match nothing must come
  // back empty. If a rule were ever written with all three predicates omitted,
  // it would fire here.
  assert.deepEqual(
    deriveTopics({ slug: "x", category: "gates", algorithmFamily: "", tags: [] }),
    [],
  );
});

test("tag matching is case-insensitive, which is half of why the vocabulary exists", () => {
  // The free-tag set carried `Clifford` on 8 entries and `clifford` on 7, so a
  // reader filtering the obvious spelling missed seven records. A rule table
  // that reproduced that split would have solved nothing.
  const upper = deriveTopics({
    slug: "a",
    category: "algorithms",
    algorithmFamily: "Clifford circuit benchmark",
    tags: ["Clifford"],
  });
  const lower = deriveTopics({
    slug: "b",
    category: "algorithms",
    algorithmFamily: "Clifford circuit benchmark",
    tags: ["clifford"],
  });

  assert.deepEqual(upper, lower);
  assert.ok(upper.includes("stabilizer"));
});

test("topics come back in vocabulary order, not in the order the rules fired", () => {
  const topics = deriveTopics({
    slug: "c",
    category: "operators",
    algorithmFamily: "Fermionic Hamiltonians",
    tags: ["hubbard model", "jordan-wigner"],
  });
  const positions = topics.map((topic) =>
    PUBLIC_REPOSITORY_TOPICS.findIndex((entry) => entry.id === topic),
  );

  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  // A chip row whose sequence depends on rule order reads as though the order
  // means something, and two entries carrying the same topics would differ.
  assert.equal(topics[0], roleOf(topics));
  assert.ok(topics.includes("materials"));
  assert.ok(topics.includes("fermionic-encoding"));
});

test("refinements add and never remove, so no rule's position is load-bearing", () => {
  const bare = deriveTopics({
    slug: "d",
    category: "operators",
    algorithmFamily: "VQE Hamiltonians and observables",
    tags: [],
  });
  const refined = deriveTopics({
    slug: "d",
    category: "operators",
    algorithmFamily: "VQE Hamiltonians and observables",
    tags: ["electronic-structure hamiltonian"],
  });

  for (const topic of bare) assert.ok(refined.includes(topic), `${topic} was removed by a refinement`);
  assert.ok(refined.includes("chemistry"));
  // The 50-entry operator family is the reason refinements exist at all: a
  // bare Pauli-string observable is not about anything, and no family-level
  // rule is right for both it and a molecular Hamiltonian.
  assert.deepEqual(topicsInFacetOf(bare, "domain"), []);
});

test("a benchmark family carries no domain unless the record names a problem", () => {
  // The line R2 draws, pinned on both sides. The TFIM benchmarks name a
  // physical model; the occupation-seeded ones describe "a Hartree-Fock-like
  // computational-basis seed" — chemistry vocabulary on an initialisation
  // pattern, with no molecule in it. Changing this test means changing the
  // paragraph in topics.ts that argues for it.
  const named = deriveTopics({
    slug: "benchmark-tfim-vqe-4q",
    category: "algorithms",
    algorithmFamily: "VQE ansatz benchmark",
    tags: ["VQE", "TFIM", "ansatz"],
  });
  const technique = deriveTopics({
    slug: "benchmark-occupation-seeded-vqe-4q",
    category: "algorithms",
    algorithmFamily: "VQE ansatz benchmark",
    tags: ["VQE", "occupation seed", "ansatz"],
  });

  assert.ok(named.includes("materials"));
  assert.deepEqual(topicsInFacetOf(technique, "domain"), []);
  // Both are benchmark circuits, and both still say so — which is what stops
  // "10 entries for optimization" reading as ten solutions.
  assert.equal(roleOf(named), "benchmark-circuit");
  assert.equal(roleOf(technique), "benchmark-circuit");
});

test("an override replaces the derived set rather than merging with it", () => {
  // Empty today, and `check-repository-data.mjs` fails on any slug listed here
  // that the corpus does not carry — an override keyed on a renamed slug is
  // otherwise silent, and the entry goes back to whatever the rules say without
  // anyone being told.
  assert.deepEqual(Object.keys(TOPIC_OVERRIDES), []);
});

test("every topic an entry can carry resolves to a facet", () => {
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    assert.equal(TOPICS_BY_ID.get(topic.id)?.facet, topic.facet);
  }
});
