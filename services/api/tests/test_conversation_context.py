from types import SimpleNamespace

from majorana_api.repos.runs import (
    _CONVERSATION_ASSISTANT_MAX_TOKENS,
    _CONVERSATION_HISTORY_MAX_TOKENS,
    _CONVERSATION_USER_MAX_TOKENS,
    _bounded_conversation_history,
    _conversation_assistant_text,
    _estimated_tokens,
)

#: The ceiling these tests defend, written as a literal on purpose.
#:
#: Chat is unmetered — no weekly allowance, no submission backstop, no usage
#: ledger (see test_run_execute_backstop.py). Nothing downstream refuses an
#: expensive chat turn, so this number is the only thing standing between a long
#: conversation and an unbounded per-turn provider bill. Asserting against
#: `_CONVERSATION_HISTORY_MAX_TOKENS` alone would pass just as happily if that
#: constant were retuned to a million, which is exactly the change this file
#: exists to fail on. Raising this literal must be a deliberate, reviewed edit.
ABSOLUTE_HISTORY_CEILING_TOKENS = 8_000


def _event(event_type: str, **payload):
    return SimpleNamespace(type=event_type, payload=payload)


def _history_tokens(messages: list[dict[str, str]]) -> int:
    return sum(_estimated_tokens(message["content"]) for message in messages)


def _history_chars(messages: list[dict[str, str]]) -> int:
    """Measure the result without using the estimator that produced it.

    `_history_tokens` is the honest unit, but it is also the code under test:
    an estimator that undercounts would agree with itself and every budget
    assertion would still pass. Characters are the independent yardstick —
    ASCII bottoms out near four per token, CJK near one — so a character
    ceiling catches an estimate that has drifted from what a provider charges.
    """
    return sum(len(message["content"]) for message in messages)


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
    assert messages[1]["content"].startswith("y" * 1_000)
    assert "old question" not in [message["content"] for message in messages]


def test_history_never_exceeds_the_ceiling_however_long_the_conversation_runs():
    """The bound, not the fact that something was truncated.

    Every input here is far past every per-turn share: 400 turns, each with a
    max-length prompt and half a megabyte of assistant text. Chat is unmetered,
    so the only acceptable answer is a request sized by the budget rather than
    by the conversation.
    """
    turns = [(f"{index} " + "q" * 20_000, "a" * 500_000) for index in range(400)]

    messages = _bounded_conversation_history(turns)

    assert _history_tokens(messages) <= ABSOLUTE_HISTORY_CEILING_TOKENS
    # ASCII tokenizes at ~4 chars/token at best, so this is the same ceiling
    # measured without the estimator.
    assert _history_chars(messages) <= ABSOLUTE_HISTORY_CEILING_TOKENS * 4


def test_history_ceiling_does_not_grow_with_conversation_length():
    """Twenty times the turns must not buy twenty times the request."""
    turn = ("explain this", "a" * 100_000)

    short = _history_tokens(_bounded_conversation_history([turn] * 2))
    long = _history_tokens(_bounded_conversation_history([turn] * 400))

    assert long == short
    assert long <= ABSOLUTE_HISTORY_CEILING_TOKENS


def test_the_token_estimate_does_not_undercount_cjk():
    """The rate the whole budget rests on, pinned directly.

    A flat four-characters-per-token estimate is right for ASCII and wrong by
    about 4x for Japanese. Every ceiling in this file is computed with
    `_estimated_tokens`, so an estimator that undercounts would keep them all
    green while the real provider bill quadrupled.
    """
    assert _estimated_tokens("a" * 4_000) == 1_000
    assert _estimated_tokens("あ" * 4_000) == 4_000
    assert _estimated_tokens("あ" * 100 + "a" * 400) == 200


def test_a_japanese_conversation_is_not_four_times_more_expensive():
    """The follow-up this history exists for ("これを解説して") is Japanese.

    Asserted in characters, not estimated tokens: CJK costs roughly one token
    per character, so a Japanese history that stays inside the token ceiling
    must also stay inside roughly that many characters. A character-priced
    budget — or a CJK-blind estimate — lets it run about four times longer, and
    that is what this catches.
    """
    japanese = _bounded_conversation_history([("これを解説して", "あ" * 500_000)] * 50)
    english = _bounded_conversation_history([("explain this", "a" * 500_000)] * 50)

    assert _history_chars(japanese) <= ABSOLUTE_HISTORY_CEILING_TOKENS
    assert _history_chars(english) <= ABSOLUTE_HISTORY_CEILING_TOKENS * 4
    assert _history_tokens(japanese) <= ABSOLUTE_HISTORY_CEILING_TOKENS
    assert _history_tokens(english) <= ABSOLUTE_HISTORY_CEILING_TOKENS


def test_one_clamped_turn_always_fits_so_the_newest_turn_survives():
    """The structural reason `_bounded_conversation_history` cannot return [].

    If the per-turn shares ever summed past the total, a single large newest
    turn would be dropped and "explain this code" would lose its referent.
    """
    assert (
        _CONVERSATION_USER_MAX_TOKENS + _CONVERSATION_ASSISTANT_MAX_TOKENS
        <= _CONVERSATION_HISTORY_MAX_TOKENS
    )
    assert _CONVERSATION_HISTORY_MAX_TOKENS <= ABSOLUTE_HISTORY_CEILING_TOKENS

    messages = _bounded_conversation_history([("q" * 20_000, "a" * 500_000)])

    assert [message["role"] for message in messages] == ["user", "assistant"]
    assert _history_tokens(messages) <= ABSOLUTE_HISTORY_CEILING_TOKENS


def test_truncated_history_is_marked_so_the_model_does_not_read_it_as_complete():
    messages = _bounded_conversation_history([("q", "a" * 500_000)])

    assert messages[1]["content"].endswith("[Earlier output truncated for conversation context]")


def test_execute_context_for_one_turn_stays_inside_its_per_turn_share():
    """A single stored run must not be able to spend the whole budget."""
    context = _conversation_assistant_text(
        [
            _event("plan.produced", plan={"algorithm": "VQE", "notes": "n" * 200_000}),
            _event("code.finalized", language="qiskit", code="c" * 400_000, revision=2),
            _event("sandbox.result", result={"counts": "r" * 200_000}),
            _event("run.analysis", interpretation="i" * 200_000),
            _event("run.finished", status="succeeded", verification_summary="v" * 200_000),
        ]
    )

    assert context is not None
    assert _estimated_tokens(context) <= _CONVERSATION_ASSISTANT_MAX_TOKENS
