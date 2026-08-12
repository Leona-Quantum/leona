// Which Atlas records a layer node may cross-link, and the three ways the audit
// could report the wrong thing.
//
// The corpus is not imported here, for the reason `repository-topics.test.ts`
// states: `node --test` resolves paths literally and `public-repository.ts`
// reaches its entry modules extensionlessly. The rule is pinned here against
// fixtures; `scripts/check-layer-graph.mjs` runs the same functions against the
// real records and the real graph, so the two cannot drift.
import assert from "node:assert/strict";
import test from "node:test";

import {
  DECLARED_SHARED_SOURCES,
  MAP_CITABLE_SOURCE_KINDS,
  MAP_ELIGIBLE_ROLES,
  auditAnchors,
  isMapCitableSourceKind,
  isMapEligibleRole,
  undeclaredSharedSources,
  type EligibilityRecord,
} from "./repository/map-eligibility.ts";

// Every record here carries provenance, so the role tests below exercise the
// role rule and only the role rule. The provenance rule has its own fixture.
const CORPUS: readonly EligibilityRecord[] = [
  { slug: "hhl-linear-systems", role: "algorithm-reference", sourceKind: "curated_reference" },
  { slug: "amplitude-estimation", role: "algorithm-reference", sourceKind: "curated_reference" },
  {
    slug: "quantum-phase-estimation",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
  },
  { slug: "benchmark-ghz-chain-4q", role: "benchmark-circuit", sourceKind: "curated_reference" },
  { slug: "hadamard-gate", role: "gate-primitive", sourceKind: "curated_reference" },
  { slug: "operator-pauli-string", role: "operator", sourceKind: "curated_reference" },
  { slug: "bell-state-qiskit", role: "state", sourceKind: "curated_reference" },
  // A record no rule claimed. `check-repository-data.mjs` already refuses this,
  // but the audit must not treat "no role" as "eligible" if it ever gets here.
  { slug: "unclassified", role: null, sourceKind: "curated_reference" },
];

