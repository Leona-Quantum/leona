"""Legal top-level run status and catalog review-state transitions shared by
API and worker."""

from majorana_contracts.enums import ReviewState, RunStatus

_LEGAL: dict[RunStatus, frozenset[RunStatus]] = {
    RunStatus.QUEUED: frozenset({RunStatus.RUNNING, RunStatus.CANCELLED}),
    RunStatus.RUNNING: frozenset({RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}),
    RunStatus.SUCCEEDED: frozenset(),
    RunStatus.FAILED: frozenset(),
    RunStatus.CANCELLED: frozenset(),
}

TERMINAL_STATUSES: frozenset[RunStatus] = frozenset(
    {RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED}
)


class IllegalTransition(Exception):
    def __init__(self, current: RunStatus, new: RunStatus) -> None:
        super().__init__(f"illegal run transition {current} -> {new}")
        self.current = current
        self.new = new


def assert_transition(current: RunStatus, new: RunStatus) -> None:
    if new not in _LEGAL[current]:
        raise IllegalTransition(current, new)


def is_terminal(status: RunStatus) -> bool:
    return status in TERMINAL_STATUSES


# Catalog review state (repository Step 4 plan §5.3): quarantine is reached
# automatically (repos/catalog.py record_license_assertion), not through this
# table — it only governs the importer's submit and the reviewer's decision.
_REVIEW_LEGAL: dict[ReviewState, frozenset[ReviewState]] = {
    ReviewState.DRAFT: frozenset({ReviewState.PENDING_REVIEW}),
    ReviewState.PENDING_REVIEW: frozenset({ReviewState.ACCEPTED, ReviewState.REJECTED}),
    ReviewState.QUARANTINED: frozenset({ReviewState.ACCEPTED, ReviewState.REJECTED}),
    ReviewState.ACCEPTED: frozenset(),
    ReviewState.REJECTED: frozenset(),
}


class IllegalReviewTransition(Exception):
    def __init__(self, current: ReviewState, new: ReviewState) -> None:
        super().__init__(f"illegal review transition {current} -> {new}")
        self.current = current
        self.new = new


def assert_review_transition(current: ReviewState, new: ReviewState) -> None:
    if new not in _REVIEW_LEGAL[current]:
        raise IllegalReviewTransition(current, new)
