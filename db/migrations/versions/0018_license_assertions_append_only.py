"""Enforce append-only license assertion history in PostgreSQL.

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

_FUNCTION = "majorana_reject_license_assertion_mutation"
_TRIGGER = "trg_license_assertions_append_only"


def upgrade() -> None:
    op.execute(
        sa.text(
            f"""
            CREATE FUNCTION {_FUNCTION}()
            RETURNS trigger
            LANGUAGE plpgsql
            AS $$
            BEGIN
                RAISE EXCEPTION 'license_assertions is append-only; insert a superseding row'
                    USING ERRCODE = '55000';
            END;
            $$
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            CREATE TRIGGER {_TRIGGER}
            BEFORE UPDATE OR DELETE ON license_assertions
            FOR EACH ROW EXECUTE FUNCTION {_FUNCTION}()
            """
        )
    )


def downgrade() -> None:
    op.execute(sa.text(f"DROP TRIGGER IF EXISTS {_TRIGGER} ON license_assertions"))
    op.execute(sa.text(f"DROP FUNCTION IF EXISTS {_FUNCTION}()"))
