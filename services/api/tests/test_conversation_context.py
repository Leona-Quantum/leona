from types import SimpleNamespace

from majorana_api.repos.runs import (
    _bounded_conversation_history,
    _conversation_assistant_text,
)


def _event(event_type: str, **payload):
    return SimpleNamespace(type=event_type, payload=payload)


def test_completed_execute_turn_carries_exact_code_and_observed_result():
    events = [
        _event(
            "plan.produced",
            plan={"algorithm": "VQE", "algorithm_rationale": "Estimate the minimum energy."},
        ),
        _event("code.generated", language="qiskit", code="OLD = True", revision=1),
        _event("code.finalized", language="qiskit", code="FINAL = -1.137", revision=2),
        _event(
            "sandbox.result",
            result={"energy": -1.137, "parameters": [0.1, -0.2]},
            stdout="must not enter model history",
            stderr="also excluded",
        ),
        _event(
            "run.finished",
            status="succeeded",
            verifier_decision="pass",
            evidence_strength="physical",
        ),
    ]

    context = _conversation_assistant_text(events)

    assert context is not None
    assert "Prior Execute output" in context
    assert "FINAL = -1.137" in context
    assert "OLD = True" not in context
    assert '"energy": -1.137' in context
    assert '"algorithm": "VQE"' in context
    assert '"verifier_decision": "pass"' in context
    assert "must not enter model history" not in context
    assert "also excluded" not in context


def test_terminal_best_effort_code_and_limit_are_available_to_followups():
    context = _conversation_assistant_text(
        [
            _event(
                "run.best_effort",
                language="cirq",
                code="best_candidate = circuit",
                revision=4,
                failed_checks=["success_criteria"],
                critic_summary="The reported value missed the declared tolerance.",
            ),
            _event("run.finished", status="failed", reason_code="candidate_budget_exhausted"),
        ]
    )

    assert context is not None
    assert "best_candidate = circuit" in context
    assert "success_criteria" in context
    assert "candidate_budget_exhausted" in context


def test_inflight_generated_code_is_not_invented_as_a_completed_reply():
    assert (
        _conversation_assistant_text(
            [_event("code.generated", language="qiskit", code="unfinished = True", revision=1)]
        )
        is None
    )


def test_chat_reply_remains_verbatim_instead_of_becoming_execute_context():
    assert (
        _conversation_assistant_text(
            [
                _event("chat.completed", text="This is the explanation."),
                _event("run.finished", status="succeeded"),
            ]
        )
        == "This is the explanation."
    )


def test_history_budget_keeps_the_newest_complete_turns():
    oldest = ("old question", "x" * 70_000)
    newest = ("new question", "y" * 70_000)

    messages = _bounded_conversation_history([oldest, newest])

    assert messages[0] == {"role": "user", "content": "new question"}
    assert messages[1]["role"] == "assistant"
    assert messages[1]["content"] == newest[1]
