"""Cross-tenant execution counters for the Qapp spend ceilings.

0055 bounds Qapp executions at 60 per hour **per account**
(`routes/qapps.py::QAPP_EXECUTION_BACKSTOP_PER_HOUR`, reserved under the
caller's own `users` row lock in `repos/qapps.py::reserve_execution_slot`).
That is the right shape for a private Qapp, where the only account that can
execute one is the account that owns it.

It is the wrong shape for a **published** Qapp. `/q/<slug>` is a public,
search-indexed page and any signed-in visitor may run what it hosts, so the
real ceiling on a single published Qapp is *(signed-in accounts) x 60* paid
sandbox executions per hour, and the real ceiling on the deployment is that
again times the number of published Qapps. Neither number is bounded by
anything in 0055. Both are bounded here.

## Why this is a function and not a `select count(*)`

The two counts this needs — how many executions this *qapp* has had, and how
many the *deployment* has had — are by construction cross-tenant, and
`qapp_executions` carries 0055's `tenant_isolation` policy:

    current_setting('majorana.rls_enforce', true) is distinct from 'on'
      or qapp_executions.workspace_id = <the caller's workspace>

Today `majorana.rls_enforce` is off in every environment including production
(`settings.py::rls_enforce`, ADR-0028), so the first disjunct is true and an
ordinary count from `app_rw` really does see every row. That is exactly the
problem. The moment enforcement is switched on — which is the *stated
direction*, not a hypothetical — that predicate starts filtering, and both
ceilings silently collapse to "executions in my own workspace". They would not
error and they would not fire; they would simply stop bounding anything, at
the precise moment the security posture was being tightened. A ceiling that
quietly becomes a no-op is worse than no ceiling, because the dashboards still
show it.

So the counts are read through a `SECURITY DEFINER` function, which runs as
this migration's role. That role owns `qapp_executions` and is not `FORCE ROW
LEVEL SECURITY`, so it is exempt from the policy and the counts stay true
under either setting of the GUC. This is the same instrument, for the same
reason, as 0054's live-grant function.

The function is `STABLE`, takes the window start as an argument rather than
computing it, and returns both counts in one row so the reservation path pays
one round trip while holding a lock.

## Indexes

`ix_qapp_executions_workspace_created` (0055) is keyed on the workspace, which
is the one column neither of these counts filters on. The global count wants
`created_at` alone and the per-qapp count wants `(qapp_id, created_at)`; both
are added here.
"""

from __future__ import annotations

from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None

_FN = "qapp_execution_pressure"

_FN_SQL = f"""
create or replace function {_FN}(p_since timestamptz, p_qapp_id uuid)
returns table (qapp_count bigint, global_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $fn$
  select
    count(*) filter (where e.qapp_id = p_qapp_id),
    count(*)
  from qapp_executions e
  where e.created_at >= p_since
$fn$
"""


def upgrade() -> None:
    op.execute(
        "create index if not exists ix_qapp_executions_created on qapp_executions (created_at)"
    )
    op.execute(
        "create index if not exists ix_qapp_executions_qapp_created "
        "on qapp_executions (qapp_id, created_at)"
    )
    op.execute(_FN_SQL)
    # SECURITY DEFINER functions are executable by PUBLIC unless told otherwise.
    # This one reports deployment-wide execution volume, so it is revoked first
    # and granted back only to the application role — guarded on that role
    # existing, exactly like 0052/0053/0054's role blocks, because roles are
    # cluster-wide and not every database this runs against provisioned one.
    op.execute(f"revoke all on function {_FN}(timestamptz, uuid) from public")
    op.execute(
        f"""
        do $$
        begin
          if exists (select 1 from pg_roles where rolname = 'app_rw') then
            grant execute on function {_FN}(timestamptz, uuid) to app_rw;
          end if;
        end
        $$;
        """
    )


def downgrade() -> None:
    op.execute(f"drop function if exists {_FN}(timestamptz, uuid)")
    op.execute("drop index if exists ix_qapp_executions_qapp_created")
    op.execute("drop index if exists ix_qapp_executions_created")
