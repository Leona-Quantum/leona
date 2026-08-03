# Phase 9 progress — LLM-assisted extraction

Updated: 2026-08-03

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
- S9 evidence-bound human review queue: implemented and qualified on fresh
  PostgreSQL in feature-branch CI;
- S10 accepted-review private materialization: implemented and remotely
  qualified on fresh disposable PostgreSQL;
- S11 controlled private integration E2E: implemented and remotely qualified
  on fresh disposable PostgreSQL;
- S12 release audit: complete for code and private schemas only.

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

Migration `0052` adds two deliberately separate, workspace-scoped records:

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

After the 2026-08-03 synchronization, DEV owns revisions `0041` through
`0045`. The VQE chain was therefore moved without semantic changes to the
single linear sequence `0046` through `0052`. Local Alembic inspection reports
exactly one head at `0052` at the S8 boundary.

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

Migration `0053` introduces two append-only records that remain separate from
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
Fresh-database migration and append-only enforcement passed in feature-branch
CI run `30694071038`; the private production control-plane workflow passed in
run `30694071042`.

## Open gates

S9 creates review evidence but does not make any candidate publishable. The
single live S7 envelope reports ten unknowns, so no candidate from that response
can be accepted without a later evidence-backed candidate version that resolves
them. S10 does not override that scientific gate. No candidate from the S7 live
response was accepted or materialized during S10.

## S10 accepted-review private materialization

Migration `0054` introduces separate append-only materialization evidence and
transport-idempotency records. Materialization is permitted only for the latest
`accepted` workspace review, with exact expected review, reviewed-candidate,
source-snapshot, and reconstructed-evidence digests. The repository rehashes the
review and reviewed candidate, reconstructs the immutable Phase 8 evidence,
rechecks source identity, and refuses unknowns, conflicts, rejected fields,
stale review versions, unsupported component types, and unresolved license
evidence.

The license gate is deliberately narrow: the reviewed license expression must
be an unchanged, source-declared SPDX identifier in the initial maintained-
provider allowlist and must exactly equal cited immutable evidence. This gate
authorizes private structured metadata storage only. It is not legal advice,
license approval, source-code redistribution authority, or publication
authority.

A successful operation creates one ordinary private Artifact version containing
canonical structured JSON plus one immutable materialization record. It does
not create a `VqeComponentSpec`, publish a catalog entry, copy source code,
qualify an execution implementation, or make a performance claim. Both
`publication_eligible` and `execution_eligible` are fixed false by application
logic and database constraints. The legacy Artifact framework column is marked
explicitly non-semantic; the materialized compatibility contract remains
framework-neutral.

Artifact creation, Artifact version creation, materialization evidence, and the
idempotency request ledger share the caller's database transaction. A stale
digest therefore leaves no partial materialization. Local qualification used a
fresh disposable PostgreSQL database and passed migration
`upgrade -> downgrade 0053 -> upgrade`, stale-input rollback, successful private
creation, idempotent replay, cross-workspace denial, and append-only mutation
rejection. It also confirmed that downgrade is refused after append-only
materialization evidence exists. The focused DB-free
review/materialization/persistence/route suite has 43 passing tests. Fresh-
database CI qualified the S10 path before S11, and the later S11/S12 audit
repeated the materialization and tenant-isolation boundaries.

## S10 boundary after qualification

S10 is a private metadata materialization mechanism, not a publication or
scientific acceptance mechanism. S11 subsequently demonstrated the controlled
compose/review/materialize/reopen path, and S12 audited migrations, generated
contracts, tenant isolation, UI contracts, and release claims. Neither step
manufactured acceptance for the one S7 live response or issued a second
provider call.

## S11 controlled private integration E2E

The S11 live test runs the real repository chain on disposable PostgreSQL:

1. store an immutable selected-metadata snapshot;
2. reconstruct the deterministic Phase 8 declared-evidence bundle;
3. persist a private schema/evidence-validated candidate envelope;
4. append a rejected review and prove it cannot materialize;
5. append two accepted synthetic transaction-test versions and prove the older
   version is stale;
6. prove a second workspace cannot materialize or reopen the object;
7. materialize the latest version as a private structured Artifact;
8. reopen its Artifact and ArtifactVersion from a separate database session;
9. replay the same idempotency key and obtain the original materialization.

An HTTP-level test separately proves the materialization endpoint returns 401
to a caller without a bearer token before database use. The existing route
inventory now also explicitly includes this handler in the `CurrentScope`
signature gate.

S11 exposed a real S10 integration defect that the earlier mocked evidence view
had hidden. Phase 8 serializes a declared fact as
`{"field":"citation.license","value":"Apache-2.0"}`, while S10 had compared
the whole `declared_value` to the bare SPDX string. The production path could
therefore never satisfy its license gate. The gate now requires both the exact
`citation.license` field identity and exact allowlisted SPDX value. A regression
test proves that an unrelated declared field containing the same text cannot
authorize the license.

The S11 happy-path input is deliberately labelled a synthetic transaction
fixture. Its metadata and reviewer decisions are not Qiskit Nature facts,
independent human review, LLM-quality evidence, or scientific acceptance. No
provider was called, no S7 candidate was accepted, and the resulting object is
fixed private, non-executable, and non-publishable. This distinction allows the
system transaction to be qualified without manufacturing a scientific result.

