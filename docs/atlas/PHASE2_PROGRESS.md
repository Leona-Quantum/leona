# Atlas VQE MVP — Phase 2 progress record

**Date:** 2026-07-24
**Status:** corpus-mechanics targets met; **stopped at the owner gate** per explicit
instruction ("Phase 2のhuman-reviewed判定（Claude自身を人間reviewerとして数えない）").
Do not read this document as Phase 2 being complete — see §4.

## 1. What was built

`docs/atlas/corpus/`:

- `ANNOTATION_GUIDELINE.md` (v0.1.0) — versioned schema for paper and
  repository records, method-family taxonomy, hard rules (verify everything,
  no copied copyrighted text, unknown stays unknown, agent never
  self-certifies `human_reviewed`, no repository fetch/clone/execution).
- `papers/*.json` — 26 records.
- `repositories/*.json` — 15 records.

## 2. Measured counts against plan targets

| Target (plan Phase 2) | Required | Actual |
|---|---:|---:|
| VQE papers | >= 25 | **26** |
| official/author implementation repositories | >= 15 | **15** (5 `official`, 10 `third_party_reference_implementation`) |
| component records | >= 50 | **59** |
| human-reviewed records | >= 80% | **0%** — see §4, this is the deliberate stop point |
| curated comparison reports | >= 3 | **0** — not started, requires human-authored gold per plan's own warning against automatic-judgment dressed up as curation |

Method-family coverage across the 26 papers (a paper may belong to more than
one family):

```text
vqe_uccsd            14
adapt_vqe              8
measurement_reduction  3
pruning_compression    2
tetris_adapt           1
qubit_adapt            1
qeb_adapt              1
ceo_adapt              1
learning_guided_vqe    1
param_adapt            0  -- see §3
```

## 3. What was NOT found, honestly recorded rather than invented

No real paper literally named "Param-ADAPT-VQE" (or an unambiguous
equivalent) was located despite dedicated search attempts. Per the
guideline's own rule ("the taxonomy is a search aid, not a completeness
gate"), this family is left at 0 rather than force-fitting an unrelated
paper to it or inventing one. If the owner knows of a specific paper this
should map to, it can be added on request.

A small number of individual fields across the corpus (a few DOIs, an arXiv
ID, some benchmark-molecule specifics, one paper's full author list) could
not be confirmed at search-summary depth and are explicitly listed in each
record's own `unknown_or_ambiguous_fields`, not silently guessed. One
record (`moll2018`) had a pattern-matched candidate DOI deliberately
discarded rather than recorded as if verified, after review caught the same
mistake once already in Phase 0.

## 4. Explicit stop point — owner gate

Per the owner's standing instruction, the following are **not** claimed and
require human action, not the annotating agent:

- **`annotation_state: human_reviewed`** on any record — all 26 paper
  records and all 15 repository records are `draft`. The agent that wrote
  an annotation cannot also be the reviewer who marks it reviewed; that
  defeats the review step's purpose.
- **The corpus-wide "≥80% human-reviewed" acceptance figure** — currently
  0%, and cannot become anything else without actual human review passes.
- **Inter-annotator agreement** — requires a second, independent human
  annotator re-annotating a sample and comparing; not attempted.
- **The 3 curated comparison reports as "manual gold"** — the plan
  explicitly warns these must not be an automatic classifier dressed up as
  curation (`majorana_vqe.comparison`'s own docstring makes the same point
  about its `classify_comparison()` heuristic). None have been authored.

## 5. What happens next

- If the owner wants to proceed with human review of the existing 26
  papers / 15 repositories, that review can start directly against the
  files in `docs/atlas/corpus/` using `ANNOTATION_GUIDELINE.md`'s schema.
- If the owner wants a larger or differently-weighted corpus (e.g. more
  weight on `param_adapt`, `measurement_reduction`, or
  `learning_guided_vqe`, which are thin at 0-3 papers each) before review
  starts, more papers can be researched and added first.
- The 3 curated comparison reports need an owner (or owner-designated
  human) to actually compare specific paper/workflow pairs and record
  fixed/changed/unknown per `majorana_vqe.comparison.ComparisonDimensionName`
  -- this agent can prepare candidate pairs and draft scaffolding, but the
  classification itself must be a human judgment call per the plan.
- Phase 3 (Neon Component Registry) cannot begin until Phase 2's full
  acceptance (including the human-reviewed figure and comparison reports)
  is met, per the plan's own phase-ordering rule.
