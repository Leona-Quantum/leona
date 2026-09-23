"""Leona's example Qapps: hand-written, reviewed bundles anyone can copy into
their own account (ai-ops 363).

Every other Qapp is produced by the generation pipeline (`handlers.py`), which
asks a model for a UI document, a quantum program and two schemas, then runs
them through the document guard, the Python safety guard and a sandbox smoke
run. These four are written by hand instead, so they exist even when no model
is available and so a person can review exactly what a visitor will run. They
are held to the same contracts: `tests/test_qapp_examples.py` puts each one
through every check a generated Qapp must pass and then executes the program
at both ends of its input range.

A copy is created PRIVATE in the caller's own workspace
(`repos.qapps.create_from_example`). Nothing here is ever published on its own.
Publication stays the owner's act, and it needs one successful run of that
copy, like any other Qapp (`set_visibility`). The owner ruled for exactly that
on ai-ops 363: "I build the four and you publish them from your own account
after reviewing each one".

Each example lives in its own directory as `program.py` (the source the
sandbox executes, verbatim) and `ui.html` (the document the frame renders,
verbatim). `program.py` reads `QAPP_INPUTS` and `QAPP_MAX_QUBITS`, which the
sandbox injects, so it is not an importable module. Ruff is told so in
`pyproject.toml`, and nothing in this package imports it.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

_HERE = Path(__file__).parent

#: Bumped whenever a bundle's program, document or schemas change, and recorded
#: on every copy (`QappVersion.generation_prompt`). A copy is a snapshot: later
#: fixes here do not reach copies already made, and this number is how a reader
#: tells which one they have.
EXAMPLES_REVISION = 1


@dataclass(frozen=True)
class QappExample:
    key: str
    title: str
    description: str
    framework: str
    qubits_estimate: int
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]

    @property
    def quantum_source(self) -> str:
        return (_HERE / self.key / "program.py").read_text(encoding="utf-8")

    @property
    def ui_document(self) -> str:
        return (_HERE / self.key / "ui.html").read_text(encoding="utf-8")


def _object(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": False,
    }


_BELL_STATES = ["phi_plus", "phi_minus", "psi_plus", "psi_minus"]
_SHOTS = {
    "type": "integer",
    "title": "Shots",
    "minimum": 1,
    "maximum": 8192,
    "default": 1000,
}

BELL_PAIR = QappExample(
    key="bell_pair",
    title="Bell pair",
    description=(
        "Entangle two qubits into one of the four Bell states and measure both. Each result "
        "is random on its own, but the two qubits always agree or always disagree."
    ),
    framework="qiskit",
    qubits_estimate=2,
    input_schema=_object(
        {
            "state": {"type": "string", "title": "Bell state", "enum": _BELL_STATES},
            "basis": {"type": "string", "title": "Measurement basis", "enum": ["Z", "X"]},
            "shots": _SHOTS,
        },
        ["state", "basis", "shots"],
    ),
    output_schema=_object(
        {
            "state": {"type": "string", "enum": _BELL_STATES},
            "basis": {"type": "string", "enum": ["Z", "X"]},
            "shots": {"type": "integer", "minimum": 1, "maximum": 8192},
            "counts": {
                "type": "object",
                "additionalProperties": {"type": "integer", "minimum": 0},
                "maxProperties": 4,
            },
            "probabilities": {
                "type": "object",
                "additionalProperties": {"type": "number", "minimum": 0, "maximum": 1},
                "maxProperties": 4,
            },
            "correlation": {"type": "number", "minimum": -1, "maximum": 1},
            "exact_correlation": {"type": "number", "minimum": -1, "maximum": 1},
            "circuit": {"type": "string"},
        },
        [
            "state",
            "basis",
            "shots",
            "counts",
            "probabilities",
            "correlation",
            "exact_correlation",
            "circuit",
        ],
    ),
)

GROVER_SEARCH = QappExample(
    key="grover_search",
    title="Grover search",
    description=(
        "Hide one item among up to 32 and let Grover's algorithm find it. See how the chance "
        "of success rises with each iteration, then falls again if you overshoot."
    ),
    framework="qiskit",
    qubits_estimate=5,
    input_schema=_object(
        {
            "qubits": {
                "type": "integer",
                "title": "Qubits",
                "minimum": 2,
                "maximum": 5,
                "default": 3,
            },
            "marked": {
                "type": "integer",
                "title": "Marked item",
                "minimum": 0,
                "maximum": 31,
                "default": 5,
            },
            "iterations": {
                "type": "integer",
                "title": "Grover iterations",
                "minimum": 0,
                "maximum": 8,
                "default": 2,
            },
            "shots": _SHOTS,
        },
        ["qubits", "marked", "iterations", "shots"],
    ),
    output_schema=_object(
        {
            "qubits": {"type": "integer", "minimum": 2, "maximum": 5},
            "marked": {"type": "integer", "minimum": 0, "maximum": 31},
            "marked_bitstring": {"type": "string", "minLength": 2, "maxLength": 5},
            "iterations": {"type": "integer", "minimum": 0, "maximum": 8},
            "shots": {"type": "integer", "minimum": 1, "maximum": 8192},
            "counts": {
                "type": "object",
                "additionalProperties": {"type": "integer", "minimum": 0},
                "maxProperties": 32,
            },
            "success_probability": {"type": "number", "minimum": 0, "maximum": 1},
            "measured_success": {"type": "number", "minimum": 0, "maximum": 1},
            "probability_by_iteration": {
                "type": "array",
                "items": {"type": "number", "minimum": 0, "maximum": 1},
                "minItems": 9,
                "maxItems": 9,
            },
            "optimal_iterations": {"type": "integer", "minimum": 1, "maximum": 8},
        },
        [
            "qubits",
            "marked",
            "marked_bitstring",
            "iterations",
            "shots",
            "counts",
            "success_probability",
            "measured_success",
            "probability_by_iteration",
            "optimal_iterations",
        ],
    ),
)

_GRAPH_NAMES = [
    "triangle",
    "square",
    "square_with_diagonal",
    "complete_4",
    "pentagon",
    "bowtie",
    "hexagon",
    "prism",
]

QAOA_MAXCUT = QappExample(
    key="qaoa_maxcut",
    title="QAOA MaxCut",
    description=(
        "Split the nodes of a small graph into two groups so that as many edges as possible "
        "cross between them, using the Quantum Approximate Optimization Algorithm. Let it "
        "find the best angles, or set them yourself."
    ),
    framework="qiskit",
    qubits_estimate=6,
    input_schema=_object(
        {
            "graph": {
                "type": "string",
                "title": "Graph",
                "enum": _GRAPH_NAMES,
                "default": "square",
            },
            "layers": {
                "type": "integer",
                "title": "QAOA layers",
                "minimum": 1,
                "maximum": 3,
                "default": 1,
            },
            "optimize": {"type": "boolean", "title": "Find the best angles", "default": True},
            "gamma": {
                "type": "number",
                "title": "Cost angle",
                "minimum": 0,
                "maximum": 3.1416,
                "default": 0.8,
            },
            "beta": {
                "type": "number",
                "title": "Mixer angle",
                "minimum": 0,
                "maximum": 1.5708,
                "default": 0.4,
            },
        },
        ["graph", "layers", "optimize", "gamma", "beta"],
    ),
    output_schema=_object(
        {
            "graph": {"type": "string", "enum": _GRAPH_NAMES},
            "nodes": {"type": "integer", "minimum": 3, "maximum": 6},
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "u": {"type": "integer", "minimum": 0, "maximum": 5},
                        "v": {"type": "integer", "minimum": 0, "maximum": 5},
                    },
                    "required": ["u", "v"],
                    "additionalProperties": False,
                },
                "maxItems": 15,
            },
            "layers": {"type": "integer", "minimum": 1, "maximum": 3},
            "optimized": {"type": "boolean"},
            "gammas": {"type": "array", "items": {"type": "number"}, "maxItems": 3},
            "betas": {"type": "array", "items": {"type": "number"}, "maxItems": 3},
            "max_cut": {"type": "integer", "minimum": 1, "maximum": 15},
            "expected_cut": {"type": "number", "minimum": 0, "maximum": 15},
            "approximation_ratio": {"type": "number", "minimum": 0, "maximum": 1},
            "probability_optimal": {"type": "number", "minimum": 0, "maximum": 1},
            "best_assignment": {"type": "string", "minLength": 3, "maxLength": 6},
            "best_assignment_cut": {"type": "integer", "minimum": 0, "maximum": 15},
            "top_outcomes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "assignment": {"type": "string", "minLength": 3, "maxLength": 6},
                        "probability": {"type": "number", "minimum": 0, "maximum": 1},
                        "cut": {"type": "integer", "minimum": 0, "maximum": 15},
                    },
                    "required": ["assignment", "probability", "cut"],
                    "additionalProperties": False,
                },
                "maxItems": 8,
            },
        },
        [
            "graph",
            "nodes",
            "edges",
            "layers",
            "optimized",
            "gammas",
            "betas",
            "max_cut",
            "expected_cut",
            "approximation_ratio",
            "probability_optimal",
            "best_assignment",
            "best_assignment_cut",
            "top_outcomes",
        ],
    ),
)

H2_VQE = QappExample(
    key="h2_vqe",
    title="Hydrogen molecule energy (VQE)",
    description=(
        "Sweep the distance between the two atoms of H₂ and find the lowest energy at each "
        "distance with a variational quantum eigensolver. The classical Hartree-Fock guess and "
        "the exact answer are drawn alongside. The bottom of the curve is the bond length."
    ),
    framework="qiskit",
    qubits_estimate=2,
    input_schema=_object(
        {
            "r_min": {
                "type": "number",
                "title": "Shortest distance (Å)",
                "minimum": 0.3,
                "maximum": 1.2,
                "default": 0.4,
            },
            "r_max": {
                "type": "number",
                "title": "Longest distance (Å)",
                "minimum": 1.5,
                "maximum": 3.5,
                "default": 2.5,
            },
            "points": {
                "type": "integer",
                "title": "Distances to try",
                "minimum": 3,
                "maximum": 30,
                "default": 15,
            },
        },
        ["r_min", "r_max", "points"],
    ),
    output_schema=_object(
        {
            "units": {"type": "string", "enum": ["hartree"]},
            "curve": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "r_angstrom": {"type": "number", "minimum": 0.3, "maximum": 3.5},
                        "hartree_fock": {"type": "number"},
                        "vqe": {"type": "number"},
                        "exact": {"type": "number"},
                        "theta": {"type": "number"},
                        "excited_weight": {"type": "number", "minimum": 0, "maximum": 1},
                    },
                    "required": [
                        "r_angstrom",
                        "hartree_fock",
                        "vqe",
                        "exact",
                        "theta",
                        "excited_weight",
                    ],
                    "additionalProperties": False,
                },
                "minItems": 3,
                "maxItems": 30,
            },
            "equilibrium_r_angstrom": {"type": "number", "minimum": 0.3, "maximum": 3.5},
            "equilibrium_energy": {"type": "number"},
            "equilibrium_in_range": {"type": "boolean"},
            "lowest_sweep_r_angstrom": {"type": "number", "minimum": 0.3, "maximum": 3.5},
            "max_vqe_error_millihartree": {"type": "number", "minimum": 0},
            "max_correlation_millihartree": {"type": "number", "minimum": 0},
        },
        [
            "units",
            "curve",
            "equilibrium_r_angstrom",
            "equilibrium_energy",
            "equilibrium_in_range",
            "lowest_sweep_r_angstrom",
            "max_vqe_error_millihartree",
            "max_correlation_millihartree",
        ],
    ),
)

#: Display order: simplest idea first.
EXAMPLES: tuple[QappExample, ...] = (BELL_PAIR, GROVER_SEARCH, QAOA_MAXCUT, H2_VQE)


@cache
def examples_by_key() -> dict[str, QappExample]:
    return {example.key: example for example in EXAMPLES}
