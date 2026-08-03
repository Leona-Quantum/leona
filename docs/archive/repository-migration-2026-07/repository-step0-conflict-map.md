> **ARCHIVED 2026-08-04.** the step 0 working record of the completed 2026-07 catalog migration; the decisions it maps were recorded in ADR-0016 through ADR-0019, each of which keeps its own status (see `docs/adr/README.md`).
> Retained for history; do not treat as current.

# Quantum Repository Step 0 - conflict and decision map

Status: Step 0 working record  
Branch inspected: `feature/repository`  
Remote baseline: rebased onto `origin/dev` at `fd34d3b` on 2026-07-18  
Runtime/schema/data changes in this step: none

## 1. Safety result

Step 0 is documentation-only. It does not create migrations, contracts, API routes,
jobs, catalog records, external integrations, feature flags, or changes to the legacy
TypeScript catalog.

The fixed product direction is accepted for planning:

- Neon is the canonical catalog database;
- FastAPI is the only application database boundary;
- the pinned 285-record TypeScript snapshot is imported through the normal Neon
  bootstrap path, while its labels remain untrusted claims rather than evidence;
- work proceeds in small reviewed slices on `feature/repository`;
- publication, deployment, protected-branch actions, credentials, and paid QPU work
  remain approval-gated.

The architecture details in ADR-0016 through ADR-0019 remain proposed until their
listed owner/CODEOWNER/security reviews occur. No later implementation step may treat
a proposed choice as approved.

## 2. Integrated remote baseline

The branch was rebased onto the two latest `origin/dev` commits before Step 1 work:

| Commit | Change | Repository-plan impact |
|---|---|---|
| `fd84472` | Seven-framework conversion and expanded static catalog | Adds accepted ADR-0015, TS portable-circuit conversion, static entries, and Python adapter observations |
| `fd34d3b` | Framework conversion review hardening | Corrects the same TS conversion/catalog surface and its tests |

The rebase was performed after the user requested the latest 285 records and Step 1.
No merge, push, deployment, or publication was performed.

Important interpretation:

- ADR-0015 makes seven formats visible for bounded conversion/export, but only Qiskit,
  Cirq, and PennyLane remain executable sandbox frameworks.
- The 285 TypeScript records are now a pinned bootstrap source. They enter Neon through
  a checksummed manifest and the normal importer, not direct SQL or runtime fallback.
- The Python framework adapter changes in `origin/dev` are relevant to later observation
  and interchange evidence. Repository work must consume them after branch integration,
  not recreate or overwrite them.
- `origin/dev` already uses ADR number 0015. Repository ADRs therefore start at 0016.

## 3. Conflict matrix

| Area/files | Current or likely owner | Repository need | Conflict level | Safe rule |
|---|---|---|---|---|
| `apps/web/lib/repository/**`, `public-repository.ts` | Rui/web lane; changed on `origin/dev` | Pinned read-only bootstrap manifest input | Red | Do not edit in Rei backend PRs; consume only through a deterministic generator at a pinned commit |
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
| `docs/adr/README.md` | Shared; changed on `origin/dev` | Index ADR-0016 to ADR-0019 | Amber | Updated with ADR-0016 through ADR-0019 after integrating ADR-0015; preserve index order during later integration |
| `docs/quantum-repository-platform-plan.md` | Rei branch-only plan | Governing staged plan | Green locally, merge-sensitive | Preserve as branch-owned document and review when integrating latest `dev` |

Red means prior coordination and dedicated review are mandatory. Amber means isolate
the change and re-check the latest remote diff immediately before editing. Green does
not remove normal review requirements.

## 4. Planned file ownership by delivery step

| Step | Intended files | Files explicitly excluded |
|---|---|---|
| 0 | repository plan, ADR-0016 to ADR-0019, ADR index, this map | runtime, schema, workflows, legacy TS data |
| 1 | queue migration, job repository/Worker recovery, targeted tests | catalog schema, framework adapters, UI |
| 2 | DB configuration, approved catalog principal/scope, leakage tests | importer, evidence, UI, legacy catalog |
| 3 | one catalog identity migration, ORM/repository/contracts, tests | provenance/import/evidence tables, UI |
| 4 | provenance/rights/citation tables and review state tests | fetcher, framework conversion, UI |
| 5 | import job/item tables, connector/fetcher/bootstrap modules, handlers, malicious fixtures | editing UI/TS source records |
| 6 | public catalog routes/contracts/tests and feature-flagged 20-item bootstrap proof | mixed runtime TS/Neon results or direct SQL seed |
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

1. obtain review of ADR-0016 through ADR-0019;
2. re-check whether `origin/dev` advanced after the `fd34d3b` integrated baseline;
3. preserve the accepted ADR-0015/framework changes and do not recreate them;
4. run the existing tests on the integrated baseline before attributing failures to
   repository work;
5. re-open this matrix if `origin/dev` gains migrations, contracts, scope, queue,
   sandbox, or repository-route changes;
6. execute only the next approved slice and commit one logical change at a time.

No implementation commit should continue after new shared migration, contract, queue,
scope, or framework changes appear on `origin/dev` without refreshing this map.

## 6. Decision register

| ID | Decision | Recommended default | Required approval | Gate |
|---|---|---|---|---|
| D-0 | Neon/FastAPI plus pinned 285-record importer bootstrap | Accepted planning direction | Rei request recorded | Step 0 |
| D-1 | System workspace kind and service-principal bootstrap | Dedicated system catalog workspace and server-owned principals | Owner + contracts/auth CODEOWNER | Before Step 2 |
| D-2 | Public read authority | Server-created read-only catalog scope plus explicit accepted/public predicates | Owner + auth/security review | Before Step 2 |
| D-3 | Publication separation | Importer cannot self-publish; owner/admin reviewer publishes | Owner | Before Step 4 |
| D-4 | Initial accepted SPDX policy | Fail closed; manual review until allowlist is approved | Owner/rightsholder reviewer | Before Step 4 publication |
| D-5 | Quarantine storage and byte/batch limits | Private content-addressed storage; reject archives in MVP | Ryu/Eshaan + owner if new service/cost | Before Step 5 |
| D-6 | Branch integration method | Rebase onto `origin/dev` baseline `fd34d3b` | User requested latest dev; completed locally | Before Step 1 |

Until a decision is approved, the dependent phase remains feature-disabled and no
catalog data is published. A deadline does not convert an unresolved decision into
implicit approval.

## 7. Step 0 exit checklist

- [x] Fixed scope imports the pinned 285-record snapshot through the normal importer only.
- [x] Latest remote divergence was fetched and inspected.
- [x] Accepted upstream ADR-0015 was identified and ADR number collision avoided.
- [x] Catalog authority/public-read proposal was recorded in ADR-0016.
- [x] Ingestion trust boundaries and fail-closed behavior were recorded in ADR-0017.
- [x] Hash, deduplication, and immutable evidence semantics were recorded in ADR-0018.
- [x] Pinned bootstrap semantics and the explicit, deferred command were recorded in ADR-0019.
- [x] Shared-file owners, conflict levels, and safe-edit rules were mapped.
- [x] No runtime, schema, data, external publication, or legacy catalog change was made.
- [ ] Owner/CODEOWNER/security approvals D-1 through D-5 are recorded before their gated phases.
- [x] The branch was rebased onto the approved latest `dev` baseline before Step 1.

Step 0 documentation and the Step 1 baseline gate are complete. D-1 through D-5
continue to block only their listed later phases; they are not silently approved.
