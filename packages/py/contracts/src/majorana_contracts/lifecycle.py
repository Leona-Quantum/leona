"""Legal top-level run status, catalog review-state, and import-item
transitions shared by API and worker."""

from majorana_contracts.enums import ImportItemState, ReviewState, RunStatus

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


# Import item state (repository Step 5a plan §5.3): each item commits or
# rejects independently, so one bad input can't roll back or publish an
# entire batch. retry_wait always returns to queued (bounded retry); dead is
# reached only after max_attempts is exhausted.
_IMPORT_ITEM_LEGAL: dict[ImportItemState, frozenset[ImportItemState]] = {
    ImportItemState.QUEUED: frozenset({ImportItemState.FETCHING}),
    ImportItemState.FETCHING: frozenset(
        {ImportItemState.QUARANTINED, ImportItemState.REJECTED, ImportItemState.RETRY_WAIT}
    ),
    ImportItemState.QUARANTINED: frozenset({ImportItemState.PARSING}),
    ImportItemState.PARSING: frozenset(
        {ImportItemState.STAGED, ImportItemState.REJECTED, ImportItemState.RETRY_WAIT}
    ),
    ImportItemState.RETRY_WAIT: frozenset({ImportItemState.QUEUED, ImportItemState.DEAD}),
    ImportItemState.STAGED: frozenset(),
    ImportItemState.REJECTED: frozenset(),
    ImportItemState.DEAD: frozenset(),
}


class IllegalImportItemTransition(Exception):
    def __init__(self, current: ImportItemState, new: ImportItemState) -> None:
        super().__init__(f"illegal import item transition {current} -> {new}")
        self.current = current
        self.new = new


def assert_import_item_transition(current: ImportItemState, new: ImportItemState) -> None:
    if new not in _IMPORT_ITEM_LEGAL[current]:
        raise IllegalImportItemTransition(current, new)


IMPORT_ITEM_TERMINAL_STATES: frozenset[ImportItemState] = frozenset(
    {ImportItemState.STAGED, ImportItemState.REJECTED, ImportItemState.DEAD}
)
