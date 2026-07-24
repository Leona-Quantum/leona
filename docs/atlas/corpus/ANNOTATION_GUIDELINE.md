# Atlas VQE curated corpus — annotation guideline

**Version:** 0.2.0 (breaking change from 0.1.0 — see §0 below)
**Status:** draft (Phase 2 in progress)
**Authority:** `docs/atlas/atlas_vqe_mvp_execution_plan_ja.md` Phase 2,
`docs/adr/0026-vqe-mvp-machine-only-corpus-validation.md`

This directory is the Phase 2 curated corpus: real VQE papers, their
implementation repositories, and the versioned components they report,
encoded machine-readably per the MVP plan's Phase 2 "機械可読corpus"
requirements. **No DB schema exists yet** (Phase 2 explicitly has
`DB change: none`) — this is plain JSON, machine-validated per this
guideline before any of it becomes a Neon `ArtifactVersion` in Phase 3.

## 0. Schema change from 0.1.0 (ADR-0026)

The original 0.1.0 schema had a `reviewer_decision` object implying human
review (`annotation_state: draft | human_reviewed | unknown | conflicting`,
plus a `reviewer` name and `reviewed_at` date). Per ADR-0026, **MVP
acceptance for this corpus does not require or claim human review**. 0.2.0
replaces `reviewer_decision` with `validation_state` (§2 below), a strictly
machine-checkable status. This is a breaking, not additive, change — every
record's `annotation_schema_version` must read `0.2.0`, and no record may
mix the two shapes. Nothing about this change hides that human review was
originally planned: see ADR-0026 and `docs/atlas/PHASE2_PROGRESS.md` for
the full history, and this file's own git history for the 0.1.0 text.

## 1. Hard rules

1. **Every bibliographic fact is sourced**, not recalled from training data.
   Each record's `sources_verified` field lists only real, dereferenceable
   HTTP(S) URLs that were actually opened or returned as a direct search
   hit for that specific fact — never a prose description standing in for a
   URL, and never a blanket "verified via search" claim covering the whole
   record. A record with an empty `sources_verified` is invalid.
2. **A URL being present does not mean everything in the record is proven.**
   Each source supports the specific facts it was checked for. Anything not
   directly confirmed by an opened source goes in
   `unknown_or_ambiguous_fields`, not into a field presented as settled.
3. **No copyrighted text is copied in.** README prose and source code are
   never reproduced here — only structured facts (a molecule name, an
   ansatz family name, a license SPDX identifier, a URL) and short factual
   paraphrase in the annotator's own words.
4. **Unknown stays unknown.** If a source doesn't state something, the
   field is `null` with a note in `unknown_or_ambiguous_fields`, never
   guessed or pattern-matched to fill the schema. (A pattern-matched DOI
   that "looks right" is exactly the kind of value this rule forbids
   recording as settled — put it in `unknown_or_ambiguous_fields` instead.)
5. **`validation_state` is machine-only** (§2). No record, tool, UI, or
   document may describe a corpus record as "human-reviewed",
   "human-validated", or "ground truth". "Verified" in this corpus always
   means *sourced and machine-schema-checked*, never *a human confirmed
   this is scientifically correct*.
6. **No repository is fetched, cloned, or executed.** A repository record's
   `repository_url` is verified to exist (it resolves, its content matches
   the claimed paper) via read-only lookup only — never a code checkout.
   Full metadata ingestion is Phase 7, under ADR-0017's threat boundary.
7. **Comparison reports are machine-generated, not curated gold** (§6). A
   report must carry `is_manual_gold: false` and `human_validated: false`
   and must never claim a dimension is `fixed` or `changed` without an
   evidence locator backing it — unresolvable dimensions are `unknown`.

## 2. Validation state (replaces `reviewer_decision`)

```jsonc
"validation_state": {
  "state": "draft | machine_validated | validation_failed | conflicting",
  "validator_version": "string (e.g. '0.1.0') or null if the validator has not run yet",
  "validated_at": "ISO 8601 UTC datetime, or null",
  "validation_errors": ["string", "..."],
  "validation_warnings": ["string", "..."]
}
```

- `draft`: authored, not yet run through the corpus validator.
- `machine_validated`: passed the validator in `docs/atlas/corpus/validator/`
  (schema shape, enums, cross-references, ID uniqueness, etc. — see §7)
  with zero `validation_errors`. **This state means the record is
  well-formed and internally consistent; it does not mean a human confirmed
  its content is scientifically correct.**
