/**
 * The Atlas search predicate (s81).
 *
 * These tests exist because of a deletion, not an addition. The `Algorithm
 * family` browse control was removed on the argument that free-text search
 * already covers it — `algorithmFamily` is in the haystack, so typing a
 * family's name still gathers its members. That argument is only true while the
 * haystack contains that field, and nothing else in the app would notice if it
 * stopped: the browser is a client component with no render harness, so a
 * dropped field breaks no test and simply makes 57 values unreachable.
 *
 * The corpus-wide half of the claim ("no family loses a member to search") is
 * asserted over the real 283 entries in `scripts/check-repository-data.mjs`.
 * What is here is the predicate's own behaviour.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  matchesRepositoryQuery,
  searchHaystack,
  type RepositorySearchable,
} from "./repository/search.ts";

function entry(overrides: Partial<RepositorySearchable> = {}): RepositorySearchable {
  return {
    title: "Grover search",
    titleJa: "グローバー探索",
    algorithmFamily: "Oracle algorithm benchmark",
    framework: "Qiskit",
    description: "Amplitude amplification over an unstructured database.",
    descriptionJa: "非構造データベースに対する振幅増幅。",
    provenance: "Grover 1996",
    tags: ["search", "oracle"],
    ...overrides,
  };
}

test("an empty or whitespace query matches everything", () => {
  assert.equal(matchesRepositoryQuery(entry(), ""), true);
  assert.equal(matchesRepositoryQuery(entry(), "   "), true);
  assert.equal(matchesRepositoryQuery(entry(), "\t\n"), true);
});

test("matching is case-insensitive on both sides", () => {
  assert.equal(matchesRepositoryQuery(entry(), "GROVER"), true);
  assert.equal(matchesRepositoryQuery(entry(), "grover"), true);
  assert.equal(matchesRepositoryQuery(entry({ title: "GROVER SEARCH" }), "grover"), true);
});

test("the query is trimmed, so a trailing space from a paste still matches", () => {
  assert.equal(matchesRepositoryQuery(entry(), "  grover  "), true);
});

test("substring, not prefix or whole-token", () => {
  assert.equal(matchesRepositoryQuery(entry({ title: "Iterative Grover" }), "grover"), true);
  assert.equal(matchesRepositoryQuery(entry(), "rove"), true);
});

/**
 * The field this whole module exists for. If `algorithmFamily` ever leaves the
 * haystack, this is the test that says so — and it is the only one that would.
 */
test("algorithmFamily is searchable, which is what replaced the family control", () => {
  const e = entry({
    title: "Nothing alike",
    titleJa: "",
    description: "",
    descriptionJa: "",
    provenance: "",
    tags: [],
    algorithmFamily: "VQE ansatz benchmark",
  });
  assert.equal(matchesRepositoryQuery(e, "VQE ansatz benchmark"), true);
  assert.equal(matchesRepositoryQuery(e, "ansatz"), true);
});

test("framework stays searchable, so the placeholder's promise still holds", () => {
  const e = entry({
    title: "Nothing alike",
    titleJa: "",
    description: "",
    descriptionJa: "",
    provenance: "",
    tags: [],
    algorithmFamily: "",
    framework: "PennyLane",
  });
  assert.equal(matchesRepositoryQuery(e, "pennylane"), true);
});

test("every declared field is reachable, tags included", () => {
  const fields: Array<[keyof RepositorySearchable, string]> = [
    ["title", "zzz-title"],
    ["titleJa", "zzz-titleja"],
    ["algorithmFamily", "zzz-family"],
    ["framework", "zzz-framework"],
    ["description", "zzz-description"],
    ["descriptionJa", "zzz-descriptionja"],
    ["provenance", "zzz-provenance"],
  ];
  for (const [field, needle] of fields) {
    const e = entry({ [field]: needle } as Partial<RepositorySearchable>);
    assert.equal(matchesRepositoryQuery(e, needle), true, `${String(field)} is not searchable`);
  }
  assert.equal(matchesRepositoryQuery(entry({ tags: ["zzz-tag"] }), "zzz-tag"), true);
});

test("japanese text matches without tokenisation", () => {
  assert.equal(matchesRepositoryQuery(entry(), "グローバー"), true);
});

/**
 * The separator matters. Without it a query could match across two fields that
 * are merely adjacent in the array, which is a hit no reader can account for.
 */
test("a query cannot match across a field boundary", () => {
  const e = entry({
    title: "alpha",
    titleJa: "beta",
    algorithmFamily: "",
    framework: "",
    description: "",
    descriptionJa: "",
    provenance: "",
    tags: [],
  });
  assert.equal(matchesRepositoryQuery(e, "alphabeta"), false);
  assert.equal(matchesRepositoryQuery(e, "alpha beta"), true);
});

test("a query matching nothing returns false rather than everything", () => {
  assert.equal(matchesRepositoryQuery(entry(), "shor"), false);
});

test("the haystack is lowercased once, so callers need not normalise", () => {
  assert.equal(searchHaystack(entry({ title: "MiXeD" })).includes("mixed"), true);
});

test("an entry with no tags does not throw", () => {
  assert.equal(matchesRepositoryQuery(entry({ tags: [] }), "grover"), true);
});
