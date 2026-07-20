import json
import sys
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import (
    PlannableVerificationMethod,
    Stage,
    VerificationMethod,
)
from majorana_contracts.plan import Plan
from majorana_llm import (
    LLMRequest,
    LLMResponse,
    RetryingLLM,
    StageOutputError,
    endpoint_for,
    extract_code,
    model_for,
    parse_analysis,
    parse_plan,
    render_plan_prompt,
    resolve_provider,
)
from majorana_llm.prompts import (
    PLAN_SYSTEM_PROMPT,
    QUANTUM_AGENT_SYSTEM_PROMPT,
)

PLAN_JSON = {
    "domain": "education",
    "framework": "qiskit",
    "algorithm": "Bell",
    "problem_summary": "Prepare a Bell state",
    "algorithm_rationale": "Entangle two qubits with H + CX",
    "parameters": {},
    "qubits_estimate": 2,
    "expected_runtime_sec": 1,
    "success_criteria": {"primary_metric": "fidelity"},
    "expected_output_keys": ["counts"],
}


def test_model_constants_are_stage_specific_and_env_overridable(monkeypatch):
    assert model_for(Stage.PLAN) != model_for(Stage.GENERATE)
    monkeypatch.setenv("MAJORANA_MODEL_PLAN", "custom-model")
    assert model_for(Stage.PLAN) == "custom-model"


def _clear_provider_env(monkeypatch):
    for var in ("MAJORANA_LLM_PROVIDER", "OPENAI_API_KEY", "DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY"):
        monkeypatch.delenv(var, raising=False)


def test_provider_resolution_prefers_owner_confirmed_keys(monkeypatch):
    _clear_provider_env(monkeypatch)
    assert resolve_provider() == "anthropic"  # no keys → safe fallback
    monkeypatch.setenv("DEEPSEEK_API_KEY", "x")
    assert resolve_provider() == "openai"
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "anthropic")
    assert resolve_provider() == "anthropic"  # explicit env wins
    monkeypatch.setenv("MAJORANA_LLM_PROVIDER", "nonsense")
    with pytest.raises(ValueError):
        resolve_provider()


def test_model_defaults_follow_provider_profile(monkeypatch):
    _clear_provider_env(monkeypatch)
    monkeypatch.setenv("OPENAI_API_KEY", "x")
    assert model_for(Stage.GENERATE).startswith("deepseek")
    assert model_for(Stage.VERIFY).startswith("gpt")


def test_endpoint_routing_by_model_prefix(monkeypatch):
    monkeypatch.delenv("DEEPSEEK_BASE_URL", raising=False)
    base, key_env = endpoint_for("deepseek-v4-pro")
    assert base == "https://api.deepseek.com" and key_env == "DEEPSEEK_API_KEY"
    base, key_env = endpoint_for("gpt-5.5")
    assert base is None and key_env == "OPENAI_API_KEY"


def test_plan_prompt_encodes_framework_native_contract():
    assert "Default framework is Qiskit" in PLAN_SYSTEM_PROMPT
    assert "never switch" in PLAN_SYSTEM_PROMPT.lower() or "never a silent" in PLAN_SYSTEM_PROMPT
    assert "selected framework's executable Python source is the canonical" in PLAN_SYSTEM_PROMPT
    assert "source fingerprints" in PLAN_SYSTEM_PROMPT
    # The generation-side pins (c_if -> if_test substitute, little-endian
    # self-check, RESULT contract) moved with the live prompt: they are asserted
    # against AGENT_SYSTEM_PROMPT in packages/py/agent/tests, since the GENERATE
    # stage prompt they used to pin here was dead code and is deleted.


def test_plan_prompt_stops_measure_all_from_making_ancilla_algorithms_unsatisfiable():
    """`measure_all` is checked literally against the circuit that ran, so any
    algorithm holding an ancilla back — Deutsch-Jozsa, Bernstein-Vazirani, Simon,
    kickback Grover — fails it with CORRECT code, identically on every candidate, and
    burns the whole budget (production run 019f7db9-f00b). The planner had no guidance
    on the field at all and reached for `measure_all` by habit; `specified` is the
    policy that fits."""
    assert "measurement_policy" in PLAN_SYSTEM_PROMPT
    assert "specified" in PLAN_SYSTEM_PROMPT
    assert "ancilla" in PLAN_SYSTEM_PROMPT


