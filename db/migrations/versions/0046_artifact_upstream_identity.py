"""Give an artifact its own upstream identity, so the public catalog stops
reaching through the import ledger to find one.

Revision ID: 0046
Revises: 0045

## The bug this exists to make impossible

`/repository` renders the database. Two queries serve it and they disagreed
about what a row is:

    list_public_catalog_entries    ... outerjoin(ImportItem).outerjoin(ImportJob)
    count_public_catalog_entries   ... select(count()).select_from(Artifact)

The listing reached ImportItem because that is where the manifest identity
lived; the count never did. They agreed only because every artifact happened to
have exactly one import item — an accident of the corpus having been imported
exactly once.

A reconciling importer reuses the artifact it already created and writes a
**new** ImportItem per batch. That makes the listing's join one-to-many: the
same record renders once per import while `X-Catalog-Total` still counts
artifacts. The web layer compares `collected.length !== total`, and on a
mismatch it refuses the corpus and falls back to the *static* entries — which
are the fixed ones. So the page would look right because of the fallback, not
because of the fix, and nothing anywhere would report a problem.

Moving the identity onto the artifact is what lets both public queries drop that
join, which is the actual repair. The column is also the reconciliation key the
importer needs: resolve by `upstream_identity` first, and a re-import updates
the record it already owns instead of colliding with it.

## Why the index is partial, and on these two predicates

    (workspace_id, upstream_identity) WHERE upstream_identity IS NOT NULL
                                        AND deleted_at IS NULL

`upstream_identity IS NOT NULL` because every artifact outside the catalog
import path — every circuit a user writes in Studio — has no upstream identity
and must not be forced to invent one.

`deleted_at IS NULL` because a soft-deleted record has to release its identity;
otherwise a deleted import permanently poisons its own slug and the corpus can
never be re-imported. The resolver in repos/catalog.py filters on the same two
predicates. They have to stay in step: an index that admits a row the resolver
cannot see would let a duplicate through, and a resolver that sees a row the
index does not cover would fail on insert instead of reconciling.

## The pre-flight check, and why it is not a bare unique index

If two artifacts in one workspace already claim the same upstream identity, the
index cannot be built. Left to Postgres that surfaces as a unique-violation
naming the index, in a deploy log, with no indication of which records are at
fault. `deploy.yml` runs migrations before the image rolls out, so this is the
step that would stop a production deploy — it should say what is wrong.

So the duplicates are read out first and raised by name. This is fail-closed on
purpose: two artifacts under one public slug means the listing is already
serving both and `get_public_catalog_entry` is already picking one arbitrarily.
That is a correctness bug and it should block, not be papered over by dropping
one of them here — a migration must not decide which of two records the public
catalog loses.

## The second index, and why it belongs in this migration

Dropping the join does not drop the need for provenance: the public entry still
carries the provider and upstream ref of the batch that produced it. Those now
come from a correlated scalar subquery over the newest import item for the
artifact — a shape that cannot multiply rows, which was the whole point.

That subquery filters `import_items.resulting_artifact_id`, and a foreign key
does not index the referencing side in Postgres, so it had no index at all. As a
hash join that cost nothing; as a correlated subquery it is a sequential scan of
`import_items` per row returned. The corpus is small enough that this would not
be noticed for a long time, which is exactly why it goes in now rather than
after a slow query is reported — 0039 and 0044 both learned that the shape is
what matters, not today's row count.

Column order matches the subquery's ORDER BY so the index can serve the seek and
the sort together.

## license_assertions.claim_hash

The owner's licence answer (decision B, 2026-08-04) is that a grant carries
forward to a record's new version when the *provenance claim* is unchanged, and
refuses when it changed. `AttestedRecord.grant_carries_forward` implements that
rule and had no way to be called: comparing against the previous claim requires
the previous claim to have been written down, and nothing stored it.
`evidence_hash` is not a substitute — it is sha256 over the claim *and* a content
digest, so it differs on every content revision by design, which is precisely
the case carry-forward exists to allow.

Nullable, because every assertion written before this migration has no recorded
claim and must not be guessed at. A NULL previous claim reads as "no comparable
prior grant", and the caller then requires a fresh human signature — the
conservative direction.

`license_assertions` carries a BEFORE DELETE OR UPDATE row trigger
(`trg_license_assertions_append_only`). Row triggers do not fire on DDL, and a
nullable column with no default does not rewrite existing rows, so this neither
trips the ledger's append-only guarantee nor takes a rewrite lock on it.

## Expand-only

A nullable column, a backfill and an index — nothing the revision still serving
traffic can trip over, which is what `docs/runbooks/database.md` requires of a
migration that lands before the new image. The old code keeps reading the
identity through ImportItem and is unaffected; the new code reads the column,
and `coalesce(upstream_identity, slug)` keeps a NULL degrading to exactly
today's behaviour rather than to a missing row.

CONCURRENTLY is deliberately not used, for the reason 0039 and 0044 both state:
it cannot run inside a transaction, and Alembic's runner is transactional, so a
non-transactional step would leave a failure half-applied.
"""

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None

