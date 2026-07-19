"""Controlled local/file fixture provider for the Step 5a import pipeline.

Reads bytes only from a caller-provided directory of files the codebase
itself pins — never a path derived from untrusted network input. This
proves the durable import state machine (repos/catalog_import.py) without
any network fetch, SSRF surface, or externally-controlled content. A real
network adapter (bootstrap manifest, MQT Bench, QASMBench) is a separate,
explicitly scoped later slice that will need its own SSRF/quarantine
hardening (repository Step 5 plan §7.1) — nothing here is reachable from
the network.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

from majorana_contracts.enums import ImportProvider

from .catalog_import_sources import SourceItemRejected

MAX_FIXTURE_BYTES = 64 * 1024  # generous for source code, tiny for an archive bomb
MAX_FIXTURE_COUNT = 200


class FixtureTooLargeError(ValueError):
    def __init__(self, path: Path, size: int):
        super().__init__(f"fixture {path} is {size} bytes, exceeds {MAX_FIXTURE_BYTES}")
        self.path = path
        self.size = size


class TooManyFixturesError(ValueError):
    def __init__(self, directory: Path, count: int):
        super().__init__(f"{directory} contains {count} files, exceeds {MAX_FIXTURE_COUNT}")
        self.directory = directory
        self.count = count


@dataclasses.dataclass(frozen=True)
class FixtureIdentity:
    upstream_identity: str  # relative filename; stable across repeated runs
    path: Path


def list_fixture_identities(fixtures_dir: Path) -> list[FixtureIdentity]:
    """List regular files directly under fixtures_dir.

    No recursion and symlinks are rejected: a fixture set is a flat,
    codebase-pinned directory, not attacker-controlled input.
    """
    if not fixtures_dir.is_dir():
        raise FileNotFoundError(fixtures_dir)
    entries = sorted(p for p in fixtures_dir.iterdir() if p.is_file() and not p.is_symlink())
    if len(entries) > MAX_FIXTURE_COUNT:
        raise TooManyFixturesError(fixtures_dir, len(entries))
    return [FixtureIdentity(upstream_identity=p.name, path=p) for p in entries]


def read_fixture_bytes(path: Path) -> bytes:
    """Read one fixture file, bounded by MAX_FIXTURE_BYTES.

    Fails closed on oversized content rather than buffering an unbounded
    read: the stat-then-read-with-limit sequence still bounds worst-case
    memory even if the file grows between the two calls.
    """
    if path.is_symlink():
        raise FixtureTooLargeError(path, -1)
    size = path.stat().st_size
    if size > MAX_FIXTURE_BYTES:
        raise FixtureTooLargeError(path, size)
    with path.open("rb") as fh:
        raw = fh.read(MAX_FIXTURE_BYTES + 1)
    if len(raw) > MAX_FIXTURE_BYTES:
        raise FixtureTooLargeError(path, len(raw))
    return raw


class LocalFixtureSource:
    """ImportSource over a codebase-pinned flat directory of fixture files.

    The original (and only Step 5a) provider: proves the durable import state
    machine with no network and no externally-controlled path. read_bytes maps
    the fixture-reader's deterministic failures to the same stable failure
    codes the importer has always recorded, so this refactor is behavior-
    preserving for existing batches.
    """

    provider = ImportProvider.LOCAL_FIXTURE

    def __init__(self, fixtures_dir: Path, *, upstream_ref: str):
        self._dir = fixtures_dir
        self._upstream_ref = upstream_ref

    @property
    def upstream_ref(self) -> str:
        return self._upstream_ref

    def identities(self) -> list[str]:
        return [fi.upstream_identity for fi in list_fixture_identities(self._dir)]

    def read_bytes(self, upstream_identity: str) -> bytes:
        try:
            return read_fixture_bytes(self._dir / upstream_identity)
        except FixtureTooLargeError:
            raise SourceItemRejected("oversized") from None
        except (FileNotFoundError, OSError):
            raise SourceItemRejected("unreadable") from None

    def descriptor(self) -> dict[str, str]:
        return {"fixtures_dir": str(self._dir)}
