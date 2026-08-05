import assert from "node:assert/strict";
import test from "node:test";
import {
  filterByTopic,
  topicDefinition,
  topicOptionLabel,
  topicOptions,
} from "./repository/topic-filter.ts";
import type { TopicId } from "./repository/topics.ts";

/**
 * The browse list's topic filter.
 *
 * Tested here rather than by clicking, for the reason session 77 recorded after
 * the browse ordering: React does not hydrate /repository in either browser
 * surface, so the `<select>` behind this cannot be driven by automation. A rule
 * that can only be checked by hand is a rule nobody checks.
 */

const entry = (slug: string, ...topics: TopicId[]) => ({ slug, topics });

const CORPUS = [
  entry("ansatz-16q", "benchmark-circuit", "variational"),
  entry("tfim-4q", "benchmark-circuit", "variational", "materials"),
  entry("hubbard", "operator", "fermionic-encoding", "materials"),
  entry("hhl", "algorithm-reference", "block-encoding", "finance", "linear-algebra"),
  entry("hadamard", "gate-primitive"),
];

test("no filter returns everything, and returns a copy", () => {
  const all = filterByTopic(CORPUS, "");
  assert.equal(all.length, CORPUS.length);
  assert.notEqual(all, CORPUS, "callers sort this; handing back the input array would sort theirs");
});

test("a filter keeps every entry carrying the topic, whichever facet it is", () => {
  assert.deepEqual(
    filterByTopic(CORPUS, "materials").map((e) => e.slug),
    ["tfim-4q", "hubbard"],
  );
  assert.deepEqual(
    filterByTopic(CORPUS, "benchmark-circuit").map((e) => e.slug),
    ["ansatz-16q", "tfim-4q"],
  );
});

test("an entry carrying two domains is found under both", () => {
  // HHL is `finance` and `linear-algebra`. A filter that assumed one domain per
  // entry would drop it from one of the two lists, and nothing would say so.
  assert.deepEqual(filterByTopic(CORPUS, "finance").map((e) => e.slug), ["hhl"]);
  assert.deepEqual(filterByTopic(CORPUS, "linear-algebra").map((e) => e.slug), ["hhl"]);
});

test("an id outside the vocabulary filters to nothing rather than to everything", () => {
  // A stale bookmark naming a retired topic must not silently show the whole
  // corpus under a control that claims to be filtering it.
  assert.deepEqual(filterByTopic(CORPUS, "retired-topic" as TopicId), []);
});

test("the control offers only topics something in hand actually carries", () => {
  const groups = topicOptions(CORPUS, "en");
  const offered = groups.flatMap((group) => group.options.map((option) => option.id));

  assert.deepEqual([...offered].sort(), [
    "algorithm-reference",
    "benchmark-circuit",
    "block-encoding",
    "fermionic-encoding",
    "finance",
    "gate-primitive",
    "linear-algebra",
    "materials",
    "operator",
    "variational",
  ]);
  // Every option must find rows. An option that empties the list reads as "the
  // corpus has nothing like this", which is a stronger claim than the truth.
  for (const id of offered) {
    assert.ok(filterByTopic(CORPUS, id).length > 0, `${id} is offered and matches nothing`);
  }
});

test("groups come back in facet order whatever the corpus contains", () => {
  assert.deepEqual(
    topicOptions(CORPUS, "en").map((group) => group.facet),
    ["role", "method", "domain"],
  );
  // And a corpus with no domain at all simply has no domain group, rather than
  // an empty one that reads as a facet with nothing in it.
  assert.deepEqual(
    topicOptions([entry("h", "gate-primitive")], "en").map((group) => group.facet),
    ["role"],
  );
});

test("options within a group keep vocabulary order, not corpus order", () => {
  const roles = topicOptions(CORPUS, "en")[0].options.map((option) => option.id);
  // `gate-primitive` is declared first in the vocabulary and appears last in
  // CORPUS. Ordering by first appearance would make the control's sequence a
  // function of which records happen to be published.
  assert.deepEqual(roles, ["gate-primitive", "operator", "benchmark-circuit", "algorithm-reference"]);
});

test("counts are what the filter will actually return", () => {
  for (const group of topicOptions(CORPUS, "en")) {
    for (const option of group.options) {
      assert.equal(
        option.count,
        filterByTopic(CORPUS, option.id).length,
        `${option.id} promises ${option.count}`,
      );
    }
  }
});

test("the label carries the count, because a bare domain name reads as a promise", () => {
  const materials = topicOptions(CORPUS, "en")
    .flatMap((group) => group.options)
    .find((option) => option.id === "materials");
  assert.ok(materials);
  assert.equal(topicOptionLabel(materials), "Materials & magnetism (2)");
});

test("labels and definitions follow the locale", () => {
  const ja = topicOptions(CORPUS, "ja").flatMap((g) => g.options).find((o) => o.id === "materials");
  assert.equal(ja?.label, "物性・磁性");
  assert.notEqual(topicDefinition("materials", "ja"), topicDefinition("materials", "en"));
  assert.equal(topicDefinition("", "en"), null);
  assert.equal(topicDefinition("not-a-topic" as TopicId, "en"), null);
});
