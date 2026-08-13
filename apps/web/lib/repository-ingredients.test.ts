// **The join, and the proof that its checker can go red.**
//
// `check-ingredients.mjs` refuses five things, and a check that has never
// failed on a wrong input has not been shown to work. Every one of the five is
// mutation-tested below, and every mutation is applied to an **input** —
// records, graph, vocabulary — rather than to the rule tables, so nothing here
// needs a test-only parameter on the validator and nothing here can pass because
// the production path was widened to let it.
//
// The corpus itself is out of reach from `node --test`: `public-repository.ts`
// reaches its entry modules with extensionless specifiers that this runner
// resolves literally. That is why the checker exists as a lint script, and why
// the split is the one `check-layer-graph.mjs` describes — this file pins the
// rules, the script pins them against the 346 records, and **both call
// `validateIngredientJoin`**.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ABSTENTION_REASONS,
  buildShelf,
  contractedProcessCount,
  ingredientJoin,
  isObjectRole,
  processesTouching,
  recordsForState,
  validateIngredientJoin,
  type IngredientCandidate,
} from "./repository/ingredients.ts";
import { LAYER_GRAPH } from "./repository/layer-graph.ts";
import { STATE_VOCABULARY } from "./repository/state-vocabulary.ts";
import type { LayerGraph } from "./repository/layers.ts";
import type { StateVocabulary } from "./repository/states.ts";

/**
 * A corpus small enough to reason about and wide enough to exercise every rule
 * shape: a family-keyed join, a tag-keyed join, a slug-keyed abstention, a
 * family-keyed abstention and a tag-keyed abstention.
 *
 * **Not a copy of the real corpus.** These are the shapes the rules match on,
 * and the real records are what `check-ingredients.mjs --audit` checks the rules
 * against. A fixture that tried to be the corpus would drift from it and would
 * then be testing itself.
 */
const RECORDS: IngredientCandidate[] = [
  {
    slug: "bell-state-qiskit",
    title: "Bell state",
    category: "states",
    algorithmFamily: "Bell / entanglement",
    tags: ["entanglement", "bell"],
  },
  {
    slug: "operator-heisenberg",
    title: "Heisenberg Hamiltonian",
    category: "operators",
    algorithmFamily: "VQE Hamiltonians and observables",
    tags: ["VQE operator", "Hamiltonian", "heisenberg hamiltonian"],
  },
  {
    slug: "operator-dipole",
    title: "Molecular dipole operator",
    category: "operators",
    algorithmFamily: "VQE Hamiltonians and observables",
    tags: ["VQE operator", "Hamiltonian", "molecular dipole operator"],
  },
  {
    slug: "number-operator",
    title: "Fermionic number operator",
    category: "operators",
    algorithmFamily: "Fermionic Hamiltonians",
    tags: ["number operator", "jordan-wigner", "fermionic simulation", "occupation"],
  },
  {
    slug: "hadamard-gate",
    title: "Hadamard gate",
    category: "gates",
    algorithmFamily: "Single-qubit gate",
    tags: ["hadamard"],
  },
];

/**
 * The rules the fixture does NOT exercise, silenced for the fixture's own runs.
 *
 * `validateIngredientJoin` reports a rule that matches no record, which is
 * correct against the corpus and noise against a five-record fixture. Filtering
 * it here rather than weakening the check is the point: the stale-rule check
 * still fires on the real corpus, and it is separately proven able to fire below.
 */
function realErrors(
  records: readonly IngredientCandidate[],
  graph: LayerGraph = LAYER_GRAPH,
  vocabulary: StateVocabulary = STATE_VOCABULARY,
): string[] {
  return validateIngredientJoin(records, graph, vocabulary).filter(
    (error) => !error.includes("matches no record in the corpus"),
  );
}

test("the fixture joins, abstains, and reports nothing wrong", () => {
  assert.deepEqual(realErrors(RECORDS), []);

  const bell = ingredientJoin(RECORDS[0]!);
  assert.equal(bell.kind, "joined");
  assert.equal(bell.kind === "joined" ? bell.state : null, "prepared-state");

  const heisenberg = ingredientJoin(RECORDS[1]!);
  assert.equal(heisenberg.kind === "joined" ? heisenberg.state : null, "hamiltonian-access");

  // The two that separate a family rule from a tag rule, and the reason the
  // 50-record family could not carry one: same family as the Heisenberg record,
  // different answer.
  const dipole = ingredientJoin(RECORDS[2]!);
  assert.equal(dipole.kind, "abstained");
  assert.equal(dipole.kind === "abstained" ? dipole.reason : null, "observable");

  // Same family as two Hamiltonians, and not one.
  const number = ingredientJoin(RECORDS[3]!);
  assert.equal(number.kind === "abstained" ? number.reason : null, "observable");

  assert.equal(ingredientJoin(RECORDS[4]!).kind, "abstained");
});

