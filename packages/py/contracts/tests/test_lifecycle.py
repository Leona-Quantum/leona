import pytest
from majorana_contracts import (
    IMPORT_ITEM_TERMINAL_STATES,
    IllegalImportItemTransition,
    IllegalPublicationTransition,
    IllegalReviewTransition,
    IllegalTransition,
    assert_import_item_transition,
    assert_publication_transition,
    assert_review_transition,
    assert_transition,
    is_terminal,
)
from majorana_contracts.enums import (
    ImportItemState,
    PublicationState,
    ReviewState,
    RunStatus,
)


def test_run_lifecycle_allows_execution_and_cancel_paths():
    assert_transition(RunStatus.QUEUED, RunStatus.RUNNING)
    assert_transition(RunStatus.QUEUED, RunStatus.CANCELLED)
    assert_transition(RunStatus.RUNNING, RunStatus.SUCCEEDED)
    assert_transition(RunStatus.RUNNING, RunStatus.FAILED)
    assert_transition(RunStatus.RUNNING, RunStatus.CANCELLED)


def test_terminal_runs_cannot_transition():
    for status in (RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED):
        assert is_terminal(status)
        with pytest.raises(IllegalTransition):
            assert_transition(status, RunStatus.RUNNING)


def test_review_lifecycle_allows_submit_and_decide_paths():
    assert_review_transition(ReviewState.DRAFT, ReviewState.PENDING_REVIEW)
    assert_review_transition(ReviewState.PENDING_REVIEW, ReviewState.ACCEPTED)
    assert_review_transition(ReviewState.PENDING_REVIEW, ReviewState.REJECTED)
    assert_review_transition(ReviewState.QUARANTINED, ReviewState.ACCEPTED)
    assert_review_transition(ReviewState.QUARANTINED, ReviewState.REJECTED)


def test_draft_cannot_skip_straight_to_a_decision():
    with pytest.raises(IllegalReviewTransition):
        assert_review_transition(ReviewState.DRAFT, ReviewState.ACCEPTED)


def test_terminal_review_states_cannot_transition():
    for state in (ReviewState.ACCEPTED, ReviewState.REJECTED):
        with pytest.raises(IllegalReviewTransition):
            assert_review_transition(state, ReviewState.PENDING_REVIEW)


def test_publication_lifecycle_allows_review_to_public_and_takedown():
    assert_publication_transition(PublicationState.PRIVATE, PublicationState.PUBLIC)
    assert_publication_transition(PublicationState.PRIVATE, PublicationState.STAGED)
    assert_publication_transition(PublicationState.STAGED, PublicationState.PUBLIC)
    assert_publication_transition(PublicationState.PUBLIC, PublicationState.RETRACTED)
    assert_publication_transition(PublicationState.PUBLIC, PublicationState.DEPRECATED)
    assert_publication_transition(PublicationState.DEPRECATED, PublicationState.PUBLIC)


def test_retracted_records_cannot_silently_republish():
    """A takedown is final for that record: restoring it requires a fresh
    accepted version, not a state flip."""
    for target in (
        PublicationState.PUBLIC,
        PublicationState.STAGED,
        PublicationState.PRIVATE,
        PublicationState.DEPRECATED,
    ):
        with pytest.raises(IllegalPublicationTransition):
            assert_publication_transition(PublicationState.RETRACTED, target)


def test_public_records_cannot_regress_to_unpublished_states():
    for target in (PublicationState.PRIVATE, PublicationState.STAGED):
        with pytest.raises(IllegalPublicationTransition):
            assert_publication_transition(PublicationState.PUBLIC, target)


def test_import_item_lifecycle_allows_the_happy_path():
    assert_import_item_transition(ImportItemState.QUEUED, ImportItemState.FETCHING)
    assert_import_item_transition(ImportItemState.FETCHING, ImportItemState.QUARANTINED)
    assert_import_item_transition(ImportItemState.QUARANTINED, ImportItemState.PARSING)
    assert_import_item_transition(ImportItemState.PARSING, ImportItemState.STAGED)


def test_import_item_lifecycle_allows_rejection_from_fetch_and_parse():
    assert_import_item_transition(ImportItemState.FETCHING, ImportItemState.REJECTED)
    assert_import_item_transition(ImportItemState.PARSING, ImportItemState.REJECTED)


def test_import_item_lifecycle_allows_bounded_retry():
    assert_import_item_transition(ImportItemState.FETCHING, ImportItemState.RETRY_WAIT)
    assert_import_item_transition(ImportItemState.RETRY_WAIT, ImportItemState.QUEUED)
    assert_import_item_transition(ImportItemState.RETRY_WAIT, ImportItemState.DEAD)


def test_import_item_cannot_skip_quarantine_or_parsing():
    with pytest.raises(IllegalImportItemTransition):
        assert_import_item_transition(ImportItemState.QUEUED, ImportItemState.STAGED)
    with pytest.raises(IllegalImportItemTransition):
        assert_import_item_transition(ImportItemState.FETCHING, ImportItemState.STAGED)


def test_import_item_terminal_states_cannot_transition():
    for state in IMPORT_ITEM_TERMINAL_STATES:
        with pytest.raises(IllegalImportItemTransition):
            assert_import_item_transition(state, ImportItemState.QUEUED)
