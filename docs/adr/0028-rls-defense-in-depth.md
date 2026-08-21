# ADR-0028: Row-level security as defense-in-depth, enforcement gated off by default

**Date:** 2026-08-17 · **Status:** accepted (supersedes ADR-0004's deferral)

**Context:** ADR-0004 made app-layer `Scope` scoping PRIMARY and RLS deferred, with a stated
reversal trigger: *"RLS returns as defense-in-depth before regulated-enterprise deals."* Owner
ruling, `EshMis/ai-ops#143`: *"A regulated-enterprise deal is in sight, so begin RLS now across
the tenant tables. and remove the condition, RLS is important regardless."* That fires the trigger
and, in the same sentence, removes it as a condition for anything after this — RLS is not
contingent on the next deal being real. ADR-0004's own reasoning for deferring RLS still holds
(one trusted caller touches Postgres, so RLS cannot be the *only* control, and duplicating the
predicate in two places is real cost) — the ruling changes the trigger, not that reasoning, which
is why this is defense-in-depth rather than a replacement.

**Decision:** RLS is now installed on every genuinely tenant-scoped table
(`db/migrations/versions/0053_rls_defense_in_depth.py` — the migration's own docstring is the
table-by-table classification: 7 directly workspace-scoped, 17 reached transitively, 3 identity
tables excluded because RLS there would break the code that resolves a workspace_id before one is
known, 3 system/worker-wide queues excluded because their access pattern is cross-tenant by
requirement, and 2 — `project_shares`, `provider_credentials` — excluded because a workspace_id
predicate is actively the wrong shape for what each deliberately does). The authz matrix suite
(`services/api/tests/authz/`, 155 tests) remains the primary, required-CI control; RLS is the
database-enforced backstop for what that suite cannot cover by construction — a query with no
`Scope` predicate at all, from a bug or a future caller.

**The mechanism is two GUCs, not one, and that split is what makes "install now, enforce later"
honest rather than a euphemism for not installing it.** Every policy reads:

    current_setting('majorana.rls_enforce', true) IS DISTINCT FROM 'on' OR <tenant predicate>

`majorana.rls_enforce` is set to `'on'` in exactly one function,
`repos/_base.py::set_rls_context`, called from exactly one call site, `auth/deps.py::get_scope`,
and only when `Settings.rls_enforced` is `True` — which defaults to `False` everywhere, production
included, for this PR (env var `MAJORANA_RLS_ENFORCED`). So the migration is safe to merge and run
against production immediately: it changes what SQL objects exist, not what any live request
returns, until a separate, deliberate change flips the flag. That flip is real production risk in
its own right — a request path that forgets to set `majorana.workspace_id` returns zero rows, not
an error, the instant enforcement is on — and is intentionally left as follow-up work with its own
review, not smuggled into this PR as a side effect of installing the policies.

The same split is the "auditable escape" for callers that legitimately need cross-tenant reach —
the worker's job queue, `catalog_admin.py`'s standalone import scripts, migrations run as
`majorana_app` (the owner; not FORCEd, see 0053's docstring for why) — none of which call
`auth/deps.py::get_scope`, so none of them ever set the enforce GUC, and each behaves exactly as it
did before this migration, by construction rather than by being named as an exception.

**Consequences:** Nothing changes for a live request until `MAJORANA_RLS_ENFORCED` is set — this is
by design, and the cost is that "RLS is installed" and "RLS is protecting anything" are different
facts until that flip, which a future reader must not conflate. `services/api/tests/rls/` is a new
required-CI suite (parallel to, not merged into, the authz suite) proving both directions — a
cross-tenant probe returns zero rows under enforcement, the same probe returns the row with
enforcement off — for every live-fixture-backed table, plus a control that deliberately weakens one
policy inside a rolled-back transaction to prove the suite would catch a real regression, plus an
assertion that the suite's own connecting role carries neither SUPERUSER nor BYPASSRLS (the trap
that would make every other assertion here pass while proving nothing — see 0052's own note on
testing a privilege change as a superuser).

`project_shares` and `provider_credentials` are named, not silently dropped: a workspace_id
predicate is wrong for both by design (the first is a deliberate cross-tenant grant, the second is
scoped by `user_id`), and a correct policy for either needs a GUC this migration does not
introduce. Follow-up, not this PR.

**A hard precondition on the flip, found in review (PR 709, Aikido) and not something this PR
fixes — RESOLVED 2026-08-21 by `ADR-0029` / migration 0054, on owner ruling `EshMis/ai-ops#149`:** excluding `project_shares` itself is not enough. `repos/shares.py`'s whole feature reads
`projects`/`artifacts`/`artifact_versions` — all three ARE protected by this migration — keyed on
the grant (`scope.user_id`), not on `scope.workspace_id`, precisely so a grantee in workspace B can
read a project that lives in workspace A. Under enforcement, the grantee's session GUC carries
their OWN workspace, and the shared rows live in a different one, so RLS would silently empty every
shared read the moment `MAJORANA_RLS_ENFORCED` is set — a regression in a shipped, paying-tier
feature, indistinguishable from "no results" to whoever hits it first. **`MAJORANA_RLS_ENFORCED`
must not be set until this is resolved** — see 0053's docstring, `project_shares` section, for the
detail. This is a design decision (how far a grant is allowed to reach through RLS, and how that
stays bounded) for whoever does that follow-up, not a bug in this PR. That follow-up is
`docs/adr/0029-rls-share-grant-disjunct.md`: a grant now reaches through RLS, scoped to the shared
project and no wider, and the eleven `repos/shares.py` paths are proved against live Postgres as
the restricted role in `services/api/tests/rls/test_share_grant_rls.py`. 0029 also records a
latent defect in THIS migration's policies that the work turned up — `current_setting(x, true)`
returns `''` rather than NULL on a pooled connection, and `''::uuid` raises — which 0054 fixes on
all 24 tables.

Reversal trigger: none. The owner ruling that produced this ADR was itself the removal of the prior
trigger; RLS as defense-in-depth is now the standing posture, not a conditional one. What remains
open is operational — when `MAJORANA_RLS_ENFORCED` flips, and whether `provider_credentials` gets
its own policy shape (`project_shares` got one in 0054; see ADR-0029) — and each of those is its own decision when it
happens, not a re-litigation of this one.