_INDEX = "ux_artifacts_workspace_upstream_identity"
_PROVENANCE_INDEX = "ix_import_items_artifact_recency"

# DISTINCT ON collapses an artifact that already has several import items to one
# row. Today none do — that is the invariant this whole migration exists to stop
# depending on — but the backfill must not itself error on the condition it is
# being introduced to tolerate. Newest item wins: it describes the most recent
# import, which is the provenance the public entry should carry. `id` breaks the
# tie because ids are uuid7 and therefore ordered by creation.
_BACKFILL = sa.text(
    """
    UPDATE artifacts AS a
       SET upstream_identity = latest.upstream_identity
      FROM (
           SELECT DISTINCT ON (resulting_artifact_id)
                  resulting_artifact_id,
                  upstream_identity
             FROM import_items
            WHERE resulting_artifact_id IS NOT NULL
            ORDER BY resulting_artifact_id, created_at DESC, id DESC
           ) AS latest
     WHERE a.id = latest.resulting_artifact_id
       AND a.upstream_identity IS DISTINCT FROM latest.upstream_identity
    """
)

_DUPLICATE_SAMPLE_SIZE = 20

_DUPLICATES = sa.text(
    f"""
    SELECT workspace_id, upstream_identity, count(*) AS n
      FROM artifacts
     WHERE upstream_identity IS NOT NULL
       AND deleted_at IS NULL
     GROUP BY workspace_id, upstream_identity
    HAVING count(*) > 1
     ORDER BY n DESC, upstream_identity
     LIMIT {_DUPLICATE_SAMPLE_SIZE}
    """
)

# The sample above is bounded so the error stays readable; the total is counted
# separately so the message cannot understate the cleanup. A capped list read as
# a total is how an operator plans a 20-record fix for a 200-record problem.
_DUPLICATE_TOTAL = sa.text(
    """
    SELECT count(*) FROM (
           SELECT 1
             FROM artifacts
            WHERE upstream_identity IS NOT NULL
              AND deleted_at IS NULL
            GROUP BY workspace_id, upstream_identity
           HAVING count(*) > 1
           ) AS clashes
    """
)


def upgrade() -> None:
    op.add_column("artifacts", sa.Column("upstream_identity", sa.Text(), nullable=True))
    op.add_column("license_assertions", sa.Column("claim_hash", sa.Text(), nullable=True))

    bind = op.get_bind()
    bind.execute(_BACKFILL)

    total_clashes = int(bind.execute(_DUPLICATE_TOTAL).scalar_one())
    if total_clashes:
        sample = bind.execute(_DUPLICATES).all()
        detail = ", ".join(
            f"{row.upstream_identity!r} x{row.n} in workspace {row.workspace_id}" for row in sample
        )
        if total_clashes > len(sample):
            detail += f", and {total_clashes - len(sample)} more"
        raise RuntimeError(
            "cannot make upstream_identity unique: "
            f"{total_clashes} identity/workspace pairs are claimed by more than one artifact "
            f"({detail}). The public catalog is already serving these records under one slug; "
            "decide which artifact keeps the identity before migrating."
        )

    op.create_index(
        _INDEX,
        "artifacts",
        ["workspace_id", "upstream_identity"],
        unique=True,
        postgresql_where=sa.text("upstream_identity IS NOT NULL AND deleted_at IS NULL"),
    )
    op.create_index(
        _PROVENANCE_INDEX,
        "import_items",
        ["resulting_artifact_id", sa.text("created_at desc"), sa.text("id desc")],
    )


def downgrade() -> None:
    op.drop_index(_PROVENANCE_INDEX, table_name="import_items")
    op.drop_index(_INDEX, table_name="artifacts")
    op.drop_column("license_assertions", "claim_hash")
    op.drop_column("artifacts", "upstream_identity")
