# Atlas VQE MVP — Phase 3 progress record

**Date:** 2026-07-24; integrity remediation 2026-07-25
**Status:** implemented and verified against a local throwaway Postgres 14
instance (migration reversibility, constraint enforcement, workspace
isolation, idempotency, and append-only invariants all exercised with real
statements, not just reviewed). **Not** connected to any Neon branch —
that is an explicit, unresolved owner-approval gate (plan Part IV "Neon
acceptance", and the original Phase 0-6 kickoff instructions). This
document is the stop-and-report required before that gate.

## 1. What was built

`db/migrations/versions/0039_vqe_component_registry.py` — four purely
additive tables, matching the plan's Part II §8 field lists exactly:

- `vqe_component_specs` (PK = `artifact_version_id`; component identity IS
  the existing ArtifactVersion, ADR-0024 — no parallel identity system).
- `vqe_workflow_components` (links a workflow ArtifactVersion to its
  member component ArtifactVersions with an explicit role/ordinal).
- `vqe_experiments` (immutable `ScientificExperimentSpec` only;
  `run_id` nullable+unique — see §5 below for why).
- `vqe_observations` (append-only execution evidence, ADR-0026).

Every enum-shaped text column carries a CHECK constraint pinned to
`majorana_vqe.models`'s own enums (`ComponentType`, `AnnotationState`,
`ExecutionStatus`, `FailureCode`), the same defense-in-depth pattern
migration 0034 used for `QpuRunStatus`/`QpuProvider`. `downgrade()` refuses
to drop the tables if any `vqe_observations` row has `status='succeeded'`.

`services/api/src/majorana_api/orm.py` — the four matching SQLAlchemy
models (`VqeComponentSpec`, `VqeWorkflowComponent`, `VqeExperiment`,
`VqeObservation`).

`services/api/src/majorana_api/repos/vqe.py` — the Scope-first repository
layer: `create_component_spec`/`get_component_spec`/`list_component_specs`,
`create_workflow_component`/`list_workflow_components`,
`create_experiment`/`get_experiment`/`list_experiments`/
`find_experiment_by_request_idempotency_key`,
`resolve_scientific_experiment_spec`, `append_observation`/
`list_observations`. Every read that touches `vqe_component_specs`/
`vqe_workflow_components` joins through `artifact_versions -> artifacts` to
apply the workspace predicate (those tables carry no `workspace_id` of
their own — identity is the ArtifactVersion). `vqe_experiments` carries
`workspace_id`; observations are scoped through their parent experiment and
do not duplicate it.

`services/api/src/majorana_api/routes/vqe.py` — all 11 endpoints from the
plan's Part IV "API candidate" list, wired into `app.py`:

```text
GET  /v1/atlas/components
GET  /v1/atlas/components/{artifact_version_id}
GET  /v1/atlas/workflows
GET  /v1/atlas/workflows/{workflow_artifact_version_id}
GET  /v1/atlas/comparisons/{comparison_id}
GET  /v1/vqe/capabilities
POST /v1/vqe/experiments
GET  /v1/vqe/experiments/{experiment_id}
POST /v1/vqe/experiments/{experiment_id}/cancel
GET  /v1/vqe/experiments/{experiment_id}/events
POST /v1/vqe/experiments/{experiment_id}/materialize
```

`services/api/pyproject.toml` now depends on `majorana-vqe` (added to
`tool.uv.sources` too); the root lockfile was regenerated (`uv lock`).

## 2. Design decisions made in this phase (and why)

