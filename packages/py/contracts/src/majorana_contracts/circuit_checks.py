"""A circuit check with no notebook: `POST /v1/checks/circuit` (ai-ops 382, VISION §5.8).

An outside AI editor (Claude Code, Cursor, Codex, through `leona-mcp`'s `check_circuit`
tool or `leona_client.Client.check_circuit`) hands Leona an OpenQASM 3 circuit and a
`CheckProperty`, and gets back the same `CheckVerdict` a notebook's check cell gets:
`pass` / `fail` / `inconclusive`, judged by trusted code, with `teeth` saying whether
the check could tell deliberately broken copies of the circuit from the original.

Nothing is stored and nothing is executed: the circuit is parsed, never run, and
judged by the same engine the worker uses for check cells
(`leona_notebooks.checks.evaluate_check`).
"""

from __future__ import annotations

from pydantic import Field

from .models import _ResourceBase
from .notebooks import CheckProperty, CheckVerdict

#: The longest circuit this route judges, in characters of OpenQASM 3. The same number a
#: notebook's check capture is held to (`MAX_CAPTURE_QASM_CHARS` in
#: `leona_notebooks.checks`, restated here because this package imports nothing
#: internal; `services/api/tests/test_check_circuit_route.py` pins the two together).
MAX_CIRCUIT_CHECK_QASM_CHARS = 64_000


class CircuitCheckRequest(_ResourceBase):
    """One circuit and one property to check it against.

    `property.kind` is `state`, `unitary`, `distribution` or `energy`. A `value` check is
    refused (400): it judges a number a notebook computed, and a circuit is not one.

    `property.subject` is required by `CheckProperty` and **ignored here**: it names a
    variable in a notebook, and this route has no notebook. Send `"circuit"` by
    convention. The authorship fields (`author`, `citation`, `accepted`) are ignored too:
    the verdict never depends on them and nothing is stored.

    Bitstrings in `amplitudes`, `probabilities` and Pauli strings in `hamiltonian` follow
    Qiskit's convention: q0 is the RIGHTMOST character.
    """

    qasm: str = Field(
        min_length=1,
        max_length=MAX_CIRCUIT_CHECK_QASM_CHARS,
        description='The circuit, as OpenQASM 3 (include "stdgates.inc" for standard gates).',
    )
    property: CheckProperty


class CircuitCheckResponse(_ResourceBase):
    """The verdict, with `teeth` always set.

    In a notebook, `teeth` is left empty on a check that did not pass. Here it is always
    present, as `not_measured` with the reason when no broken copies were tried, so a
    caller never has to guess whether an absent field means "not tried" or "forgotten".
    A `pass` means "checked against `verdict.checked_against`", never "verified".
    """

    verdict: CheckVerdict


__all__ = [
    "MAX_CIRCUIT_CHECK_QASM_CHARS",
    "CircuitCheckRequest",
    "CircuitCheckResponse",
]
