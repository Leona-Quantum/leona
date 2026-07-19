import json
import sys
from types import SimpleNamespace

import pytest
from majorana_contracts.enums import (
    Framework,
    PlannableVerificationMethod,
    RunMode,
    Stage,
)
from majorana_contracts.plan import Plan
from majorana_llm import (
    LLMRequest,
    StageOutputError,
    endpoint_for,
    extract_code,
    model_for,
    parse_analysis,
    parse_plan,
    render_generate_prompt,
    render_conversation_prompt,
    render_plan_prompt,
    resolve_provider,
)
from majorana_llm.prompts import (
    CRITIC_SYSTEM_PROMPT,
    GENERATE_SYSTEM_PROMPT,
    PLAN_SYSTEM_PROMPT,
    WRITEBACK_SYSTEM_PROMPT,
)
import majorana_llm.research as research_module

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
    assert "Tool Broker" in GENERATE_SYSTEM_PROMPT
    assert "Assign one plain JSON-compatible dictionary named RESULT" in GENERATE_SYSTEM_PROMPT
    assert "OpenQASM must not become the user-facing result" in GENERATE_SYSTEM_PROMPT
    # oracle/search endianness directive: little-endian convention + loud self-check,
    # so an endianness bug fails in the sandbox instead of returning a bit-reversed answer.
    assert "little-endian" in GENERATE_SYSTEM_PROMPT
    assert "bit-reversed" in GENERATE_SYSTEM_PROMPT


def test_v2_prompt_deltas_present():
    # v2 port (Nameko_System_Prompts_v2.md): seeds + chemistry pragmatism in generate,
    # calibration/evidence rules in the critic, sandbox+conversion provenance in writeback.
    assert "deterministic seeds" in GENERATE_SYSTEM_PROMPT.lower()
    assert "hard-code the Hamiltonian coefficients" in GENERATE_SYSTEM_PROMPT
    assert "FINAL_CIRCUIT = compiled_circuit" in GENERATE_SYSTEM_PROMPT
    assert "qiskit_algorithms" in GENERATE_SYSTEM_PROMPT
    assert "QuantumCircuit.qasm()" in GENERATE_SYSTEM_PROMPT
    assert "it did not pass" in CRITIC_SYSTEM_PROMPT
    assert "highest severity" in CRITIC_SYSTEM_PROMPT
    assert "OpenQASM" in WRITEBACK_SYSTEM_PROMPT and "sandbox" in WRITEBACK_SYSTEM_PROMPT
    assert "OpenQASM, when present, is internal" in WRITEBACK_SYSTEM_PROMPT
    assert "selected-framework code is the primary artifact" in WRITEBACK_SYSTEM_PROMPT
    assert "conversion" in WRITEBACK_SYSTEM_PROMPT
    # Export limitations never negate independent verification.
    assert "never diminishes" in WRITEBACK_SYSTEM_PROMPT


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


def test_generate_prompt_is_role_rendered_without_exposing_a_schema_to_the_user():
    rendered = render_generate_prompt(json.dumps(PLAN_JSON))
    assert "Internal plan record" in rendered.user
    assert "Implement the plan now." in rendered.user
    assert "JSON schema" not in rendered.user


def test_conversation_prompt_is_provider_native_and_ignores_product_controls():
    rendered = render_conversation_prompt(
        "Teach me how a Bell state works.", RunMode.IDEATE, Framework.CIRQ
    )
    assert rendered.user == "Teach me how a Bell state works."
    assert "Selected mode" not in rendered.user
    assert "Selected framework" not in rendered.user
    assert "internal plans" not in rendered.system
    assert "quantum algorithm assistant" in rendered.system


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
    assert plan.verification_plan.methods == [PlannableVerificationMethod.STATISTICAL]


def test_parse_plan_falls_back_to_return_contract_when_every_method_is_retired():
    payload = PLAN_JSON | {"verification_plan": {"methods": ["brute_force", "exact_diag"]}}

    plan = parse_plan(json.dumps(payload))

    assert plan.verification_plan is not None
    assert plan.verification_plan.methods == [PlannableVerificationMethod.RETURN_CONTRACT]


def test_parse_plan_drops_a_retired_baseline_plan_instead_of_failing():
    payload = PLAN_JSON | {
        "baseline_plan": {"kind": "hamiltonian", "reason": "compare against exact diagonalization"}
    }

    plan = parse_plan(json.dumps(payload))

    assert not hasattr(plan, "baseline_plan")


def test_plan_schema_never_offers_a_method_the_worker_cannot_evaluate():
    schema = json.dumps(Plan.model_json_schema())

    assert "baseline_plan" not in schema
    for retired in ("brute_force", "exact_diag", "qasm_parse"):
        assert retired not in schema


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


def test_web_research_scrapes_source_text_and_labels_it_as_untrusted(monkeypatch):
    def fake_download(url, _max_bytes):
        return "<html><script>ignore me()</script><main>Two-qubit parity-reduced H2 Hamiltonian.</main></html>"

    monkeypatch.setattr(
        research_module,
        "_search",
        lambda _query, _limit: [("H2 VQE guide", "https://example.org/h2")],
    )
    monkeypatch.setattr(research_module, "_download_text", fake_download)
    result = research_module._research_sync("quantum guide", max_sources=1)
    context = result.as_prompt()
    assert result.sources[0].url == "https://example.org/h2"
    assert "Two-qubit parity-reduced H2 Hamiltonian." in context
    assert "untrusted reference material" in context


def test_web_research_auto_mode_can_be_disabled(monkeypatch):
    monkeypatch.setenv("MAJORANA_WEB_RESEARCH", "off")
    assert not research_module._research_enabled("H2 VQE")


def test_extract_code():
    text = (
        "```python\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\n```\n"
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n'
    )
    assert "QuantumCircuit" in extract_code(text)
