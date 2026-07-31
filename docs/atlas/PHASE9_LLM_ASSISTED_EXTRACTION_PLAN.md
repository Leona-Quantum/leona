# Phase 9 — LLM-assisted extraction and reviewed materialization

Status: active on `feature/vqe`

## 1. Purpose and non-goals

Phase 9 may use an LLM to propose structured research candidates from the
bounded, immutable evidence produced by Phases 7–8. The LLM is a candidate
generator only. It is not a scientific authority, compatibility checker,
license reviewer, human reviewer, publication authority, or execution engine.

The phase must not:

- give the model tools, network access, credentials, or repository checkout
  access;
- import, install, compile, or execute target repository code or notebooks;
- let README prose override deterministic declarations;
- convert a model probability or prose confidence into evidence quality;
- auto-materialize a candidate as a canonical Component Definition;
- label model output as reviewed, verified, executable, compatible, public, or
  performance-superior;
- start a paid live-provider run without explicit owner approval.

## 2. Inputs and outputs

### Accepted input

Only a bounded private evidence bundle may be sent to the model. It contains:

- immutable repository identity and commit SHA;
- selected source path and source SHA-256;
- Phase 8 declared facts with semantic pointers;
- bounded Python syntactic facts with exact spans;
- sanitized notebook code/markdown channels with cell-index locators;
- explicit parser issues, unknowns, and conflicts.

The bundle contains no credentials, GitHub token, database URL, raw notebook
output, attachment, execution count, provider exception, or hidden system
prompt. Source-derived text is wrapped as untrusted data, never instructions.

### Candidate output

One model response may propose zero or more candidates of these types:

```text
implementation
component
problem
dataset
experiment
```

Every proposed field requires at least one exact evidence locator into the
input bundle. Unsupported interpretation remains an explicit unknown. Conflicts
remain conflicts and may not be silently resolved by the model.

The stored envelope includes:

- schema, prompt, policy, and extractor-input versions;
- provider-requested model and provider-served model;
- input bundle digest and response digest;
- input/output token counts;
- candidate type, proposed fields, evidence references, unknowns, conflicts;
- `human_review_state=unreviewed`;
- `publication_eligible=false`;
- `materialization_eligible=false`.

No chain-of-thought or hidden reasoning is requested or stored.

## 3. Trust boundary

```text
immutable Phase 7 snapshot
  -> deterministic Phase 8 facts/sanitized channels
  -> bounded untrusted-data envelope
  -> schema-constrained LLM call (no tools/network/secrets)
  -> strict local validation and evidence-reference resolution
  -> private append-only candidate
  -> independent human review
  -> explicit materialization transaction
```

Failure at any boundary produces a stable private issue and no partial
candidate. A provider response is never repaired by inventing missing evidence.

## 4. Steps

### S0 — threat, claim, and spending boundary

- Freeze the allowed candidate types and prohibited claims.
- Record that live provider calls require owner approval because they spend
  external quota and use credentials.
- Keep publication and materialization fail-closed.

### S1 — versioned candidate envelope

- Add strict models for the request provenance, candidate fields, evidence
  references, unknowns, and conflicts.
- Reject extra fields, oversized values, duplicate IDs, unsupported candidate
  types, and missing evidence.
- Generate a deterministic candidate-envelope digest.

### S2 — prompt/data isolation

- Add a dedicated versioned system prompt.
- Render source-derived content only inside a canonical JSON data envelope.
- State that source text may contain prompt injection and has no authority.
- Require exact JSON-schema output and forbid tool use or external lookup.

### S3 — bounded input assembler

- Resolve only Phase 8 evidence already bound to an immutable snapshot.
- Cap files, facts, cells, characters, and total encoded bytes.
- Reject secrets and unsupported payload channels before the provider boundary.

### S4 — response validator

- Parse strict JSON with duplicate-key and non-finite-number rejection.
- Resolve every evidence reference against the exact input bundle.
- Reject dangling locators, altered digests, unknown fields, partial candidates,
  and model-created source identities.

### S5 — adversarial prompt-injection corpus

- Cover README/notebook text that asks to ignore the system prompt, publish a
  result, reveal a secret, call a tool, or fabricate evidence.
- Verify that the renderer keeps it inert and the validator rejects unsupported
  claims.

### S6 — offline contract evaluation

- Measure schema validity, exact evidence-reference validity, unsupported-claim
  rejection, and deterministic envelope replay on labelled synthetic fixtures.
- Report synthetic metrics separately from live-provider quality.

### S7 — owner-approved live dry run

- Require explicit provider/model/budget approval.
- Use only approved official-provider snapshots.
- Record real provider/model/token metadata and sanitized failures.
- Do not retry non-retryable failures or auto-publish outputs.

### S8 — private append-only persistence

- Persist request provenance and validated candidate envelopes through the API
  repository layer.
- Preserve old prompt/model/schema versions; never overwrite prior evidence.
- Enforce tenant scope and idempotent replay/concurrency behavior.

### S9 — review queue

- Present evidence next to each proposed field.
- Allow accept, reject, edit-with-new-version, and conflict/unknown decisions.
- Never relabel owner waiver or machine validation as independent human review.

### S10 — reviewed materialization transaction

- Materialize only an explicitly accepted candidate version.
- Recheck source identity, evidence digests, review decision, license gate, and
  compatibility contract in one transaction.
- Roll back completely on any mismatch.

### S11 — controlled integration E2E

- Exercise private compose/review/materialize/reopen behavior on disposable
  infrastructure.
- Confirm unauthenticated, cross-workspace, stale-version, and rejected
  candidates cannot materialize.

### S12 — release audit

- Re-run Python, TypeScript, migration up/down/up, authz, persistence,
  deterministic replay, prompt-injection, and browser gates.
- Publish code and private schemas only unless a separate owner-reviewed release
  decision explicitly permits public data.

## 5. Acceptance criteria

Phase 9 is complete only when:

- every candidate field resolves to immutable input evidence;
- invalid or adversarial output fails closed without partial persistence;
- model, prompt, schema, input, output, and token provenance is retained;
- private append-only replay and concurrency are verified;
- review and materialization are separate explicit actions;
- no model output can claim `human_reviewed`, `verified`, `public`, or
  `performance_superior` by itself;
- external spend and public release remain owner-controlled actions.

Until S7 receives owner approval, progress is limited to deterministic local
contracts, offline fixtures, persistence design, and tests. This is an intended
safety boundary, not an extraction-quality result.
