"""Allow the pinned bootstrap-manifest import provider.

Revision ID: 0019
Revises: 0018

Slice B (ADR-0019) adds a second, non-network import provider: the pinned,
content-hashed bootstrap manifest (catalog_bootstrap). Migration 0016 pinned
the import_jobs.provider CHECK to the single Step 5a value 'local_fixture';
extend that closed allowlist to admit 'catalog_bootstrap'. Still no network
adapter — the bootstrap source embeds and hashes its bytes at generation time.
"""

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

_CONSTRAINT = "ck_import_jobs_provider_enum"
_OLD = ("local_fixture",)
_NEW = ("local_fixture", "catalog_bootstrap")


def _quote(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    op.drop_constraint(_CONSTRAINT, "import_jobs", type_="check")
    op.create_check_constraint(_CONSTRAINT, "import_jobs", f"provider in ({_quote(_NEW)})")


def downgrade() -> None:
    # Refuse rather than narrow a CHECK the existing rows no longer satisfy.
    # Widening 0019 permitted 'catalog_bootstrap' rows to be written; narrowing it
    # back while any exist raises CheckViolation from Postgres — an opaque failure
    # mid-downgrade. Same fail-closed stance as 0013 with system workspaces:
    # discarding import audit history is a reviewed action, not a side effect of
    # running `alembic downgrade`.
    connection = op.get_bind()
    bootstrap_count = connection.execute(
        sa.text("SELECT count(*) FROM import_jobs WHERE provider = 'catalog_bootstrap'")
    ).scalar_one()
    if bootstrap_count:
        raise RuntimeError(
            f"cannot downgrade 0019 while {bootstrap_count} catalog_bootstrap import_jobs "
            "row(s) exist; remove or re-provider them first"
        )
    op.drop_constraint(_CONSTRAINT, "import_jobs", type_="check")
    op.create_check_constraint(_CONSTRAINT, "import_jobs", f"provider in ({_quote(_OLD)})")
