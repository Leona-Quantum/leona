import assert from "node:assert/strict";
import test from "node:test";
import {
  filterByTopic,
  topicDefinition,
  topicOptionLabel,
  topicOptions,
  TOPICS_A_CATEGORY_TAB_OWNS,
} from "./repository/topic-filter.ts";
import { PUBLIC_REPOSITORY_TOPICS, type TopicId } from "./repository/topics.ts";
import { PUBLIC_REPOSITORY_CATEGORIES } from "./repository/types.ts";

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

  // `algorithm-reference`, `gate-primitive` and `operator` are carried by CORPUS
  // and are still absent: a category tab owns those words (ai-ops#75).
  assert.deepEqual([...offered].sort(), [
    "benchmark-circuit",
    "block-encoding",
    "fermionic-encoding",
    "finance",
    "linear-algebra",
    "materials",
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
    topicOptions([entry("ansatz-2q", "benchmark-circuit")], "en").map((group) => group.facet),
    ["role"],
  );
  // A corpus whose only role is one a category tab owns has no role group at
  // all — an empty heading reading "What it is" over nothing is worse than the
  // collision it replaced.
  assert.deepEqual(
    topicOptions([entry("h", "gate-primitive")], "en").map((group) => group.facet),
    [],
  );
});

test("a topic a category tab owns is not offered, and benchmark-circuit still is", () => {
  // ai-ops#75. `/repository` showed Gate (27) in the rail beside a Gates tab
  // holding 29, and the same three-word collision on States and Operators —
  // in Japanese with byte-identical labels. The tabs keep the words.
  const offered = topicOptions(CORPUS, "en").flatMap((group) => group.options.map((o) => o.id));
  for (const owned of TOPICS_A_CATEGORY_TAB_OWNS) {
    assert.ok(!offered.includes(owned), `${owned} is offered and a category tab owns its word`);
  }
  // The one role no tab can express: 120 published yardsticks inside the 267
  // the Algorithms tab holds. Dropping it would leave this facet saying nothing
  // the tabs do not.
  assert.ok(offered.includes("benchmark-circuit"));
  assert.ok(!TOPICS_A_CATEGORY_TAB_OWNS.has("benchmark-circuit"));
});

test("no offered topic wears a word a category tab wears, in either locale", () => {
  // The guard, rather than the list: `TOPICS_A_CATEGORY_TAB_OWNS` is a decision
  // and can fall behind, and the way it falls behind is a *new* topic label
  // that happens to be a category word — which nothing else would catch. Run
  // over the whole vocabulary, not over CORPUS, so a topic no fixture carries
  // is still checked.
  const singular = (label: string) => label.toLowerCase().replace(/s$/, "");
  const offeredIds = new Set(
    PUBLIC_REPOSITORY_TOPICS.filter((topic) => !TOPICS_A_CATEGORY_TAB_OWNS.has(topic.id)).map(
      (topic) => topic.id,
    ),
  );
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    if (!offeredIds.has(topic.id)) continue;
    for (const category of PUBLIC_REPOSITORY_CATEGORIES) {
      assert.notEqual(
        singular(topic.label),
        singular(category.label),
        `topic "${topic.label}" and category "${category.label}" are one word with two numbers`,
      );
      // Japanese has no plural, so this one is exact equality — and it is how
      // the collision was worst: ゲート was both the tab and the topic.
      assert.notEqual(
        topic.labelJa,
        category.labelJa,
        `topic "${topic.labelJa}" and category "${category.labelJa}" are one word with two numbers`,
      );
    }
  }
});

test("a bookmark naming a topic the control no longer offers still filters", () => {
  // Not offered is not retired. These four still classify every record and
  // still drive the Ingredients shelf, so an old `?topic=gate-primitive` link
  // must return its rows rather than an empty list.
  assert.deepEqual(filterByTopic(CORPUS, "gate-primitive").map((e) => e.slug), ["hadamard"]);
});

test("options within a group keep vocabulary order, not corpus order", () => {
  const methods = topicOptions(CORPUS, "en")
    .find((group) => group.facet === "method")!
    .options.map((option) => option.id);
  // `variational` is declared first in the vocabulary and `block-encoding`
  // second, and CORPUS meets them in the other order. Ordering by first
  // appearance would make the control's sequence a function of which records
  // happen to be published.
  assert.deepEqual(methods, ["variational", "block-encoding", "fermionic-encoding"]);
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

test("a record listing a topic twice is still counted once", () => {
  // `deriveTopics` cannot emit a duplicate and CI refuses one in the corpus,
  // but this function is also handed records straight from the API, where
  // `topics` is shape-checked and nothing more. Raised by CodeRabbit on PR 264;
  // the symptom is a label promising more rows than its own filter returns.
  const doubled = [{ slug: "twice", topics: ["materials", "materials"] as TopicId[] }];

  const option = topicOptions(doubled, "en")
    .flatMap((group) => group.options)
    .find((entry) => entry.id === "materials");

  assert.equal(option?.count, 1);
  assert.equal(filterByTopic(doubled, "materials").length, 1);
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
