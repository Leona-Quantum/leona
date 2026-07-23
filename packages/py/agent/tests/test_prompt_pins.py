"""Pins on the LIVE generation prompt.

These assertions used to live in packages/py/llm against the GENERATE stage
prompt — which was dead code (no production callsite), so the lessons they
encoded were pinned to text no model ever saw. The live generation prompt is
AGENT_SYSTEM_PROMPT; the pins move with it.
"""

from majorana_agent.prompts import AGENT_SYSTEM_PROMPT


def test_the_forbidden_api_carries_its_substitute():
    """A ban with no substitute leaves the model nowhere to go (production runs
    019f7dad-385b, 019f7dbf-d673): .c_if() must be named WITH if_test."""
    assert ".c_if()" in AGENT_SYSTEM_PROMPT
    assert "if_test" in AGENT_SYSTEM_PROMPT


def test_endianness_and_result_contract_are_stated():
    assert "little-endian" in AGENT_SYSTEM_PROMPT
    assert "RESULT" in AGENT_SYSTEM_PROMPT
    assert "FINAL_CIRCUIT" in AGENT_SYSTEM_PROMPT


def test_reference_template_is_framed_as_reference_not_answer():
    """The static per-framework template is reference material for syntax, not
    a claim of pipeline verification, and not the answer to the current plan."""
    assert "reference_template" in AGENT_SYSTEM_PROMPT
    assert "not the answer" in AGENT_SYSTEM_PROMPT


def test_every_framework_has_guidance():
    """Item 6 shipped earlier: Cirq and PennyLane must keep parity with Qiskit."""
    for marker in ("Qiskit 2.x", "cirq.Simulator", "qml.device"):
        assert marker in AGENT_SYSTEM_PROMPT, marker
