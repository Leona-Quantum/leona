"""Deterministic content hashes for the catalog staging boundary.

Three hash meanings must never be conflated (repository Step 3 plan §5.1):
source_blob_sha256 is the exact retrieved bytes; normalized_source_hash is
computed over caller-normalized text so semantically identical source with
incidental formatting differences still collides for duplicate rejection.
Both are plain sha256 hex digests so the database CHECK constraints in
migration 0014 can validate their shape without knowing which field they
guard.
"""

import hashlib


def hash_source_blob(raw_source: bytes) -> str:
    return hashlib.sha256(raw_source).hexdigest()


def hash_normalized_source(normalized_source: str) -> str:
    return hashlib.sha256(normalized_source.encode("utf-8")).hexdigest()