// --- mutation 1: an object record no rule claims ---------------------------
test("MUTATION: an object record with an unknown family is refused, not dropped", () => {
  // The shape a content batch actually produces: a family `topics.ts` knows —
  // so the record has the `operator` role and is in scope — carrying a tag no
  // ingredient rule reads. `Fermionic Hamiltonians` is the sharpest case,
  // because two of its three real members ARE joined by tag, so a family-level
  // fallback would have swallowed this silently.
  const refused = realErrors([
    ...RECORDS,
    {
      slug: "brand-new-operator",
      title: "Brand new",
      category: "operators",
      algorithmFamily: "Fermionic Hamiltonians",
      tags: ["some-tag-no-rule-reads"],
    },
  ]);
  assert.equal(refused.length, 1, refused.join("; "));
  assert.match(refused[0]!, /brand-new-operator/);
  assert.match(refused[0]!, /no ingredient rule claims it/);

  // Two controls, so the assertion above cannot be passing because everything
  // is refused: a family the join table claims, and a family the abstention
  // table claims, both report nothing.
  for (const [family, tag] of [
    ["Spin Hamiltonians", "spin hamiltonian"],
    ["Quantum error correction", "error correction"],
  ] as const) {
    assert.deepEqual(
      realErrors([
        ...RECORDS,
        { slug: `claimed-${tag}`, title: "Claimed", category: "operators", algorithmFamily: family, tags: [tag] },
      ]),
      [],
      `${family} is claimed and must not report`,
    );
  }
});

// --- mutation 2: one record claimed twice ----------------------------------
test("MUTATION: a record matching a join and an abstention is refused", () => {
  const doubleClaimed: IngredientCandidate[] = [
    ...RECORDS,
    {
      slug: "two-answers",
      title: "Both at once",
      category: "operators",
      algorithmFamily: "VQE Hamiltonians and observables",
      // One tag the join table reads, one the abstention table reads.
      tags: ["heisenberg hamiltonian", "molecular dipole operator"],
    },
  ];
  const errors = realErrors(doubleClaimed);
  assert.equal(errors.length, 1, errors.join("; "));
  assert.match(errors[0]!, /two-answers/);
  assert.match(errors[0]!, /one record, one answer/);
});

// --- mutation 3: a join to a state that is not in the vocabulary ------------
test("MUTATION: a join to a state the vocabulary does not carry is refused", () => {
  const withoutPreparedState: StateVocabulary = {
    states: STATE_VOCABULARY.states.filter((state) => state.id !== "prepared-state"),
  };
  const errors = realErrors(RECORDS, LAYER_GRAPH, withoutPreparedState);
  assert.ok(errors.length >= 1, "removing the joined state reported nothing");
  assert.ok(
    errors.some((error) => /bell-state-qiskit/.test(error) && /not a state in the vocabulary/.test(error)),
    errors.join("; "),
  );
});

// --- mutation 4: a join to a state no process touches -----------------------
//
// **The one that matters most.** Every other check catches a malformed table;
// this one catches a well-formed link that claims the map covers something it
// does not, which is the failure this whole surface is most able to commit and
// least able to notice.
test("MUTATION: a join to a state no process consumes or produces is refused", () => {
  const noContracts: LayerGraph = {
    ...LAYER_GRAPH,
    nodes: LAYER_GRAPH.nodes.map((node) => {
      // The contract is what `processesTouching` reads, so stripping it is the
      // one mutation that makes a well-formed join unreachable. `unknown` in
      // between because a node without its contract is genuinely not a
      // `LayerNode` — which is the point of the mutation.
      const stripped = { ...node } as unknown as Record<string, unknown>;
      delete stripped.contract;
      return stripped as unknown as LayerGraph["nodes"][number];
    }),
  };
  const errors = realErrors(RECORDS, noContracts);
  assert.ok(errors.length >= 2, `expected both joins to be refused, got: ${errors.join("; ")}`);
  assert.ok(
    errors.every((error) => /no process consumes or produces/.test(error)),
    errors.join("; "),
  );
  assert.equal(contractedProcessCount(noContracts), 0);
  // And the control: with the real graph nothing is refused, so the assertion
  // above is not passing because the predicate is a constant.
  assert.deepEqual(realErrors(RECORDS), []);
});

// --- mutation 5: a rule that matches nothing --------------------------------
test("MUTATION: a rule matching no record is refused", () => {
  // Drop every state record and the stale-rule check must fire for all eleven
  // state families — this is the check `realErrors` filters out elsewhere, run
  // here deliberately and unfiltered.
  const noStates = RECORDS.filter((record) => record.category !== "states");
  const errors = validateIngredientJoin(noStates, LAYER_GRAPH, STATE_VOCABULARY);
  const stale = errors.filter((error) => error.includes("matches no record in the corpus"));
  assert.ok(
    stale.some((error) => error.includes("Bell / entanglement")),
    stale.join("; "),
  );
  // The control: with the Bell record present, that rule does not report stale.
  const withBell = validateIngredientJoin(RECORDS, LAYER_GRAPH, STATE_VOCABULARY).filter((error) =>
    error.includes("matches no record in the corpus"),
  );
  assert.ok(
    !withBell.some((error) => error.includes("Bell / entanglement")),
    "the stale-rule check fires even when the rule matches — it would fire on everything",
  );
});

