"""Conversation naming: the short name a thread carries in the sidebar.

Two properties are load-bearing and both are asserted here rather than described:
a title never exceeds five words in a space-delimited language, and it is written
in the user's own language rather than translated. The second is a prompt-level
promise, so what is tested here is that whatever the model returns is passed
through unchanged apart from bounding — a normalizer that "cleaned up" a Japanese
title into ASCII would be the defect, not the fix.
"""

import uuid

import pytest
from majorana_contracts.enums import Framework, RunMode, RunStatus
from majorana_llm import LLMResponse
from majorana_worker import handlers
from majorana_worker.context import RunContext
from majorana_worker.handlers import (
    fallback_conversation_title,
    normalize_conversation_title,
)


class _RecordingSink:
    def __init__(self):
        self.events = []

    async def emit(self, event_type, payload, *, event_id=None):
        self.events.append((event_type, payload))


class _FakeStore:
    def __init__(self, status=RunStatus.QUEUED):
        self.status = status

    async def current_status(self):
        return self.status


class _ScriptedLLM:
    def __init__(self, text="Bell state circuit"):
        self._text = text
        self.calls = 0
        self.request = None

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        self.request = request
        return LLMResponse(text=self._text, model=request.model, input_tokens=1, output_tokens=1)


class _BrokenLLM:
    def __init__(self):
        self.calls = 0

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        raise RuntimeError("provider down")


def _ctx(sink, *, prompt="Build a Bell state", conversation_id=None, response_locale="en"):
    return RunContext(
        run_id=uuid.uuid4(),
        task_prompt=prompt,
        mode=RunMode.EXECUTE,
        framework=Framework.QISKIT,
        seed=None,
        shots=None,
        timeout_s=60,
        sink=sink,
        response_locale=response_locale,
        conversation_id=conversation_id,
    )


def _stub_conversation(monkeypatch, earlier):
    async def _list(scope, session, conversation_id, *, exclude_run_id=None):
        return earlier

    monkeypatch.setattr(handlers.runs_repo, "list_conversation_messages", _list)


# --- normalization -----------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Bell state circuit", "Bell state circuit"),
        ('Title: "Bell state circuit"', "Bell state circuit"),
        ("  Bell   state   circuit  ", "Bell state circuit"),
        ("Grover search for 101.", "Grover search for 101"),
        ("「ベル状態の回路」", "ベル状態の回路"),
        ("", None),
        ("   ", None),
    ],
)
def test_normalization_strips_decoration_without_rewriting_the_words(raw, expected):
    assert normalize_conversation_title(raw) == expected


def test_a_title_is_capped_at_five_words():
    title = normalize_conversation_title(
        "Build a 2-qubit Bell state circuit in Qiskit and measure both qubits"
    )
    assert title is not None
    assert len(title.split()) == 5


def test_a_japanese_title_is_bounded_by_characters_not_words():
    # Japanese has no spaces, so the five-word rule cannot bound it; the character
    # cap is what keeps a sidebar row a row. Crucially the text is not romanized,
    # translated, or otherwise rewritten.
    long_japanese = "ベル" * 60
    title = normalize_conversation_title(long_japanese)
    assert title is not None
    assert len(title) == 60
    assert title.startswith("ベル")
    assert title.isascii() is False


def test_the_fallback_is_a_title_not_the_whole_prompt():
    # The failure being fixed is sidebar rows that were paragraphs. A fallback
    # that reinstates them just hides the defect behind a provider outage.
    title = fallback_conversation_title(
        "Build a 2-qubit Bell state circuit in Qiskit and measure both qubits.\nAlso explain it."
    )
    assert title == "Build a 2-qubit Bell state"


# --- the stage ---------------------------------------------------------------


async def test_the_opening_turn_is_named_and_the_name_reaches_the_run(monkeypatch):
    _stub_conversation(monkeypatch, [])
    sink = _RecordingSink()
    llm = _ScriptedLLM("Bell state circuit")

    ctx = await handlers._title_conversation(
        _ctx(sink, conversation_id=uuid.uuid4()),
        _FakeStore(),
        scope=None,
        session=None,
        llm=llm,
    )

    assert ctx.conversation_title == "Bell state circuit"
    assert sink.events == [
        ("conversation.titled", {"title": "Bell state circuit", "source": "model"})
    ]


async def test_title_prompt_follows_japanese_mode_even_for_an_english_request(monkeypatch):
    _stub_conversation(monkeypatch, [])
    sink = _RecordingSink()
    llm = _ScriptedLLM("ベル状態回路")

    ctx = await handlers._title_conversation(
        _ctx(sink, conversation_id=uuid.uuid4(), response_locale="ja"),
        _FakeStore(),
        scope=None,
        session=None,
        llm=llm,
    )

    assert ctx.conversation_title == "ベル状態回路"
    assert "出力言語: 日本語" in llm.request.system


async def test_a_later_turn_computes_a_title_but_never_renames_the_thread(monkeypatch):
    # An artifact saved by turn 7 still needs a short title, so the name is
    # computed. Emitting it would rename the sidebar row mid-conversation, which
    # is the thing a title is supposed to be stable against.
    _stub_conversation(monkeypatch, [{"role": "user", "content": "earlier"}])
    sink = _RecordingSink()

    ctx = await handlers._title_conversation(
        _ctx(sink, conversation_id=uuid.uuid4()),
        _FakeStore(),
        scope=None,
        session=None,
        llm=_ScriptedLLM("Bell state circuit"),
    )

    assert ctx.conversation_title == "Bell state circuit"
    assert sink.events == []


async def test_a_provider_failure_names_it_anyway_and_says_so(monkeypatch):
    _stub_conversation(monkeypatch, [])
    sink = _RecordingSink()
    llm = _BrokenLLM()

    ctx = await handlers._title_conversation(
        _ctx(sink, prompt="Build a 2-qubit Bell state circuit in Qiskit", conversation_id=None),
        _FakeStore(),
        scope=None,
        session=None,
        llm=llm,
    )

    assert llm.calls == 1
    assert ctx.conversation_title == "Build a 2-qubit Bell state"
    assert sink.events == [
        ("conversation.titled", {"title": "Build a 2-qubit Bell state", "source": "fallback"})
    ]


async def test_an_empty_model_reply_falls_back_rather_than_naming_it_nothing(monkeypatch):
    _stub_conversation(monkeypatch, [])
    sink = _RecordingSink()

    ctx = await handlers._title_conversation(
        _ctx(sink, prompt="QAOA on a 5-node ring"),
        _FakeStore(),
        scope=None,
        session=None,
        llm=_ScriptedLLM("   "),
    )

    assert ctx.conversation_title == "QAOA on a 5-node ring"
    assert sink.events[0][1]["source"] == "fallback"


async def test_a_cancelled_run_is_not_named_and_costs_no_model_call(monkeypatch):
    _stub_conversation(monkeypatch, [])
    sink = _RecordingSink()
    llm = _ScriptedLLM()

    ctx = await handlers._title_conversation(
        _ctx(sink),
        _FakeStore(status=RunStatus.CANCELLED),
        scope=None,
        session=None,
        llm=llm,
    )

    assert llm.calls == 0
    assert ctx.conversation_title is None
    assert sink.events == []
