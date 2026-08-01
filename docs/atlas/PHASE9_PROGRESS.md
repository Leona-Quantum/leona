# Phase 9 progress — LLM-assisted extraction

Updated: 2026-08-01

## Current state

- S0 threat, claim, and spending boundary: complete in the Phase 9 plan;
- S1 versioned candidate envelope: implemented and locally verified;
- S2 prompt/data isolation: implemented and locally verified;
- S3 bounded Phase 8 input assembly: implemented and locally verified;
- S4 strict whole-response validation and private provenance envelope:
  implemented and locally verified;
- S5 adversarial corpus: implemented and locally verified;
- S6 offline contract evaluation: implemented, regenerated, and locally verified;
- S7 owner-approved live dry run: completed once with DeepSeek V4 Flash and a
  private Qiskit Nature metadata bundle;
- S8 private append-only persistence: implemented and qualified on fresh
  PostgreSQL 17 in feature-branch CI;
- S9 evidence-bound human review queue: implemented and locally verified;
  fresh-PostgreSQL CI qualification is pending this feature-branch push;
- S10–S12 materialization, E2E, and release audit: not yet started.

No live LLM provider was contacted in S0–S6. S7 used the owner-supplied
DeepSeek credential for exactly one generation request with retries disabled.

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

The `majorana-llm` suite now has 66 passing tests, including 28 focused Phase 9
tests across S1–S6. These are deterministic contract tests with no provider
call and no extraction-quality measurement.

## S5 adversarial corpus

The labelled synthetic corpus covers eight whole-response cases: one valid
candidate, one honest zero-candidate response, a dangling evidence reference,
a lifecycle/publication escalation, a mixed valid-and-invalid batch, duplicate
JSON keys, a non-finite number, and prompt-injection prose instead of JSON.
The mixed batch is intentionally rejected in full so an invalid candidate
cannot be dropped while apparently valid siblings are persisted.

Fixtures contain no real repository source, provider output, credential, or
human scientific label. They test only local trust-boundary behavior. The
corpus therefore cannot be used to estimate extraction precision, recall, or
scientific correctness.

## S6 offline contract evaluation

`evaluate_research_validation_fixtures` runs every labelled response twice and
measures expected accept/reject decisions, stable rejection-code agreement,
and deterministic replay. It has no provider or network dependency. The
regenerable redacted evidence report is stored at
`docs/atlas/evidence/phase9/offline_validation_baseline.json` with SHA-256
`3f26c2c0884d1f7458a4a2a1e68c98b4f4c46fb2712b908ee3ecce4999f6a254`.

The report records 8 fixtures, 2 expected accepts, 6 expected rejects, and
1.0 decision, rejection-code, and deterministic-replay agreement. The report
itself labels these numbers `synthetic_validator_contract_not_model_quality`
and records `provider_call_performed=false`. These perfect synthetic contract
scores are not evidence about a model, official provider, or VQE science.

## S7 owner-approved private live dry run

The owner approved a single DeepSeek call. The run used `deepseek-v4-flash`,
made exactly one generation request, and performed zero retries. Before the
provider boundary, the command re-fetched only the Phase 7 metadata allowlist
for Qiskit Nature at immutable commit
`478b26e1992d66582cf15bcb1c90df702a3b8f97` and required the repository URL,
commit, metadata manifest, selected-byte count, and every selected file digest
to equal the recorded Phase 8 evidence. Target code was not cloned, imported,
installed, or executed.

The strict response and evidence-reference validators accepted one complete
private envelope. Its redacted audit record is stored at
`docs/atlas/evidence/phase9/private_live_dry_run_2026-07-31.json` with SHA-256
`eb98ff02e80102c8743442dd28ea4b0c31e32d50c879ca296ff2f1eeda28ed47`.
It records 3 candidates, 13 field proposals, 10 unknowns, 0 conflicts, 6,605
input tokens, and 1,269 output tokens. These are descriptive counts from one
response, not precision, recall, scientific correctness, compatibility, or
model-quality measurements.

The full validated envelope is stored outside the repository with filesystem
mode `0600`. Its contents, candidate values, and raw provider response are not
included in the repository audit record. The envelope remains `unreviewed`,
`publication_eligible=false`, and `materialization_eligible=false`. No
candidate was persisted to Neon, published, or converted into a canonical
component.

