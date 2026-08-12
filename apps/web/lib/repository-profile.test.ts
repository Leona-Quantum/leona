import assert from "node:assert/strict";
import test from "node:test";
import { parseProfile, parseProfileList, profilesBySlug } from "./repository/profile.ts";
import { orderEntries, withCircuitOnly } from "./repository/browse-order.ts";
import type { RepositoryProfile } from "./repository/profile.ts";

/**
 * The load-bearing property here is the same one the estimate parser carries,
 * one number over: a payload whose `present` disagrees with the measurements it
 * holds resolves to nothing rather than to a partly-rendered row.
 *
 * The stakes are lower than for a cost — a depth is not a hardware claim — but
 * the failure mode is worse-looking: most published entries carry no
 * circuit (163 of the then-283, measured 2026-07), so a parser that turned "absent" into zeros would put 163 phantom
 * zero-depth circuits at the top of a "shallowest first" list.
 */

function measured(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "bell",
    present: true,
    reason: null,
    qubits: 2,
    depth: 3,
    gate_count: 2,
    two_qubit_gate_count: 1,
    measurement_count: 2,
    ...overrides,
  };
}

function absent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "prose-only",
    present: false,
    reason: "This entry carries no portable circuit.",
    qubits: null,
    depth: null,
    gate_count: null,
    two_qubit_gate_count: null,
    measurement_count: null,
    ...overrides,
  };
}

test("a measured profile parses into camelCase fields", () => {
  const profile = parseProfile(measured());
  assert.deepEqual(profile, {
    slug: "bell",
    present: true,
    reason: null,
    qubits: 2,
    depth: 3,
    gateCount: 2,
    twoQubitGateCount: 1,
    measurementCount: 2,
  });
});

test("an absent profile keeps its reason and states no numbers", () => {
  const profile = parseProfile(absent());
  assert.equal(profile?.present, false);
  assert.equal(profile?.depth, null);
  assert.match(profile?.reason ?? "", /no portable circuit/);
});

test("present with a missing measurement is dropped, not half-rendered", () => {
  assert.equal(parseProfile(measured({ depth: undefined })), null);
  assert.equal(parseProfile(measured({ two_qubit_gate_count: null })), null);
});

test("present with a reason is a disagreement between the two halves", () => {
  assert.equal(parseProfile(measured({ reason: "but also no circuit" })), null);
});

test("absent carrying a measurement is dropped", () => {
  assert.equal(parseProfile(absent({ depth: 4 })), null);
  assert.equal(parseProfile(absent({ reason: null })), null);
});

test("a zero-qubit 'measured' circuit is refused", () => {
  // The producer's contract says a present profile has qubits >= 1. A zero
  // means something upstream measured nothing and reported success.
  assert.equal(parseProfile(measured({ qubits: 0 })), null);
});

test("counts must be non-negative integers", () => {
  for (const bad of [2.5, -1, "3", null, Number.NaN]) {
    assert.equal(parseProfile(measured({ depth: bad })), null, `depth ${String(bad)}`);
  }
});

test("a listing drops only the rows that fail, not the whole payload", () => {
  const list = parseProfileList({
    profiles: [measured(), measured({ slug: "broken", depth: "deep" }), absent()],
  });
  assert.equal(list?.profiles.length, 2);
  assert.deepEqual(
    list?.profiles.map((profile) => profile.slug),
    ["bell", "prose-only"],
  );
});

test("a listing with no profiles array at all is null", () => {
  assert.equal(parseProfileList({ assumptions: {} }), null);
  assert.equal(parseProfileList(null), null);
});

test("the listing carries no assumption set, and parses fine without one", () => {
  // The difference from parseEstimateList, pinned: a cost listing without an
  // identity is refused because its rows are not comparable. A profile listing
  // has nothing to be comparable *within*.
  const list = parseProfileList({ profiles: [measured()] });
  assert.equal(list?.profiles.length, 1);
  assert.equal("assumptions" in (list ?? {}), false);
});

// --- ordering ----------------------------------------------------------------

function profile(slug: string, qubits: number, depth: number, twoQubit: number): RepositoryProfile {
  return {
    slug,
    present: true,
    reason: null,
    qubits,
    depth,
    gateCount: depth,
    twoQubitGateCount: twoQubit,
    measurementCount: qubits,
  };
}

const NO_CIRCUIT: RepositoryProfile = {
  slug: "prose",
  present: false,
  reason: "no circuit",
  qubits: null,
  depth: null,
  gateCount: null,
  twoQubitGateCount: null,
  measurementCount: null,
};

function order(slugs: string[], by: Parameters<typeof orderEntries>[1], index: Map<string, RepositoryProfile>) {
  return orderEntries(slugs, by, {
    costOf: () => undefined,
    profileOf: (slug) => index.get(slug as string),
    keyOf: (slug) => slug as string,
  });
}

