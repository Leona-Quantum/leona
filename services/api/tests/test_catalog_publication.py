from majorana_api.catalog_publication import evaluate_publication_readiness


def _ready_kwargs(**overrides):
    kwargs = dict(
        review_state="accepted",
        has_source=True,
        license_decision="approved",
        source_blob_sha256="a" * 64,
        normalized_source_hash="b" * 64,
        authoritative_framework="qiskit",
    )
    kwargs.update(overrides)
    return kwargs


def test_fully_satisfied_state_is_ready_with_no_blockers():
    result = evaluate_publication_readiness(**_ready_kwargs())
    assert result.ready
    assert result.blockers == ()


def test_non_accepted_review_state_blocks():
    result = evaluate_publication_readiness(**_ready_kwargs(review_state="pending_review"))
    assert not result.ready
    assert any("review_state" in b for b in result.blockers)


def test_missing_source_blocks():
    result = evaluate_publication_readiness(**_ready_kwargs(has_source=False))
    assert not result.ready
    assert any("artifact_sources" in b for b in result.blockers)


def test_unapproved_license_blocks():
    for decision in (None, "pending", "quarantined", "rejected"):
        result = evaluate_publication_readiness(**_ready_kwargs(license_decision=decision))
        assert not result.ready
        assert any("license" in b for b in result.blockers)


def test_missing_hashes_or_framework_block():
    result = evaluate_publication_readiness(
        **_ready_kwargs(
            source_blob_sha256=None, normalized_source_hash=None, authoritative_framework=None
        )
    )
    assert not result.ready
    assert len(result.blockers) == 3


def test_multiple_blockers_all_reported_at_once():
    result = evaluate_publication_readiness(
        review_state="draft",
        has_source=False,
        license_decision=None,
        source_blob_sha256=None,
        normalized_source_hash=None,
        authoritative_framework=None,
    )
    assert not result.ready
    assert len(result.blockers) == 6