- `validation_failed`: the validator ran and found at least one error.
- `conflicting`: the annotator recorded a genuine conflict between sources
  (see `conflicting_fields`) that the schema cannot resolve automatically.

This state is set by running the validator (`docs/atlas/corpus/validator/`),
never hand-edited to claim a status the validator did not actually produce.

**Relationship to `majorana_vqe.models.AnnotationState`/`ComponentSpec.annotation_state`
(Phase 1, `packages/py/vqe/`):** that is a separate, DB-facing product schema
for Phase 3+, not this corpus's own state. It is compatible with this change
— `AnnotationState.HUMAN_REVIEWED` remains a valid future value for when a
real review pipeline exists, but no Phase 2 MVP corpus data populates it,
and MVP corpus import into that schema (Phase 3, not yet built) must not set
`annotation_state: human_reviewed` merely because a corpus record has
`validation_state.state: machine_validated`. Those are different claims.

## 3. Paper record schema (`papers/<paper_id>.json`)

```jsonc
{
  "paper_id": "string, stable slug e.g. peruzzo2014",
  "annotation_schema_version": "0.2.0",
  "title": "string",
  "authors": ["string", "..."],
  "year": 2014,
  "venue": "string",
  "volume": "string|null",
  "pages_or_article_number": "string|null",
  "doi": "string|null",
  "arxiv_id": "string|null",
  "method_family": ["one or more of the Method family taxonomy below"],
  "problem_summary": "short factual paraphrase, not copied text",
  "sources_verified": ["https://...", "..."],
  "components": [
    {
      "component_type": "one of majorana_vqe.models.ComponentType",
      "family_or_name": "string",
      "notes": "short factual paraphrase",
      "evidence_locator": "e.g. 'abstract', 'Fig. 2', 'Sec. III.A'"
    }
  ],
  "workflow_composition_notes": "how the components above fit together, string|null",
  "unknown_or_ambiguous_fields": ["field_name: why it's unknown/ambiguous"],
  "conflicting_fields": ["field_name: what conflicts and against what"],
  "negative_results_or_missing_implementation": "string|null",
  "implementation_ref": "repo_id-matching key into repositories/, or null if none found",
  "validation_state": { "...": "see §2" }
}
```

## 4. Repository record schema (`repositories/<repo_id>.json`)

```jsonc
{
  "repo_id": "string, stable slug",
  "annotation_schema_version": "0.2.0",
  "repository_url": "https://github.com/...",
  "relation": "official | author | general_framework_library | third_party_reference_implementation",
  "associated_paper_ids": ["paper_id", "..."],
  "paper_associated_commit": "immutable commit SHA if a specific one is citable, else null",
  "license_state": "SPDX id, or 'unknown', or free-text if non-standard",
  "environment_completeness": "e.g. 'requirements.txt present', 'no environment file found', 'unknown'",
  "evidence_locators": ["https://... (the specific page/section checked)"],
  "sources_verified": ["https://...", "..."],
  "unknown_or_ambiguous_fields": ["field_name: why"],
  "validation_state": { "...": "see §2" }
}
```

### 4.1 `relation` definitions — do not conflate these

The plan's corpus target is phrased "official/author implementation
repositories". These four values must stay distinct so that count is never
inflated by including general tooling:

- **`official`** — the paper's own text, or its official journal/arXiv
  supplementary materials, explicitly states or links this repository as
  *the* implementation of that specific paper (e.g. a "Code availability"
  statement, or a project page the paper itself points to).
- **`author`** — confirmed, via independent evidence, to be released or
  maintained by one of the paper's own authors (e.g. a personal or lab
  GitHub account clearly implementing that paper's method), but the
  paper's own text was not confirmed to explicitly link it. Weaker evidence
  than `official`, still authored by the right person(s).
- **`general_framework_library`** — a broad, general-purpose tool (e.g.
  OpenFermion, Qiskit, Qiskit Nature, PennyLane, Cirq, tequila) that was
  not written for any single paper, even if it implements a method the
  paper describes and even if its authors overlap with a corpus paper's
  authors. **Never count these toward "official/author implementation
  repositories" without saying so explicitly** — the plan's target counts
  paper-specific implementations, not the ecosystem they were built on.
- **`third_party_reference_implementation`** — an independent reproduction
  or solver module written by someone who is *not* an author of the
  associated paper (e.g. a different research group's open-source
  reimplementation).

