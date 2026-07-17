import pytest
from majorana_contracts import (
    IllegalReviewTransition,
    IllegalTransition,
    assert_review_transition,
    assert_transition,
    is_terminal,
)
from majorana_contracts.enums import ReviewState, RunStatus


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
