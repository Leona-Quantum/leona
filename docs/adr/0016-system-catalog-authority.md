# ADR-0016: System catalog authority is isolated through server-owned principals

**Date:** 2026-07-18 · **Status:** proposed (owner decision required)
**Context:** The existing API authorizes repository operations with an immutable
user/workspace `Scope`, while the new Neon catalog needs importer mutations,
reviewed publication, and anonymous public reads without exposing personal or team
artifacts. Reusing a client-selected workspace, bypassing the repository layer, or
adding direct Next.js database access would break the current authorization spine.
The existing workspace model also has no system kind and requires an owner user.
**Decision:** Add one explicitly identified system catalog workspace and server-owned
service principals rather than a second database or an unscoped access path. A
server-owned importer principal may create staged records, while review and
publication remain attributable actions by an authenticated authorized human. A
read-only catalog principal is constructed only by the public FastAPI dependency from
server configuration. Clients never provide these principal or workspace IDs.
Catalog repository functions continue to
take scoped authority first and independently require the catalog workspace,
`review_state = accepted`, `publication_state = public`, and a non-deleted artifact
for public reads. Public response models exclude raw import metadata, internal review
notes, and service identity fields. Next.js accesses the catalog only through HTTPS
FastAPI endpoints. The implementation remains feature-disabled until list, detail,
version, source, evidence, export, cache, and cross-workspace leakage tests pass.
**Consequences:** This preserves the current repository-layer invariant and prevents
anonymous routes from becoming a general database reader. It costs an additive
workspace/principal representation, dedicated dependencies, separate public/private
response contracts, publication-state checks, and audit coverage. Service-principal
rows and IDs are configuration, not credentials; no signing secret or database URL is
placed in a job payload or browser bundle. Publication and quarantine release remain
owner/admin actions and should require a reviewer other than the importer when the
team can support two-person review. The exact `WorkspaceKind` addition, service-row
bootstrap, and role mapping require owner/CODEOWNER approval before implementation.
Reversal trigger: a future database-enforced catalog role or RLS design may add
defense in depth, but it must preserve pooled-connection constraints and cannot
replace application scoping without a new reviewed ADR and leakage test matrix.
