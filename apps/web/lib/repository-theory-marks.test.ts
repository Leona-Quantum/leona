import assert from "node:assert/strict";
import test from "node:test";

import {
  marksOf,
  parseTheory,
  THEORY_MARKS,
  validatePairedTheory,
  validateTheory,
} from "./repository/theory-marks.ts";

/**
 * The marks inside a hop's mathematics — the owner's re-decision of session 114's
 * three stacked sections into one annotated paragraph.
 *
 * Two authored hops carry real marks (`forward-euler`, `backward-euler`), so the
 * happy path is proved against live data by `repository-map-card.test.ts`. What
 * is proved *here* is the part live data cannot reach: every way an author can
 * write a mark wrongly, and the fact that the parser survives all of them. That
 * split matters because the parser is deliberately forgiving and the validator is
 * deliberately not — a renderer that threw on a typo would take a page down over
 * one, so the gate has to be somewhere else and this is where it is checked.
 */

test("plain prose is one run, and no mark is invented in it", () => {
  assert.deepEqual(parseTheory("The interval is cut into steps of size h."), [
    { mark: null, text: "The interval is cut into steps of size h." },
  ]);
  // Brackets a reader might actually write. `[[` is not a sequence prose reaches
  // for, which is the whole reason it was chosen — but a single bracket is.
  assert.deepEqual(marksOf("u_k in [0, T] with A[i][j] entries"), []);
  assert.deepEqual(parseTheory(""), []);
});

test("a marked clause is its own run and keeps its kind", () => {
  const spans = parseTheory("It solves S. [[approximation: first order]] Then it stops.");
  assert.deepEqual(spans, [
    { mark: null, text: "It solves S. " },
    { mark: "approximation", text: "first order" },
    { mark: null, text: " Then it stops." },
  ]);
  // Order, not just membership. The marks are positions in a sentence, and a
  // caller comparing two locales compares the sequences.
  assert.deepEqual(marksOf("a [[assumption: x]] b [[approximation: y]] c"), [
    "assumption",
    "approximation",
  ]);
});

test("a mark at either end produces no empty run beside it", () => {
  // Guarding the off-by-one that makes a slice of length zero: a leading mark has
  // nothing before it and a trailing one nothing after. An empty span would draw
  // an empty `<span>` in the card, which is invisible and therefore never
  // reported by anyone who sees it.
  assert.deepEqual(parseTheory("[[assumption: A is Hermitian]] and so on"), [
    { mark: "assumption", text: "A is Hermitian" },
    { mark: null, text: " and so on" },
  ]);
  assert.deepEqual(parseTheory("so far [[approximation: truncated at order k]]"), [
    { mark: null, text: "so far " },
    { mark: "approximation", text: "truncated at order k" },
  ]);
  assert.deepEqual(parseTheory("[[approximation: all of it]]"), [
    { mark: "approximation", text: "all of it" },
  ]);
});

test("a multi-line mark is one clause, because prose in this corpus wraps", () => {
  const spans = parseTheory("x [[assumption: the generator\nis time independent]] y");
  assert.deepEqual(spans[1], { mark: "assumption", text: "the generator\nis time independent" });
});

test("the parser never throws and never drops text on malformed input", () => {
  // The contract that lets the validator be the only gate. Each of these is
  // rejected by `validateTheory` below; none of them may lose a word here,
  // because the card renders whatever survives and a silently shortened sentence
  // is worse than a visible pair of brackets.
  const bad = [
    "x [[approximation: unclosed",
    "x ]] stray closer",
    "x [[approximaton: typo]] y",
    "x [[approximation: [[assumption: nested]] ]] y",
    "x [[approximation: ]] y",
  ];
  for (const source of bad) {
    const rendered = parseTheory(source)
      .map((span) => span.text)
      .join("");
    assert.ok(rendered.length > 0, `${source}: parsed to nothing`);
    assert.ok(
      rendered.includes("x"),
      `${source}: lost the prose around the malformed mark — rendered "${rendered}"`,
    );
  }
});

test("every way to write a mark wrongly is reported, with the offending text in it", () => {
  assert.deepEqual(validateTheory("hop", "It solves S. [[approximation: first order]]"), []);

  const unknown = validateTheory("hop", "x [[approximaton: y]]");
  assert.equal(unknown.length, 1);
  assert.match(unknown[0]!, /approximaton/);
  // The message names the kinds that *are* legal, so an author does not have to
  // find this module to learn what to write instead.
  for (const mark of THEORY_MARKS) assert.match(unknown[0]!, new RegExp(mark));

  assert.deepEqual(validateTheory("hop", "x [[assumption: y"), [
    "hop: 1 '[[' and 0 ']]' — a mark is unclosed",
  ]);
  assert.deepEqual(validateTheory("hop", "x ]] y"), [
    "hop: 0 '[[' and 1 ']]' — a mark is unclosed",
  ]);
  assert.ok(
    validateTheory("hop", "x [[approximation: [[assumption: y]] ]]").some((error) =>
      error.includes("nested"),
    ),
  );
  assert.ok(
    validateTheory("hop", "x [[approximation:  ]] y").some((error) =>
      error.includes("marks nothing"),
    ),
  );
});

test("the two locales must mark the same clauses in the same order", () => {
  const en = "It solves S. [[approximation: first order]] [[assumption: A is stiff]]";
  assert.deepEqual(
    validatePairedTheory("hop", en, "S を解きます。[[approximation: 一次精度]] [[assumption: A は剛性]]"),
    [],
  );
  // A dropped highlight. Both strings are present, both are non-empty, and both
  // render — nothing else in the graph would notice, which is exactly why this
  // check exists rather than being left to review.
  const dropped = validatePairedTheory("hop", en, "S を解きます。[[approximation: 一次精度]]");
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!, /approximation, assumption/);
  // Same set, different order: two translations marking different clauses of the
  // same sentence. Reported, because a `Set` comparison would call this equal.
  const reordered = validatePairedTheory(
    "hop",
    en,
    "S を解きます。[[assumption: A は剛性]] [[approximation: 一次精度]]",
  );
  assert.equal(reordered.length, 1);
});
