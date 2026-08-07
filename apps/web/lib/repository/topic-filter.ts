// Filtering the browse list by a topic, and building the control that offers it (R2).
//
// A pure module rather than a condition inside the component. Session 77 gave
// the reason as "React does not hydrate /repository in either browser surface,
// so the control cannot be driven by automation" — **that premise is false**,
// measured on production in s81; it came from `next dev` in an agent browser
// pane, whose CSP blocks the `eval()` dev-mode React needs.
//
// The conclusion outlives the premise, on better grounds: a filter rule inside
// a component body can only be exercised by rendering that component, which
// makes verifying it cost a browser and a hydration. Here it costs a `node
// --test` run. Since s91 the control offering these options is a list of links
// rather than a `<select>`, so the rule is also reachable by reading the HTML.
//
// The counts are the honest half of this file. A control that offers
// "Optimization" with no number beside it invites the reader to assume the
// corpus has as much of it as they need; "Optimization (10)" does not.

import { PUBLIC_REPOSITORY_TOPICS, TOPICS_BY_ID, type TopicFacet, type TopicId } from "./topics.ts";

/** What the filter reads. Anything carrying topics can be filtered. */
export interface TopicFilterable {
  topics?: TopicId[];
}

export interface TopicOption {
  id: TopicId;
  facet: TopicFacet;
  label: string;
  /** How many of the entries offered to `topicOptions` carry it. Never zero. */
  count: number;
}

export interface TopicOptionGroup {
  facet: TopicFacet;
  options: TopicOption[];
}

/**
 * The options a control may offer, grouped by facet and counted against the
 * entries in hand.
 *
 * **A topic no entry in this set carries is not offered.** Selecting it would
 * empty the list, and an empty list reads as "the corpus has nothing like this"
 * when the truth is narrower — nothing *here*, under the filters already
 * applied. The vocabulary is closed but the control is not the vocabulary.
 */
export function topicOptions(
  entries: readonly TopicFilterable[],
  locale: "en" | "ja",
): TopicOptionGroup[] {
  const counts = new Map<TopicId, number>();
  for (const entry of entries) {
    // Deduplicated per entry, because `filterByTopic` returns each entry once
    // and these two numbers have to be the same number. `deriveTopics` cannot
    // emit a duplicate and CI refuses one in the corpus, but this function is
    // also fed records straight from the API, where `topics` is shape-checked
    // and nothing more — and the failure is a label promising more rows than
    // the filter it labels will return.
    for (const topic of new Set(entry.topics ?? [])) {
      counts.set(topic, (counts.get(topic) ?? 0) + 1);
    }
  }
  const groups = new Map<TopicFacet, TopicOption[]>();
  for (const topic of PUBLIC_REPOSITORY_TOPICS) {
    const count = counts.get(topic.id) ?? 0;
    if (count === 0) continue;
    const option: TopicOption = {
      id: topic.id,
      facet: topic.facet,
      label: locale === "ja" ? topic.labelJa : topic.label,
      count,
    };
    const bucket = groups.get(topic.facet);
    if (bucket) bucket.push(option);
    else groups.set(topic.facet, [option]);
  }
  // Facet order is the vocabulary's, not insertion order, so the control reads
  // the same whatever the corpus happens to contain.
  return (["role", "method", "domain"] as const)
    .filter((facet) => groups.has(facet))
    .map((facet) => ({ facet, options: groups.get(facet) ?? [] }));
}

/**
 * Entries carrying `topic`, or all of them when nothing is selected.
 *
 * `""` rather than null for "no filter" because that is what an unselected
 * `<select>` yields, and translating it in the component is one more place the
 * empty case can be got wrong. An unknown id filters to nothing rather than to
 * everything: a stale bookmark naming a retired topic should show a reader an
 * empty list, not silently the whole corpus under a heading that says otherwise.
 */
export function filterByTopic<T extends TopicFilterable>(
  entries: readonly T[],
  topic: TopicId | "",
): T[] {
  if (!topic) return [...entries];
  return entries.filter((entry) => (entry.topics ?? []).includes(topic));
}

/** The label a control shows for one option, count included. */
export function topicOptionLabel(option: TopicOption): string {
  return `${option.label} (${option.count})`;
}

/** The definition to put under a selected topic, or null when none is selected. */
export function topicDefinition(topic: TopicId | "", locale: "en" | "ja"): string | null {
  if (!topic) return null;
  const found = TOPICS_BY_ID.get(topic);
  if (!found) return null;
  return locale === "ja" ? found.definitionJa : found.definition;
}
