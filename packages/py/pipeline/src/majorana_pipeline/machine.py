"""Run state machine — the orchestrator owns every transition; the LLM never does
(08-phases.md §Phase 2 step 1). Pure functions over contracts enums so both the
API (cancel) and the worker (execute) enforce the same legality table.
"""

from majorana_contracts.enums import RunStatus, Stage

# Execution order is the Stage enum's declaration order (contracts is the truth).
STAGE_ORDER: tuple[Stage, ...] = tuple(Stage)

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


def next_stage(stage: Stage) -> Stage | None:
    """The stage after `stage`, or None when `stage` is the last (SAVE)."""
    i = STAGE_ORDER.index(stage)
    return STAGE_ORDER[i + 1] if i + 1 < len(STAGE_ORDER) else None
