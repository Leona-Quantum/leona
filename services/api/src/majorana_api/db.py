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


#: Per process, and sized for the API's shape: many short concurrent requests.
#: The worker's shape is different and it overrides both downward — see
#: WORKER_POOL_SIZE below and docs/runbooks/database.md § Connection budget.
DEFAULT_POOL_SIZE = 5
DEFAULT_MAX_OVERFLOW = 5

#: The fleet these defaults have to fit inside, stated here because the ceiling
#: is a fixed small number and the arithmetic is otherwise spread across
#: deploy.yml and a runbook. `deploy.yml` pins every one of these on the
#: `gcloud run deploy` line; test_database_configuration.py asserts the sum.
API_MAX_INSTANCES = 2
#: THREE, not the four the budget allows at rest. `--min-instances` is a
#: revision-level setting, so during a deploy the outgoing and incoming worker
#: revisions each hold their minimum and the fleet transiently doubles its worker
#: term — see fleet_peak_connections. Four workers is 36 connections at rest and
#: 52 for the length of every deploy, against a budget of 45, and a deploy is
#: precisely when a spare connection has to exist for Alembic.
WORKER_INSTANCES = 3
#: The worker never holds more than two sessions at once — the job handler and
#: the concurrent heartbeat that fences its lease (`_execute_with_heartbeat`).
#: Everything else in the loop (claim, finish, the recover/dead-letter/reap
#: sweeps) opens one session at a time and closes it before the next. Measured
#: 2026-08-01 against production: four backends total on `majorana` at idle
#: across the whole fleet, none of them close to the old 5+5 ceiling.
WORKER_POOL_SIZE = 2
WORKER_MAX_OVERFLOW = 2

#: db-g1-small allows 50 and reserves 3 for superusers. A deploy's Alembic step
#: and one operator with psql have to fit in what the fleet leaves behind.
INSTANCE_CONNECTION_CEILING = 50
SUPERUSER_RESERVED = 3
OPERATIONAL_HEADROOM = 2  # Alembic during a deploy, plus one human


def fleet_peak_connections(*, during_worker_rollout: bool = True) -> int:
    """Worst case if every process fills both its pool and its overflow.

    `during_worker_rollout` doubles the worker term, and it defaults to True
    because that is the case the budget has to survive. `--min-instances` is a
    REVISION-level setting: while a `gcloud run deploy` is in flight, the
    outgoing revision is still in the traffic split and still holding its
    minimum, so both revisions run their full complement at once. The steady
    state is what you see in `pg_stat_activity`; the rollout is what breaks.

    This is what decided three workers rather than four. Four is comfortable at
    rest (36 of 45) and 52 of 45 for the length of every deploy — and a deploy is
    exactly when the connections matter, because that is when Alembic needs one.
    """
    workers = WORKER_INSTANCES * (2 if during_worker_rollout else 1)
    return API_MAX_INSTANCES * (DEFAULT_POOL_SIZE + DEFAULT_MAX_OVERFLOW) + workers * (
        WORKER_POOL_SIZE + WORKER_MAX_OVERFLOW
    )


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


def _application_name() -> str:
    """What this process calls itself in `pg_stat_activity.application_name`.

    The runbook tells the next person to *measure* the pool before resizing it —
    `select count(*), application_name from pg_stat_activity group by 2` — and
    until now that query returned `(unset)` for every backend, so the instruction
    could not be followed. Measured against production on 2026-08-01: five
    backends, all anonymous, no way to tell an API instance from the worker.

    `MAJORANA_SERVICE` is set on each Cloud Run service by `deploy.yml`. The
    fallback is deliberately not "api": an unlabelled backend should read as
    unlabelled rather than impersonate a service.
    """
    service = os.environ.get("MAJORANA_SERVICE", "").strip() or "unset"
    return f"majorana-{service}"


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
        # libpq connection parameter, forwarded by the psycopg dialect. Costs
        # nothing per connection and is the only thing that makes a backend
        # attributable to a service.
        connect_args={"application_name": _application_name()},
    )
    _instrument_engine(engine)
    return engine


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
