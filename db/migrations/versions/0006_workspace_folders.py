"""workspace-scoped chat folders and durable run assignments.

Revision ID: 0006
Revises: 0005
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "workspace_folders",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id", UUID(as_uuid=True), sa.ForeignKey("workspaces.id"), nullable=False
        ),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "uq_workspace_folders_workspace_name_lower",
        "workspace_folders",
        ["workspace_id", sa.text("lower(name)")],
        unique=True,
    )
    op.add_column("runs", sa.Column("folder_id", UUID(as_uuid=True)))
    op.create_foreign_key("fk_runs_folder_id", "runs", "workspace_folders", ["folder_id"], ["id"])
    op.create_index("ix_runs_workspace_folder", "runs", ["workspace_id", "folder_id"])
    op.execute(
        """
        do $$
        begin
            if exists (select 1 from pg_roles where rolname = 'app_rw') then
                grant select, insert, update, delete on workspace_folders to app_rw;
            end if;
        end $$;
        """
    )


def downgrade() -> None:
    op.drop_index("ix_runs_workspace_folder", table_name="runs")
    op.drop_constraint("fk_runs_folder_id", "runs", type_="foreignkey")
    op.drop_column("runs", "folder_id")
    op.drop_index("uq_workspace_folders_workspace_name_lower", table_name="workspace_folders")
    op.drop_table("workspace_folders")
