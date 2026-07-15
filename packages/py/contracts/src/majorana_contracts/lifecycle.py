"""Legal top-level run status transitions shared by API and worker."""

from majorana_contracts.enums import RunStatus

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
