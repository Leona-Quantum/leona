"""Engine/session factory — the only module that constructs engines.

DATABASE_URL must be the Neon POOLED connection string (PgBouncer transaction
mode): no session-state features — no LISTEN/NOTIFY, no session SET
(04-database.md §3). Migrations use the direct URL and never come through here.
"""

import os
import time

from opentelemetry import metrics
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

_meter = metrics.get_meter("majorana.database")
_connections = _meter.create_counter(
    "majorana.db.connections.created", description="Physical database connections created"
)
_checkouts = _meter.create_counter(
    "majorana.db.pool.checkouts", description="Database pool checkouts"
)
_query_duration = _meter.create_histogram(
    "majorana.db.query.duration", unit="s", description="Database statement duration"
)


def _validate_application_url(url: str) -> None:
    parsed = make_url(url)
    host = (parsed.host or "").lower()
    is_neon = host.endswith(".neon.tech")
    is_cloud_runtime = os.environ.get("MAJORANA_ENV", "production") in {
        "production",
        "staging",
    }
    if is_neon and is_cloud_runtime and "-pooler." not in host:
        raise RuntimeError("DATABASE_URL must use the Neon pooled endpoint")


def _instrument_engine(engine: AsyncEngine) -> None:
    @event.listens_for(engine.sync_engine, "connect")
    def _connect(dbapi_connection, connection_record) -> None:
        _connections.add(1)

    @event.listens_for(engine.sync_engine, "checkout")
    def _checkout(dbapi_connection, connection_record, connection_proxy) -> None:
        _checkouts.add(1)

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:
        conn.info.setdefault("query_started_at", []).append(time.monotonic())

    @event.listens_for(engine.sync_engine, "after_cursor_execute")
    def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany) -> None:
        started = conn.info.get("query_started_at", []).pop()
        _query_duration.record(time.monotonic() - started)


def engine_from_env() -> AsyncEngine:
    url = os.environ["DATABASE_URL"]
    _validate_application_url(url)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_async_engine(url, pool_pre_ping=True)
    _instrument_engine(engine)
    return engine


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
