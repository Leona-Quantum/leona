"""Import-source abstraction for the durable catalog importer (repos/catalog_import.py).

An ImportSource is the *only* thing that varies between import providers: how the
set of items is enumerated, how one item's raw bytes are obtained, and the
provider-identifying descriptor persisted on the queue job (used both to let the
worker reconstruct the source after a crash and to detect an idempotency-key
reuse that names a materially different request).

Everything downstream of a source — the durable state machine, per-item
commit/rollback, staging, retry/dead-letter — is provider-agnostic and lives in
repos/catalog_import.py. Adding a provider therefore never touches that
crash-safe core; it only adds a new source here (closed allowlist, ImportProvider
enum: a source ships only once its adversarial tests pass).

This module is pure (no DB, no network, no clock): sources read either a
codebase-pinned local directory or a codebase-pinned, content-hashed manifest —
never a path or URL derived from untrusted input.
"""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from majorana_contracts.enums import ImportProvider


class SourceItemRejected(Exception):
    """A single item is deterministically unacceptable (never retried).

    Carries a stable failure_code that the importer records verbatim on the
    rejected item, so the reason an item was dropped is auditable. Raised by
    ImportSource.read_bytes for content-level problems the source can detect
    without staging (oversized, unreadable, hash mismatch); the importer maps
    it to the same non-retryable rejection path as its own parse-stage checks.
    """

    def __init__(self, failure_code: str):
        super().__init__(failure_code)
        self.failure_code = failure_code


@runtime_checkable
class ImportSource(Protocol):
    """Where a batch's items and their bytes come from.

    provider / upstream_ref are recorded on the ImportJob row. descriptor() is
    persisted inside the queue-job payload (alongside the idempotency key) so a
    worker can rebuild the exact source after a crash and so a reused
    idempotency key that names a different request is rejected loudly rather
    than silently returning the earlier batch.
    """

    @property
    def provider(self) -> ImportProvider: ...

    @property
    def upstream_ref(self) -> str: ...

    def identities(self) -> list[str]:
        """Stable, de-duplicated, deterministically-ordered upstream identities.

        Called once at batch creation to materialize one ImportItem per entry;
        the ordering must not change across repeated runs of the same input, or
        crash-resume would re-key items.
        """
        ...

    def read_bytes(self, upstream_identity: str) -> bytes:
        """Raw source bytes for one item.

        Raises SourceItemRejected(failure_code) for a deterministic,
        non-retryable content problem. Any other exception is treated by the
        importer as transient (bounded item-level retry), so only raise those
        for genuinely transient conditions.
        """
        ...

    def descriptor(self) -> dict[str, str]:
        """Provider-identifying fields persisted in the queue-job payload.

        Must be JSON-serializable and stable for a given logical request. Two
        sources with the same descriptor (and same provider/upstream_ref)
        describe the same import; a mismatch under a reused idempotency key is
        an IdempotencyConflictError.
        """
        ...
