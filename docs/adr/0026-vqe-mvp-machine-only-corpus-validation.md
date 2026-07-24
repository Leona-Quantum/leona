# ADR-0026: VQE MVP corpus acceptance is machine-validated only; human curation review is deferred to post-MVP

**Date:** 2026-07-24 · **Status:** proposed (owner-directed; see context)
**Context:** The Phase 2 execution plan (`docs/atlas/atlas_vqe_mvp_execution_plan_ja.md`
Phase 2, written 2026-07-24) required, as MVP acceptance gates: ≥80% of curated
corpus records marked human-reviewed, measured inter-annotator agreement between
two independent human reviewers, and ≥3 comparison reports authored as
"human-curated manual gold." These require human labor this MVP-building session
has no access to, and the agent building the corpus cannot itself satisfy them
(an agent cannot be the human reviewer of its own annotation — that defeats the
review step's purpose). The corpus mechanics (26 verified papers, a first pass of
15 implementation repositories, 59 component records) were completed and then
correctly stopped at exactly that gate, per the plan's own Part VIII §24 stop
conditions. The owner subsequently directed, explicitly and in writing, that MVP
acceptance be redefined to not require human review at all, while being explicit
that this is a scope change to record, not a silent pass.
**Decision:** MVP acceptance for the curated corpus is redefined as **machine-
validated**, not human-validated. Concretely: (1) each corpus record's
`reviewer_decision` (human review state) is replaced by `validation_state`
(machine schema/consistency validation state: `draft` / `machine_validated` /
`validation_failed` / `conflicting`, plus `validator_version` and `validated_at`)
— see `docs/atlas/corpus/ANNOTATION_GUIDELINE.md` for the full field
definitions; (2) "≥80% human-reviewed", "owner stop pending human review",
"inter-annotator agreement", and "second independent human reviewer" are removed
from MVP acceptance criteria entirely, not merely postponed silently; (3)
comparison reports for MVP are explicitly machine-generated
(`is_manual_gold: false`, `human_validated: false`, with `generation_method`/
`generator_version` recorded) rather than human-curated gold; (4) the phrase
"verified" throughout the corpus means *sourced and machine-schema-checked*, not
*a human confirmed the content is scientifically correct* — this distinction is
recorded explicitly everywhere the word is used, per the owner's instruction not
to let "verified" quietly imply human validation it does not have. Human
curation, inter-annotator agreement, and manual-gold comparison authoring remain
real, valuable future work — they are moved to a **post-MVP phase**, not deleted
from the project's intent, and this ADR does not claim MVP corpus data has been
human-validated at any point past, present, or future without a further review
step actually happening.
**Consequences:** This unblocks Phase 3 planning without waiting on human
availability, and makes the corpus's actual trust level machine-legible (a
consumer of `validation_state` can tell it means "passed automated checks," not
"a domain scientist agrees with this"). It costs real scientific rigor: MVP
corpus content, however carefully sourced, has not been checked by a domain
expert for correctness, and every surface that displays this data (UI, API,
docs) must say so rather than implying otherwise — this is a standing
requirement on all future phases per the plan's revised Part VIII principles,
not just this ADR's text. It also retroactively reclassifies the Phase 0 H2
fixture's "automated cross-validation PASS, human/owner review PENDING" language
(`docs/atlas/PHASE0_OWNER_REVIEW.md`) as consistent with this same MVP-wide
posture, not an isolated exception. Reversal trigger: when human review capacity
becomes available post-MVP, a superseding ADR (or a follow-up to this one)
reintroduces a review layer on top of — not replacing — the machine-validation
layer defined here; it must not delete `validation_state` or retroactively mark
existing MVP-era records as human-reviewed without an actual review happening.
