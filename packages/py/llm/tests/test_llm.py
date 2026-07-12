import json

import pytest
from majorana_contracts.enums import Stage
from majorana_llm import (
    FakeLLM,
    LLMRequest,
    StageOutputError,
    endpoint_for,
    extract_code,
    extract_qasm,
    extract_qasm_with_provenance,
    model_for,
    parse_plan,
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


def test_plan_prompt_encodes_qiskit_default_and_ir_limits():
    assert "Default framework is Qiskit" in PLAN_SYSTEM_PROMPT
    assert "never switch" in PLAN_SYSTEM_PROMPT.lower() or "never a silent" in PLAN_SYSTEM_PROMPT
    assert "terminal measurement" in PLAN_SYSTEM_PROMPT
    assert "resource estimate" in PLAN_SYSTEM_PROMPT
    assert "control plane" in GENERATE_SYSTEM_PROMPT
    assert "OpenQASM 2" in GENERATE_SYSTEM_PROMPT
    # oracle/search endianness directive: little-endian convention + loud self-check,
    # so an endianness bug fails in the sandbox instead of returning a bit-reversed answer.
    assert "little-endian" in GENERATE_SYSTEM_PROMPT
    assert "bit-reversed" in GENERATE_SYSTEM_PROMPT


def test_v2_prompt_deltas_present():
    # v2 port (Nameko_System_Prompts_v2.md): seeds + chemistry pragmatism in generate,
    # calibration/evidence rules in the critic, sandbox+IR provenance in writeback.
    assert "deterministic seeds" in GENERATE_SYSTEM_PROMPT.lower()
    assert "hard-code the Hamiltonian coefficients" in GENERATE_SYSTEM_PROMPT
    assert "FINAL_CIRCUIT = compiled_circuit" in GENERATE_SYSTEM_PROMPT
    assert "qiskit_algorithms" in GENERATE_SYSTEM_PROMPT
    assert "QuantumCircuit.qasm()" in GENERATE_SYSTEM_PROMPT
    assert "it did not pass" in CRITIC_SYSTEM_PROMPT
    assert "highest severity" in CRITIC_SYSTEM_PROMPT
    assert "IR" in WRITEBACK_SYSTEM_PROMPT and "sandbox" in WRITEBACK_SYSTEM_PROMPT
    # IR-on-demand directive (DECISIONS 2026-07-11): export-unsupported ≠ failure.
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


async def test_request_schema_is_optional_and_fake_llm_ignores_it():
    fake = FakeLLM({"*": json.dumps(PLAN_JSON)})
    req = LLMRequest(
        model="m",
        system="s",
        user="u",
        response_schema={"type": "object"},
        schema_name="request_plan",
    )
    resp = await fake.complete(req)
    assert parse_plan(resp.text).algorithm == "Bell"
    assert LLMRequest(model="m", system="s", user="u").response_schema is None


async def test_fake_llm_is_deterministic_and_counts_tokens():
    fake = FakeLLM({"claude-opus-4-8": json.dumps(PLAN_JSON)})
    resp = await fake.complete(
        LLMRequest(model="claude-opus-4-8", system="sys", user="prepare a bell state")
    )
    assert resp.output_tokens > 0
    assert resp.input_tokens > 0
    assert parse_plan(resp.text).framework == "qiskit"


async def test_fake_llm_supports_callables_and_wildcard():
    fake = FakeLLM({"*": lambda req: f"echo:{req.user}"})
    resp = await fake.complete(LLMRequest(model="anything", system="", user="hi"))
    assert resp.text == "echo:hi"


def test_parse_plan_tolerates_fenced_json_and_prose():
    wrapped = f"Here is the plan:\n```json\n{json.dumps(PLAN_JSON)}\n```\nDone."
    assert parse_plan(wrapped).algorithm == "Bell"


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


def test_extract_code_and_qasm():
    text = (
        "```python\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\n```\n"
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n'
    )
    assert "QuantumCircuit" in extract_code(text)
    qasm = extract_qasm(text)
    assert qasm and "cx q[0],q[1];" in qasm


def test_qasm_envelope_wins_over_model_stdout_and_preserves_provenance():
    text = """OPENQASM 2.0;
qreg q[1];
x q[0];
__MAJORANA_FINAL_QASM_BEGIN__
OPENQASM 2.0;
qreg q[1];
h q[0];
__MAJORANA_FINAL_QASM_END__
"""
    extraction = extract_qasm_with_provenance(text)
    assert extraction.source == "sandbox_epilogue"
    assert extraction.qasm and "h q[0]" in extraction.qasm
    assert "x q[0]" not in extraction.qasm


def test_qasm_provenance_records_epilogue_error_before_fallback():
    text = """__MAJORANA_FINAL_QASM_ERROR__:QASM2ExportError
OPENQASM 2.0;
qreg q[1];
x q[0];
"""
    extraction = extract_qasm_with_provenance(text)
    assert extraction.source == "model_stdout"
    assert extraction.epilogue_error == "QASM2ExportError"
