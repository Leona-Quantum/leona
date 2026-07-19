# ADR-0018: Catalog identity separates byte, normalized, and semantic fingerprints

**Date:** 2026-07-18 · **Status:** proposed (owner/CODEOWNER decision required)
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
