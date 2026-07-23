"""A failed agent run must say why it failed.

A production run (2026-07-19) emitted four passing `verification.result`
events and then `run.error: "agent tool loop failed"`. Both facts needed to
diagnose it were thrown away: the runtime discarded the budget it hit, and the
semantic critic's verdict — the only failing signal when every deterministic
check passes — is never emitted as an event at all.
"""

import uuid
from types import SimpleNamespace


from majorana_worker.handlers import _agent_failure_message, _agent_failure_reason_code


class _Store:
    def __init__(self, verification):
        self._verification = verification

    async def latest_candidate(self, run_id):
        return SimpleNamespace(candidate_id=uuid.uuid4())

    async def verification_for(self, run_id, candidate_id):
        return self._verification


def _runtime(reason):
    return SimpleNamespace(failure_reason=reason)


async def test_message_names_the_budget_that_was_exhausted():
    message = await _agent_failure_message(
        _runtime("candidate_budget_exhausted"), _Store(None), uuid.uuid4()
    )
    assert "candidate_budget_exhausted" in message


async def test_critic_objection_is_surfaced_when_every_check_passed():
    """The exact shape of the run that exposed this: all checks pass, critic refuses."""
    verification = SimpleNamespace(
        deterministic_checks=[{"method": "return_contract", "result": "pass"}],
        critic={
            "summary": "result dict does not evidence a Bell state",
            "severity": "major",
            "confidence": "high",
        },
    )
    message = await _agent_failure_message(
        _runtime("candidate_budget_exhausted"), _Store(verification), uuid.uuid4()
    )
    assert "result dict does not evidence a Bell state" in message
    assert "major" in message


async def test_failing_deterministic_checks_are_named_instead():
    verification = SimpleNamespace(
        deterministic_checks=[
            {"method": "return_contract", "result": "pass"},
            {"method": "statistical", "result": "fail"},
        ],
        critic=None,
    )
    message = await _agent_failure_message(_runtime(None), _Store(verification), uuid.uuid4())
    assert "statistical" in message
    assert "return_contract" not in message


async def test_diagnostics_never_mask_the_underlying_failure():
    """A broken store must not turn a failed run into an exception."""

    class _Exploding:
        async def latest_candidate(self, run_id):
            raise RuntimeError("db gone")

    message = await _agent_failure_message(
        _runtime("step_budget_exhausted"), _Exploding(), uuid.uuid4()
    )
    assert "agent tool loop failed" in message
    assert "step_budget_exhausted" in message


def test_terminal_reason_normalizes_replay_anomaly_prose():
    assert _agent_failure_reason_code(_runtime("replayed tool call strict_verify")) == (
        "replayed_tool_call"
    )


def test_terminal_reason_preserves_typed_budget_code():
    assert (
        _agent_failure_reason_code(_runtime("candidate_budget_exhausted"))
        == "candidate_budget_exhausted"
    )
