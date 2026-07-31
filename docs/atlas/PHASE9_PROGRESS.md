# Phase 9 progress — LLM-assisted extraction

Updated: 2026-07-31

## Current state

- S0 threat, claim, and spending boundary: complete in the Phase 9 plan;
- S1 versioned candidate envelope: implemented and locally verified;
- S2 prompt/data isolation: implemented and locally verified;
- S3 bounded Phase 8 input assembly: implemented and locally verified;
- S4 strict whole-response validation and private provenance envelope:
  implemented and locally verified;
- S5–S6 adversarial corpus and offline evaluation: not yet complete;
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

Eight initial local contract tests cover deterministic request construction, prompt
injection isolation, lifecycle-field exclusion, strict extra-field handling,
duplicate identities, dangling evidence, conflict evidence cardinality,
non-finite/oversized values, and the total input byte budget. These are offline
schema and isolation tests, not an LLM extraction-quality score.

## S3 bounded Phase 8 input assembly

The assembler consumes the actual neutral Phase 8 Python and notebook result
types plus strict declared-fact inputs. It refuses any result marked as having
executed code, any notebook marked publication-eligible, unsafe paths, empty
input, secret-shaped values, duplicate identities, or an invalid/oversized
bundle. It produces stable evidence IDs and sorts them before constructing the
canonical bundle digest.

Secret detection covers private-key headers and common GitHub, OpenAI-style,
WorkOS-style, Google, AWS, credential-bearing database URL, and literal
credential-assignment shapes. It deliberately reports only a stable rejection
code and never copies the matched value into an exception. This is a bounded
pre-provider leak prevention layer, not a claim that arbitrary secrets are
perfectly detectable.

Notebook code and Markdown remain labelled untrusted text. Prompt-injection
sentences without credentials are retained as evidence data rather than
silently deleted; the S2 system policy makes them non-authoritative. No target
code, notebook, network, or provider is executed by assembly.

## S4 strict response and provenance envelope

The response parser accepts one bounded UTF-8 JSON object and rejects duplicate
keys, non-finite numbers, malformed/non-object JSON, schema violations,
dangling evidence IDs, extra lifecycle fields, secret-shaped output, and size
limits. Any failure rejects the whole response; no partial candidate is
returned or persisted.

The validated private envelope records repository/commit/snapshot and input
digests, prompt/policy/schema versions, provider, requested and served model
IDs, input/output token counts, and the raw-response SHA-256. It stores the
validated structured response, not raw provider prose or chain-of-thought. Its
machine state is limited to `schema_and_evidence_validated`, while human review
is `unreviewed` and both publication and materialization remain false. Request
tampering is detected by rebuilding and comparing the canonical request.

The `majorana-llm` suite now has 65 passing tests, including 27 focused Phase 9
tests across S1–S4. These are deterministic contract tests with no provider
call and no extraction-quality measurement.

## Open gates

S5–S6 must add a dedicated adversarial/labelled corpus and measure schema,
evidence-reference, unsupported-claim, and replay behavior without presenting
synthetic results as live-model quality. No live provider call is permitted
before those gates pass and the owner explicitly approves provider, model, and
budget.
