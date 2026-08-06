"""Every `Framework` member is wired into every registry that switches on it.

## Why this suite exists

`Framework` is declared once, in `majorana_contracts.enums`, and then restated by
hand in six places across four packages. #262 is the record of what that costs:
adding Braket, Qibo and Qulacs meant editing the contracts enum, `openapi.json`,
`ToolName`, the worker event set, the framework-to-tool map, the database
constraint and two separate TypeScript registries — and **nothing failed when one
of them was missed**.

A hand-copied list is silent when it is wrong, and each of these is silent in a
different direction, which is why this is six assertions and not one:

- `_SIMULATION_TOOL` — a `KeyError` on the pipeline's hot path.
- `_FRAMEWORK_SCOPED_GENERATION_RULES` — the worst of them, and the reason this
  file exists. Its lookup is `.get(framework, ())`, so a missing framework
  produces an *empty* rule set, and the loop below then strips every OTHER
  framework's rules from the prompt. The model is asked to write Braket with no
  Braket API guidance at all. Nothing raises; the generation is just worse.
- `ALLOWED_IMPORTS` — generated code cannot import its own framework, so every
  run for it fails inside the sandbox with what reads like a model error.
- `LocalSubprocessSandbox.environment_id` — the environment fingerprint silently
  stops recording the version of a framework it is running.
- `validate_circuit_ir` — returns `None`, so the Studio canvas does not render and
  nothing says why.
- `_FRAMEWORK_MODULES` — a generated import is not attributed to its framework.

## The suite is driven BY the enum

Every test iterates `Framework` rather than naming members. A test that listed
them would be a seventh hand-copied list, with the same failure mode as the six
it is checking.
"""

from __future__ import annotations

import inspect

import pytest
from majorana_contracts import Framework

from majorana_llm import prompts as llm_prompts
from majorana_sandbox import guard as sandbox_guard
from majorana_sandbox.local import LocalSubprocessSandbox
from majorana_frameworks import adapters as framework_adapters
from majorana_frameworks.circuit_ir import (
    CIRCUIT_IR_SCHEMA,
    CIRCUIT_IR_VERSION,
    validate_circuit_ir,
)
from majorana_worker.simple_ports import _SIMULATION_TOOL

#: The top-level module a framework's generated code imports.
#:
#: Not derivable: `braket` is installed as `amazon-braket-sdk`, and Qiskit and
#: PennyLane each contribute a second module. This table is the one place that
#: knowledge lives, and `test_the_module_table_covers_every_framework` makes
#: leaving a framework out of it a failure rather than a silent skip — otherwise
#: this table would be the seventh hand-copied list.
FRAMEWORK_IMPORT_MODULES: dict[Framework, tuple[str, ...]] = {
    Framework.QISKIT: ("qiskit", "qiskit_aer"),
    Framework.CIRQ: ("cirq",),
    Framework.PENNYLANE: ("pennylane", "pennylane_lightning"),
    Framework.BRAKET: ("braket",),
    Framework.QIBO: ("qibo",),
    Framework.QULACS: ("qulacs",),
}

#: The DISTRIBUTION name `importlib.metadata` knows, which is not always the
#: module name — Braket's is the reason this is a second table.
FRAMEWORK_DISTRIBUTIONS: dict[Framework, str] = {
    Framework.QISKIT: "qiskit",
    Framework.CIRQ: "cirq",
    Framework.PENNYLANE: "pennylane",
    Framework.BRAKET: "amazon-braket-sdk",
    Framework.QIBO: "qibo",
    Framework.QULACS: "qulacs",
}


