# Quantum Repository Step 0 - conflict and decision map

Status: Step 0 working record  
Branch inspected: `feature/repository`  
Remote inspected: `origin/dev` after fetch on 2026-07-18  
Runtime/schema/data changes in this step: none

## 1. Safety result

Step 0 is documentation-only. It does not create migrations, contracts, API routes,
jobs, catalog records, external integrations, feature flags, or changes to the legacy
TypeScript catalog.

The fixed product direction is accepted for planning:

- Neon is the canonical catalog database;
- FastAPI is the only application database boundary;
- the existing TypeScript catalog records are not migrated, imported, counted, or
  used as evidence;
- work proceeds in small reviewed slices on `feature/repository`;
- publication, deployment, protected-branch actions, credentials, and paid QPU work
  remain approval-gated.

The architecture details in ADR-0016 through ADR-0018 remain proposed until their
listed owner/CODEOWNER/security reviews occur. No later implementation step may treat
a proposed choice as approved.

## 2. Newly observed remote divergence

`origin/dev` contains two commits not present in `feature/repository` at inspection
time:

| Commit | Change | Repository-plan impact |
|---|---|---|
| `fd84472` | Seven-framework conversion and expanded static catalog | Adds accepted ADR-0015, TS portable-circuit conversion, static entries, and Python adapter observations |
| `fd34d3b` | Framework conversion review hardening | Corrects the same TS conversion/catalog surface and its tests |

The current feature branch contains the repository plan commit `c1c71f1`, which is not
in `origin/dev`. No merge or rebase was performed during Step 0.

Important interpretation:

- ADR-0015 makes seven formats visible for bounded conversion/export, but only Qiskit,
  Cirq, and PennyLane remain executable sandbox frameworks.
- The newly expanded TypeScript catalog remains legacy data and is still excluded from
  the Neon catalog lineage and 150-entry count.
- The Python framework adapter changes in `origin/dev` are relevant to later observation
  and interchange evidence. Repository work must consume them after branch integration,
  not recreate or overwrite them.
- `origin/dev` already uses ADR number 0015. Repository ADRs therefore start at 0016.

## 3. Conflict matrix

| Area/files | Current or likely owner | Repository need | Conflict level | Safe rule |
|---|---|---|---|---|
| `apps/web/lib/repository/**`, `public-repository.ts` | Rui/web lane; changed on `origin/dev` | None before coordinated UI cutover | Red | Do not edit, seed from, validate as new catalog data, or delete in Rei backend PRs |
| `apps/web/lib/circuit-frameworks.ts`, conversion code | Rui/web/framework lane; new on `origin/dev` | Later display/export mapping only | Red | Treat ADR-0015 as upstream contract after integration; do not implement a competing converter |
| `packages/py/frameworks/**` | Rui/framework lane; changed on `origin/dev` | Observation and later conversion evidence | Red | Consume public adapter APIs; request Rui review before any required extension |
| `packages/py/contracts/**` | Shared blast-radius/CODEOWNER | Catalog enums and API resources | Red | One additive contract PR; agree names first; regenerate OpenAPI and TS output |
| `packages/ts/contracts-gen/**` | Generated shared output | Web catalog client types | Red | Never hand-edit; commit only generator output with its contract change |
| `db/migrations/**` | Shared blast-radius/CODEOWNER | Catalog scope, states, provenance, imports, evidence | Red | Serialize migrations against latest `origin/dev`; one responsibility per revision; up/down/up |
| auth/scope dependencies | Eshaan/security shared | Catalog service and public-read authority | Red | ADR-0016 approval and full leakage matrix before code |
| `services/worker` queue/dispatch | Ryu/Eshaan shared | Lease recovery and importer handlers | Red | Queue reliability in a dedicated reviewed PR; preserve `run.execute` behavior |
| `packages/py/sandbox/**` | Ryu/security lane | Offline parse/execute limits | Red | Use existing boundary; security owner reviews any interface change |
| `services/api/.../repos` | Rei lane with authz invariant | Catalog repository functions | Amber | New catalog modules/functions; keep Scope first and avoid unrelated artifact rewrites |
| `services/api/.../routes/artifacts.py` | Existing Library API | Later accepted-version copy flow | Amber | Leave current legacy copy endpoint unchanged until replacement is proven |
| `.github/workflows/**` | Shared/owner | Required catalog and migration gates | Red | Add gates only in a separate CI PR; do not rename required jobs |
| `docs/adr/README.md` | Shared; changed on `origin/dev` | Index ADR-0016 to 0018 | Amber | Intentionally not edited now; append entries after integrating ADR-0015 from `origin/dev` |
| `docs/quantum-repository-platform-plan.md` | Rei branch-only plan | Governing staged plan | Green locally, merge-sensitive | Preserve as branch-owned document and review when integrating latest `dev` |

