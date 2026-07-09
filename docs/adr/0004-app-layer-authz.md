# ADR-0004: App-layer authorization primary; RLS deferred

**Date:** 2026-07-09 · **Status:** accepted (supersedes security-baseline.md §1.1)
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
