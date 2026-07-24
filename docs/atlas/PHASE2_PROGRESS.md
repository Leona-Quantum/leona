# Atlas VQE MVP — Phase 2 progress record

**Date:** 2026-07-24 (revised; supersedes the earlier version of this document)
**Status:** all corpus-mechanics acceptance criteria met, machine-validated,
zero errors. See `docs/adr/0026-vqe-mvp-machine-only-corpus-validation.md`
for why this document no longer describes an owner/human-review stop point.

## 0. What changed since the first version of this document

The first version of this record (2026-07-24, earlier same day) reported
corpus mechanics done but explicitly stopped before claiming any of:
80%-human-reviewed, inter-annotator agreement, or 3 human-curated "manual
gold" comparison reports — correctly, per the plan as it existed then.

The owner subsequently issued ADR-0026: **MVP acceptance for this corpus
does not require or claim human review at all.** This is a documented scope
change, not a silent pass — the removed requirements, why, and what was
deferred to post-MVP are recorded in the ADR and in
`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md`'s Phase 2 section. This
document now reports against the *revised* acceptance criteria (§2 below),
and also fixes two real defects the owner's review caught in the first
pass:

1. **Repository classification was wrong.** The first pass reported
   "15 official/author implementation repositories" but had actually
   labeled 10 of the 15 as `third_party_reference_implementation` and
   folded them into that count. `docs/atlas/corpus/ANNOTATION_GUIDELINE.md`
   §4.1 now defines four distinct relations
   (`official`/`author`/`general_framework_library`/`third_party_reference_implementation`),
   and the Phase 2 acceptance criterion is now literally "verified
   implementation repositories >= 15" with the four-way breakdown always
   reported alongside it (§3 below) — not "official/author >= 15" backed by
   a miscount.
2. **`mcclean2018.json`'s `sources_verified` contained a prose sentence, not
   a URL** ("referenced via multiple corroborating secondary sources...").
   Re-verified directly against `https://www.nature.com/articles/s41467-018-07090-4`
   and fixed. All 41 records were then audited for the same class of bug
   (empty `sources_verified`, non-URL entries) — none found elsewhere.

## 1. What was built (cumulative)

`docs/atlas/corpus/`:

- `ANNOTATION_GUIDELINE.md` (v0.2.0) — versioned schema, now with
  `validation_state` (machine-only, §2) replacing `reviewer_decision`, the
  4-way repository relation definitions, and the comparison-report schema.
- `papers/*.json` — 26 records, schema 0.2.0.
- `repositories/*.json` — 15 records, schema 0.2.0.
- `comparisons/*.json` — 3 machine-generated records (new; §4 below).
- `generate_comparisons.py` — the script that produced them, kept so the
  process is reproducible/auditable, matching the Phase 0 fixture-generator
  pattern.
- `validator/README.md`, `validator/online_url_audit.py` — the online,
  explicitly-non-CI URL-reachability audit tool.

`packages/py/vqe/src/majorana_vqe/corpus_validation.py` — the offline
validator (schema/enum/reference/consistency checks), plus
`packages/py/vqe/tests/test_corpus_validation.py` (43 tests, including an
integration test that runs the validator against the real corpus).

## 2. Phase 2 acceptance criteria (revised, ADR-0026) — measured against actual

| Criterion | Required | Actual |
|---|---:|---:|
| versioned annotation guideline exists | yes | yes (v0.2.0) |
| verified paper records | >= 25 | **26** |
| verified implementation repository records | >= 15 | **15** |
| component records | >= 50 | **59** |
| corpus validator checks all records (offline) | yes | yes, `majorana_vqe.corpus_validation` |
| schema/enum/reference validation errors | 0 | **0** |
| unresolved warnings/unknowns hidden | no | no — recorded in `unknown_or_ambiguous_fields`/`conflicting_fields` on every record, never dropped |
| machine-generated comparison reports | >= 3 | **3** |
| comparisons claimed as manual gold/human validated | none | none — all 3 have `is_manual_gold: false`, `human_validated: false` |
| all tests/lint/format pass | yes | yes (§6) |
| schema + open items recorded for Phase 3 | yes | yes (§7) |

**"Verified" here means:** sourced (a real, dereferenceable URL was opened
or directly returned by a search for that specific fact) and passed the
offline schema/consistency validator. It does **not** mean a human
confirmed the content is scientifically correct — see ADR-0026 and
`ANNOTATION_GUIDELINE.md` §5 rule 5 for why that distinction is enforced
everywhere this word is used.

## 3. Repository relation breakdown (never collapsed into one number)