def test_the_module_table_covers_every_framework():
    """The tables above are checked before anything is checked against them.

    Without this, adding a framework and forgetting these two dicts would make
    every test below skip it silently — the exact failure the suite exists to
    catch, reproduced inside the suite.
    """
    assert set(FRAMEWORK_IMPORT_MODULES) == set(Framework)
    assert set(FRAMEWORK_DISTRIBUTIONS) == set(Framework)


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_has_a_simulation_tool(framework: Framework):
    """`_SIMULATION_TOOL[framework]` — a bare dict index on the hot path."""
    assert framework in _SIMULATION_TOOL, (
        f"{framework.value} has no ToolName in services/worker simple_ports._SIMULATION_TOOL"
    )


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_has_generation_rules(framework: Framework):
    """The `.get(..., ())` hole, pinned.

    A missing framework does not raise here — it yields an empty rule set, and
    `simple_generation_system_prompt` then strips every other framework's rules
    from the prompt, so the model writes that framework with no API guidance at
    all. The only symptom is worse generated code.
    """
    rules = llm_prompts._FRAMEWORK_SCOPED_GENERATION_RULES.get(framework.value)
    assert rules, (
        f"{framework.value} has no entry in majorana_llm.prompts."
        "_FRAMEWORK_SCOPED_GENERATION_RULES, so its generation prompt carries no "
        "framework API rules at all"
    )


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_may_be_imported_inside_the_sandbox(framework: Framework):
    """Generated code that cannot import its own framework fails as a model error."""
    for module in FRAMEWORK_IMPORT_MODULES[framework]:
        assert module in sandbox_guard.ALLOWED_IMPORTS, (
            f"{framework.value} needs `{module}` in majorana_sandbox.guard.ALLOWED_IMPORTS; "
            "without it every run for this framework fails inside the sandbox"
        )


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_is_fingerprinted_by_the_local_sandbox(framework: Framework):
    """`environment_id` must record the version of every framework it can run.

    Read out of the source rather than by calling `environment_id`, because the
    property reports `None` for a distribution that is not installed — so a
    framework dropped from the tuple and a framework merely absent from this
    machine produce the same output. The list itself is what is being checked.
    """
    source = inspect.getsource(LocalSubprocessSandbox.environment_id.fget)
    distribution = FRAMEWORK_DISTRIBUTIONS[framework]
    assert f'"{distribution}"' in source, (
        f"{framework.value} ({distribution}) is missing from "
        "LocalSubprocessSandbox.environment_id, so the environment fingerprint "
        "does not record the version it ran"
    )


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_survives_circuit_ir_parsing(framework: Framework):
    """A rejected document renders no Studio canvas and logs nothing.

    Asserted through the parser rather than against its literal set, so it holds
    however that check is written.
    """
    document = {
        "schema": CIRCUIT_IR_SCHEMA,
        "version": CIRCUIT_IR_VERSION,
        "framework": framework.value,
        "qubit_count": 1,
        "clbit_count": 0,
        "operation_count": 0,
        "operations": [],
        "truncated": False,
        "global_phase": None,
    }
    assert validate_circuit_ir(document) is not None, (
        f"validate_circuit_ir rejects framework={framework.value}; the Studio canvas "
        "would silently not render for it"
    )


def test_the_circuit_ir_parser_still_rejects_an_unknown_framework():
    """The control.

    A parser that accepted anything would pass the test above for every member
    of the enum and for `"totally-made-up"` alike.
    """
    document = {
        "schema": CIRCUIT_IR_SCHEMA,
        "version": CIRCUIT_IR_VERSION,
        "framework": "totally-made-up",
        "qubit_count": 1,
        "clbit_count": 0,
        "operation_count": 0,
        "operations": [],
        "truncated": False,
        "global_phase": None,
    }
    assert validate_circuit_ir(document) is None


@pytest.mark.parametrize("framework", list(Framework), ids=lambda f: f.value)
def test_every_framework_is_attributed_from_its_module(framework: Framework):
    """`_FRAMEWORK_MODULES` maps a generated import back to its framework."""
    mapped = {
        module
        for module, mapped_framework in framework_adapters._FRAMEWORK_MODULES.items()
        if mapped_framework is framework
    }
    assert mapped, (
        f"{framework.value} appears in no majorana_frameworks.adapters._FRAMEWORK_MODULES "
        "entry, so generated code importing it is attributed to nothing"
    )
    assert mapped >= {FRAMEWORK_IMPORT_MODULES[framework][0]}
