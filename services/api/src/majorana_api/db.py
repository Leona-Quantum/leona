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

import functools
import os
import pathlib
import time
from dataclasses import dataclass
from typing import Any

from opentelemetry import metrics
from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

#: What a request sees when `DEFAULT_POOL_TIMEOUT_S` elapses with no free
#: connection. Re-exported under a name that says what happened, because the
#: handler that turns it into a 503 lives in `app.py`, where a sqlalchemy import
#: is forbidden by `scripts/check_raw_queries.py`. SQLAlchemy's own name for it
#: is `TimeoutError`, which shadows the builtin and reads, wherever it is
#: caught, as though a network call timed out rather than a queue filled up.
PoolTimeout = SQLAlchemyTimeoutError

_meter = metrics.get_meter("majorana.database")
_connections = _meter.create_counter(
    "majorana.db.connections.created", description="Physical database connections created"
)
_checkouts = _meter.create_counter(
    "majorana.db.pool.checkouts", description="Database pool checkouts"
)
_checkout_wait = _meter.create_histogram(
    "majorana.db.pool.checkout.wait",
    unit="s",
    description=("Time spent acquiring a database pool connection, including connection creation"),
)
_checkout_timeouts = _meter.create_counter(
    "majorana.db.pool.checkout.timeouts",
    description="Database pool checkout timeouts",
)
_query_duration = _meter.create_histogram(
    "majorana.db.query.duration", unit="s", description="Database statement duration"
)


#: Per process, and sized for the API's shape: many short concurrent requests.
#: The worker's shape is different and it overrides both downward, via
#: DB_POOL_SIZE/DB_MAX_OVERFLOW on its Cloud Run service — see infra/fleet.env
#: and docs/runbooks/database.md § Connection budget. These two are the only
#: sizing numbers that are read on a request path, which is why they are literals
#: here and everything else is not.
DEFAULT_POOL_SIZE = 5
DEFAULT_MAX_OVERFLOW = 5

#: How long a request waits for a pool slot before it is refused.
#:
#: SQLAlchemy's default is 30 seconds and was in force here until now, which is
#: the wrong shape for this fleet in a way that compounds. A request blocked on
#: pool checkout is already *admitted*: it holds one of `API_CONCURRENCY` (16)
#: request slots on its instance for the whole wait, without holding a database
#: connection it can use. Thirty seconds of that is thirty seconds during which
#: the instance looks busy to Cloud Run's autoscaler and cannot accept the cheap
#: requests — health, a 404, a validation refusal — that need no database at
#: all. Failing fast returns the slot.
#:
#: ARGUED, NOT MEASURED, and the honest bound is stated rather than implied.
#: What *is* measured (docs/gates/capacity-100-users.md, three runs) is that 100
#: concurrent catalog reads against a pool of this size settle at a p95 of about
#: 1.4s — so 15s is roughly ten times the observed queue depth at the load this
#: gate exists to survive, and a request that has waited that long is not one
#: the pool is about to serve. It is deliberately not tightened to the p95: the
#: gate's own collapse guard is 10s, and a timeout below that would refuse
#: requests the gate is willing to call passing.
DEFAULT_POOL_TIMEOUT_S = 15.0

#: Where the rest of the fleet's sizing lives. Deliberately not in this file:
#: every one of those numbers is also a `gcloud run deploy` argument, and two
#: copies of a number that must agree is how production ends up running a size
#: nobody computed a budget for.
FLEET_FILE = "infra/fleet.env"


@dataclass(frozen=True)
class FleetSizing:
    """The deployed shape of the fleet, as parsed from infra/fleet.env."""

    worker_instances: int
    worker_pool_size: int
    worker_max_overflow: int
    api_max_instances: int
    instance_connection_ceiling: int
    superuser_reserved: int
    operational_headroom: int

    @property
    def connection_budget(self) -> int:
        """What the fleet is allowed to claim, after the reservations."""
        return (
            self.instance_connection_ceiling - self.superuser_reserved - self.operational_headroom
        )


def _fleet_file() -> pathlib.Path:
    """Locate infra/fleet.env by walking up from this module.

    Not importlib.resources: the file is deliberately outside the Python
    package, because `gcloud run deploy` has to read it too and a shell cannot
    reach inside a wheel.
    """
    for parent in pathlib.Path(__file__).resolve().parents:
        candidate = parent / FLEET_FILE
        if candidate.exists():
            return candidate
    raise RuntimeError(
        f"{FLEET_FILE} was not found above {__file__}. It is deploy-time "
        "configuration and is NOT copied into the container image, so this "
        "error means something on a request path called fleet_sizing() — see "
        "test_no_runtime_module_reads_the_fleet_file."
    )


