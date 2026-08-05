# ADR-0016: System catalog authority is isolated through server-owned principals

**Date:** 2026-07-18 · **Status:** implemented and deployed (2026-07-19)

> **Status corrected 2026-08-04.** Shipped as migration `0013_system_workspace_kind`,
> `catalog_authority.py` and `auth/catalog_deps.py`; the public read path is
> `routes/catalog.py`. `SYSTEM_CATALOG_ENABLED` and the three `SYSTEM_CATALOG_*_ID`
> values are set on both live Cloud Run services (`docs/runbooks/deploys.md §
> Environment`), and the corpus is published. The status line read "CODEOWNER review
> required before deploy" for the whole time this was serving production traffic.
>
> **How to read the Context/Decision/Consequences below.** They are the decision as
> written on 2026-07-18, and the reasoning is unchanged — but two statements in them
> describe a pre-deployment state that has since been reached, and one noun is stale.
> Each is marked inline as *[As of 2026-07-18 …]* with the current fact. In short:
> "Neon" means the catalog database, which is **Cloud SQL for PostgreSQL 17** since
> 2026-07-27 (ADR-0024); the feature is **no longer disabled**; the CODEOWNER review and
> the migration up→down→up rehearsal were **completed before the 2026-07-19 deploy**, and
> the rehearsal now runs against CI's `postgres:17` service container rather than a
> temporary Neon branch.

**Context:** The existing API authorizes repository operations with an immutable
user/workspace `Scope`, while the new Neon catalog *[as of 2026-07-18; Cloud SQL for
PostgreSQL 17 since 2026-07-27, ADR-0024]* needs importer mutations,
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
Catalog repository functions continue to take scoped authority first and independently require the catalog workspace,
`review_state = accepted`, `publication_state = public`, and a non-deleted artifact
for public reads. Public response models exclude raw import metadata, internal review
notes, and service identity fields. Next.js accesses the catalog only through HTTPS
FastAPI endpoints. *[As of 2026-07-18: "the implementation remains feature-disabled
until list, detail, version, source, evidence, export, cache, and cross-workspace
leakage tests pass." Those tests passed and the gate was cleared;
`SYSTEM_CATALOG_ENABLED` is **true** on both live Cloud Run services and the corpus is
published, so the feature is no longer disabled.]*
**Consequences:** This preserves the current repository-layer invariant and prevents
anonymous routes from becoming a general database reader. It costs an additive
workspace/principal representation, dedicated dependencies, separate public/private
response contracts, publication-state checks, and audit coverage. Service-principal
rows and IDs are configuration, not credentials; no signing secret or database URL is
placed in a job payload or browser bundle. Publication and quarantine release remain
owner/admin actions and should require a reviewer other than the importer when the
team can support two-person review. The owner requested Step 2 implementation on
2026-07-18. *[As of 2026-07-18: "the additive `WorkspaceKind` change, service-row
bootstrap, auth boundary, and workflow changes remain blast-radius changes requiring
CODEOWNER review and a temporary-Neon-branch up→down→up result before deployment."
Both were done ahead of the 2026-07-19 deploy and are no longer outstanding; the
migration rehearsal is now an `upgrade→downgrade→upgrade` run against CI's
`postgres:17` service container, since Cloud SQL has no branching. The requirement
still binds any **future** change to these surfaces.]*
Reversal trigger: a future database-enforced catalog role or RLS design may add
defense in depth, but it must preserve pooled-connection constraints and cannot
replace application scoping without a new reviewed ADR and leakage test matrix.
