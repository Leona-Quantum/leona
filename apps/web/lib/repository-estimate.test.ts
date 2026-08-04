import assert from "node:assert/strict";
import test from "node:test";
import {
  hasVisibleEstimate,
  isPriced,
  parseEstimate,
  parseEstimateList,
} from "./repository/estimate.ts";
import { orderByCost } from "./repository/estimate-order.ts";

/**
 * The load-bearing property of this parser is not that it accepts good
 * payloads — it is that it rejects a payload whose `basis` disagrees with the
 * layers present.
 *
 * Everywhere else in lib/, a validation failure costs the visitor some
 * rendering. Here it would cost them a *number*: a cost figure under a
 * "cost not stated" heading, or a heading with a blank where a footprint
 * belongs. Both are worse than an absent panel, so a disagreement between the
 * two halves of this feature resolves to silence.
 */

function assumptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    identity: "gidney-2025@v1+eps=1e-06",
    name: "gidney-2025",
    version: 1,
    citation: "Gidney 2025",
    rotation_synthesis_epsilon: 1e-6,
    t_per_rotation: 60,
    t_per_toffoli: 4,
    physical_error_rate: 1e-3,
    cycle_time_s: 1e-6,
    reaction_time_s: 1e-5,
    ...overrides,
  };
}

function priced(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    slug: "test-entry",
    basis: "estimated",
    assumptions: assumptions(),
    reason: null,
    logical: {
      logical_qubits: 2,
      t_count: 120,
      toffoli_count: 0,
      non_clifford_depth: 1,
      magic_states: 120,
      clifford_count: 1,
      synthesis_required: 2,
      t_from_synthesis: 120,
    },
    distance: {
      code_distance: 7,
      logical_operations: 160,
      required_error_per_operation: 6.25e-5,
      achieved_error_per_operation: 1e-5,
      physical_per_logical: 85,
    },
    footprint: {
      data_patch_qubits: 170,
      routing_qubits: 170,
      factory_qubits: 168_300,
      total_physical_qubits: 168_640,
    },
    runtime: {
      magic_states: 120,
      factory_count: 132,
      throughput_seconds: 1e-5,
      reaction_limited_seconds: 1e-5,
      seconds: 1e-5,
      binding_term: "throughput",
      factory_crossover: 132,
    },
    target_failure_probability: 0.01,
    notes: ["factory_count defaulted to the crossover"],
    ...overrides,
  };
}

test("a complete estimate parses and keeps every layer", () => {
  const parsed = parseEstimate(priced());
  assert.ok(parsed);
  assert.equal(parsed.basis, "estimated");
  assert.equal(parsed.footprint?.totalPhysicalQubits, 168_640);
  assert.equal(parsed.logical?.tFromSynthesis, 120);
  assert.equal(parsed.runtime?.bindingTerm, "throughput");
  assert.equal(parsed.assumptions.identity, "gidney-2025@v1+eps=1e-06");
});

test("a priced basis missing a layer is rejected rather than half-rendered", () => {
  for (const layer of ["logical", "distance", "footprint", "runtime"]) {
    assert.equal(parseEstimate(priced({ [layer]: null })), null, `${layer} should be required`);
  }
});

test("a refusal carrying a footprint is rejected", () => {
  // basis says there is no number; the payload carries one. That is a
  // disagreement between the API and this build, not a salvageable estimate.
  const contradictory = priced({ basis: "refused", reason: "unrecognised operation: wibble" });
  assert.equal(parseEstimate(contradictory), null);
});

test("a refusal with no reason is rejected", () => {
  const bare = {
    slug: "x",
    basis: "refused",
    assumptions: assumptions(),
    reason: null,
    logical: null,
    distance: null,
    footprint: null,
    runtime: null,
    notes: [],
  };
  assert.equal(parseEstimate(bare), null);
});

test("a refusal with its reason parses and carries no layers", () => {
  const refused = {
    slug: "x",
    basis: "refused",
    assumptions: assumptions(),
    reason: "1 unrecognised operation(s): wibble",
    logical: null,
    distance: null,
    footprint: null,
    runtime: null,
    notes: [],
  };
  const parsed = parseEstimate(refused);
  assert.ok(parsed);
  assert.equal(parsed.footprint, null);
  assert.match(parsed.reason ?? "", /wibble/);
});

