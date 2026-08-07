import assert from "node:assert/strict";
import test from "node:test";
import { resolveBrowseParams, resolveEntryPort } from "./repository/browse-params.ts";
import { INTERFACE_STANCES } from "./repository/interface.ts";
import { PUBLIC_REPOSITORY_CATEGORY_IDS } from "./repository/types.ts";
import { PUBLIC_REPOSITORY_TOPICS } from "./repository/topics.ts";

/**
 * The `/repository` deep links, and the one property they all have to share.
 *
 * These four params are the *only* way the browse page reaches a reader who has
 * no JavaScript, and the only way a crawler or a shared link reaches anything
 * but the unfiltered default. That makes their failure mode unusually quiet: a
 * param that resolves wrong still renders a perfectly good page, and everyone
 * looking at a hydrated browser sees the control they clicked working.
 */

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
  assert.deepEqual(junk, { topic: "", stance: "", category: "all", gate: null });

  assert.deepEqual(resolveBrowseParams({}), {
    topic: "",
    stance: "",
    category: "all",
    gate: null,
  });
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
  assert.deepEqual(resolveBrowseParams({ topic: [], category: [] }), {
    topic: "",
    stance: "",
    category: "all",
    gate: null,
  });
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
