"""Explicit job failure classification for bounded queue retries."""

from psycopg import OperationalError as _PsycopgOperationalError
from sqlalchemy.exc import DBAPIError
from sqlalchemy.exc import OperationalError as _SAOperationalError


class RetryableJobError(RuntimeError):
    """A transient infrastructure failure that may safely retry the durable job."""


#: Exception types worth inspecting for a transient database failure. Deliberately
#: broad — `DBAPIError` also covers `IntegrityError` and `ProgrammingError`, which
#: are NOT transient — so a caller must still narrow with `is_retryable_db_error`
#: before deciding to retry; this tuple only says which exceptions to look at.
DB_ERROR_TYPES = (DBAPIError, _PsycopgOperationalError)


def is_retryable_db_error(exc: BaseException) -> bool:
    """True for a database failure a retry may resolve: a dropped or
    admin-terminated connection, a statement timeout, a pool checkout that hit
    the wire mid-commit. False for an integrity, programming, or data error —
    a retry returns the identical failure for those, so they must stay permanent.

    The `postgresql+psycopg` dialect (majorana_api.db) wraps driver failures at
    both execution and connect time into SQLAlchemy's own hierarchy, so
    `sqlalchemy.exc.OperationalError` alone catches nearly every real case.
    `DBAPIError.connection_invalidated` and the raw psycopg `OperationalError`
    are checked directly for the narrower path where the driver exception is
    observed before SQLAlchemy finishes wrapping it (e.g. a pool-level connect
    failure).
    """
    if isinstance(exc, _SAOperationalError):
        return True
    if isinstance(exc, DBAPIError) and exc.connection_invalidated:
        return True
    if isinstance(exc, _PsycopgOperationalError):
        return True
    return False
