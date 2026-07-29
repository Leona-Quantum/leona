# ADRs

Seed list: ADR-0001..0012 correspond to AD-1..AD-12 in
`~/Documents/Projects/Majorana/plans/rebuild/02-architecture.md` — written out in
Phase 0 step 5. New decisions: copy 0000-template.md, number sequentially.
An architecture choice without an ADR did not happen.
- 2026-07-09: Phase 0 CI smoke PR
- 2026-07-15: ADR-0013 makes selected-framework source authoritative and limits
  OpenQASM to optional conversion interchange.
- 2026-07-16: ADR-0014 replaces the fixed circuit pipeline with a durable,
  policy-enforced tool-calling loop and immutable Candidate revisions.
- 2026-07-18: ADR-0015 defines bounded deterministic conversion across seven
  circuit formats, explicit OpenQASM target recipes, and a no-fabrication
  boundary for literature and operator records.
- 2026-07-18: ADR-0016 proposes an isolated system catalog authority and
  anonymous-safe public read boundary.
- 2026-07-18: ADR-0017 proposes allowlisted ingestion, content quarantine, and
  deny-all offline parsing.
- 2026-07-18: ADR-0018 proposes separate byte, normalized, and semantic
  fingerprints with immutable version-bound evidence.
- 2026-07-18: ADR-0019 accepts the pinned 285-record snapshot as an idempotent
  importer bootstrap for Neon, never as a migration or runtime data source.
- 2026-07-19: ADR-0020 enforces append-only license assertion history in
  PostgreSQL rather than relying on repository convention.
- 2026-07-19: ADR-0021 requires database-clock lease fencing for terminal queue
  writes and one transaction for Dead Letter Run closure.
- 2026-07-23: ADR-0022 proposes three-state verification, evidence-bound retry
  routing, and private unverified Studio materialization with PASS-only Verified/public gates.
- 2026-07-24: ADR-0023 supersedes ADR-0014 for new execute runs with a fixed
  nameko-style circuit pipeline, while retaining Majorana's durable evidence and
  sandbox boundaries. Amended 2026-07-25 to let a Plan declare an independent
  reference check and to make every review name a next step.
- 2026-07-24: ADR-0024 proposes VQE experiments identified through reused
  Artifact/Run identity, with ScientificExperimentSpec separated from
  ExecutionBinding and a server-generated idempotency identity.
- 2026-07-24: ADR-0025 proposes server-authoritative VQE runtime capability
  resolution, independently locked digest-pinned runtime profiles, and
  frozen/current version lanes with a CANDIDATE_UNVERIFIED promotion gate.
- 2026-07-24: ADR-0026 proposes append-only VQE observations keyed to a
  canonical Hamiltonian digest, with exact/finite-shot evidence never conflated
  and golden-fixture energies never hand-typed.
- 2026-07-24: ADR-0027 redefines VQE MVP corpus acceptance as machine-validated
  only; human curation review, inter-annotator agreement, and manual-gold
  comparison authoring are explicit post-MVP work, not silently satisfied.
- 2026-07-24: ADR-0028 merges the Atlas VQE Registry/Compare UI into the
  existing `/repository` page instead of a new top-level section, resolving a
  real "Atlas" branding collision without coercing literature-only VQE
  records into the circuit-execution-shaped `PublicRepositoryEntry` type.
- 2026-07-25: ADR-0029 makes stopping rules independently versioned VQE
  components, rejects non-finite scientific values, and makes Hamiltonian
  identity canonicalize at the digest boundary.
- 2026-07-25: ADR-0030 requires the server to construct scientific specs from
  scoped, typed Workflow ArtifactVersion links and separates HTTP request
  replay keys from Phase 5 execution identity.
- 2026-07-25: ADR-0031 separates portable semantic identity from Registry UUID
  resolution and makes execution cardinality explicit.
- 2026-07-25: ADR-0032 permits fail-closed Phase 5A product integration before
  independent scientific and production-runtime qualification.
- 2026-07-26: ADR-0033 records the owner's independent-review waiver without
  relabeling it as review, pins the private GHCR runtime digests, and requires
  a pre-provisioned dedicated Docker host with deny-all execution.
- 2026-07-27: ADR-0034 pivots the Atlas VQE MVP from paper-first browsing to
  canonical components, provider implementations, compatible Workflows, and
  controlled one-component swaps; papers and repositories remain provenance.
