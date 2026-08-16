import assert from "node:assert/strict";
import test from "node:test";
import { chooseRepositoryRecord } from "./catalog-record-choice.ts";

type Record = { slug: string; origin: "api" | "corpus" };

const api = (slug: string): Record => ({ slug, origin: "api" });
const corpus = (slug: string): Record => ({ slug, origin: "corpus" });
const published = (...slugs: string[]) => new Set(slugs);

/**
 * The regression this file exists for.
 *
 * `/repository/benchmark-bell-pair-ladder-2q` answered 200 on production for a
 * day after #656 withdrew it, serving a full record with verification badges
 * while the API answered 404 and the sitemap listed neither it nor its sibling.
 * The per-slug payload was a cached 200 that Next would not overwrite with a
 * 404, so the record could not stop serving on its own.
 */
test("a withdrawn record is refused even though a cached payload still parses", () => {
  const choice = chooseRepositoryRecord({
    slug: "benchmark-bell-pair-ladder-2q",
    parsed: api("benchmark-bell-pair-ladder-2q"),
    fallback: undefined,
    publishedSlugs: published("benchmark-bell-pair-ladder-4q", "benchmark-bell-pair-ladder-16q"),
  });
  assert.equal(choice.record, undefined, "a withdrawn slug must reach notFound()");
  assert.equal(choice.refusedStaleCache, true, "and the refusal must be loggable");
});

/**
 * The behaviour that must NOT regress, and the reason this check is scoped to
 * the listing rather than to "the API 404'd". An unattested, refused or
 * not-yet-imported record is absent from the published catalog on purpose and
 * still renders from the committed corpus.
 */
test("a corpus record the catalog does not publish still renders", () => {
  const choice = chooseRepositoryRecord({
    slug: "unattested-record",
    parsed: null,
    fallback: corpus("unattested-record"),
    publishedSlugs: published("something-else"),
  });
  assert.deepEqual(choice.record, corpus("unattested-record"));
  assert.equal(choice.refusedStaleCache, false, "an absent-from-API record is not a stale cache hit");
});

test("a published record is served from the API copy", () => {
  const choice = chooseRepositoryRecord({
    slug: "bell-state-qiskit",
    parsed: api("bell-state-qiskit"),
    fallback: corpus("bell-state-qiskit"),
    publishedSlugs: published("bell-state-qiskit"),
  });
  assert.deepEqual(choice.record, api("bell-state-qiskit"), "the API copy wins over the corpus");
  assert.equal(choice.refusedStaleCache, false);
});

/**
 * The availability half. With no authoritative listing there is nothing to
 * check a slug against, and guessing would turn an API outage into a site-wide
 * 404 storm — the exact failure the corpus fallback exists to prevent.
 */
test("no authoritative listing disables the check rather than guessing", () => {
  const choice = chooseRepositoryRecord({
    slug: "benchmark-bell-pair-ladder-2q",
    parsed: api("benchmark-bell-pair-ladder-2q"),
    fallback: undefined,
    publishedSlugs: null,
  });
  assert.deepEqual(choice.record, api("benchmark-bell-pair-ladder-2q"));
  assert.equal(choice.refusedStaleCache, false);
});

test("an unknown slug in neither the catalog nor the corpus is undefined", () => {
  const choice = chooseRepositoryRecord({
    slug: "never-existed",
    parsed: null,
    fallback: undefined,
    publishedSlugs: published("bell-state-qiskit"),
  });
  assert.equal(choice.record, undefined);
  assert.equal(choice.refusedStaleCache, false);
});

/**
 * A withdrawn record that the committed corpus still carries is the case where
 * the two rules meet. The corpus copy is served — the catalog withdrawing a
 * record is not, on its own, a reason to stop serving a record the repo still
 * ships — but the stale cached payload is still discarded and still logged, so
 * the divergence is visible rather than silent.
 */
test("a withdrawn record the corpus still carries serves the corpus copy, and says so", () => {
  const choice = chooseRepositoryRecord({
    slug: "withdrawn-but-committed",
    parsed: api("withdrawn-but-committed"),
    fallback: corpus("withdrawn-but-committed"),
    publishedSlugs: published("something-else"),
  });
  assert.deepEqual(choice.record, corpus("withdrawn-but-committed"));
  assert.equal(choice.refusedStaleCache, true);
});