`official` and `author` together are the plan's literal "official/author"
category. `general_framework_library` and `third_party_reference_implementation`
are real, useful, verified corpus entries, but they are not that category —
see the Phase 2 acceptance criterion `verified implementation repositories`
(plan §Phase 2, ADR-0026) for how the overall repository count is now
defined, and always report the four-way breakdown alongside any total.

## 5. Method family taxonomy (plan Phase 2 candidate list)

```text
vqe_uccsd
adapt_vqe
qubit_adapt
qeb_adapt
tetris_adapt
ceo_adapt
param_adapt
pruning_compression
measurement_reduction
learning_guided_vqe
```

A paper may belong to more than one family (e.g. a pruning paper applied to
UCCSD). A paper that doesn't fit any of these is still added with
`method_family: []` and a note in `unknown_or_ambiguous_fields` — the
taxonomy is a search aid, not a completeness gate. As of this corpus's first
pass (2026-07-24), `param_adapt` has 0 papers: no real paper matching that
name was located despite a dedicated search; this is recorded honestly
rather than force-fit to an unrelated paper.

## 6. Component type reference

Reuses `majorana_vqe.models.ComponentType` (Phase 1) exactly, so a corpus
component record can be promoted into a real `ComponentSpec` later without a
remapping step: `problem`, `problem_preparation`, `representation`,
`reference_state`, `ansatz`, `operator_pool`, `search_selection`,
`growth_batching`, `parameter_optimizer`, `compression`, `measurement`,
`error_mitigation`, `compilation_backend`, `learning_training`,
`evaluation_protocol`, `workflow`.

## 7. Corpus validator

`docs/atlas/corpus/validator/` (see its own README) checks every record
offline (no network) for: JSON syntax, required fields present, no
unexpected fields, `annotation_schema_version` correctness, filename
matching `paper_id`/`repo_id`, ID uniqueness, DOI/arXiv-ID duplicate
detection, `method_family`/`component_type`/`relation` enum validity,
paper→repository and repository→paper cross-reference integrity,
`sources_verified` URL-shape validity, at least one `evidence_locator`
present where required, `validation_state` internal consistency, and
per-`relation` count reporting. A separate, explicitly-online script
(`docs/atlas/corpus/validator/online_url_audit.py`) checks that recorded
URLs actually resolve — this never runs as part of normal offline CI, so a
network blip never makes the standard test suite flaky.

## 8. Comparison report schema (`comparisons/<comparison_id>.json`)

```jsonc
{
  "comparison_id": "string, stable slug",
  "annotation_schema_version": "0.2.0",
  "generation_method": "e.g. 'majorana_vqe.comparison.classify_comparison heuristic'",
  "generator_version": "majorana-vqe package version used",
  "source_record_ids": ["paper_id or repo_id, ...", "..."],
  "generated_at": "ISO 8601 UTC datetime",
  "dimensions": [
    {"name": "one of ComparisonDimensionName", "status": "fixed|changed|unknown", "detail": "string|null", "evidence_locator": "string|null"}
  ],
  "classification": "strict | controlled | partial | invalid",
  "unresolved_conflicts": ["string", "..."],
  "validation_warnings": ["string", "..."],
  "is_manual_gold": false,
  "human_validated": false
}
```

`is_manual_gold` and `human_validated` are always `false` for MVP-generated
reports (ADR-0026); a future post-MVP human-curated report would be a
*different* record with those fields `true` and a recorded reviewer
identity, never the same record retroactively edited.

## 9. What Phase 2 MVP does NOT claim (ADR-0026)

- No record's `validation_state` is anything implying human review — the
  state machine (§2) has no `human_reviewed` value at all.
- No corpus-wide "≥80% human-reviewed" figure is computed or claimed; it is
  not an MVP acceptance criterion.
- No inter-annotator agreement is measured; it requires a second,
  independent human annotator and is deferred to post-MVP.
- No comparison report is "manual gold" or "human-curated" — all MVP
  comparison reports are machine-generated (§8) and labeled as such.
- `official`/`author` repository counts are never inflated by including
  `general_framework_library` or `third_party_reference_implementation`
  entries (§4.1).

These are deliberate, documented MVP-scope decisions
(`docs/adr/0026-vqe-mvp-machine-only-corpus-validation.md`), not silently
unmet requirements.
