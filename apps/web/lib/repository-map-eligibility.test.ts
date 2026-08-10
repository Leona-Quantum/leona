// Which Atlas records a layer node may cross-link, and the three ways the audit
// could report the wrong thing.
//
// The corpus is not imported here, for the reason `repository-topics.test.ts`
// states: `node --test` resolves paths literally and `public-repository.ts`
// reaches its entry modules extensionlessly. The rule is pinned here against
// fixtures; `scripts/check-layer-graph.mjs` runs the same functions against the
// real 283 records and the real graph, so the two cannot drift.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_ELIGIBLE_ROLES,
  auditAnchors,
  isMapEligibleRole,
  type EligibilityRecord,
} from "./repository/map-eligibility.ts";

const CORPUS: readonly EligibilityRecord[] = [
  { slug: "hhl-linear-systems", role: "algorithm-reference" },
  { slug: "amplitude-estimation", role: "algorithm-reference" },
  { slug: "quantum-phase-estimation", role: "algorithm-reference" },
  { slug: "benchmark-ghz-chain-4q", role: "benchmark-circuit" },
  { slug: "hadamard-gate", role: "gate-primitive" },
  { slug: "operator-pauli-string", role: "operator" },
  { slug: "bell-state-qiskit", role: "state" },
  // A record no rule claimed. `check-repository-data.mjs` already refuses this,
  // but the audit must not treat "no role" as "eligible" if it ever gets here.
  { slug: "unclassified", role: null },
];

test("only the listed roles may be anchored, and every other role is an error", () => {
  const audit = auditAnchors(
    [
      { nodeId: "quantum-linear-solve", slug: "hhl-linear-systems" },
      { nodeId: "state-preparation", slug: "benchmark-ghz-chain-4q" },
      { nodeId: "gate-synthesis", slug: "hadamard-gate" },
      { nodeId: "observable-estimation", slug: "operator-pauli-string" },
      { nodeId: "state-preparation", slug: "bell-state-qiskit" },
      { nodeId: "somewhere", slug: "unclassified" },
    ],
    CORPUS,
  );
  assert.deepEqual(
    audit.ineligible.map((row) => row.slug),
    [
      "benchmark-ghz-chain-4q",
      "hadamard-gate",
      "operator-pauli-string",
      "bell-state-qiskit",
      "unclassified",
    ],
  );
  // The node is carried, not just the slug: the fix is an edit to one node, and
  // an error that names only the record sends the reader looking through 76.
  assert.equal(audit.ineligible[0]?.nodeId, "state-preparation");
});

test("a slug the corpus does not carry is somebody else's error, not this one", () => {
  // `entries names a slug the corpus does not carry` is a separate rule with a
  // separate fix. Reporting a typo as an ineligible role would send the reader to
  // the topic vocabulary to solve a spelling mistake.
  const audit = auditAnchors([{ nodeId: "n", slug: "no-such-record" }], CORPUS);
  assert.deepEqual(audit.ineligible, []);
  assert.equal(audit.anchored, 0);
});

test("coverage is counted against the eligible set, never the whole corpus", () => {
  // The number this replaces was "9 of 283", and 221 of those 283 are records no
  // node could honestly anchor. A denominator that includes them makes the map
  // look 4x emptier than it is and gives no reading list.
  const audit = auditAnchors(
    [
      { nodeId: "a", slug: "hhl-linear-systems" },
      // The same record from two nodes is one record covered, not two.
      { nodeId: "b", slug: "hhl-linear-systems" },
      { nodeId: "c", slug: "benchmark-ghz-chain-4q" },
    ],
    CORPUS,
  );
  assert.equal(audit.eligible, 3);
  assert.equal(audit.anchored, 1);
  assert.deepEqual(audit.unanchored, ["amplitude-estimation", "quantum-phase-estimation"]);
});

test("the eligible-role list is a vocabulary, not a predicate written twice", () => {
  assert.deepEqual([...MAP_ELIGIBLE_ROLES], ["algorithm-reference"]);
  assert.ok(isMapEligibleRole("algorithm-reference"));
  assert.ok(!isMapEligibleRole("benchmark-circuit"));
  assert.ok(!isMapEligibleRole(null));
  assert.ok(!isMapEligibleRole(undefined));
});
