"""Alembic environment. Offline mode is unsupported on purpose: every migration
must run (and be up→down→up tested) against a real Postgres — see
plans/rebuild/04-database.md §4."""

import os

from alembic import context
from sqlalchemy import create_engine


def _database_url() -> str:
    url = os.environ.get("DATABASE_URL_DIRECT")
    if not url:
        raise RuntimeError(
            "DATABASE_URL_DIRECT is not set (use the Neon direct endpoint, role `migrate`)"
        )
    # Normalize scheme so SQLAlchemy picks the psycopg3 driver.
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg://", 1)
    elif url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise RuntimeError("Offline (--sql) mode is not supported; migrations run against a live DB")

run_migrations_online()