The live-run script refuses repository-local private output, refuses overwrite,
uses exclusive file creation, emits stable sanitized failure codes, and does not
wrap the provider in a retry client. The local qualification tests verify a
single call, redaction, pre-provider identity rejection, output isolation, and
mode `0600` behavior.

## S8 private append-only persistence

Migration `0047` adds two deliberately separate, workspace-scoped records:

- `vqe_research_candidate_envelopes` stores the canonical validated scientific
  proposal envelope; and
- `vqe_research_candidate_persist_requests` stores transport idempotency and
  replay identity.

Both tables reject `UPDATE` and `DELETE` through PostgreSQL triggers. The
application role is granted only `SELECT` and `INSERT`. An envelope can only be
stored with the exact Phase 9 v1 prompt, policy, and response-schema versions,
`schema_and_evidence_validated`, `unreviewed`, and both publication and
materialization eligibility set to false. Persistence revalidates the bounded
response shape, canonical JSON digest, repository and commit identity, and the
SHA-256 of the already persisted GitHub snapshot audit manifest. It cannot
review, publish, or materialize a candidate.

Repository tests cover fail-closed validation, workspace predicates, read-only
authorization, idempotent replay, idempotency conflict, immutable source
binding, concurrent convergence, append-only enforcement, and cross-workspace
denial. The focused local suite has 13 passing tests and one intentionally
skipped live-PostgreSQL test. The live test is wired into the fresh-database CI
job and must pass there before S8 is called remotely qualified.

### DEV migration reconciliation

After merging current `dev`, the DEV migrations own revisions `0039` and
`0040`. The VQE chain was therefore moved without semantic changes to the
single linear sequence `0041` through `0047`. Local Alembic inspection reports
exactly one head at `0047`.

The pre-existing disposable Neon VQE test branch reports revision `0039`, but
read-only schema inspection shows the old VQE registry tables and neither the
DEV `0039` allowance index nor the DEV `0040` folder-order column. It is an old
feature history, not the merged linear history. No `stamp`, migration, or data
mutation was performed against it. It must be recreated from the merged chain
before it is used for a later live integration test; stamping it would falsely
claim DEV migrations had run.

## Open gates

S7 is complete as a private operational qualification only. One accepted
response does not authorize publication, model-quality claims, or automatic
materialization. S8 passed the fresh PostgreSQL 17 CI migration and live
persistence path in feature-branch run `30681049171`; the private production
control-plane workflow also passed in run `30681049158`.

## S9 evidence-bound human review queue

Migration `0048` introduces two append-only records that remain separate from
the original model envelope:

- `vqe_research_candidate_reviews` stores a human decision, a reviewed
  candidate version, the exact source/evidence/base-candidate digests, and a
  canonical scientific review digest; and
- `vqe_research_candidate_review_requests` stores transport idempotency without
  changing the scientific identity of the review.

Both tables reject update and delete operations. Review creation is restricted
to workspace owner/admin roles. Every detail request reconstructs the Phase 9
evidence bundle from the already persisted immutable GitHub snapshot, reruns
the exact deterministic Phase 8 extractor, verifies every selected file and
snapshot digest, and requires the reconstructed bundle digest to equal the
digest supplied to the one S7 model call. A stale or non-reconstructable input
cannot be reviewed.

The Studio review surface shows each proposed field, unknown, and conflict next
to its cited path, locator, source SHA-256, and declared value. Decisions are
not preselected and require an item-level rationale plus an overall rationale.
An edit creates a new reviewed candidate with
`review_provenance=workspace_human_edit`; it never changes the model envelope.
Unknowns and conflicts can be acknowledged but remain open scientific issues,
so a candidate containing either cannot receive the `accepted` disposition.

Review records are deliberately labelled
`review_kind=workspace_human_review` and `independence_state=not_asserted`.
They must not be described as independent scientific review. S9 cannot publish,
materialize, execute, or make performance claims. The focused backend suite has
40 passing tests, the complete web suite has 362 passing tests, TypeScript and
UI token checks pass, and all five import-boundary contracts remain intact.
Fresh-database migration and append-only enforcement remain a remote CI gate
until the S9 commit is pushed.

## Open gates

S9 creates review evidence but does not make any candidate publishable. The
single live S7 envelope reports ten unknowns, so no candidate from that response
can be accepted without a later evidence-backed candidate version that resolves
them. S10–S12 remain downstream gates for accepted-only transactional
materialization, controlled end-to-end validation, and release audit. They must
use the validated private envelope and its append-only reviews without
manufacturing or substituting scripted provider output.
