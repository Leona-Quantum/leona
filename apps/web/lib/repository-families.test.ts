import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveWidthFamilies,
  familyInvariant,
  foldRows,
  parseWidthSlug,
  stripWidthFromTitle,
  widthFamilyGroup,
  type FamilyCandidate,
  type RowGroup,
} from "./repository/families.ts";

/**
 * The 15 circuits this catalogue publishes 120 times (R2.6).
 *
 * **The corpus is not imported here**, for the reason `repository-topics.test.ts`
 * and `repository-interface.test.ts` both state: `public-repository.ts` reaches
 * its entry modules with extensionless specifiers and `node --test` resolves
 * paths literally. The properties that are *about* the 283 records — 15 stems,
 * eight widths each, and no refusals — are asserted in
 * `scripts/check-repository-data.mjs`, which bundles with esbuild and runs in
 * `lint`.
 *
 * Three here are worth reading twice, because each pins a mutation that every
 * other assertion in this file would accept: the stance clause in the
 * invariant, `placedBy`, and the 12/16 label. A derivation that ignored stance,
 * a fold that opened every group on its first *declared* member, and a label
 * built from a common prefix all satisfy the happy path exactly.
 */

function member(slug: string, title: string, overrides: Partial<FamilyCandidate> = {}): FamilyCandidate {
  return {
    slug,
    title,
    titleJa: title,
    category: "algorithms",
    categoryLabel: "Algorithms",
    categoryLabelJa: "アルゴリズム",
    algorithmFamily: "Entanglement benchmark",
    framework: "Qiskit",
    status: "verified",
    description: "A GHZ chain at one width.",
    descriptionJa: "GHZチェーン。",
    exportStatus: "Seven-framework export",
    provenance: "Generated",
    updatedAt: "2026-01-01",
    topics: ["benchmark-circuit"],
    verificationMethods: ["statevector"],
    codeVariants: [{ framework: "Qiskit", status: "native" }],
    ...overrides,
  };
}

/** The eight widths the corpus actually publishes. */
const WIDTHS = [2, 3, 4, 5, 6, 8, 12, 16];

function ghzFamily(overrides: Record<number, Partial<FamilyCandidate>> = {}): FamilyCandidate[] {
  return WIDTHS.map((width) =>
    member(`benchmark-ghz-chain-${width}q`, `GHZ chain benchmark · ${width} qubits`, {
      titleJa: `GHZチェーン・ベンチマーク・${width}量子ビット`,
      ...(overrides[width] ?? {}),
    }),
  );
}

test("parseWidthSlug reads a canonical width suffix and refuses the rest", () => {
  assert.deepEqual(parseWidthSlug("benchmark-ghz-chain-16q"), {
    stem: "benchmark-ghz-chain",
    width: 16,
  });
  assert.equal(parseWidthSlug("hadamard-gate"), null);
  assert.equal(parseWidthSlug("benchmark-ghz-chain"), null);
  // A zero-width circuit is not a circuit, and a leading zero would fold two
  // records onto one width and show the same pill twice.
  assert.equal(parseWidthSlug("benchmark-ghz-chain-0q"), null);
  assert.equal(parseWidthSlug("benchmark-ghz-chain-04q"), null);
  // The stem may itself contain digits; only the final -Nq is the width.
  assert.deepEqual(parseWidthSlug("benchmark-hea-rzry-cz-12q"), {
    stem: "benchmark-hea-rzry-cz",
    width: 12,
  });
});

test("eight width records fold to one family, ascending", () => {
  const { families, refused } = deriveWidthFamilies(ghzFamily());
  assert.equal(refused.length, 0);
  assert.equal(families.length, 1);
  const [family] = families;
  assert.equal(family.key, "benchmark-ghz-chain");
  assert.equal(family.label, "GHZ chain benchmark");
  assert.equal(family.labelJa, "GHZチェーン・ベンチマーク");
  assert.deepEqual(
    family.members.map((entry) => entry.width),
    WIDTHS,
  );
});

test("input order does not change the family's member order", () => {
  const shuffled = [...ghzFamily()].reverse();
  const { families } = deriveWidthFamilies(shuffled);
  assert.deepEqual(families[0].members.map((entry) => entry.width), WIDTHS);
});

test("one record at one width is not a family", () => {
  const { families, refused } = deriveWidthFamilies([
    member("benchmark-lonely-4q", "Lonely benchmark · 4 qubits"),
  ]);
  assert.deepEqual(families, []);
  assert.deepEqual(refused, []);
});

test("entries with no width suffix pass through untouched", () => {
  const { families } = deriveWidthFamilies([
    member("hadamard-gate", "Hadamard gate"),
    member("quantum-fourier-transform", "Quantum Fourier transform"),
  ]);
  assert.deepEqual(families, []);
});

