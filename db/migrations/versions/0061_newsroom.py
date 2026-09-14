"""Durable newsroom batches, editorial documents and bounded image bytes.

Revision ID: 0061
Revises: 0060
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql as pg

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "news_batches",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column("workspace_id", pg.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("user_id", pg.UUID(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("request_key", sa.Text(), nullable=False),
        sa.Column("request", pg.JSONB(), nullable=False),
        sa.Column("stage", sa.Text(), nullable=False, server_default="queued"),
        sa.Column("checkpoint", pg.JSONB(), nullable=False, server_default="{}"),
        sa.Column("calls", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("error", sa.Text()),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("workspace_id", "request_key"),
        sa.CheckConstraint(
            "stage in ('queued','research','draft','review','image','done','held','failed')"
        ),
        sa.CheckConstraint("calls between 0 and 12"),
    )
    op.create_index(
        "ix_news_batches_workspace_created", "news_batches", ["workspace_id", "created_at"]
    )
    op.create_table(
        "news_articles",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column("workspace_id", pg.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column("batch_id", pg.UUID(), sa.ForeignKey("news_batches.id"), nullable=False),
        sa.Column("event_key", sa.Text(), nullable=False),
        sa.Column("document", pg.JSONB(), nullable=False),
        sa.Column("digest", sa.Text(), nullable=False),
        sa.Column("review", pg.JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("publication_log", pg.JSONB(), nullable=False, server_default="[]"),
        sa.Column("published_at", sa.DateTime(timezone=True)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.UniqueConstraint("workspace_id", "event_key"),
        sa.UniqueConstraint("batch_id"),
        sa.CheckConstraint("status in ('draft','published','withdrawn')"),
        sa.CheckConstraint("status <> 'published' or published_at is not null"),
    )
    op.create_index("ix_news_articles_public", "news_articles", ["workspace_id", "status", "id"])
    op.create_table(
        "news_assets",
        sa.Column("id", pg.UUID(), primary_key=True),
        sa.Column("workspace_id", pg.UUID(), sa.ForeignKey("workspaces.id"), nullable=False),
        sa.Column(
            "article_id", pg.UUID(), sa.ForeignKey("news_articles.id"), nullable=False, unique=True
        ),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("metadata_json", pg.JSONB(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("octet_length(data) between 1 and 600000"),
    )
    op.create_unique_constraint(
        "uq_news_batches_id_workspace", "news_batches", ["id", "workspace_id"]
    )
    op.create_unique_constraint(
        "uq_news_articles_id_workspace", "news_articles", ["id", "workspace_id"]
    )
    op.create_foreign_key(
        "fk_news_article_batch_workspace",
        "news_articles",
        "news_batches",
        ["batch_id", "workspace_id"],
        ["id", "workspace_id"],
    )
    op.create_foreign_key(
        "fk_news_asset_article_workspace",
        "news_assets",
        "news_articles",
        ["article_id", "workspace_id"],
        ["id", "workspace_id"],
    )
    for table in ("news_batches", "news_articles", "news_assets"):
        op.execute(f"alter table {table} enable row level security")
        predicate = (
            "workspace_id = nullif(current_setting('leona.news_workspace_id', true), '')::uuid"
        )
        op.execute(
            f"create policy newsroom_scope on {table} using ({predicate}) with check ({predicate})"
        )
        op.execute(
            f"do $$ begin if exists(select 1 from pg_roles where rolname='app_rw') then grant select,insert,update,delete on {table} to app_rw; end if; end $$"
        )


def downgrade():
    for table in ("news_assets", "news_articles", "news_batches"):
        op.drop_table(table)
