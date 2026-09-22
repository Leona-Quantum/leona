# How `curated-cases.yaml` was derived

**This is our own, small (18-case) ground truth, built 2026-09-21 for this offline
trial. It is not an official Atlas artifact and has not been reviewed by the owner.**
See `curated-cases.yaml`'s own header for the one-paragraph version; this file is the
full method, so a reader can re-derive or extend the set without guessing at intent.

## Method

1. **Candidate pool = a domain-facet `TopicId`.** `apps/web/lib/repository/topics.ts`
   defines nine domain topics (chemistry, materials, optimization, machine-learning,
   finance, linear-algebra, communication, metrology, cryptography), each
   **deliberately sparse** — that file's own header explains why (assigning a domain
   to every benchmark circuit that merely borrows a domain's vocabulary would be
   false coverage). This makes a domain-only filter (the finder's `problem` field —
   a HARD filter in production, `apps/web/lib/repository/finder.ts`'s
   `passesExcept`) a realistic, small, catalog-defined candidate pool: exactly what
   `findMethods` sees when a user picks a problem area and nothing else.

2. **`expected_slugs` = a further topic-tag intersection, or a title-text match —
   both taken directly from the catalog, never invented.** Two patterns, used as
   noted per case in `curated-cases.yaml`'s own `derivation` field:
   - **Topic intersection**: `topics ⊇ {domain, method[, method2]}` — e.g.
     `{chemistry, phase-estimation}`. Both facets are assigned by
     `apps/web/lib/repository/topics.ts`'s `TOPIC_RULES` (rule-based, reviewable,
     re-runnable — see that file's header), not hand-labelled by this trial.
   - **Title substring match** (case-insensitive), used only where the corpus does
     not further sub-tag a domain by application (e.g. "option" within `finance`
     distinguishes the option-pricing records from the same family's VaR/derivative
     records, which the topic vocabulary does not separate) — the substring is
     always the catalog's own wording, quoted in the case's `derivation` field.

3. **A case was kept only if its expected set was a proper, non-trivial subset of
   its pool** — in practice 1-3 records out of a pool of 2-17. A case where the
   intersection covered most of the pool (e.g. `optimization ∩ qaoa` = 8 of 17) was
   narrowed further (adding `benchmark-circuit`) or dropped, because a "ground
   truth" satisfied by most of the candidate set cannot discriminate a ranker from a
   coin flip.

4. **Every number was checked against the live corpus**, not copied from a one-off
   dump: `evals/jev-trial/scripts/finder-rank.mts` recomputes each case's `pool_size`
   at run time and the loader (`curated_cases.py`) hash-pins the YAML file itself, so
   a corpus edit that changes a pool size is a loud test failure, not a silently
   stale ground truth.

## A finding from building this, not a design choice

Every case in this set uses `hardwareEra: "any"` and no qubit/depth limit (the
finder's other two numeric filters), because none of the nine domain pools needed
narrowing further to reach a workable case size. Under those settings,
`findMethods`'s `satisfiedCount` is IDENTICAL for every record in a domain pool (each
gets exactly one `"problem: satisfied"` criterion and nothing else), so the entire
ranking within a pool is decided by the tie-break —
`apps/web/lib/repository/finder.ts`'s `compareMatches`: a worked-example hero first
(never true here — see `evals/jev-trial/scripts/finder-rank.mts`'s own header on why
`studioExampleId` is always null in this bridge), then **alphabetical by title**,
then slug.

Measured directly (`node --experimental-strip-types ... finder-rank.mts` against the
real corpus, 2026-09-21): the ranking this harness gets back for every domain pool
IS alphabetical-by-title, exactly. This is not a property of this trial's cases; it
is what the production finder does today whenever a user selects only a problem area
and nothing else — which the UI allows and, per this reading, likely the most common
single-filter use. It is the concrete, measured reason the current finder scores
weakly on relevance-style questions (see the top-level `README.md`'s reported
numbers) — not a defect in the bridge or the scorer.