test("a facet disagreement is refused, and reported rather than dropped", () => {
  const { families, refused } = deriveWidthFamilies(
    ghzFamily({ 16: { status: "community_review" } }),
  );
  assert.deepEqual(families, []);
  assert.equal(refused.length, 1);
  assert.equal(refused[0].reason, "facets-disagree");
  assert.equal(refused[0].key, "benchmark-ghz-chain");
  assert.equal(refused[0].slugs.length, 8);
  // The refusal carries what made it one: an audit that could only say "not a
  // family" would leave a corpus regression looking like a corpus with no
  // families in it.
  assert.equal(refused[0].detail.length, 2);
});

test("a topic that only some widths carry refuses the fold", () => {
  const { families, refused } = deriveWidthFamilies(
    ghzFamily({ 2: { topics: ["benchmark-circuit", "chemistry"] } }),
  );
  assert.deepEqual(families, []);
  assert.equal(refused[0].reason, "facets-disagree");
});

test("topic order alone does not refuse the fold", () => {
  const { families, refused } = deriveWidthFamilies(
    ghzFamily({
      2: { topics: ["benchmark-circuit", "entanglement"] },
      4: { topics: ["entanglement", "benchmark-circuit"] },
      // every other member gets both, in one of the two orders
      3: { topics: ["entanglement", "benchmark-circuit"] },
      5: { topics: ["benchmark-circuit", "entanglement"] },
      6: { topics: ["entanglement", "benchmark-circuit"] },
      8: { topics: ["benchmark-circuit", "entanglement"] },
      12: { topics: ["entanglement", "benchmark-circuit"] },
      16: { topics: ["benchmark-circuit", "entanglement"] },
    }),
  );
  assert.equal(refused.length, 0);
  assert.equal(families.length, 1);
});

test("a framework a single width cannot export refuses the fold", () => {
  const { families, refused } = deriveWidthFamilies(
    ghzFamily({ 16: { codeVariants: [{ framework: "Qiskit", status: "unsupported" }] } }),
  );
  assert.deepEqual(families, []);
  assert.equal(refused[0].reason, "facets-disagree");
});

/**
 * The stance clause, which nothing else in this file would catch.
 *
 * Every published benchmark measures and so resolves to `program`, which means
 * an invariant that simply never looked at stance passes every other test here
 * and every assertion in the corpus audit. It would also fold a family whose
 * widths took two different values of the "Takes / returns" control, putting a
 * card on screen under a filter that excludes the member it shows.
 */
test("a stance that differs between widths refuses the fold", () => {
  const entries = ghzFamily();
  const { families, refused } = deriveWidthFamilies(entries, (entry) =>
    entry.slug.endsWith("-16q") ? "transform" : "program",
  );
  assert.deepEqual(families, []);
  assert.equal(refused[0].reason, "facets-disagree");

  // Same corpus, one stance: it folds.
  const agreed = deriveWidthFamilies(entries, () => "program");
  assert.equal(agreed.families.length, 1);
});

test("stripWidthFromTitle strikes the slug's own width, in both locales", () => {
  assert.equal(stripWidthFromTitle("GHZ chain benchmark · 4 qubits", 4), "GHZ chain benchmark");
  assert.equal(
    stripWidthFromTitle("GHZチェーン・ベンチマーク・4量子ビット", 4),
    "GHZチェーン・ベンチマーク",
  );
  // Singular, and a title that ends in a figure that is not the width.
  assert.equal(stripWidthFromTitle("Single-qubit probe · 1 qubit", 1), "Single-qubit probe");
  assert.equal(stripWidthFromTitle("Trotter benchmark, 4 steps · 8 qubits", 8), "Trotter benchmark, 4 steps");
  // Not this member's width: nothing is struck, which is what makes a
  // slug/title disagreement visible instead of silently absorbed.
  assert.equal(stripWidthFromTitle("GHZ chain benchmark · 4 qubits", 8), "GHZ chain benchmark · 4 qubits");
});

/**
 * The 12/16 label, which a common-prefix implementation gets wrong.
 *
 * `… · 12 qubits` and `… · 16 qubits` share the prefix `… · 1`, so a label
 * built from the longest common prefix reads "Wide benchmark · 1" — authored-
 * looking, and wrong. Striking each member's own declared width cannot produce
 * it.
 */
test("a family published only at 12 and 16 qubits still gets a clean label", () => {
  const { families } = deriveWidthFamilies([
    member("benchmark-wide-12q", "Wide benchmark · 12 qubits"),
    member("benchmark-wide-16q", "Wide benchmark · 16 qubits"),
  ]);
  assert.equal(families.length, 1);
  assert.equal(families[0].label, "Wide benchmark");
});

