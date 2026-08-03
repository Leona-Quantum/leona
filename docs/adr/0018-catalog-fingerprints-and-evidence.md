# ADR-0018: Catalog identity separates byte, normalized, and semantic fingerprints

**Date:** 2026-07-18 · **Status:** proposed — two of three hashes built, evidence never built

> **Annotated 2026-08-04. Partially built; the parts that were not are the load-bearing
> ones.**
>
> - **Built:** `source_blob_sha256` and `normalized_source_hash`, as
>   `catalog_hashing.hash_source_blob` and `hash_normalized_source`, with columns from
>   migration `0014_catalog_classification`.
> - **Not built — `semantic_fingerprint`.** The columns exist
>   (`artifact_versions.semantic_fingerprint` and `.semantic_fingerprint_algorithm`, plus
>   the ORM attributes and a `None`-defaulted keyword in `repos/catalog.py`), and
>   **nothing computes or writes them**. The only other reference in the tree is a
>   migration test asserting the columns are present. A reader who greps for the field
>   finds schema and concludes the feature exists; it does not.
> - **Not built — the evidence tables.** `artifact_verifications` and
>   `conversion_attempts` appear in no migration and no ORM model. The immutable,
>   version-bound evidence rows this ADR requires, and the rule that public support
>   labels are *derived from matching stored evidence rather than mutable boolean
>   fields*, therefore have nothing to derive from. What the public site renders instead
>   is the legacy prose `verification` / `exportStatus` strings carried inside the
>   catalog record blob — which is the outcome this ADR and ADR-0019 were written to
>   prevent.
>
> Nothing below is edited. The three-way hash separation and the "prose cannot create a
> passing run" rule remain the standing design; carry them into the block-evidence model
> rather than re-deriving them (`plans/leona-block-repository-roadmap.md`).

**Context:** The current artifact fingerprint identifies selected-framework source
inside one artifact, but the public catalog must reject exact duplicates globally,
preserve multiple provenance claims, compare quantum semantics without unsafe
auto-merges, and prevent verification or conversion evidence from surviving a source
or environment change. One overloaded hash cannot safely serve all of these roles.
**Decision:** Store three versioned fingerprint classes with domain separation.
`source_blob_sha256` hashes the exact retrieved bytes. `normalized_source_hash` hashes
the normalizer ID/version, authoritative framework/format, and deterministic normalized
source. `semantic_fingerprint` records an algorithm/version plus a reviewer-assistance
value derived from the observed circuit; it is never a uniqueness authority. A
catalog-only content-claim or deduplication table owns global exact/normalized claims
without changing uniqueness semantics for private workspace artifacts. A repeated
exact or normalized claim attaches additional immutable source/citation provenance to
the existing conceptual entry or enters duplicate review; it does not create another
accepted count. Semantic matches only create review candidates and never auto-merge.
Verification and conversion records are immutable and bind to artifact version ID,
source and normalized hashes, method/converter ID and version, canonical parameters,
toolchain/environment digest, input/output hashes, and result/warning references.
Public support labels are derived from matching stored evidence rather than mutable
boolean fields.
**Consequences:** The catalog can explain whether two records share bytes, normalized
source, or only likely circuit meaning, and repaired/converted code cannot inherit
stale evidence. The cost is explicit normalizer versioning, a global catalog dedup
claim, canonical parameter serialization, immutable evidence rows, and reconciliation
tests. Hash algorithms are stored with their values; changing normalization or
semantic algorithms creates new claims and a controlled recomputation job rather than
rewriting history. Literature citations, expert review, LLM review, parsing, execution,
statistical checks, and formal equivalence remain separate evidence methods; prose
cannot create a passing run. Converter path availability and generated/import recipes
do not constitute execution or equivalence evidence. Collision, canonicalization,
concurrency, and two-import race tests are required before publication. Reversal
trigger: a stronger content-addressing or formal canonical circuit standard may be
added as a new algorithm version, but historical hashes and evidence bindings remain
readable and immutable.