Red means prior coordination and dedicated review are mandatory. Amber means isolate
the change and re-check the latest remote diff immediately before editing. Green does
not remove normal review requirements.

## 4. Planned file ownership by delivery step

| Step | Intended files | Files explicitly excluded |
|---|---|---|
| 0 | repository plan, ADR-0016 to ADR-0018, this map | runtime, schema, workflows, legacy TS data |
| 1 | queue migration, job repository/Worker recovery, targeted tests | catalog schema, framework adapters, UI |
| 2 | DB configuration, approved catalog principal/scope, leakage tests | importer, evidence, UI, legacy catalog |
| 3 | one catalog identity migration, ORM/repository/contracts, tests | provenance/import/evidence tables, UI |
| 4 | provenance/rights/citation tables and review state tests | fetcher, framework conversion, UI |
| 5 | import job/item tables, connector/fetcher modules, handlers, malicious fixtures | UI and legacy TS catalog |
| 6 | public catalog routes/contracts/tests and feature-flagged proof integration | mixed TS/Neon results or legacy migration |
| 7 | verification evidence and existing-run links | framework adapter rewrites |
| 8 | conversion-attempt evidence using approved framework APIs | competing TS converter or unsupported execution claims |
| 9 | importer configuration, reports, accepted Neon data | source-code schema redesign or UI restyle |
| 10 | coordinated web route cutover owned by web lane | backend schema expansion |
| 11 | deterministic export modules and tests | external publication without approval |

The intended file list is refined against the latest `origin/dev` before every slice.
If another lane is actively editing a listed file, the slice stops until ownership and
integration order are agreed.

## 5. Integration sequence

Before Step 1 implementation:

1. obtain review of ADR-0016 through ADR-0018;
2. agree whether `feature/repository` will be rebased or merged onto the then-current
   `origin/dev`; do not perform either operation implicitly;
3. integrate the accepted ADR-0015/framework changes before touching shared framework
   or ADR index files;
4. run the existing tests on the integrated baseline before attributing failures to
   repository work;
5. re-open this matrix if `origin/dev` gains migrations, contracts, scope, queue,
   sandbox, or repository-route changes;
6. execute only the next approved slice and commit one logical change at a time.

No implementation commit should be built on the currently divergent baseline without
this integration decision. That prevents a locally correct migration or contract from
being designed against stale shared code.

## 6. Decision register

| ID | Decision | Recommended default | Required approval | Gate |
|---|---|---|---|---|
| D-0 | Neon/FastAPI, no legacy-78 migration, staged delivery | Accepted planning direction | Rei request recorded | Step 0 |
| D-1 | System workspace kind and service-principal bootstrap | Dedicated system catalog workspace and server-owned principals | Owner + contracts/auth CODEOWNER | Before Step 2 |
| D-2 | Public read authority | Server-created read-only catalog scope plus explicit accepted/public predicates | Owner + auth/security review | Before Step 2 |
| D-3 | Publication separation | Importer cannot self-publish; owner/admin reviewer publishes | Owner | Before Step 4 |
| D-4 | Initial accepted SPDX policy | Fail closed; manual review until allowlist is approved | Owner/rightsholder reviewer | Before Step 4 publication |
| D-5 | Quarantine storage and byte/batch limits | Private content-addressed storage; reject archives in MVP | Ryu/Eshaan + owner if new service/cost | Before Step 5 |
| D-6 | Branch integration method | Integrate latest `origin/dev` before shared-code work | Eshaan/branch owner | Before Step 1 |

Until a decision is approved, the dependent phase remains feature-disabled and no
catalog data is published. A deadline does not convert an unresolved decision into
implicit approval.

## 7. Step 0 exit checklist

- [x] Fixed scope excludes the existing TypeScript records from the new catalog.
- [x] Latest remote divergence was fetched and inspected.
- [x] Accepted upstream ADR-0015 was identified and ADR number collision avoided.
- [x] Catalog authority/public-read proposal was recorded in ADR-0016.
- [x] Ingestion trust boundaries and fail-closed behavior were recorded in ADR-0017.
- [x] Hash, deduplication, and immutable evidence semantics were recorded in ADR-0018.
- [x] Shared-file owners, conflict levels, and safe-edit rules were mapped.
- [x] No runtime, schema, data, external publication, or legacy catalog change was made.
- [ ] Owner/CODEOWNER/security approvals D-1 through D-6 are recorded.
- [ ] The branch integration method and baseline are approved before Step 1.

Step 0 documentation is complete. Step 1 remains gated by the two unchecked items.
