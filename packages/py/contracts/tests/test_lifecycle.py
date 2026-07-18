import pytest
from majorana_contracts import (
    IllegalImportItemTransition,
    IllegalReviewTransition,
    IllegalTransition,
    assert_import_item_transition,
    assert_review_transition,
    assert_transition,
    is_terminal,
)
from majorana_contracts.enums import ImportItemState, ReviewState, RunStatus


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
    for state in (ImportItemState.STAGED, ImportItemState.REJECTED, ImportItemState.DEAD):
        with pytest.raises(IllegalImportItemTransition):
            assert_import_item_transition(state, ImportItemState.QUEUED)