test("an unknown basis is rejected", () => {
  assert.equal(parseEstimate(priced({ basis: "cheap" })), null);
});

test("a null runtime is preserved rather than read as zero seconds", () => {
  // A Clifford-only circuit has no stated wall-clock. Coercing null to 0 here
  // would render "runs instantly" for a circuit that plainly takes time.
  const clifford = priced({
    basis: "exact",
    runtime: {
      magic_states: 0,
      factory_count: 0,
      throughput_seconds: 0,
      reaction_limited_seconds: 0,
      seconds: null,
      binding_term: "unstated",
      factory_crossover: null,
    },
  });
  const parsed = parseEstimate(clifford);
  assert.ok(parsed);
  assert.equal(parsed.runtime?.seconds, null);
  assert.equal(parsed.runtime?.bindingTerm, "unstated");
});

test("a non-finite number never reaches the renderer", () => {
  // JSON has no Infinity, but a producer can emit NaN through a division and a
  // numeric string through a serializer. Both reach toLocaleString and render.
  for (const bad of [Number.POSITIVE_INFINITY, Number.NaN, "168640"]) {
    const payload = priced({ footprint: { ...(priced().footprint as object), total_physical_qubits: bad } });
    assert.equal(parseEstimate(payload), null, `${String(bad)} should not parse`);
  }
});

test("isPriced marks exactly the two bases that carry numbers", () => {
  assert.equal(isPriced("exact"), true);
  assert.equal(isPriced("estimated"), true);
  assert.equal(isPriced("refused"), false);
  assert.equal(isPriced("no_circuit"), false);
});

