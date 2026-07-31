# Phase 9 progress — LLM-assisted extraction

Updated: 2026-07-31

## Current state

- S0 threat, claim, and spending boundary: complete in the Phase 9 plan;
- S1 versioned candidate envelope: implemented locally;
- S2 prompt/data isolation: implemented locally;
- S3–S6 bounded assembly, strict response parsing, adversarial corpus, and
  offline evaluation: not yet complete;
- S7 owner-approved live dry run: blocked by design until explicit
  provider/model/budget approval;
- S8–S12 persistence, review, materialization, E2E, and release audit: not yet
  started.

No live LLM provider was contacted, no credential was read, and no external
quota was spent in S0–S2.

## S0 boundary

The LLM is an unreviewed private candidate generator only. It has no authority
to verify scientific correctness, compatibility, license validity, execution,
human review, publication, or performance. Target repository code and notebooks
remain non-executing evidence. Live provider calls are an owner-controlled
spending and credential action.

## S1 candidate envelope

`majorana_llm.research_extraction` defines strict frozen models for:

- immutable repository/snapshot evidence bundles;
- five allowed candidate types: implementation, component, problem, dataset,
  and experiment;
- allowlisted candidate field keys;
- exact evidence references, unknowns, and conflicts;
- a schema-constrained candidate response.

Extra fields, duplicate evidence IDs, duplicate candidate IDs and field keys,
dangling evidence references, non-finite numbers, duplicate conflict locators,
and configured input/response/field JSON size, node, and depth ceilings fail
closed. Lifecycle and publication fields such as `review_state` and
`publication_state` are not representable by the model-facing schema.

The evidence bundle has a canonical deterministic digest. This digest is a
serialization identity, not evidence that the input or a later model output is
scientifically correct.

## S2 prompt/data isolation

The dedicated v1 prompt declares all source-derived strings untrusted, forbids
following embedded instructions, browsing, tool use, code/notebook execution,
gap-filling from memory, and unsupported status claims. It requires every
candidate field to cite supplied evidence IDs and allows zero candidates when
evidence is insufficient.

The request builder serializes the source bundle as canonical JSON in the user
message and keeps it out of the system policy. It sets deterministic decoding
parameters and a response JSON schema but does not itself call a provider. An
explicit output-token ceiling bounds a future approved call.

Eight local contract tests cover deterministic request construction, prompt
injection isolation, lifecycle-field exclusion, strict extra-field handling,
duplicate identities, dangling evidence, conflict evidence cardinality,
non-finite/oversized values, and the total input byte budget. These are offline
schema and isolation tests, not an LLM extraction-quality score.

## Open gates

S3 must add a secret-aware bounded assembler from actual Phase 8 records. S4
must add strict duplicate-key/non-finite response parsing and resolve every
locator before persistence. S5–S6 must measure adversarial and labelled offline
fixtures. No live provider call is permitted before those gates pass and the
owner explicitly approves provider, model, and budget.
