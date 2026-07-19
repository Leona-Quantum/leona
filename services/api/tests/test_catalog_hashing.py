from majorana_api.catalog_hashing import hash_normalized_source, hash_source_blob


def test_hash_source_blob_is_deterministic():
    assert hash_source_blob(b"qc.h(0)\n") == hash_source_blob(b"qc.h(0)\n")


def test_hash_source_blob_distinguishes_different_bytes():
    assert hash_source_blob(b"qc.h(0)\n") != hash_source_blob(b"qc.h(1)\n")


def test_hash_normalized_source_is_deterministic():
    assert hash_normalized_source("qc.h(0)") == hash_normalized_source("qc.h(0)")


def test_hash_normalized_source_distinguishes_different_text():
    assert hash_normalized_source("qc.h(0)") != hash_normalized_source("qc.h(1)")


def test_hashes_are_sha256_hex_digests():
    digest = hash_source_blob(b"x")
    assert len(digest) == 64
    assert all(c in "0123456789abcdef" for c in digest)