def test_structured_decoding_routes_per_endpoint():
    from majorana_llm.client import decode_params

    schema = {"type": "object", "properties": {"a": {"type": "string"}}}
    req = LLMRequest(model="m", system="sys", user="u", response_schema=schema, schema_name="plan")
    # OpenAI: true json_schema, system untouched.
    params, system = decode_params(req, "OPENAI_API_KEY")
    assert params["response_format"]["type"] == "json_schema"
    assert params["response_format"]["json_schema"]["schema"] == schema
    assert system == "sys"
    # DeepSeek rejects json_schema → json_object + schema injected into the system.
    params, system = decode_params(req, "DEEPSEEK_API_KEY")
    assert params["response_format"] == {"type": "json_object"}
    assert '"a"' in system and system.startswith("sys")
    # No schema → no response_format at all.
    params, system = decode_params(LLMRequest(model="m", system="sys", user="u"), "OPENAI_API_KEY")
    assert "response_format" not in params


def test_request_schema_is_optional_on_the_request_model():
    assert LLMRequest(model="m", system="s", user="u").response_schema is None


async def test_openai_compatible_llm_streams_reasoning_and_output(monkeypatch):
    calls: list[dict] = []

    async def provider_stream():
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content="think ", content=None))
            ],
            usage=None,
        )
        yield SimpleNamespace(
            choices=[
                SimpleNamespace(delta=SimpleNamespace(reasoning_content=None, content="answer"))
            ],
            usage=SimpleNamespace(prompt_tokens=3, completion_tokens=2),
        )

    class RecordingCompletions:
        async def create(self, **kwargs):
            calls.append(kwargs)
            return provider_stream()

    class RecordingAsyncOpenAI:
        def __init__(self, **_kwargs):
            self.chat = SimpleNamespace(completions=RecordingCompletions())

    monkeypatch.setitem(sys.modules, "openai", SimpleNamespace(AsyncOpenAI=RecordingAsyncOpenAI))
    monkeypatch.setenv("DEEPSEEK_API_KEY", "test-key")

    from majorana_llm.client import OpenAICompatibleLLM

    seen: list[tuple[str, str]] = []

    async def on_delta(text: str, kind: str) -> None:
        seen.append((text, kind))

    response = await OpenAICompatibleLLM().complete(
        LLMRequest(model="deepseek-chat", system="system", user="user"),
        on_delta=on_delta,
    )

    assert response.text == "answer"
    assert response.input_tokens == 3
    assert response.output_tokens == 2
    assert seen == [("think ", "reasoning"), ("answer", "output")]
    assert calls[0]["stream"] is True


def test_provider_neutral_prompt_rendering_keeps_request_and_internal_instructions_separate():
    rendered = render_plan_prompt(
        "Build a noisy 4-qubit QAOA circuit and explain which verification strategy is useful.",
        "Reference material: compare local simulation with an exact small-instance check.",
    )
    assert rendered.user.startswith("User request:")
    assert "Build a noisy 4-qubit QAOA circuit" in rendered.user
    assert "Reference material" in rendered.user
    assert "machine" in rendered.system.lower()
    assert "plumbing" in rendered.system.lower()
    assert "benchmark" in rendered.system.lower()


def test_chat_persona_cannot_narrate_results_it_did_not_produce():
    # The chat turn cannot execute anything, so the persona must not let the
    # model narrate results it did not produce.
    assert "never report simulation output" in QUANTUM_AGENT_SYSTEM_PROMPT


def test_analysis_parser_accepts_the_internal_narrative_contract():
    analysis = parse_analysis(
        json.dumps(
            {
                "summary": "The circuit passed the recorded verification checks.",
                "interpretation": "The measured distribution agrees with the expected result.",
                "residual_risks": "The run used local simulation rather than a QPU.",
            }
        )
    )
    assert analysis.summary.startswith("The circuit passed")
    assert analysis.residual_risks is not None


def test_parse_plan_tolerates_fenced_json_and_prose():
    wrapped = f"Here is the plan:\n```json\n{json.dumps(PLAN_JSON)}\n```\nDone."
    assert parse_plan(wrapped).algorithm == "Bell"


def test_parse_plan_normalizes_retired_verification_methods_instead_of_failing():
    payload = PLAN_JSON | {"verification_plan": {"methods": ["brute_force", "statistical"]}}

    plan = parse_plan(json.dumps(payload))

    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.STATISTICAL]


def test_parse_plan_falls_back_to_return_contract_when_every_method_is_retired():
    payload = PLAN_JSON | {"verification_plan": {"methods": ["brute_force", "exact_diag"]}}

    plan = parse_plan(json.dumps(payload))

    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [VerificationMethod.RETURN_CONTRACT]


def test_parse_plan_drops_a_retired_baseline_plan_instead_of_failing():
    payload = PLAN_JSON | {
        "baseline_plan": {"kind": "hamiltonian", "reason": "compare against exact diagonalization"}
    }

    plan = parse_plan(json.dumps(payload))

    assert not hasattr(plan, "baseline_plan")


