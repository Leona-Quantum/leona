# AGENTS.md — packages/py/contracts (BLAST-RADIUS)

Source of truth for every cross-boundary type: RunEvent union, Plan, Artifact, Run,
VerificationRecord, Scope. Pydantic models → OpenAPI → packages/ts/contracts-gen.
Changes here are orchestrator-only, reviewed, and versioned (additive within /v1).
Imports nothing internal. Every model documented; every enum closed.
