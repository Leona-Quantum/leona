# AGENTS.md — packages/py/contracts (BLAST-RADIUS)

Source of truth for every cross-boundary type: RunEvent union, Plan, Artifact, Run,
VerificationRecord, Scope. Pydantic models → OpenAPI → packages/ts/contracts-gen.
Changes here are orchestrator-only, reviewed, and versioned (additive within /v1).
Imports nothing internal. Every model documented; every enum closed.

## Versioning

`CONTRACTS_VERSION` (in `__init__.py`) follows additive-minor semantics:

- **minor** — backward-compatible additions: new enum values, new models, new
  optional fields, new lifecycle tables. Existing consumers keep working unchanged.
- **major** — anything that breaks an existing consumer: removed/renamed fields or
  enum values, changed types, tightened validation.
- **patch** — fixes invisible on the wire (docstrings, internal refactors).

The bump lands in the same PR as the change it describes, with a one-line note in
the comment above `CONTRACTS_VERSION`. Regenerate `openapi.json`
(`python -m majorana_contracts.export`) in that same PR — the export embeds the
version, so the freshness gate fails until both move together.
