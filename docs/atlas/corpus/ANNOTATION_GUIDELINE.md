# Atlas VQE curated corpus — annotation guideline

**Version:** 0.1.0
**Status:** draft (Phase 2 in progress; not yet owner-reviewed)
**Authority:** `docs/atlas/atlas_vqe_mvp_execution_plan_ja.md` Phase 2

This directory is the Phase 2 curated corpus: real VQE papers, their
official/author implementation repositories, and the versioned components
they report, encoded machine-readably per the MVP plan's Phase 2
"機械可読corpus" requirements. **No DB schema exists yet** (Phase 2 explicitly
has `DB change: none`) — this is plain JSON, reviewed by a human before any
of it becomes a Neon `ArtifactVersion` in Phase 3.

## Hard rules

1. **Every bibliographic fact is verified**, not recalled from training data.
   Each paper record's `sources_verified` field lists the URLs actually
   checked (publisher page, arXiv abstract page, or equivalent) for title,
   authors, year, venue, DOI/arXiv ID. A paper with no verified source is not
   added.
2. **No copyrighted text is copied in.** README prose and source code are
   never reproduced here — only structured facts (a molecule name, an
   ansatz family name, a license SPDX identifier, a URL) and short factual
   paraphrase in the annotator's own words.
3. **Unknown stays unknown.** If a paper doesn't state something, the field
   is `null` with a note in `unknown_or_ambiguous_fields`, never guessed to
   fill the schema.
4. **`annotation_state` starts `draft` and stays `draft`** until a human
   (not the annotating agent) reviews the record and flips it to
   `human_reviewed`. An agent must never set `human_reviewed` on its own
   annotation — that is the whole point of the review step.
5. **No repository is fetched, cloned, or executed.** A repository record's
   `repository_url` is verified to exist (it resolves, its content matches
   the claimed paper) via read-only lookup only — never a code checkout.
   Full metadata ingestion is Phase 7, under ADR-0017's threat boundary.

## Paper record schema (`papers/<paper_id>.json`)

```jsonc
{
  "paper_id": "string, stable slug e.g. peruzzo2014",
  "annotation_schema_version": "0.1.0",
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
  "implementation_ref": "paper_id-matching key into repositories/, or null if none found",
  "reviewer_decision": {
    "annotation_state": "draft | human_reviewed | unknown | conflicting",
    "reviewer": "string|null",
    "reviewed_at": "ISO 8601 date|null"
  }
}
```

## Repository record schema (`repositories/<repo_id>.json`)

```jsonc
{
  "repo_id": "string, stable slug",
  "annotation_schema_version": "0.1.0",
  "repository_url": "https://github.com/...",
  "relation": "official | author | third_party_reference_implementation",
  "associated_paper_ids": ["paper_id", "..."],
  "paper_associated_commit": "immutable commit SHA if a specific one is citable, else null",
  "license_state": "SPDX id, or 'unknown', or free-text if non-standard",
  "environment_completeness": "e.g. 'requirements.txt present', 'no environment file found', 'unknown'",
  "evidence_locators": ["https://... (the specific page/section checked)"],
  "sources_verified": ["https://...", "..."],
  "unknown_or_ambiguous_fields": ["field_name: why"],
  "reviewer_decision": {
    "annotation_state": "draft | human_reviewed | unknown | conflicting",
    "reviewer": "string|null",
    "reviewed_at": "ISO 8601 date|null"
  }
}
```

## Method family taxonomy (plan Phase 2 candidate list)

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
taxonomy is a search aid, not a completeness gate.

## Component type reference

Reuses `majorana_vqe.models.ComponentType` (Phase 1) exactly, so a corpus
component record can be promoted into a real `ComponentSpec` later without a
remapping step: `problem`, `problem_preparation`, `representation`,
`reference_state`, `ansatz`, `operator_pool`, `search_selection`,
`growth_batching`, `parameter_optimizer`, `compression`, `measurement`,
`error_mitigation`, `compilation_backend`, `learning_training`,
`evaluation_protocol`, `workflow`.

## What Phase 2 does NOT claim

Per the MVP plan's own acceptance gates, none of the following may be
asserted by the annotating agent — they require a human:

- `annotation_state: human_reviewed` on any record the agent itself wrote.
- The corpus-wide "≥80% human-reviewed" acceptance figure.
- Inter-annotator agreement (requires a second, independent human reviewer).
- The 3 curated comparison reports as "manual gold" — these must be
  human-authored, not produced by an automatic classifier dressed up as one
  (see `majorana_vqe.comparison`'s own docstring on this exact point).

These are recorded as open, owner-gated items in
`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md`'s Phase 2 section, not
silently skipped.
