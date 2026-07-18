"""DB-free unit tests for the local/file fixture provider (Step 5a)."""

from pathlib import Path

import pytest

from majorana_api.catalog_hashing import hash_source_blob
from majorana_api.catalog_import_fixtures import (
    MAX_FIXTURE_BYTES,
    MAX_FIXTURE_COUNT,
    FixtureTooLargeError,
    TooManyFixturesError,
    list_fixture_identities,
    read_fixture_bytes,
)

FIXTURES_ROOT = Path(__file__).parent / "fixtures" / "catalog_import"


def test_list_fixture_identities_returns_flat_file_list():
    identities = list_fixture_identities(FIXTURES_ROOT / "valid_set")
    names = {i.upstream_identity for i in identities}
    assert names == {"bell_state.py", "ghz_state.py"}


def test_list_fixture_identities_missing_directory_raises():
    with pytest.raises(FileNotFoundError):
        list_fixture_identities(FIXTURES_ROOT / "does_not_exist")


def test_read_fixture_bytes_deterministic_and_matches_hash():
    path = FIXTURES_ROOT / "valid_set" / "bell_state.py"
    raw_first = read_fixture_bytes(path)
    raw_second = read_fixture_bytes(path)
    assert raw_first == raw_second
    assert hash_source_blob(raw_first) == hash_source_blob(raw_second)


def test_read_fixture_bytes_rejects_oversized_content():
    path = FIXTURES_ROOT / "adversarial_set" / "oversized.py"
    assert path.stat().st_size > MAX_FIXTURE_BYTES
    with pytest.raises(FixtureTooLargeError):
        read_fixture_bytes(path)


def test_read_fixture_bytes_reads_empty_file():
    path = FIXTURES_ROOT / "adversarial_set" / "empty.py"
    assert read_fixture_bytes(path) == b""


def test_duplicate_pair_fixtures_hash_identically():
    original = read_fixture_bytes(FIXTURES_ROOT / "duplicate_pair" / "bell_state_original.py")
    copy = read_fixture_bytes(FIXTURES_ROOT / "duplicate_pair" / "bell_state_copy.py")
    assert original == copy
    assert hash_source_blob(original) == hash_source_blob(copy)


def test_too_many_fixtures_raises(tmp_path):
    for i in range(MAX_FIXTURE_COUNT + 1):
        (tmp_path / f"f{i}.py").write_text("x")
    with pytest.raises(TooManyFixturesError):
        list_fixture_identities(tmp_path)


def test_symlink_fixtures_are_excluded(tmp_path):
    real = tmp_path / "real.py"
    real.write_text("x")
    (tmp_path / "link.py").symlink_to(real)
    identities = list_fixture_identities(tmp_path)
    assert {i.upstream_identity for i in identities} == {"real.py"}