@functools.lru_cache(maxsize=1)
def fleet_sizing() -> FleetSizing:
    """Parse infra/fleet.env.

    DEPLOY-TIME ONLY. Nothing on a request path may call this: infra/ is not in
    the container image (services/api/Dockerfile copies services/, packages/py/,
    evals/harness/ and db/), so in production this raises. That is the intended
    behaviour rather than a gap — a runtime caller of deploy-time sizing is a
    bug, and failing loudly in a test is better than silently reading a stale
    default. `test_no_runtime_module_reads_the_fleet_file` is the guard.
    """
    values: dict[str, int] = {}
    for line in _fleet_file().read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, _, raw = stripped.partition("=")
        values[key.strip()] = int(raw.strip())
    return FleetSizing(
        worker_instances=values["WORKER_INSTANCES"],
        worker_pool_size=values["WORKER_POOL_SIZE"],
        worker_max_overflow=values["WORKER_MAX_OVERFLOW"],
        api_max_instances=values["API_MAX_INSTANCES"],
        instance_connection_ceiling=values["INSTANCE_CONNECTION_CEILING"],
        superuser_reserved=values["SUPERUSER_RESERVED"],
        operational_headroom=values["OPERATIONAL_HEADROOM"],
    )


def fleet_peak_connections(
    *, during_worker_rollout: bool = True, workers: int | None = None
) -> int:
    """Worst case if every process fills both its pool and its overflow.

    `during_worker_rollout` doubles the worker term, and it defaults to True
    because that is the case the budget has to survive. `--min-instances` is a
    REVISION-level setting: while a `gcloud run deploy` is in flight, the
    outgoing revision is still in the traffic split and still holding its
    minimum, so both revisions run their full complement at once. The steady
    state is what you see in `pg_stat_activity`; the rollout is what breaks.

    This used to cap the worker count at three: four was comfortable at rest
    (36 of 45) and 52 of 45 for the length of every deploy — and a deploy is
    exactly when the connections matter, because that is when Alembic needs one.
    That cap was a property of db-g1-small's 50 connections. Since 2026-08-15
    the instance is db-custom-1-3840 with an explicit max_connections=200, so
    the budget is 195 and the worker count is no longer what runs out first.
    `test_where_the_worker_count_actually_runs_out` finds the boundary rather
    than restating it here, so this paragraph cannot drift away from the truth
    a second time.

    **The API term is deliberately NOT doubled, and that is not an omission.**
    The API can absolutely have two revisions live at once — `--max-instances`
    is per revision, so a rollout can transiently run 2 × API_MAX_INSTANCES
    instances. What it cannot have is a *guaranteed* pair: the worker's doubling
    exists because `--min-instances` holds a FLOOR that both revisions keep,
    while the API has no `--min-instances` at all, so its outgoing revision holds
    whatever traffic demanded and then drains. One is arithmetic, the other is a
    function of load.

    The pessimistic figure was worth knowing because it used to be close: two
    revisions × 2 instances × 10 connections is 40, plus a worker at rest (4)
    was 44 of 45. At four API instances and a 195 budget the same shape is two
    revisions × 4 × 10 = 80 plus 3 workers at rest (12), or 92 — no longer
    close, but still the figure to compute rather than the resting one.
    It is not gated on — a gate on a load-dependent worst case fails on a quiet
    week for reasons nobody can reproduce — but anyone raising API_MAX_INSTANCES,
    DEFAULT_POOL_SIZE/DEFAULT_MAX_OVERFLOW, or the worker count should compute
    that number rather than the resting one. See
    docs/gates/capacity-100-users.md § the asymmetry in the connection budget.

    `workers` overrides the deployed count, so the boundary can be probed
    without editing infra/fleet.env.
    """
    fleet = fleet_sizing()
    count = fleet.worker_instances if workers is None else workers
    count *= 2 if during_worker_rollout else 1
    return fleet.api_max_instances * (DEFAULT_POOL_SIZE + DEFAULT_MAX_OVERFLOW) + count * (
        fleet.worker_pool_size + fleet.worker_max_overflow
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


def _instrument_pool(pool: Any) -> None:
    """Measure the public pool acquisition call without adding request labels.

    SQLAlchemy exposes ``checkout``/``checkin`` events, but no public
    ``before_checkout`` event. Wrapping ``Pool.connect`` is the narrowest
    supported boundary available to the current async engine: it covers queue
    wait and physical connection creation, records SQLAlchemy pool timeouts,
    and leaves the exception and connection lifecycle untouched. The metric is
    therefore deliberately named and documented as acquisition time rather
    than pretending it is queue wait alone.
    """
    original_connect = pool.connect

    @functools.wraps(original_connect)
    def _connect():
        started = time.monotonic()
        try:
            return original_connect()
        except SQLAlchemyTimeoutError:
            _checkout_timeouts.add(1)
            raise
        finally:
            _checkout_wait.record(max(0.0, time.monotonic() - started))

    # Pool.connect is a zero-argument bound method. Assigning this wrapper to
    # the pool instance preserves that call shape while avoiding a private
    # QueuePool subclass that would be coupled to SQLAlchemy's async internals.
    setattr(pool, "connect", _connect)


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
        pool_timeout=DEFAULT_POOL_TIMEOUT_S,
        # libpq connection parameter, forwarded by the psycopg dialect. Costs
        # nothing per connection and is the only thing that makes a backend
        # attributable to a service.
        connect_args={"application_name": _application_name()},
    )
    _instrument_pool(engine.sync_engine.pool)
    _instrument_engine(engine)
    return engine


def session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)