The focused DB-free route/materialization suite reports 29 passing tests. The
S10 and S11 live tests pass together on the same disposable database, including
repeat execution. Feature-branch CI run `30779777364` passed the fresh-database
migration, authz, pipeline, repository-integrity, Python, TypeScript,
production-build, and authenticated browser-contract jobs for commit
`c85f7156a42f38157b6978f93f0acb50bc733c99`.

## S12 release audit

S12 used a fresh local PostgreSQL database, not the stale Neon feature-history
branch. Alembic `upgrade head -> downgrade base -> upgrade head` completed, and
the repository still has exactly one head at `0054`. The complete Python suite
reported 1,695 passed and 207 skipped tests. A fresh-database selection covering
authz, candidate persistence, materialization, and the S11 integration path
reported 92 passing tests. The four Phase 9 deterministic replay and prompt-
injection suites reported 28 passing tests.

Generated Python and TypeScript contracts were current with no generated diff.
The complete TypeScript lint/typecheck/test graph passed, including 362 web
tests. The local Next.js production build compiled, typechecked, and generated
337 routes. Ruff checked the repository clean, all 417 Python files were
formatted, all five import-linter contracts were kept, and the raw-query scan
was clean. The build still emits non-blocking framework-maintenance warnings
about workspace-root inference and the deprecated Next.js middleware naming;
neither warning changed the build result, but both remain ordinary engineering
debt rather than scientific evidence.

GitHub feature-branch run `30779777364` independently passed all `py`, `ts`,
`db`, and `ui-visual` jobs. Its UI job exercised authenticated Atlas VQE happy
and failure browser contracts. A separate read-only manual browser attempt was
stopped by Vercel Deployment Protection at the Vercel login surface before the
application loaded; no credential was entered and no application state was
changed. This is recorded as an access-control observation, not a successful
manual application smoke test. The authenticated CI browser contract and the
owner's earlier private UI walkthrough remain distinct evidence and are not
misreported as one another.

The machine-readable redacted audit summary is stored at
`docs/atlas/evidence/phase9/release_audit_2026-08-03.json` with SHA-256
`cbc054afe2ab1cc98f20f51b4cc724beb50607d7285c0a6fbdfddcdc38dc5eb5`. It
records zero provider calls, zero public candidate releases, and zero S7
materializations. S12 therefore qualifies only the feature-branch code,
migration, private data boundaries, and controlled synthetic system
transaction. It does not qualify LLM extraction quality, scientific
correctness, independent review, compatibility claims, performance claims, or
public execution.

## Remaining scientific and publication gates

The one S7 live envelope remains unreviewed and contains ten unknowns. No S7
candidate has been accepted, materialized, executed, or published. Public
candidate data, public execution, performance claims, and scientific claims
remain blocked. Any later publication requires evidence-backed resolution of
the unknowns, an explicitly scoped scientific review process, and a separate
owner-approved release decision; S12 does not provide any of those approvals.

## Post-S12 synchronization with `dev` (2026-08-03)

Before starting an external-source phase, `feature/vqe` was synchronized with
`origin/dev` commit `89ce101c72f5`. A backup ref,
`backup/feature-vqe-pre-dev-sync-20260803`, preserves the pre-merge state at
`d2c3dd0d8609`. The merge retained the `dev` product, project-sharing, Vault,
provider-credential, request-validation, and evaluation changes while keeping
the VQE registry and evidence boundaries additive.

The integration audit found and fixed five boundary defects rather than
changing any VQE energy or resource result:

1. VQE migrations were renumbered after the new `dev` migrations, leaving one
   linear Alembic head at `0054`.
2. VQE request bodies now inherit the common NUL-refusing request model.
3. The web control-plane inventory recognizes the bounded VQE catch-all proxy.
4. Explicit VQE saves now pass through the authenticated tier's Vault limit;
   intermediate repository artifacts remain unfiled, while reviewed system
   catalog seeds remain bounded by their checked-in manifest.
5. GitHub snapshot and Phase 7.6 catalog live tests now use separate fresh
   databases because their independently owned authority fixtures intentionally
   use different UUIDs. Sharing one database made the result test-order
   dependent through the unique `system:catalog-importer` identity.

A separate flaky `dev` folder-order assertion was also corrected to compare the
actual legacy `(created_at, id)` order. PostgreSQL `now()` is transaction-stable,
so rows inserted in one transaction do not promise alphabetical or insertion
order; the production ordering rule was not changed.

After these fixes, the complete Python suite reported 2,289 passed and 404
skipped tests. Ruff, formatting, generated OpenAPI, all five import contracts,
and the raw-query boundary were clean. The full TypeScript graph reported 502
web tests, and the Next.js production build generated 338 pages. Fresh-database
migration `upgrade -> downgrade -> upgrade` completed with one head. The
catalog-free live suite reported 223 passing tests; the isolated GitHub snapshot
and Phase 7.6 catalog suites reported four and three passing tests respectively.

These results qualify the merged private implementation boundary only. They do
not turn an unreviewed source into scientific evidence, authorize arbitrary
repository execution, or unblock public and performance claims.
