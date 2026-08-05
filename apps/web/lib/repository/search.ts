// The Atlas free-text search predicate (s81).
//
// Extracted from `repository-browser.tsx` when the `Algorithm family` control
// was removed, and extracted *because* it was removed. The argument for taking
// that control away is that this predicate already covers it: the haystack
// below includes `algorithmFamily`, so typing a family's name still gathers its
// members. On the corpus that argument holds exactly — no family loses one of
// its own members to search (`check-repository-data.mjs` asserts it).
//
// That makes the haystack load-bearing in a way it was not before. Dropping
// `algorithmFamily` from the array below would not break a test that tests the
// browser component — there isn't one, the page is a client component with no
// render harness — it would silently make 57 families unreachable. So the
// predicate lives here, where the corpus audit and a unit test can both reach
// the real thing rather than a re-implementation of it. A copy in the test
// would agree with itself forever.

/** The fields free-text search reads. Order is irrelevant; membership is not. */
export interface RepositorySearchable {
  title: string;
  titleJa: string;
  algorithmFamily: string;
  framework: string;
  description: string;
  descriptionJa: string;
  provenance: string;
  tags: readonly string[];
}

/**
 * Everything one entry is searchable by, as a single lowercased string.
 *
 * Joined with a space so a query cannot match across a field boundary — without
 * the separator, `titleJa` ending in "X" and `description` starting with "Y"
 * would answer a search for "XY", which is a match no reader can explain.
 */
export function searchHaystack(entry: RepositorySearchable): string {
  return [
    entry.title,
    entry.titleJa,
    entry.algorithmFamily,
    entry.framework,
    entry.description,
    entry.descriptionJa,
    entry.provenance,
    ...entry.tags,
  ]
    .join(" ")
    .toLowerCase();
}

/**
 * Whether `entry` matches `query`. An empty or whitespace-only query matches
 * everything, which is what an untouched search box should mean.
 *
 * Substring, not token or prefix: "grover" finds "Grover's algorithm" and
 * "Iterative Grover". Case-insensitive on both sides.
 */
export function matchesRepositoryQuery(entry: RepositorySearchable, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return searchHaystack(entry).includes(normalized);
}
