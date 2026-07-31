import json

import pytest

from majorana_research_extraction import (
    PythonExtractionLimits,
    PythonFactKind,
    extract_python_source,
)


def _facts(source: str):
    result = extract_python_source("examples/vqe.py", source.encode())
    assert result.issues == ()
    assert result.execution_performed is False
    return result.facts


def test_extracts_qiskit_import_alias_calls_literal_keywords_and_main_entrypoint():
    source = """import qiskit_algorithms as qa
from qiskit_algorithms.optimizers import SLSQP as Optimizer

solver = qa.VQE(estimator, ansatz, optimizer=Optimizer(maxiter=100), callback=callback)

def main():
    return solver

if __name__ == "__main__":
    main()
"""
    facts = _facts(source)
    compact = [
        (fact.kind.value, fact.qualified_name, fact.local_name, fact.keyword, fact.literal_json)
        for fact in facts
    ]

    assert ("import", "qiskit_algorithms", "qa", None, None) in compact
    assert (
        "from_import",
        "qiskit_algorithms.optimizers.SLSQP",
        "Optimizer",
        None,
        None,
    ) in compact
    assert ("imported_call", "qiskit_algorithms.VQE", None, None, None) in compact
    assert (
        "imported_call",
        "qiskit_algorithms.optimizers.SLSQP",
        None,
        None,
        None,
    ) in compact
    assert (
        "call_keyword",
        "qiskit_algorithms.optimizers.SLSQP",
        None,
        "maxiter",
        "100",
    ) in compact
    assert (
        "call_keyword",
        "qiskit_algorithms.VQE",
        None,
        "callback",
        None,
    ) in compact
    assert ("cli_entrypoint", "main", None, None, None) in compact
    assert all(fact.locator.content_sha256 for fact in facts)
    assert all(fact.locator.start_line >= 1 for fact in facts)


def test_extracts_pennylane_call_and_nested_literal_configuration():
    source = """import pennylane as qml
device = qml.device("default.qubit", wires=4, shots=None)
weights = qml.numpy.array([0.0])
"""
    facts = _facts(source)
    keywords = {
        (fact.qualified_name, fact.keyword): fact.literal_json
        for fact in facts
        if fact.kind is PythonFactKind.CALL_KEYWORD
    }
    calls = {fact.qualified_name for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL}

    assert calls == {"pennylane.device", "pennylane.numpy.array"}
    assert keywords[("pennylane.device", "wires")] == "4"
    assert keywords[("pennylane.device", "shots")] == "null"


def test_tracks_simple_symbol_alias_without_claiming_unused_import_is_called():
    source = """from openfermion import FermionOperator
Alias = FermionOperator
unused = 3
operator = Alias("1^ 0")
"""
    facts = _facts(source)
    kinds = [(fact.kind, fact.qualified_name, fact.local_name) for fact in facts]

    assert (
        PythonFactKind.SYMBOL_ALIAS,
        "openfermion.FermionOperator",
        "Alias",
    ) in kinds
    assert sum(fact.kind is PythonFactKind.IMPORTED_CALL for fact in facts) == 1
    assert all(fact.qualified_name != "unused" for fact in facts)


def test_function_local_shadowing_prevents_false_imported_call():
    source = """from tangelo import VQE

def misleading(VQE):
    return VQE()

actual = VQE()
"""
    facts = _facts(source)
    calls = [fact for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL]

    assert [fact.qualified_name for fact in calls] == ["tangelo.VQE"]
    assert calls[0].locator.start_line == 6


def test_loop_comprehension_and_local_definition_shadow_import_bindings():
    source = """from tangelo import VQE

items = [VQE() for VQE in factories]
for VQE in factories:
    VQE()

def VQE():
    return None

VQE()
"""
    facts = _facts(source)

    assert [fact for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL] == []


def test_global_declaration_uses_outer_import_binding():
    source = """from tangelo import VQE

def build():
    global VQE
    return VQE()
"""
    facts = _facts(source)
    calls = [fact for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL]

    assert [fact.qualified_name for fact in calls] == ["tangelo.VQE"]


def test_nested_global_declaration_does_not_change_parent_scope_resolution():
    source = """from tangelo import VQE

def outer():
    VQE = local_factory
    def nested():
        global VQE
        return VQE()
    return VQE()
"""
    facts = _facts(source)
    calls = [fact for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL]

    assert [fact.qualified_name for fact in calls] == ["tangelo.VQE"]
    assert calls[0].locator.start_line == 7


def test_conditional_rebinding_does_not_leak_into_sibling_branch():
    source = """from tangelo import VQE

if condition:
    VQE = local_factory
else:
    solver = VQE()

after = VQE()
"""
    facts = _facts(source)
    calls = [fact for fact in facts if fact.kind is PythonFactKind.IMPORTED_CALL]

    assert [fact.qualified_name for fact in calls] == ["tangelo.VQE"]
    assert calls[0].locator.start_line == 6


@pytest.mark.parametrize(
    ("path", "content", "code"),
    [
        ("../escape.py", b"pass\n", "invalid_source_path"),
        ("example.txt", b"pass\n", "invalid_source_path"),
        ("example.py", b"\xff", "invalid_utf8"),
        ("example.py", b"def broken(:\n", "invalid_python_syntax"),
    ],
)
def test_invalid_input_fails_closed_without_raw_exception(path, content, code):
    result = extract_python_source(path, content)

    assert result.facts == ()
    assert [issue.code for issue in result.issues] == [code]
    assert "SyntaxError" not in json.dumps(result.as_dict())


def test_source_node_depth_and_fact_limits_fail_closed():
    oversized = extract_python_source(
        "example.py",
        b"x" * 10,
        limits=PythonExtractionLimits(max_source_bytes=4),
    )
    too_many_nodes = extract_python_source(
        "example.py",
        b"x = 1\ny = 2\n",
        limits=PythonExtractionLimits(max_ast_nodes=3),
    )
    too_many_facts = extract_python_source(
        "example.py",
        b"import one\nimport two\n",
        limits=PythonExtractionLimits(max_facts=1),
    )

    assert [issue.code for issue in oversized.issues] == ["source_size_limit_exceeded"]
    assert [issue.code for issue in too_many_nodes.issues] == ["ast_node_limit_exceeded"]
    assert [issue.code for issue in too_many_facts.issues] == ["fact_limit_exceeded"]


def test_literal_values_are_bounded_and_nonliteral_keywords_remain_explicit_unknowns():
    source = """from openvqe import Solver
solver = Solver(config={"nested": [1, 2, 3]}, callback=lambda value: value)
"""
    facts = _facts(source)
    keywords = {
        fact.keyword: fact.literal_json
        for fact in facts
        if fact.kind is PythonFactKind.CALL_KEYWORD
    }

    assert keywords["config"] == '{"nested":[1,2,3]}'
    assert keywords["callback"] is None


def test_replay_is_byte_deterministic_and_target_code_is_not_executed(tmp_path):
    marker = tmp_path / "must-not-exist"
    source = f"""import pathlib
pathlib.Path({str(marker)!r}).write_text("executed")
"""

    first = extract_python_source("hostile.py", source.encode())
    second = extract_python_source("hostile.py", source.encode())

    assert first == second
    assert first.deterministic_digest == second.deterministic_digest
    assert not marker.exists()
    assert first.execution_performed is False
