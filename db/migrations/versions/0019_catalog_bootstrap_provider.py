"""Allow the pinned bootstrap-manifest import provider.

Revision ID: 0019
Revises: 0018

Slice B (ADR-0019) adds a second, non-network import provider: the pinned,
content-hashed bootstrap manifest (catalog_bootstrap). Migration 0016 pinned
the import_jobs.provider CHECK to the single Step 5a value 'local_fixture';
extend that closed allowlist to admit 'catalog_bootstrap'. Still no network
adapter — the bootstrap source embeds and hashes its bytes at generation time.
"""

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
    op.drop_constraint(_CONSTRAINT, "import_jobs", type_="check")
    op.create_check_constraint(_CONSTRAINT, "import_jobs", f"provider in ({_quote(_OLD)})")
