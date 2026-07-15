import pytest
from majorana_contracts import IllegalTransition, assert_transition, is_terminal
from majorana_contracts.enums import RunStatus


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
