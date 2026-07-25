"""The generation prompt promises the sandbox a runtime. Keep the promise true.

Lives in the worker's tests because the worker is what wires the two together: it
owns both the prompt that makes the promise and the sandbox that must honour it.

`majorana_llm.prompts._RUNTIME_LIMITS` tells the model exactly which packages the
sandbox exposes, and the Qiskit reference template imports `qiskit_aer` directly. The
LOCAL sandbox double executes generated code with the worker's own interpreter, so a
package named in that promise but absent from this environment is not a missing
dependency the model can route around — it is a defect no candidate can repair.

Live local run 019f98fe (2026-07-25) proved the cost: `qiskit_aer` was promised, used
by the template, and installed by nothing. Every one of the eight candidate revisions
died in 1.3 s with ModuleNotFoundError, the intent review never ran once, and the run
burned its whole budget without the agent ever seeing a result to reason about.
"""

from __future__ import annotations

import importlib
import re

import pytest
from majorana_llm.prompts import SIMPLE_GENERATION_SYSTEM_PROMPT

# Import name per promised distribution, where the two differ.
_PROMISED = {
    "qiskit": "qiskit",
    "qiskit_aer": "qiskit_aer",
    "numpy": "numpy",
    "scipy": "scipy",
    "sympy": "sympy",
    "networkx": "networkx",
    "Cirq": "cirq",
    "PennyLane": "pennylane",
}


@pytest.mark.parametrize("promised,module", sorted(_PROMISED.items()))
def test_every_package_the_prompt_promises_is_importable(promised: str, module: str) -> None:
    assert promised in SIMPLE_GENERATION_SYSTEM_PROMPT, (
        f"{promised!r} is no longer named in the generation prompt; drop it here too"
    )
    importlib.import_module(module)


def test_the_promise_itself_has_not_grown_unnoticed() -> None:
    """A package added to the prompt but not to this list would go unchecked."""

    sentence = re.search(
        r"The sandbox exposes (.+?) plus side-effect-free",
        SIMPLE_GENERATION_SYSTEM_PROMPT,
        re.S,
    )
    assert sentence is not None, "the runtime promise sentence changed shape"
    named = {
        token.strip(" ,.\n")
        for token in re.split(r",| and ", sentence.group(1))
        if token.strip(" ,.\n")
    }

    assert named == set(_PROMISED), (
        "the prompt's promised runtime and this test's list have drifted apart"
    )
