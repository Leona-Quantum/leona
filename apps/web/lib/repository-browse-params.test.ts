import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_QUERY_LENGTH,
  resolveBrowseParams,
  resolveEntryPort,
} from "./repository/browse-params.ts";
import { BROWSE_ORDERS } from "./repository/browse-order.ts";
import { DEFAULT_ROW_LIMIT } from "./repository/browse-page.ts";
import { INTERFACE_STANCES } from "./repository/interface.ts";
import { PUBLIC_REPOSITORY_CATEGORY_IDS } from "./repository/types.ts";
import { PUBLIC_REPOSITORY_TOPICS } from "./repository/topics.ts";

/**
 * The `/repository` deep links, and the one property they all have to share.
 *
 * Eight params since s91 — `?q=`, `?order=`, `?circuit=` and `?rows=` joined the
 * original four when the list gained a cap, because a cap whose "rest of it" has
 * no address hides rows nothing can reach.
 *
 * These params are the *only* way the browse page reaches a reader who has no
 * JavaScript, and the only way a crawler or a shared link reaches anything but
 * the unfiltered default. That makes their failure mode unusually quiet: a param
 * that resolves wrong still renders a perfectly good page, and everyone looking
 * at a hydrated browser sees the control they clicked working.
 */

/**
 * What "nothing selected" resolves to, for every param on the route.
 *
 * One literal rather than three copies, and asserted with `deepEqual` rather
 * than field by field, so a param added to `ResolvedBrowseParams` without a
 * fallback fails here instead of shipping. That is the direction that would
 * otherwise go unnoticed — a new filter defaulting to something selective
 * narrows the catalogue for every reader who never touched it.
 */
const NO_FILTERS = {
  topic: "",
  stance: "",
  category: "all",
  gate: null,
  query: "",
  order: "catalog",
  circuitOnly: false,
  rows: DEFAULT_ROW_LIMIT,
} as const;

test("every param resolves to no filter rather than to an empty list", () => {
  // The rule, stated in three code comments before it was asserted anywhere. A
  // retired topic id in an old bookmark, a stance a later release renamed, a
  // category that no longer exists: each should show the reader the catalogue.
  // Resolving them to a *selection nothing matches* would render a blank page
  // that reads as "we have nothing like this".
  const junk = resolveBrowseParams({
    topic: "retired-topic-id",
    fits: "composable",
    category: "widgets",
    gate: "   ",
  });
  assert.deepEqual(junk, NO_FILTERS);

  assert.deepEqual(resolveBrowseParams({}), NO_FILTERS);
});

test("a recognised value survives, for every member of every vocabulary", () => {
  // Not one example each: the guards and the vocabularies are separate objects,
  // and a member missing from a guard is exactly the failure this file exists
  // for — it would deep-link to the unfiltered page while every other member
  // worked, which is invisible unless somebody tries that one.
  for (const category of PUBLIC_REPOSITORY_CATEGORY_IDS) {
    assert.equal(resolveBrowseParams({ category }).category, category);
  }
  for (const stance of INTERFACE_STANCES) {
    assert.equal(resolveBrowseParams({ fits: stance }).stance, stance);
  }
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    assert.equal(resolveBrowseParams({ topic: topic.id }).topic, topic.id);
  }
});

test("a repeated param takes the first value rather than throwing it away", () => {
  // `?topic=a&topic=b` arrives as an array. A link built by concatenation is the
  // usual cause and the reader meant one of them, so this is the same instinct
  // as the unknown-value rule: show something, and show the catalogue when in
  // doubt.
  const resolved = resolveBrowseParams({
    topic: ["variational", "state"],
    fits: ["transform", "source"],
    category: ["gates", "states"],
    gate: ["swap-gate", "ccz-gate"],
  });
  assert.equal(resolved.topic, "variational");
  assert.equal(resolved.stance, "transform");
  assert.equal(resolved.category, "gates");
  assert.equal(resolved.gate, "swap-gate");
  // An empty array is not a first value.
  assert.deepEqual(resolveBrowseParams({ topic: [], category: [] }), NO_FILTERS);
});

test("the gate slug is passed through unvalidated, and trimmed", () => {
  // Deliberately not checked against the corpus: it is a slug rather than a
  // closed vocabulary, and the listing has not been fetched when this runs. The
  // browser falls back to the first gate when the selection is not in the
  // filtered set, so a retired slug in an old link opens the section rather
  // than an empty pane.
  assert.equal(resolveBrowseParams({ gate: "toffoli-ccx-gate" }).gate, "toffoli-ccx-gate");
  assert.equal(resolveBrowseParams({ gate: "  swap-gate  " }).gate, "swap-gate");
  assert.equal(resolveBrowseParams({ gate: "" }).gate, null);
});

test("?port= resolves an end, and an unrecognised one is no selection", () => {
  // Same fallback as its four neighbours, and it matters more here than it looks:
  // the value ends up as `open` on a <details>, so "unrecognised" must mean
  // "closed" rather than an exception on a page a stale bookmark can reach.
  assert.equal(resolveEntryPort({ port: "in" }), "in");
  assert.equal(resolveEntryPort({ port: "out" }), "out");
  assert.equal(resolveEntryPort({}), null);
  assert.equal(resolveEntryPort({ port: "input" }), null);
  assert.equal(resolveEntryPort({ port: "" }), null);
  // Repeated params take the first, like every other param on this route.
  assert.equal(resolveEntryPort({ port: ["out", "in"] }), "out");
});

test("junk in the four params added with the cap also resolves to no filter", () => {
  // Same rule as the original four, and one of these is sharper than the rest:
  // `?circuit=` REMOVES the majority of records — 163 of the then-283 — so a
  // value this build does not recognise resolving to `true` would hide most of the catalogue from a
  // reader who mistyped a URL.
  const junk = resolveBrowseParams({
    q: "   ",
    order: "cost-median",
    circuit: "yes",
    rows: "banana",
  });
  assert.deepEqual(junk, NO_FILTERS);
});

test("every order in the vocabulary survives a round trip through the URL", () => {
  // Against BROWSE_ORDERS itself, not a hand-written list: a sort the select
  // offers and a bookmark of it silently downgrades to `catalog` is exactly the
  // kind of one-member gap this file exists for.
  for (const order of BROWSE_ORDERS) {
    assert.equal(resolveBrowseParams({ order }).order, order);
  }
});

test("the circuit-only filter reads only the two spellings our own links produce", () => {
  assert.equal(resolveBrowseParams({ circuit: "1" }).circuitOnly, true);
  assert.equal(resolveBrowseParams({ circuit: "true" }).circuitOnly, true);
  for (const raw of ["0", "false", "", "on", "yes", "TRUE"]) {
    assert.equal(resolveBrowseParams({ circuit: raw }).circuitOnly, false, `?circuit=${raw}`);
  }
});

test("a query is trimmed and bounded rather than passed through", () => {
  assert.equal(resolveBrowseParams({ q: "  grover  " }).query, "grover");
  const long = "x".repeat(MAX_QUERY_LENGTH + 500);
  assert.equal(resolveBrowseParams({ q: long }).query.length, MAX_QUERY_LENGTH);
});

test("the row cap comes through, including the spelled-out everything", () => {
  assert.equal(resolveBrowseParams({ rows: "48" }).rows, 48);
  assert.equal(resolveBrowseParams({ rows: "all" }).rows, "all");
  assert.equal(resolveBrowseParams({ rows: "0" }).rows, DEFAULT_ROW_LIMIT);
});
