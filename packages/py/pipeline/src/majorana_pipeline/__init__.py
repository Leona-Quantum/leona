"""majorana-pipeline: run state machine + stage executor (ADR-0007/0008).
The orchestrator owns transitions; stages are pluggable handlers; every step
is an appended RunEvent. Pure package — persistence stays behind protocols.
"""

from .executor import (
    EventSink,
    RunContext,
    RunStateStore,
    StageHandler,
    StageOutcome,
    default_handlers,
    execute_run,
)
from .machine import (
    STAGE_ORDER,
    TERMINAL_STATUSES,
    IllegalTransition,
    assert_transition,
    is_terminal,
    next_stage,
)

__all__ = [
    "STAGE_ORDER",
    "TERMINAL_STATUSES",
    "EventSink",
    "IllegalTransition",
    "RunContext",
    "RunStateStore",
    "StageHandler",
    "StageOutcome",
    "assert_transition",
    "default_handlers",
    "execute_run",
    "is_terminal",
    "next_stage",
]
