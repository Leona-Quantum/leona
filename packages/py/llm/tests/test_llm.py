import json

import pytest
from majorana_contracts.enums import Stage
from majorana_llm import (
    FakeLLM,
    LLMRequest,
    StageOutputError,
    extract_code,
    extract_qasm,
    model_for,
    parse_plan,
)
from majorana_llm.prompts import GENERATE_SYSTEM_PROMPT, PLAN_SYSTEM_PROMPT

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


def test_plan_prompt_encodes_qiskit_default_and_ir_limits():
    assert "Default framework is Qiskit" in PLAN_SYSTEM_PROMPT
    assert "never switch" in PLAN_SYSTEM_PROMPT.lower() or "never a silent" in PLAN_SYSTEM_PROMPT
    assert "terminal measurement" in PLAN_SYSTEM_PROMPT
    assert "OpenQASM 2" in GENERATE_SYSTEM_PROMPT


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


def test_parse_plan_rejects_invalid_plan():
    with pytest.raises(StageOutputError):
        parse_plan('{"framework": "not-a-framework"}')


def test_extract_code_and_qasm():
    text = (
        "```python\nfrom qiskit import QuantumCircuit\nqc = QuantumCircuit(2)\n```\n"
        'OPENQASM 2.0;\ninclude "qelib1.inc";\nqreg q[2];\nh q[0];\ncx q[0],q[1];\n'
    )
    assert "QuantumCircuit" in extract_code(text)
    qasm = extract_qasm(text)
    assert qasm and "cx q[0],q[1];" in qasm