1. **`vqe_experiments` never creates a `runs` row.** The plan's own DB
   responsibilities list already says this table holds "immutable
   scientific spec only; execution status is `runs`/`jobs`'s authority" —
   but there is no approved `ExecutionBinding` to resolve a
   framework/runtime against until Phase 5 ships real, promoted runtime
   profiles (ADR-0025's `CANDIDATE_UNVERIFIED` gate). `run_id` stays
   `NULL` on every experiment created in this phase. Consequently:
2. **`POST .../cancel`, `GET .../events`, `POST .../materialize` are
   honest stubs, not fake success.** Each confirms the experiment exists
   and is in scope (404 otherwise), then returns a contract-shaped 409
   with `code: "no_execution_started"` and an explanation. This was a
   judgment call weighed against silently 501-ing or omitting the routes
   entirely; a 409 with a machine-readable code lets a future Phase 5
   client distinguish "not started yet" from "server error" without
   guessing, and keeps the contract shape stable across the phase
   boundary.
3. **`GET /v1/atlas/comparisons/{id}` reads the bundled corpus JSON
   directly, not a DB table.** The plan's Phase 3 DB-responsibilities list
   has no comparisons table, and Phase 2's 3 comparison reports are
   versioned, machine-generated corpus data (ADR-0027), not per-workspace
   mutable state. `comparison_id` is constrained by an anchored
   `^[a-zA-Z0-9_]+$` path-parameter pattern (FastAPI-level, rejects the
   request before the handler runs), so path traversal is not reachable
   by construction, not by a runtime check.
4. **Registry entries are workspace-scoped like ordinary Artifacts.** A
   shared/public "system catalog" visibility model (the same shape as the
   existing catalog import pipeline, ADR-0016) was **not** built here —
   that is a separate, larger authorization decision this phase did not
   make. Every component/workflow/experiment created in this phase is
   only visible in the workspace that created it. If Registry data is
   meant to be shared across all users, that needs its own reviewed
   decision before the real corpus import runs (see §7).
5. **Idempotency-Key is a required header on `POST /v1/vqe/experiments`**
   (`Header(alias="Idempotency-Key")` with no default → FastAPI 422 if
   absent), per the plan's explicit "POSTはIdempotency-Key必須" rule —
   this deliberately diverges from `POST /v1/runs`'s own convention, where
   the same header is optional. The divergence is the plan's own
   instruction, not an inconsistency to fix.
   ADR-0030 names its persisted value `request_idempotency_key`: it is HTTP
   replay safety, not ADR-0024's server-generated Phase 5 execution identity.
6. **`create_experiment`'s idempotent-retry logic mirrors
   `catalog_import.create_import_job` byte-for-byte**: look up by
   `(workspace_id, request_idempotency_key)` first; on a flush-time
   `IntegrityError` (a concurrent creator won the race), roll back and
   re-read the winner; a reused key naming a different
   `workflow_artifact_version_id` or `scientific_spec_sha256` raises
   `IdempotencyConflictError` (409) instead of silently returning the
   wrong experiment.
7. **The server constructs the scientific spec (ADR-0030).** The client
   supplies a Workflow ArtifactVersion plus dataset/initial-parameter/seed
   inputs, never component UUIDs. The repository resolves all 12 required
   ordinal-zero links under Scope, checks every `ComponentType`, and rejects
   missing, duplicate, wrong-type, cross-scope, or v0.1-unrepresentable
   composition. The route hashes only that resolved model.
8. **`append_observation` enforces evidence invariants in Python before the DB
   ever sees the row**: the observation's `scientific_spec_sha256` must
   match its parent experiment's (an observation for the wrong spec is
   rejected, not silently recorded), and `status`/`failure_code` must be
   consistent (mirrors the DB CHECK
   `ck_vqe_observations_status_failure_code_consistency`, which mirrors
   `majorana_vqe.models.ResultContract`'s own Pydantic validator — three
   layers agreeing on one rule, by design). A succeeded result also requires
   a Hamiltonian digest, and external detail URI/hash/size are all-or-none.
   PostgreSQL independently enforces these checks and uses a trigger plus
   revoked app-role privileges to reject observation UPDATE/DELETE.

## 3. What was tested, and how (real numbers, not claims)

All of the following were run against a **local throwaway Postgres 14**
instance in this session (unix socket, not Neon), on a freshly
migrated, unseeded database unless noted:

- **Migration reversibility** (mirrors the CI `db` job exactly):
  `alembic upgrade head` → `alembic downgrade base` → `alembic upgrade head`,
  all three succeeding in under 2 seconds (CI budget is 60s). `downgrade
  base` was also exercised earlier in this phase specifically for
  migration 0039's own guard (refuses to drop `vqe_observations` while a
  `succeeded` row exists) — confirmed it raises, then confirmed it
  succeeds once that row no longer blocks it.
