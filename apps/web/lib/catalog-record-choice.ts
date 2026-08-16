/**
 * Which copy of one catalog record the public site should serve.
 *
 * ## Why this is its own module
 *
 * Same reason as `catalog-revalidate.ts`: `repository-source.ts` reaches
 * `./catalog-pagination` through an extensionless relative import, which bare
 * `node --test` cannot resolve, so nothing importable from that file can be
 * tested directly. This module has no imports of its own, so the decision it
 * encodes can be asserted on. It is pure — no fetch, no cache, no corpus.
 *
 * ## The bug it exists for
 *
 * The per-slug catalog `fetch` is cached with `next: { revalidate: 300 }`.
 * Next's data cache does not overwrite a stored 200 with the 404 a later
 * revalidation gets back, so once a slug had been fetched successfully, the
 * payload proving it existed outlived the record. A withdrawn record therefore
 * kept serving indefinitely, and no deploy cleared it.
 *
 * Measured on production 2026-08-16, the day after PR 656 withdrew the 2-qubit
 * width variants: `/repository/benchmark-bell-pair-ladder-2q` and
 * `/repository/benchmark-ghz-chain-2q` both answered 200 with a full record and
 * its verification badges, while the API answered 404 for both and the sitemap
 * listed neither. Two sibling 2q slugs answered 404 correctly — their cache
 * entries had been evicted. Which withdrawn records kept serving was decided by
 * cache eviction, which is why the symptom looked arbitrary.
 *
 * ## Why the listing is the authority
 *
 * The listing is the one read that cannot go stale this way: it answers 200
 * every time, so every revalidation replaces it. A per-slug payload is evidence
 * that the record existed when it was cached, not that it exists now.
 *
 * ## What this deliberately does NOT do
 *
 * It does not reject a slug merely because the API does not publish it. Serving
 * a committed-corpus record the catalog has not published is intended
 * behaviour — unattested, refused and not-yet-imported records are all absent
 * from the published catalog and still render from the corpus. The narrow claim
 * is only that a cached API payload stops being evidence of existence once the
 * catalog's own listing no longer contains the slug.
 */

export type RepositoryRecordChoice<T> = {
  /** The record to render, or undefined for a real notFound(). */
  record: T | undefined;
  /**
   * True when a cached per-slug payload was discarded because the listing does
   * not contain the slug. The caller logs this: it is the only signal that a
   * withdrawal actually took effect, and silence here is what let the original
   * bug run for a day.
   */
  refusedStaleCache: boolean;
};

export function chooseRepositoryRecord<T>(input: {
  slug: string;
  /** The per-slug payload, already parsed. Null when the API did not serve it. */
  parsed: T | null;
  /** The committed-corpus copy, if the corpus carries this slug. */
  fallback: T | undefined;
  /**
   * Slugs the catalog currently publishes, or null when no authoritative
   * listing could be obtained this render.
   *
   * **Null must mean "could not be proved", not merely "unreachable".** Absence
   * from this set is about to be read as a withdrawal, so anything that could
   * remove a slug for a reason OTHER than withdrawal has to produce null
   * instead. `authoritativePublishedSlugs()` in repository-source.ts is the only
   * intended producer, and it returns null when pagination could not prove
   * completeness, when any row failed validation, and when the listing came back
   * empty — because in each of those a live record can be missing from the set,
   * and 404ing live records is far worse than briefly serving a withdrawn one.
   */
  publishedSlugs: ReadonlySet<string> | null;
}): RepositoryRecordChoice<T> {
  const { slug, parsed, fallback, publishedSlugs } = input;

  // `parsed !== null` rather than a truthiness test: T is generic, and a falsy
  // T would otherwise skip the branch silently.
  if (parsed !== null && publishedSlugs !== null && !publishedSlugs.has(slug)) {
    // Withdrawn: the catalog is reachable and does not list this slug, so the
    // parsed payload can only have come from the cache. Fall through to the
    // corpus, which is still allowed to carry it for the reasons above; when it
    // does not, this is undefined and the caller renders a real 404.
    return { record: fallback, refusedStaleCache: true };
  }

  return { record: parsed ?? fallback, refusedStaleCache: false };
}
