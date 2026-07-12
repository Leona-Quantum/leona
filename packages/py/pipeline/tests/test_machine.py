import pytest
from majorana_contracts.enums import RunStatus, Stage
from majorana_pipeline import (
    STAGE_ORDER,
    IllegalTransition,
    assert_transition,
    is_terminal,
    next_stage,
)


def test_stage_order_matches_contracts_declaration():
    assert STAGE_ORDER == (
        Stage.PLAN,
        Stage.GENERATE,
        Stage.SCREEN,
        Stage.RESOURCE_ESTIMATE,
        Stage.VERIFY,
        Stage.COMPILE,
        Stage.COMPILED_RESOURCE_ESTIMATE,
        Stage.FINALIZE,
        Stage.FINAL_EXECUTE,
        Stage.BASELINE,
        Stage.ANALYZE,
        Stage.SAVE,
    )


def test_next_stage_walks_the_order_and_ends():
    walked = [Stage.PLAN]
    while (nxt := next_stage(walked[-1])) is not None:
        walked.append(nxt)
    assert tuple(walked) == STAGE_ORDER


@pytest.mark.parametrize(
    "current,new",
    [
        (RunStatus.QUEUED, RunStatus.RUNNING),
        (RunStatus.QUEUED, RunStatus.CANCELLED),
        (RunStatus.RUNNING, RunStatus.SUCCEEDED),
        (RunStatus.RUNNING, RunStatus.FAILED),
        (RunStatus.RUNNING, RunStatus.CANCELLED),
    ],
)
def test_legal_transitions(current, new):
    assert_transition(current, new)


@pytest.mark.parametrize(
    "current,new",
    [
        (RunStatus.QUEUED, RunStatus.SUCCEEDED),  # must pass through RUNNING
        (RunStatus.QUEUED, RunStatus.FAILED),
        (RunStatus.RUNNING, RunStatus.QUEUED),
        (RunStatus.SUCCEEDED, RunStatus.RUNNING),  # terminal states are frozen
        (RunStatus.FAILED, RunStatus.QUEUED),
        (RunStatus.CANCELLED, RunStatus.RUNNING),
    ],
)
def test_illegal_transitions_raise(current, new):
    with pytest.raises(IllegalTransition):
        assert_transition(current, new)


def test_terminal_statuses():
    assert all(is_terminal(s) for s in (RunStatus.SUCCEEDED, RunStatus.FAILED, RunStatus.CANCELLED))
    assert not is_terminal(RunStatus.QUEUED)
    assert not is_terminal(RunStatus.RUNNING)