// The provenance fixture, shaped like the case that motivated the rule: every
// record is eligible BY ROLE, so nothing here can pass or fail for the other
// reason. `our-own-run` is `qaoa-maxcut-ring` in miniature.
const SOURCED: readonly EligibilityRecord[] = [
  {
    slug: "hhl-linear-systems",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/0811.3171",
  },
  {
    slug: "our-own-run",
    role: "algorithm-reference",
    sourceKind: "verified_run",
    sourceUrl: "https://github.com/EshMis/majorana",
  },
  // Nobody said where this one comes from. Not the same state as "our own run",
  // and the rule must treat them the same.
  { slug: "unrecorded-provenance", role: "algorithm-reference", sourceUrl: "https://example.test/a" },
  {
    slug: "survey-a",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/2103.08505",
  },
  {
    slug: "survey-b",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/2103.08505",
  },
  {
    slug: "survey-c",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/2103.08505",
  },
  {
    slug: "taylor-series-simulation",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/1304.3061",
  },
  {
    slug: "truncated-taylor-sparse",
    role: "algorithm-reference",
    sourceKind: "curated_reference",
    sourceUrl: "https://arxiv.org/abs/1304.3061",
  },
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
  // The number this replaces was "9 of the then-283" (measured 2026-07), and 221
  // of those were records no node could honestly anchor. A denominator that includes them makes the map
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

test("a record the map may not cite is an error even when its role is eligible", () => {
  // The pair that separates the two rules: same role, same node, opposite
  // verdicts — and the eligible-role error must stay empty, or the reader is
  // sent to the topic vocabulary to fix a provenance problem.
  const audit = auditAnchors(
    [
      { nodeId: "quantum-linear-solve", slug: "hhl-linear-systems" },
      { nodeId: "ground-state-energy", slug: "our-own-run" },
      { nodeId: "ground-state-energy", slug: "unrecorded-provenance" },
    ],
    SOURCED,
  );
  assert.deepEqual(audit.ineligible, []);
  assert.deepEqual(
    audit.uncitable.map((row) => [row.nodeId, row.slug, row.sourceKind]),
    [
      ["ground-state-energy", "our-own-run", "verified_run"],
      // Absent provenance reports as `null`, not as the string "undefined": the
      // message says "unrecorded" and the caller must be able to tell the two
      // states apart without parsing prose.
      ["ground-state-energy", "unrecorded-provenance", null],
    ],
  );
  // Still anchored. A provenance error is a claim about the citation, not a
  // retraction of the cross-link, and `anchored` is a coverage number two other
  // files quote.
  assert.equal(audit.anchored, 3);
});

test("the reading list says which of its records cannot be anchored as they stand", () => {
  const audit = auditAnchors([{ nodeId: "quantum-linear-solve", slug: "hhl-linear-systems" }], SOURCED);
  // The caveat does not shorten the list: 7 unanchored, of which 2 are blocked
  // on provenance. A session working the list top to bottom sees both numbers.
  assert.equal(audit.unanchored.length, 7);
  assert.deepEqual(audit.unanchorableProvenance, ["our-own-run", "unrecorded-provenance"]);
  for (const slug of audit.unanchorableProvenance) assert.ok(audit.unanchored.includes(slug));
});

test("shared provenance is counted, commonest first, and a source of one is not shared", () => {
  // 25 of the real 53 cite one VQE survey because a factory defaulted them
  // there. Three-and-two here for the same shape: the point is the grouping and
  // the ordering, and that a record cited once never appears.
  const audit = auditAnchors([], SOURCED);
  assert.deepEqual(
    audit.sharedSources.map(({ url, slugs }) => [url, slugs]),
    [
      ["https://arxiv.org/abs/2103.08505", ["survey-a", "survey-b", "survey-c"]],
      ["https://arxiv.org/abs/1304.3061", ["taylor-series-simulation", "truncated-taylor-sparse"]],
    ],
  );
  // An anchored record leaves the reading list, so it leaves this census too —
  // otherwise the count says how much sourcing work there is including the work
  // already done.
  const afterAnchoring = auditAnchors([{ nodeId: "n", slug: "survey-a" }], SOURCED);
  assert.deepEqual(
    afterAnchoring.sharedSources.find((row) => row.url.endsWith("2103.08505"))?.slugs,
    ["survey-b", "survey-c"],
  );
  // ...and with the two groups now tied at 2, the url breaks the tie, so the
  // output is the same on every run. Sorting by count alone would leave the
  // order to Map insertion and make a diff of two runs unreadable.
  assert.deepEqual(
    afterAnchoring.sharedSources.map((row) => row.url),
    ["https://arxiv.org/abs/1304.3061", "https://arxiv.org/abs/2103.08505"],
  );
});

test("the citable-source list is a vocabulary too, and unknown is not on it", () => {
  assert.deepEqual([...MAP_CITABLE_SOURCE_KINDS], ["curated_reference"]);
  assert.ok(isMapCitableSourceKind("curated_reference"));
  assert.ok(!isMapCitableSourceKind("verified_run"));
  assert.ok(!isMapCitableSourceKind("community_submission"));
  // The fail-closed half of the rule. A consumer that forgets the field must not
  // get a pass out of it.
  assert.ok(!isMapCitableSourceKind(null));
  assert.ok(!isMapCitableSourceKind(undefined));
  assert.ok(!isMapCitableSourceKind(""));
});

test("a shared source is a refusal unless somebody wrote down who may share it", () => {
  // The shape the corpus was in before W21-B: one survey behind a crowd, because
  // a factory supplied it. Nothing about the records says so, which is why the
  // check is on the share and not on any one record.
  const undeclared = undeclaredSharedSources([
    { url: "https://example.org/survey", slugs: ["a", "b", "c"] },
  ]);
  assert.equal(undeclared.length, 1);
  assert.equal(undeclared[0]?.declared, null);
  assert.deepEqual(undeclared[0]?.slugs, ["a", "b", "c"]);
});

test("a declared share passes, and slug ORDER is not part of the declaration", () => {
  const url = "https://arxiv.org/abs/1810.02327";
  const declared = DECLARED_SHARED_SOURCES[url];
  assert.ok(declared, "the Lee et al. share must stay declared for this test to mean anything");
  // Reversed on purpose: `auditAnchors` sorts its groups, but a future caller
  // that does not must not turn a declared share into an error.
  assert.deepEqual(undeclaredSharedSources([{ url, slugs: [...declared].reverse() }]), []);
});

test("the declaration is exact in BOTH directions — a record that gains its own paper must leave the list", () => {
  const url = "https://arxiv.org/abs/2103.08505";
  const declared = DECLARED_SHARED_SOURCES[url];
  assert.ok(declared && declared.length > 1);
  // One of the residue records gets sourced, so it stops citing the survey. The
  // remaining share is a SUBSET of the declaration — permissive-by-default would
  // pass this, and the allowance would then outlive the reason it was granted.
  const shrunk = declared.slice(1);
  const [row] = undeclaredSharedSources([{ url, slugs: [...shrunk] }]);
  assert.ok(row, "a shrunken share must still be reported so the list gets updated");
  assert.deepEqual(row.declared, declared);
});

test("every declared share names at least two records, or it is not a share", () => {
  // A one-slug declaration would be a permanent exemption for a record that is
  // not actually sharing anything — the tag-shaped answer this file avoids.
  for (const [url, slugs] of Object.entries(DECLARED_SHARED_SOURCES)) {
    assert.ok(slugs.length > 1, `${url} declares ${slugs.length} slug(s)`);
    assert.deepEqual([...new Set(slugs)], [...slugs], `${url} lists a slug twice`);
  }
});
