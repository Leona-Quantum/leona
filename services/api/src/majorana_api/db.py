"""Engine/session factory — the only module that constructs engines.

Production moved from Neon to Cloud SQL on 2026-07-27, so DATABASE_URL is now a
Unix-socket URL through the Cloud SQL connector that Cloud Run mounts:

    postgresql+psycopg://USER:PASS@/majorana?host=/cloudsql/PROJECT:REGION:INSTANCE

That is a DIRECT connection to Postgres — there is no PgBouncer in front of it
any more, so the "no session-state features" restriction that Neon's pooled
endpoint imposed (04-database.md §3) no longer binds. Nothing here relies on
that yet; it is recorded because it changes what a future change is allowed to
do, not because anything needs it today.

Migrations use DATABASE_URL_DIRECT and never come through here.

Pool sizes are set explicitly because the ceiling is now a fixed, small number.
db-g1-small allows 50 connections total; SQLAlchemy's defaults (pool_size 5 +
max_overflow 10) would let two API instances and the worker reach 45 on their
own and leave nothing for a deploy's migration step or an operator's psql.
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


#: Per process. Two API instances (maxScale 2) and one worker (maxScale 1) reach
#: 3 × 10 = 30 of the instance's 50, which leaves room for a deploy's Alembic
#: step, Postgres's own superuser reservation, and a human with psql.
DEFAULT_POOL_SIZE = 5
DEFAULT_MAX_OVERFLOW = 5


def _pool_setting(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    value = int(raw)
    if value < 0:
        raise RuntimeError(f"{name} must not be negative: {value}")
    return value


def _validate_application_url(url: str) -> None:
    parsed = make_url(url)
    host = (parsed.host or "").lower()
    is_cloud_runtime = os.environ.get("MAJORANA_ENV", "production") in {
        "production",
        "staging",
    }
    # Kept after the Cloud SQL move: a URL pointing back at Neon in a deployed
    # environment now means a stale secret, and a stale secret that still
    # *connects* is the worst failure mode available — two live databases, both
    # accepting writes, neither complete. Cloud SQL URLs carry no host at all
    # (the socket path is a query parameter), so this cannot fire on them.
    if host.endswith(".neon.tech") and is_cloud_runtime:
        raise RuntimeError(
            "DATABASE_URL points at Neon, which production left on 2026-07-27. "
            "Read the Secret Manager entry rather than assuming: "
            "docs/runbooks/database.md § Where the database lives."
        )


def _clear_query_timer(conn) -> float | None:
    """Pop one statement timer, tolerating failures before timing began."""
    if conn is None:
        return None
    timers = conn.info.get("query_started_at")
    if not timers:
        return None
    return timers.pop()


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
        started = _clear_query_timer(conn)
        if started is not None:
            _query_duration.record(time.monotonic() - started)

    @event.listens_for(engine.sync_engine, "handle_error")
    def _handle_error(exception_context) -> None:
        # after_cursor_execute is not called for failed statements. Clear the
        # timer here so a pooled connection cannot carry stale timing state
        # into the next borrower.
        _clear_query_timer(exception_context.connection)


def engine_from_env() -> AsyncEngine:
    url = os.environ["DATABASE_URL"]
    _validate_application_url(url)
    if url.startswith("postgresql://"):
        url = url.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_async_engine(
        url,
        pool_pre_ping=True,
        pool_size=_pool_setting("DB_POOL_SIZE", DEFAULT_POOL_SIZE),
        max_overflow=_pool_setting("DB_MAX_OVERFLOW", DEFAULT_MAX_OVERFLOW),
    )
    _instrument_engine(engine)
    return engine


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