def test_parsed_methods_are_identical_to_the_members_the_worker_dispatches_on():
    """The worker's dispatch loop compares with `is`, not `==`.

    A PlannableVerificationMethod member has an equal *value* but is a different
    object, so it would fail every identity check and report every result as
    "required evidence unavailable" — i.e. fail verification for every run.
    """
    payload = PLAN_JSON | {"verification_plan": {"methods": ["statistical", "brute_force"]}}

    methods = parse_plan(json.dumps(payload)).verification_plan.methods

    assert all(isinstance(method, VerificationMethod) for method in methods)
    assert methods[0] is VerificationMethod.STATISTICAL
    assert PlannableVerificationMethod.STATISTICAL is not VerificationMethod.STATISTICAL


def test_plan_schema_never_offers_a_method_the_worker_cannot_evaluate():
    schema = json.dumps(Plan.model_json_schema())

    assert "baseline_plan" not in schema
    for retired in ("brute_force", "qasm_parse"):
        assert retired not in schema
    # `exact_diag` moved the other way on 2026-07-20: it now has a dispatch branch
    # (EvidenceVerifier._exact_diag_check) and a reference field, so withholding it
    # from the schema would be the same defect in reverse — a check the worker can
    # run that no plan can ask for. It was in that state since migration 0001.
    assert "exact_diag" in schema
    assert "reference_hamiltonian" in schema


def test_parse_plan_normalizes_scalar_additional_notes_from_json_object_mode():
    drifted = {
        **PLAN_JSON,
        "success_criteria": {
            "primary_metric": "fidelity",
            "additional_notes": "use seeded shots",
        },
    }
    plan = parse_plan(json.dumps(drifted))
    assert plan.success_criteria.additional_notes == ["use seeded shots"]


def test_parse_plan_rejects_invalid_plan():
    with pytest.raises(StageOutputError):
        parse_plan('{"framework": "not-a-framework"}')


def test_extract_code():
    text = (
        "```python\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\n```\n"
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n'
    )
    assert "QuantumCircuit" in extract_code(text)


# --- RetryingLLM ---------------------------------------------------------------
#
# `deepseek-reasoner` returned a completely empty completion at the planning stage on
# two production runs (019f7dad-3a24, 019f7de2-a45b) and both dead-lettered before a
# line of code was written. Once the real verification defects were fixed, the provider
# returning nothing became the most common reason a run dies.


class _EmptyThenText:
    def __init__(self, empties: int) -> None:
        self.calls = 0
        self._empties = empties

    async def complete(self, request, *, on_delta=None):
        self.calls += 1
        text = "" if self.calls <= self._empties else '{"ok": true}'
        return LLMResponse(text=text, model=request.model, input_tokens=1, output_tokens=1)


async def _no_sleep(_delay: float) -> None:
    return None


def _request() -> LLMRequest:
    return LLMRequest(model="deepseek-reasoner", system="s", user="u")


async def test_an_empty_completion_is_retried():
    inner = _EmptyThenText(empties=2)
    response = await RetryingLLM(inner, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == '{"ok": true}'


async def test_retries_are_bounded_and_the_last_empty_reply_is_returned_not_raised():
    """Returned, not raised: the caller's parser reports what was missing, and its
    message already tells an empty completion apart from prose (`len=0, blank=True`)."""
    inner = _EmptyThenText(empties=99)
    response = await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3
    assert response.text == ""


async def test_a_transport_failure_is_retried_then_re_raised():
    class _AlwaysRaises:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            raise TimeoutError("connection reset")

    inner = _AlwaysRaises()
    with pytest.raises(TimeoutError):
        await RetryingLLM(inner, attempts=3, sleep=_no_sleep).complete(_request())
    assert inner.calls == 3


async def test_a_stream_that_already_emitted_is_never_replayed():
    """Retrying after deltas reached the caller would duplicate the run's visible
    output. A response that delivered something is delivered, however short."""

    class _StreamsThenEmpty:
        def __init__(self) -> None:
            self.calls = 0

        async def complete(self, request, *, on_delta=None):
            self.calls += 1
            if on_delta is not None:
                await on_delta("partial", "output")
            return LLMResponse(text="", model=request.model, input_tokens=1, output_tokens=1)

    inner = _StreamsThenEmpty()
    seen: list[str] = []

    async def collect(text: str, _channel: str) -> None:
        seen.append(text)

    await RetryingLLM(inner, sleep=_no_sleep).complete(_request(), on_delta=collect)
    assert inner.calls == 1
    assert seen == ["partial"]


async def test_backoff_grows_between_attempts():
    delays: list[float] = []

    async def record(delay: float) -> None:
        delays.append(delay)

    await RetryingLLM(_EmptyThenText(empties=99), attempts=3, sleep=record).complete(_request())
    assert delays == [1.0, 2.0]