test("a listing keeps readable rows and drops only the unreadable ones", () => {
  const parsed = parseEstimateList({
    assumptions: assumptions(),
    estimates: [
      { slug: "a", basis: "exact", total_physical_qubits: 52, magic_states: 0, logical_qubits: 2, code_distance: 3, seconds: null },
      { slug: "b", basis: "no_circuit", total_physical_qubits: null, magic_states: null, logical_qubits: null, code_distance: null, seconds: null },
      // Priced with no total: the browse list sorts on that field, and a null
      // sorts somewhere. One bad row must not cost the other two their column.
      { slug: "c", basis: "estimated", total_physical_qubits: null },
      "not-an-object",
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.estimates.map((row) => row.slug), ["a", "b"]);
  assert.equal(parsed.assumptions.identity, "gidney-2025@v1+eps=1e-06");
});

test("a listing with no readable assumption set is discarded whole", () => {
  // Rows whose set is unknown are exactly the rows nothing may sort, so there
  // is no useful remainder to keep.
  assert.equal(
    parseEstimateList({ assumptions: { identity: "x" }, estimates: [{ slug: "a", basis: "exact", total_physical_qubits: 1 }] }),
    null,
  );
  assert.equal(parseEstimateList({ assumptions: assumptions(), estimates: "nope" }), null);
});

test("an estimate with no assumption set is rejected", () => {
  // An estimate that can be read set-free is the one thing this contract exists
  // to prevent: the number would be legible and the claim behind it would not.
  assert.equal(parseEstimate(priced({ assumptions: null })), null);
  assert.equal(parseEstimate(priced({ assumptions: assumptions({ identity: "" }) })), null);
});

// --- ordering the browse list -----------------------------------------------

function row(slug: string, basis: string, total: number | null): Record<string, unknown> {
  return { slug, basis, total_physical_qubits: total, magic_states: null, logical_qubits: null, code_distance: null, seconds: null };
}

function orderedList(rows: Array<Record<string, unknown>>) {
  const parsed = parseEstimateList({ assumptions: assumptions(), estimates: rows });
  assert.ok(parsed);
  const index = new Map(parsed.estimates.map((entry) => [entry.slug, entry]));
  return (entries: string[], order: "catalog" | "cost-asc" | "cost-desc") =>
    orderByCost(entries, order, (slug) => index.get(slug), (slug) => slug);
}

test("ordering by cost ranks the priced entries and holds the rest out", () => {
  const run = orderedList([
    row("expensive", "estimated", 1_307_465),
    row("cheap", "exact", 52),
    row("middling", "exact", 416),
    row("unknown", "refused", null),
    row("prose", "no_circuit", null),
  ]);

  const asc = run(["expensive", "cheap", "middling", "unknown", "prose"], "cost-asc");
  assert.deepEqual(asc.ordered, ["cheap", "middling", "expensive"]);
  // Not sorted as 0 (top of "cheapest first") and not as Infinity (bottom of
  // it). An unknown cost is not a cost, so it holds no position at all.
  assert.deepEqual(asc.unranked.sort(), ["prose", "unknown"]);

  const desc = run(["cheap", "expensive", "middling"], "cost-desc");
  assert.deepEqual(desc.ordered, ["expensive", "middling", "cheap"]);
});

test("catalog order returns everything untouched and ranks nothing", () => {
  const run = orderedList([row("b", "exact", 1), row("a", "exact", 9), row("c", "refused", null)]);
  const result = run(["b", "a", "c"], "catalog");
  assert.deepEqual(result.ordered, ["b", "a", "c"]);
  assert.deepEqual(result.unranked, []);
});

test("entries with no cost row at all are held out, not ranked as free", () => {
  // The listing may be short of an entry the browse list holds — a record
  // published between the two fetches. Absent is not cheap.
  const run = orderedList([row("known", "exact", 100)]);
  const result = run(["known", "missing"], "cost-asc");
  assert.deepEqual(result.ordered, ["known"]);
  assert.deepEqual(result.unranked, ["missing"]);
});

test("equal costs break on a stable key rather than on sort stability", () => {
  // 64 corpus entries are Clifford-only 2-qubit circuits landing on identical
  // totals; a list that reshuffles them between renders reads as a bug.
  const run = orderedList([row("zeta", "exact", 52), row("alpha", "exact", 52), row("mid", "exact", 52)]);
  const first = run(["zeta", "alpha", "mid"], "cost-asc");
  const second = run(["mid", "zeta", "alpha"], "cost-asc");
  assert.deepEqual(first.ordered, ["alpha", "mid", "zeta"]);
  assert.deepEqual(first.ordered, second.ordered);
});

// --- what the page is allowed to put a heading over ---------------------------

test("an entry with no circuit has no visible estimate, so no section is built", () => {
  // A React element is truthy whatever it renders, so a call site that tests the
  // element instead of the data gives an empty "Fault-tolerant cost" section on
  // all 163 entries that carry no circuit.
  const noCircuit = parseEstimate({
    slug: "prose",
    basis: "no_circuit",
    assumptions: assumptions(),
    reason: "This entry carries no portable circuit.",
    logical: null,
    distance: null,
    footprint: null,
    runtime: null,
    notes: [],
  });
  assert.ok(noCircuit);
  assert.equal(hasVisibleEstimate(noCircuit), false);
  assert.equal(hasVisibleEstimate(null), false);
});

test("a refusal is visible, because an unknown cost is information", () => {
  const refused = parseEstimate({
    slug: "odd",
    basis: "refused",
    assumptions: assumptions(),
    reason: "1 unrecognised operation(s): wibble",
    logical: null,
    distance: null,
    footprint: null,
    runtime: null,
    notes: [],
  });
  assert.ok(refused);
  assert.equal(hasVisibleEstimate(refused), true);
  assert.equal(hasVisibleEstimate(parseEstimate(priced())), true);
});

test("an estimated cost with no stated precision is rejected", () => {
  // The producer's model_validator refuses this; accepting it here renders
  // "Estimated under a stated precision" above a precision row that is hidden
  // because there is no precision.
  const bare = priced({ assumptions: assumptions({ rotation_synthesis_epsilon: null, t_per_rotation: null }) });
  assert.equal(parseEstimate(bare), null);

  // The same payload on an `exact` basis is fine — it never needed one.
  assert.ok(parseEstimate({ ...bare, basis: "exact" }));
});