test("titles that do not reduce to one label are refused", () => {
  const { families, refused } = deriveWidthFamilies([
    member("benchmark-split-4q", "GHZ chain benchmark · 4 qubits"),
    member("benchmark-split-8q", "Bell ladder benchmark · 8 qubits"),
  ]);
  assert.deepEqual(families, []);
  assert.equal(refused[0].reason, "titles-disagree");
});

test("a title that is nothing but its width is refused", () => {
  const { families, refused } = deriveWidthFamilies([
    member("benchmark-bare-4q", "4 qubits"),
    member("benchmark-bare-8q", "8 qubits"),
  ]);
  assert.deepEqual(families, []);
  assert.equal(refused[0].reason, "titles-disagree");
});

test("familyInvariant ignores the fields that legitimately differ by width", () => {
  // Same facets, different titles and slugs: the invariant is about what a
  // folded card filters and renders, not about the member's identity.
  const a = familyInvariant(member("benchmark-ghz-chain-2q", "GHZ chain benchmark · 2 qubits"));
  const b = familyInvariant(member("benchmark-ghz-chain-16q", "GHZ chain benchmark · 16 qubits"));
  assert.equal(a, b);
});

// ---------------------------------------------------------------------------
// foldRows
// ---------------------------------------------------------------------------

const GHZ_GROUP: RowGroup = {
  key: "benchmark-ghz-chain",
  label: "GHZ chain benchmark",
  labelJa: "GHZチェーン・ベンチマーク",
  slugs: WIDTHS.map((width) => `benchmark-ghz-chain-${width}q`),
};

function groupOf(slug: string): RowGroup | undefined {
  return GHZ_GROUP.slugs.includes(slug) ? GHZ_GROUP : undefined;
}

test("a fold emits one row per cluster, at the cluster's first appearance", () => {
  const entries = [
    { slug: "hadamard-gate" },
    ...WIDTHS.map((width) => ({ slug: `benchmark-ghz-chain-${width}q` })),
    { slug: "quantum-fourier-transform" },
  ];
  const rows = foldRows(entries, groupOf);
  assert.deepEqual(
    rows.map((row) => (row.kind === "single" ? row.entry.slug : row.group.key)),
    ["hadamard-gate", "benchmark-ghz-chain", "quantum-fourier-transform"],
  );
  const [, folded] = rows;
  assert.equal(folded.kind, "group");
  if (folded.kind !== "group") return;
  assert.equal(folded.members.length, 8);
});

/**
 * `placedBy`, which the happy path cannot distinguish from `members[0]`.
 *
 * The list is ordered before it is folded, so a group takes the position of
 * whichever member the sort put first — under "deepest first" that is the
 * 16-qubit circuit. A card that then opened on the 2-qubit member would be
 * ranked by one circuit and describe another, which is the defect
 * `renderCostChip` already refuses for cost.
 */
test("a group is placed by the member the ordering put first, not by its first member", () => {
  const descending = [...WIDTHS]
    .reverse()
    .map((width) => ({ slug: `benchmark-ghz-chain-${width}q` }));
  const [row] = foldRows(descending, groupOf);
  assert.equal(row.kind, "group");
  if (row.kind !== "group") return;
  assert.equal(row.placedBy, "benchmark-ghz-chain-16q");
  // The switcher still lists ascending — placement and display order are two
  // different questions.
  assert.deepEqual(row.members.map((entry) => entry.slug), GHZ_GROUP.slugs);
});

test("a cluster reduced to one surviving member renders as a plain entry", () => {
  const rows = foldRows([{ slug: "benchmark-ghz-chain-4q" }], groupOf);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "single");
  if (rows[0].kind !== "single") return;
  assert.equal(rows[0].entry.slug, "benchmark-ghz-chain-4q");
});

test("a filtered-out member leaves the group without a phantom pill", () => {
  const survivors = [2, 4, 8].map((width) => ({ slug: `benchmark-ghz-chain-${width}q` }));
  const [row] = foldRows(survivors, groupOf);
  assert.equal(row.kind, "group");
  if (row.kind !== "group") return;
  assert.deepEqual(row.members.map((entry) => entry.slug), [
    "benchmark-ghz-chain-2q",
    "benchmark-ghz-chain-4q",
    "benchmark-ghz-chain-8q",
  ]);
});

test("widthFamilyGroup labels each pill with its width alone", () => {
  const { families } = deriveWidthFamilies(ghzFamily());
  const group = widthFamilyGroup(families[0], "en");
  assert.equal(group.memberLabels?.["benchmark-ghz-chain-2q"], "2 q");
  assert.equal(group.memberLabels?.["benchmark-ghz-chain-16q"], "16 q");
  const ja = widthFamilyGroup(families[0], "ja");
  assert.equal(ja.memberLabels?.["benchmark-ghz-chain-16q"], "16量子ビット");
});
