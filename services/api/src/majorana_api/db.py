"""Engine/session factory — the only module that constructs engines.

DATABASE_URL must be the Neon POOLED connection string (PgBouncer transaction
mode): no session-state features — no LISTEN/NOTIFY, no session SET
(04-database.md §3). Migrations use the direct URL and never come through here.
"""

import os

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def engine_from_env() -> AsyncEngine:
    url = os.environ["DATABASE_URL"]
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    return create_async_engine(url, pool_pre_ping=True)


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
