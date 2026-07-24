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
- 2026-07-24: ADR-0023 proposes a fixed nameko-style circuit pipeline for new
  execute runs while retaining Majorana's durable evidence and sandbox boundaries.