test("depth-asc ranks by depth and holds out what has none", () => {
  const index = new Map([
    ["deep", profile("deep", 4, 40, 12)],
    ["shallow", profile("shallow", 2, 3, 1)],
    ["prose", NO_CIRCUIT],
  ]);
  const { ordered, unranked } = order(["deep", "shallow", "prose"], "depth-asc", index);

  assert.deepEqual(ordered, ["shallow", "deep"]);
  // Not sorted as 0, which would put an unmeasured entry first on a
  // "shallowest first" list, and not as Infinity either.
  assert.deepEqual(unranked, ["prose"]);
});

test("desc reverses the ranking without moving the held-out entries", () => {
  const index = new Map([
    ["deep", profile("deep", 4, 40, 12)],
    ["shallow", profile("shallow", 2, 3, 1)],
    ["prose", NO_CIRCUIT],
  ]);
  const { ordered, unranked } = order(["shallow", "deep", "prose"], "depth-desc", index);

  assert.deepEqual(ordered, ["deep", "shallow"]);
  assert.deepEqual(unranked, ["prose"]);
});

test("each order reads its own measurement", () => {
  const index = new Map([
    // Wide but shallow, against narrow but deep, against neither but entangling.
    ["wide", profile("wide", 16, 4, 2)],
    ["deep", profile("deep", 2, 30, 3)],
    ["tangled", profile("tangled", 4, 6, 20)],
  ]);
  const slugs = ["wide", "deep", "tangled"];

  assert.deepEqual(order(slugs, "qubits-asc", index).ordered, ["deep", "tangled", "wide"]);
  assert.deepEqual(order(slugs, "depth-asc", index).ordered, ["wide", "tangled", "deep"]);
  assert.deepEqual(order(slugs, "two-qubit-asc", index).ordered, ["wide", "deep", "tangled"]);
});

test("ties break on the key, so the list does not reshuffle between renders", () => {
  // The corpus case: 64 Clifford-only 2-qubit circuits land on identical
  // numbers, and a sort that left them to engine stability reads as a bug.
  const index = new Map([
    ["c", profile("c", 2, 3, 1)],
    ["a", profile("a", 2, 3, 1)],
    ["b", profile("b", 2, 3, 1)],
  ]);
  assert.deepEqual(order(["c", "a", "b"], "depth-asc", index).ordered, ["a", "b", "c"]);
  // Same key order under desc: the metric ties, so only the tie-break speaks.
  assert.deepEqual(order(["c", "a", "b"], "depth-desc", index).ordered, ["a", "b", "c"]);
});

test("catalog order returns the input untouched and ranks nothing out", () => {
  const index = new Map([["prose", NO_CIRCUIT]]);
  const { ordered, unranked } = order(["prose", "x"], "catalog", index);
  assert.deepEqual(ordered, ["prose", "x"]);
  assert.deepEqual(unranked, []);
});

test("a profile that says present but carries no number is held out, not crashed on", () => {
  // Unreachable through the parser, which drops it. Asserted because this
  // function must not depend on a guarantee made in a different file.
  const broken = { ...profile("broken", 2, 3, 1), depth: null } as RepositoryProfile;
  const index = new Map([["broken", broken]]);
  assert.deepEqual(order(["broken"], "depth-asc", index).unranked, ["broken"]);
});

test("the circuit-only filter keeps exactly the measured entries", () => {
  const index = new Map([
    ["bell", profile("bell", 2, 3, 1)],
    ["prose", NO_CIRCUIT],
  ]);
  assert.deepEqual(
    withCircuitOnly(["bell", "prose", "unknown"], (slug) => index.get(slug)),
    ["bell"],
  );
});

test("profilesBySlug indexes a listing and tolerates a null one", () => {
  const list = parseProfileList({ profiles: [measured(), absent()] });
  const index = profilesBySlug(list);
  assert.equal(index.get("bell")?.depth, 3);
  assert.equal(index.get("prose-only")?.present, false);
  assert.equal(profilesBySlug(null).size, 0);
});

// --- Relationships the five numbers cannot violate (CodeRabbit, PR 261) -----

test("more two-qubit gates than gates is refused", () => {
  // Each value passes its own range check; only the relationship is impossible,
  // and the browse list would have ranked it happily.
  assert.equal(parseProfile(measured({ gate_count: 1, two_qubit_gate_count: 2 })), null);
  // The boundary is legal: every gate may be two-qubit.
  assert.ok(parseProfile(measured({ gate_count: 2, two_qubit_gate_count: 2, depth: 3 })));
});

test("a depth deeper than the gates could produce is refused", () => {
  // Each gate advances the layering by at most one; the terminal measurement
  // adds at most one more.
  assert.equal(parseProfile(measured({ gate_count: 2, depth: 4 })), null);
  assert.ok(parseProfile(measured({ gate_count: 2, depth: 3 })));
});

test("a partial measurement count is refused", () => {
  // The portable model measures all qubits or none — there is no per-qubit and
  // no mid-circuit measurement in it — so anything between means the payload
  // came from a producer this parser was not written against.
  assert.equal(parseProfile(measured({ qubits: 4, measurement_count: 2 })), null);
  assert.ok(parseProfile(measured({ qubits: 4, measurement_count: 4, depth: 3 })));
  assert.ok(parseProfile(measured({ qubits: 4, measurement_count: 0, depth: 3 })));
});