```text
official                          2   (aicaffeinelife/QAdaPrune;
                                        quantumlib/ReCirq's recirq.hfvqe submodule)
author                             2   (mayhallgroup/adapt-vqe;
                                        mafaldaramoa/ceo-adapt-vqe)
general_framework_library          9   (OpenFermion, OpenFermion-PySCF, Qiskit,
                                        Qiskit Nature, Qiskit Algorithms, Cirq,
                                        PennyLane, tequila, Tangelo)
third_party_reference_implementation 2 (mafaldaramoa/VQE; mcmahon-lab/error_mitigation_vqe)
-----
total                             15
```

`official + author = 4`. The plan's literal "official/author implementation
repositories" phrase, read strictly, is not yet at 15 — the Phase 2
acceptance criterion was revised to "verified implementation repositories
>= 15" specifically to stop conflating these categories (option B from the
owner's review, adopted as recommended), and this breakdown must always be
shown alongside the total from now on, not just the total by itself.

## 4. Comparison reports (machine-generated, not gold)

| comparison_id | classification | why |
|---|---|---|
| `peruzzo2014_vs_shen2017` | `partial` | same molecule (HeH+), same ansatz family (UCC), different hardware (photonic vs. trapped-ion); no computed digest exists at this corpus depth so most dimensions are honestly `unknown` |
| `grimsley2019_vs_tang2021` | `partial` | both ADAPT-style adaptive growth, but fermionic vs. qubit-excitation operator pool -- a real, evidenced `changed` dimension, not just unknown |
| `omalley2016_vs_kandala2017` | `invalid` | different molecules (H2 vs. LiH/BeH2) -- `PROBLEM_DIGEST` marked `changed`, which is correctly blocking per `majorana_vqe.comparison.classify_comparison` |

All three: `is_manual_gold: false`, `human_validated: false`,
`generation_method`/`generator_version`/`source_record_ids`/`generated_at`
recorded, every `fixed`/`changed` dimension carries an `evidence_locator`
(validator-enforced — an assertion without one is a validation error). None
of the 12 fixed comparison dimensions were forced to a stronger
classification than the literature-level evidence supports; most dimensions
across all three reports are `unknown` because this corpus has no executed
`ScientificExperimentSpec` yet (that is Phase 3/5 territory) — this is the
honest, expected outcome of a pre-execution, machine-only comparison, not a
defect.

## 5. A real bug found and fixed while doing this work

While generating the comparison reports, `ComparisonDimension.detail`
(declared `Field(max_length=500)`) was rejecting valid input over 200
characters — the shared path/code-rejection regex
(`majorana_vqe.models._SAFE_LABEL_PATTERN`) had its own, different,
hardcoded 200-character cap baked in, silently overriding the field's own
declared limit. Fixed by removing the length cap from the shared regex
(charset safety is that pattern's job; length is each field's own
`Field(max_length=...)` job, enforced in exactly one place now). Covered by
existing and new tests; full suite re-run clean afterward.

## 6. Tests, lint, validation — actual results

```text
uv run pytest packages/py/vqe -q          -> 123 passed
uv run ruff check packages/py/vqe docs/atlas/corpus  -> clean
uv run ruff format --check packages/py/vqe docs/atlas/corpus -> clean
uv run lint-imports                        -> 4 kept, 0 broken
uv run python -m majorana_vqe.corpus_validation -> errors=0 warnings=0
```

All 41 paper/repository records' `validation_state.state` is
`machine_validated` (validator_version `0.1.0`, timestamped 2026-07-24) --
never `human_reviewed`, because that value does not exist in this schema.

## 7. Open items carried to Phase 3

- `param_adapt` method family has 0 papers — no real paper by that name was
  found despite dedicated search; left honestly uncovered rather than
  force-fit (unchanged from the first pass).
- Several individual fields (a few DOIs, one arXiv ID, some benchmark-
  molecule specifics, one paper's full author list, several repositories'
  `license_state`) remain in `unknown_or_ambiguous_fields` — not blocking,
  but should be tightened before this corpus is treated as authoritative
  for anything beyond MVP schema validation.
- `mafaldaramoa_ceo-adapt-vqe`'s `author` relation to `anastasiou2024`
  specifically (as opposed to `ramoa2025`, which is solid) is flagged as
  weaker evidence in that record's own `unknown_or_ambiguous_fields`.
- Human curation, inter-annotator agreement, and manual-gold comparison
  authoring remain real future work, explicitly deferred to post-MVP by
  ADR-0026 — not deleted from the project's intent, just not an MVP gate.
- Phase 3 (Neon Component Registry) import of this corpus must not set
  `majorana_vqe.models.AnnotationState.HUMAN_REVIEWED` on any component
  derived from these records merely because their `validation_state.state`
  is `machine_validated` — those are different claims (see
  `ANNOTATION_GUIDELINE.md` §2 and `packages/py/vqe/AGENTS.md`).