- **`db/seeds/seed.py`** ran clean against the freshly migrated schema
  (2 users, 2 workspaces, 20 artifacts, 36 artifact_versions, 200 runs,
  1000 run_events — unaffected by the new tables, as expected since
  they're purely additive).
- **Full test suite**: `uv run pytest -q` → **1109 passed, 3 skipped**
  (the 3 skips are pre-existing and unrelated: live-LLM-credential tests
  and a Linux-only sandbox memory-cap test). This included:
  - 15 new DB-free repo tests (`test_vqe_repo_roles.py`,
    `test_vqe_repo_scoping.py`) — every write-path repo function fails
    closed for a VIEWER-role scope before issuing any statement; every
    read/write statement binds `scope.workspace_id`.
  - 13 new DB-free route tests (`test_vqe_routes.py`) — all 11 endpoints
    reachable, the cancel/events/materialize stubs return 409 with the
    right code, `get_workflow` rejects a non-workflow component,
    `create_experiment` translates `IdempotencyConflictError` to 409, the
    comparisons endpoint reads a real bundled report and 404s on an
    unknown one.
  - **7 new live-Postgres integration tests**
    (`test_vqe_repo_live.py`, real round trips, not mocks):
    - component spec create/get/list round-trip, including a
      `component_type` filter that correctly excludes non-matching rows.
    - the `vqe_component_specs` primary key genuinely rejects a second
      `create_component_spec` for the same `artifact_version_id`
      (`IntegrityError`).
    - workflow components create/list, and the
      `(workflow, role, ordinal)` unique constraint genuinely rejects a
      duplicate (`IntegrityError`).
    - a component created in one workspace is genuinely invisible
      (`NotFoundError`) from a second, independently provisioned
      workspace, and still visible from its own.
    - `create_experiment` never sets `run_id`; the same idempotency key +
      same request returns the *same* row; the same key + a different
      `scientific_spec_sha256` genuinely raises `IdempotencyConflictError`.
    - an experiment is genuinely invisible outside its owning workspace.
    - `append_observation` genuinely rejects (before any DB round trip,
      via `ValueError`) a spec-sha256 mismatch, a `succeeded` status
      carrying a `failure_code`, and a `failed` status missing one; the
      DB genuinely rejects a duplicate `(experiment_id, attempt)`
      (`IntegrityError`); two real attempts round-trip through
      `list_observations` in attempt order.
  - Everything else in the suite (the pre-existing 1000+ tests) was run
    unmodified as a regression check, not rewritten for this phase.
- **`uv run ruff check .`** — clean, 0 issues, across the whole repo.
- **`uv run ruff format --check .`** — clean after formatting the 3
  newly written files this phase's editor left unformatted.
- **`uv run lint-imports`** — all 4 import-linter contracts kept,
  including the two relevant to this phase ("DB access only inside the
  repository layer" and "VQE domain package stays framework- and
  control-plane-free") — 117 files / 552 dependencies analyzed.
- **`uv run python -m majorana_contracts.export --check`** — OK, current;
  this phase added no new `majorana_contracts` resource types (the VQE API
  response shapes are local Pydantic models in `routes/vqe.py`, the same
  pattern `routes/qpu.py` already uses for QPU-specific response shapes),
  so the wire contract package and its generated `openapi.json`/TS types
  are unaffected.
- **`uv run python scripts/check_raw_queries.py`** — clean.
- The TypeScript `ts` CI job (contracts-gen regeneration diff, UI a11y)
  was **not** re-run: this phase touched no TypeScript and no
  `majorana_contracts` model, so it has nothing to regenerate against.

An earlier run of the full suite against a **non-fresh** local database
(one that still had leftover data from a prior manual test pass, and later
from `seed.py`) produced two failures
(`test_full_283_manifest_reconciles_and_is_idempotent`,
`test_cancel_queued_run_prevents_execution`). Both are pre-existing
tests that assume a fresh/isolated database (documented in their own
docstrings and comments) and are unrelated to this phase's code — they
were not touched, and both pass cleanly on a freshly migrated, unseeded
database. Recorded here rather than silently discarded, per the standing
principle against hiding a result that didn't fit the narrative.

## 4. What was deliberately NOT done (open items, not silently skipped)

- **No Neon branch was created or connected to.** This is the explicit
  stop condition this document exists to satisfy — see §6.
- **No real corpus import.** Turning the 26 papers / 15 repositories / 59
  components already curated in `docs/atlas/corpus/` into real
  `Artifact`/`ArtifactVersion` + `vqe_component_specs` rows is a
  substantial separate piece of work (it needs to decide the
  system-catalog/service-principal question from design decision #4
  above, matching the existing catalog import pipeline's ADR-0016
  precedent) and was explicitly scoped out of this pass. The repository
  and route layers built here are ready to receive that data once that
  decision is made and reviewed.
- **The exact `IntegrityError`-recovery branch of `create_experiment`'s
  idempotency race** (two sessions racing the same key, the loser
  recovering via rollback + re-read) was **not** independently exercised
  by an automated test — it is byte-for-byte the same pattern as
  `catalog_import.create_import_job`, and the underlying DB constraint it
  depends on (`ix_vqe_experiments_workspace_request_idempotency`, a partial unique
  index) was manually verified earlier in this phase via direct `psql`
  inserts. Simulating genuine concurrent sessions in an automated test was
  judged not worth the harness complexity for this pass; flagged here
  rather than silently assumed proven.
- **Comparison corpus production packaging was fixed on 2026-07-25.**
  `services/api/pyproject.toml` force-includes the immutable reports in the
  wheel and `_comparisons_dir()` prefers that packaged copy with a
  source-checkout fallback.
- **No UI work in this document** — Phase 4 is tracked separately (see
  the sibling work described alongside this report).

## 5. Acceptance against the plan's own Phase 3 rules (Part IV)

- POST requires Idempotency-Key — done (§2.5).
- API determines workspace/user from Scope — done (every route takes
  `CurrentScope`; no client-supplied workspace ID is ever accepted).
- Registry import is explicit, idempotent, reviewed-corpus-only — not yet
  exercised (§4; no import has run against this phase's code yet).
- API resolves component ArtifactVersions to build the scientific spec —
  done in the repository under Scope for all 12 required component roles;
  client-supplied component UUIDs are rejected (ADR-0029/0029).
- Requested capability resolves server-side to an approved
  ExecutionBinding — `GET /v1/vqe/capabilities` reports the one known
  capability (`h2_sto3g_exact_energy`) as `available: false` with an
  honest reason, since no binding is approved yet (§2.2).
- User-supplied runtime/digest is never authority — no route in this
  phase accepts a client-supplied runtime profile, digest, or provider
  version at all.
- Worker job payload centers on experiment ID + Scope pointer — not
  applicable yet; no job is enqueued in this phase (§2.1).
- Runtime holds no DB credential — not applicable yet; no runtime is
  invoked in this phase.
- Materialize only from a succeeded observation — enforced by construction
  right now: `materialize` always 409s, since no observation can exist yet
  without an ExecutionBinding.
- No public publication — nothing in this phase changes any
  `publication_state`/`visibility` field.

## 6. What this document is asking for

The original Phase 3 implementation above was committed to `feature/vqe`.
The 2026-07-25 integrity remediation is isolated on
`fix/vqe-mvp-integrity` and verified against a local, throwaway, non-Neon
Postgres instance — migration
reversibility, every declared constraint, workspace isolation, and the
full existing test suite as a regression check. Per the original Phase 0-6
kickoff instructions, **Phase 3's actual Neon branch creation/connection
requires explicit owner go-ahead before proceeding** — this document is
that stop-and-report. Nothing in `feature/vqe` has touched Neon, `dev`, or
`prod` in this phase.

## 7. 2026-07-25 integrity remediation

The follow-up audit found that the original implementation did not yet make
all of its strongest integrity claims true. The remediation:

- adds the independent `stopping_protocol` component;
- constructs `ScientificExperimentSpec` server-side from 12 typed workflow
  links and rejects missing/duplicate/wrong-type/unsupported composition;
- rejects non-finite scientific values and canonicalizes Hamiltonians inside
  the digest function;
- enforces observation append-only behavior with PostgreSQL privileges and a
  trigger, not repository convention alone;
- requires Hamiltonian digest on success and all-or-none external detail
  references;
- packages generated comparison reports in the API wheel;
- distinguishes HTTP replay identity (`request_idempotency_key`) from the
  later Phase 5 execution identity.

A fresh throwaway PostgreSQL 14 run passed 11/11 live repository/migration
tests. Neon remains untouched and corpus import remains open. Full commands,
the one disclosed test-invocation error, and the project-level Go/No-Go are
recorded in `docs/atlas/INTEGRITY_REMEDIATION_2026-07-25.md`.
