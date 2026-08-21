# ADR-0029: A project share reaches through RLS, scoped to the shared project

**Date:** 2026-08-21 · **Status:** accepted (resolves the hard precondition ADR-0028 left open)

**Context:** ADR-0028 installed row-level security on 24 tenant tables and named one thing that
had to be settled before `MAJORANA_RLS_ENFORCED` could ever be set. Project sharing is a shipped
Team-tier feature: `repos/shares.py` deliberately reads `projects`, `artifacts` and
`artifact_versions` keyed on the GRANT (`scope.user_id`) rather than on `scope.workspace_id`,
because reaching across a workspace boundary is the entire point of a share. All three of those
tables carry a workspace-keyed policy, so under enforcement a grantee's session — carrying their
OWN workspace id — matches none of the shared rows. ADR-0028 called this a hard blocker on the
flip and left the shape of the fix as "a design decision (how far a grant is allowed to reach
through RLS, and how that stays bounded) for whoever does that follow-up". This is that decision.

Owner ruling, `EshMis/ai-ops#149`, after asking what the industry standard is and being shown it:
option 1, **"let a grant punch through RLS, scoped tightly to exactly what was shared"**, and
**"A — Option 1, before launch"**. The standard is not ambiguous here: an RLS policy is meant to
express the whole authorization rule rather than only its tenancy half, so a grant belongs inside
the policy as a disjunct rather than routed around it. Exempting the shared tables instead — the
option not taken — would have removed the database backstop from precisely the tables where a
cross-tenant read is possible at all, and kept it on the ones that are single-tenant by
construction. That is the risk inverted.

**Decision:** `db/migrations/versions/0054_rls_share_grant_disjunct.py` adds one GUC and one
disjunct.

`repos/_base.py::set_rls_context` — still the only function in the tree that sets any RLS GUC,
still called from one place, `auth/deps.py::get_scope` — now sets `majorana.user_id` alongside
`majorana.workspace_id`, in the same statement so the two cannot be armed separately. The policies
on `projects`, `artifacts` and `artifact_versions` gain a third disjunct: the row's project is one
the session's user holds a LIVE grant on. `project_shares` gets its first policy, with both halves
it is read from — the owning workspace's (through `projects`) and the grantee's own
(`grantee_user_id`). `audit_log` gets a narrow pair of policies permitting a grantee to write, and
read back, the audit row their own shared edit produces — and nothing of the grantor's history.

Four properties bound it, and each has a test that fails without it:

- **Scoped to the shared project, not to the grantor's workspace.** A grant on one project does
  not expose a sibling project in the same workspace. This restates, in the database, the boundary
  `repos/shares.py::_bound_artifact` calls "the security boundary of the whole feature".
- **`expires_at` is evaluated in the policy.** Today expiry lives only in
  `_project_limits.live_share_predicates()`, which a future query can forget. In the policy an
  expired grant stops returning rows at the database, on every path including unwritten ones.
- **Fails closed with the GUC unset.** `= NULL` is never true, so a session that never armed the
  user id gets pre-0054 behaviour rather than a wider one.
- **A NULL `project_id` cannot match.** Unfiled artifacts stay reachable only by their own
  workspace.

**Enforcement remains OFF.** `Settings.rls_enforced` still defaults to False everywhere, production
included, and flipping it stays a separate, deliberate step. What changes is that the flip is no
longer known-broken.

**Consequences:**

*The obvious implementation does not run.* Written as the plain `EXISTS` against the grants table
that the research on #149 sketched, the policies recurse — `artifacts` reads `project_shares`,
whose policy reads `projects`, whose policy reads `project_shares` — and PostgreSQL refuses with
`infinite recursion detected in policy for relation "project_shares"` on an ordinary artifact
lookup. The grant lookup therefore lives in a single `STABLE SECURITY DEFINER` function,
`majorana_rls_shared_project_ids()`, which is the second shape the standard offers for exactly this
case. It works because ADR-0028 deliberately does not set `FORCE ROW LEVEL SECURITY`, so the
function's owner evaluates no policy. **That is now a load-bearing dependency between the two
ADRs**: setting FORCE on `project_shares` restores the recursion, and a test asserts it is off and
says why.

*A `FOR INSERT` policy is never enough on its own here.* PostgreSQL applies the SELECT policy to an
`INSERT … RETURNING`, and SQLAlchemy emits `RETURNING` for every mapped row. Measured rather than
reasoned about: with only an INSERT policy, a raw insert succeeded and the identical row through
the ORM failed, in the same transaction, one statement apart. Anything adding a `FOR INSERT` policy
in this codebase needs the SELECT half too.

*One code path changed shape.* `shares.contribute_artifact` created its artifact unfiled and filed
it a moment later through `set_artifact_project`. Under these policies that transient row — in the
owning workspace, in no project — is not something a grant can honestly be said to cover, and
permitting it would have needed a predicate wide enough to expose the owner's own unfiled drafts to
any grantee. It now reserves the project slot explicitly and creates the artifact already filed,
via a new optional `project_id` on `repos/artifacts.create_artifact`. Both cap checks survive, in
the same order under the same lock. `leave_shared_project` likewise writes its audit row before
deleting the grant rather than after, because the policy asks whether the writer holds the grant
the row describes.

*A latent defect in ADR-0028's own policies was found and fixed here.* `set_config(…, true)` is
`SET LOCAL`, and at commit a custom GUC reverts to the empty string rather than to unset.
`current_setting(name, true)` then returns `''`, and `''::uuid` RAISES. Against 0053, on a pooled
connection where an earlier transaction had armed the GUC, `select count(*) from runs` failed with
`invalid input syntax for type uuid: ""` **with enforcement off** — not a filter failing open or
closed, a statement erroring. ADR-0028's escape hatch for the worker, `catalog_admin.py` and
operator sessions rests on "never set the GUC" being indistinguishable from "unset", which holds on
a fresh connection and not on a pooled one. 0054 rewrites all 24 policies to read the GUC through
`nullif(…, '')`. Nothing was broken in production, because enforcement has never been on and so no
connection ever acquired the empty value — it would have broken on the day of the flip, presenting
as an outage rather than as a sharing bug.

*What is still open.* `provider_credentials` remains excluded — ADR-0028's other named follow-up,
scoped by `user_id` by design, and nothing has ruled on it. And the flip itself is still a separate
decision: this ADR makes `MAJORANA_RLS_ENFORCED` safe to consider, not set.

**Reversal trigger:** none. Enforcement is off by default and the disjunct is additive; a change of
mind is `alembic downgrade 0053`, which restores ADR-0028's policy text exactly (asserted by
round-tripping the migration and diffing `pg_policies`).
