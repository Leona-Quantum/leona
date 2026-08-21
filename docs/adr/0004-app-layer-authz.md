# ADR-0004: App-layer authorization primary; RLS deferred

**Date:** 2026-07-09 · **Status:** superseded-by-0028 (RLS deferral lifted 2026-08-17,
`EshMis/ai-ops#143` — the app-layer predicate stays PRIMARY; RLS returns as
defense-in-depth, unconditionally, not merely "before a regulated-enterprise deal" as the
reversal trigger below once read). See `docs/adr/0028-rls-defense-in-depth.md`.
**Context:** RLS-as-primary suits architectures where clients hit the DB directly. Here
exactly one trusted caller (the FastAPI control plane) touches Postgres, so RLS would
duplicate the authz layer while complicating migrations and query plans.
**Decision:** Authorization = mandatory workspace-scoping in the repository layer: every
repository function takes an explicit `Scope` (user_id, workspace_id, role) as its first
argument and appends the scoping predicate itself; no raw `session.query` outside the
repository layer. Enforced by lint rule + CI grep + an authz test suite (every entity ×
role × cross-workspace probe) run as a required CI check.
**Consequences:** This test suite is the load-bearing control replacing RLS — treat it
with release-gate seriousness (a deliberately-broken scope must fail it). Reversal
trigger: RLS returns as defense-in-depth before regulated-enterprise deals.

**2026-08-21 (`EshMis/ai-ops#150`): the load-bearing control now runs under the privilege
set production actually has.** For its entire git history that suite ran as the CI
superuser, which proved the authorization LOGIC while never once exercising it under the
privileges the application holds — two different claims, only the first of which was being
made. Since 2026-08-17 the api and worker connect as `majorana_api`, whose only membership
is the deliberately restricted `app_rw` bundle, so the gap was real and growing. CI's `db`
job now runs both the authz suite and the 27 `*_live.py` suites as `majorana_api`. Measured
either side of the flip: 244 tests collected under both roles, so this is the same coverage
evaluated under production's privileges rather than less of it. Teardown alone escalates,
via `DATABASE_URL_OWNER` — the four tables `repo_test_helpers.delete_committed_tenants`
cleans up are append-only behind grants production is never meant to hold.
