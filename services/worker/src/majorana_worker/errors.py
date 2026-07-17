"""Explicit job failure classification for bounded queue retries."""


class RetryableJobError(RuntimeError):
    """A transient infrastructure failure that may safely retry the durable job."""
