// The census behind `/repository/claims`, and the one sentence it prints.
//
// What these assert is not arithmetic. Every one of them is a way the surface
// could go on rendering while quietly making a different claim than it does now:
// a row falling out of the partition, an `absent` losing the scope of what was
// read, or the sentence losing its denominator to an edit that made it shorter.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  speedupCensusSentence,
  speedupClaimCensus,
  type SpeedupProvenance,
} from "./repository/speedup-claims.ts";

/**
 * A shaped fixture, not the corpus: this runner cannot load the corpus modules
 * (see the module header). Every count here is distinct, so a test that asserts a
 * position in the sentence cannot pass by matching the wrong number.
 */
const provenance: readonly SpeedupProvenance[] = ([
  { states: "reported", quote: "the authors' own words" },
  { states: "absent", read: "the whole paper, sections 1-6" },
  { states: "absent", read: "the abstract only" },
  { states: "unknown" },
  { states: "unknown" },
  { states: "unknown" },
  { states: "unknown" },
] as const).map((primary, at) => ({
  slug: `record-${at}`,
  title: "A record",
  titleJa: "ある記録",
  zooName: "Some Zoo entry",
  zooSection: "Oracular Algorithms",
  speedup: "Polynomial",
  source: { id: "arxiv:0", title: "A paper", authors: "An author", year: "2000", url: "https://arxiv.org/abs/0" },
  primary,
}));

const census = speedupClaimCensus(provenance);

test("every record lands in exactly one group", () => {
  const total = census.reported.length + census.absent.length + census.unchecked.length;
  assert.equal(
    total,
    census.records,
    `${census.records} records partition into ${total}. A record in no group is invisible on the page`
    + " and a record in two is counted twice in the sentence.",
  );
  const slugs = [...census.reported, ...census.absent, ...census.unchecked].map((row) => row.slug);
  assert.equal(new Set(slugs).size, slugs.length, "a slug appears in two groups");
});

test("an `absent` names the text that was read", () => {
  // The claim is "this text does not contain it", never "the authors never say
  // it". Drop `read` and the row silently widens into the second claim, which is
  // one this repository cannot support from an abstract.
  for (const row of census.absent) {
    assert.ok(
      row.read.trim().length > 0,
      `${row.slug}: "the paper does not state it" with nothing naming what was read`,
    );
  }
});

test("a `reported` carries the source's own words", () => {
  for (const row of census.reported) {
    assert.ok(row.quote.trim().length > 0, `${row.slug}: reported with no quote behind it`);
  }
});

test("every row attributes the class to the index, not to this repository", () => {
  for (const row of [...census.reported, ...census.absent, ...census.unchecked]) {
    assert.ok(row.speedup.trim().length > 0, `${row.slug}: no speedup class to attribute`);
    assert.ok(row.zooName.trim().length > 0, `${row.slug}: no Zoo entry named as the source of the class`);
  }
});

test("the census sentence carries all four numbers, in both locales", () => {
  for (const locale of ["en", "ja"] as const) {
    const sentence = speedupCensusSentence(census, locale);
    for (const [what, value] of [
      ["total", census.records],
      ["reported", census.reported.length],
      ["absent", census.absent.length],
      ["unchecked", census.unchecked.length],
    ] as const) {
      assert.ok(
        sentence.includes(String(value)),
        `${locale}: the sentence does not print the ${what} count (${value}): ${sentence}`,
      );
    }
  }
});

test("the sentence states the denominator before the finding", () => {
  // The whole point of the page. "2 records disagree with the index" reads as
  // 2 of 2; it is only honest next to the total and the unchecked majority. An
  // edit that shortened the sentence by cutting the lead is the realistic way
  // this is lost, so the ordering is asserted rather than the wording.
  //
  // The fixture is 7 records — 1 reported, 2 absent, 4 unchecked. Four distinct
  // counts, so matching a position cannot succeed against the wrong number.
  assert.deepEqual(
    [census.records, census.reported.length, census.absent.length, census.unchecked.length],
    [7, 1, 2, 4],
  );
  for (const locale of ["en", "ja"] as const) {
    const sentence = speedupCensusSentence(census, locale);
    assert.ok(
      sentence.indexOf("7") < sentence.indexOf("2"),
      `${locale}: the finding is stated before the denominator: ${sentence}`,
    );
    assert.ok(
      sentence.indexOf("4") > sentence.indexOf("2"),
      `${locale}: the unchecked majority is not stated after the finding: ${sentence}`,
    );
  }
});