// --- the derived direction --------------------------------------------------

test("a slot consumes what is narrower than it takes and produces what is narrower than the object", () => {
  const prepared = processesTouching(LAYER_GRAPH, STATE_VOCABULARY, "prepared-state");
  const byId = new Map(prepared.map((process) => [`${process.id}:${process.relation}`, process]));

  // Consumed: `observable-estimation` takes a prepared state.
  assert.ok(byId.has("observable-estimation:consumes"), [...byId.keys()].join(", "));
  // Produced directly.
  assert.ok(byId.has("state-preparation:produces"));
  // Produced through `specializes`: a solution state and a reliable routine are
  // both kinds of prepared state, so the slots returning them produce one. This
  // is the asymmetry `stateSatisfies` enforces and the reason the join is worth
  // deriving rather than authoring.
  assert.ok(byId.has("quantum-linear-solve:produces"));
  assert.ok(byId.has("success-amplification:produces"));

  // And the direction that must NOT hold: `state-preparation` takes a *vector to
  // load*, which is not a kind of prepared state, so it does not consume one.
  assert.ok(!byId.has("state-preparation:consumes"));
});

test("a Hamiltonian record reaches simulation and block-encoding, and not the spectral slots", () => {
  const touching = processesTouching(LAYER_GRAPH, STATE_VOCABULARY, "hamiltonian-access");
  const ids = new Set(touching.map((process) => `${process.id}:${process.relation}`));
  assert.ok(ids.has("hamiltonian-simulation:consumes"));
  // `hamiltonian-access` specializes `matrix-access`, so a slot taking any
  // matrix access accepts it.
  assert.ok(ids.has("block-encode-matrix:consumes"));
  // **The refusal that keeps this honest.** `ground-state-energy` takes a
  // Hamiltonian *plus the declaration that its lowest eigenvalue is wanted*.
  // A record that is only the operator does not carry the declaration, so it
  // does not satisfy that slot — and the shelf must not say the map's
  // ground-state work documents these records.
  assert.ok(!ids.has("ground-state-energy:consumes"), [...ids].join(", "));
  assert.ok(!ids.has("ansatz-construction:consumes"));
});

test("records for a state are found through specializes, in the safe direction only", () => {
  // A Hamiltonian is a kind of matrix access, so it appears on the broader
  // state's page.
  const onMatrixAccess = recordsForState(RECORDS, STATE_VOCABULARY, "matrix-access");
  assert.deepEqual(
    onMatrixAccess.map((record) => record.slug),
    ["operator-heisenberg"],
  );
  // And not the other way round: nothing joined to the broad state shows up on
  // the narrow one's page.
  const onBlockEncoding = recordsForState(RECORDS, STATE_VOCABULARY, "block-encoding");
  assert.deepEqual(onBlockEncoding, []);
});

test("the shelf publishes a denominator for every count it prints", () => {
  const shelf = buildShelf(RECORDS, LAYER_GRAPH, STATE_VOCABULARY);
  assert.equal(shelf.recordDenominator, RECORDS.length);
  assert.equal(shelf.processDenominator, contractedProcessCount(LAYER_GRAPH));
  assert.ok(shelf.processDenominator > 0);
  assert.deepEqual(shelf.unclassified, []);
  assert.equal(shelf.joined, 2);

  // Ordered so what many processes touch floats up.
  const states = shelf.sections.find((section) => section.role === "state")!;
  assert.equal(states.entries[0]!.slug, "bell-state-qiskit");
  assert.ok(states.entries[0]!.processes.length > 0);

  // Every abstention reason is a key, including the ones this fixture does not
  // use — a section that reported only its non-zero reasons would make an
  // absent reason and a zero one look the same.
  const gates = shelf.sections.find((section) => section.role === "gate-primitive")!;
  for (const reason of ABSTENTION_REASONS) {
    assert.ok(reason in gates.abstained, `${reason} missing from the abstention census`);
  }
  assert.equal(gates.abstained["primitive-by-ruling"], 1);
  assert.equal(gates.joined, 0);
});

test("only object roles are in scope", () => {
  assert.ok(isObjectRole("state"));
  assert.ok(isObjectRole("operator"));
  assert.ok(isObjectRole("gate-primitive"));
  assert.ok(!isObjectRole("algorithm-reference"));
  assert.ok(!isObjectRole("benchmark-circuit"));
  assert.ok(!isObjectRole(null));
});
