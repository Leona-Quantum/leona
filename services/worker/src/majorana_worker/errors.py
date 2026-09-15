"""Explicit job failure classification for bounded queue retries."""

# DB_ERROR_TYPES / is_retryable_db_error classify psycopg/sqlalchemy exceptions,
# which only `majorana_api.db` (engine/session factory) may import directly —
# `scripts/check_raw_queries.py` forbids a psycopg or sqlalchemy import anywhere
# else, this module included. Re-exported here rather than imported at each call
# site so `from .errors import ...` stays the one place worker code reaches for
# job-failure classification.
from majorana_api.db import DB_ERROR_TYPES, is_retryable_db_error

__all__ = ["DB_ERROR_TYPES", "RetryableJobError", "is_retryable_db_error"]


class RetryableJobError(RuntimeError):
    """A transient infrastructure failure that may safely retry the durable job."""
